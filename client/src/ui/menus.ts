import { audio } from '../audio/AudioEngine';
import { announcer } from '../audio/announcer';
import { music } from '../audio/music';
import { FLAVOR } from '../data/flavor';
import { ROSTER } from '../data/roster';
import { ACTIONS, ACTION_HE, DEFAULT_P1, DEFAULT_P2, keyLabel, type Action } from '../input/InputManager';
import { STAGES } from '../render/stages';
import type { MatchConfig, MatchState } from '../sim/types';
import type { App, Screen } from '../app/App';
import { DEFAULT_SETTINGS } from '../app/settings';
import type { Battle } from '../game/Battle';
import { LocalDriver } from '../game/Battle';
import { Cpu } from '../ai/Cpu';
import * as C from '../sim/constants';
import { movesFor } from '../sim/moves';
import { h, clear } from './dom';
import { logoEl } from './logo';
import { portraitUrl } from './portraits';
import { K, KA, banalityInputs, hypeInput, motionInput, spInput, throwInput } from './keys';
import { stone } from './stone';

export interface ListItem { he: string; en: string; desc?: string; go: () => void; disabled?: boolean; value?: () => string; cls?: string }

/** Vertical stone menu (the "kmenu" look): gold diamond markers + red band on the selected item */
export function listNav(app: App, container: HTMLElement, items: ListItem[], opts: { start?: number; back?: () => void; onMove?: (i: number) => void } = {}) {
  let sel = opts.start ?? 0;
  const els = items.map((it, i) => {
    const val = it.value ? h('span', { class: 'val' }, [it.value()]) : null;
    const el = h('div', {
      class: 'kitem' + (it.disabled ? ' disabled' : '') + (it.cls ? ' ' + it.cls : ''),
      onclick: () => { sel = i; render(); fire(); },
      onmouseenter: () => { if (sel !== i) { sel = i; render(); audio.sfx('ui_move'); } },
    }, [stone(it.he), h('span', { class: 'en' }, [it.en]), val]);
    container.append(el);
    return el;
  });
  const render = () => {
    els.forEach((e, i) => {
      e.classList.toggle('sel', i === sel);
      const it = items[i];
      if (it.value) (e.querySelector('.val') as HTMLElement).textContent = it.value();
    });
    opts.onMove?.(sel);
  };
  const fire = () => {
    const it = items[sel];
    if (it.disabled) { audio.sfx('ui_back'); return; }
    audio.sfx('ui_ok');
    it.go();
    render();
  };
  render();
  const off = app.input.onUi((e) => {
    if (e === 'up') { sel = (sel + items.length - 1) % items.length; audio.sfx('ui_move'); render(); }
    else if (e === 'down') { sel = (sel + 1) % items.length; audio.sfx('ui_move'); render(); }
    else if (e === 'confirm') fire();
    else if (e === 'back' && opts.back) { audio.sfx('ui_back'); opts.back(); }
  });
  return { off, render, get sel() { return sel; } };
}

interface Update { id: string; date: string; title: string; body: string; pick?: string; icon?: string }
let updatesCache: Update[] | null = null;
async function loadUpdates(): Promise<Update[]> {
  if (updatesCache) return updatesCache;
  try {
    const j = await (await fetch('assets/updates.json', { cache: 'no-cache' })).json();
    updatesCache = (j.updates as Update[]).slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  } catch { updatesCache = []; }
  return updatesCache;
}

const TIPS = [
  "טוען את הצ'אט…", 'מחברים את המצלמה…', 'מסדרים את התאורה…', 'מחכים לסאב הראשון…', 'מכוונים את האוזניות…',
  'עושים ריסטרט ל-OBS…', 'בודקים שהמיקרופון לא על מיוט…', 'מחממים את הגרון…', 'מעדכנים דרייברים…',
  'עוד רגע. כמו כל "אני עולה עוד 5 דקות".',
];

const fmtDate = (d: string) => { const [y, m, dd] = d.split('-'); return `${+dd}.${+m}.${y}`; };

export class Menus {
  constructor(private app: App) {}

  private mount(el: HTMLElement) {
    this.app.uiRoot.append(el);
    return el;
  }

  /** Loading screen: faces light up as each fighter is ready, then "press any key" */
  boot() {
    const bar = h('i');
    const pct = h('div', { class: 'kl-pct' }, ['0%']);
    const tip = h('div', { class: 'kl-tip' }, [h('span', { class: 'kl-tiptext' }, [TIPS[0]])]);
    const sound = h('div', { class: 'kl-sound' }, ['לחצו על מסך או מקש כדי להדליק את הצליל']);
    const faces = h('div', { class: 'kl-faces' });
    const faceEls = ROSTER.map((f) => { const i = h('i', { 'data-id': f.id }); faces.append(i); return i; });
    const el = this.mount(h('div', { class: 'screen kload' }, [logoEl('kl-logo'), faces, h('div', { class: 'kl-bar' }, [bar]), pct, tip, sound]));
    let tipI = 0;
    const tipTimer = setInterval(() => {
      tipI = (tipI + 1) % TIPS.length;
      const t = tip.firstChild as HTMLElement;
      tip.classList.add('swap');
      setTimeout(() => { t.textContent = TIPS[tipI]; tip.classList.remove('swap'); }, 300);
    }, 1800);
    return {
      screen: { update() {}, dispose() { clearInterval(tipTimer); el.remove(); } } as Screen,
      progress(p: number, done: number) {
        bar.style.width = `${Math.round(p * 100)}%`;
        pct.textContent = `${Math.round(p * 100)}%`;
        for (let i = 0; i < done && i < faceEls.length; i++) {
          if (!faceEls[i].classList.contains('on')) {
            faceEls[i].style.backgroundImage = `url(${portraitUrl(i, 'icon')})`;
            faceEls[i].classList.add('on');
          }
        }
      },
      ready: (onGo: () => void) => {
        clearInterval(tipTimer);
        el.classList.add('ready');
        clear(tip);
        tip.append(stone('לחצו על מקש או כפתור'));
        sound.textContent = 'press any key · sound on';
        let done = false;
        const go = () => { if (done) return; done = true; off(); onGo(); };
        const off = this.app.input.onUi((e) => { if (e === 'any') go(); });
        el.addEventListener('pointerdown', go);
      },
    };
  }

  /** After the intro: logo + tagline + press (like the reference start card) */
  startScreen(onGo: () => void): Screen {
    const el = this.mount(h('div', { class: 'screen start-card fade-in' }, [
      logoEl(),
      h('div', { class: 'sub' }, ['FINISH HIM — בלייב']),
      h('div', { class: 'tag' }, ['100K צופים זה Banality.']),
      h('div', { class: 'press' }, [stone('לחצו על כפתור')]),
      h('div', { class: 'byline' }, [h('span', {}, ['STREAM KOMBAT 26 · משחק מעריצים · נבנה בעזרת כלי AI · פארודיה'])]),
    ]));
    let done = false;
    const go = () => { if (done) return; done = true; onGo(); };
    const off = this.app.input.onUi((e) => { if (e === 'any') go(); });
    el.addEventListener('pointerdown', go);
    return { update() {}, dispose() { off(); el.remove(); } };
  }

  mainMenu(start = 0): Screen {
    const app = this.app;
    const list = h('div', { class: 'kmenu main' });
    const tagline = h('div', { class: 'menu-tagline' });
    const items: ListItem[] = [
      { he: 'קרב', en: 'ARCADE', desc: 'אתם נגד המחשב. מנצחים, גומרים אותו, בנאליטי.', go: () => app.goSelect('arcade') },
      { he: 'שחקן נגד שחקן', en: 'VERSUS', desc: 'שני שחקנים: מקלדת (WASD / חצים) או שני בקרים.', go: () => app.goSelect('versus') },
      { he: 'אונליין', en: 'ONLINE', desc: 'פותחים חדר, שולחים קישור קצר לחברים, והמארח לוחץ START. בלי התקנות ובלי שרת.', go: () => app.goLobby() },
      { he: 'אימון', en: 'PRACTICE', desc: 'בובת אימון, בלי שעון ובלי נוק-אאוט. תרגלו מהלכים, קומבו ובנאליטי.', go: () => app.goSelect('practice') },
      { he: 'הדגמה', en: 'DEMO', desc: 'המחשב נגד המחשב. שבו, תיהנו.', go: () => app.startDemo() },
      { he: 'הגדרות', en: 'OPTIONS', desc: 'קושי, סבבים, זמן, עוצמות, גרפיקה ומקשים.', go: () => app.goOptions() },
      { he: 'קרדיטים', en: 'CREDITS', desc: 'מי עשה את המשחק, ואיך.', go: () => app.goCredits() },
    ];
    const nav = listNav(app, list, items, { start, onMove: (i) => { tagline.textContent = items[i].desc ?? ''; } });

    const keys: [string, string][] = [
      ['תנועה (פעמיים = דאש)', `${K('left')}/${K('right')} • ←/→`], ['קפיצה / התכופפות', `${K('up')}/${K('down')} • ↑/↓`],
      ['אגרופים', `${K('lp')} • ${K('hp')}`], ['בעיטות', `${K('lk')} • ${K('hk')}`], ['הגנה', KA('block')],
      ['הטלה', throwInput()], ['מהלך מיוחד', `${spInput('U')} • ${spInput('FU')} • ${spInput('DU')}`], ['מהלך הייפ (מד מלא)', hypeInput()], ['הפסקה', KA('start')],
    ];
    const controls = h('div', { class: 'side-panel left controls-panel' }, [
      h('div', { class: 'pad-rec' }, [h('span', { class: 'pad-ico' }, ['🎮']), h('span', {}, ['מומלץ לשחק עם בקר'])]),
      h('h3', {}, ['מקשים']),
      h('table', {}, [h('tr', {}, [h('th', {}, ['']), h('th', {}, ['מקלדת'])]), ...keys.map(([a, b]) => h('tr', {}, [h('td', {}, [a]), h('td', { class: 'k' }, [b])]))]),
      h('div', { class: 'sub' }, ['יש בקר? לחצו על כפתור והוא יופיע כאן.']),
    ]);
    const news = h('div', { class: 'side-panel right news-panel' });
    let expanded = false;
    const renderNews = (ups: Update[]) => {
      clear(news);
      const unseen = ups.filter((u) => !app.save.seenNews.includes(u.id)).length;
      news.append(h('h3', {}, [unseen ? h('span', { class: 'badge-n' }, [String(unseen)]) : '', 'מה חדש']));
      const show = expanded ? ups : ups.slice(0, 3);
      for (const u of show) {
        const idx = u.pick ? ROSTER.findIndex((f) => f.id === u.pick) : -1;
        const isNew = !app.save.seenNews.includes(u.id);
        news.append(h('div', { class: 'news-card' }, [
          h('div', {}, [
            h('div', { class: 'date' }, [isNew ? h('b', { class: 'tag' }, ['חדש!']) : '', fmtDate(u.date)]),
            h('div', { class: 't' }, [u.title]),
            h('div', { class: 'd' }, [u.body.replace(/\{sp\}/g, K('sp'))]),
            idx >= 0 ? h('div', { class: 'go', onclick: () => app.goSelect('practice', idx) }, ['← לנסות עכשיו']) : '',
          ]),
          idx >= 0 ? h('div', { class: 'ava', style: `background-image:url(${portraitUrl(idx, 'icon')})` }) : h('div', { class: 'ava ico' }, [u.icon ?? '✦']),
        ]));
      }
      if (ups.length > 3) news.append(h('div', { class: 'news-more', onclick: () => { expanded = !expanded; markSeen(ups); renderNews(ups); } }, [expanded ? 'פחות ▴' : `עוד ${ups.length - 3} עדכונים ▾`]));
    };
    const markSeen = (ups: Update[]) => {
      let changed = false;
      for (const u of ups) if (!app.save.seenNews.includes(u.id)) { app.save.seenNews.push(u.id); changed = true; }
      if (changed) app.persistSave();
    };
    void loadUpdates().then(renderNews);
    const offNews = app.input.onUi((e) => { if (e === 'right' || e === 'left') { expanded = !expanded; void loadUpdates().then((u) => { markSeen(u); renderNews(u); }); } });
    const el = this.mount(h('div', { class: 'screen main-menu fade-in' }, [
      logoEl(), list, controls, news, tagline,
      h('div', { class: 'menu-hint' }, [h('b', {}, ['↑↓']), ' בחירה • ', h('b', {}, ['Enter / ✕']), ' אישור • ', h('b', {}, ['→']), ' מה חדש']),
      this.aiBadge(),
    ]));
    return {
      update: () => { if (app.idleT > 45) { app.idleT = 0; app.goIntro(() => app.goMenu(nav.sel)); } },
      dispose: () => { nav.off(); offNews(); el.remove(); },
    };
  }

  aiBadge(): HTMLElement {
    return h('div', { class: 'kk-ai' }, ['✦ AI', h('span', { class: 'tip' }, [h('b', {}, ['נבנה בעזרת כלי AI · פארודיה']), h('small', {}, ['built with AI tools · parody'])])]);
  }

  options(): Screen {
    const app = this.app;
    const s = app.settings;
    type Row = { he: string; en: string; desc: string; get: () => string; left?: () => void; right?: () => void; slider?: () => number; go?: () => void; section?: string };
    const cyc = <T,>(arr: readonly T[], cur: T, d: number) => arr[(arr.indexOf(cur) + d + arr.length) % arr.length];
    const vol = (k: 'music' | 'sfx' | 'voices') => ({ slider: () => s[k], left: () => { s[k] = Math.max(0, Math.round((s[k] - 0.1) * 10) / 10); }, right: () => { s[k] = Math.min(1, Math.round((s[k] + 0.1) * 10) / 10); } });
    const toggle = (k: 'battleIntro' | 'hints' | 'streamHud' | 'showFps' | 'inputDisplay') => ({ get: () => (s[k] ? 'פועל' : 'כבוי'), left: () => { s[k] = !s[k]; }, right: () => { s[k] = !s[k]; } });
    let resetArm = false;
    let unlockArm = false;
    const rows: Row[] = [
      { he: 'רמת קושי', en: 'DIFFICULTY', desc: 'כמה המחשב מרושע.', get: () => ['קל', 'רגיל', 'קשה', 'אכזרי'][s.difficulty], left: () => { s.difficulty = Math.max(0, s.difficulty - 1) as Settings['difficulty']; }, right: () => { s.difficulty = Math.min(3, s.difficulty + 1) as Settings['difficulty']; } },
      { he: 'סבבים לניצחון', en: 'ROUNDS', desc: 'כמה סבבים צריך לנצח במשחק.', get: () => String(s.rounds), left: () => { s.rounds = Math.max(1, s.rounds - 1); }, right: () => { s.rounds = Math.min(5, s.rounds + 1); } },
      { he: 'זמן לסבב', en: 'TIME', desc: 'שעון הסבב. ∞ = בלי שעון.', get: () => (s.roundTime ? String(s.roundTime) : '∞'), left: () => { s.roundTime = cyc([30, 60, 99, 0], s.roundTime, -1); }, right: () => { s.roundTime = cyc([30, 60, 99, 0], s.roundTime, 1); } },
      { he: 'מוזיקה', en: 'MUSIC', desc: 'עוצמת המוזיקה.', get: () => '', ...vol('music') },
      { he: 'אפקטים', en: 'SFX', desc: 'עוצמת המכות והאפקטים.', get: () => '', ...vol('sfx') },
      { he: 'קולות וכרוז', en: 'VOICES', desc: 'עוצמת הכרוז וקולות הלוחמים.', get: () => '', ...vol('voices') },
      { he: 'שפת הכרוז', en: 'ANNOUNCER', desc: 'הכרוז בקרב: עברית או אנגלית של ארקייד.', get: () => (s.announcerLang === 'he' ? 'עברית' : 'English'), left: () => { s.announcerLang = s.announcerLang === 'he' ? 'en' : 'he'; }, right: () => { s.announcerLang = s.announcerLang === 'he' ? 'en' : 'he'; } },
      { he: 'סרטון לפני קרב', en: 'BATTLE INTRO', desc: 'הצגת הלוחמים ודו-שיח לפני הסבב הראשון.', ...toggle('battleIntro') },
      { he: 'רמזי מקשים', en: 'HINTS', desc: 'רמזים על המסך (למשל איך לבחור בנאליטי).', ...toggle('hints') },
      { he: 'HUD של שידור', en: 'STREAM HUD', desc: "צ'אט, צופים והתראות סאב/דונייט בזמן הקרב. השמות בקובץ assets/chat/chatters.txt", ...toggle('streamHud') },
      { he: "מהירות צ'אט", en: 'CHAT SPEED', desc: "כמה מהר הצ'אט רץ.", get: () => ['איטי', 'רגיל', 'מהיר', 'טירוף'][[0.5, 1, 1.5, 2.5].indexOf(s.chatSpeed)] ?? 'רגיל', left: () => { s.chatSpeed = cyc([0.5, 1, 1.5, 2.5], s.chatSpeed, -1); }, right: () => { s.chatSpeed = cyc([0.5, 1, 1.5, 2.5], s.chatSpeed, 1); } },
      { he: 'איכות גרפיקה', en: 'QUALITY', desc: 'אם יש קפיצות — להוריד.', get: () => ({ low: 'נמוכה', medium: 'בינונית', high: 'גבוהה', ultra: 'אולטרה' })[s.quality], left: () => { s.quality = cyc(['low', 'medium', 'high', 'ultra'] as const, s.quality, -1); }, right: () => { s.quality = cyc(['low', 'medium', 'high', 'ultra'] as const, s.quality, 1); } },
      { he: 'רעידת מסך', en: 'SCREEN SHAKE', desc: 'רעידות מצלמה במכות חזקות.', get: () => '', slider: () => s.shake, left: () => { s.shake = Math.max(0, Math.round((s.shake - 0.25) * 4) / 4); }, right: () => { s.shake = Math.min(1, Math.round((s.shake + 0.25) * 4) / 4); } },
      { he: 'מונה FPS', en: 'SHOW FPS', desc: 'מציג פריימים לשנייה.', ...toggle('showFps') },
      { he: 'תצוגת לחיצות', en: 'INPUT DISPLAY', desc: 'מציג את הלחיצות בזמן קרב.', ...toggle('inputDisplay') },
      { he: 'השהיית קלט', en: 'ONLINE DELAY', desc: 'פריימים של השהייה באונליין. אוטומטי = לפי הפינג ליריב (מומלץ). פחות = מגיב יותר, יותר = חלק יותר בפינג גבוה.', get: () => (s.inputDelay < 0 ? 'אוטומטי' : String(s.inputDelay)), left: () => { s.inputDelay = Math.max(-1, s.inputDelay - 1); }, right: () => { s.inputDelay = Math.min(6, s.inputDelay + 1); } },
      { he: 'מקשים ובקרים', en: 'CONTROLS', desc: 'מקלדת, שחקן 2 ובקר.', get: () => '', go: () => this.app.setScreen(this.controls()) },
      { he: 'איפוס הגדרות', en: 'RESET', desc: 'מחזיר את כל ההגדרות לברירת מחדל. לחצו פעמיים.', get: () => (resetArm ? 'בטוח?' : ''), go: () => { if (resetArm) { Object.assign(s, structuredClone(DEFAULT_SETTINGS)); resetArm = false; app.toast('ההגדרות אופסו'); } else resetArm = true; } },
      { he: 'איפוס התקדמות', en: 'RESET UNLOCKS', desc: 'נועל מחדש את הדמויות הסודיות. לחצו פעמיים.', get: () => { const [g, t] = app.unlockCount(); return unlockArm ? 'בטוח?' : `${g}/${t} נפתחו`; }, go: () => { if (unlockArm) { app.resetUnlocks(); unlockArm = false; app.toast('ההתקדמות אופסה'); } else unlockArm = true; } },
      { he: 'חזרה', en: 'BACK', desc: '', get: () => '', go: () => app.goMenu(5) },
    ];
    const list = h('div', { class: 'opt-list' });
    const desc = h('div', { class: 'opt-desc' });
    let sel = 0;
    const rowEls: HTMLElement[] = [];
    rows.forEach((r, i) => {
      const val = h('div', { class: 'val' });
      const el = h('div', { class: 'opt-row', onclick: () => { sel = i; render(); act(0); } }, [h('div', { class: 'he' }, [stone(r.he)]), h('div', { class: 'en' }, [r.en]), val]);
      rowEls.push(el);
      list.append(el);
    });
    const render = () => {
      rows.forEach((r, i) => {
        const el = rowEls[i];
        el.classList.toggle('sel', i === sel);
        const val = el.querySelector('.val') as HTMLElement;
        clear(val);
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
      if (r.en !== 'RESET') resetArm = false;
      if (r.en !== 'RESET UNLOCKS') unlockArm = false;
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
    const el = this.mount(h('div', { class: 'screen options fade-in' }, [
      h('h1', {}, [stone('הגדרות')]), h('div', { class: 'opt-scroll' }, [list]), desc,
      h('div', { class: 'menu-hint' }, [h('b', {}, ['↑↓']), ' בחירה · ', h('b', {}, ['←→']), ' שינוי · ', h('b', {}, ['Enter / ✕']), ' אישור · ', h('b', {}, ['Esc / ○']), ' חזרה']),
    ]));
    render();
    return { update() {}, dispose() { off(); el.remove(); } };
  }

  controls(): Screen {
    const app = this.app;
    const s = app.settings;
    let player = 0;
    let sel = 0;
    const list = h('div', { class: 'opt-list' });
    const title = h('h1', {});
    const desc = h('div', { class: 'opt-desc' }, ['Enter = לשנות מקש · ←/→ = שחקן 1/2 · Esc = חזרה']);
    const rows = [...ACTIONS, 'defaults' as const];
    const render = () => {
      clear(title);
      title.append(stone(`מקשים — שחקן ${player + 1}`));
      clear(list);
      const map = player === 0 ? s.p1Keys : s.p2Keys;
      rows.forEach((a, i) => {
        const val = a === 'defaults' ? 'ברירת מחדל' : map[a as Action].map(keyLabel).join(' / ');
        list.append(h('div', { class: 'opt-row' + (i === sel ? ' sel' : '') }, [
          h('div', { class: 'he' }, [stone(a === 'defaults' ? 'איפוס מקשים' : ACTION_HE[a as Action])]),
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
    const sec = (title: string, lines: [string, string][]) => [h('h2', {}, [title]), ...lines.map(([a, b]) => h('p', {}, [a, h('small', {}, [b])]))];
    const roll = h('div', { class: 'roll' }, [
      logoEl('small'),
      h('h2', {}, ['הלוחמים']),
      ...ROSTER.map((f) => h('p', {}, [stone(f.he), h('small', {}, [`${f.name} · ${f.title} · ${f.channel}`])])),
      ...sec('המשחק', [
        ['רעיון', 'הסטרימרים עצמם 🙌'],
        ['קוד', 'Claude (Anthropic)'],
        ['דמויות תלת-ממד ואנימציה', 'נבנו בקוד בתוך המשחק (מודלי AI בדרך)'],
        ['לוגו, ממשק ורקעים', 'נבנו בקוד'],
        ['מוזיקה', 'סינתיסייזר בקוד — יצירה מקורית'],
        ['איתור וחיתוך קטעי קול', 'מתוך הקליפים הציבוריים של הסטרימרים, באישורם'],
        ['קול הכרוז', 'קול מחשב כללי של Microsoft (לא של אדם אמיתי)'],
        ['השראה', 'KNESSET KOMBAT 26 · Mortal Kombat · Tekken'],
      ]),
      ...sec('תודה מיוחדת', [["לצ'אט", 'KEKW · W · GG']]),
      h('p', { style: 'margin-top:12vh' }, ['תודה ששיחקתם', h('small', {}, ['STAY AWESOME'])]),
    ]);
    const el = this.mount(h('div', { class: 'screen credits fade-in' }, [roll, this.aiBadge()]));
    const t = setTimeout(done, 42000);
    const off = this.app.input.onUi((e) => { if (e === 'back' || e === 'confirm' || e === 'start') { clearTimeout(t); done(); } });
    return { update() {}, dispose() { clearTimeout(t); off(); el.remove(); } };
  }

  /** Pre-fight card shown over the fight scene: logo, VS, press any key, a random quote */
  startOverlay(cfg: MatchConfig, sub: string | undefined, onGo: () => void): HTMLElement {
    const [a, b] = cfg.chars;
    const fa = ROSTER[a], fb = ROSTER[b];
    const q = Math.random() < 0.5 ? fa : fb;
    const medal = (i: number, skin: number) => h('span', { class: 'medal' }, [h('img', { class: 'face', src: portraitUrl(i, 'icon', skin), alt: '' })]);
    const el = this.mount(h('div', { class: 'start-overlay fade-in' }, [
      logoEl(),
      h('div', { class: 'vs' }, [
        h('div', { class: 'side p1' }, [medal(a, cfg.skins[0]), stone(fa.he)]),
        stone('VS', 'vs-word'),
        h('div', { class: 'side p2' }, [stone(fb.he), medal(b, cfg.skins[1])]),
      ]),
      sub ? h('div', { class: 'vs-sub' }, [sub]) : '',
      h('div', { class: 'press' }, [stone('לחצו על מקש או כפתור — עולים לשידור!')]),
      h('div', { class: 'press-en' }, ['press any key · or connect a controller']),
      h('div', { class: 'quote' }, [`«${FLAVOR[q.id]?.quote ?? q.win}» (${q.he})`]),
      h('div', { class: 'vs-stage' }, ['זירה: ' + (STAGES[cfg.stage]?.he ?? '')]),
    ]));
    audio.sfx('select');
    let done = false;
    const go = () => { if (done) return; done = true; off(); el.classList.add('out'); setTimeout(() => el.remove(), 350); onGo(); };
    const off = this.app.input.onUi((e) => { if (e === 'any') go(); });
    el.addEventListener('pointerdown', go);
    return el;
  }

  /** The movelist panel (also used by the pause menu) */
  movelist(charIdx: number): HTMLElement {
    const f = ROSTER[charIdx];
    const fl = FLAVOR[f.id];
    const li = (name: string, kbd: string, alt?: string, cls = '') => h('li', { class: cls }, [h('b', {}, [name]), h('kbd', {}, [kbd]), alt ? h('i', {}, [alt]) : '']);
    const [b1, b2] = banalityInputs();
    return h('div', { class: 'movelist' }, [h('div', { class: 'col' }, [
      h('span', { class: 'medal' }, [h('img', { class: 'face', src: portraitUrl(charIdx, 'icon'), alt: '' })]),
      stone(f.he),
      h('ul', {}, [
        ...f.specials.map((s) => li(s.name, spInput(s.input), motionInput(s.input))),
        li(f.hype.name + ' (מד הייפ)', hypeInput()),
        h('li', { class: 'sep' }),
        li('זריקה', throwInput(), '', 'basic'),
        li('דאש / ריצה', '→→ (החזיקו →)', '', 'basic'),
        li('דאש אחורה', '←←', '', 'basic'),
        li('אפרקאט', `↓+${K('hp')}`, '', 'basic'),
        li('סוויפ', `↓+${K('hk')}`, '', 'basic'),
        li('ספרטן קיק', `→+${K('lk')}`, '', 'basic'),
        li('מכה עליונה', `→+${K('hp')}`, '', 'basic'),
        li('הגנה', `${K('block')} (+↓ לנמוכות)`, '', 'basic'),
        fl ? li(`בנאליטי: ${fl.banalities[0].name}`, b1, '', 'basic') : '',
        fl ? li(`בנאליטי: ${fl.banalities[1].name}`, b2, '', 'basic') : '',
      ]),
    ])]);
  }

  pauseMenu(b: Battle, a: { online?: boolean; resume: () => void; restart: () => void; select: () => void; quit: () => void; practice?: { dummy: () => string; cycleDummy: () => void; banality: () => void; resetPos: () => void } }): HTMLElement {
    const m = b.driver.state();
    let who = 0;
    const mlWrap = h('div', { class: 'ml-wrap' }, [this.movelist(m.f[0].char)]);
    const list = h('div', { class: 'kmenu pausemenu' });
    const el = this.mount(h('div', { class: 'pause-overlay fade-in' }, [
      h('div', { class: 'pause-title' }, [stone(a.online ? 'תפריט' : 'הפסקה')]),
      mlWrap,
      list,
      h('div', { class: 'menu-hint' }, [h('b', {}, ['↑↓']), ' בחירה • ', h('b', {}, ['←→']), ' רשימת מהלכים של שחקן 1/2 • ', h('b', {}, ['Esc / P']), ' המשך', a.online ? ' • הקרב ממשיך ברקע!' : '']),
    ]));
    const isFs = () => !!document.fullscreenElement;
    const items: ListItem[] = [
      { he: 'המשך', en: 'RESUME', go: () => { close(); a.resume(); } },
      ...(a.online ? [] : [{ he: 'התחלה מחדש', en: 'RESTART', go: () => { close(); a.restart(); } }] as ListItem[]),
      ...(a.practice ? [
        { he: 'בובת אימון', en: 'DUMMY', value: a.practice.dummy, go: a.practice.cycleDummy, cls: 'opt' },
        { he: 'בנאליטי לאימון', en: 'PRACTICE BANALITY', go: () => { close(); a.practice!.banality(); }, cls: 'opt' },
        { he: 'איפוס מיקום', en: 'RESET POSITION', go: () => { close(); a.practice!.resetPos(); }, cls: 'opt' },
      ] as ListItem[] : []),
      { he: isFs() ? 'יציאה ממסך מלא' : 'מסך מלא', en: 'FULLSCREEN', go: () => { if (isFs()) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.().catch(() => {}); }, value: () => (isFs() ? '✓' : '') },
      { he: 'מוזיקה', en: 'MUSIC', value: () => (this.app.settings.music > 0 ? '🔊' : '🔇'), go: () => { const s = this.app.settings; s.music = s.music > 0 ? 0 : 0.7; this.app.applySettings(); } },
      ...(a.online
        ? [{ he: 'יציאה מהקרב', en: 'LEAVE MATCH', go: () => { close(); a.quit(); } }]
        : [{ he: 'בחירת לוחם', en: 'CHARACTER SELECT', go: () => { close(); a.select(); } }, { he: 'תפריט ראשי', en: 'MAIN MENU', go: () => { close(); a.quit(); } }]) as ListItem[],
    ];
    const nav = listNav(this.app, list, items, { back: () => { close(); a.resume(); } });
    const offSide = this.app.input.onUi((e) => {
      if (e === 'left' || e === 'right') {
        who = 1 - who;
        clear(mlWrap);
        mlWrap.append(this.movelist(m.f[who].char));
        audio.sfx('ui_move');
      }
    });
    let closed = false;
    const close = () => { if (closed) return; closed = true; nav.off(); offSide(); el.remove(); };
    const origRemove = el.remove.bind(el);
    el.remove = () => { if (!closed) { closed = true; nav.off(); offSide(); } origRemove(); };
    return el;
  }

  results(m: MatchState, winner: number, items: ListItem[], onKeys?: { rematch: () => void; menu: () => void }): { dispose(): void } {
    const w = winner === 0 || winner === 1 ? ROSTER[m.f[winner].char] : null;
    const list = h('div', { class: 'kmenu results-menu' });
    const loser = w ? m.f[1 - winner] : null;
    const el = this.mount(h('div', { class: 'results-overlay fade-in' }, [
      h('div', { class: 'res-title' }, [stone(w ? `${w.he} ${w.female ? 'מנצחת' : 'מנצח'}` : 'תיקו')]),
      w ? h('div', { class: 'quote' }, [`"${w.win}"`]) : '',
      h('div', { class: 'stats' }, [
        h('div', {}, [h('b', {}, [String(m.round)]), 'סבבים']),
        h('div', {}, [h('b', {}, [w ? String(m.f[winner].hp) : '-']), 'חיים שנשארו']),
        h('div', {}, [h('b', {}, [m.banality ? 'כן' : 'לא']), 'בנאליטי']),
        h('div', {}, [h('b', {}, [loser ? String(loser.damageTaken) : '-']), 'נזק']),
      ]),
      list,
      h('div', { class: 'menu-hint' }, [h('b', {}, ['R']), ' לסיבוב חוזר · ', h('b', {}, ['Esc']), ' לתפריט']),
    ]));
    const nav = listNav(this.app, list, items);
    const onKey = (e: KeyboardEvent) => {
      if (!onKeys) return;
      if (e.code === 'KeyR') { e.preventDefault(); onKeys.rematch(); }
      if (e.code === 'Escape') { e.preventDefault(); onKeys.menu(); }
    };
    window.addEventListener('keydown', onKey);
    return { dispose() { nav.off(); window.removeEventListener('keydown', onKey); el.remove(); } };
  }

  practicePanel(b: Battle) {
    const modes = ['עומדת', 'מתכופפת', 'קופצת', 'חוסמת', 'חוסמת נמוך', 'מחשב'];
    const bits = [0, C.IN_DOWN, C.IN_UP, C.IN_BLOCK, C.IN_BLOCK | C.IN_DOWN];
    let mode = 0;
    const fd = h('div', { class: 'fd' });
    const modeEl = h('b');
    const el = this.mount(h('div', { class: 'practice-panel' }, [
      h('div', { class: 'pp-title' }, [stone('אימון')]),
      h('div', {}, ['בובה: ', modeEl]),
      h('div', { class: 'pp-sub' }, ['בלי שעון · בלי נוק-אאוט']),
      h('div', { class: 'pp-keys' }, [h('b', {}, ['T']), ' בובה · ', h('b', {}, ['F']), ' בנאליטי · ', h('b', {}, ['R']), ' איפוס · ', h('b', {}, ['H']), ' מד הייפ · ', h('b', {}, ['Esc']), ' תפריט']),
      fd,
    ]));
    const d = b.driver as LocalDriver;
    const cpu = new Cpu(1, this.app.settings.difficulty);
    d.override = (i) => (i !== 1 ? null : mode === 5 ? cpu.input(d.m) : bits[mode]);
    const cycle = () => { mode = (mode + 1) % modes.length; modeEl.textContent = modes[mode]; };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyT') { e.preventDefault(); cycle(); }
      if (e.code === 'KeyH') { e.preventDefault(); d.m.f[0].meter = 1000; }
      if (e.code === 'KeyR') { e.preventDefault(); b.resetPositions(); }
      if (e.code === 'KeyF') { e.preventDefault(); b.practiceBanality(); }
    };
    window.addEventListener('keydown', onKey);
    modeEl.textContent = modes[mode];
    let lastMove = -1;
    return {
      dummy: () => modes[mode],
      cycle,
      update: () => {
        const f = d.m.f[0];
        if (f.move >= 0 && f.move !== lastMove) {
          const mv = movesFor(f.char)[f.move];
          if (mv) fd.textContent = `${mv.key}: startup ${mv.startup} · active ${mv.active} · rec ${mv.recovery} · dmg ${mv.damage} · ${mv.level}`;
        }
        lastMove = f.move;
      },
      dispose: () => { window.removeEventListener('keydown', onKey); el.remove(); },
    };
  }
}

type Settings = App['settings'];
