import { ROSTER } from '../data/roster';
import { audio } from './AudioEngine';

// Announcer lines are pre-rendered files (tools/announcer). If a file is missing we fall back to the
// browser's speech synthesis so the game is never silent during development.

export const ANNOUNCER_LINES: Record<string, { he: string; en: string }> = {
  title: { he: 'סטרים קומבט עשרים ושש', en: 'Stream Kombat twenty six' },
  select: { he: 'בחר לוחם', en: 'Choose your fighter' },
  round1: { he: 'סיבוב ראשון', en: 'Round one' },
  round2: { he: 'סיבוב שני', en: 'Round two' },
  round3: { he: 'סיבוב שלישי', en: 'Round three' },
  round4: { he: 'סיבוב רביעי', en: 'Round four' },
  round5: { he: 'סיבוב חמישי', en: 'Round five' },
  final: { he: 'סיבוב אחרון', en: 'Final round' },
  fight: { he: 'להילחם!', en: 'Fight!' },
  ko: { he: 'נוקאאוט!', en: 'K.O.!' },
  doubleko: { he: 'נוקאאוט כפול!', en: 'Double K.O.!' },
  finish_him: { he: 'תגמור אותו!', en: 'Finish him!' },
  finish_her: { he: 'תגמור אותה!', en: 'Finish her!' },
  flawless: { he: 'ניצחון מושלם', en: 'Flawless victory' },
  time: { he: 'נגמר הזמן', en: 'Time!' },
  draw: { he: 'תיקו', en: 'Draw' },
  wins: { he: 'מנצח', en: 'wins' },
  banality: { he: 'בנאליטי!', en: 'Banality!' },
  hype: { he: 'הייפ!', en: 'Hype!' },
  combo: { he: 'קומבו!', en: 'Combo!' },
  raid: { he: 'ריייייד!', en: 'Raid!' },
};
for (const f of ROSTER) ANNOUNCER_LINES['name_' + f.id] = { he: f.he, en: f.name };

export class Announcer {
  lang: 'he' | 'en' = 'he';
  private queue: Promise<void> = Promise.resolve();
  private missing = new Set<string>();

  preload(keys: string[]) {
    for (const k of keys) void audio.loadBuffer(this.url(k));
  }

  private url(key: string) { return `assets/audio/announcer/${this.lang}/${key}.mp3`; }

  say(key: string, delayMs = 0): Promise<void> {
    this.queue = this.queue.then(() => new Promise<void>((resolve) => {
      setTimeout(async () => {
        const buf = this.missing.has(this.lang + key) ? null : await audio.loadBuffer(this.url(key));
        if (buf) {
          const src = audio.playBuffer(buf, 'voice', { rate: 1, vol: 1.1, reverb: 0.35 });
          if (src) { src.onended = () => resolve(); setTimeout(resolve, buf.duration * 1000 + 50); } else resolve();
          return;
        }
        this.missing.add(this.lang + key);
        this.speak(ANNOUNCER_LINES[key]?.[this.lang] ?? key).then(resolve);
      }, delayMs);
    }));
    return this.queue;
  }

  sayNow(key: string) {
    this.queue = Promise.resolve();
    return this.say(key);
  }

  private speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window) || audio.voiceBus?.gain.value === 0) { resolve(); return; }
      const u = new SpeechSynthesisUtterance(text);
      const voices = speechSynthesis.getVoices();
      const want = this.lang === 'he' ? 'he' : 'en';
      const v = voices.find((x) => x.lang.toLowerCase().startsWith(want) && /male|david|guy|asaf|avri/i.test(x.name)) ?? voices.find((x) => x.lang.toLowerCase().startsWith(want));
      if (!v && this.lang === 'he') { resolve(); return; }
      if (v) u.voice = v;
      u.lang = this.lang === 'he' ? 'he-IL' : 'en-US';
      u.pitch = 0.55;
      u.rate = 0.92;
      u.volume = Math.min(1, (audio.voiceBus?.gain.value ?? 1));
      u.onend = () => resolve();
      u.onerror = () => resolve();
      speechSynthesis.speak(u);
      setTimeout(resolve, 2500);
    });
  }
}

export const announcer = new Announcer();

/** Real voice clips of the streamers (cut from their own streams), if present */
export class VoiceBank {
  private cache = new Map<string, string[]>();
  /** `sp<slot>` is a line that belongs to one special move; resolves to whether the fighter has a clip of that kind */
  async play(charId: string, kind: 'intro' | 'win' | 'hurt' | 'ko' | 'special' | 'taunt' | `sp${number}`, pan = 0): Promise<boolean> {
    const list = await this.list(charId);
    const opts = list.filter((f) => f.startsWith(kind + '_'));
    if (!opts.length) return false;
    const file = opts[Math.floor(Math.random() * opts.length)];
    const buf = await audio.loadBuffer(`assets/audio/voices/${charId}/${file}`);
    if (buf) audio.playBuffer(buf, 'voice', { pan, vol: 1 });
    return true;
  }
  private async list(charId: string): Promise<string[]> {
    const hit = this.cache.get(charId);
    if (hit) return hit;
    try {
      const r = await fetch(`assets/audio/voices/${charId}/index.json`);
      const j = r.ok ? ((await r.json()) as string[]) : [];
      this.cache.set(charId, j);
      return j;
    } catch {
      this.cache.set(charId, []);
      return [];
    }
  }
}

export const voices = new VoiceBank();
