/**
 * 三维孪生场景
 * - 加载 GLB，自动居中与尺寸归一
 * - 园区基座、网格环、分区传感器光柱、温度色环、漂浮粒子
 * - 相机预设平滑过渡、自动巡航、点击分区联动
 * - 标签采用 DOM 投影，保证中文清晰度与大屏可读性
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ZONES, DEVICES } from './config.js';

const DEG = Math.PI / 180;

const CAMERA_PRESETS = {
  overview: { pos: [27, 21, 35], look: [0, 3, 1] },
  greenhouse: { pos: [17, 11, 23], look: [0, 3, 0] },
  inside: { pos: [0, 2.4, 16], look: [0, 2.2, -16] },
  top: { pos: [0.5, 48, 0.5], look: [0, 0, 0] },
};

export class TwinScene {
  constructor(container, { onSelectZone } = {}) {
    this.container = container;
    this.onSelectZone = onSelectZone;
    this.labels = [];
    this.deviceMarkers = [];
    this.clock = new THREE.Clock();
    this.selectedZone = 'A1';
    this.hour = new Date().getHours() + new Date().getMinutes() / 60;
    this.camTween = null;
    this.autoRotate = true;
    this.tempColors = {};
    this._init();
  }

  /* ------------------------------ 初始化 ------------------------------ */
  _init() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    this.renderer.setSize(w, h);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.container.appendChild(this.renderer.domElement);
    this._quality = { level: 1, frames: 0, elapsed: 0 };

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#050c18');
    this.scene.fog = new THREE.FogExp2('#050c18', 0.0055);

    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 400);
    this.camera.position.set(...CAMERA_PRESETS.overview.pos);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 130;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.target.set(...CAMERA_PRESETS.overview.look);
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.45;

    this._env();
    this._lights();
    this._platform();
    this._sensorNodes();
    this._particles();
    this._labels();

    // 交互
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.renderer.domElement.addEventListener('pointerdown', (e) => this._pick(e));

    this.resize = this.resize.bind(this);
    this._ro = new ResizeObserver(this.resize);
    this._ro.observe(this.container);

    this._animate = this._animate.bind(this);
    this.renderer.setAnimationLoop(this._animate);
  }

  _env() {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 512;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#173a5c');
    g.addColorStop(0.45, '#0a1d31');
    g.addColorStop(1, '#040a12');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 512);
    const sun = ctx.createRadialGradient(700, 120, 10, 700, 120, 260);
    sun.addColorStop(0, 'rgba(255,232,190,0.85)');
    sun.addColorStop(0.4, 'rgba(120,180,220,0.18)');
    sun.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, 1024, 512);

    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    const envMap = pmrem.fromEquirectangular(tex).texture;
    this.scene.environment = envMap;
    this.envMap = envMap;
    tex.dispose();
    pmrem.dispose();
  }

  _lights() {
    this.hemi = new THREE.HemisphereLight(0xcfeaff, 0x0a1622, 0.85);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffeccc, 2.6);
    this.sun.position.set(38, 40, 24);
    this.scene.add(this.sun);

    // 冷色轮廓光，强化金属与玻璃的科技感
    const rim = new THREE.DirectionalLight(0x3ee7ff, 1.1);
    rim.position.set(-30, 18, -34);
    this.scene.add(rim);

    const fill = new THREE.DirectionalLight(0x8fd2ff, 0.35);
    fill.position.set(0, 8, 42);
    this.scene.add(fill);

    // 棚内补光：夜间点亮
    this.innerLights = ZONES.map((z) => {
      const p = new THREE.PointLight(0xffe2b8, 0, 22, 2);
      p.position.set(0, 4.6, z.z);
      this.scene.add(p);
      return p;
    });
  }

  _platform() {
    const geo = new THREE.CircleGeometry(58, 72);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x07182b,
      roughness: 0.92,
      metalness: 0.15,
      transparent: true,
      opacity: 0.96,
    });
    this.platform = new THREE.Mesh(geo, mat);
    this.platform.rotation.x = -Math.PI / 2;
    this.platform.position.y = -2.2;
    this.scene.add(this.platform);

    // 同心网格环
    const ringPts = [];
    for (let r = 10; r <= 56; r += 6) {
      const seg = 96;
      for (let i = 0; i < seg; i++) {
        const a1 = (i / seg) * Math.PI * 2;
        const a2 = ((i + 1) / seg) * Math.PI * 2;
        ringPts.push(Math.cos(a1) * r, 0, Math.sin(a1) * r, Math.cos(a2) * r, 0, Math.sin(a2) * r);
      }
    }
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ringPts.push(Math.cos(a) * 10, 0, Math.sin(a) * 10, Math.cos(a) * 56, 0, Math.sin(a) * 56);
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(ringPts, 3));
    this.grid = new THREE.LineSegments(
      gridGeo,
      new THREE.LineBasicMaterial({ color: 0x1b7fa0, transparent: true, opacity: 0.32 })
    );
    this.grid.position.y = -2.15;
    this.scene.add(this.grid);

    // 大棚投影像的底盘光圈
    const haloGeo = new THREE.RingGeometry(19.5, 23.5, 96);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x2fd2ff,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.halo = new THREE.Mesh(haloGeo, haloMat);
    this.halo.rotation.x = -Math.PI / 2;
    this.halo.scale.set(1.05, 0.82, 1);
    this.halo.position.y = -2.1;
    this.scene.add(this.halo);
  }

  _sensorNodes() {
    this.nodeGroups = ZONES.map((z, idx) => {
      // 左右交错摆放，避免四个标签在屏幕上重叠
      const xOff = idx % 2 === 0 ? -3.4 : 3.4;
      const g = new THREE.Group();
      g.position.set(xOff, -2.1, z.z);

      // 地面温度色环
      const disc = new THREE.Mesh(
        new THREE.RingGeometry(2.2, 3.4, 64),
        new THREE.MeshBasicMaterial({ color: 0x3ee7ff, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      disc.rotation.x = -Math.PI / 2;
      g.add(disc);

      const core = new THREE.Mesh(
        new THREE.CircleGeometry(2.2, 48),
        new THREE.MeshBasicMaterial({ color: 0x3ee7ff, transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      core.rotation.x = -Math.PI / 2;
      g.add(core);

      // 垂直光柱
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.5, 4.2, 16, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x6fe9ff, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      beam.position.y = 2.1;
      g.add(beam);

      // 脉冲环
      const pulse = new THREE.Mesh(
        new THREE.RingGeometry(2.9, 3.15, 64),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      pulse.rotation.x = -Math.PI / 2;
      pulse.position.y = 0.02;
      g.add(pulse);

      this.scene.add(g);
      return { zone: z, xOff, group: g, disc, core, beam, pulse, t: Math.random() * 6 };
    });

    // 设备挂点
    this.deviceMarkers = DEVICES.map((d) => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0x49f0a6, transparent: true, opacity: 0.85 })
      );
      m.position.set(d.pos.x, d.pos.y, d.pos.z);
      this.scene.add(m);
      return { device: d, mesh: m };
    });
  }

  _particles() {
    const count = 220;
    const pos = new Float32Array(count * 3);
    this.pVel = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = 12 + Math.random() * 44;
      const a = Math.random() * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.random() * 16 - 2;
      pos[i * 3 + 2] = Math.sin(a) * r;
      this.pVel[i] = 0.05 + Math.random() * 0.18;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x6fe6ff, size: 0.22, transparent: true, opacity: 0.35,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    this.points = new THREE.Points(g, mat);
    this.scene.add(this.points);
  }

  _labels() {
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'hotspot-layer';
    this.container.appendChild(this.labelLayer);

    this.labels = ZONES.map((z, idx) => {
      const el = document.createElement('div');
      el.className = 'hotspot';
      el.innerHTML = `
        <div class="hs-row">
          <span class="hs-id" style="--c:${z.color}">${z.id}</span>
          <span class="hs-val" data-f="temp">--</span>
        </div>
        <div class="hs-sub"><span data-f="hum">--</span> · <span data-f="co2">--</span></div>
        <div class="hs-line"></div>`;
      el.addEventListener('click', () => this.selectZone(z.id, true));
      this.labelLayer.appendChild(el);
      const xOff = idx % 2 === 0 ? -3.4 : 3.4;
      return { el, pos: new THREE.Vector3(xOff, 4.4, z.z), zone: z };
    });
  }

  /* ------------------------------ 模型 ------------------------------ */
  async loadModel(url, onProgress) {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url, (e) => {
      if (onProgress && e.total) onProgress(e.loaded / e.total);
    });

    const root = gltf.scene;
    this.model = root;

    // 材质修正：玻璃、双面植被、贴图各向异性
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false;
      o.receiveShadow = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m, i) => {
        if (!m) return;
        const name = (m.name || '').toLowerCase();
        const isGlass = name.includes('glass');
        if (isGlass) {
          const gm = new THREE.MeshPhysicalMaterial({
            color: 0xcdeeff,
            metalness: 0,
            roughness: 0.06,
            transparent: true,
            opacity: 0.20,
            side: THREE.DoubleSide,
            depthWrite: false,
            envMapIntensity: 1.1,
            clearcoat: 1,
            clearcoatRoughness: 0.1,
          });
          if (Array.isArray(o.material)) o.material[i] = gm;
          else o.material = gm;
          o.renderOrder = 3;
        } else {
          if (m.map) m.map.anisotropy = maxAniso;
          if (m.normalMap) m.normalMap.anisotropy = maxAniso;
          m.envMapIntensity = 0.75;
          if (m.transparent && m.alphaTest === 0) m.alphaTest = 0.35;
        }
      });
      o.frustumCulled = true;
    });

    // 尺寸归一：把模型底部落在 y=0，水平居中
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    root.position.x -= center.x;
    root.position.z -= center.z;
    root.position.y -= box.min.y;

    this.modelBox = new THREE.Box3().setFromObject(root);
    this.modelSize = this.modelBox.getSize(new THREE.Vector3());
    this.scene.add(root);
    this.grid.position.y = box.min.y - 0.05;
    this.platform.position.y = box.min.y - 0.25;
    this.halo.position.y = box.min.y - 0.18;
    this.nodeGroups.forEach((n) => { n.group.position.y = box.min.y + 0.05; });

    // 依据实际尺寸微调相机预设
    this._fitPresets();
    return root;
  }

  _fitPresets() {
    // 取大棚主体（而非整个园区）作为构图基准，避免被周围树木拉远
    const gw = this.model.getObjectByName('GreenHouseStructure');
    const box = new THREE.Box3();
    if (gw) box.setFromObject(gw);
    else box.copy(this.modelBox);

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const len = Math.max(size.z, size.x);
    const h = size.y;
    const dist = len * 1.35;

    CAMERA_PRESETS.overview.pos = [center.x + dist * 0.62, center.y + h * 3.2, center.z + dist * 0.95];
    CAMERA_PRESETS.overview.look = [center.x, center.y + h * 0.4, center.z];
    CAMERA_PRESETS.greenhouse.pos = [center.x + dist * 0.45, center.y + h * 1.8, center.z + dist * 0.6];
    CAMERA_PRESETS.greenhouse.look = [center.x, center.y + h * 0.5, center.z];
    CAMERA_PRESETS.inside.pos = [center.x, center.y + h * 0.42, center.z + len * 0.36];
    CAMERA_PRESETS.inside.look = [center.x, center.y + h * 0.4, center.z - len * 0.62];
    CAMERA_PRESETS.top.pos = [center.x + 0.6, center.y + len * 1.7, center.z + 0.6];
    CAMERA_PRESETS.top.look = [center.x, 0, center.z];

    this.controls.target.set(...CAMERA_PRESETS.overview.look);
    this.camera.position.set(...CAMERA_PRESETS.overview.pos);
  }

  /* ------------------------------ 交互 ------------------------------ */
  setCamera(name) {
    const p = CAMERA_PRESETS[name];
    if (!p) return;
    this.camTween = {
      from: {
        pos: this.camera.position.clone(),
        look: this.controls.target.clone(),
      },
      to: { pos: new THREE.Vector3(...p.pos), look: new THREE.Vector3(...p.look) },
      t: 0,
    };
  }

  setAutoRotate(on) {
    this.autoRotate = on;
    this.controls.autoRotate = on;
  }

  selectZone(id, fromScene = false) {
    this.selectedZone = id;
    this.nodeGroups.forEach((n) => {
      const on = n.zone.id === id;
      n.disc.material.opacity = on ? 0.55 : 0.26;
      n.core.material.opacity = on ? 0.16 : 0.07;
      n.pulse.material.opacity = on ? 0.75 : 0.35;
    });
    this.labels.forEach((l) => l.el.classList.toggle('active', l.zone.id === id));
    if (fromScene && this.onSelectZone) this.onSelectZone(id);
  }

  setHour(hour) {
    this.hour = hour;
  }

  _pick(e) {
    if (!this.model) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.model, true)[0];
    if (!hit) return;
    let best = null;
    let bestD = Infinity;
    ZONES.forEach((z) => {
      const d = Math.abs(hit.point.z - z.z);
      if (d < bestD) { bestD = d; best = z; }
    });
    if (best) this.selectZone(best.id, true);
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /* ------------------------------ 帧循环 ------------------------------ */
  _animate() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;

    // 相机过渡
    if (this.camTween) {
      this.camTween.t = Math.min(1, this.camTween.t + dt * 0.9);
      const k = 1 - Math.pow(1 - this.camTween.t, 3);
      this.camera.position.lerpVectors(this.camTween.from.pos, this.camTween.to.pos, k);
      this.controls.target.lerpVectors(this.camTween.from.look, this.camTween.to.look, k);
      if (this.camTween.t >= 1) this.camTween = null;
    }

    // 传感器脉冲
    this.nodeGroups.forEach((n, i) => {
      n.t += dt;
      const s = 1 + (n.t % 2) * 0.32;
      n.pulse.scale.set(s, s, s);
      n.pulse.material.opacity = Math.max(0, 0.6 - (n.t % 2) * 0.28);
      n.disc.rotation.z += dt * 0.15 * (i % 2 ? 1 : -1);
    });

    // 粒子
    if (this.points) {
      const arr = this.points.geometry.attributes.position.array;
      for (let i = 0; i < arr.length / 3; i++) {
        arr[i * 3 + 1] += this.pVel[i] * dt * 3;
        if (arr[i * 3 + 1] > 18) arr[i * 3 + 1] = -2;
      }
      this.points.geometry.attributes.position.needsUpdate = true;
    }

    // 昼夜光照
    const sunEl = Math.sin(((this.hour - 6) / 12) * Math.PI);
    const day = sunEl > 0;
    const angle = ((this.hour - 6) / 12) * Math.PI;
    this.sun.position.set(Math.cos(angle) * 60, Math.max(4, sunEl * 55), 30);
    this.sun.intensity = day ? 1.6 + sunEl * 1.6 : 0.25;
    this.sun.color.setHSL(0.09, 0.5, day ? 0.72 - sunEl * 0.08 : 0.45);
    this.hemi.intensity = day ? 0.75 : 0.3;
    this.scene.background.set(day ? '#0a1826' : '#04070f');
    this.scene.fog.color.set(day ? '#0a1826' : '#04070f');
    this.innerLights.forEach((l) => {
      l.intensity = day ? 0.7 : 2.6;
    });

    // 帧率自适应：低于 26 FPS 时降像素比，保证大屏流畅
    const q = this._quality;
    q.frames++;
    q.elapsed += dt;
    if (q.elapsed >= 3) {
      const fps = q.frames / q.elapsed;
      if (fps < 26 && q.level > 0) {
        q.level = 0;
        this.renderer.setPixelRatio(1.0);
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
      } else if (fps > 55 && q.level === 0) {
        q.level = 1;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
      }
      q.frames = 0;
      q.elapsed = 0;
    }

    // 标签投影 + 屏幕空间避让，避免四个分区标签互相压盖
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const placed = [];
    const projected = this.labels.map((l) => {
      const p = l.pos.clone().project(this.camera);
      return {
        l,
        sx: (p.x * 0.5 + 0.5) * w,
        sy: (-p.y * 0.5 + 0.5) * h,
        visible: p.z < 1 && Math.abs(p.x) < 1.15 && Math.abs(p.y) < 1.15,
      };
    }).sort((a, b) => a.sy - b.sy);

    projected.forEach((it) => {
      let y = it.sy;
      for (const q of placed) {
        if (Math.abs(it.sx - q.x) < 104 && Math.abs(y - q.y) < 46) y = q.y - 46;
      }
      y = Math.max(56, Math.min(h - 24, y));
      placed.push({ x: it.sx, y });
      it.l.el.style.opacity = it.visible ? '1' : '0';
      it.l.el.style.transform = `translate(-50%,-100%) translate(${it.sx.toFixed(1)}px, ${y.toFixed(1)}px)`;
    });

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /* ------------------------------ 数据驱动 ------------------------------ */
  updateData(snap) {
    const z = snap.selected;
    this.labels.forEach((l) => {
      const zone = snap.zones.find((x) => x.id === l.zone.id);
      if (!zone) return;
      const st = zone.state;
      l.el.querySelector('[data-f="temp"]').textContent = `${st.airTemp.toFixed(1)}℃`;
      l.el.querySelector('[data-f="hum"]').textContent = `${Math.round(st.airHum)}%RH`;
      l.el.querySelector('[data-f="co2"]').textContent = `${Math.round(st.co2)}ppm`;
      l.el.classList.toggle('active', zone.id === snap.selectedZone);
    });

    // 温度色环：16~32℃ 蓝→青→黄→红
    snap.zones.forEach((zone) => {
      const node = this.nodeGroups.find((n) => n.zone.id === zone.id);
      if (!node) return;
      const c = tempColor(zone.state.airTemp);
      node.disc.material.color.copy(c);
      node.core.material.color.copy(c);
      node.beam?.material.color.copy(c);
      node.group.children.forEach((ch) => { if (ch.material && ch.material.color && ch !== node.pulse) ch.material.color.copy(c); });
    });

    // 设备运行状态发光
    this.deviceMarkers.forEach((dm) => {
      const d = snap.devices.find((x) => x.id === dm.device.id);
      if (!d) return;
      dm.mesh.material.color.set(d.on ? '#49f0a6' : '#35506a');
      dm.mesh.material.opacity = d.on ? 0.95 : 0.4;
    });

    this.deviceMarkers.forEach((dm) => {
      const d = snap.devices.find((x) => x.id === dm.device.id);
      if (d) dm.device.on = d.on;
    });

    this.setHour((snap.now ? new Date(snap.now) : new Date()).getHours() + new Date(snap.now || Date.now()).getMinutes() / 60);
    this.selectedZone = snap.selectedZone;
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this._ro?.disconnect();
    this.renderer.dispose();
  }
}

/** 温度 → 颜色（冷蓝到热红） */
export function tempColor(t) {
  const stops = [
    [14, new THREE.Color('#2f7bff')],
    [20, new THREE.Color('#3ee7ff')],
    [25, new THREE.Color('#49f0a6')],
    [29, new THREE.Color('#ffbe4d')],
    [33, new THREE.Color('#ff5f6d')],
  ];
  if (t <= stops[0][0]) return stops[0][1].clone();
  if (t >= stops[stops.length - 1][0]) return stops[stops.length - 1][1].clone();
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (t >= t0 && t <= t1) {
      return c0.clone().lerp(c1, (t - t0) / (t1 - t0));
    }
  }
  return stops[0][1].clone();
}
