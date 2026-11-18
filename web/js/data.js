/**
 * 数据层：温室环境模拟引擎
 * - 采用「日变化基准 + 执行器影响 + 一阶惯性跟随 + 微噪声」生成连续、可信的读数
 * - 内置 24 小时历史回填，开屏即有大屏曲线，而不是空白等数据
 * - 对外只暴露 snapshot / onChange，后续替换为 WebSocket 真实数据时无需改 UI
 */
import { ZONES, METRICS, DEVICES, ALERT_RULES, HISTORY_BUCKET_MS, HISTORY_POINTS } from './config.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const noise = (amp) => (Math.random() - 0.5) * 2 * amp;

/** 日变化基准：14 时最高、2 时最低 */
function diurnal(hour, min, max, peak = 14) {
  const mid = (max + min) / 2;
  const amp = (max - min) / 2;
  return mid + amp * Math.cos(((hour - peak) / 24) * TAU);
}

function daylight(hour) {
  if (hour < 6 || hour > 18) return 0;
  return Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI)) * 10200;
}

const CROP_BIAS = {
  A1: { crop: '番茄', temp: 0.6, hum: -2, stage: '开花坐果期', day: 78, gdd: 1842, lai: 3.2, yield: 4.8, score: 92 },
  A2: { crop: '黄瓜', temp: -0.4, hum: 2.5, stage: '结果盛期', day: 64, gdd: 1620, lai: 3.8, yield: 5.6, score: 88 },
  A3: { crop: '草莓', temp: 0.2, hum: 1, stage: '果实膨大期', day: 96, gdd: 1410, lai: 2.4, yield: 2.9, score: 85 },
  A4: { crop: '生菜', temp: -0.8, hum: 3, stage: '莲座期', day: 32, gdd: 760, lai: 2.1, yield: 1.7, score: 90 },
};

export class GreenhouseModel {
  constructor() {
    this.listeners = new Set();
    this.tickCount = 0;
    this.devices = DEVICES.map((d) => ({ ...d, on: d.default, runtime: 0 }));
    this.selectedZone = 'A1';

    // 今日累计资源
    this.resource = {
      energy: 41.8,
      energyTarget: 68,
      water: 1.78,
      waterTarget: 3.2,
      co2: 6.2,
      co2Target: 9.5,
    };
    this.system = {
      bootAt: Date.now() - 3 * 86400000 - 7 * 3600000,
      sampleHz: 1,
      gatewayDelay: 14,
      sensorOnline: 24,
      sensorTotal: 24,
      integrity: 99.8,
    };

    this.zones = ZONES.map((z) => {
      const bias = CROP_BIAS[z.id];
      return {
        ...z,
        crop: bias.crop,
        cropInfo: bias,
        state: {
          airTemp: 24, airHum: 66, co2: 620, light: 3000,
          soilTemp: 22, soilHum: 34, ec: 1.62, ph: 6.4,
        },
        target: {},
      };
    });

    this.history = this._backfill();
    this.alerts = this._seedAlerts();
    this._alertCooldown = new Map();
    this._lastAlertSweep = 0;

    this._recomputeTargets();
    // 让初值贴近当前时刻，避免开屏瞬间数值跳变
    const hour = new Date().getHours() + new Date().getMinutes() / 60;
    this.zones.forEach((z) => {
      Object.keys(z.target).forEach((k) => {
        z.state[k] = z.target[k] + noise(0.35);
      });
    });
  }

  /* ------------------------------ 事件 ------------------------------ */
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit() {
    const snap = this.snapshot();
    this.listeners.forEach((fn) => fn(snap));
  }

  /* ------------------------------ 模拟 ------------------------------ */
  _backfill() {
    const now = Date.now();
    const out = [];
    for (let i = HISTORY_POINTS - 1; i >= 0; i--) {
      const t = now - i * HISTORY_BUCKET_MS;
      const d = new Date(t);
      const hour = d.getHours() + d.getMinutes() / 60;
      const temp = diurnal(hour, 16, 31) + 0.35 * Math.sin(hour * 1.7);
      const hum = clamp(diurnal(hour, 58, 82, 2) + 0.6 * Math.sin(hour * 2.3), 40, 95);
      const co2 = 620 - 190 * Math.cos(((hour - 14) / 24) * TAU) + 18 * Math.sin(hour * 3);
      out.push({ t, temp: +temp.toFixed(2), hum: +hum.toFixed(1), co2: +co2.toFixed(0) });
    }
    return out;
  }

  _seedAlerts() {
    const now = Date.now();
    const mk = (minsAgo, level, zone, text) => ({
      id: `seed-${minsAgo}`,
      time: now - minsAgo * 60000,
      level,
      zone,
      text,
      ack: false,
    });
    return [
      mk(3, 'warning', 'A3', 'A3 草莓区空气湿度偏低（56%），蒸腾压力增大'),
      mk(11, 'critical', 'A4', 'A4 生菜区土壤含水率 21%，已自动启动滴灌'),
      mk(26, 'warning', 'A1', 'A1 番茄区 CO₂ 浓度 1180 ppm，接近上限'),
      mk(58, 'info', 'A2', 'A2 黄瓜区补光灯已按光照阈值自动关闭'),
      mk(94, 'warning', 'A1', 'A1 番茄区夜间温度 15.8℃，低于设定值'),
    ];
  }

  /** 根据执行器状态与时刻，计算每个分区的目标读数 */
  _recomputeTargets() {
    const now = new Date();
    const hour = now.getHours() + now.getMinutes() / 60;
    const per = this._actuatorEffect();

    for (const zone of this.zones) {
      const bias = CROP_BIAS[zone.id];
      const baseTemp = diurnal(hour, 16, 31) + bias.temp;
      const baseHum = diurnal(hour, 58, 82, 2) + bias.hum;
      const baseCo2 = 620 - 190 * Math.cos(((hour - 14) / 24) * TAU);
      let light = daylight(hour) * (per.shade ? 0.55 : 1);
      if (per.light) light = Math.max(light, 2600);
      if (hour >= 18 || hour < 6) light = per.light ? 2600 : 0;

      zone.target = {
        airTemp: baseTemp + per.temp,
        airHum: baseHum + per.hum,
        co2: baseCo2 + per.co2,
        light,
        soilTemp: diurnal(hour, 19, 26, 16) + per.temp * 0.35,
        soilHum: zone.state.soilHum, // 由水分收支单独积分
        ec: zone.state.ec,
        ph: zone.state.ph,
      };
    }
  }

  _actuatorEffect() {
    const on = (id) => this.devices.find((d) => d.id === id)?.on;
    return {
      temp: (on('pad') ? -1.6 : 0) + (on('shade') ? -0.7 : 0) + (on('heater') ? 1.8 : 0) + (on('fanA') || on('fanB') ? -0.35 : 0),
      hum: (on('pad') ? 6.5 : 0) + (on('fanA') || on('fanB') ? -2.0 : 0) + (on('screen') ? 1.5 : 0),
      co2: on('co2') ? 110 : 0,
      light: !!on('light'),
      shade: !!on('shade'),
    };
  }

  tick(dt = 1) {
    this.tickCount++;
    const now = new Date();
    const hour = now.getHours() + now.getMinutes() / 60;
    this._recomputeTargets();
    const per = this._actuatorEffect();

    for (const zone of this.zones) {
      const s = zone.state;
      const t = zone.target;

      // 一阶惯性跟随 + 微噪声：像真实传感器而不是阶跃函数
      const k = 0.06 * dt;
      s.airTemp = lerp(s.airTemp, t.airTemp, k) + noise(0.06);
      s.airHum = clamp(lerp(s.airHum, t.airHum, k) + noise(0.25), 30, 98);
      s.co2 = lerp(s.co2, t.co2, k) + noise(3);
      s.light = Math.max(0, lerp(s.light, t.light, 0.18 * dt) + noise(12));
      s.soilTemp = lerp(s.soilTemp, t.soilTemp, 0.02 * dt) + noise(0.03);

      // 土壤水分收支：蒸腾消耗 - 滴灌补给
      const irrig = this.devices.find((d) => d.id === 'irrig').on;
      const et = 0.012 * Math.max(0.2, daylight(hour) / 10200) * dt; // 白天蒸腾更快
      s.soilHum = clamp(s.soilHum - et + (irrig ? 0.16 * dt : 0), 12, 60);

      // EC / pH 缓变，滴灌时被稀释
      const ecTarget = 1.62 + 0.12 * Math.sin(hour * 0.7);
      s.ec = clamp(lerp(s.ec, ecTarget - (irrig ? 0.05 : 0), 0.01 * dt) + noise(0.004), 0.5, 3.5);
      const phTarget = 6.35 + 0.1 * Math.sin(hour * 0.5);
      s.ph = clamp(lerp(s.ph, phTarget, 0.01 * dt) + noise(0.003), 4.5, 8);
    }

    // 设备运行时长与资源累计
    const onPower = this.devices.reduce((sum, d) => sum + (d.on ? d.power : 0), 0);
    this.devices.forEach((d) => { if (d.on) d.runtime += dt; });
    this.resource.energy += (onPower * dt) / 3600;
    if (this.devices.find((d) => d.id === 'irrig').on) {
      this.resource.water += (1.2 * dt) / 3600;
    }
    if (this.devices.find((d) => d.id === 'co2').on) {
      this.resource.co2 += (0.45 * dt) / 3600;
    }

    // 历史：每秒刷新最后一个 5 分钟桶，跨桶则追加
    const avgTemp = this._avg('airTemp');
    const avgHum = this._avg('airHum');
    const avgCo2 = this._avg('co2');
    const last = this.history[this.history.length - 1];
    const bucketStart = Math.floor(Date.now() / HISTORY_BUCKET_MS) * HISTORY_BUCKET_MS;
    if (last && bucketStart <= last.t) {
      last.temp = +avgTemp.toFixed(2);
      last.hum = +avgHum.toFixed(1);
      last.co2 = +avgCo2.toFixed(0);
    } else {
      this.history.push({ t: bucketStart, temp: +avgTemp.toFixed(2), hum: +avgHum.toFixed(1), co2: +avgCo2.toFixed(0) });
      if (this.history.length > HISTORY_POINTS) this.history.shift();
    }

    // 告警巡检：每 5 秒一次，冷却 2 分钟防止刷屏
    if (Date.now() - this._lastAlertSweep > 5000) {
      this._lastAlertSweep = Date.now();
      this._sweepAlerts();
    }

    this.system.gatewayDelay = Math.round(12 + Math.random() * 6);
    this._emit();
  }

  _avg(key) {
    return this.zones.reduce((s, z) => s + z.state[key], 0) / this.zones.length;
  }

  _sweepAlerts() {
    for (const zone of this.zones) {
      for (const rule of ALERT_RULES) {
        const v = zone.state[rule.metric];
        if (!rule.test(v)) continue;
        const key = `${rule.key}:${zone.id}`;
        const last = this._alertCooldown.get(key) || 0;
        if (Date.now() - last < 120000) continue;
        this._alertCooldown.set(key, Date.now());
        this.pushAlert(rule.level, zone.id, `${zone.id} ${zone.crop}区${rule.text}`);
      }
    }
  }

  pushAlert(level, zone, text) {
    this.alerts.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, time: Date.now(), level, zone, text, ack: false });
    if (this.alerts.length > 40) this.alerts.pop();
  }

  /* ------------------------------ 操作 ------------------------------ */
  toggleDevice(id) {
    const d = this.devices.find((x) => x.id === id);
    if (!d) return;
    d.on = !d.on;
    this.pushAlert('info', '系统', `${d.name}已${d.on ? '启动' : '停止'}`);
    this._recomputeTargets();
    this._emit();
  }

  selectZone(id) {
    this.selectedZone = id;
    this._emit();
  }

  /* ------------------------------ 输出 ------------------------------ */
  getZone(id) {
    return this.zones.find((z) => z.id === id) || this.zones[0];
  }

  snapshot() {
    const selected = this.getZone(this.selectedZone);
    return {
      now: Date.now(),
      zones: this.zones,
      selected,
      devices: this.devices,
      alerts: this.alerts.slice(0, 12),
      resource: this.resource,
      system: this.system,
      history: this.history,
      avg: { airTemp: this._avg('airTemp'), airHum: this._avg('airHum'), co2: this._avg('co2'), light: this._avg('light') },
    };
  }
}
