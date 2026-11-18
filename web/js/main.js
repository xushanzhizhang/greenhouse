/**
 * 入口：装配数据源 / 三维场景 / 面板，驱动主循环
 */
import { GreenhouseModel } from './data.js';
import { TwinScene } from './scene.js';
import { Dashboard } from './ui.js';

const MODEL_URL = '../model/greenhouse_optimized.glb';
const TICK_MS = 1000;

async function boot() {
  const model = new GreenhouseModel();
  const viewport = document.querySelector('#viewport');
  const scene = new TwinScene(viewport);
  const ui = new Dashboard(model, scene);

  // 进度条
  const loading = document.querySelector('#loading');
  const fill = document.querySelector('#ld-fill');
  const pct = document.querySelector('#ld-pct');

  try {
    await scene.loadModel(MODEL_URL, (p) => {
      const v = Math.min(99, Math.round(p * 100));
      fill.style.width = `${v}%`;
      pct.textContent = `${v}%`;
    });
  } catch (err) {
    console.error('模型加载失败', err);
    document.querySelector('#ld-file').textContent = '模型加载失败，请检查 model/greenhouse_optimized.glb';
    pct.textContent = 'ERROR';
    return;
  }

  fill.style.width = '100%';
  pct.textContent = '100%';
  setTimeout(() => loading.classList.add('hide'), 320);

  // 首帧数据
  scene.updateData(model.snapshot());
  ui.update(model.snapshot(), 0);

  // 数据心跳
  let fps = 0;
  let frames = 0;
  let lastFpsAt = performance.now();

  model.onChange((snap) => {
    scene.updateData(snap);
    ui.update(snap, fps);
  });
  model.tick(1);

  setInterval(() => model.tick(TICK_MS / 1000), TICK_MS);

  // 帧率统计
  const loop = () => {
    frames++;
    const now = performance.now();
    if (now - lastFpsAt >= 1000) {
      fps = Math.round((frames * 1000) / (now - lastFpsAt));
      frames = 0;
      lastFpsAt = now;
      const el = document.querySelector('#st-fps');
      if (el) el.textContent = `${fps} FPS`;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

boot();
