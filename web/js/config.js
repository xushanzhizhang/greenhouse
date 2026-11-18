/**
 * 全局配置：分区、指标、设备、告警阈值、视觉常量
 * 所有单位与量程都在这里定义，方便后续对接真实传感器时改口径。
 */

export const ZONES = [
  { id: 'A1', name: 'A1 番茄区', crop: '番茄', x: 0, z: -12.0, color: '#3ee7ff' },
  { id: 'A2', name: 'A2 黄瓜区', crop: '黄瓜', x: 0, z: -4.0, color: '#5df0b4' },
  { id: 'A3', name: 'A3 草莓区', crop: '草莓', x: 0, z: 4.0, color: '#ffc25c' },
  { id: 'A4', name: 'A4 生菜区', crop: '生菜', x: 0, z: 12.0, color: '#a98bff' },
];

/** 指标元数据：min/max 用于进度条归一化，warn 为告警区间 */
export const METRICS = [
  { key: 'airTemp', label: '空气温度', short: '温度', unit: '℃', min: 12, max: 36, warn: [16, 32], digits: 1 },
  { key: 'airHum', label: '空气湿度', short: '湿度', unit: '%', min: 30, max: 95, warn: [55, 85], digits: 0 },
  { key: 'co2', label: 'CO₂ 浓度', short: 'CO₂', unit: 'ppm', min: 300, max: 1500, warn: [450, 1200], digits: 0 },
  { key: 'light', label: '光照强度', short: '光照', unit: 'lux', min: 0, max: 12000, warn: [0, 99999], digits: 0 },
  { key: 'soilTemp', label: '土壤温度', short: '土温', unit: '℃', min: 10, max: 32, warn: [14, 28], digits: 1 },
  { key: 'soilHum', label: '土壤含水率', short: '土湿', unit: '%', min: 15, max: 60, warn: [22, 45], digits: 0 },
  { key: 'ec', label: '基质 EC', short: 'EC', unit: 'mS/cm', min: 0.5, max: 3.5, warn: [1.0, 3.0], digits: 2 },
  { key: 'ph', label: '基质 pH', short: 'pH', unit: '', min: 4.5, max: 8.0, warn: [5.5, 7.2], digits: 2 },
];

/** 设备清单：type 决定图标，pos 为三维场景中的挂点（米） */
export const DEVICES = [
  { id: 'fanA', name: '循环风机 A', type: 'fan', power: 0.75, pos: { x: 6.4, y: 3.2, z: 14.4 }, default: true },
  { id: 'fanB', name: '循环风机 B', type: 'fan', power: 0.75, pos: { x: -6.4, y: 3.2, z: 14.4 }, default: true },
  { id: 'pad', name: '湿帘水泵', type: 'pump', power: 1.10, pos: { x: -7.4, y: 2.0, z: -14.6 }, default: true },
  { id: 'light', name: 'LED 补光灯', type: 'lamp', power: 2.40, pos: { x: 0, y: 5.9, z: 0 }, default: false },
  { id: 'shade', name: '外遮阳幕', type: 'shade', power: 0.55, pos: { x: 0, y: 7.1, z: 6 }, default: false },
  { id: 'screen', name: '内保温幕', type: 'screen', power: 0.45, pos: { x: 0, y: 6.6, z: -6 }, default: false },
  { id: 'irrig', name: '水肥滴灌', type: 'drop', power: 1.20, pos: { x: 0, y: 0.6, z: 0 }, default: true },
  { id: 'heater', name: '加温管道', type: 'heat', power: 3.00, pos: { x: 5.5, y: 0.4, z: -10 }, default: false },
  { id: 'co2', name: 'CO₂ 发生器', type: 'co2', power: 0.35, pos: { x: -5.5, y: 1.2, z: 10 }, default: true },
];

/** 告警规则：级别 / 触发条件 / 文案模板 */
export const ALERT_RULES = [
  { key: 'airTempHigh', level: 'critical', metric: 'airTemp', test: (v) => v > 32, text: '棚内温度偏高，已超过 32℃，建议开启湿帘降温' },
  { key: 'airTempLow', level: 'warning', metric: 'airTemp', test: (v) => v < 16, text: '棚内温度偏低，低于 16℃，建议启动加温管道' },
  { key: 'airHumLow', level: 'warning', metric: 'airHum', test: (v) => v < 55, text: '空气湿度偏低，作物蒸腾压力增大' },
  { key: 'airHumHigh', level: 'critical', metric: 'airHum', test: (v) => v > 88, text: '空气湿度偏高，存在灰霉病风险' },
  { key: 'co2High', level: 'warning', metric: 'co2', test: (v) => v > 1200, text: 'CO₂ 浓度超过 1200 ppm，请检查施放阀' },
  { key: 'soilDry', level: 'critical', metric: 'soilHum', test: (v) => v < 22, text: '土壤含水率低于 22%，滴灌需立即补水' },
  { key: 'soilWet', level: 'warning', metric: 'soilHum', test: (v) => v > 45, text: '土壤含水率过高，注意根系缺氧' },
  { key: 'ecHigh', level: 'warning', metric: 'ec', test: (v) => v > 3.0, text: '基质 EC 偏高，盐分累积需冲洗' },
  { key: 'phLow', level: 'warning', metric: 'ph', test: (v) => v < 5.5, text: '基质 pH 偏低，影响养分吸收' },
];

/** 视觉常量 */
export const PALETTE = {
  bg: '#040a16',
  cyan: '#3ee7ff',
  green: '#49f0a6',
  amber: '#ffbe4d',
  red: '#ff5f6d',
  violet: '#a98bff',
  text: '#d8ecff',
  dim: '#7d9cb8',
};

export const HISTORY_BUCKET_MS = 5 * 60 * 1000;
export const HISTORY_POINTS = 288; // 24h / 5min
