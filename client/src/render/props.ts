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

/** The subathon timer board: 24 days and still counting. `tick(t)` redraws the clock. */
export function subathonBoard(): THREE.Group & { tick?: (t: number) => void } {
  const g = new THREE.Group() as THREE.Group & { tick?: (t: number) => void };
  const c = document.createElement('canvas');
  c.width = 512; c.height = 288;
  const ctx = c.getContext('2d')!;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  let last = -1;
  const draw = (time: number) => {
    const secs = 24 * 86400 - 1 + Math.floor(time * 240); // subs keep adding time faster than it runs out
    if (secs === last) return;
    last = secs;
    const d = Math.floor(secs / 86400), hh = Math.floor((secs % 86400) / 3600), mm = Math.floor((secs % 3600) / 60), ss = secs % 60;
    const p = (n: number) => String(n).padStart(2, '0');
    ctx.fillStyle = '#0b0b10'; ctx.fillRect(0, 0, 512, 288);
    ctx.fillStyle = '#53fc18'; ctx.fillRect(0, 0, 512, 62);
    ctx.fillStyle = '#06140a'; ctx.font = '900 46px "Bebas Neue", Impact, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('SUBATHON  •  LIVE', 256, 34);
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
