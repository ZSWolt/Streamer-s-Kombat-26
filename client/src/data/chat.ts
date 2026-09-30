// Fake stream chat that reacts to the fight. Names and lines are loaded from editable text files:
//   client/public/assets/chat/chatters.txt   (one name per line, optional "|mod" / "|vip" / "|sub" / "|og" badge)
//   client/public/assets/chat/messages.txt   ([section] headers, one message per line)
// The lists below are only a fallback if the files are missing.

export interface Chatter { name: string; badge: '' | 'mod' | 'vip' | 'sub' | 'og' }

export let USERS: Chatter[] = [
  'tal16373', 'ilaycz', 'et18', 'Kuma1234', 'Stern18', 'zlixy132', 'jack4reall', 'Liad1010', 'Laviehoyo', 'yoav_gg',
  'noam.k', 'shaked_x', 'itay_pro', 'ofir777', 'danaaa', 'omer_big', 'NachuM', 'batsek', 'H_Heisey', 'Yoavguber',
].map((name) => ({ name, badge: '' as const }));

export const BADGE_ICON: Record<Chatter['badge'], string> = { '': '', mod: '🗡️', vip: '💎', sub: '⭐', og: '👑' };

export const USER_COLORS = ['#53fc18', '#ff6b6b', '#4dabf7', '#ffd43b', '#cc5de8', '#ff922b', '#20c997', '#f783ac', '#94d82d', '#74c0fc'];

export const EMOTES = ['KEKW', 'OMEGALUL', 'PogChamp', 'LUL', 'monkaS', 'Sadge', 'EZ', 'W', '🔥', '💀', '😭', '🤣', '👀', '🫡', 'GIGACHAD', 'Copium'];

export let LINES: Record<string, string[]> = {
  idle: ['יאללה תתחילו', 'מי מנצח לדעתכם?', 'אני על {p1}', '{p2} לוקח את זה בקלות', 'W סטרים', 'גגגגג', '👀👀👀'],
  hit: ['אוףףף', 'KEKW', 'הרגיש את זה', 'ווווו', '💀', 'חחחחחחח'],
  bigHit: ['איזה מכה!!!', 'OMEGALUL', 'קליפ!!!', 'CLIP IT', '💀💀💀'],
  block: ['תחסום אחי', 'מחסום', 'EZ block'],
  combo: ['איזה קומבו!!!', 'COMBO', 'GIGACHAD', '{n} מכות ברצף???'],
  special: ['המהלך הזה 🔥', 'מה זה היה', 'LETS GOOO'],
  hype: ['HYPE!!!!', '🔥🔥🔥🔥', 'POGGERS'],
  lowHp: ['{low} על חוט', 'Copium', 'monkaS'],
  ko: ['GG', 'GGGGGG', 'EZ', 'W {win}', 'L {lose}'],
  finish: ['תגמור אותו!!!', 'BANALITY BANALITY', '👀👀👀👀'],
  banality: ['WHAT', 'OMEGALUL OMEGALUL', 'קליפ של השנה'],
  perfect: ['FLAWLESS', 'GIGACHAD'],
  throw: ['הטלה!!', 'WWE'],
  counter: ['קאונטר!!!', 'READ'],
  jump: ['למה הוא קופץ'],
  timeOver: ['נגמר הזמן?!'],
};

export const ALERTS = {
  sub: ['{u} נרשם לערוץ! 🎉', '{u} נרשם ל-{m} חודשים! 🎉'],
  gift: ['{u} חילק {n} סאבים! 🎁'],
  donate: ['{u} תרם {n}₪: "תחסום!!!"', '{u} תרם {n}₪: "איזה קומבו"', '{u} תרם {n}₪: "{win} המלך"', '{u} תרם {n}₪: "קליפ!!"'],
  raid: ['RAID! {s} הגיע עם {n} צופים 🚀'],
  follow: ['{u} עכשיו עוקב ❤️'],
};

export function pick<T>(a: T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}

export function fill(t: string, vars: Record<string, string | number>) {
  return t.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

function lines(txt: string): string[] {
  return txt.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

/** Load chatters.txt + messages.txt (call once at boot; silently keeps the fallback lists on failure) */
export async function loadChatFiles() {
  try {
    const r = await fetch('assets/chat/chatters.txt', { cache: 'no-cache' });
    if (r.ok) {
      const list = lines(await r.text()).map((l) => {
        const [name, badge = ''] = l.split('|').map((x) => x.trim());
        return { name, badge: (['mod', 'vip', 'sub', 'og'].includes(badge) ? badge : '') as Chatter['badge'] };
      }).filter((c) => c.name);
      if (list.length) USERS = list;
    }
  } catch { /* keep fallback */ }
  try {
    const r = await fetch('assets/chat/messages.txt', { cache: 'no-cache' });
    if (r.ok) {
      const out: Record<string, string[]> = {};
      let cur = '';
      for (const l of lines(await r.text())) {
        const m = l.match(/^\[(\w+)\]$/);
        if (m) { cur = m[1]; out[cur] = out[cur] ?? []; continue; }
        if (cur) out[cur].push(l);
      }
      for (const k of Object.keys(out)) if (out[k].length) LINES[k] = out[k];
    }
  } catch { /* keep fallback */ }
}
