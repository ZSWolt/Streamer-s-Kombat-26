// Fake stream chat that reacts to the fight. All lines are harmless banter.

export const USERS = [
  'tal16373', 'ilaycz', 'et18', 'Kuma1234', 'Stern18', 'zlixy132', 'jack4reall', 'Liad1010', 'Laviehoyo', 'yoav_gg',
  'noam.k', 'shaked_x', 'itay_pro', 'ofir777', 'danaaa', 'omer_big', 'NachuM', 'batsek', 'H_Heisey', 'Yoavguber',
  'Ron_cs', 'maya.k', 'eden_fan', 'kicker_1', 'amit770', 'bruvvv69', 'Exotic_Buttersz', 'Ryoukon', 'PlatyXD', 'nevo2911k',
];

export const USER_COLORS = ['#53fc18', '#ff6b6b', '#4dabf7', '#ffd43b', '#cc5de8', '#ff922b', '#20c997', '#f783ac', '#94d82d', '#74c0fc'];

export const EMOTES = ['KEKW', 'OMEGALUL', 'PogChamp', 'LUL', 'monkaS', 'Sadge', 'EZ', 'W', '🔥', '💀', '😭', '🤣', '👀', '🫡', 'GIGACHAD', 'Copium'];

export const LINES: Record<string, string[]> = {
  idle: ['יאללה תתחילו', 'מי מנצח לדעתכם?', 'אני על {p1}', '{p2} לוקח את זה בקלות', 'איזה זירה', 'W סטרים', 'כמה צופים יש', 'פרשנות?', 'גגגגג', '👀👀👀', 'first', 'סאבים בצ\'אט!!'],
  hit: ['אוףףף', 'KEKW', 'הרגיש את זה', 'ווווו', '💀', 'חחחחחחח', 'OMEGALUL', 'אחי', 'W', 'LUL'],
  bigHit: ['איזה מכה!!!', 'OMEGALUL', 'קליפ!!!', 'CLIP IT', '💀💀💀', 'הוא מת', 'ווואלה', 'PogChamp', 'אחי הפרצוף שלו חחח', 'ריספקט'],
  block: ['תחסום אחי', 'מחסום', 'הגנה של אלופים', 'EZ block', 'היי יש קיר'],
  combo: ['איזה קומבו!!!', 'COMBO', 'GIGACHAD', 'הוא בלופ', 'תן לו לשחק 😭', 'קליפ קליפ קליפ', '{n} מכות ברצף???', 'PogChamp PogChamp'],
  special: ['המהלך הזה 🔥', 'חחחחחחח המהלך', 'מה זה היה', 'LETS GOOO', 'W מהלך', 'אגדי'],
  hype: ['HYPE!!!!', '🔥🔥🔥🔥', 'הוא עשה את זה', 'POGGERS', 'צ\'אט תתכוננו', 'LETSGOOOOO'],
  lowHp: ['{low} על חוט', 'Copium', 'עוד מכה אחת...', 'monkaS', 'תחזיק מעמד!!', 'Sadge'],
  ko: ['GG', 'GGGGGG', 'נגמר', 'איזה הפסד', 'EZ', 'W {win}', 'L {lose}', 'קליפ!!!!', 'Sadge'],
  finish: ['תגמור אותו!!!', 'BANALITY BANALITY', 'עשה את הבנאליטי!!', '↓↓+U ↓↓+U', 'צ\'אט מה הוא יעשה', '👀👀👀👀'],
  banality: ['WHAT', 'OMEGALUL OMEGALUL', 'אני מת חחחחחחח', 'הכי טוב במשחק', 'קליפ של השנה', '💀💀💀💀💀'],
  perfect: ['FLAWLESS', 'בלי שריטה', 'GIGACHAD', 'אפילו לא נגע בו'],
  throw: ['הטלה!!', 'לקח אותו חחח', 'WWE'],
  counter: ['קאונטר!!!', 'READ', 'הוא ידע', 'GIGACHAD read'],
  jump: ['למה הוא קופץ', 'מקפץ כל הזמן חחח'],
  timeOver: ['נגמר הזמן?!', 'איזה משחק זה', 'טיימר מסוכן'],
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
