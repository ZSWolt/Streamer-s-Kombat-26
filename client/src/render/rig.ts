import * as THREE from 'three';
import type { Fighter, Look } from '../data/roster';
import { EX_EYES, EX_HIPY, EX_HIPZ, EX_MOUTH, J, JOINTS, type Pose } from './pose';

// Procedural "vinyl toy" bobblehead character. Used until the AI-generated GLB models are dropped in.

const HEAD_R = 0.3;

/** textures multiply the colour, so brighten the base a little to keep the intended shade */
function lift(color: string, k: number) {
  const c = new THREE.Color(color);
  c.r = Math.min(1, c.r * k + 0.02); c.g = Math.min(1, c.g * k + 0.02); c.b = Math.min(1, c.b * k + 0.02);
  return '#' + c.getHexString();
}

function hash(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function mat(color: string, o: Partial<THREE.MeshPhysicalMaterialParameters> = {}) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.62, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.5, ...o });
}

function capsule(r: number, len: number, m: THREE.Material, seg = 16) {
  const g = new THREE.CapsuleGeometry(r, len, 6, seg);
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function sphere(r: number, m: THREE.Material, w = 24, h = 18) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, w, h), m);
  mesh.castShadow = true;
  return mesh;
}

/** Front lower-face shell used by full and trimmed beards. */
function beardShell(r: number, full: boolean) {
  const thetaStart = Math.PI * (full ? 0.48 : 0.52);
  const thetaLength = Math.PI * (full ? 0.45 : 0.34);
  return new THREE.SphereGeometry(r, 32, 16, 0, Math.PI, thetaStart, thetaLength);
}

function textTexture(lines: string[], color = '#ffffff', bg = 'rgba(0,0,0,0)', w = 512, h = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const n = lines.length;
  lines.forEach((t, i) => {
    let size = n === 1 ? (t.length <= 3 ? 190 : 110) : 90;
    g.font = `900 ${size}px "Bebas Neue", "Arial Black", sans-serif`;
    while (g.measureText(t).width > w * 0.92 && size > 20) { size -= 6; g.font = `900 ${size}px "Bebas Neue", "Arial Black", sans-serif`; }
    g.fillText(t, w / 2, (h / (n + 1)) * (i + 1));
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function stripeTexture(a: string, b: string) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect(0, i * 8, 64, 8); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 3);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function palmTexture(base: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  let sd = 5;
  const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  for (let k = 0; k < 9; k++) {
    const x = r() * 256, y = r() * 256, rot = r() * Math.PI * 2, len = 36 + r() * 30;
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.strokeStyle = 'rgba(240,240,232,0.9)';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(len, 0); g.stroke();
    g.fillStyle = 'rgba(240,240,232,0.85)';
    for (let i = 1; i <= 7; i++) {
      const px = (len / 8) * i;
      for (const sgn of [-1, 1]) {
        g.beginPath();
        g.moveTo(px, 0);
        g.quadraticCurveTo(px + 6, sgn * 10, px + 10, sgn * (16 - i));
        g.quadraticCurveTo(px + 3, sgn * 6, px, 0);
        g.fill();
      }
    }
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1.5, 1.5);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let hairTex: THREE.CanvasTexture | null = null;
let beardTex: THREE.CanvasTexture | null = null;
/** fibrous strand noise so hair/beards read as hair rather than solid plastic */
function strandTexture(kind: 'hair' | 'beard') {
  if (kind === 'hair' && hairTex) return hairTex;
  if (kind === 'beard' && beardTex) return beardTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ececec';
  g.fillRect(0, 0, 256, 256);
  let sd = kind === 'hair' ? 11 : 23;
  const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  const n = kind === 'hair' ? 1400 : 2600;
  for (let i = 0; i < n; i++) {
    const x = r() * 256, y = r() * 256;
    const l = kind === 'hair' ? 10 + r() * 26 : 3 + r() * 6;
    const a = kind === 'hair' ? Math.PI / 2 + (r() - 0.5) * 0.5 : r() * Math.PI;
    const v = Math.floor(150 + r() * 105);
    g.strokeStyle = `rgba(${v},${v},${v},0.6)`;
    g.lineWidth = kind === 'hair' ? 1 + r() * 1.2 : 1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(kind === 'hair' ? 2 : 3, kind === 'hair' ? 2 : 3);
  t.colorSpace = THREE.SRGBColorSpace;
  if (kind === 'hair') hairTex = t; else beardTex = t;
  return t;
}

export interface RigParts {
  root: THREE.Group; // world placement
  body: THREE.Group; // facing/mirroring
  joints: THREE.Object3D[];
  hipsBaseY: number;
  head: THREE.Group;
  headBob: THREE.Group;
  lidL: THREE.Object3D; lidR: THREE.Object3D;
  mouthOpen: THREE.Object3D;
  mouthSmile: THREE.Object3D;
  materials: THREE.Material[];
  handR: THREE.Object3D;
  handL: THREE.Object3D;
  height: number;
  wheelchair: boolean;
  wheels: THREE.Object3D[];
  chair: THREE.Group | null;
}

export function buildRig(f: Fighter, skinIdx = 0): RigParts {
  const L: Look = f.look;
  const skin = f.skins[skinIdx] ?? f.skins[0];
  const materials: THREE.Material[] = [];
  const tint = skin.tint;
  const gold = tint === '#d4a531';
  const M = (color: string, o: Partial<THREE.MeshPhysicalMaterialParameters> = {}) => {
    let c = color;
    if (tint && !gold) c = '#' + new THREE.Color(color).lerp(new THREE.Color(tint), 0.35).getHexString();
    const m = gold ? mat('#d8a93a', { metalness: 0.95, roughness: 0.28, clearcoat: 0.6 }) : mat(c, o);
    if (tint && !gold) { m.emissive = new THREE.Color(tint); m.emissiveIntensity = 0.12; }
    materials.push(m);
    return m;
  };

  const wMul = { slim: 0.86, normal: 1, heavy: 1.16, burly: 1.2 }[L.build];
  const limbMul = { slim: 0.88, normal: 1, heavy: 1.12, burly: 1.25 }[L.build];
  const hm = L.height;

  const skinM = M(L.skin, { roughness: 0.48, clearcoat: 0.18, sheen: 0.4, sheenColor: new THREE.Color('#ffb59a'), sheenRoughness: 0.6 });
  const hairM = M(lift(L.hair, 1.12), { roughness: 0.72, map: strandTexture('hair'), bumpMap: strandTexture('hair'), bumpScale: 1.2 });
  const beardM = M(lift(L.beardColor ?? L.hair, 1.18), { roughness: 0.9, map: strandTexture('beard'), bumpMap: strandTexture('beard'), bumpScale: 1.6 });
  const shirtM = L.stripes ? M('#ffffff', { map: stripeTexture(L.shirt, L.stripes), roughness: 0.85 })
    : L.print === 'palm' ? M('#ffffff', { map: palmTexture(L.shirt), roughness: 0.85 })
    : M(L.shirt, { roughness: 0.85 });
  const sleeveM = L.jacket ? M(L.jacket, { roughness: 0.7 }) : shirtM;
  const torsoM = L.jacket ? sleeveM : shirtM;
  const pantsM = M(L.pants, { roughness: 0.8 });
  const shoeM = M(L.shoes, { roughness: 0.55, clearcoat: 0.3 });
  const darkM = M('#141012', { roughness: 0.4 });
  const whiteM = M('#fbfbfb', { roughness: 0.2, clearcoat: 0.6 });

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  body.scale.setScalar(hm);

  const joints: THREE.Object3D[] = JOINTS.map((n) => { const o = new THREE.Group(); o.name = n; return o; });
  const jt = (n: keyof typeof J) => joints[J[n]];

  const legLen = 0.66;
  const hips = jt('hips');
  hips.position.set(0, legLen, 0);
  body.add(hips);

  // pelvis
  const pelvis = capsule(0.16 * wMul * (L.female ? 1.08 : 1), 0.06, pantsM);
  pelvis.rotation.z = Math.PI / 2;
  pelvis.scale.set(0.8, 1, 0.75);
  pelvis.position.y = 0.02;
  hips.add(pelvis);

  const spine = jt('spine');
  spine.position.y = 0.06;
  hips.add(spine);
  const belly = capsule(0.155 * wMul, 0.1, torsoM);
  belly.scale.set(1.12, 1, L.build === 'heavy' ? 1.05 : 0.82);
  belly.position.set(0, 0.1, L.build === 'heavy' ? 0.025 : 0);
  spine.add(belly);

  const chest = jt('chest');
  chest.position.y = 0.18;
  spine.add(chest);
  const chestW = (L.female ? 0.9 : 1) * wMul;
  const torso = capsule(0.17 * chestW, 0.16, torsoM);
  torso.scale.set(1.18, 1, L.build === 'burly' ? 0.95 : 0.8);
  torso.position.y = 0.12;
  chest.add(torso);
  if (L.female) {
    for (const s of [-1, 1]) {
      const b = sphere(0.065, torsoM);
      b.position.set(s * 0.07, 0.13, 0.11);
      chest.add(b);
    }
  }

  // chest decals
  const frontZ = 0.17 * chestW * (L.build === 'burly' ? 0.95 : 0.8) + 0.004;
  if (L.jacket) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#f7f7f7'; g.beginPath(); g.moveTo(80, 0); g.lineTo(176, 0); g.lineTo(128, 190); g.closePath(); g.fill();
    g.fillStyle = '#0b0b0e'; g.beginPath(); g.moveTo(128, 60); g.lineTo(118, 80); g.lineTo(128, 200); g.lineTo(138, 80); g.closePath(); g.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.6 }));
    plane.position.set(0, 0.2, frontZ + 0.012);
    chest.add(plane);
  }
  if (L.shirtText && !L.jacket) {
    const lines = L.shirtText2 ? [L.shirtText, L.shirtText2] : [L.shirtText];
    const lum = new THREE.Color(L.shirt).getHSL({ h: 0, s: 0, l: 0 }).l;
    const t = textTexture(lines, lum > 0.6 ? '#1a1a1a' : '#ffffff');
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.15), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.8 }));
    plane.position.set(0, 0.14, frontZ + 0.012);
    chest.add(plane);
  }
  if (L.hoodie) {
    const hood = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.05, 10, 24), torsoM);
    hood.rotation.x = Math.PI / 2 + 0.5;
    hood.position.set(0, 0.3, -0.06);
    chest.add(hood);
    for (const s of [-1, 1]) {
      const str = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12), whiteM);
      str.position.set(s * 0.04, 0.2, frontZ + 0.01);
      chest.add(str);
    }
  }
  if (L.chain) {
    const ch = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.008, 6, 32), M('#e6c35a', { metalness: 1, roughness: 0.25 }));
    ch.rotation.x = Math.PI / 2 + 0.35;
    ch.position.set(0, 0.26, 0.03);
    chest.add(ch);
  }

  const neck = jt('neck');
  neck.position.y = 0.3;
  chest.add(neck);
  const neckMesh = capsule(0.06 * Math.min(wMul, 1.1), 0.05, skinM);
  neckMesh.position.y = 0.04;
  neck.add(neckMesh);

  // ---------------- head
  const head = jt('head') as THREE.Group;
  head.position.y = 0.08;
  neck.add(head);
  const headBob = new THREE.Group();
  head.add(headBob);
  const hc = new THREE.Group(); // head centre
  hc.position.y = HEAD_R * 0.92;
  headBob.add(hc);

  const skull = sphere(HEAD_R, skinM, 48, 36);
  skull.scale.set(1, 1.06, 1);
  hc.add(skull);
  const jaw = sphere(HEAD_R * 0.86, skinM, 32, 24);
  jaw.scale.set(L.female ? 0.9 : 1.02, 0.78, 0.96);
  jaw.position.set(0, -0.085, 0.025);
  hc.add(jaw);
  for (const s of [-1, 1]) {
    const ear = sphere(0.06, skinM, 12, 10);
    ear.scale.set(0.45, 1, 0.8);
    ear.position.set(s * HEAD_R * 0.97, -0.02, -0.01);
    hc.add(ear);
  }
  const nose = sphere(0.062, skinM, 16, 12);
  nose.scale.set(0.95, 1, 1.15);
  nose.position.set(0, -0.03, HEAD_R * 0.97);
  hc.add(nose);
  const cheekM = M(L.skin, { roughness: 0.5 });
  (cheekM as THREE.MeshPhysicalMaterial).color.offsetHSL(0, 0.08, -0.03);
  for (const s of [-1, 1]) {
    const ch = sphere(0.07, cheekM, 12, 10);
    ch.scale.set(1, 0.7, 0.4);
    ch.position.set(s * 0.15, -0.07, 0.22);
    hc.add(ch);
  }

  // eyes
  const irisColor = L.eyes ?? '#3a2618';
  const irisM = M(irisColor, { roughness: 0.2, clearcoat: 1 });
  const lids: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(s * 0.1, 0.055, HEAD_R * 0.83);
    hc.add(eye);
    const white = sphere(0.068, whiteM, 20, 16);
    white.scale.set(1, 1.18, 0.6);
    eye.add(white);
    const iris = sphere(0.04, irisM, 16, 12);
    iris.scale.set(1, 1.1, 0.5);
    iris.position.set(s * -0.006, -0.004, 0.034);
    eye.add(iris);
    const pupil = sphere(0.021, darkM, 12, 10);
    pupil.scale.set(1, 1.1, 0.5);
    pupil.position.set(s * -0.006, -0.004, 0.047);
    eye.add(pupil);
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    hl.position.set(s * -0.018, 0.02, 0.05);
    eye.add(hl);
    const lidPivot = new THREE.Group();
    eye.add(lidPivot);
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.072, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), skinM);
    lid.scale.set(1.02, 1.22, 0.66);
    lidPivot.add(lid);
    lidPivot.rotation.x = -1.2; // open (lid rotated back)
    lids.push(lidPivot);
    // brow
    const brow = capsule(0.02, 0.085, M(L.beard === 'none' && L.hairStyle === 'bald' ? '#2a211b' : (L.beardColor ?? L.hair), { roughness: 0.9 }), 8);
    brow.rotation.z = Math.PI / 2 + s * 0.28;
    brow.position.set(s * 0.1, 0.155, HEAD_R * 0.86);
    hc.add(brow);
    if (L.female) {
      const lash = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.01), darkM);
      lash.position.set(s * 0.105, 0.12, HEAD_R * 0.9);
      lash.rotation.z = s * -0.25;
      hc.add(lash);
    }
  }

  // mouth
  const mouthSmile = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.013, 8, 20, Math.PI), M(L.female ? '#b8325a' : '#6b2a22', { roughness: 0.4 }));
  mouthSmile.rotation.z = Math.PI + 0.12;
  const bearded = L.beard === 'full' || L.beard === 'trim' || L.beard === 'scruff';
  mouthSmile.position.set(0.01, -0.115, HEAD_R * (bearded ? 1.02 : 0.92));
  mouthSmile.scale.set(1, 0.7, 1);
  hc.add(mouthSmile);
  const mouthOpen = new THREE.Group();
  mouthOpen.position.set(0.005, -0.14, HEAD_R * (bearded ? 0.99 : 0.88));
  hc.add(mouthOpen);
  const mo = sphere(0.06, M('#3a0d0d', { roughness: 0.6 }), 16, 12);
  mo.scale.set(1, 0.7, 0.45);
  mouthOpen.add(mo);
  const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.018, 0.02), whiteM);
  teeth.position.set(0, 0.03, 0.02);
  mouthOpen.add(teeth);
  mouthOpen.scale.y = 0.01;

  // beard
  if (L.beard === 'full' || L.beard === 'trim') {
    const full = L.beard === 'full';
    const g = beardShell(HEAD_R * (full ? 1.05 : 1.02), full);
    const bm = new THREE.Mesh(g, beardM);
    bm.scale.set(1.03, 1, 1.02);
    bm.position.set(0, -0.02, 0.01);
    hc.add(bm);
    const chin = sphere(HEAD_R * (full ? 0.36 : 0.28), beardM, 20, 14);
    chin.scale.set(1.15, 0.75, 0.8);
    chin.position.set(0, -0.24, 0.1);
    hc.add(chin);
  }
  if (L.beard === 'full' || L.beard === 'trim' || L.beard === 'mustache') {
    const mus = capsule(0.022, 0.1, beardM, 8);
    mus.rotation.z = Math.PI / 2;
    mus.position.set(0, -0.085, HEAD_R * 0.93);
    hc.add(mus);
  }
  if (L.beard === 'scruff') {
    const st = new THREE.Mesh(
      new THREE.SphereGeometry(HEAD_R * 1.01, 32, 16, -0.12, Math.PI + 0.24, Math.PI * 0.57, Math.PI * 0.38),
      new THREE.MeshStandardMaterial({ color: L.beardColor ?? L.hair, transparent: true, opacity: 0.62, roughness: 1 }),
    );
    st.position.y = -0.02;
    hc.add(st);
    const chin = sphere(HEAD_R * 0.2, beardM, 14, 10);
    chin.scale.set(1.3, 0.7, 0.7);
    chin.position.set(0, -0.23, 0.15);
    hc.add(chin);
    const mus = capsule(0.013, 0.09, beardM, 8);
    mus.rotation.z = Math.PI / 2;
    mus.position.set(0, -0.083, HEAD_R * 0.935);
    hc.add(mus);
  }
  if (L.beard === 'stubble') {
    const st = new THREE.Mesh(
      new THREE.SphereGeometry(HEAD_R * 1.005, 32, 16, -0.1, Math.PI + 0.2, Math.PI * 0.55, Math.PI * 0.4),
      new THREE.MeshStandardMaterial({ color: L.hair, transparent: true, opacity: 0.38, roughness: 1 }),
    );
    st.position.y = -0.02;
    hc.add(st);
  }

  // hair
  buildHair(hc, L, hairM, M);

  // headphones / accessories
  if (L.headphones) {
    const hpM = M(L.headphones, { roughness: 0.35, clearcoat: 0.5 });
    const band = new THREE.Mesh(new THREE.TorusGeometry(HEAD_R * 1.1, 0.026, 8, 40, Math.PI), hpM);
    band.position.set(0, 0.02, -0.02);
    hc.add(band);
    for (const s of [-1, 1]) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.07, 24), hpM);
      cup.rotation.z = Math.PI / 2;
      cup.position.set(s * HEAD_R * 1.03, -0.02, -0.01);
      cup.castShadow = true;
      hc.add(cup);
      if (L.headphonesAccent) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 8, 24), M(L.headphonesAccent, { emissive: new THREE.Color(L.headphonesAccent), emissiveIntensity: 0.6 }));
        ring.rotation.y = Math.PI / 2;
        ring.position.set(s * (HEAD_R * 1.03 + 0.037), -0.02, -0.01);
        hc.add(ring);
      }
    }
  }
  if (L.earbuds) {
    for (const s of [-1, 1]) {
      const e = sphere(0.022, M('#111'), 8, 6);
      e.position.set(s * HEAD_R * 0.98, -0.03, 0.02);
      hc.add(e);
    }
  }
  if (L.glasses) {
    const gm = M(L.glassesColor ?? '#111', { metalness: L.glasses === 'round' ? 0.9 : 0.1, roughness: 0.3 });
    for (const s of [-1, 1]) {
      const segs = L.glasses === 'rect' ? 4 : 28;
      const fr = new THREE.Mesh(new THREE.TorusGeometry(L.glasses === 'rect' ? 0.08 : 0.062, 0.008, 6, segs), gm);
      if (L.glasses === 'rect') { fr.rotation.z = Math.PI / 4; fr.scale.set(1.15, 0.8, 1); }
      fr.position.set(s * 0.1, 0.055, HEAD_R * 0.95);
      hc.add(fr);
      if (L.glasses === 'sun') {
        const lens = new THREE.Mesh(new THREE.CircleGeometry(0.06, 20), M('#0b0b0b', { roughness: 0.05, clearcoat: 1 }));
        lens.position.set(s * 0.1, 0.055, HEAD_R * 0.955);
        hc.add(lens);
      }
      const temple = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.26), gm);
      temple.rotation.x = Math.PI / 2;
      temple.position.set(s * HEAD_R * 0.93, 0.06, 0.13);
      hc.add(temple);
    }
    const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.07), gm);
    bridge.rotation.z = Math.PI / 2;
    bridge.position.set(0, 0.07, HEAD_R * 0.98);
    hc.add(bridge);
  }
  if (L.cap) {
    const cm = M(L.cap.color, { roughness: 0.7 });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R * 1.08, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.46), cm);
    dome.position.y = 0.02;
    dome.castShadow = true;
    hc.add(dome);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 24, 1, false, -Math.PI / 2, Math.PI), cm);
    brim.scale.set(1, 1, 1.1);
    brim.position.set(0, 0.07, (L.cap.backwards ? -1 : 1) * HEAD_R * 0.9);
    brim.rotation.y = L.cap.backwards ? Math.PI : 0;
    hc.add(brim);
  }
  if (L.crown) {
    const gm = M('#f2c230', { metalness: 1, roughness: 0.22, emissive: new THREE.Color('#5a3a00'), emissiveIntensity: 0.3 });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(HEAD_R * 0.62, HEAD_R * 0.7, 0.1, 24, 1, true), gm);
    band.position.y = HEAD_R * 1.08;
    (gm as THREE.MeshPhysicalMaterial).side = THREE.DoubleSide;
    hc.add(band);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.09, 8), gm);
      spike.position.set(Math.sin(a) * HEAD_R * 0.63, HEAD_R * 1.08 + 0.09, Math.cos(a) * HEAD_R * 0.63);
      hc.add(spike);
      const gem = sphere(0.016, M(i % 2 ? '#e0162b' : '#1a6cff', { roughness: 0.1, clearcoat: 1 }), 8, 6);
      gem.position.set(Math.sin(a) * HEAD_R * 0.7, HEAD_R * 1.07, Math.cos(a) * HEAD_R * 0.7);
      hc.add(gem);
    }
  }

  // ---------------- arms
  const shoulderX = (L.female ? 0.19 : 0.215) * wMul;
  const hands: THREE.Object3D[] = [];
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? 1 : -1;
    const arm = jt(side === 'L' ? 'armL' : 'armR');
    arm.position.set(s * shoulderX, 0.25, 0);
    chest.add(arm);
    const shoulder = sphere(0.075 * limbMul, sleeveM, 16, 12);
    arm.add(shoulder);
    const upper = capsule(0.068 * limbMul, 0.16, sleeveM);
    upper.position.y = -0.11;
    arm.add(upper);
    const fore = jt(side === 'L' ? 'foreL' : 'foreR');
    fore.position.y = -0.24;
    arm.add(fore);
    const long = !!L.jacket || !!L.hoodie;
    const forearm = capsule(0.058 * limbMul, 0.15, long ? sleeveM : skinM);
    forearm.position.y = -0.1;
    fore.add(forearm);
    const hand = jt(side === 'L' ? 'handL' : 'handR');
    hand.position.y = -0.22;
    fore.add(hand);
    const fist = sphere(0.074 * Math.max(1, limbMul * 0.95), skinM, 16, 12);
    fist.scale.set(1, 1.08, 1.15);
    fist.position.y = -0.03;
    hand.add(fist);
    hands.push(hand);
  }

  // ---------------- legs
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? 1 : -1;
    const thigh = jt(side === 'L' ? 'thighL' : 'thighR');
    thigh.position.set(s * 0.09 * wMul, 0, 0);
    hips.add(thigh);
    const tm = capsule(0.085 * limbMul, 0.2, pantsM);
    tm.position.y = -0.15;
    thigh.add(tm);
    const shin = jt(side === 'L' ? 'shinL' : 'shinR');
    shin.position.y = -0.32;
    thigh.add(shin);
    const sm = capsule(0.072 * limbMul, 0.2, pantsM);
    sm.position.y = -0.14;
    shin.add(sm);
    const foot = jt(side === 'L' ? 'footL' : 'footR');
    foot.position.y = -0.3;
    shin.add(foot);
    const shoe = capsule(0.062, 0.12, shoeM, 12);
    shoe.rotation.x = Math.PI / 2;
    shoe.scale.set(1.2, 1, 0.8);
    shoe.position.set(0, -0.02, 0.05);
    foot.add(shoe);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.025, 0.25), M('#f4f4f4', { roughness: 0.6 }));
    sole.position.set(0, -0.065, 0.05);
    foot.add(sole);
  }

  // wheelchair skin: the chair is attached to the root so it stays upright while the upper body fights
  let wheels: THREE.Object3D[] = [];
  let chair: THREE.Group | null = null;
  if (skin.wheelchair) {
    chair = new THREE.Group();
    const frameM = M('#2b2f36', { metalness: 0.8, roughness: 0.3 });
    const seatM = M('#15171b', { roughness: 0.8 });
    const tyreM = M('#101010', { roughness: 0.9 });
    const rimM = M('#c9ced6', { metalness: 1, roughness: 0.25 });
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.44), seatM);
    seat.position.set(0, 0.5, -0.02);
    chair.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.42, 0.05), seatM);
    back.position.set(0, 0.76, -0.25);
    back.rotation.x = -0.12;
    chair.add(back);
    for (const sd of [-1, 1]) {
      const wheel = new THREE.Group();
      const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.03, 10, 36), tyreM);
      tyre.rotation.y = Math.PI / 2;
      wheel.add(tyre);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.012, 6, 36), rimM);
      rim.rotation.y = Math.PI / 2;
      wheel.add(rim);
      for (let k = 0; k < 6; k++) {
        const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.5), rimM);
        spoke.rotation.x = (k / 6) * Math.PI;
        wheel.add(spoke);
      }
      wheel.position.set(sd * 0.3, 0.32, -0.06);
      chair.add(wheel);
      wheels.push(wheel);
      const caster = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16), tyreM);
      caster.rotation.z = Math.PI / 2;
      caster.position.set(sd * 0.2, 0.05, 0.3);
      chair.add(caster);
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5), frameM);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(sd * 0.23, 0.5, 0.08);
      chair.add(rail);
      const push = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5), frameM);
      push.position.set(sd * 0.21, 0.8, -0.28);
      chair.add(push);
    }
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.14), frameM);
    foot.position.set(0, 0.1, 0.38);
    chair.add(foot);
    chair.scale.setScalar(hm);
    root.add(chair);
  }

  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; } });

  return {
    root, body, joints, hipsBaseY: legLen, head: head as THREE.Group, headBob,
    lidL: lids[0], lidR: lids[1], mouthOpen, mouthSmile, materials,
    handL: hands[0], handR: hands[1], height: 1.75 * hm, wheelchair: !!skin.wheelchair, wheels, chair,
  };
}

function buildHair(hc: THREE.Group, L: Look, hairM: THREE.Material, M: (c: string, o?: any) => THREE.Material) {
  const st = L.hairStyle;
  if (st === 'bald') return;
  const capR = HEAD_R * (st === 'buzz' ? 1.012 : 1.04);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(capR, 40, 20, 0, Math.PI * 2, 0, Math.PI * (st === 'buzz' ? 0.44 : 0.47)), hairM);
  cap.rotation.x = -0.32;
  cap.position.set(0, 0.02, -0.01);
  cap.scale.set(1.02, 1.06, 1.04);
  cap.castShadow = true;
  hc.add(cap);
  // sideburns / back of head
  const back = new THREE.Mesh(new THREE.SphereGeometry(capR * 1.005, 32, 16, Math.PI, Math.PI, Math.PI * 0.3, Math.PI * 0.32), hairM);
  back.position.y = 0.0;
  hc.add(back);
  if (st === 'buzz') return;

  const bumps = (n: number, r0: number, r1: number, spread: number, lift: number, seed: number) => {
    for (let i = 0; i < n; i++) {
      const u = hash(seed + i * 3.1) * Math.PI * 2;
      const v = hash(seed + i * 7.7) * spread;
      const r = r0 + hash(seed + i * 1.3) * (r1 - r0);
      const b = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), hairM);
      const rr = HEAD_R * 1.02;
      b.position.set(Math.sin(u) * Math.sin(v) * rr, Math.cos(v) * rr + lift, Math.cos(u) * Math.sin(v) * rr - 0.02);
      if (b.position.z > HEAD_R * 0.55 && b.position.y < HEAD_R * 0.6) continue; // keep forehead clear
      b.castShadow = true;
      hc.add(b);
    }
  };

  switch (st) {
    case 'curly': bumps(46, 0.05, 0.075, 1.25, 0.02, 11); break;
    case 'curlyShort': bumps(34, 0.04, 0.058, 1.1, 0.0, 23); break;
    case 'wavy': bumps(30, 0.06, 0.085, 1.15, 0.03, 37); break;
    case 'messy': {
      bumps(16, 0.05, 0.07, 1.0, 0.02, 51);
      for (let i = 0; i < 14; i++) {
        const u = hash(i * 9.1) * Math.PI * 2;
        const v = 0.2 + hash(i * 4.3) * 0.9;
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 8), hairM);
        const rr = HEAD_R * 1.02;
        c.position.set(Math.sin(u) * Math.sin(v) * rr, Math.cos(v) * rr, Math.cos(u) * Math.sin(v) * rr);
        c.lookAt(c.position.clone().multiplyScalar(2));
        c.rotateX(Math.PI / 2);
        hc.add(c);
      }
      break;
    }
    case 'quiff': {
      const q = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), hairM);
      q.scale.set(1.6, 0.85, 1.2);
      q.position.set(0, HEAD_R * 0.92, HEAD_R * 0.45);
      q.rotation.x = -0.4;
      hc.add(q);
      break;
    }
    case 'sidepart': {
      const q = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), hairM);
      q.scale.set(1.5, 0.7, 1.3);
      q.position.set(-0.06, HEAD_R * 0.9, HEAD_R * 0.35);
      q.rotation.z = 0.3;
      hc.add(q);
      break;
    }
    case 'short': {
      const q = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 14), hairM);
      q.scale.set(1.8, 0.6, 1.5);
      q.position.set(0, HEAD_R * 0.9, HEAD_R * 0.25);
      hc.add(q);
      break;
    }
    case 'long': {
      bumps(18, 0.06, 0.08, 1.1, 0.03, 71);
      const bk = capsule(0.2, 0.18, hairM);
      bk.position.set(0, -0.08, -0.14);
      bk.scale.set(1.25, 1, 0.7);
      hc.add(bk);
      break;
    }
    case 'mop': {
      // shaggy mop-top: bangs over the forehead, locks over the ears, full back
      bumps(22, 0.06, 0.085, 1.2, 0.03, 91);
      const fringe = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM);
      fringe.scale.set(1.45, 0.55, 0.9);
      fringe.rotation.x = 0.9;
      fringe.position.set(0.02, HEAD_R * 0.62, HEAD_R * 0.62);
      hc.add(fringe);
      for (let i = 0; i < 6; i++) {
        const strand = capsule(0.028, 0.07, hairM, 8);
        strand.position.set(-0.13 + i * 0.055, HEAD_R * 0.5 - (i % 2) * 0.015, HEAD_R * 0.86);
        strand.rotation.set(0.35, 0, (i - 2.5) * 0.12);
        hc.add(strand);
      }
      for (const sd of [-1, 1]) {
        const lock = capsule(0.07, 0.12, hairM, 10);
        lock.position.set(sd * HEAD_R * 0.93, 0.05, -0.02);
        lock.rotation.z = sd * 0.12;
        hc.add(lock);
      }
      const bk = capsule(0.19, 0.1, hairM);
      bk.position.set(0, -0.02, -0.16);
      bk.scale.set(1.3, 1, 0.7);
      hc.add(bk);
      break;
    }
    case 'longFemale': {
      const bk = capsule(0.25, 0.42, hairM);
      bk.position.set(0, -0.2, -0.13);
      bk.scale.set(1.18, 1, 0.62);
      hc.add(bk);
      for (const s of [-1, 1]) {
        const strand = capsule(0.07, 0.34, hairM);
        strand.position.set(s * 0.25, -0.2, 0.08);
        strand.rotation.z = s * 0.08;
        hc.add(strand);
      }
      const bangs = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 14), hairM);
      bangs.scale.set(1.8, 0.6, 1);
      bangs.position.set(0.04, HEAD_R * 0.72, HEAD_R * 0.6);
      bangs.rotation.z = -0.25;
      hc.add(bangs);
      break;
    }
  }
}

/** Apply a pose to the rig */
export function applyPose(r: RigParts, p: Pose) {
  const js = r.joints;
  for (let j = 0; j < js.length; j++) {
    const i = j * 3;
    js[j].rotation.set(p[i], p[i + 1], p[i + 2]);
  }
  js[J.hips].position.y = r.hipsBaseY + p[EX_HIPY];
  js[J.hips].position.z = p[EX_HIPZ];
  const mouth = p[EX_MOUTH];
  r.mouthOpen.scale.y = Math.max(0.01, mouth);
  r.mouthSmile.visible = mouth < 0.25;
  const eyes = p[EX_EYES];
  const lid = -1.2 + (1 - eyes) * 1.35;
  r.lidL.rotation.x = lid;
  r.lidR.rotation.x = lid;
}
