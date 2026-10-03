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
  speedrun: { e: ['⏱️', '💨'], text: 'ANY% WORLD RECORD', color: '#53fc18', style: 'barrage' },
  boiz: { e: ['🧑', '👦', '🧔'], text: 'THE BOIZ!', color: '#cc5de8', style: 'swarm' },
  pickaxe: { e: ['⛏️', '💎'], text: 'CARRY!', color: '#4dd9ff', style: 'barrage' },
  shekel: { e: ['🪙'], text: 'שקל שלם!', color: '#e0aa2a', style: 'rain' },
  rampage: { e: ['👊', '💥'], text: 'RAMPAGE!', color: '#e8b646', style: 'barrage' },
  highnoon: { e: ['🤠', '⭐', '🌵'], text: 'HIGH NOON', color: '#ffb347', style: 'burst' },
  pizzaprod: { e: ['🍕', '#record', '🎵'], text: 'פיצה הפקות!', color: '#ff8a1f', style: 'rain' },
  chicken: { e: ['🍗', '🍗', '🍟'], text: 'מת על עוף!', color: '#ffb347', style: 'rain' },
  freestyle: { e: ['🎤', '🔥', '🎵'], text: '3AM FREESTYLE', color: '#53fc18', style: 'barrage' },
  unbox: { e: ['🎁', '✨', '📦'], text: 'הפתיחה הכי מטורפת!', color: '#3fc6ff', style: 'burst' },
  noidea: { e: ['❓', '🤷', '🐕'], text: 'אין לי מושג!', color: '#ffb300', style: 'swarm' },
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

interface Ctx {
  a: Active; dt: number; dp: THREE.Vector3; ap: THREE.Vector3; dir: number;
  def: ProceduralFighterView; att: ProceduralFighterView;
  once: (id: number, at: number, fn: () => void) => void;
  drop: (e: string, at: number, squash?: number, size?: number) => void;
  sink: (e: string, at: number) => void;
  fly: (at: number) => void;
  run: (e: string, at: number, size?: number) => void;
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
      const k = (Math.sin(a.t * 22) + 1) / 2;
      att.setOverride(P.lerpPose(att.lib.ATTACKS.hype.wind, att.lib.ATTACKS.hype.hit, k, new Float32Array(P.POSE_LEN)));
      def.setOverride(P.lerpPose(def.lib.HIT_MID, def.lib.HIT_HIGH, (Math.sin(a.t * 18) + 1) / 2, new Float32Array(P.POSE_LEN)));
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
      if (H.style === 'drop') this.once(2, 0.9, () => { this.vfx.bigProp(H.e[0], dp.x, 7, 3.2, new THREE.Vector3(0, -14, 0), 0.5); });
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
    this.cam.mode = a.t < 1.2 ? 'orbit' : 'focus';
    this.cam.focusTarget.copy(a.t < 1.2 ? mid : dp.clone().setY(1.1));
    this.cam.focusDist = a.t < 1.2 ? 5 : 3.6;
    this.cam.focusSide = -dir;
    const pose = new Float32Array(P.POSE_LEN);
    if (a.t < 0.9) att.setOverride(P.lerpPose(att.lib.GUARD, att.lib.TAUNT, Math.min(1, a.t * 2), pose));
    else if (a.t < 1.4) att.setOverride(att.lib.ATTACKS.hype.hit);
    else att.setOverride(att.lib.WIN2);
    if (!def.fx.hidden) def.setOverride(def.lib.DIZZY);

    this.once(10, 0.05, () => { this.renderer.flash('#000000', 0.6, 600); });
    this.once(11, 1.0, () => { audio.sfx('special', 0, 1); this.cam.shake(0.4); });

    const ctx: Ctx = {
      a, dt, dp, ap, dir, def, att,
      once: (id, at, fn) => this.once(id, at, fn),
      drop: (e, at, squash = 0.12, size = 3.2) => {
        this.once(20, at, () => this.vfx.bigProp(e, dp.x, 7, size, new THREE.Vector3(0, -16, 0), 0.45));
        this.once(21, at + 0.4, () => { def.fx.squash = squash; audio.sfx('slam'); this.cam.shake(1.1); this.vfx.dust(dp.x, true); this.vfx.hitSpark(dp.x, 0.5, 3, false); });
      },
      sink: (e, at) => {
        if (a.t > at) { def.fx.offsetY = Math.max(-2.6, def.fx.offsetY - dt * 1.6); if (Math.random() < 0.3) this.vfx.burst(dp.x, 0.2, e, 1, 4, 0.5); }
        this.once(22, at, () => audio.sfx('knockdown'));
      },
      fly: (at) => { if (a.t > at) { def.fx.offsetY += dt * 8; def.fx.spin += dt * 18; } },
      run: (e, at, size = 1.6) => this.once(23, at, () => this.vfx.bigProp(e, ap.x - dir * 4, 0.9, size, new THREE.Vector3(dir * 12, 0, 0), 0.7)),
    };
    const hit = (id: number, at: number, color = '#ffffff') => this.once(id, at, () => { audio.sfx('hitX'); this.renderer.flash(color, 0.8, 200); this.vfx.hitSpark(dp.x, 1.2, 3, false); this.cam.shake(0.9); });
    const text = (id: number, at: number, main: string, sub = '', cls = '', ms = 1800) => this.once(id, at, () => this.hud.bigText(main, sub, cls, ms));
    const tint = (id: number, at: number, color: string, amt = 0.9, sfx = 'glass') => this.once(id, at, () => { def.fx.tint.set(color); def.fx.tintAmt = amt; audio.sfx(sfx); });
    const vanish = (id: number, at: number, e: string, e2?: string) => this.once(id, at, () => { def.fx.hidden = true; this.vfx.burst(dp.x, 1.2, e, 16, 9, 0.7); if (e2) this.vfx.burst(dp.x, 1.2, e2, 10, 7, 0.6); audio.sfx('glass'); this.cam.shake(0.8); });

    switch (a.key) {
      // ODEDSVR
      case 'monitor': ctx.drop('🖥️', 1.3, 0.1, 3.4); this.once(30, 2.2, () => { def.fx.hidden = true; }); text(31, 2.2, 'END STREAM', '', 'small', 1400); break;
      case 'shock':
        this.once(30, 1.2, () => { this.vfx.bigProp('🔌', dp.x - dir * 1.5, 1.2, 1.4, new THREE.Vector3(dir * 3, 0, 0), 0.6); });
        if (a.t > 1.5 && a.t < 3.2) { def.fx.tint.set(Math.random() < 0.5 ? '#9fe3ff' : '#ffffff'); def.fx.tintAmt = Math.random(); if (Math.random() < 0.3) this.vfx.emote(dp.x, 1.2, '⚡', 0.7); if (Math.random() < 0.15) audio.sfx('teleport', 0, 0.5); }
        this.once(31, 3.2, () => { def.fx.tint.set('#000000'); def.fx.tintAmt = 0.9; this.vfx.burst(dp.x, 1.5, '💨', 6, 3, 0.8); });
        break;
      // RONENGG
      case 'breaking': ctx.drop('📰', 1.3, 0.1); text(30, 1.5, 'BREAKING NEWS', 'חדשות: ' + ROSTER[m.f[1 - a.att].char].he + ' הושמד', 'breaking', 2000); break;
      case 'tomatoes': if (a.t > 1.1 && a.t < 3.3 && Math.random() < 0.5) this.vfx.rain('🍅', dp.x, 1, 0.6); tint(30, 2.4, '#ff2a2a', 0.5, 'hitM'); ctx.sink('🍅', 2.6); text(31, 1.4, 'בוווווו', 'BOOOOO', 'small', 1600); break;
      // INDE
      case 'kid': ctx.run('👦', 1.1); hit(30, 1.6); ctx.fly(1.6); break;
      case 'plaque': ctx.drop('▶️', 1.3, 0.1, 3.8); text(30, 1.9, '1,000,000', 'SUBSCRIBERS', 'small', 1600); break;
      // IGZ
      case 'sleep24':
        this.once(30, 1.1, () => this.vfx.bigProp('⏰', dp.x, 3.2, 1.6, new THREE.Vector3(0, 0, 0), 2.5, 12));
        if (a.t > 1.8) { def.setOverride(def.lib.LYING); if (Math.random() < 0.05) this.vfx.emote(dp.x, 1, '💤', 0.7); }
        break;
      case 'turtle':
        this.once(30, 1.3, () => { this.vfx.burst(dp.x, 1, '💨', 8, 4, 0.8); audio.sfx('teleport'); });
        if (a.t > 1.3) def.fx.shrink = Math.max(0.01, def.fx.shrink - dt * 2.5);
        this.once(31, 1.8, () => { def.fx.hidden = true; this.vfx.bigProp('🐢', dp.x, 0.4, 1.2, new THREE.Vector3(-dir * 0.5, 0, 0), 3); });
        break;
      // LIORSLIFE
      case 'denied': ctx.drop('⛔', 1.3, 0.08, 3.6); text(30, 1.8, 'DENIED', 'UNBAN REQUEST', 'small', 1600); break;
      case 'karma':
        this.once(30, 1.3, () => { this.renderer.flash('#ffffff', 1, 120); audio.sfx('ko'); this.vfx.bigProp('⚡', dp.x, 3.5, 3.2, new THREE.Vector3(0, -10, 0), 0.4); });
        tint(31, 1.45, '#000000', 0.9, 'hitX');
        if (a.t > 1.5 && Math.random() < 0.1) this.vfx.emote(dp.x, 1.6, '💨', 0.8);
        break;
      // PSYQR
      case 'mission': hit(30, 1.3); ctx.fly(1.3); text(31, 2.0, 'MISSION PASSED!', 'RESPECT +', 'mission', 2200); break;
      case 'wasted':
        ctx.run('🚗', 1.1, 2.2);
        hit(30, 1.55);
        if (a.t > 1.55 && a.t < 2.2) { def.fx.offsetY += dt * 3; def.fx.spin += dt * 10; }
        if (a.t > 2.2) { def.fx.offsetY = Math.max(0, def.fx.offsetY - dt * 6); def.setOverride(def.lib.LYING); }
        this.once(31, 2.4, () => { this.renderer.flash('#000000', 0.7, 1500); this.hud.bigText('WASTED', '', 'wasted', 2000); });
        break;
      // MAOR
      case 'vending':
        ctx.drop('#vending', 1.2, 0.1, 3.8);
        this.once(30, 2.0, () => { def.fx.hidden = true; this.vfx.burst(dp.x, 1, '⚙️', 10, 7, 0.6); this.vfx.burst(dp.x, 1, '🔩', 8, 6, 0.6); audio.sfx('coin'); });
        text(31, 2.2, 'המכונה', 'אזל מהמלאי', 'small', 1800);
        break;
      case 'clones':
        this.once(30, 1.1, () => { for (let i = 0; i < 3; i++) this.vfx.bigProp('🧔', dp.x + (i - 1) * 1.2, 3.5 + i, 1.4, new THREE.Vector3(0, -12, 0), 0.5); });
        this.once(31, 1.5, () => { def.fx.squash = 0.15; audio.sfx('slam'); this.cam.shake(1.2); this.vfx.dust(dp.x, true); });
        text(32, 1.7, 'x3', 'SPLIT PERSONALITY', 'small', 1500);
        break;
      // MASTEROHAD
      case 'ending':
        this.once(30, 1.3, () => { this.renderer.flash('#7a2cff', 0.9, 1500); this.hud.bigText('THE STREAM IS', 'ENDING', 'ending', 2400); });
        if (a.t > 1.6) { def.fx.shrink = Math.max(0.01, def.fx.shrink - dt * 0.8); def.fx.spin += dt * 10; }
        if (a.t > 2.8) def.fx.hidden = true;
        break;
      case 'hypno':
        this.once(30, 1.1, () => this.vfx.bigProp('🌀', dp.x, 1.6, 2.2, new THREE.Vector3(0, 0, 0), 2.6, 8));
        if (a.t > 1.4) { def.fx.spin += dt * 6; def.fx.offsetX += dir * dt * 1.5; }
        text(31, 1.8, 'מהופנט', 'HYPNOTIZED', 'small', 1600);
        break;
      // PEDROFEDERER
      case 'graded':
        this.once(30, 1.3, () => { this.vfx.bigProp('🃏', dp.x, 1.2, 3.6, new THREE.Vector3(0, 0, 0), 2.6); def.fx.tint.set('#8899aa'); def.fx.tintAmt = 0.8; audio.sfx('glass'); });
        text(31, 1.8, 'GRADED 10', 'GEM MINT', 'small', 1800);
        break;
      case 'quakepit': this.once(30, 1.1, () => { this.cam.shake(1.6); audio.sfx('slam'); this.vfx.dust(dp.x, true); }); ctx.sink('🪨', 1.3); break;
      // DEVIDTUR
      case 'unboxing': ctx.drop('📦', 1.3, 0.2, 3.2); this.once(30, 1.8, () => { def.fx.hidden = true; }); text(31, 1.8, 'FRAGILE', 'THIS SIDE UP', 'small', 1600); break;
      case 'despawn':
        if (a.t > 1.2 && a.t < 2.6) { def.fx.hidden = Math.random() < 0.4; def.fx.offsetY = (Math.random() - 0.5) * 0.3; }
        this.once(30, 2.6, () => { def.fx.hidden = true; audio.sfx('teleport'); });
        text(31, 2.6, 'ERROR 404', 'FIGHTER NOT FOUND', 'small', 1800);
        break;
      // SASIVETHEBOIZ
      case 'oven':
        this.once(30, 1.3, () => { this.vfx.burst(dp.x, 1.2, '💥', 10, 8, 1); this.vfx.burst(dp.x, 1.2, '🔥', 12, 6, 0.8); audio.sfx('ko'); this.renderer.flash('#ff7a2f', 0.9, 400); def.fx.tint.set('#000000'); def.fx.tintAmt = 0.92; });
        if (a.t > 1.5 && Math.random() < 0.08) this.vfx.emote(dp.x, 1.8, '💨', 0.8);
        break;
      case 'bonk': ctx.drop('🏏', 1.25, 0.25, 2.6); this.once(30, 1.9, () => this.vfx.emote(dp.x, 1.2, '💫', 0.8)); text(31, 1.8, 'BONK', 'אוגה בוגה', 'small', 1400); break;
      // SHOTIST
      case 'uwu':
        this.once(30, 1.3, () => { this.vfx.burst(dp.x, 1.2, '🌸', 18, 6, 0.7); this.hud.bigText('UWU', '', 'uwu', 1800); audio.sfx('alert'); });
        if (a.t > 1.3) def.fx.shrink = Math.max(0.35, def.fx.shrink - dt * 1.5);
        break;
      case 'dice': ctx.drop('🎲', 1.3, 0.1, 3.4); text(30, 1.9, '6', 'CRITICAL ROLL', 'small', 1500); break;
      // SHILO / ADAM
      case 'treasure': if (a.t > 1.1 && a.t < 3.4 && Math.random() < 0.6) this.vfx.rain('🪙', dp.x, 1, 0.6); ctx.sink('🪙', 1.8); break;
      case 'piggy':
        ctx.drop('🐷', 1.3, 0.12, 3.4);
        this.once(30, 1.75, () => { this.vfx.burst(dp.x, 1, '🪙', 22, 9, 0.5); audio.sfx('coin'); });
        text(31, 2.0, 'קופת חיסכון', 'PIGGY BANK', 'small', 1600);
        break;
      // THE DELIVERY CREW: SUPER BIBI
      case 'upaway': // carried off into the sky, and a twinkle where they went
        hit(30, 1.3, '#4dabf7');
        this.once(31, 1.3, () => this.vfx.burst(dp.x, 1.2, '💨', 8, 5, 0.7));
        ctx.fly(1.3);
        text(32, 2.0, 'למעלה ורחוק', 'UP AND AWAY', 'small', 1800);
        this.once(33, 2.7, () => { def.fx.hidden = true; this.vfx.bigProp('✨', dp.x, 5.2, 1.3, new THREE.Vector3(0, 0, 0), 0.8, 6); audio.sfx('coin'); });
        break;
      case 'hitsong': // on repeat: a record taller than they are turning behind them, and they go round with it
        this.once(30, 1.1, () => { this.vfx.bigProp('#record', dp.x, 1.2, 2.9, new THREE.Vector3(0, 0, 0), 2.9, 7).position.z = -0.7; audio.sfx('scratch'); });
        if (a.t > 1.3) { def.fx.spin += dt * 13; if (Math.random() < 0.12) this.vfx.emote(dp.x, 1.5, Math.random() < 0.5 ? '🎵' : '🎶', 0.6); }
        this.once(31, 2.2, () => audio.sfx('scratch'));
        text(32, 1.9, 'להיט', 'ON REPEAT', 'small', 1700);
        break;
      // THE DELIVERY CREW: THE PIZZA GUY
      case 'scooter': // the delivery arrives, at speed
        ctx.run('🛵', 1.1, 2.1);
        this.once(30, 1.1, () => audio.sfx('engine'));
        hit(31, 1.5, '#ff8a1f');
        ctx.fly(1.5);
        text(32, 2.0, 'משלוח אקספרס', 'EXPRESS DELIVERY', 'small', 1800);
        break;
      case 'pizzabox': // a family pizza, from a great height
        ctx.drop('🍕', 1.3, 0.1, 3.8);
        this.once(30, 1.75, () => { this.vfx.burst(dp.x, 0.8, '🧀', 12, 7, 0.5); this.vfx.burst(dp.x, 0.8, '🍅', 8, 6, 0.45); audio.sfx('splat', 0, 1.3); });
        text(31, 2.0, 'בתיאבון', 'SPECIAL DELIVERY', 'small', 1700);
        break;
      // BIGGIE
      case 'fried': // coated, fried, golden brown
        this.once(30, 1.2, () => { this.vfx.burst(dp.x, 1.2, '🍗', 14, 8, 0.55); audio.sfx('splat', 0, 1.2); });
        tint(31, 1.4, '#b5651d', 0.85, 'fire');
        if (a.t > 1.5 && Math.random() < 0.18) this.vfx.emote(dp.x, 1.6, Math.random() < 0.5 ? '🔥' : '💨', 0.6);
        text(32, 1.8, 'פריך', 'EXTRA CRISPY', 'small', 1700);
        break;
      case 'homerun': // one swing of the chicken bat, and a star where they went
        hit(30, 1.3, '#ffb347');
        this.once(31, 1.3, () => this.vfx.burst(dp.x, 1.2, '🍗', 8, 7, 0.5));
        ctx.fly(1.3);
        text(32, 1.9, 'HOME RUN', 'מחבט עוף', 'small', 1800);
        this.once(33, 2.7, () => { def.fx.hidden = true; this.vfx.bigProp('⭐', dp.x, 5.2, 1.2, new THREE.Vector3(0, 0, 0), 0.8, 6); audio.sfx('coin'); });
        break;
      // YAKIR
      case 'banned':
        this.once(30, 1.2, () => { this.renderer.flash('#7a3cff', 0.9, 500); this.hud.bigText('BANNED', 'לצמיתות', 'ending', 2200); audio.sfx('slam'); });
        vanish(31, 1.7, '🔨', '⛔');
        break;
      case 'micdrop': ctx.drop('🎤', 1.3, 0.1, 3.4); this.once(30, 1.75, () => audio.sfx('scratch')); text(31, 1.9, 'MIC DROP', '', 'small', 1600); break;
      // YANIVO
      case 'sewerbye': // down the sewer
        this.once(30, 1.1, () => { this.vfx.bigProp('🕳️', dp.x, 0.15, 2.4, new THREE.Vector3(0, 0, 0), 2.6); audio.sfx('slam', 0, 0.6); });
        ctx.sink('💨', 1.3);
        text(31, 1.9, 'ביוב', 'SEWER CALL', 'small', 1600);
        break;
      case 'balloonaway': // tied to a bunch of balloons, and off
        this.once(30, 1.1, () => { this.vfx.burst(dp.x, 2.0, '🎈', 9, 3, 0.6); audio.sfx('pop', 0, 0.5); });
        if (a.t > 1.3) { def.fx.offsetY += dt * 1.8; if (Math.random() < 0.15) this.vfx.emote(dp.x, 2.2 + def.fx.offsetY, '🎈', 0.6); }
        text(31, 1.8, 'KEEP IT UP', 'עף', 'small', 1700);
        this.once(32, 3.2, () => { def.fx.hidden = true; });
        break;
      // TEDDY
      case 'dogwalk': // the neighbours' dog drags them off
        ctx.run('🐕', 1.1, 1.5);
        this.once(30, 1.1, () => audio.sfx('bark'));
        hit(31, 1.45, '#ffb300');
        if (a.t > 1.5) { def.setOverride(def.lib.LYING); def.fx.offsetX += dir * dt * 3.5; if (Math.random() < 0.08) audio.sfx('bark', 0, 0.5); }
        text(32, 1.9, 'הכלב של השכנים', 'ממליץ', 'small', 1700);
        break;
      case 'spicy': // the hot chip, and what it does to you
        tint(30, 1.2, '#ff2a1a', 0.75, 'fire');
        if (a.t > 1.2 && Math.random() < 0.25) this.vfx.emote(dp.x, 2.0, Math.random() < 0.6 ? '🔥' : '🥵', 0.6);
        this.once(31, 1.6, () => this.vfx.burst(dp.x, 1.9, '💨', 8, 4, 0.6));
        text(32, 1.8, 'חריף!', 'TOO SPICY', 'small', 1600);
        break;
      default: ctx.drop('💥', 1.3); break;
    }

    this.once(90, 3.6, () => {
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
      for (const v of views) { v.fx.squash = 1; v.fx.offsetY = 0; v.fx.offsetX = 0; v.fx.spin = 0; v.fx.shrink = 1; v.fx.tintAmt = 0; v.fx.hidden = false; }
    }
  }
}
