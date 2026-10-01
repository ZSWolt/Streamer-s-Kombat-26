import * as THREE from 'three';
import * as T from './textures';

export interface StageDef { id: string; he: string; en: string; accent: string; music: string }

export const STAGES: StageDef[] = [
  { id: 'kick', he: 'סטודיו קיק', en: 'KICK STUDIO', accent: '#53fc18', music: 'kick' },
  { id: 'bedroom', he: 'חדר הסטרימר', en: "STREAMER'S ROOM", accent: '#c04dff', music: 'bedroom' },
  { id: 'rooftop', he: 'גג בתל אביב', en: 'TLV ROOFTOP', accent: '#ffb347', music: 'rooftop' },
  { id: 'arena', he: 'זירת אי-ספורט', en: 'ESPORTS ARENA', accent: '#2fd0ff', music: 'arena' },
  { id: 'redstudio', he: 'הסטודיו האדום', en: 'RED STUDIO', accent: '#ff2a2a', music: 'red' },
  { id: 'servers', he: 'חדר השרתים', en: 'SERVER ROOM', accent: '#9d4dff', music: 'servers' },
];

export interface StageScene {
  group: THREE.Group;
  update(t: number, dt: number): void;
  fog: THREE.Fog;
  bg: THREE.Color;
  exposure: number;
  keyLight: THREE.DirectionalLight;
  pulse(intensity: number): void;
}

function std(color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...o });
}

function box(w: number, h: number, d: number, m: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function neonBar(len: number, color: string, thick = 0.05, vertical = false) {
  const m = new THREE.MeshBasicMaterial({ color });
  (m.color as THREE.Color).multiplyScalar(2.2);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(vertical ? thick : len, vertical ? len : thick, thick), m);
  return mesh;
}

function glowSprite(color: string, size: number) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.radialGlow(color), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.set(size, size, 1);
  return s;
}

function floor(tex: THREE.Texture, o: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.1, ...o });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(40, 14), m);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.z = -2;
  mesh.receiveShadow = true;
  return mesh;
}

function backdrop(tex: THREE.Texture, w: number, h: number, z: number, y = h / 2, basic = true) {
  const m = basic ? new THREE.MeshBasicMaterial({ map: tex, fog: false }) : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  mesh.position.set(0, y, z);
  return mesh;
}

function baseLights(group: THREE.Group, key: string, rimA: string, rimB: string, amb: number) {
  const hemi = new THREE.HemisphereLight('#ffffff', '#202030', amb);
  group.add(hemi);
  const keyL = new THREE.DirectionalLight(key, 2.4);
  keyL.position.set(-3, 7, 8);
  keyL.castShadow = true;
  keyL.shadow.mapSize.set(2048, 2048);
  keyL.shadow.camera.left = -9; keyL.shadow.camera.right = 9; keyL.shadow.camera.top = 6; keyL.shadow.camera.bottom = -2;
  keyL.shadow.bias = -0.0004;
  keyL.shadow.normalBias = 0.02;
  group.add(keyL);
  const r1 = new THREE.DirectionalLight(rimA, 2.2);
  r1.position.set(-8, 3, -6);
  group.add(r1);
  const r2 = new THREE.DirectionalLight(rimB, 2.2);
  r2.position.set(8, 3, -6);
  group.add(r2);
  return keyL;
}

function monitorDesk(x: number, z: number, screenColor: string, flip = 1) {
  const g = new THREE.Group();
  const desk = box(2.2, 0.08, 0.9, std('#15151b', { roughness: 0.4 }));
  desk.position.y = 0.78;
  g.add(desk);
  for (const lx of [-1, 1]) {
    const leg = box(0.06, 0.78, 0.8, std('#0e0e12'));
    leg.position.set(lx * 1.0, 0.39, 0);
    g.add(leg);
  }
  for (let i = 0; i < 2; i++) {
    const scr = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.52, 0.04), std('#0a0a0a'));
    scr.position.set(-0.48 + i * 0.96, 1.2, -0.2);
    scr.rotation.y = (i === 0 ? 0.18 : -0.18);
    g.add(scr);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.46), new THREE.MeshBasicMaterial({ color: new THREE.Color(screenColor).multiplyScalar(1.4) }));
    glow.position.set(-0.48 + i * 0.96, 1.2, -0.175);
    glow.rotation.y = scr.rotation.y;
    g.add(glow);
  }
  const chair = new THREE.Group();
  const seat = box(0.6, 0.12, 0.6, std('#141414', { roughness: 0.5 }));
  seat.position.y = 0.5;
  chair.add(seat);
  const back = box(0.6, 0.95, 0.12, std(screenColor, { roughness: 0.5, emissive: new THREE.Color(screenColor), emissiveIntensity: 0.08 }));
  back.position.set(0, 1.05, 0.3);
  chair.add(back);
  chair.position.set(0, 0, 0.8);
  g.add(chair);
  g.position.set(x, 0, z);
  g.rotation.y = 0.25 * flip;
  return g;
}

function ringLight(color: string) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.04, 12, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2) }));
  ring.position.y = 1.9;
  g.add(ring);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.9), std('#111'));
  pole.position.y = 0.95;
  g.add(pole);
  const glow = glowSprite('rgba(255,255,255,0.6)', 1.8);
  glow.position.y = 1.9;
  g.add(glow);
  return g;
}

export function buildStage(idx: number): StageScene {
  const group = new THREE.Group();
  let fogColor = '#050507';
  let bg = '#050507';
  let exposure = 1.0;
  const updaters: ((t: number, dt: number) => void)[] = [];
  const pulsers: { l: THREE.Light; base: number }[] = [];
  let keyLight: THREE.DirectionalLight;

  switch (STAGES[idx]?.id ?? 'kick') {
    case 'kick': {
      bg = fogColor = '#020604';
      keyLight = baseLights(group, '#f4fff0', '#53fc18', '#2dff9a', 0.35);
      group.add(floor(T.neonGrid('#050a06', '#1d7a0a'), { roughness: 0.25, metalness: 0.5 }));
      const wall = backdrop(T.canvasTex(2048, 1024, (g, w, h) => {
        const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#020402'); grd.addColorStop(1, '#0a1a08');
        g.fillStyle = grd; g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(83,252,24,0.12)'; g.lineWidth = 2;
        for (let x = 0; x < w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      }), 40, 14, -9, 6);
      group.add(wall);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.2), new THREE.MeshBasicMaterial({ map: T.screenTex('STREAM KOMBAT', '● LIVE ON KICK', '#0b2a05', '#ffffff', '#53fc18'), fog: false }));
      screen.position.set(0, 4.2, -8.8);
      group.add(screen);
      const frame = neonBar(9.3, '#53fc18', 0.08); frame.position.set(0, 6.4, -8.75); group.add(frame);
      const frame2 = neonBar(9.3, '#53fc18', 0.08); frame2.position.set(0, 2.0, -8.75); group.add(frame2);
      for (const s of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const bar = neonBar(6, '#53fc18', 0.06, true);
          bar.position.set(s * (6.5 + i * 2.2), 3, -8.7 + i * 0.4);
          group.add(bar);
        }
        group.add(monitorDesk(s * 6.4, -4.2, '#1f6f0c', -s));
        const rl = ringLight('#e8ffe0'); rl.position.set(s * 4.2, 0, -5); group.add(rl);
        const pl = new THREE.PointLight('#53fc18', 18, 12, 1.6);
        pl.position.set(s * 5, 3, -4);
        group.add(pl);
        pulsers.push({ l: pl, base: 18 });
      }
      const logo = new THREE.Mesh(new THREE.CircleGeometry(2.4, 48), new THREE.MeshBasicMaterial({ map: T.canvasTex(512, 512, (g, w, h) => {
        g.strokeStyle = '#53fc18'; g.lineWidth = 16; g.shadowColor = '#53fc18'; g.shadowBlur = 20;
        g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 20, 0, Math.PI * 2); g.stroke();
        g.fillStyle = 'rgba(83,252,24,0.35)'; g.font = '900 260px "Bebas Neue", Impact'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('K', w / 2, h / 2 + 10);
      }), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      logo.rotation.x = -Math.PI / 2; logo.position.set(0, 0.01, 0.4);
      group.add(logo);
      break;
    }
    case 'bedroom': {
      bg = fogColor = '#0a0610';
      exposure = 1.05;
      keyLight = baseLights(group, '#ffe6f6', '#c04dff', '#ff4dbb', 0.45);
      group.add(floor(T.planks('#6b4a32', '#3a2616'), { roughness: 0.6 }));
      const wall = backdrop(T.canvasTex(2048, 1024, (g, w, h) => {
        g.fillStyle = '#1a1024'; g.fillRect(0, 0, w, h);
        const grd = g.createLinearGradient(0, 0, w, 0);
        grd.addColorStop(0, 'rgba(192,77,255,0.35)'); grd.addColorStop(0.5, 'rgba(255,77,187,0.18)'); grd.addColorStop(1, 'rgba(77,160,255,0.35)');
        g.fillStyle = grd; g.fillRect(0, 0, w, h);
      }), 30, 10, -6, 5, false);
      group.add(wall);
      const led = neonBar(22, '#d24dff', 0.06); led.position.set(0, 3.6, -5.9); group.add(led);
      const led2 = neonBar(22, '#ff4dbb', 0.05); led2.position.set(0, 0.25, -5.9); group.add(led2);
      // window with night city
      const win = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.4), new THREE.MeshBasicMaterial({ map: T.skyline(12, ['#0b1030', '#241245'], '#ffd27a', true), fog: false }));
      win.position.set(-4.5, 2.4, -5.95); group.add(win);
      const wf = box(4.2, 0.1, 0.1, std('#e8e0d8')); wf.position.set(-4.5, 1.15, -5.9); group.add(wf);
      const wf2 = wf.clone(); wf2.position.y = 3.65; group.add(wf2);
      // bed
      const bed = new THREE.Group();
      const base = box(2.2, 0.45, 1.6, std('#2a2a33')); base.position.y = 0.22; bed.add(base);
      const mattress = box(2.1, 0.25, 1.5, std('#e9e6f0', { roughness: 0.9 })); mattress.position.y = 0.55; bed.add(mattress);
      const blanket = box(1.5, 0.12, 1.55, std('#6c3bd1', { roughness: 0.95 })); blanket.position.set(0.3, 0.72, 0); bed.add(blanket);
      const pillow = box(0.5, 0.18, 1.1, std('#fff')); pillow.position.set(-0.8, 0.78, 0); bed.add(pillow);
      bed.position.set(6.5, 0, -4.5); bed.rotation.y = -0.2; group.add(bed);
      group.add(monitorDesk(-6.2, -4.3, '#6f2bd9', 1));
      // posters
      const posters = [['GG', '#c04dff'], ['LIVE', '#ff2a6d'], ['KICK', '#53fc18'], ['PWN', '#2fd0ff']];
      posters.forEach(([t, c], i) => {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.25), new THREE.MeshStandardMaterial({ map: T.posterTex(t, c), roughness: 0.8 }));
        p.position.set(-1.2 + i * 1.2, 2.3, -5.95); group.add(p);
      });
      const shelf = box(3, 0.06, 0.3, std('#f0f0f0')); shelf.position.set(3.5, 2.6, -5.8); group.add(shelf);
      for (let i = 0; i < 6; i++) {
        const fig = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.12, 4, 8), std(['#ff4d4d', '#4dff88', '#4db8ff', '#ffd84d', '#c04dff', '#ffffff'][i]));
        fig.position.set(2.3 + i * 0.45, 2.78, -5.75); group.add(fig);
      }
      for (const [x, c] of [[-3, '#c04dff'], [3, '#ff4dbb']] as [number, string][]) {
        const pl = new THREE.PointLight(c, 14, 10, 1.6); pl.position.set(x, 3, -3.5); group.add(pl); pulsers.push({ l: pl, base: 14 });
      }
      break;
    }
    case 'rooftop': {
      bg = fogColor = '#0d0f22';
      keyLight = baseLights(group, '#dfe6ff', '#ffb347', '#6f7cff', 0.5);
      keyLight.intensity = 2.0;
      group.add(floor(T.concrete('#4a4a52'), { roughness: 0.35, metalness: 0.15 }));
      const sky = backdrop(T.skyline(33, ['#0a0d25', '#3b2350'], '#ffcf7a', true), 70, 26, -22, 9);
      group.add(sky);
      const rail = new THREE.Group();
      for (let x = -14; x <= 14; x += 1.2) { const p = box(0.06, 1.1, 0.06, std('#9aa0aa', { metalness: 0.7, roughness: 0.3 })); p.position.set(x, 0.55, -6); rail.add(p); }
      const top = box(28, 0.07, 0.07, std('#b8bec8', { metalness: 0.8, roughness: 0.25 })); top.position.set(0, 1.1, -6); rail.add(top);
      group.add(rail);
      // Israeli solar water heaters
      for (const x of [-7.5, -5.5, 5.8, 8]) {
        const dud = new THREE.Group();
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.3, 20), std('#d9dde2', { metalness: 0.4, roughness: 0.35 }));
        tank.rotation.z = Math.PI / 2; tank.position.y = 1.35; dud.add(tank);
        const panel = box(1.6, 0.05, 1.1, std('#1b2a4a', { metalness: 0.6, roughness: 0.2 })); panel.position.set(0, 0.7, 0.6); panel.rotation.x = -0.6; dud.add(panel);
        const legs = box(1.4, 1.0, 0.05, std('#777')); legs.position.set(0, 0.5, 0); dud.add(legs);
        dud.position.set(x, 0, -4.2); dud.rotation.y = 0.1 * x; group.add(dud);
      }
      for (const x of [-3.5, 3.2]) { const ac = box(0.9, 0.7, 0.5, std('#c8ccd2')); ac.position.set(x, 0.35, -5.2); group.add(ac); }
      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 4), std('#888')); antenna.position.set(10, 2, -7); group.add(antenna);
      const blink = glowSprite('rgba(255,50,80,0.9)', 0.8); blink.position.set(10, 4.05, -7); group.add(blink);
      updaters.push((t) => { blink.material.opacity = Math.sin(t * 3) > 0 ? 1 : 0.1; });
      const warm = new THREE.PointLight('#ffb347', 10, 9, 1.8); warm.position.set(-5, 2.5, -3); group.add(warm); pulsers.push({ l: warm, base: 10 });
      break;
    }
    case 'arena': {
      bg = fogColor = '#020409';
      exposure = 1.1;
      keyLight = baseLights(group, '#eaf6ff', '#2fd0ff', '#ff3cac', 0.3);
      group.add(floor(T.canvasTex(1024, 1024, (g, w, h) => {
        g.fillStyle = '#0a0d14'; g.fillRect(0, 0, w, h);
        g.strokeStyle = '#2fd0ff'; g.lineWidth = 6; g.shadowColor = '#2fd0ff'; g.shadowBlur = 20;
        g.beginPath(); g.arc(w / 2, h / 2, 300, 0, Math.PI * 2); g.stroke();
        g.fillStyle = 'rgba(47,208,255,0.15)'; g.font = '900 140px "Bebas Neue", Impact'; g.textAlign = 'center'; g.fillText('SK26', w / 2, h / 2 + 50);
      }), { roughness: 0.18, metalness: 0.4 }));
      const crowdM = new THREE.Mesh(new THREE.PlaneGeometry(40, 10), new THREE.MeshBasicMaterial({ map: T.crowd(5, '#2fd0ff'), fog: false }));
      crowdM.position.set(0, 3.5, -14);
      group.add(crowdM);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(12, 5), new THREE.MeshBasicMaterial({ map: T.screenTex('GRAND FINAL', 'STREAM KOMBAT 26', '#001a2a', '#ffffff', '#2fd0ff') }));
      scr.position.set(0, 7.5, -12); group.add(scr);
      for (const s of [-1, 1]) {
        const side = new THREE.Mesh(new THREE.PlaneGeometry(5, 3), new THREE.MeshBasicMaterial({ map: T.screenTex(s < 0 ? 'P1' : 'P2', '● LIVE', '#1a0014', '#ffffff', s < 0 ? '#2fd0ff' : '#ff3cac') }));
        side.position.set(s * 10, 5, -11); side.rotation.y = -s * 0.3; group.add(side);
      }
      const stage = box(22, 0.25, 8, std('#10131c', { roughness: 0.2, metalness: 0.6 })); stage.position.set(0, -0.125, -2); group.add(stage);
      const edge = neonBar(22, '#2fd0ff', 0.05); edge.position.set(0, 0.01, 2.02); group.add(edge);
      // moving spotlights
      for (let i = 0; i < 4; i++) {
        const sp = new THREE.SpotLight(i % 2 ? '#ff3cac' : '#2fd0ff', 60, 30, 0.35, 0.5, 1.2);
        sp.position.set(-9 + i * 6, 12, -3);
        sp.target.position.set(0, 0, 0);
        group.add(sp, sp.target);
        updaters.push((t) => { sp.target.position.set(Math.sin(t * 0.7 + i) * 6, 0, Math.cos(t * 0.5 + i) * 2); });
        const beam = new THREE.Mesh(new THREE.ConeGeometry(1.8, 12, 24, 1, true), new THREE.MeshBasicMaterial({ color: i % 2 ? '#ff3cac' : '#2fd0ff', transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        beam.position.copy(sp.position).add(new THREE.Vector3(0, -6, 0));
        group.add(beam);
        updaters.push((t) => { beam.rotation.z = Math.sin(t * 0.7 + i) * 0.4; beam.rotation.x = Math.cos(t * 0.5 + i) * 0.15; });
      }
      // braziers with fire glow
      for (const s of [-1, 1]) {
        const br = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.3, 0.5, 16), std('#2a2a2a', { metalness: 0.8, roughness: 0.3 }));
        br.position.set(s * 8.5, 1.3, -3); group.add(br);
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 1.1), std('#1a1a1a')); leg.position.set(s * 8.5, 0.55, -3); group.add(leg);
        const fire = glowSprite('rgba(255,140,40,0.95)', 2.4); fire.position.set(s * 8.5, 1.9, -3); group.add(fire);
        const fl = new THREE.PointLight('#ff8a2a', 16, 9, 1.8); fl.position.set(s * 8.5, 2.2, -3); group.add(fl);
        updaters.push((t) => { const k = 0.85 + Math.sin(t * 17 + s) * 0.08 + Math.sin(t * 7.3) * 0.07; fire.scale.set(2.4 * k, 2.7 * k, 1); fl.intensity = 16 * k; });
      }
      break;
    }
    case 'redstudio': {
      bg = fogColor = '#0d0203';
      keyLight = baseLights(group, '#fff0ee', '#ff2a2a', '#ff7a5a', 0.45);
      group.add(floor(T.canvasTex(1024, 1024, (g, w, h) => {
        g.fillStyle = '#1a0a0b'; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) { if ((i + j) % 2) { g.fillStyle = '#220d0f'; g.fillRect(i * 64, j * 64, 64, 64); } }
      }, [3, 2]), { roughness: 0.3, metalness: 0.2 }));
      const wall = backdrop(T.canvasTex(1024, 512, (g, w, h) => {
        const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#4a0508'); grd.addColorStop(1, '#1a0203');
        g.fillStyle = grd; g.fillRect(0, 0, w, h);
        g.fillStyle = 'rgba(255,255,255,0.03)'; for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 14, h);
      }), 34, 12, -7, 6, false);
      group.add(wall);
      const kinds: ('silver' | 'gold' | 'diamond')[] = ['silver', 'gold', 'diamond', 'gold', 'silver'];
      const names = ['YOUTUBE', 'INDE GAME', 'STREAM KOMBAT', 'INDE GAME', 'YOUTUBE'];
      kinds.forEach((k, i) => {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.75), new THREE.MeshStandardMaterial({ map: T.plaque(k, names[i]), metalness: 0.6, roughness: 0.25 }));
        p.position.set(-5.6 + i * 2.8, 3.3, -6.95); group.add(p);
        const spot = new THREE.SpotLight('#fff2e0', 12, 6, 0.5, 0.6, 1.5);
        spot.position.set(-5.6 + i * 2.8, 5.5, -5.5); spot.target = p; group.add(spot);
      });
      const play = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.2), new THREE.MeshBasicMaterial({ map: T.canvasTex(512, 352, (g, w, h) => {
        g.fillStyle = '#ff0000'; T.roundRect(g, 10, 10, w - 20, h - 20, 80); g.fill();
        g.fillStyle = '#fff'; g.beginPath(); g.moveTo(w * 0.4, h * 0.3); g.lineTo(w * 0.66, h * 0.5); g.lineTo(w * 0.4, h * 0.7); g.closePath(); g.fill();
      }), transparent: true }));
      play.position.set(0, 6.3, -6.9); group.add(play);
      for (const s of [-1, 1]) {
        const rl = ringLight('#fff4f0'); rl.position.set(s * 4.8, 0, -4.5); group.add(rl);
        const cam = new THREE.Group();
        const body = box(0.5, 0.35, 0.3, std('#111')); body.position.y = 1.5; cam.add(body);
        const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.3, 16), std('#050505', { roughness: 0.2 })); lens.rotation.x = Math.PI / 2; lens.position.set(0, 1.5, 0.28); cam.add(lens);
        const tri = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.4, 3, 1, true), std('#222', { wireframe: true })); tri.position.y = 0.7; cam.add(tri);
        const rec = glowSprite('rgba(255,0,0,0.9)', 0.25); rec.position.set(0.18, 1.72, 0.1); cam.add(rec);
        updaters.push((t) => { rec.material.opacity = Math.sin(t * 4) > 0 ? 1 : 0.2; });
        cam.position.set(s * 7.5, 0, -2.5); cam.rotation.y = s * 0.8; group.add(cam);
        const pl = new THREE.PointLight('#ff2a2a', 14, 10, 1.6); pl.position.set(s * 6, 3, -4); group.add(pl); pulsers.push({ l: pl, base: 14 });
      }
      const sofa = new THREE.Group();
      const seat = box(3, 0.45, 1, std('#2b0c10', { roughness: 0.9 })); seat.position.y = 0.3; sofa.add(seat);
      const back = box(3, 0.8, 0.3, std('#2b0c10', { roughness: 0.9 })); back.position.set(0, 0.8, -0.4); sofa.add(back);
      sofa.position.set(-8.5, 0, -5); group.add(sofa);
      break;
    }
    case 'servers':
    default: {
      bg = fogColor = '#07030d';
      keyLight = baseLights(group, '#efe6ff', '#9d4dff', '#39ff88', 0.3);
      group.add(floor(T.canvasTex(1024, 1024, (g, w, h) => {
        g.fillStyle = '#0d0b14'; g.fillRect(0, 0, w, h);
        g.strokeStyle = '#1e1a2c'; g.lineWidth = 4;
        for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, h); g.stroke(); g.beginPath(); g.moveTo(0, i * 128); g.lineTo(w, i * 128); g.stroke(); }
        for (let i = 0; i < 64; i++) { g.fillStyle = 'rgba(157,77,255,0.08)'; g.fillRect((i % 8) * 128 + 50, Math.floor(i / 8) * 128 + 50, 28, 28); }
      }, [4, 2]), { roughness: 0.3, metalness: 0.5 }));
      const rackM = new THREE.MeshStandardMaterial({ map: T.rackTex(), roughness: 0.4, metalness: 0.6, emissiveMap: T.rackTex(), emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.8 });
      for (let row = 0; row < 2; row++) {
        for (let i = -6; i <= 6; i++) {
          if (row === 0 && Math.abs(i) < 1) continue;
          const r = box(0.9, 3.2, 1.0, [std('#0a0a10'), std('#0a0a10'), std('#0a0a10'), std('#0a0a10'), rackM, std('#0a0a10')] as unknown as THREE.Material);
          r.position.set(i * 1.1, 1.6, -5 - row * 3);
          group.add(r);
        }
      }
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.2), new THREE.MeshBasicMaterial({ map: T.screenTex('RAID', '▲ 999 VIEWERS INCOMING', '#1a0033', '#ffffff', '#9d4dff'), transparent: true }));
      sign.position.set(0, 4.3, -4.6); group.add(sign);
      for (const s of [-1, 1]) {
        const haz = new THREE.PointLight('#ff3355', 0, 10, 1.6); haz.position.set(s * 6, 4, -3); group.add(haz);
        updaters.push((t) => { haz.intensity = Math.max(0, Math.sin(t * 5 + s)) * 22; });
        const pl = new THREE.PointLight('#9d4dff', 16, 11, 1.6); pl.position.set(s * 3, 3.2, -2.5); group.add(pl); pulsers.push({ l: pl, base: 16 });
      }
      for (let i = 0; i < 10; i++) {
        const cable = new THREE.Mesh(new THREE.TorusGeometry(0.8 + (i % 3) * 0.3, 0.025, 6, 24, Math.PI), std(['#39ff88', '#9d4dff', '#ffd23f'][i % 3]));
        cable.position.set(-8 + i * 1.8, 3.5, -4.4); cable.rotation.z = Math.PI; group.add(cable);
      }
      break;
    }
  }

  const fog = new THREE.Fog(fogColor, 14, 42);
  let pulse = 0;
  return {
    group, fog, bg: new THREE.Color(bg), exposure, keyLight: keyLight!,
    update(t, dt) {
      for (const u of updaters) u(t, dt);
      pulse = Math.max(0, pulse - dt * 3);
      for (const p of pulsers) p.l.intensity = p.base * (1 + pulse * 1.5);
    },
    pulse(i) { pulse = Math.min(1.5, pulse + i); },
  };
}
