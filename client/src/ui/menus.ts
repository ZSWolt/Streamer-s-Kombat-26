import { audio } from '../audio/AudioEngine';
import { announcer } from '../audio/announcer';
import { music } from '../audio/music';
import { ROSTER } from '../data/roster';
import { ACTIONS, ACTION_HE, DEFAULT_P1, DEFAULT_P2, keyLabel, type Action } from '../input/InputManager';
import { STAGES } from '../render/stages';
import { movesFor } from '../sim/moves';
import type { MatchConfig, MatchState } from '../sim/types';
import type { App, Screen } from '../app/App';
import { DEFAULT_SETTINGS } from '../app/settings';
import type { Battle } from '../game/Battle';
import { LocalDriver } from '../game/Battle';
import { Cpu } from '../ai/Cpu';
import * as C from '../sim/constants';
import { h } from './dom';
import { logoEl } from './logo';
import { portraitUrl } from './portraits';

interface ListItem { he: string; en: string; desc?: string; go: () => void; disabled?: boolean }

export function listNav(app: App, container: HTMLElement, items: ListItem[], opts: { start?: number; back?: () => void; onMove?: (i: number) => void; cls?: string } = {}) {
  let sel = opts.start ?? 0;
  const els = items.map((it, i) => {
    const el = h('div', { class: 'menu-item' + (it.disabled ? ' disabled' : ''), onclick: () => { sel = i; render(); fire(); }, onmouseenter: () => { if (sel !== i) { sel = i; render(); audio.sfx('ui_move'); } } }, [
      h('span', { class: 'he' }, [it.he]), h('span', { class: 'en' }, [it.en]),
    ]);
    container.append(el);
    return el;
  });
  const render = () => { els.forEach((e, i) => e.classList.toggle('sel', i === sel)); opts.onMove?.(sel); };
  const fire = () => {
    const it = items[sel];
    if (it.disabled) { audio.sfx('ui_back'); return; }
    audio.sfx('ui_ok');
    it.go();
  };
  render();
  const off = app.input.onUi((e) => {
    if (e === 'up') { sel = (sel + items.length - 1) % items.length; audio.sfx('ui_move'); render(); }
    else if (e === 'down') { sel = (sel + 1) % items.length; audio.sfx('ui_move'); render(); }
    else if (e === 'confirm') fire();
    else if (e === 'back' && opts.back) { audio.sfx('ui_back'); opts.back(); }
  });
  return { off, get sel() { return sel; } };
}

export const NEWS = [
  { id: 'ori', date: '30.9.2026', title: 'אורי מסולטיז הצטרפה!', text: 'הלוחמת הראשונה במשחק. זורקת מילקשייק ושואלת שאלות — תשובה לא נכונה ואתם בבריכה.' },
  { id: 'masterohad', date: '29.9.2026', title: 'המנטליסט', text: 'U עם מאסטר אוהד: גל היפנוזה שהופך ליריב את השליטה. אין על קיק.' },
  { id: 'pedrofederer', date: '29.9.2026', title: 'EARTHQUACKERR', text: '↓+U עם ניקי: רעידת אדמה שמפילה את כל מי שעומד לידו. פותח בוסטרים באמצע קרב.' },
  { id: 'k0nkamc', date: '28.9.2026', title: 'הכלב הלבן', text: 'קונקה הגיע עם הכלב. U שולח אותו להסתער — ו-↓+U זה גב לקיר.' },
];

export class Menus {
  constructor(private app: App) {}

  private mount(el: HTMLElement) {
    this.app.uiRoot.append(el);
    return el;
  }

  boot() {
    const bar = h('i');
    const msg = h('div', { class: 'msg' }, ['טוען...']);
    const el = this.mount(h('div', { class: 'screen boot' }, [logoEl('small'), h('div', { class: 'bar' }, [bar]), msg]));
    return {
      screen: { update() {}, dispose() { el.remove(); } } as Screen,
      progress(p: number, text: string) { bar.style.width = `${Math.round(p * 100)}%`; msg.textContent = text; },
    };
  }

  title(onStart: () => void): Screen {
    const row = h('div', { class: 'portrait-row' });
    ROSTER.forEach((f, i) => {
      const p = h('div', { class: 'round-portrait', style: `background-image:url(${portraitUrl(i, 'icon')});--acc:${f.platform === 'kick' ? '#53fc18' : '#ff0033'};animation-delay:${0.6 + i * 0.05}s` });
      row.append(p);
    });
    const el = this.mount(h('div', { class: 'screen title-screen fade-in' }, [
      logoEl(),
      row,
      h('div', { class: 'press metal' }, ['לחצו על מקש או כפתור']),
      h('div', { class: 'press-en' }, ['PRESS ANY KEY • SOUND ON']),
      h('div', { class: 'platforms' }, [
        h('span', { style: 'color:#53fc18' }, ['KICK']), h('span', { style: 'color:#9146ff' }, ['TWITCH']), h('span', { style: 'color:#ff0033' }, ['YOUTUBE']),
      ]),
    ]));
    let done = false;
    const go = () => { if (done) return; done = true; onStart(); };
    const off = this.app.input.onUi((e) => { if (e === 'any') go(); });
    el.addEventListener('pointerdown', go);
    return { update() {}, dispose() { off(); el.remove(); } };
  }

  mainMenu(start = 0): Screen {
    const app = this.app;
    const list = h('div', { class: 'menu-list' });
    const tagline = h('div', { class: 'menu-tagline' });
    const items: ListItem[] = [
      { he: 'קרב', en: 'ARCADE', desc: 'אתם נגד המחשב. מנצחים, גומרים אותו, בנאליטי.', go: () => app.goSelect('arcade') },
      { he: 'שחקן נגד שחקן', en: 'VERSUS', desc: 'שניים על אותו מחשב — מקלדת או בקרים.', go: () => app.goSelect('versus') },
      { he: 'אונליין', en: 'ONLINE', desc: 'לובי עם חברים מכל מקום. מישהו מארח — כולם נכנסים בקישור.', go: () => app.goLobby() },
      { he: 'אימון', en: 'PRACTICE', desc: 'בובת אימון, מסגרות, תצוגת לחיצות. בלי טיימר.', go: () => app.goSelect('practice') },
      { he: 'הדגמה', en: 'DEMO', desc: 'המחשב נגד המחשב. תשבו ותראו.', go: () => app.startDemo() },
      { he: 'הגדרות', en: 'OPTIONS', desc: 'קושי, סבבים, סאונד, גרפיקה, מקשים ועוד.', go: () => app.goOptions() },
      { he: 'קרדיטים', en: 'CREDITS', desc: 'מי עשה את זה.', go: () => app.goCredits() },
    ];
    const nav = listNav(app, list, items, { start, onMove: (i) => { tagline.textContent = items[i].desc ?? ''; } });

    const keys: [string, string][] = [
      ['תנועה (פעמיים = דאש)', 'A/D • ←/→'], ['קפיצה / התכופפות', 'W/S • ↑/↓'], ['אגרוף קל', 'J'], ['אגרוף חזק', 'I'], ['בעיטה קלה', 'K'],
      ['בעיטה סיבובית', 'O'], ['הגנה', 'Shift / L'], ['הטלה', 'J+K'], ['מהלכים מיוחדים', 'U • →+U • ↓+U'], ['מהלך הייפ (מד מלא)', 'U+L'], ['בנאליטי (בסוף)', '↓↓+U'], ['הפסקה', 'P / Esc'],
    ];
    const controls = h('div', { class: 'side-panel left controls-panel' }, [
      h('div', { class: 'pad-rec' }, [h('span', {}, ['🎮']), h('span', {}, ['מומלץ לשחק עם בקר'])]),
      h('h3', { class: 'metal' }, ['מקשים']),
      h('div', { class: 'en-lbl', style: 'text-align:right;font-size:12px;margin-bottom:4px' }, ['KEYBOARD']),
      h('table', {}, keys.map(([a, b]) => h('tr', {}, [h('td', {}, [a]), h('td', { class: 'k' }, [b])]))),
      h('div', { class: 'sub' }, ['יש בקר? לחצו על כפתור והוא יופיע כאן.']),
    ]);
    const news = h('div', { class: 'side-panel right' }, [
      h('h3', { class: 'metal' }, ['מה חדש']),
      ...NEWS.slice(0, 3).map((n) => {
        const idx = ROSTER.findIndex((f) => f.id === n.id);
        return h('div', { class: 'news-card' }, [
          h('div', {}, [
            h('div', { class: 'date' }, [h('span', { class: 'tag' }, ['חדש!']), n.date]),
            h('div', { class: 't' }, [n.title]),
            h('div', { class: 'd' }, [n.text]),
            h('div', { class: 'go', onclick: () => app.goSelect('practice', idx) }, ['← לנסות עכשיו']),
          ]),
          h('div', { class: 'ava', style: `background-image:url(${portraitUrl(idx, 'icon')})` }),
        ]);
      }),
      h('div', { class: 'news-more' }, [`▾ עוד ${NEWS.length - 3} עדכונים`]),
    ]);
    const el = this.mount(h('div', { class: 'screen main-menu fade-in' }, [
      logoEl(), list, controls, news, tagline,
      h('div', { class: 'menu-hint' }, [h('b', {}, ['↑↓']), ' בחירה • ', h('b', {}, ['X / Enter']), ' אישור']),
    ]));
    let idle = 0;
    return {
      update: (dt) => { idle = app.idleT; if (idle > 45) { app.idleT = 0; app.goIntro(() => app.goMenu(nav.sel)); } },
      dispose: () => { nav.off(); el.remove(); },
    };
  }

  options(): Screen {
    const app = this.app;
    const s = app.settings;
    type Row = { he: string; en: string; desc: string; get: () => string; left?: () => void; right?: () => void; slider?: () => number; go?: () => void; section?: string };
    const cyc = <T,>(arr: T[], cur: T, d: number) => arr[(arr.indexOf(cur) + d + arr.length) % arr.length];
    const vol = (k: 'music' | 'sfx' | 'voices') => ({ slider: () => s[k], left: () => { s[k] = Math.max(0, Math.round((s[k] - 0.1) * 10) / 10); }, right: () => { s[k] = Math.min(1, Math.round((s[k] + 0.1) * 10) / 10); } });
    let resetArm = false;
    let unlockArm = false;
    const rows: Row[] = [
      { section: 'GAMEPLAY', he: 'רמת קושי', en: 'DIFFICULTY', desc: 'כמה המחשב חכם ומהיר.', get: () => ['קל', 'רגיל', 'קשה', 'סטרימר'][s.difficulty], left: () => { s.difficulty = Math.max(0, s.difficulty - 1) as any; }, right: () => { s.difficulty = Math.min(3, s.difficulty + 1) as any; } },
      { he: 'סבבים לניצחון', en: 'ROUNDS', desc: 'כמה סיבובים צריך לנצח בקרב.', get: () => String(s.rounds), left: () => { s.rounds = Math.max(1, s.rounds - 1); }, right: () => { s.rounds = Math.min(5, s.rounds + 1); } },
      { he: 'זמן לסבב', en: 'TIME', desc: 'שניות לכל סיבוב. ∞ = בלי טיימר.', get: () => (s.roundTime ? String(s.roundTime) : '∞'), left: () => { s.roundTime = cyc([30, 60, 99, 0], s.roundTime, -1); }, right: () => { s.roundTime = cyc([30, 60, 99, 0], s.roundTime, 1); } },
      { he: 'סרטון לפני קרב', en: 'BATTLE INTRO', desc: 'הצגת הלוחמים לפני סיבוב ראשון.', get: () => (s.battleIntro ? 'פועל' : 'כבוי'), left: () => { s.battleIntro = !s.battleIntro; }, right: () => { s.battleIntro = !s.battleIntro; } },
      { he: 'רמזי מקשים', en: 'HINTS', desc: 'רמזים על המסך (למשל איך לעשות בנאליטי).', get: () => (s.hints ? 'פועל' : 'כבוי'), left: () => { s.hints = !s.hints; }, right: () => { s.hints = !s.hints; } },
      { section: 'AUDIO', he: 'מוזיקה', en: 'MUSIC', desc: 'עוצמת המוזיקה.', get: () => '', ...vol('music') },
      { he: 'אפקטים', en: 'SFX', desc: 'עוצמת המכות והאפקטים.', get: () => '', ...vol('sfx') },
      { he: 'קולות וכרוז', en: 'VOICES', desc: 'עוצמת הכרוז וקולות הלוחמים.', get: () => '', ...vol('voices') },
      { he: 'שפת הכרוז', en: 'ANNOUNCER', desc: 'עברית או אנגלית.', get: () => (s.announcerLang === 'he' ? 'עברית' : 'English'), left: () => { s.announcerLang = s.announcerLang === 'he' ? 'en' : 'he'; }, right: () => { s.announcerLang = s.announcerLang === 'he' ? 'en' : 'he'; } },
      { section: 'STREAM', he: 'HUD של שידור', en: 'STREAM HUD', desc: "צ'אט, צופים והתראות סאב/דונייט בזמן הקרב.", get: () => (s.streamHud ? 'פועל' : 'כבוי'), left: () => { s.streamHud = !s.streamHud; }, right: () => { s.streamHud = !s.streamHud; } },
      { he: "מהירות צ'אט", en: 'CHAT SPEED', desc: "כמה מהר הצ'אט רץ.", get: () => ['איטי', 'רגיל', 'מהיר', 'טירוף'][[0.5, 1, 1.5, 2.5].indexOf(s.chatSpeed)] ?? 'רגיל', left: () => { s.chatSpeed = cyc([0.5, 1, 1.5, 2.5], s.chatSpeed, -1); }, right: () => { s.chatSpeed = cyc([0.5, 1, 1.5, 2.5], s.chatSpeed, 1); } },
      { section: 'GRAPHICS', he: 'איכות גרפיקה', en: 'QUALITY', desc: 'אם יש קפיצות — להוריד.', get: () => ({ low: 'נמוכה', medium: 'בינונית', high: 'גבוהה', ultra: 'אולטרה' })[s.quality], left: () => { s.quality = cyc(['low', 'medium', 'high', 'ultra'] as const, s.quality, -1); }, right: () => { s.quality = cyc(['low', 'medium', 'high', 'ultra'] as const, s.quality, 1); } },
      { he: 'רזולוציה', en: 'RES SCALE', desc: 'קנה מידה לרזולוציית הרינדור.', get: () => `${Math.round(s.resScale * 100)}%`, left: () => { s.resScale = cyc([0.5, 0.75, 1], s.resScale, -1); }, right: () => { s.resScale = cyc([0.5, 0.75, 1], s.resScale, 1); } },
      { he: 'מסך מלא', en: 'FULLSCREEN', desc: 'מסך מלא.', get: () => (s.fullscreen ? 'פועל' : 'כבוי'), left: () => this.toggleFs(), right: () => this.toggleFs() },
      { he: 'רעידת מסך', en: 'SCREEN SHAKE', desc: 'רעידות מצלמה במכות חזקות.', get: () => '', slider: () => s.shake, left: () => { s.shake = Math.max(0, Math.round((s.shake - 0.25) * 4) / 4); }, right: () => { s.shake = Math.min(1, Math.round((s.shake + 0.25) * 4) / 4); } },
      { he: 'עוצמת אפקטים', en: 'EFFECTS', desc: 'ניצוצות, אימוג׳ים והבזקים.', get: () => '', slider: () => s.effects, left: () => { s.effects = Math.max(0, Math.round((s.effects - 0.25) * 4) / 4); }, right: () => { s.effects = Math.min(1, Math.round((s.effects + 0.25) * 4) / 4); } },
      { he: 'מונה FPS', en: 'SHOW FPS', desc: 'מציג פריימים לשנייה.', get: () => (s.showFps ? 'פועל' : 'כבוי'), left: () => { s.showFps = !s.showFps; }, right: () => { s.showFps = !s.showFps; } },
      { he: 'תצוגת לחיצות', en: 'INPUT DISPLAY', desc: 'מציג את הלחיצות בזמן קרב.', get: () => (s.inputDisplay ? 'פועל' : 'כבוי'), left: () => { s.inputDisplay = !s.inputDisplay; }, right: () => { s.inputDisplay = !s.inputDisplay; } },
      { section: 'ONLINE', he: 'השהיית קלט', en: 'INPUT DELAY', desc: 'פריימים של השהייה באונליין (פחות = מהיר יותר, יותר = יציב יותר).', get: () => String(s.inputDelay), left: () => { s.inputDelay = Math.max(0, s.inputDelay - 1); }, right: () => { s.inputDelay = Math.min(6, s.inputDelay + 1); } },
      { section: 'SYSTEM', he: 'מקשים ובקרים', en: 'CONTROLS', desc: 'שינוי מקשים לשחקן 1 ו-2.', get: () => '', go: () => this.app.setScreen(this.controls()) },
      { he: 'איפוס הגדרות', en: 'RESET', desc: 'מחזיר את כל ההגדרות לברירת מחדל. לחצו פעמיים.', get: () => (resetArm ? 'בטוח?' : ''), go: () => { if (resetArm) { Object.assign(s, structuredClone(DEFAULT_SETTINGS)); resetArm = false; app.toast('ההגדרות אופסו'); } else resetArm = true; } },
      { he: 'איפוס התקדמות', en: 'RESET UNLOCKS', desc: 'נועל מחדש את הסקינים הסודיים. לחצו פעמיים.', get: () => { const [g, t] = app.unlockCount(); return unlockArm ? 'בטוח?' : `${g}/${t} נפתחו`; }, go: () => { if (unlockArm) { app.resetUnlocks(); unlockArm = false; app.toast('ההתקדמות אופסה'); } else unlockArm = true; } },
      { he: 'חזרה', en: 'BACK', desc: '', get: () => '', go: () => app.goMenu(5) },
    ];
    const list = h('div', { class: 'opt-list' });
    const desc = h('div', { class: 'opt-desc' });
    let sel = 0;
    const rowEls: HTMLElement[] = [];
    rows.forEach((r, i) => {
      if (r.section) list.append(h('div', { class: 'opt-section' }, [r.section]));
      const val = h('div', { class: 'val' });
      const el = h('div', { class: 'opt-row', onclick: () => { sel = i; render(); act(0); } }, [h('div', { class: 'he' }, [r.he]), h('div', { class: 'en' }, [r.en]), val]);
      rowEls.push(el);
      list.append(el);
    });
    const render = () => {
      rows.forEach((r, i) => {
        const el = rowEls[i];
        el.classList.toggle('sel', i === sel);
        const val = el.querySelector('.val') as HTMLElement;
        val.innerHTML = '';
        if (r.slider) val.append(h('div', { class: 'slider' }, [h('i', { style: `width:${r.slider() * 100}%` })]));
        else val.append(r.get());
      });
      desc.textContent = rows[sel].desc;
      rowEls[sel].scrollIntoView({ block: 'nearest' });
    };
    const act = (d: number) => {
      const r = rows[sel];
      if (d < 0 && r.left) r.left();
      else if (d > 0 && r.right) r.right();
      else if (d === 0 && r.go) { r.go(); audio.sfx('ui_ok'); }
      else if (d === 0 && r.right) r.right();
      if (d !== 0 || r.left) audio.sfx('ui_move');
      if (!['איפוס הגדרות'].includes(r.he)) resetArm = r.he === 'איפוס הגדרות' ? resetArm : false;
      app.applySettings();
      app.renderer.setQuality(s.quality, s.resScale);
      render();
    };
    const off = app.input.onUi((e) => {
      if (e === 'up') { sel = (sel + rows.length - 1) % rows.length; audio.sfx('ui_move'); render(); }
      else if (e === 'down') { sel = (sel + 1) % rows.length; audio.sfx('ui_move'); render(); }
      else if (e === 'left') act(1);
      else if (e === 'right') act(-1);
      else if (e === 'confirm') act(0);
      else if (e === 'back') { audio.sfx('ui_back'); app.goMenu(5); }
    });
    const el = this.mount(h('div', { class: 'screen options fade-in' }, [h('h1', { class: 'metal' }, ['הגדרות']), h('div', { style: 'max-height:70vh;overflow:auto;padding:4px' }, [list]), desc]));
    render();
    return { update() {}, dispose() { off(); el.remove(); } };
  }

  private toggleFs() {
    const s = this.app.settings;
    s.fullscreen = !s.fullscreen;
    if (s.fullscreen) void document.documentElement.requestFullscreen?.().catch(() => {});
    else if (document.fullscreenElement) void document.exitFullscreen();
  }

  controls(): Screen {
    const app = this.app;
    const s = app.settings;
    let player = 0;
    let sel = 0;
    const list = h('div', { class: 'opt-list' });
    const title = h('h1', { class: 'metal' }, ['מקשים']);
    const desc = h('div', { class: 'opt-desc' }, ['Enter = לשנות מקש · ←/→ = שחקן 1/2 · Esc = חזרה']);
    const rows = [...ACTIONS, 'defaults' as const];
    const render = () => {
      title.textContent = `מקשים — שחקן ${player + 1}`;
      list.innerHTML = '';
      const map = player === 0 ? s.p1Keys : s.p2Keys;
      rows.forEach((a, i) => {
        const val = a === 'defaults' ? 'ברירת מחדל' : map[a as Action].map(keyLabel).join(' / ');
        list.append(h('div', { class: 'opt-row' + (i === sel ? ' sel' : '') }, [
          h('div', { class: 'he' }, [a === 'defaults' ? 'איפוס מקשים' : ACTION_HE[a as Action]]),
          h('div', { class: 'en' }, [a.toUpperCase()]),
          h('div', { class: 'val' }, [val]),
        ]));
      });
    };
    const off = app.input.onUi((e) => {
      if (app.input.captureNext) return;
      if (e === 'up') { sel = (sel + rows.length - 1) % rows.length; render(); audio.sfx('ui_move'); }
      else if (e === 'down') { sel = (sel + 1) % rows.length; render(); audio.sfx('ui_move'); }
      else if (e === 'left' || e === 'right') { player = 1 - player; render(); audio.sfx('ui_move'); }
      else if (e === 'back') { app.applySettings(); app.goOptions(); }
      else if (e === 'confirm') {
        const a = rows[sel];
        if (a === 'defaults') {
          if (player === 0) s.p1Keys = structuredClone(DEFAULT_P1); else s.p2Keys = structuredClone(DEFAULT_P2);
          app.applySettings(); render(); return;
        }
        desc.textContent = 'לחצו על המקש החדש...';
        setTimeout(() => {
          app.input.captureNext = (code) => {
            const map = player === 0 ? s.p1Keys : s.p2Keys;
            map[a as Action] = [code];
            app.applySettings();
            desc.textContent = 'Enter = לשנות מקש · ←/→ = שחקן 1/2 · Esc = חזרה';
            render();
          };
        }, 50);
      }
    });
    const el = this.mount(h('div', { class: 'screen options fade-in' }, [title, list, desc]));
    render();
    return { update() {}, dispose() { off(); el.remove(); } };
  }

  credits(done: () => void): Screen {
    music.play('title');
    const roll = h('div', { class: 'roll' }, [
      logoEl('small'),
      h('h2', {}, ['FIGHTERS']),
      ...ROSTER.map((f) => h('p', { class: 'metal' }, [f.he, h('small', {}, [`${f.name} · ${f.title} · ${f.channel}`])])),
      h('h2', {}, ['GAME']),
      h('p', {}, ['רעיון', h('small', {}, ['הסטרימרים עצמם 🙌'])]),
      h('p', {}, ['פיתוח, מנוע, אנימציה, מוזיקה ואפקטים', h('small', {}, ['Claude (Anthropic) · נבנה בשביל הקהילה'])]),
      h('p', {}, ['השראה', h('small', {}, ['KNESSET KOMBAT 26 · Mortal Kombat · Tekken'])]),
      h('h2', {}, ['SPECIAL THANKS']),
      h('p', {}, ["לצ'אט", h('small', {}, ['KEKW · W · GG'])]),
      h('p', { style: 'margin-top:12vh' }, ['תודה ששיחקתם', h('small', {}, ['STAY AWESOME'])]),
    ]);
    const el = this.mount(h('div', { class: 'screen credits fade-in' }, [roll]));
    const t = setTimeout(done, 42000);
    const off = this.app.input.onUi((e) => { if (e === 'back' || e === 'confirm' || e === 'start') { clearTimeout(t); done(); } });
    return { update() {}, dispose() { clearTimeout(t); off(); el.remove(); } };
  }

  vs(cfg: MatchConfig, then: () => void, sub?: string): Screen {
    const [a, b] = cfg.chars;
    const fa = ROSTER[a], fb = ROSTER[b];
    const el = this.mount(h('div', { class: 'screen vs-screen' }, [
      h('div', { class: 'vs-half p1', style: `background-image:url(${portraitUrl(a, 'card', cfg.skins[0])})` }),
      h('div', { class: 'vs-half p2', style: `background-image:url(${portraitUrl(b, 'card', cfg.skins[1])})` }),
      h('div', { class: 'vs-name p1 metal' }, [fa.he]), h('div', { class: 'vs-title p1' }, [fa.title]),
      h('div', { class: 'vs-name p2 metal' }, [fb.he]), h('div', { class: 'vs-title p2' }, [fb.title]),
      h('div', { class: 'vs-mid metal' }, ['VS']),
      h('div', { class: 'vs-stage' }, [(sub ? sub + ' · ' : '') + 'זירה: ' + (STAGES[cfg.stage]?.he ?? '')]),
    ]));
    audio.sfx('select');
    setTimeout(() => audio.sfx('slam'), 350);
    void announcer.say('name_' + fa.id).then(() => announcer.say('name_' + fb.id));
    let done = false;
    const go = () => { if (done) return; done = true; then(); };
    const t = setTimeout(go, 2800);
    const off = this.app.input.onUi((e) => { if (e === 'confirm') go(); });
    return { update() {}, dispose() { clearTimeout(t); off(); el.remove(); } };
  }

  pauseMenu(m: MatchState, a: { resume: () => void; restart: () => void; quit: () => void }): HTMLElement {
    const list = h('div', { class: 'menu-list' });
    const el = this.mount(h('div', { class: 'overlay fade-in' }, [h('h1', { class: 'metal' }, ['הפסקה']), list]));
    let offNav: (() => void) | null = null;
    const close = () => { offNav?.(); };
    const items: ListItem[] = [
      { he: 'המשך', en: 'RESUME', go: () => { close(); a.resume(); } },
      { he: 'רשימת מהלכים', en: 'MOVE LIST', go: () => { this.moveList(m.f[0].char, () => {}); } },
      { he: 'התחל מחדש', en: 'RESTART', go: () => { close(); a.restart(); } },
      { he: 'יציאה', en: 'QUIT', go: () => { close(); a.quit(); } },
    ];
    const nav = listNav(this.app, list, items, { back: () => { close(); a.resume(); } });
    offNav = nav.off;
    const origRemove = el.remove.bind(el);
    el.remove = () => { close(); origRemove(); };
    return el;
  }

  moveList(charIdx: number, onClose: () => void) {
    const f = ROSTER[charIdx];
    const mv = movesFor(charIdx);
    const row = (a: string, b: string) => h('div', { class: 'row' }, [h('span', {}, [a]), h('span', { class: 'k' }, [b])]);
    const el = this.mount(h('div', { class: 'overlay fade-in', style: 'z-index:40' }, [
      h('div', { class: 'movelist' }, [
        h('h2', { class: 'metal' }, [`${f.he} — ${f.title}`]),
        h('div', { class: 'sec' }, ['SPECIAL MOVES']),
        ...f.specials.map((s) => row(`${s.name} · ${s.en}`, s.input === 'U' ? 'U' : s.input === 'FU' ? '→ + U' : '↓ + U')),
        row(`${f.hype.name} (מד הייפ מלא)`, 'U + L'),
        row(`BANALITY: ${f.banality.name}`, '↓ ↓ + U (בסוף)'),
        h('div', { class: 'sec' }, ['BASICS']),
        row('אגרוף קל / חזק', 'J / I'), row('בעיטה קלה / סיבובית', 'K / O'), row('אפרקאט (משגר)', '↓ + I'), row('סוויפ', '↓ + O'),
        row('מכה עליונה', '→ + I'), row('הטלה', 'J + K'), row('דאש', '→→ / ←←'), row('הגנה', 'Shift / L'),
        h('div', { class: 'sec' }, ['FRAME DATA']),
        ...mv.slice(0, 13).map((x) => row(x.key, `${x.startup}/${x.active}/${x.recovery} · ${x.damage}`)),
      ]),
      h('div', { class: 'menu-hint', style: 'position:static;margin-top:14px' }, ['Esc / K לסגירה']),
    ]));
    let alive = true;
    const off = this.app.input.onUi((e) => { if (alive && (e === 'back' || e === 'start' || e === 'confirm')) { alive = false; off(); el.remove(); onClose(); } });
    el.addEventListener('click', () => { if (alive) { alive = false; off(); el.remove(); onClose(); } });
  }

  results(m: MatchState, winner: number, items: ListItem[]): { dispose(): void } {
    const w = winner === 0 || winner === 1 ? ROSTER[m.f[winner].char] : null;
    const list = h('div', { class: 'menu-list' });
    const loser = w ? m.f[1 - winner] : null;
    const el = this.mount(h('div', { class: 'overlay results fade-in' }, [
      h('h1', { class: 'metal' }, [w ? `${w.he} ${w.female ? 'מנצחת' : 'מנצח'}` : 'תיקו']),
      w ? h('div', { class: 'quote' }, [`"${w.win}"`]) : null,
      h('div', { class: 'stats' }, [
        h('div', {}, [h('b', {}, [String(m.round)]), 'סיבובים']),
        h('div', {}, [h('b', {}, [w ? String(m.f[winner].hp) : '-']), 'חיים שנשארו']),
        h('div', {}, [h('b', {}, [m.banality ? 'כן' : 'לא']), 'בנאליטי']),
        h('div', {}, [h('b', {}, [loser ? String(loser.damageTaken) : '-']), 'נזק']),
      ]),
      list,
    ]));
    const nav = listNav(this.app, list, items);
    return { dispose() { nav.off(); el.remove(); } };
  }

  arcadeEnding(charIdx: number, done: () => void): Screen {
    const f = ROSTER[charIdx];
    music.play('title');
    const el = this.mount(h('div', { class: 'screen fade-in', style: 'background:radial-gradient(ellipse at 50% 40%, #3a1a08, #000 70%)' }, [
      h('div', { class: 'round-portrait', style: `width:200px;height:200px;background-image:url(${portraitUrl(charIdx, 'icon')})` }),
      h('h1', { class: 'metal', style: 'font-family:var(--he);font-size:80px;margin:20px 0 0' }, [`${f.he} ${f.female ? 'אלופת' : 'אלוף'} סטרים קומבט!`]),
      h('div', { class: 'en-lbl', style: 'font-size:22px' }, [`${f.name} — ${f.title} — ARCADE CLEARED`]),
      h('p', { style: 'font-size:22px;max-width:760px;text-align:center;color:#f3e6cc;margin-top:3vh' }, [`אחרי שניצח את כל הסטרימרים, ${f.he} חוזר לשידור עם הגביע. הצ'אט משתגע, הסאבים זורמים, ו"${f.win}" הופך לממ הכי גדול בארץ.`]),
      h('div', { class: 'metal', style: 'font-family:var(--he);font-size:28px;margin-top:3vh' }, ['🔓 נפתח: סקין ניאון!']),
      h('div', { class: 'menu-hint', style: 'position:static;margin-top:5vh' }, ['לחצו להמשך']),
    ]));
    audio.sfx('crowd');
    music.stinger('victory');
    const off = this.app.input.onUi((e) => { if (e === 'confirm' || e === 'start') done(); });
    return { update() {}, dispose() { off(); el.remove(); } };
  }

  practicePanel(b: Battle) {
    const modes = ['עומד', 'מתכופף', 'קופץ', 'הגנה', 'הגנה נמוכה', 'מחשב'];
    const bits = [0, C.IN_DOWN, C.IN_UP, C.IN_BLOCK, C.IN_BLOCK | C.IN_DOWN];
    let mode = 0;
    const fd = h('div', { class: 'fd' });
    const modeEl = h('b');
    const el = this.mount(h('div', { class: 'practice-panel' }, [
      h('div', {}, ['בובה: ', modeEl, h('span', { style: 'color:var(--muted)' }, ['  (Tab)'])]),
      h('div', { style: 'margin-top:4px;color:var(--muted)' }, ['F2 = מד הייפ מלא · F4 = רשימת מהלכים']),
      fd,
    ]));
    const d = b.driver as LocalDriver;
    const cpu = new Cpu(1, this.app.settings.difficulty);
    d.override = (i) => (i !== 1 ? null : mode === 5 ? cpu.input(d.m) : bits[mode]);
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Tab') { e.preventDefault(); mode = (mode + 1) % modes.length; modeEl.textContent = modes[mode]; }
      if (e.code === 'F2') { e.preventDefault(); d.m.f[0].meter = 1000; }
      if (e.code === 'F4') { e.preventDefault(); this.moveList(d.m.f[0].char, () => {}); }
    };
    window.addEventListener('keydown', onKey);
    modeEl.textContent = modes[mode];
    let lastMove = -1;
    return {
      update: () => {
        const f = d.m.f[0];
        if (f.move >= 0 && f.move !== lastMove) {
          const mv = movesFor(f.char)[f.move];
          fd.textContent = `${mv.key}: startup ${mv.startup} · active ${mv.active} · rec ${mv.recovery} · dmg ${mv.damage} · ${mv.level}`;
        }
        lastMove = f.move;
      },
      dispose: () => { window.removeEventListener('keydown', onKey); el.remove(); },
    };
  }
}
