import * as THREE from 'three';
import { audio } from '../audio/AudioEngine';
import { announcer } from '../audio/announcer';
import { ROSTER } from '../data/roster';
import type { MatchState } from '../sim/types';
import type { Hud } from '../ui/Hud';
import type { CameraDirector } from './CameraDirector';
import type { ProceduralFighterView } from './FighterView';
import * as P from './pose';
import type { Renderer } from './Renderer';
import type { Vfx } from './vfx';

type Style = 'rain' | 'barrage' | 'drop' | 'burst' | 'swarm';
const HYPE: Record<string, { e: string[]; text: string; color: string; style: Style }> = {
  birthday: { e: ['🎂', '🎉', '🎈'], text: 'STAY AWESOME!', color: '#ffd84d', style: 'rain' },
  rocky: { e: ['🥊'], text: '80,000!', color: '#ff4d4d', style: 'barrage' },
  playbutton: { e: ['▶️'], text: '1,000,000 SUBS', color: '#ff2a2a', style: 'drop' },
  wheel: { e: ['🎡', '🍀', '⭐'], text: 'WHEEL OF FORTUNE', color: '#53fc18', style: 'burst' },
  karmaboom: { e: ['🔁', '✨'], text: 'KARMA!', color: '#b98cff', style: 'barrage' },
  police: { e: ['🚓', '🚁', '⭐'], text: '★★★★★ WANTED', color: '#4dabf7', style: 'swarm' },
  nice: { e: ['😇', '😈'], text: 'NOT NICE ANYMORE', color: '#ffd84d', style: 'burst' },
  devil: { e: ['😈'], text: 'עידן חדש', color: '#a347ff', style: 'drop' },
  legendary: { e: ['🃏', '🐉', '✨'], text: 'LEGENDARY PULL', color: '#ffd84d', style: 'burst' },
  lava: { e: ['🔥', '🌋'], text: 'LAVA BUCKET', color: '#ff7a2f', style: 'rain' },
  speedrun: { e: ['⏱️', '💨'], text: 'ANY% WORLD RECORD', color: '#53fc18', style: 'barrage' },
  boiz: { e: ['🧑', '👦', '🧔'], text: 'THE BOIZ!', color: '#cc5de8', style: 'swarm' },
  pickaxe: { e: ['⛏️', '💎'], text: 'CARRY!', color: '#4dd9ff', style: 'barrage' },
  truck: { e: ['🚚', '🍫'], text: 'מיליון שוקולדים!', color: '#ff4d4d', style: 'swarm' },
  redcarpet: { e: ['📸', '⭐'], text: 'THE PREMIERE', color: '#ffd84d', style: 'burst' },
  blizzard: { e: ['❄️', '🧊'], text: 'BLIZZARD!', color: '#9fe3ff', style: 'rain' },
  pinkmoney: { e: ['💸', '💖'], text: '10,000 ₪!', color: '#ff6fb5', style: 'rain' },
};

interface Active {
  kind: 'hype' | 'banality';
  key: string;
  t: number;
  dur: number;
  att: number;
  fired: Set<number>;
  hitTimer: number;
}

export class Cinematics {
  active: Active | null = null;

  constructor(private vfx: Vfx, private cam: CameraDirector, private renderer: Renderer, private hud: Hud) {}

  start(kind: 'hype' | 'banality', key: string, att: number) {
    this.active = { kind, key, t: 0, dur: kind === 'hype' ? 140 / 60 : 300 / 60, att, fired: new Set(), hitTimer: 0 };
  }

  get running() { return !!this.active; }

  private once(id: number, at: number, fn: () => void) {
    const a = this.active!;
    if (a.t >= at && !a.fired.has(id)) { a.fired.add(id); fn(); }
  }

  update(dt: number, m: MatchState, views: ProceduralFighterView[]) {
    const a = this.active;
    if (!a) return;
    a.t += dt;
    const att = views[a.att];
    const def = views[1 - a.att];
    const ap = att.root.position;
    const dp = def.root.position;
    const mid = ap.clone().add(dp).multiplyScalar(0.5);
    mid.y = 1.2;
    const dir = Math.sign(dp.x - ap.x) || 1;

    if (a.kind === 'hype') {
      const H = HYPE[a.key] ?? HYPE.birthday;
      this.cam.mode = 'focus';
      this.cam.focusTarget.copy(mid);
      this.cam.focusDist = 4.2 - Math.min(1, a.t) * 0.8;
      this.cam.focusSide = -dir;
      // attacker flurry poses
      const k = (Math.sin(a.t * 22) + 1) / 2;
      att.setOverride(P.lerpPose(P.ATTACKS.hype.wind, P.ATTACKS.hype.hit, k, new Float32Array(P.POSE_LEN)));
      def.setOverride(P.lerpPose(P.HIT_MID, P.HIT_HIGH, (Math.sin(a.t * 18) + 1) / 2, new Float32Array(P.POSE_LEN)));
      a.hitTimer -= dt;
      if (a.t < a.dur - 0.45 && a.hitTimer <= 0) {
        a.hitTimer = 0.16;
        this.vfx.hitSpark(dp.x - dir * 0.2, 1.1 + Math.random() * 0.6, 1, false, H.color);
        audio.sfx(Math.random() < 0.5 ? 'hitM' : 'hitL', dir * 0.3, 0.8);
        this.cam.shake(0.35);
        const e = H.e[Math.floor(Math.random() * H.e.length)];
        switch (H.style) {
          case 'rain': this.vfx.rain(e, dp.x, 2, 0.8); break;
          case 'barrage': this.vfx.bigProp(e, ap.x + dir * 0.4, 1.3 + Math.random() * 0.5, 0.7, new THREE.Vector3(dir * 12, 0, 0), 0.35); break;
          case 'burst': this.vfx.burst(dp.x, 1.3, e, 3, 6, 0.6); break;
          case 'swarm': this.vfx.bigProp(e, ap.x - dir * 5, 0.6 + Math.random() * 1.2, 1.2, new THREE.Vector3(dir * 14, 0, 0), 0.9); break;
          case 'drop': break;
        }
      }
      this.once(1, 0.02, () => { this.hud.bigText(H.text, '', 'hype-text', 2100); audio.sfx('hype'); this.renderer.flash(H.color, 0.5, 300); });
      if (H.style === 'drop') this.once(2, 0.9, () => {
        this.vfx.bigProp(H.e[0], dp.x, 7, 3.2, new THREE.Vector3(0, -14, 0), 0.5);
      });
      this.once(3, a.dur - 0.4, () => {
        this.renderer.flash('#ffffff', 0.9, 250);
        this.cam.shake(1.2);
        this.cam.punch(1.2);
        this.renderer.kickChroma(0.012);
        audio.sfx('hitX', dir * 0.3, 1.2);
        this.vfx.burst(dp.x, 1.3, H.e[0], 14, 9, 0.7);
        this.vfx.hitSpark(dp.x, 1.3, 3, false, H.color);
      });
      if (a.t >= a.dur) this.end(views);
      return;
    }

    // ---------------- banality
    const key = a.key;
    const f = ROSTER[m.f[a.att].char];
    this.cam.mode = a.t < 1.2 ? 'orbit' : 'focus';
    this.cam.focusTarget.copy(a.t < 1.2 ? mid : dp.clone().setY(1.1));
    this.cam.focusDist = a.t < 1.2 ? 5 : 3.6;
    this.cam.focusSide = -dir;
    const pose = new Float32Array(P.POSE_LEN);
    if (a.t < 0.9) att.setOverride(P.lerpPose(P.GUARD, P.TAUNT, Math.min(1, a.t * 2), pose));
    else if (a.t < 1.4) att.setOverride(P.ATTACKS.hype.hit);
    else att.setOverride(P.WIN2);
    if (!def.fx.hidden) def.setOverride(P.DIZZY);

    this.once(10, 0.05, () => { this.renderer.flash('#000000', 0.6, 600); this.hud.bigText('', '', '', 10); });
    this.once(11, 1.0, () => { audio.sfx('special', 0, 1); this.cam.shake(0.4); });

    const dropProp = (e: string, at: number, squash = 0.12, size = 3.2) => {
      this.once(20, at, () => this.vfx.bigProp(e, dp.x, 7, size, new THREE.Vector3(0, -16, 0), 0.45));
      this.once(21, at + 0.4, () => { def.fx.squash = squash; audio.sfx('slam'); this.cam.shake(1.1); this.vfx.dust(dp.x, true); this.vfx.hitSpark(dp.x, 0.5, 3, false); });
    };
    const sink = (e: string, at: number) => {
      if (a.t > at) { def.fx.offsetY = Math.max(-2.6, def.fx.offsetY - dt * 1.6); if (Math.random() < 0.3) this.vfx.burst(dp.x, 0.2, e, 1, 4, 0.5); }
      this.once(22, at, () => audio.sfx('knockdown'));
    };

    switch (key) {
      case 'monitor': dropProp('🖥️', 1.3, 0.1, 3.4); this.once(30, 2.2, () => { def.fx.hidden = true; this.hud.bigText('END STREAM', '', 'banality-sub', 1400); }); break;
      case 'breaking': dropProp('📰', 1.3, 0.1); this.once(30, 1.5, () => this.hud.bigText('BREAKING NEWS', 'חדשות: ' + ROSTER[m.f[1 - a.att].char].he + ' הושמד', 'breaking', 2000)); break;
      case 'kid':
        this.once(30, 1.1, () => this.vfx.bigProp('👦', ap.x - dir * 4, 0.9, 1.6, new THREE.Vector3(dir * 12, 0, 0), 0.6));
        this.once(31, 1.6, () => { audio.sfx('hitX'); this.renderer.flash('#fff', 0.8, 200); this.vfx.hitSpark(dp.x, 1.2, 3, false); });
        if (a.t > 1.6) { def.fx.offsetY += dt * 9; def.fx.spin += dt * 20; }
        break;
      case 'sleep24':
        this.once(30, 1.1, () => this.vfx.bigProp('⏰', dp.x, 3.2, 1.6, new THREE.Vector3(0, 0, 0), 2.5, 12));
        if (a.t > 1.8) { def.setOverride(P.LYING); if (Math.random() < 0.05) this.vfx.emote(dp.x, 1, '💤', 0.7); }
        break;
      case 'denied': dropProp('⛔', 1.3, 0.08, 3.6); this.once(30, 1.8, () => this.hud.bigText('DENIED', 'UNBAN REQUEST', 'denied', 1600)); break;
      case 'mission':
        this.once(30, 1.3, () => { audio.sfx('hitX'); this.vfx.hitSpark(dp.x, 1.2, 3, false); });
        if (a.t > 1.3) { def.fx.offsetY += dt * 7; def.fx.spin += dt * 14; }
        this.once(31, 2.0, () => this.hud.bigText('MISSION PASSED!', 'RESPECT +', 'mission', 2200));
        break;
      case 'crown': dropProp('👑', 1.3, 0.1, 3.8); break;
      case 'ending':
        this.once(30, 1.3, () => { this.renderer.flash('#7a2cff', 0.9, 1500); this.hud.bigText('THE STREAM IS', 'ENDING', 'ending', 2400); });
        if (a.t > 1.6) { def.fx.shrink = Math.max(0.01, def.fx.shrink - dt * 0.8); def.fx.spin += dt * 10; }
        if (a.t > 2.8) def.fx.hidden = true;
        break;
      case 'graded':
        this.once(30, 1.3, () => { this.vfx.bigProp('🃏', dp.x, 1.2, 3.6, new THREE.Vector3(0, 0, 0), 2.6); def.fx.tint.set('#8899aa'); def.fx.tintAmt = 0.8; audio.sfx('glass'); });
        this.once(31, 1.8, () => this.hud.bigText('GRADED 10', 'GEM MINT', 'graded', 1800));
        break;
      case 'lavapit': this.once(30, 1.2, () => this.vfx.burst(dp.x, 0.2, '🔥', 20, 7, 0.8)); sink('🔥', 1.3); break;
      case 'unboxing': dropProp('📦', 1.3, 0.2, 3.2); this.once(30, 1.8, () => { def.fx.hidden = true; this.hud.bigText('FRAGILE', 'THIS SIDE UP', 'unboxing', 1600); }); break;
      case 'oven':
        this.once(30, 1.3, () => { this.vfx.burst(dp.x, 1.2, '💥', 10, 8, 1); this.vfx.burst(dp.x, 1.2, '🔥', 12, 6, 0.8); audio.sfx('ko'); this.renderer.flash('#ff7a2f', 0.9, 400); def.fx.tint.set('#000000'); def.fx.tintAmt = 0.92; });
        if (a.t > 1.5 && Math.random() < 0.08) this.vfx.emote(dp.x, 1.8, '💨', 0.8);
        break;
      case 'uwu':
        this.once(30, 1.3, () => { this.vfx.burst(dp.x, 1.2, '🌸', 18, 6, 0.7); this.hud.bigText('UWU', '', 'uwu', 1800); audio.sfx('alert'); });
        if (a.t > 1.3) def.fx.shrink = Math.max(0.35, def.fx.shrink - dt * 1.5);
        break;
      case 'treasure':
        if (a.t > 1.1 && a.t < 3.4 && Math.random() < 0.6) this.vfx.rain('🪙', dp.x, 1, 0.6);
        sink('🪙', 1.8);
        break;
      case 'credits':
        this.once(30, 1.3, () => { this.hud.bigText('THE END', 'בימוי: ' + f.he + ' · הפקה: סולטיז · תודה שצפיתם', 'credits', 2600); });
        if (a.t > 1.3) def.setOverride(P.LYING);
        break;
      case 'frozen':
        this.once(30, 1.2, () => { def.fx.tint.set('#6fd3ff'); def.fx.tintAmt = 0.9; audio.sfx('glass'); });
        this.once(31, 2.4, () => { def.fx.hidden = true; this.vfx.burst(dp.x, 1.2, '🧊', 18, 9, 0.7); this.vfx.burst(dp.x, 1.2, '❄️', 12, 7, 0.6); audio.sfx('glass'); this.cam.shake(0.8); });
        break;
      case 'pool':
        this.once(30, 1.2, () => this.hud.bigText('תיפול לבריכה!', '', 'pool', 1600));
        sink('💦', 1.4);
        break;
      default: dropProp('💥', 1.3); break;
    }

    this.once(90, 3.6, () => {
      this.hud.bigText(ROSTER[m.f[a.att].char].banality.en, 'BANALITY!', 'banality', 2600);
      announcer.sayNow('banality');
      audio.sfx('ko', 0, 0.8);
      this.renderer.flash('#ffd84d', 0.5, 500);
    });
    if (a.t >= a.dur) this.end(views);
  }

  end(views: ProceduralFighterView[]) {
    if (!this.active) return;
    const kind = this.active.kind;
    this.active = null;
    this.cam.mode = 'fight';
    for (const v of views) v.setOverride(null);
    if (kind === 'hype') {
      for (const v of views) { v.fx.squash = 1; v.fx.offsetY = 0; v.fx.spin = 0; v.fx.shrink = 1; v.fx.tintAmt = 0; v.fx.hidden = false; }
    }
  }
}
