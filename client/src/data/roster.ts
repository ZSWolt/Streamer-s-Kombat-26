import type { SpecialDef, SpecialSpec } from '../sim/types';

export type HairStyle =
  | 'wavy' | 'short' | 'curly' | 'bald' | 'curlyShort' | 'messy' | 'long' | 'quiff'
  | 'sidepart' | 'buzz' | 'longFemale' | 'mop';
export type Beard = 'none' | 'full' | 'trim' | 'stubble' | 'mustache' | 'scruff';

export interface Look {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  beard: Beard;
  beardColor?: string;
  headphones?: string;
  headphonesAccent?: string;
  earbuds?: boolean;
  glasses?: 'round' | 'rect' | 'sun';
  glassesColor?: string;
  cap?: { color: string; backwards: boolean };
  shirt: string;
  shirtText?: string;
  shirtText2?: string;
  hoodie?: boolean;
  jacket?: string; // suit jacket colour
  stripes?: string;
  print?: 'palm';
  pants: string;
  shoes: string;
  build: 'slim' | 'normal' | 'heavy' | 'burly';
  height: number; // 1 = default
  female?: boolean;
  crown?: boolean;
  chain?: boolean;
  dog?: boolean;
  eyes?: string;
}

export interface Fighter {
  id: string;
  name: string; // display (latin)
  he: string; // Hebrew name
  title: string; // THE ...
  titleHe: string;
  platform: 'kick' | 'youtube' | 'guest';
  channel: string;
  accent: string;
  stage: number;
  stats: [number, number, number, number]; // speed, power, defense, reach (1..5)
  look: Look;
  specials: [SpecialDef, SpecialDef, SpecialDef];
  hype: { name: string; en: string; vfx: string; spec?: Partial<SpecialSpec> };
  intro: string;
  win: string;
  female?: boolean;
  skins: { name: string; tint?: string; wheelchair?: boolean; secret?: string }[];
}

const sp = (input: SpecialDef['input'], name: string, en: string, anim: string, spec: SpecialSpec): SpecialDef => ({ input, name, en, anim, spec });

// Frequently used special templates
const shot = (o: Partial<SpecialSpec> & { vfx: string; damage: number }): SpecialSpec => ({
  kind: 'projectile', startup: 14, recovery: 26, speed: 75, hitstun: 22, level: 'mid', life: 120, size: [360, 360], ...o,
});
const rush = (o: Partial<SpecialSpec> & { vfx: string; damage: number }): SpecialSpec => ({
  kind: 'rush', startup: 9, active: 16, recovery: 22, speed: 100, hitstun: 24, level: 'mid', ...o,
});
const upper = (o: Partial<SpecialSpec> & { vfx: string; damage: number }): SpecialSpec => ({
  kind: 'uppercut', startup: 5, active: 10, recovery: 30, launch: [30, 165], invuln: [1, 9], level: 'mid', hitstun: 30, ...o,
});

// Every fighter has its normal look; three fighters also hide a secret version (see data/secrets.ts).
const defaultSkins = (_accent: string): Fighter['skins'] => [{ name: 'רגיל' }];
const secretSkin = (name: string, tint: string, secret: string): Fighter['skins'] => [{ name: 'רגיל' }, { name, tint, secret }];

export const ROSTER: Fighter[] = [
  {
    id: 'odedsvr', name: 'ODEDSVR', he: 'עודד', title: 'THE HOST', titleHe: 'המארח', platform: 'kick', channel: 'kick.com/odedsvr',
    accent: '#53fc18', stage: 0, stats: [3, 3, 3, 3],
    look: { skin: '#c89478', hair: '#1e1712', hairStyle: 'wavy', beard: 'full', headphones: '#131313', shirt: '#151515', shirtText: 'STAY AWESOME', pants: '#24242c', shoes: '#f0f0f0', build: 'normal', height: 1 },
    specials: [
      sp('U', 'קונקארדס', 'CONCARDS ATTACK', 'throw', shot({ vfx: 'concards', damage: 34, count: 3, spread: 22, speed: 84, size: [300, 380] })),
      sp('FU', 'בוסטר', 'BOOSTER', 'shoulder', rush({ vfx: 'booster', damage: 90, speed: 112, active: 14 })),
      sp('DU', 'בושות!', 'SHAME UPPER', 'uppercut', upper({ vfx: 'shame', damage: 100 })),
    ],
    hype: { name: 'Stay Awesome', en: 'STAY AWESOME', vfx: 'birthday' },
    intro: 'Stay awesome.', win: 'בושות! תודה רבה עודד.',
    skins: secretSkin('זהב', '#d4a531', 'gold-odedsvr'),
  },
  {
    id: 'ronengg', name: 'RONENGG', he: 'רונן', title: 'THE CHAMP', titleHe: 'האלוף', platform: 'kick', channel: 'kick.com/ronengg',
    accent: '#53fc18', stage: 3, stats: [3, 4, 5, 2],
    look: { skin: '#d2a07e', hair: '#1b1510', hairStyle: 'short', beard: 'trim', headphones: '#f4f4f4', shirt: '#f1f1f1', hoodie: true, pants: '#2a2a2e', shoes: '#ffffff', build: 'normal', height: 1.02 },
    specials: [
      sp('U', "ז'יטונים", 'GAMBLE ATTACK', 'throw', shot({ vfx: 'chips', damage: 21, randomDamage: [6, 36], count: 4, spread: 16, speed: 90, size: [240, 240] })),
      sp('FU', 'Keep Moving Forward', 'KEEP MOVING FORWARD', 'straight', rush({ vfx: 'armor', damage: 100, speed: 92, armor: 1, knockdown: true })),
      sp('DU', 'סאבטון', 'SUBATHON ATTACK', 'point', { kind: 'drop', startup: 20, recovery: 24, damage: 105, knockdown: true, size: [760, 560], vfx: 'subathon', hitstun: 30 }),
    ],
    hype: { name: '80K', en: '80K RUSH', vfx: 'rocky' },
    intro: "It's about how hard you can get hit.", win: 'פרשן הדרמות הכי טוב בעולם.',
    skins: secretSkin('זהב', '#d4a531', 'gold-ronengg'),
  },
  {
    id: 'inde', name: 'INDE', he: 'אינדה', title: 'THE LEGEND', titleHe: 'האגדה', platform: 'youtube', channel: 'youtube.com/@IdanInde',
    accent: '#ff2a2a', stage: 4, stats: [3, 4, 3, 4],
    look: { skin: '#c9936f', hair: '#191310', hairStyle: 'curly', beard: 'trim', headphones: '#141414', headphonesAccent: '#27a6ff', shirt: '#1f6fd1', shirtText: '25', pants: '#2d3f5a', shoes: '#f5f5f5', build: 'normal', height: 1.03 },
    specials: [
      sp('U', 'מוצרי אינדה', 'INDE ATTACK', 'throw', shot({ vfx: 'indegear', damage: 34, count: 3, spread: 20, speed: 82, size: [300, 300] })),
      sp('FU', '0 צופים', 'ZERO VIEWERS', 'teleport', { kind: 'teleport', startup: 16, recovery: 12, damage: 0, behind: true, vfx: 'teleport' }),
      sp('DU', 'שלישיית הנובים', 'NOOB TRIO', 'summon', { kind: 'summon', startup: 18, recovery: 30, damage: 90, speed: 62, size: [700, 1500], knockdown: true, life: 140, hitstun: 30, level: 'mid', vfx: 'noobs' }),
    ],
    hype: { name: 'מיליון מנויים', en: '1M SUBS', vfx: 'playbutton' },
    intro: 'אינדה גיים! מה קורה?', win: 'תירשמו לערוץ.',
    skins: secretSkin('ניאון', '#a347ff', 'neon-inde'),
  },
  {
    id: 'igz', name: 'IGZ', he: 'מיכאל', title: 'THE SENSEI', titleHe: 'הסנסיי', platform: 'kick', channel: 'kick.com/igz',
    accent: '#53fc18', stage: 1, stats: [4, 3, 3, 2],
    look: { skin: '#c38d68', hair: '#111', hairStyle: 'bald', beard: 'full', headphones: '#121212', cap: { color: '#f3f3f3', backwards: true }, shirt: '#f2f2f2', shirtText: 'SENSEI', pants: '#1c1c22', shoes: '#111', build: 'normal', height: 0.98 },
    specials: [
      sp('U', 'סנסיי', 'SENSEI CHOPS', 'chops', rush({ vfx: 'chops', damage: 24, hits: 4, speed: 26, active: 20, hitstun: 14 })),
      sp('FU', 'הצב', 'TURTLE SPIN', 'turtle', rush({ vfx: 'turtle', damage: 85, speed: 104, active: 18, invuln: [4, 20] })),
      sp('DU', 'יום 1 בלי דרמות', 'NO DRAMA PARRY', 'meditate', { kind: 'counter', startup: 2, active: 26, recovery: 16, damage: 80, hitstun: 26, vfx: 'meditate' }),
    ],
    hype: { name: 'גלגל המזל', en: 'WHEEL OF FORTUNE', vfx: 'wheel' },
    intro: 'יום 1 בלי דרמות.', win: 'סנסיי.',
    skins: defaultSkins('#53fc18'),
  },
  {
    id: 'liorslife', name: 'LIORSLIFE', he: 'ליאור', title: 'THE GOOD GUY', titleHe: 'הבחור הטוב', platform: 'kick', channel: 'kick.com/liorslife',
    accent: '#53fc18', stage: 1, stats: [3, 3, 4, 3],
    look: { skin: '#d6a585', hair: '#15110e', hairStyle: 'curlyShort', beard: 'stubble', headphones: '#f4f4f4', shirt: '#141414', pants: '#1f1f25', shoes: '#fff', build: 'slim', height: 1 },
    specials: [
      sp('U', 'Karma', 'KARMA', 'reflect', { kind: 'reflect', startup: 3, active: 30, recovery: 16, damage: 0, vfx: 'karma' }),
      sp('FU', 'גישה ראשון בארץ', 'EARLY ACCESS', 'dashpunch', rush({ vfx: 'earlyaccess', damage: 75, speed: 125, active: 12 })),
      sp('DU', 'דירוג סטרימרים', 'TIER LIST', 'slam', { kind: 'slam', startup: 20, active: 6, recovery: 22, damage: 100, level: 'overhead', speed: 50, hitstun: 26, knockdown: true, vfx: 'tierlist' }),
    ],
    hype: { name: 'בומרנג קארמה', en: 'KARMA BOOMERANG', vfx: 'karmaboom' },
    intro: 'אני בחור טוב.', win: 'What goes around, comes around.',
    skins: defaultSkins('#53fc18'),
  },
  {
    id: 'psyqr', name: 'PSYQR', he: 'עדן', title: 'THE MARATHON', titleHe: 'המרתון', platform: 'kick', channel: 'kick.com/psyqr',
    accent: '#53fc18', stage: 2, stats: [2, 5, 4, 2],
    look: { skin: '#c99474', hair: '#18120e', hairStyle: 'messy', beard: 'full', headphones: '#121212', shirt: '#c8222a', hoodie: true, pants: '#1c1c20', shoes: '#111', build: 'heavy', height: 1.02 },
    specials: [
      sp('U', 'Just Sleeping', 'JUST SLEEPING', 'yawn', shot({ vfx: 'zzz', damage: 40, speed: 30, life: 160, stun: 45, size: [420, 420] })),
      sp('FU', "ג'יטיאיתון", 'GTA-THON', 'summon', { kind: 'summon', startup: 16, recovery: 30, damage: 110, speed: 115, size: [1500, 1000], knockdown: true, life: 110, hitstun: 30, level: 'mid', vfx: 'car' }),
      sp('DU', 'קרה קרה', 'KARA KARA STOMP', 'stomp', shot({ vfx: 'shockwave', damage: 70, speed: 62, level: 'low', knockdown: true, size: [520, 300], life: 70 })),
    ],
    hype: { name: '5 כוכבים', en: 'FIVE STARS', vfx: 'police' },
    intro: "ג'יטיאיתון יום 3.", win: 'קרה קרה!',
    skins: defaultSkins('#53fc18'),
  },
  {
    id: 'maorameleh', name: 'MAOR SNACKS', he: 'מאור סנאקס', title: 'THE MACHINE', titleHe: 'המכונה', platform: 'kick', channel: 'kick.com/maorameleh',
    accent: '#53fc18', stage: 1, stats: [4, 3, 3, 3],
    look: { skin: '#f0cdb4', hair: '#3b2616', hairStyle: 'mop', beard: 'scruff', beardColor: '#4a3220', eyes: '#4f8fd0', headphones: '#141519', shirt: '#1b2836', print: 'palm', pants: '#22242a', shoes: '#1a1a1a', build: 'slim', height: 1.03 },
    specials: [
      sp('U', 'גיטרה אימוט', 'GUITAR EMOTE', 'guitar', rush({ vfx: 'guitar', damage: 100, speed: 38, active: 10, knockdown: true, startup: 13 })),
      sp('FU', 'פיצול אישיות', 'SPLIT PERSONALITY', 'clones', rush({ vfx: 'clones', damage: 40, hits: 3, speed: 86, active: 18 })),
      sp('DU', 'סנאקס', 'SNACKS BOMB', 'lob', shot({ vfx: 'snacks', damage: 85, speed: 48, vy: 95, gravity: 6, knockdown: true, size: [380, 380] })),
    ],
    hype: { name: 'מאור הנחמד', en: 'MAOR THE NICE', vfx: 'nice', spec: { heal: 120 } },
    intro: 'מאור הנחמד, פרק 8.', win: 'המכונה סנאקס.',
    skins: defaultSkins('#53fc18'),
  },
  {
    id: 'masterohad', name: 'MASTEROHAD', he: 'אוהד', title: 'THE MENTALIST', titleHe: 'המנטליסט', platform: 'kick', channel: 'kick.com/masterohad',
    accent: '#a347ff', stage: 5, stats: [4, 2, 3, 4],
    look: { skin: '#d2a17f', hair: '#1a1410', hairStyle: 'quiff', beard: 'trim', headphones: '#121212', shirt: '#f5f5f5', jacket: '#121216', pants: '#121216', shoes: '#0d0d0d', build: 'normal', height: 1 },
    specials: [
      sp('U', 'המנטליסט', 'HYPNOSIS', 'hypno', shot({ vfx: 'hypno', damage: 30, speed: 52, status: 'reversed', statusFrames: 180, size: [480, 480] })),
      sp('FU', 'אין על קיק', 'KICK DASH', 'dashpunch', rush({ vfx: 'kickdash', damage: 80, speed: 132, active: 12 })),
      sp('DU', 'Next!', 'NEXT!', 'swap', { kind: 'swap', startup: 16, recovery: 10, damage: 0, vfx: 'swap' }),
    ],
    hype: { name: 'עידן חדש', en: 'A NEW ERA', vfx: 'devil' },
    intro: 'אני הוא המנטליסט.', win: 'אין על קיק.',
    skins: defaultSkins('#a347ff'),
  },
  {
    id: 'pedrofederer', name: 'PEDROFEDERER', he: 'ניקי', title: 'THE COLLECTOR', titleHe: 'האספן', platform: 'kick', channel: 'kick.com/pedrofederer',
    accent: '#53fc18', stage: 0, stats: [3, 3, 2, 5],
    look: { skin: '#e0b394', hair: '#5a3b24', hairStyle: 'sidepart', beard: 'full', beardColor: '#4a3020', glasses: 'round', glassesColor: '#c9a45a', earbuds: true, shirt: '#121212', shirtText: '✓', pants: '#1d1d22', shoes: '#fff', build: 'normal', height: 1, chain: true },
    specials: [
      sp('U', 'קלף זהב', 'GOLD CARDS', 'throw', shot({ vfx: 'cards', damage: 30, count: 3, spread: 18, speed: 86, size: [260, 260] })),
      sp('FU', 'איזה צליפה!', 'WHAT A SNIPE', 'snipe', shot({ vfx: 'snipe', damage: 70, speed: 165, startup: 18, size: [300, 200] })),
      sp('DU', 'EARTHQUACKERR', 'EARTHQUACKERR', 'stomp', { kind: 'trap', startup: 18, recovery: 26, damage: 80, level: 'low', knockdown: true, range: 0, size: [1900, 400], life: 14, vfx: 'quake' }),
    ],
    hype: { name: 'הקלף הכי נדיר בעולם', en: 'RAREST CARD', vfx: 'legendary' },
    intro: 'יאווווו.', win: 'ניקי מוציא זהב!',
    skins: defaultSkins('#53fc18'),
  },
  {
    id: 'k0nkamc', name: 'K0NKAMC', he: 'מאור כהן', title: 'THE BEAST', titleHe: 'החיה', platform: 'kick', channel: 'kick.com/k0nkamc',
    accent: '#8c3bff', stage: 5, stats: [2, 5, 5, 2],
    look: { skin: '#c8906a', hair: '#141010', hairStyle: 'buzz', beard: 'full', headphones: '#b3121a', headphonesAccent: '#111', shirt: '#121212', pants: '#1e1e24', shoes: '#111', build: 'burly', height: 1.04, dog: true },
    specials: [
      sp('U', 'הכלב', 'THE DOG', 'point', { kind: 'summon', startup: 14, recovery: 28, damage: 80, speed: 96, size: [950, 700], knockdown: true, life: 110, hitstun: 28, level: 'mid', vfx: 'dog' }),
      sp('FU', 'חוזר לכושר', 'BACK IN SHAPE', 'lariat', rush({ vfx: 'dumbbell', damage: 110, speed: 72, armor: 1, knockdown: true, startup: 12 })),
      sp('DU', 'גב לקיר', 'BACK TO THE WALL', 'grab', { kind: 'grab', startup: 8, active: 4, recovery: 32, damage: 150, range: 880, knockdown: true, vfx: 'wallslam' }),
    ],
    hype: { name: 'דלי לבה', en: 'LAVA BUCKET', vfx: 'lava' },
    intro: 'חוזר לכושר.', win: 'גב לקיר.',
    skins: defaultSkins('#8c3bff'),
  },
  {
    id: 'devidtur', name: 'DEVIDTUR', he: 'דויד', title: 'THE NPC', titleHe: 'ה-NPC', platform: 'kick', channel: 'kick.com/devidtur',
    accent: '#53fc18', stage: 5, stats: [4, 2, 3, 3],
    look: { skin: '#f0c8ac', hair: '#d9c27a', hairStyle: 'short', beard: 'none', headphones: '#222', shirt: '#111', shirtText: 'NPC', pants: '#2a2a30', shoes: '#fff', build: 'slim', height: 0.99 },
    specials: [
      sp('U', 'NPC Mode', 'NPC MODE', 'glitch', rush({ vfx: 'glitch', damage: 30, hits: 3, speed: 60, active: 16 })),
      sp('FU', 'קיקר', 'KICKER', 'kickball', shot({ vfx: 'football', damage: 75, speed: 115, size: [320, 320] })),
      sp('DU', 'מחשב חדש', 'NEW PC', 'point', { kind: 'drop', startup: 20, recovery: 24, damage: 100, knockdown: true, size: [520, 700], vfx: 'pctower', hitstun: 30 }),
    ],
    hype: { name: 'Speedrun', en: 'SPEEDRUN', vfx: 'speedrun' },
    intro: 'לייב של הקיקרים.', win: 'קוקו מאן.',
    skins: defaultSkins('#53fc18'),
  },
  {
    id: 'sasivetheboiz', name: 'SASIVETHEBOIZ', he: 'ששי', title: 'THE BOIZ', titleHe: 'הבויז', platform: 'kick', channel: 'kick.com/sasivetheboiz',
    accent: '#53fc18', stage: 1, stats: [5, 2, 2, 3],
    look: { skin: '#d9a887', hair: '#171210', hairStyle: 'messy', beard: 'mustache', headphones: '#141414', shirt: '#5b4a6e', shirtText: 'SASI', shirtText2: 'THE BOIZ', pants: '#26262c', shoes: '#fff', build: 'slim', height: 0.99 },
    specials: [
      sp('U', 'אוגה בוגה', 'OOGA BOOGA', 'club', rush({ vfx: 'club', damage: 100, speed: 34, active: 10, knockdown: true, startup: 13 })),
      sp('FU', 'ששי מטייל', 'SASI TRAVELS', 'roll', rush({ vfx: 'backpack', damage: 70, speed: 122, active: 16, invuln: [3, 12] })),
      sp('DU', 'מבשלים עם שניר', 'COOKING WITH SNIR', 'lob', shot({ vfx: 'cake', damage: 60, speed: 55, vy: 72, gravity: 5, stun: 35, size: [380, 320] })),
    ],
    hype: { name: 'The Boiz', en: 'THE BOIZ', vfx: 'boiz' },
    intro: 'אוגה בוגהההה!', win: 'חזרנו למקורות!',
    skins: defaultSkins('#53fc18'),
  },
  {
    id: 'shotist', name: 'SHOTIST', he: 'בועז', title: 'THE GINGER', titleHe: "הג'ינג'י", platform: 'kick', channel: 'kick.com/shotist',
    accent: '#ff7a2f', stage: 1, stats: [3, 3, 3, 3],
    look: { skin: '#f2c7a8', hair: '#b0532a', hairStyle: 'curly', beard: 'full', beardColor: '#a8522b', glasses: 'rect', glassesColor: '#1c1c1c', shirt: '#e08f8f', stripes: '#f7f1ea', pants: '#2b2b33', shoes: '#fff', build: 'heavy', height: 1 },
    specials: [
      sp('U', 'קוביות', 'DICE ROLL', 'throw', shot({ vfx: 'dice', damage: 60, randomDamage: [20, 120], speed: 70, size: [300, 300] })),
      sp('FU', 'VTuber', 'VTUBER DASH', 'dashpunch', rush({ vfx: 'vtuber', damage: 80, speed: 112, active: 14 })),
      sp('DU', 'זיוואיייי!', 'ZVAIII!', 'scream', shot({ vfx: 'scream', damage: 60, speed: 48, life: 34, stun: 32, size: [700, 1300] })),
    ],
    hype: { name: 'Carry', en: 'CARRY', vfx: 'pickaxe' },
    intro: 'אני הסטרימר הכי טוב בארץ.', win: 'זיוואייייי!',
    skins: [{ name: 'רגיל' }, { name: 'כיסא גלגלים', wheelchair: true }],
  },
  {
    id: 'nave', name: 'NAVE', he: 'נווה', title: 'THE CHALLENGER', titleHe: 'המאתגר', platform: 'youtube', channel: 'youtube.com/@thesaltiz',
    accent: '#ff2a2a', stage: 2, stats: [4, 3, 2, 3],
    look: { skin: '#d7a482', hair: '#16110d', hairStyle: 'short', beard: 'none', shirt: '#d42525', shirtText: 'SALTIZ', pants: '#1f2a3a', shoes: '#fff', build: 'slim', height: 0.98 },
    specials: [
      sp('U', 'שוקולד סולטיז', 'SALTIZ CHOCOLATE', 'throw', shot({ vfx: 'chocolate', damage: 40, count: 2, spread: 10, speed: 82, size: [320, 200] })),
      sp('FU', 'האחרון שיוצא', 'LAST ONE OUT', 'slide', rush({ vfx: 'slide', damage: 70, speed: 112, level: 'low', knockdown: true, active: 18 })),
      sp('DU', '10,000 ₪', '10,000 SHEKEL', 'point', { kind: 'trap', startup: 16, recovery: 22, damage: 60, stun: 45, range: 1500, size: [700, 500], life: 240, vfx: 'money' }),
    ],
    hype: { name: 'מיליון שוקולדים', en: 'A MILLION CHOCOLATES', vfx: 'truck' },
    intro: 'האחרון שנשאר זוכה ב-10,000 שקל!', win: 'תירשמו לסולטיז!',
    skins: defaultSkins('#ff2a2a'),
  },
  {
    id: 'shoval', name: 'SHOVAL', he: 'שובל', title: 'THE SHOWMAN', titleHe: 'השואומן', platform: 'youtube', channel: 'youtube.com/@thesaltiz',
    accent: '#ff2a2a', stage: 4, stats: [3, 3, 3, 4],
    look: { skin: '#e6b797', hair: '#8a5a36', hairStyle: 'short', beard: 'none', shirt: '#f5f5f5', jacket: '#141418', pants: '#141418', shoes: '#0e0e0e', build: 'normal', height: 1.02 },
    specials: [
      sp('U', 'פופקורן', 'POPCORN', 'throw', shot({ vfx: 'popcorn', damage: 30, count: 3, spread: 22, speed: 70, size: [260, 260] })),
      sp('FU', 'סול סטארס', 'SOL STARS', 'dashpunch', rush({ vfx: 'spotlight', damage: 90, speed: 84, active: 16 })),
      sp('DU', 'מחבואים', 'HIDE & SEEK', 'teleport', { kind: 'teleport', startup: 18, recovery: 10, damage: 0, behind: true, vfx: 'hide' }),
    ],
    hype: { name: 'הבכורה', en: 'THE PREMIERE', vfx: 'redcarpet' },
    intro: 'סולטיז הסרט, עכשיו בקולנוע!', win: 'גבירותיי ורבותיי!',
    skins: defaultSkins('#ff2a2a'),
  },
  {
    id: 'paz', name: 'PAZ', he: 'פז', title: 'THE SURVIVOR', titleHe: 'השורד', platform: 'youtube', channel: 'youtube.com/@thesaltiz',
    accent: '#ff2a2a', stage: 2, stats: [3, 3, 4, 3],
    look: { skin: '#eab897', hair: '#9c4a24', hairStyle: 'short', beard: 'trim', beardColor: '#9c4a24', shirt: '#2f8f5b', pants: '#243042', shoes: '#fff', build: 'slim', height: 1.05 },
    specials: [
      sp('U', 'הקוטב הצפוני', 'NORTH POLE', 'throw', shot({ vfx: 'snowball', damage: 55, speed: 76, status: 'slow', statusFrames: 120, size: [320, 320] })),
      sp('FU', '100 שעות בשלג', '100 HOURS IN SNOW', 'slide', rush({ vfx: 'iceslide', damage: 70, speed: 118, level: 'low', active: 16 })),
      sp('DU', 'בית חולים נטוש', 'HAUNTED HOSPITAL', 'point', shot({ vfx: 'ghost', damage: 30, speed: 44, stun: 70, size: [520, 900], life: 140 })),
    ],
    hype: { name: 'סופת שלגים', en: 'BLIZZARD', vfx: 'blizzard' },
    intro: 'שרדנו את הקוטב הצפוני.', win: 'עוד 100 שעות? קטן עליי.',
    skins: defaultSkins('#ff2a2a'),
  },
  {
    id: 'ori', name: 'ORI', he: 'אורי', title: 'THE QUEEN', titleHe: 'המלכה', platform: 'youtube', channel: 'youtube.com/@thesaltiz', female: true,
    accent: '#ff2a2a', stage: 4, stats: [5, 2, 3, 3],
    look: { skin: '#e8bb9c', hair: '#b99569', hairStyle: 'longFemale', beard: 'none', shirt: '#f06aa8', pants: '#f3f0f5', shoes: '#fff', build: 'slim', height: 0.94, female: true },
    specials: [
      sp('U', 'מילקשייק', 'MILKSHAKE', 'lob', shot({ vfx: 'milkshake', damage: 50, speed: 60, vy: 62, gravity: 5, knockdown: true, size: [300, 360] })),
      sp('FU', 'הבריכה המסתורית', 'MYSTERY POOL KICK', 'scissor', { kind: 'slam', startup: 14, active: 8, recovery: 20, damage: 85, level: 'overhead', speed: 70, hitstun: 26, vfx: 'scissor' }),
      sp('DU', 'תענה על השאלה', 'ANSWER THE QUESTION', 'point', { kind: 'drop', startup: 22, recovery: 22, damage: 110, chance: 65, knockdown: true, size: [600, 600], vfx: 'quiz', hitstun: 30 }),
    ],
    hype: { name: '10,000 ₪', en: 'PINK MONEY RAIN', vfx: 'pinkmoney' },
    intro: 'תענה על השאלה או שתיפול!', win: 'המלכה של סולטיז.',
    skins: defaultSkins('#ff2a2a'),
  },
  {
    id: 'philip', name: 'PHILIP', he: 'פיליפ', title: 'THE BRAWLER', titleHe: 'הבריון', platform: 'guest', channel: '',
    accent: '#e8b646', stage: 5, stats: [2, 5, 4, 3],
    look: { skin: '#6a4630', hair: '#c9a04a', hairStyle: 'long', beard: 'trim', beardColor: '#2a2018', shirt: '#cdb38a', jacket: '#3a2418', pants: '#1e1b1a', shoes: '#4a2f1c', build: 'burly', height: 1.05 },
    specials: [
      sp('U', 'אגרוף פטיש', 'HAMMER FIST', 'dashpunch', rush({ vfx: 'hammer', damage: 95, speed: 96, active: 14, armor: 1, knockdown: true })),
      sp('FU', 'חיבוק דוב', 'BEAR HUG', 'grab', { kind: 'grab', startup: 9, active: 4, recovery: 32, damage: 140, range: 860, knockdown: true, vfx: 'bearhug' }),
      sp('DU', 'הלם קרקע', 'GROUND POUND', 'stomp', shot({ vfx: 'shockwave', damage: 75, speed: 60, level: 'low', knockdown: true, size: [520, 300], life: 70 })),
    ],
    hype: { name: 'זעם', en: 'RAMPAGE', vfx: 'rampage' },
    intro: 'בוא נראה מה יש לך.', win: 'אמרתי לך לא להתחיל איתי.',
    skins: defaultSkins('#e8b646'),
  },
  {
    id: 'adam', name: 'ADAM DRAKES', he: 'אדם', title: 'THE OUTLAW', titleHe: 'הפורע', platform: 'guest', channel: '',
    accent: '#e8b646', stage: 2, stats: [4, 3, 3, 4],
    look: { skin: '#c99670', hair: '#2a1d14', hairStyle: 'quiff', beard: 'mustache', shirt: '#b7a27a', jacket: '#3b2518', pants: '#17181c', shoes: '#4a2e1b', build: 'normal', height: 1.03 },
    specials: [
      sp('U', 'בקבוק', 'BOTTLE TOSS', 'lob', shot({ vfx: 'bottle', damage: 80, speed: 56, vy: 80, gravity: 6, knockdown: true, size: [300, 360] })),
      sp('FU', 'בעיטת מגף', 'BOOT KICK', 'kickball', rush({ vfx: 'boot', damage: 85, speed: 118, active: 12 })),
      sp('DU', 'דו-קרב', 'DUEL', 'counter', { kind: 'counter', startup: 3, active: 32, recovery: 20, damage: 105, hitstun: 30, knockdown: true, vfx: 'duel' }),
    ],
    hype: { name: 'צהרי היום', en: 'HIGH NOON', vfx: 'highnoon' },
    intro: 'העיר הזאת קטנה מדי לשנינו.', win: 'ככה סוגרים חשבון.',
    skins: defaultSkins('#e8b646'),
  },
];

export const RANDOM_SLOT = ROSTER.length; // index used by the char select "?" card
export const BOSS_ID = 'inde';

export function fighterIndex(id: string): number {
  return ROSTER.findIndex((f) => f.id === id);
}
