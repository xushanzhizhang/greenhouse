/**
 * UI 层：面板渲染、图表、交互绑定
 * 以 1Hz 刷新数值面板，5s 刷新图表，避免大屏长时间运行时的无谓重绘
 */
import { METRICS, ZONES, PALETTE } from './config.js';

const $ = (s, r = document) => r.querySelector(s);
const fmt = (v, d = 0) => v.toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });

const ICONS = {
  fan: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M12 9c0-3 1-5 4-5M12 15c0 3-1 5-4 5M9 12c-3 0-5-1-5-4M15 12c3 0 5 1 5 4" stroke="currentColor" stroke-width="1.5"/></svg>`,
  pump: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 4c3.5 4 6 6.6 6 9.5a6 6 0 1 1-12 0C6 10.6 8.5 8 12 4Z" stroke="currentColor" stroke-width="1.5"/><path d="M9 14a3 3 0 0 0 3 3" stroke="currentColor" stroke-width="1.4"/></svg>`,
  lamp: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="10" r="4.5" stroke="currentColor" stroke-width="1.5"/><path d="M9.5 15.5h5M10 18h4M12 2v1.5M4 10H2.5M21.5 10H20M5.5 4l1 1M18.5 4l-1 1" stroke="currentColor" stroke-width="1.4"/></svg>`,
  shade: `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="12" stroke="currentColor" stroke-width="1.4"/><path d="M3 9h18M3 13h18M9 5v12M15 5v12" stroke="currentColor" stroke-width="1.1" opacity=".7"/></svg>`,
  screen: `<svg viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 10h16M4 14h16M4 18h16" stroke="currentColor" stroke-width="1.3"/></svg>`,
  drop: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 3c3 4 6 6.8 6 9.8a6 6 0 0 1-12 0C6 9.8 9 7 12 3Z" stroke="currentColor" stroke-width="1.5"/><path d="M12 12v5M9.5 14.5 12 17l2.5-2.5" stroke="currentColor" stroke-width="1.3"/></svg>`,
  heat: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 21c4 0 6-2.6 6-6 0-4-4-6-6-12-2 6-6 8-6 12 0 3.4 2 6 6 6Z" stroke="currentColor" stroke-width="1.5"/><path d="M12 21c-1.6 0-2.6-1.2-2.6-2.6 0-1.8 2-2.8 2.6-6 .6 3.2 2.6 4.2 2.6 6 0 1.4-1 2.6-2.6 2.6Z" stroke="currentColor" stroke-width="1.2" opacity=".8"/></svg>`,
  co2: `<svg viewBox="0 0 24 24" fill="none"><path d="M7 17a4 4 0 0 1 0-8 4.5 4.5 0 0 1 8.4-1.6A4 4 0 0 1 17 17H7Z" stroke="currentColor" stroke-width="1.4"/><circle cx="9" cy="13" r="1.4" fill="currentColor"/><circle cx="15" cy="13" r="1.4" fill="currentColor"/></svg>`,
};

const STAGE_PCT = { A1: 62, A2: 76, A3: 68, A4: 44 };

export class Dashboard {
  constructor(model, scene) {
    this.model = model;
    this.scene = scene;
    this.lastChartAt = 0;
    this.lastAlertKey = '';
    this.dom = {
      stage: $('#stage'),
      metricGrid: $('#metric-grid'),
      deviceList: $('#device-list'),
      alertList: $('#alert-list'),
      zoneTabs: $('#zone-tabs'),
      sysDelay: $('#sys-delay'),
      sysUptime: $('#sys-uptime'),
    };
    this._buildMetrics();
    this._buildDevices();
    this._buildZoneTabs();
    this._bindControls();
    this._initCharts();
    this._fitStage();
    window.addEventListener('resize', () => { this._fitStage(); this._resizeCharts(); });
    setInterval(() => this._tickClock(), 1000);
    this._tickClock();
  }

  /* ------------------------------ 静态结构 ------------------------------ */
  _buildMetrics() {
    this.metricEls = {};
    this.dom.metricGrid.innerHTML = METRICS.map((m) => `
      <div class="metric" data-k="${m.key}">
        <div class="m-label">${m.label}</div>
        <div class="m-row"><span class="m-value">--</span><span class="m-unit">${m.unit}</span></div>
        <div class="m-bar"><i></i></div>
      </div>`).join('');
    METRICS.forEach((m) => {
      const el = this.dom.metricGrid.querySelector(`.metric[data-k="${m.key}"]`);
      this.metricEls[m.key] = { el, val: el.querySelector('.m-value'), bar: el.querySelector('.m-bar i'), meta: m };
    });
  }

  _buildDevices() {
    this.deviceEls = {};
    this.dom.deviceList.innerHTML = this.model.devices.map((d) => `
      <div class="device" data-id="${d.id}">
        <div class="d-icon">${ICONS[d.type] || ICONS.fan}</div>
        <div class="d-name">${d.name}</div>
        <div class="d-meta">${d.on ? '运行中' : '已停止'}</div>
        <div class="d-switch"></div>
      </div>`).join('');
    this.model.devices.forEach((d) => {
      const el = this.dom.deviceList.querySelector(`.device[data-id="${d.id}"]`);
      el.addEventListener('click', () => {
        this.model.toggleDevice(d.id);
        this._syncDevices();
      });
      this.deviceEls[d.id] = el;
    });
    this._syncDevices();
  }

  _buildZoneTabs() {
    this.dom.zoneTabs.innerHTML = ZONES.map(
      (z) => `<button class="zone-tab" data-zone="${z.id}" style="--zc:${z.color}"><i></i>${z.id} ${z.crop}区</button>`
    ).join('');
    this.dom.zoneTabs.querySelectorAll('.zone-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.zone;
        this.model.selectZone(id);
        this.scene.selectZone(id);
        this._syncZoneTabs(id);
      });
    });
    this.scene.onSelectZone = (id) => {
      this.model.selectZone(id);
      this._syncZoneTabs(id);
    };
    this._syncZoneTabs(this.model.selectedZone);
  }

  _syncZoneTabs(id) {
    this.dom.zoneTabs.querySelectorAll('.zone-tab').forEach((b) => b.classList.toggle('active', b.dataset.zone === id));
  }

  _bindControls() {
    document.querySelectorAll('.cam-btn[data-cam]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.scene.setCamera(btn.dataset.cam);
        document.querySelectorAll('.cam-btn[data-cam]').forEach((b) => b.classList.toggle('active', b === btn));
        $('#st-cam').textContent = btn.textContent;
      });
    });
    const rot = $('#btn-rotate');
    rot.classList.add('on');
    rot.addEventListener('click', () => {
      const on = !rot.classList.contains('on');
      rot.classList.toggle('on', on);
      this.scene.setAutoRotate(on);
    });
    $('#btn-full').addEventListener('click', () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
    });
  }

  _fitStage() {
    const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    this.dom.stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  }

  /* ------------------------------ 图表 ------------------------------ */
  _initCharts() {
    const echarts = window.echarts;
    this.trendChart = echarts.init($('#chart-trend'), 'dark', { renderer: 'canvas' });
    this.radarChart = echarts.init($('#chart-radar'), 'dark', { renderer: 'canvas' });
    this.trendChart.setOption(this._trendOption(this.model.history));
    this.radarChart.setOption(this._radarOption(this.model.zones));
  }

  _trendOption(history) {
    const times = history.map((h) => {
      const d = new Date(h.t);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    });
    return {
      backgroundColor: 'transparent',
      animation: true,
      animationDuration: 800,
      grid: { left: 42, right: 44, top: 22, bottom: 20 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(6,20,34,.94)',
        borderColor: 'rgba(62,231,255,.3)',
        textStyle: { color: '#cfe6f7', fontSize: 11 },
        axisPointer: { lineStyle: { color: 'rgba(62,231,255,.35)' } },
      },
      legend: {
        top: 0, right: 6, itemWidth: 10, itemHeight: 6, itemGap: 12,
        textStyle: { color: '#7d9cb8', fontSize: 10 },
        data: ['空气温度', '空气湿度'],
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: times,
        axisLine: { lineStyle: { color: 'rgba(62,231,255,.14)' } },
        axisTick: { show: false },
        axisLabel: { color: '#5f83a2', fontSize: 9.5, interval: 23, fontFamily: 'Bahnschrift' },
      },
      yAxis: [
        {
          type: 'value', name: '℃', min: 14, max: 34,
          nameTextStyle: { color: '#5f83a2', fontSize: 10 },
          axisLine: { show: false }, axisTick: { show: false },
          splitLine: { lineStyle: { color: 'rgba(62,231,255,.07)' } },
          axisLabel: { color: '#5f83a2', fontSize: 9.5 },
        },
        {
          type: 'value', name: '%RH', min: 40, max: 95,
          nameTextStyle: { color: '#5f83a2', fontSize: 10 },
          axisLine: { show: false }, axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { color: '#4f7c6e', fontSize: 9.5 },
        },
      ],
      series: [
        {
          name: '空气温度', type: 'line', yAxisIndex: 0, smooth: 0.35, showSymbol: false,
          data: history.map((h) => h.temp),
          lineStyle: { width: 1.6, color: '#3ee7ff', shadowColor: 'rgba(62,231,255,.5)', shadowBlur: 8 },
          areaStyle: {
            opacity: 1,
            color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(62,231,255,.22)' },
                { offset: 1, color: 'rgba(62,231,255,.02)' },
              ],
            },
          },
        },
        {
          name: '空气湿度', type: 'line', yAxisIndex: 1, smooth: 0.35, showSymbol: false,
          data: history.map((h) => h.hum),
          lineStyle: { width: 1.3, color: '#49f0a6', type: 'dashed', opacity: 0.9 },
        },
      ],
    };
  }

  _radarOption(zones) {
    const dims = ['温度适宜', '湿度适宜', '光照满足', 'CO₂ 适宜', '土壤水分'];
    return {
      backgroundColor: 'transparent',
      legend: {
        bottom: 2, itemWidth: 9, itemHeight: 6, itemGap: 14,
        textStyle: { color: '#8fb2cc', fontSize: 10 },
        data: zones.map((z) => z.id),
      },
      radar: {
        center: ['50%', '48%'],
        radius: '78%',
        indicator: dims.map(() => ({ max: 100 })),
        shape: 'polygon',
        splitNumber: 4,
        axisName: { color: '#7fa0bb', fontSize: 10 },
        axisLine: { lineStyle: { color: 'rgba(62,231,255,.14)' } },
        splitLine: { lineStyle: { color: 'rgba(62,231,255,.09)' } },
        splitArea: { show: false },
      },
      series: [{
        type: 'radar',
        symbol: 'circle',
        symbolSize: 3,
        lineStyle: { width: 1.2 },
        areaStyle: { opacity: 0.10 },
        data: zones.map((z) => ({
          name: z.id,
          value: scoreZone(z),
          itemStyle: { color: z.color },
          lineStyle: { color: z.color },
          areaStyle: { color: z.color },
        })),
      }],
    };
  }

  _resizeCharts() {
    this.trendChart?.resize();
    this.radarChart?.resize();
  }

  /* ------------------------------ 更新 ------------------------------ */
  update(snap, fps) {
    this._updateKpi(snap);
    this._updateMetrics(snap.selected);
    this._updateCrop(snap.selected);
    this._updateResource(snap.resource);
    this._updateSystem(snap.system);
    this._updateAlerts(snap.alerts);
    this._syncDevices();
    if (fps) $('#st-fps').textContent = `${fps} FPS`;

    const now = Date.now();
    if (now - this.lastChartAt > 5000) {
      this.lastChartAt = now;
      this.trendChart.setOption({ xAxis: { data: this._times(snap.history) }, series: [{ data: snap.history.map((h) => h.temp) }, { data: snap.history.map((h) => h.hum) }] });
      this.radarChart.setOption(this._radarOption(snap.zones));
    }
  }

  _times(history) {
    return history.map((h) => {
      const d = new Date(h.t);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    });
  }

  _updateKpi(snap) {
    $('#kpi-temp').textContent = snap.avg.airTemp.toFixed(1);
    $('#kpi-hum').textContent = Math.round(snap.avg.airHum);
    $('#kpi-co2').textContent = Math.round(snap.avg.co2);
    $('#kpi-sensor').textContent = snap.system.sensorOnline;
  }

  _updateMetrics(zone) {
    $('#env-zone').textContent = `${zone.id} ${zone.crop}区`;
    METRICS.forEach((m) => {
      const { el, val, bar, meta } = this.metricEls[m.key];
      const v = zone.state[m.key];
      val.textContent = fmt(v, m.digits);
      const pct = Math.max(2, Math.min(100, ((v - m.min) / (m.max - m.min)) * 100));
      bar.style.width = `${pct}%`;
      const span = m.max - m.min;
      const isCrit = v > m.warn[1] + span * 0.10 || v < m.warn[0] - span * 0.10;
      const isWarn = v > m.warn[1] || v < m.warn[0];
      el.classList.toggle('state-crit', isCrit);
      el.classList.toggle('state-warn', !isCrit && isWarn);
    });
  }

  _updateCrop(zone) {
    const info = zone.cropInfo;
    const pct = STAGE_PCT[zone.id] ?? 60;
    $('#crop-name').textContent = `${zone.id} ${info.crop}`;
    $('#crop-stage').textContent = info.stage;
    $('#crop-bar').style.width = `${pct}%`;
    $('#crop-pct').textContent = `${pct}%`;
    $('#crop-day').textContent = `播种第 ${info.day} 天`;
    $('#crop-gdd').textContent = info.gdd;
    $('#crop-lai').textContent = info.lai.toFixed(1);
    $('#crop-yield').textContent = info.yield.toFixed(1);
    $('#crop-score').textContent = info.score;
  }

  _updateResource(res) {
    const set = (k, val, target, unit) => {
      $(`#res-${k}`).textContent = k === 'water' ? val.toFixed(2) : val.toFixed(1);
      const pct = Math.min(100, (val / target) * 100);
      $(`#bar-${k}`).style.width = `${pct}%`;
      $(`#res-${k}-pct`).textContent = `${Math.round(pct)}%`;
    };
    set('energy', res.energy, res.energyTarget);
    set('water', res.water, res.waterTarget);
    set('co2', res.co2, res.co2Target);
  }

  _updateSystem(sys) {
    this.dom.sysDelay.textContent = `${sys.gatewayDelay} ms`;
    const ms = Date.now() - sys.bootAt;
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    this.dom.sysUptime.textContent = `${d}d ${h}h`;
  }

  _syncDevices() {
    let on = 0;
    this.model.devices.forEach((d) => {
      const el = this.deviceEls[d.id];
      if (!el) return;
      d.on ? on++ : null;
      el.classList.toggle('on', d.on);
      const meta = el.querySelector('.d-meta');
      if (meta) meta.textContent = `${d.power.toFixed(2)} kW`;
    });
    $('#dev-on').textContent = on;
    $('#dev-total').textContent = this.model.devices.length;
  }

  _updateAlerts(alerts) {
    const key = alerts.length ? `${alerts[0].id}-${alerts.length}` : 'none';
    const unread = alerts.filter((a) => !a.ack).length;
    $('#alert-count').textContent = unread;
    if (key === this.lastAlertKey) return;
    this.lastAlertKey = key;
    const LV = { critical: '严重', warning: '预警', info: '提示' };
    this.dom.alertList.innerHTML = alerts.slice(0, 6).map((a) => {
      const t = new Date(a.time);
      return `<li class="alert ${a.level}">
        <i class="bar"></i>
        <div class="alert-main">
          <div class="alert-top">
            <span class="alert-zone">${a.zone}</span>
            <span class="alert-time">${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}</span>
            <span class="alert-lv">${LV[a.level] || ''}</span>
          </div>
          <div class="alert-text">${a.text}</div>
        </div>
      </li>`;
    }).join('') || `<li class="alert info"><i class="bar"></i><div class="alert-main"><div class="alert-text">当前无告警，系统运行平稳</div></div></li>`;
  }

  _tickClock() {
    const d = new Date();
    $('#clock-time').textContent = d.toTimeString().slice(0, 8);
    $('#clock-date').textContent = `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日 星期${'日一二三四五六'[d.getDay()]}`;
  }
}

/** 分区适宜度评分（0-100），用于雷达图 */
function scoreZone(z) {
  const s = z.state;
  const clamp = (v) => Math.max(8, Math.min(100, v));
  return [
    clamp(100 - Math.abs(s.airTemp - 25) * 7),
    clamp(100 - Math.abs(s.airHum - 70) * 2.4),
    clamp(s.light > 0 ? 40 + s.light / 12000 * 60 : 35),
    clamp(100 - Math.abs(s.co2 - 700) / 9),
    clamp(100 - Math.abs(s.soilHum - 33) * 4.5),
  ];
}
