import * as THREE from 'three';
import { canvasTex } from './textures';

// 3D props thrown by special moves. Each builder returns a group about 1 unit tall/wide that the caller scales.
// Geometry and textures are cached and shared; callers must not dispose them.

const loader = new THREE.TextureLoader();
const texCache = new Map<string, THREE.Texture>();
function tex(url: string): THREE.Texture {
  let t = texCache.get(url);
  if (!t) {
    t = loader.load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    texCache.set(url, t);
  }
  return t;
}
const geoCache = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) { g = make(); g.dispose = () => {}; geoCache.set(key, g); }
  return g;
}
const matCache = new Map<string, THREE.Material>();
function mat(key: string, make: () => THREE.Material): THREE.Material {
  let m = matCache.get(key);
  if (!m) { m = make(); m.dispose = () => {}; matCache.set(key, m); }
  return m;
}

/** Fetch prop textures up front so the first throw is not invisible while its art downloads. */
export function preloadProps() {
  tex('assets/props/concards_front.webp');
  tex('assets/props/concards_back.webp');
}

/** One face of a sealed foil pack: flat crimped ends, pillowed in the middle where the cards sit. */
function packFace(): THREE.BufferGeometry {
  const w = 0.66, h = 1, bulge = 0.055, crimp = 0.085;
  const g = new THREE.PlaneGeometry(w, h, 10, 20);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / (w / 2), y = pos.getY(i) / (h / 2);
    const body = Math.max(0, 1 - Math.abs(y) / (1 - crimp * 2)); // 0 on the crimp, 1 at the middle
    const z = bulge * (1 - x * x) * Math.pow(Math.min(1, body * 3), 0.6);
    pos.setZ(i, z + 0.002);
  }
  g.computeVertexNormals();
  return g;
}

/** Concards booster pack (art: assets/props/concards_*.webp, prepared by tools/props.py). */
export function cardPack(): THREE.Group {
  const g = new THREE.Group();
  const face = geo('packFace', packFace);
  const foil = (url: string) => new THREE.MeshStandardMaterial({ map: tex(url), alphaTest: 0.5, metalness: 0.55, roughness: 0.32, envMapIntensity: 1.4 });
  const front = new THREE.Mesh(face, mat('packFront', () => foil('assets/props/concards_front.webp')));
  const back = new THREE.Mesh(face, mat('packBack', () => foil('assets/props/concards_back.webp')));
  back.rotation.y = Math.PI;
  front.castShadow = back.castShadow = true;
  g.add(front, back);
  return g;
}

const CHIP = ['#f2f2f2', '#d8232f', '#2456d6', '#1e9e4a', '#16161a', '#e0aa2a'];
/** Poker-style chip; value 1..6 picks the colour (white, red, blue, green, black, gold). */
export function pokerChip(value = 1): THREE.Group {
  const v = Math.min(6, Math.max(1, value | 0));
  const col = CHIP[v - 1];
  const light = v === 1 || v === 6;
  const g = new THREE.Group();
  const face = mat('chipFace' + v, () => new THREE.MeshStandardMaterial({
    roughness: 0.6, metalness: v === 6 ? 0.3 : 0.05, envMapIntensity: 0.5,
    map: canvasTex(256, 256, (c, w, h) => {
      c.fillStyle = col; c.beginPath(); c.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2); c.fill();
      c.fillStyle = light ? '#2a2a30' : '#ffffff';
      for (let i = 0; i < 8; i++) { // edge inserts
        c.save(); c.translate(w / 2, h / 2); c.rotate((i / 8) * Math.PI * 2); c.fillRect(-14, -h / 2, 28, 30); c.restore();
      }
      c.strokeStyle = light ? '#2a2a30' : '#ffffff'; c.lineWidth = 6;
      c.beginPath(); c.arc(w / 2, h / 2, w * 0.31, 0, Math.PI * 2); c.stroke();
      c.setLineDash([10, 9]); c.lineWidth = 4;
      c.beginPath(); c.arc(w / 2, h / 2, w * 0.25, 0, Math.PI * 2); c.stroke();
      c.setLineDash([]);
      c.fillStyle = light ? '#1a1a1e' : '#ffffff';
      c.font = '900 92px "Bebas Neue", Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String([1, 5, 10, 25, 100, 500][v - 1]), w / 2, h / 2 + 6);
    }),
  }));
  const edge = mat('chipEdge' + v, () => new THREE.MeshStandardMaterial({
    roughness: 0.6, envMapIntensity: 0.5,
    map: (() => {
      const t = canvasTex(256, 16, (c, w, h) => {
        for (let i = 0; i < 16; i++) { c.fillStyle = i % 2 ? col : (light ? '#2a2a30' : '#ffffff'); c.fillRect((i * w) / 16, 0, w / 16 + 1, h); }
      });
      return t;
    })(),
  }));
  const m = new THREE.Mesh(geo('chip', () => new THREE.CylinderGeometry(0.5, 0.5, 0.11, 28)), [edge, face, face]);
  m.rotation.x = Math.PI / 2; // face the camera by default
  m.castShadow = true;
  g.add(m);
  return g;
}

const AGORA: [string, string, string][] = [['#d9b25a', '#8a6420', '10'], ['#c9c9cf', '#6d6d76', '5'], ['#e3c36a', '#93701f', '50'], ['#c58a4a', '#73451c', '1']];
/** An agora coin (10 / 5 / 50 / 1, by `kind`): reeded edge, big numeral, "אגורות" underneath. */
export function agoraCoin(kind = 0): THREE.Group {
  const k = ((kind % AGORA.length) + AGORA.length) % AGORA.length;
  const [col, dark, num] = AGORA[k];
  const g = new THREE.Group();
  const face = mat('agoraFace' + k, () => new THREE.MeshStandardMaterial({
    roughness: 0.32, metalness: 0.85, envMapIntensity: 1.3,
    map: canvasTex(256, 256, (c, w, h) => {
      const grd = c.createRadialGradient(w * 0.38, h * 0.34, w * 0.05, w / 2, h / 2, w / 2);
      grd.addColorStop(0, '#fff3c8'); grd.addColorStop(0.35, col); grd.addColorStop(1, dark);
      c.fillStyle = grd; c.beginPath(); c.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2); c.fill();
      c.strokeStyle = dark; c.lineWidth = 7;
      c.beginPath(); c.arc(w / 2, h / 2, w * 0.43, 0, Math.PI * 2); c.stroke();
      c.fillStyle = dark; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = `900 ${num.length > 1 ? 118 : 138}px "Bebas Neue", Impact, sans-serif`;
      c.fillText(num, w / 2, h * 0.44);
      c.font = '900 40px "Heebo", Arial, sans-serif';
      c.fillText(num === '1' ? 'אגורה' : 'אגורות', w / 2, h * 0.74);
    }),
  }));
  const edge = mat('agoraEdge' + k, () => new THREE.MeshStandardMaterial({
    roughness: 0.4, metalness: 0.85,
    map: canvasTex(256, 8, (c, w, h) => { for (let i = 0; i < 64; i++) { c.fillStyle = i % 2 ? col : dark; c.fillRect((i * w) / 64, 0, w / 64 + 1, h); } }),
  }));
  const m = new THREE.Mesh(geo('agora', () => new THREE.CylinderGeometry(0.5, 0.5, 0.075, 30)), [edge, face, face]);
  m.rotation.x = Math.PI / 2; // face the camera by default
  m.castShadow = true;
  g.add(m);
  return g;
}

/** A handful of agorot falling together (the rain special). */
export function agorotShower(): THREE.Group {
  const g = new THREE.Group();
  let sd = 7;
  const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  for (let i = 0; i < 11; i++) {
    const c = agoraCoin(i);
    c.scale.setScalar(0.2 + r() * 0.12);
    c.position.set((r() - 0.5) * 0.95, (r() - 0.5) * 0.8, (r() - 0.5) * 0.3);
    c.userData.spin = [1 + r() * 2, 1 + r() * 2, r() * 6];
    g.add(c);
  }
  return g;
}

/** INDE GAME merch (headset with blue LEDs, gaming mouse, branded mug). */
export function indeProduct(kind: number): THREE.Group {
  const g = new THREE.Group();
  const dark = mat('indeDark', () => new THREE.MeshStandardMaterial({ color: '#15171c', roughness: 0.42, metalness: 0.2 }));
  const led = mat('indeLed', () => new THREE.MeshStandardMaterial({ color: '#27a6ff', emissive: '#27a6ff', emissiveIntensity: 2.2, roughness: 0.3 }));
  const logo = () => mat('indeLogo', () => new THREE.MeshStandardMaterial({
    roughness: 0.55,
    map: canvasTex(256, 128, (c, w, h) => {
      c.fillStyle = '#f4f6f8'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#15171c'; c.font = '900 84px "Bebas Neue", Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('inde', w / 2, h / 2 + 4);
      c.fillStyle = '#27a6ff'; c.fillRect(w * 0.2, h * 0.84, w * 0.6, 8);
    }),
  }));
  switch (((kind % 3) + 3) % 3) {
    case 0: { // headset
      const band = new THREE.Mesh(geo('hsBand', () => new THREE.TorusGeometry(0.34, 0.045, 10, 28, Math.PI)), dark);
      g.add(band);
      for (const s of [-1, 1]) {
        const cup = new THREE.Mesh(geo('hsCup', () => new THREE.CylinderGeometry(0.17, 0.17, 0.13, 22)), dark);
        cup.rotation.z = Math.PI / 2;
        cup.position.set(s * 0.34, -0.06, 0);
        const ring = new THREE.Mesh(geo('hsRing', () => new THREE.TorusGeometry(0.13, 0.022, 8, 22)), led);
        ring.rotation.y = Math.PI / 2;
        ring.position.set(s * 0.41, -0.06, 0);
        g.add(cup, ring);
      }
      const mic = new THREE.Mesh(geo('hsMic', () => new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6)), dark);
      mic.position.set(-0.3, -0.24, 0.12);
      mic.rotation.set(0.9, 0, 0.3);
      g.add(mic);
      break;
    }
    case 1: { // mouse
      const body = new THREE.Mesh(geo('msBody', () => new THREE.SphereGeometry(0.3, 22, 14, 0, Math.PI * 2, 0, Math.PI / 2)), dark);
      body.scale.set(0.72, 0.62, 1.2);
      const base = new THREE.Mesh(geo('msBase', () => new THREE.CylinderGeometry(0.3, 0.3, 0.03, 22)), dark);
      base.scale.set(0.72, 1, 1.2);
      const strip = new THREE.Mesh(geo('msStrip', () => new THREE.TorusGeometry(0.3, 0.014, 6, 30)), led);
      strip.rotation.x = Math.PI / 2;
      strip.scale.set(0.73, 1.21, 1);
      strip.position.y = 0.02;
      const wheel = new THREE.Mesh(geo('msWheel', () => new THREE.CylinderGeometry(0.04, 0.04, 0.03, 12)), led);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(0, 0.155, -0.2);
      g.add(body, base, strip, wheel);
      g.rotation.x = 0.5;
      break;
    }
    default: { // mug
      const side = new THREE.Mesh(geo('mugSide', () => new THREE.CylinderGeometry(0.24, 0.22, 0.52, 26, 1, true)), logo());
      const inner = new THREE.Mesh(geo('mugIn', () => new THREE.CylinderGeometry(0.215, 0.2, 0.5, 20, 1, true)), mat('mugInM', () => new THREE.MeshStandardMaterial({ color: '#27a6ff', side: THREE.BackSide, roughness: 0.4 })));
      const bottom = new THREE.Mesh(geo('mugBot', () => new THREE.CircleGeometry(0.22, 22)), mat('mugWhite', () => new THREE.MeshStandardMaterial({ color: '#f4f6f8', roughness: 0.55, side: THREE.DoubleSide })));
      bottom.rotation.x = Math.PI / 2;
      bottom.position.y = -0.255;
      const handle = new THREE.Mesh(geo('mugHandle', () => new THREE.TorusGeometry(0.14, 0.035, 8, 18, Math.PI)), mat('mugWhite', () => new THREE.MeshStandardMaterial({ color: '#f4f6f8' })));
      handle.rotation.z = -Math.PI / 2;
      handle.position.x = 0.24;
      g.add(side, inner, bottom, handle);
      break;
    }
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return g;
}

/** The subathon timer board: Ronen's 36 days live (April-May 2025), and the clock still going up. `tick(t)` redraws the clock. */
export function subathonBoard(): THREE.Group & { tick?: (t: number) => void } {
  const g = new THREE.Group() as THREE.Group & { tick?: (t: number) => void };
  const c = document.createElement('canvas');
  c.width = 512; c.height = 288;
  const ctx = c.getContext('2d')!;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  let last = -1;
  const draw = (time: number) => {
    const secs = 36 * 86400 - 1 + Math.floor(time * 240); // subs keep adding time faster than it runs out
    if (secs === last) return;
    last = secs;
    const d = Math.floor(secs / 86400), hh = Math.floor((secs % 86400) / 3600), mm = Math.floor((secs % 3600) / 60), ss = secs % 60;
    const p = (n: number) => String(n).padStart(2, '0');
    ctx.fillStyle = '#0b0b10'; ctx.fillRect(0, 0, 512, 288);
    ctx.fillStyle = '#53fc18'; ctx.fillRect(0, 0, 512, 62);
    ctx.fillStyle = '#06140a'; ctx.font = '900 46px "Bebas Neue", Impact, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('SUBATHON  •  DAY 36  •  LIVE', 256, 34);
    ctx.fillStyle = '#ff3b3b'; ctx.shadowColor = '#ff3b3b'; ctx.shadowBlur = 18;
    ctx.font = '900 104px "Bebas Neue", Impact, monospace';
    ctx.fillText(`${p(d)}:${p(hh)}:${p(mm)}:${p(ss)}`, 256, 150);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff'; ctx.font = '700 30px "Heebo", Arial, sans-serif';
    ctx.fillText('+SUB  +5:00   +SUB  +5:00', 256, 242);
    t.needsUpdate = true;
  };
  draw(0);
  const screen = new THREE.MeshStandardMaterial({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.9, roughness: 0.4 });
  const body = new THREE.MeshStandardMaterial({ color: '#17181d', roughness: 0.5, metalness: 0.4 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(1, 0.5625, 0.12), [body, body, body, body, screen, body]);
  box.castShadow = true;
  g.add(box);
  g.tick = draw;
  g.userData.dispose = () => { t.dispose(); screen.dispose(); body.dispose(); box.geometry.dispose(); };
  return g;
}

/** Several copies of one prop flying together (a handful of chips, a fan of packs): each tumbles on its own. */
export function cluster(make: (i: number) => THREE.Object3D, n: number, spread = 0.42, each = 0.62): THREE.Group {
  const g = new THREE.Group();
  let sd = 11 + n * 7;
  const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  for (let i = 0; i < n; i++) {
    const c = make(i);
    const a = (i / n) * Math.PI * 2 + r();
    c.scale.setScalar(each * (0.85 + r() * 0.3));
    c.position.set(Math.cos(a) * spread * (0.5 + r() * 0.5), Math.sin(a) * spread * (0.5 + r() * 0.5), (r() - 0.5) * 0.3);
    c.userData.ph = r() * 6.28;
    g.add(c);
  }
  g.userData.cluster = true;
  return g;
}

const shadowed = (g: THREE.Group) => { g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; }); return g; };

/** An acoustic guitar, about one unit from the bottom of the body to the head. */
export function guitar(): THREE.Group {
  const g = new THREE.Group();
  const top = mat('gtrTop', () => new THREE.MeshStandardMaterial({ color: '#d39a4a', roughness: 0.45 }));
  const dark = mat('gtrDark', () => new THREE.MeshStandardMaterial({ color: '#3a2212', roughness: 0.6 }));
  const black = mat('gtrBlack', () => new THREE.MeshStandardMaterial({ color: '#0c0a09', roughness: 0.8 }));
  const steel = mat('gtrSteel', () => new THREE.MeshStandardMaterial({ color: '#e8e8ee', roughness: 0.3, metalness: 0.9 }));
  const bout = geo('gtrBout', () => new THREE.SphereGeometry(1, 24, 16));
  const lower = new THREE.Mesh(bout, top); lower.scale.set(0.27, 0.25, 0.07); lower.position.y = -0.3;
  const upper = new THREE.Mesh(bout, top); upper.scale.set(0.2, 0.19, 0.07); upper.position.y = -0.03;
  const rimL = new THREE.Mesh(bout, dark); rimL.scale.set(0.275, 0.255, 0.055); rimL.position.set(0, -0.3, -0.02);
  const rimU = new THREE.Mesh(bout, dark); rimU.scale.set(0.205, 0.195, 0.055); rimU.position.set(0, -0.03, -0.02);
  const hole = new THREE.Mesh(geo('gtrHole', () => new THREE.CircleGeometry(0.07, 20)), black); hole.position.set(0, -0.12, 0.072);
  const bridge = new THREE.Mesh(geo('gtrBridge', () => new THREE.BoxGeometry(0.16, 0.03, 0.02)), dark); bridge.position.set(0, -0.36, 0.07);
  const neck = new THREE.Mesh(geo('gtrNeck', () => new THREE.BoxGeometry(0.065, 0.5, 0.035)), dark); neck.position.set(0, 0.34, 0.03);
  const head = new THREE.Mesh(geo('gtrHead', () => new THREE.BoxGeometry(0.1, 0.15, 0.03)), dark); head.position.set(0, 0.63, 0.02);
  g.add(rimL, rimU, lower, upper, hole, bridge, neck, head);
  for (let i = 0; i < 4; i++) {
    const st = new THREE.Mesh(geo('gtrString', () => new THREE.BoxGeometry(0.004, 0.94, 0.004)), steel);
    st.position.set(-0.021 + i * 0.014, 0.11, 0.058);
    g.add(st);
  }
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
    const peg = new THREE.Mesh(geo('gtrPeg', () => new THREE.SphereGeometry(0.014, 8, 6)), steel);
    peg.position.set(sx * 0.062, 0.58 + i * 0.045, 0.02);
    g.add(peg);
  }
  for (const c of g.children) c.position.y -= 0.08; // the middle of the guitar at the origin
  return shadowed(g);
}

/** A bottle of red wine. */
export function wineBottle(): THREE.Group {
  const g = new THREE.Group();
  const profile = [[0, -0.5], [0.13, -0.5], [0.14, -0.46], [0.14, 0.04], [0.125, 0.15], [0.055, 0.27], [0.045, 0.45], [0.055, 0.46], [0.055, 0.5], [0, 0.5]];
  const glass = new THREE.Mesh(
    geo('wineGlass', () => new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 24)),
    mat('wineGlassM', () => new THREE.MeshStandardMaterial({ color: '#1c0a12', roughness: 0.12, metalness: 0.25, envMapIntensity: 1.6 })),
  );
  const label = new THREE.Mesh(
    geo('wineLabel', () => new THREE.CylinderGeometry(0.143, 0.143, 0.24, 24, 1, true)),
    mat('wineLabelM', () => new THREE.MeshStandardMaterial({
      roughness: 0.7,
      map: canvasTex(512, 160, (c, w, h) => {
        c.fillStyle = '#f1e6cf'; c.fillRect(0, 0, w, h);
        c.fillStyle = '#7a1020'; c.fillRect(0, 0, w, 14); c.fillRect(0, h - 14, w, 14);
        c.textAlign = 'center'; c.textBaseline = 'middle';
        for (const x of [w * 0.25, w * 0.75]) {
          c.font = '900 64px "Heebo", Arial, sans-serif'; c.fillText('יין אדום', x, h * 0.42);
          c.font = '700 26px "Bebas Neue", Impact, sans-serif'; c.fillText('RESERVE · MAOR', x, h * 0.74);
        }
      }),
    })),
  );
  label.position.y = -0.2;
  const foil = new THREE.Mesh(geo('wineFoil', () => new THREE.CylinderGeometry(0.058, 0.05, 0.15, 16)), mat('wineFoilM', () => new THREE.MeshStandardMaterial({ color: '#8a1326', roughness: 0.35, metalness: 0.6 })));
  foil.position.y = 0.43;
  g.add(glass, label, foil);
  return shadowed(g);
}

/** A bottle of perfume: square glass, gold cap. */
export function perfumeBottle(kind = 0): THREE.Group {
  const g = new THREE.Group();
  const tint = ['#f2a7cf', '#f0c36a', '#9fd8f0'][((kind % 3) + 3) % 3];
  const glass = new THREE.Mesh(geo('pfGlass', () => new THREE.BoxGeometry(0.5, 0.52, 0.2)), mat('pfGlass' + tint, () => new THREE.MeshStandardMaterial({ color: tint, roughness: 0.08, metalness: 0.15, transparent: true, opacity: 0.72, envMapIntensity: 1.8 })));
  glass.position.y = -0.14;
  const juice = new THREE.Mesh(geo('pfJuice', () => new THREE.BoxGeometry(0.42, 0.34, 0.13)), mat('pfJuice' + tint, () => new THREE.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: 0.25, roughness: 0.3 })));
  juice.position.y = -0.2;
  const gold = mat('pfGold', () => new THREE.MeshStandardMaterial({ color: '#e2b84f', roughness: 0.25, metalness: 0.95, envMapIntensity: 1.6 }));
  const neck = new THREE.Mesh(geo('pfNeck', () => new THREE.CylinderGeometry(0.075, 0.075, 0.08, 16)), gold); neck.position.y = 0.16;
  const cap = new THREE.Mesh(geo('pfCap', () => new THREE.CylinderGeometry(0.11, 0.11, 0.2, 18)), gold); cap.position.y = 0.3;
  const plate = new THREE.Mesh(geo('pfPlate', () => new THREE.PlaneGeometry(0.26, 0.14)), mat('pfPlateM', () => new THREE.MeshStandardMaterial({
    roughness: 0.4, metalness: 0.5,
    map: canvasTex(256, 128, (c, w, h) => {
      c.fillStyle = '#f7e9c0'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#9a7a22'; c.lineWidth = 8; c.strokeRect(6, 6, w - 12, h - 12);
      c.fillStyle = '#5a430c'; c.font = '900 60px "Bebas Neue", Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('PEDRO', w / 2, h / 2 + 4);
    }),
  })));
  plate.position.set(0, -0.14, 0.102);
  g.add(juice, glass, neck, cap, plate);
  return shadowed(g);
}

/** A head of lettuce: a pale heart wrapped in ruffled leaves. */
export function lettuce(): THREE.Group {
  const g = new THREE.Group();
  const heart = new THREE.Mesh(geo('ltHeart', () => new THREE.SphereGeometry(0.3, 16, 12)), mat('ltHeartM', () => new THREE.MeshStandardMaterial({ color: '#d9ef9a', roughness: 0.7 })));
  heart.scale.set(1, 0.92, 1);
  g.add(heart);
  const leaf = geo('ltLeaf', () => {
    const s = new THREE.SphereGeometry(0.44, 14, 10, 0, Math.PI * 0.95, 0.18, Math.PI * 0.72);
    const pos = s.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) { // ruffle: more towards the top edge of the leaf
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const k = Math.max(0, (y + 0.1) / 0.5);
      const w = 1 + Math.sin(Math.atan2(z, x) * 9 + y * 14) * 0.09 * k + k * 0.08;
      pos.setXYZ(i, x * w, y, z * w);
    }
    s.computeVertexNormals();
    return s;
  });
  const cols = ['#7cc24a', '#5fae3a', '#92d05a', '#4e9a31'];
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(leaf, mat('ltLeafM' + (i % 4), () => new THREE.MeshStandardMaterial({ color: cols[i % 4], roughness: 0.75, side: THREE.DoubleSide })));
    const ring = i < 5 ? 0 : 1;
    m.rotation.set((ring ? 0.32 : 0.12) * (i % 2 ? 1 : -1), (i / (ring ? 4 : 5)) * Math.PI * 2 + ring * 0.6, ring ? 0.22 : 0.06);
    m.scale.setScalar(ring ? 1.08 : 0.9);
    g.add(m);
  }
  const stem = new THREE.Mesh(geo('ltStem', () => new THREE.CylinderGeometry(0.09, 0.07, 0.1, 10)), mat('ltStemM', () => new THREE.MeshStandardMaterial({ color: '#eef3d2', roughness: 0.8 })));
  stem.position.y = -0.36;
  g.add(stem);
  return shadowed(g);
}

/** A green bud: a knobbly little cone with a few orange hairs and a leaf. */
export function bud(kind = 0): THREE.Group {
  const g = new THREE.Group();
  let sd = 31 + kind * 13;
  const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  const knob = geo('budKnob', () => new THREE.IcosahedronGeometry(1, 1));
  const cols = ['#3f8f2e', '#57a83a', '#2f7426', '#6cbc45'];
  for (let i = 0; i < 15; i++) {
    const h = i / 14; // 0 at the bottom of the bud, 1 at its tip
    const rad = 0.3 * (1 - h * 0.75);
    const a = i * 2.4;
    const m = new THREE.Mesh(knob, mat('budM' + (i % 4), () => new THREE.MeshStandardMaterial({ color: cols[i % 4], roughness: 0.85, flatShading: true })));
    m.scale.setScalar(0.13 + (1 - h) * 0.09 + r() * 0.03);
    m.position.set(Math.cos(a) * rad * 0.7, -0.38 + h * 0.8, Math.sin(a) * rad * 0.7);
    m.rotation.set(r() * 3, r() * 3, r() * 3);
    g.add(m);
  }
  const hair = geo('budHair', () => new THREE.CylinderGeometry(0.008, 0.008, 0.16, 5));
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(hair, mat('budHairM', () => new THREE.MeshStandardMaterial({ color: '#e08a2c', roughness: 0.6 })));
    const a = r() * 6.28, h = r();
    m.position.set(Math.cos(a) * 0.2 * (1 - h * 0.6), -0.3 + h * 0.7, Math.sin(a) * 0.2 * (1 - h * 0.6));
    m.rotation.set(r() * 2 - 1, 0, r() * 2 - 1);
    g.add(m);
  }
  const leafShape = geo('budLeaf', () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.quadraticCurveTo(0.09, 0.14, 0, 0.36); s.quadraticCurveTo(-0.09, 0.14, 0, 0);
    return new THREE.ShapeGeometry(s, 6);
  });
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(leafShape, mat('budLeafM', () => new THREE.MeshStandardMaterial({ color: '#4c9b34', roughness: 0.8, side: THREE.DoubleSide })));
    m.position.set(sx * 0.12, -0.36, 0);
    m.rotation.set(0.3, 0, -sx * 1.15);
    g.add(m);
  }
  return shadowed(g);
}
