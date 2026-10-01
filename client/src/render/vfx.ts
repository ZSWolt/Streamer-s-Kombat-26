import * as THREE from 'three';
import { agoraCoin, agorotShower, cardPack, indeProduct, pokerChip, subathonBoard } from './props';
import { canvasTex } from './textures';

// Emoji billboards give every projectile/prop an instantly readable "chat emote" look.
const emojiCache = new Map<string, THREE.Texture>();
export function emojiTex(e: string, size = 256): THREE.Texture {
  const key = e + size;
  let t = emojiCache.get(key);
  if (t) return t;
  if (e === '#vending') {
    // a vending machine (there is no emoji for it)
    t = canvasTex(size, size, (g, w, h) => {
      const x0 = w * 0.2, y0 = h * 0.04, bw = w * 0.6, bh = h * 0.92;
      g.fillStyle = '#c8101a'; g.fillRect(x0, y0, bw, bh);
      g.fillStyle = '#7a0a10'; g.fillRect(x0 + bw * 0.78, y0 + bh * 0.1, bw * 0.16, bh * 0.5);
      g.fillStyle = '#1b2230'; g.fillRect(x0 + bw * 0.06, y0 + bh * 0.1, bw * 0.66, bh * 0.62);
      const cols = ['#ffd84d', '#53fc18', '#ff7a2f', '#4dabf7', '#f783ac'];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
        g.fillStyle = cols[(r * 3 + c) % cols.length];
        g.fillRect(x0 + bw * (0.1 + c * 0.2), y0 + bh * (0.13 + r * 0.14), bw * 0.14, bh * 0.09);
      }
      g.fillStyle = '#0b0b0e'; g.fillRect(x0 + bw * 0.1, y0 + bh * 0.8, bw * 0.55, bh * 0.1);
      g.fillStyle = '#fff'; g.font = `900 ${Math.floor(size * 0.085)}px "Bebas Neue", Impact`; g.textAlign = 'center';
      g.fillText('MAOR', x0 + bw * 0.5, y0 + bh * 0.08);
    });
    emojiCache.set(key, t);
    return t;
  }
  t = canvasTex(size, size, (g, w, h) => {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `${Math.floor(size * 0.78)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    g.shadowColor = 'rgba(0,0,0,0.5)';
    g.shadowBlur = size * 0.06;
    g.fillText(e, w / 2, h / 2 + size * 0.04);
  });
  emojiCache.set(key, t);
  return t;
}

export function textSpriteTex(text: string, color: string, stroke = '#000', font = '"Bebas Neue", Impact, sans-serif', w = 1024, h = 256): THREE.Texture {
  return canvasTex(w, h, (g) => {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = h * 0.8;
    g.font = `900 ${size}px ${font}`;
    while (g.measureText(text).width > w * 0.95 && size > 10) { size -= 4; g.font = `900 ${size}px ${font}`; }
    g.lineWidth = size * 0.12;
    g.strokeStyle = stroke;
    g.lineJoin = 'round';
    g.strokeText(text, w / 2, h / 2);
    g.fillStyle = color;
    g.shadowColor = color;
    g.shadowBlur = 24;
    g.fillText(text, w / 2, h / 2);
  });
}

export const PROJECTILE_EMOJI: Record<string, string> = {
  microwave: '📦', tornado: '🌪️', headset: '🎧', noobs: '🤓', zzz: '💤', car: '🚗', shockwave: '💥', bomb: '💣',
  hypno: '🌀', cards: '🃏', snipe: '🃏', quake: '💥', dog: '🐕', football: '⚽', pctower: '🖥️', cake: '🎂', dice: '🎲',
  scream: '📢', concards: '🃏', chips: '🪙', indegear: '🎧', subathon: '⏱️', bottle: '🍾',
  agorot: '🪙', coinroll: '🪙', coinrain: '🪙',
};
/** projectiles drawn as real 3D props (render/props.ts) instead of emoji billboards */
const PROP_KEYS = new Set(['concards', 'chips', 'indegear', 'subathon', 'agorot', 'coinroll', 'coinrain']);

interface Particle {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  life: number;
  max: number;
  spin: number;
  grow: number;
  fade: boolean;
  gravity: number;
  baseScale: number;
}

export class Vfx {
  group = new THREE.Group();
  private parts: Particle[] = [];
  private projMeshes = new Map<number, THREE.Object3D>();
  private sparkTex = canvasTex(128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,240,200,0.9)'); grd.addColorStop(1, 'rgba(255,160,40,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  private starTex = canvasTex(256, 256, (g, w, h) => {
    g.translate(w / 2, h / 2);
    g.fillStyle = '#fff';
    g.shadowColor = '#fff'; g.shadowBlur = 20;
    for (let i = 0; i < 8; i++) {
      g.rotate(Math.PI / 4);
      g.beginPath(); g.moveTo(0, -8); g.lineTo(i % 2 ? 60 : 118, 0); g.lineTo(0, 8); g.closePath(); g.fill();
    }
  });
  private ringTex = canvasTex(256, 256, (g, w, h) => {
    g.strokeStyle = '#fff'; g.lineWidth = 14; g.shadowColor = '#fff'; g.shadowBlur = 20;
    g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 20, 0, Math.PI * 2); g.stroke();
  });
  private dustTex = canvasTex(128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(200,190,180,0.6)'); grd.addColorStop(1, 'rgba(200,190,180,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  embers: THREE.Points;

  constructor(accent = '#ffae42') {
    const n = 220;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 24; pos[i * 3 + 1] = Math.random() * 8; pos[i * 3 + 2] = -1 - Math.random() * 9; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.embers = new THREE.Points(geo, new THREE.PointsMaterial({ color: accent, size: 0.05, map: this.sparkTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.group.add(this.embers);
  }

  private sprite(tex: THREE.Texture, color: string | THREE.Color, size: number, additive = true) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, depthTest: !additive ? true : false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    s.scale.set(size, size, 1);
    s.renderOrder = 10;
    return s;
  }

  private add(obj: THREE.Object3D, o: Partial<Particle> & { life: number }) {
    this.group.add(obj);
    this.parts.push({ obj, vel: o.vel ?? new THREE.Vector3(), life: o.life, max: o.life, spin: o.spin ?? 0, grow: o.grow ?? 0, fade: o.fade ?? true, gravity: o.gravity ?? 0, baseScale: obj.scale.x });
  }

  hitSpark(x: number, y: number, heavy: number, blocked: boolean, color?: string) {
    const col = blocked ? '#7fd3ff' : color ?? (heavy >= 2 ? '#ffb13b' : '#fff1c4');
    const z = 0.6;
    const flash = this.sprite(this.sparkTex, col, 0.9 + heavy * 0.6);
    flash.position.set(x, y, z);
    this.add(flash, { life: 0.14 + heavy * 0.03, grow: 6 });
    const star = this.sprite(this.starTex, col, 0.7 + heavy * 0.5);
    star.position.set(x, y, z + 0.01);
    star.material.rotation = Math.random() * Math.PI;
    this.add(star, { life: 0.16 + heavy * 0.04, grow: 5, spin: 8 });
    const ring = this.sprite(this.ringTex, col, 0.3);
    ring.position.set(x, y, z);
    this.add(ring, { life: 0.22, grow: 9 + heavy * 4 });
    const n = blocked ? 6 : 8 + heavy * 8;
    for (let i = 0; i < n; i++) {
      const p = this.sprite(this.sparkTex, col, 0.08 + Math.random() * 0.08);
      p.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * (4 + heavy * 4);
      this.add(p, { life: 0.25 + Math.random() * 0.3, vel: new THREE.Vector3(Math.cos(a) * sp, Math.sin(a) * sp + 1.5, (Math.random() - 0.5) * 2), gravity: 9 });
    }
  }

  dust(x: number, big = false) {
    for (let i = 0; i < (big ? 10 : 5); i++) {
      const d = this.sprite(this.dustTex, '#bdb3a6', 0.5 + Math.random() * 0.5, false);
      d.position.set(x + (Math.random() - 0.5) * 0.6, 0.15, 0.3 + Math.random() * 0.3);
      this.add(d, { life: 0.6 + Math.random() * 0.4, vel: new THREE.Vector3((Math.random() - 0.5) * 3, 0.6 + Math.random(), 0), grow: 1.5 });
    }
  }

  emote(x: number, y: number, e: string, size = 0.6) {
    const s = this.sprite(emojiTex(e), '#ffffff', size, false);
    s.position.set(x + (Math.random() - 0.5) * 0.8, y, 0.8);
    this.add(s, { life: 1.4, vel: new THREE.Vector3((Math.random() - 0.5) * 0.8, 1.6 + Math.random(), 0), grow: 0.2 });
  }

  floatText(x: number, y: number, text: string, color: string, size = 1.2) {
    const tex = textSpriteTex(text, color);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    s.scale.set(size * 4, size, 1);
    s.position.set(x, y, 1);
    s.renderOrder = 20;
    this.add(s, { life: 1.1, vel: new THREE.Vector3(0, 1.2, 0), grow: 0.25 });
  }

  bigProp(e: string, x: number, y: number, size: number, vel: THREE.Vector3, life: number, spin = 0) {
    const s = this.sprite(emojiTex(e, 512), '#ffffff', size, false);
    s.position.set(x, y, 0.9);
    this.add(s, { life, vel, spin, fade: true });
    return s;
  }

  burst(x: number, y: number, e: string, n: number, speed = 6, size = 0.5) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = this.sprite(emojiTex(e), '#ffffff', size * (0.6 + Math.random() * 0.8), false);
      s.position.set(x, y, 0.9 + Math.random() * 0.3);
      this.add(s, { life: 0.9 + Math.random() * 0.6, vel: new THREE.Vector3(Math.cos(a) * speed * Math.random(), Math.sin(a) * speed * Math.random() + 3, 0), gravity: 8, spin: (Math.random() - 0.5) * 8 });
    }
  }

  rain(e: string, cx: number, n: number, size = 0.6) {
    for (let i = 0; i < n; i++) {
      const s = this.sprite(emojiTex(e), '#ffffff', size * (0.7 + Math.random() * 0.6), false);
      s.position.set(cx + (Math.random() - 0.5) * 12, 6 + Math.random() * 4, 0.4 + Math.random());
      this.add(s, { life: 2 + Math.random(), vel: new THREE.Vector3((Math.random() - 0.5), -3 - Math.random() * 3, 0), spin: (Math.random() - 0.5) * 4 });
    }
  }

  /** Sync projectile meshes with sim projectiles */
  syncProjectiles(projs: { id: number; x: number; y: number; vx: number; vfx: string; w: number; h: number; kind: string; reflected: boolean; age: number }[], t: number) {
    const alive = new Set<number>();
    for (const p of projs) {
      alive.add(p.id);
      let o = this.projMeshes.get(p.id);
      const key = p.vfx.split(':')[0];
      if (!o) {
        o = PROP_KEYS.has(key) ? this.makeProp(key, p.w / 1000, p.h / 1000, p.id, p.vfx) : this.makeProjectile(key, p.w / 1000, p.h / 1000, p.kind);
        this.projMeshes.set(p.id, o);
        this.group.add(o);
      }
      o.position.set(p.x / 1000, p.y / 1000, 0.3);
      const flip = p.vx < 0 ? -1 : 1;
      const prop = o.userData.prop as (THREE.Object3D & { tick?: (t: number) => void }) | undefined;
      if (prop) {
        const ph = p.id * 1.7, a = t * 60; // tumble in the air, each one out of phase with the others
        if (key === 'concards') prop.rotation.set(0, Math.sin(a * 0.09 + ph) * 0.7, flip * (a * 0.13 + ph));
        else if (key === 'chips') prop.rotation.set(Math.sin(a * 0.05 + ph) * 0.5, a * 0.21 + ph, flip * a * 0.04);
        else if (key === 'indegear') prop.rotation.set(a * 0.06 + ph, a * 0.09, flip * a * 0.05);
        else if (key === 'agorot') prop.rotation.set(a * 0.17 + ph, a * 0.23 + ph * 2, flip * a * 0.05);
        else if (key === 'coinroll') prop.rotation.set(0, Math.sin(a * 0.05) * 0.25 + 0.35, -p.x / (p.h / 2)); // rolls: turn = distance / radius
        else if (key === 'coinrain') {
          for (const c of prop.children) { const sp = c.userData.spin as number[]; c.rotation.set(a * 0.05 * sp[0] + sp[2], a * 0.05 * sp[1], sp[2]); }
        }
        else prop.rotation.set(Math.sin(a * 0.05) * 0.08, Math.sin(a * 0.04) * 0.18, Math.sin(a * 0.07) * 0.06);
        prop.tick?.(t);
      }
      const spr = o.userData.sprite as THREE.Sprite | undefined;
      if (spr) {
        const spin = o.userData.spin as number;
        spr.material.rotation = spin ? t * spin * flip : 0;
        const base = o.userData.base as number;
        spr.scale.set(base * (key === 'car' || key === 'dog' ? -flip : 1), base, 1);
        if (key === 'tornado' || key === 'scream' || key === 'hypno') spr.material.rotation = t * 10;
      }
      const halo = o.userData.halo as THREE.Sprite | undefined;
      if (halo) halo.material.opacity = prop ? 0.2 + Math.sin(t * 20) * 0.06 : 0.6 + Math.sin(t * 20) * 0.2;
      if (p.reflected && !o.userData.refl) { o.userData.refl = true; (halo?.material as THREE.SpriteMaterial)?.color.set('#7fd3ff'); }
    }
    for (const [id, o] of this.projMeshes) {
      if (!alive.has(id)) {
        this.group.remove(o);
        (o.userData.prop?.userData.dispose as (() => void) | undefined)?.();
        this.projMeshes.delete(id);
      }
    }
  }

  private makeProp(key: string, w: number, h: number, id: number, vfx: string): THREE.Object3D {
    const g = new THREE.Group();
    const size = Math.max(w, h);
    let prop: THREE.Object3D;
    if (key === 'concards') { prop = cardPack(); prop.scale.setScalar(size * 1.3); }
    else if (key === 'chips') { prop = pokerChip(Number(vfx.split(':')[1] ?? 1 + (id % 6))); prop.scale.setScalar(size * 1.15); }
    else if (key === 'indegear') { prop = indeProduct(id); prop.scale.setScalar(size * 1.45); }
    else if (key === 'agorot') { prop = agoraCoin(id); prop.scale.setScalar(size * 1.2); }
    else if (key === 'coinroll') { prop = agoraCoin(0); prop.scale.setScalar(size); }
    else if (key === 'coinrain') { prop = agorotShower(); prop.scale.setScalar(size * 1.5); }
    else { prop = subathonBoard(); prop.scale.setScalar(size * 1.9); }
    if (key !== 'subathon' && key !== 'coinrain') {
      const coin = key === 'chips' || key === 'agorot' || key === 'coinroll';
      const halo = this.sprite(this.sparkTex, key === 'indegear' ? '#27a6ff' : coin ? '#ffd27a' : '#ff5fd2', size * 1.7);
      halo.material.opacity = 0.2;
      halo.position.z = -0.15;
      g.add(halo);
      g.userData.halo = halo;
    }
    g.add(prop);
    g.userData.prop = prop;
    return g;
  }

  private makeProjectile(key: string, w: number, h: number, kind: string): THREE.Object3D {
    const g = new THREE.Group();
    const e = PROJECTILE_EMOJI[key] ?? '✨';
    const size = Math.max(w, h) * (kind === 'summon' ? 1.05 : 1.25);
    const halo = this.sprite(this.sparkTex, key === 'hypno' ? '#b56bff' : '#ffd27a', size * 1.5);
    halo.material.opacity = 0.7;
    if (kind !== 'summon' && kind !== 'drop') g.add(halo);
    if (key === 'quake' || key === 'shockwave') {
      const ring = this.sprite(this.ringTex, '#ffcc66', size);
      g.add(ring);
      g.userData.sprite = ring; g.userData.base = size; g.userData.spin = 0;
      return g;
    }
    const s = this.sprite(emojiTex(e, 256), '#ffffff', size, false);
    g.add(s);
    if (key === 'noobs') {
      const s2 = this.sprite(emojiTex('🤪', 256), '#ffffff', size * 0.8, false);
      s2.position.set(-0.5, -0.1, -0.1);
      g.add(s2);
    }
    g.userData.sprite = s;
    g.userData.halo = kind !== 'summon' ? halo : undefined;
    g.userData.base = size;
    g.userData.spin = ['microwave', 'headset', 'cards', 'snipe', 'dice', 'cake', 'bomb', 'football'].includes(key) ? 9 : 0;
    return g;
  }

  update(dt: number, t: number) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.group.remove(p.obj);
        const s = p.obj as THREE.Sprite;
        if (s.material) (s.material as THREE.Material).dispose();
        this.parts.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.obj.position.addScaledVector(p.vel, dt);
      const k = p.life / p.max;
      const sc = p.obj.scale.x + p.grow * dt * p.baseScale;
      p.obj.scale.set(sc, (p.obj.scale.y / Math.max(1e-4, p.obj.scale.x)) * sc, 1);
      const spr = p.obj as THREE.Sprite;
      if (spr.material) {
        if (p.fade) (spr.material as THREE.SpriteMaterial).opacity = Math.min(1, k * 1.6);
        if (p.spin) (spr.material as THREE.SpriteMaterial).rotation += p.spin * dt;
      }
    }
    const pos = this.embers.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + dt * (0.3 + (i % 7) * 0.08);
      if (y > 8) y = 0;
      pos.setY(i, y);
      pos.setX(i, pos.getX(i) + Math.sin(t + i) * dt * 0.1);
    }
    pos.needsUpdate = true;
  }

  clear() {
    for (const p of this.parts) this.group.remove(p.obj);
    this.parts = [];
    for (const o of this.projMeshes.values()) this.group.remove(o);
    this.projMeshes.clear();
  }
}
