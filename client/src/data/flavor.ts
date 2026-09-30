// Per-fighter flavour: move shouts, the two finishers (BANALITY), pre-fight banter and VS-screen quotes.

export interface Banality {
  name: string; // Hebrew
  en: string;
  key: string; // cinematic script id (render/cinematics.ts)
  stamp: string; // big stamp word on the result card
  line: string; // winner's line
}

export interface Flavor {
  shouts: [string, string, string];
  banalities: [Banality, Banality];
  intro: string[]; // first line when they open the pre-fight banter
  reply: string[]; // line when answering
  quote: string; // VS screen «quote»
}

const B = (name: string, en: string, key: string, stamp: string, line: string): Banality => ({ name, en, key, stamp, line });

export const FLAVOR: Record<string, Flavor> = {
  odedsvr: {
    shouts: ['מחסני חשמל!', 'בוסטר!', 'בושות!'],
    banalities: [B('המסך שלי', 'MY SCREEN', 'monitor', 'OFFLINE', 'Stay awesome.'), B('קצר חשמלי', 'SHORT CIRCUIT', 'shock', 'מנותק', 'החשמל במחסני חשמל עדיין חשמל.')],
    intro: ['Stay awesome, אחי.', 'יאללה, עולים ללייב.'], reply: ['בושות.', 'איזה ביזוי.'],
    quote: 'מי רוצה לבוא ליום הולדת שלי?',
  },
  ronengg: {
    shouts: ["רייג' בייט!", 'Keep moving forward!', 'דרמה!'],
    banalities: [B('BREAKING NEWS', 'BREAKING NEWS', 'breaking', 'דרמה', 'פרשן הדרמות הכי טוב בעולם.'), B("עגבניות מהצ'אט", 'CHAT TOMATOES', 'tomatoes', 'בוז', "ברו נפל לרייג' בייט.")],
    intro: ["It's not about how hard you hit.", '80 אלף עוקבים לא טועים.'], reply: ["ברו נפל לרייג' בייט.", 'סיקור דרמות אחרי זה.'],
    quote: 'הגענו ל-80 אלף עוקבים!',
  },
  inde: {
    shouts: ['אוזניות אינדה!', 'הפתעה!', 'נובים, קדימה!'],
    banalities: [B('10 שנים אחרי', '10 YEARS LATER', 'kid', 'ילד', 'תירשמו לערוץ.'), B('כפתור הפליי', 'PLAY BUTTON', 'plaque', 'מיליון', 'מיליון מנויים. אתה לא אחד מהם.')],
    intro: ['אינדה גיים! מה קורה?', 'עשר שנים ביוטיוב. בוא.'], reply: ['איך זה להיות יוטיובר? ככה.', 'תירשמו לערוץ.'],
    quote: 'מי שאוכל יותר בננות — מנצח!',
  },
  igz: {
    shouts: ['סנסיי!', 'הצב!', 'בלי דרמות.'],
    banalities: [B('לייב 24 שעות', '24H STREAM', 'sleep24', 'נרדם', 'יום 1 בלי דרמות.'), B('הצב', 'THE TURTLE', 'turtle', 'צב', 'סנסיי אמר.')],
    intro: ['יום 1 בלי דרמות.', 'היום עושים כיף.'], reply: ['היום נחצו גבולות.', 'סנסיי.'],
    quote: 'היום עושים כיף.',
  },
  liorslife: {
    shouts: ['Karma!', 'גישה ראשון בארץ!', 'דירוג!'],
    banalities: [B('אנבאן רקווסט', 'UNBAN DENIED', 'denied', 'DENIED', 'What goes around, comes around.'), B('ברק קארמה', 'KARMA STRIKE', 'karma', 'קארמה', 'אני בחור טוב.')],
    intro: ['אני בחור טוב. תגיעו.'], reply: ['What goes around, comes around.', 'כניסה לאיכותיים בלבד.'],
    quote: 'כניסה לאיכותיים בלבד!',
  },
  psyqr: {
    shouts: ['Just Sleeping…', "ג'יטיאיתון!", 'קרה קרה!'],
    banalities: [B('MISSION PASSED', 'MISSION PASSED', 'mission', 'RESPECT +', 'לא סוגר את הלייב עד שאני מסיים.'), B('WASTED', 'WASTED', 'wasted', 'WASTED', 'קרה קרה.')],
    intro: ["ג'יטיאיתון יום 3. אלוקים יעזור לי."], reply: ['קרה קרה!', 'הלכנו להסתפר ביחד.'],
    quote: 'לא סוגר את הלייב עד שאני מסיים את המשחק.',
  },
  maorameleh: {
    shouts: ['גיטרה אימוט!', 'פיצול אישיות!', 'סנאקס!'],
    banalities: [B('המכונה סנאקס', 'THE SNACK MACHINE', 'vending', 'אזל מהמלאי', 'המכונה סנאקס.'), B('פיצול אישיות', 'SPLIT PERSONALITY', 'clones', 'x3', 'מאור הנחמד לא בבית היום.')],
    intro: ['מאור הנחמד, פרק 8.', 'עושים פה כיף.'], reply: ['אתמול לא הייתי נחמד. סליחה.', 'סנאקס.'],
    quote: 'מאור הנחמד — פרק 8.',
  },
  masterohad: {
    shouts: ['תסתכל לי בעיניים…', 'אין על קיק!', 'Next!'],
    banalities: [B('THE STREAM IS ENDING', 'THE STREAM IS ENDING', 'ending', 'ENDED', 'אין על קיק.'), B('היפנוזה', 'HYPNOSIS', 'hypno', 'מהופנט', 'אני הוא המנטליסט. באמת.')],
    intro: ['אני הוא המנטליסט (באמת).', 'עידן חדש מתחיל.'], reply: ['ידעתי שתגיד את זה.', 'אין על קיק.'],
    quote: 'מי הגיימר היותר טוב? אין מצב שאני מפסיד.',
  },
  pedrofederer: {
    shouts: ['קלף זהב!', 'איזה צליפה!', 'EARTHQUACKERR!'],
    banalities: [B('GRADED 10', 'GRADED 10', 'graded', 'PSA 10', 'ניקי מוציא זהב!'), B('רעידת אדמה', 'EARTHQUACKERR', 'quakepit', 'נבלע', 'יאווווו.')],
    intro: ['יאווווו, בוסטר חדש.'], reply: ['קיבלתי קלף הכי נדיר בעולם.', 'איזה צליפה.'],
    quote: 'קיבלתי קלף הכי נדיר בעולם.',
  },
  k0nkamc: {
    shouts: ['הכלב!', 'חוזר לכושר!', 'גב לקיר!'],
    banalities: [B('הולך אל מותו', 'INTO THE LAVA', 'lavapit', 'לבה', 'חוזר לכושר.'), B('הכלב', 'THE DOG', 'dog', 'נגרר', 'הכלב לא נושך. בדרך כלל.')],
    intro: ['חוזר לכושר. היום.'], reply: ['גב לקיר, אחי.', 'לייב של השמחות.'],
    quote: 'לייב מוקדם היום — חוזר לכושר!',
  },
  devidtur: {
    shouts: ['NPC MODE', 'קיקר!', 'מחשב חדש!'],
    banalities: [B('Unboxing', 'UNBOXING', 'unboxing', 'FRAGILE', 'קוקו מאן.'), B('דיספאון', 'DESPAWN', 'despawn', 'ERROR 404', 'הקיקרים לא מפסידים.')],
    intro: ['לייב של הקיקרים!'], reply: ['אני לא נושם.', 'קוקו מאן.'],
    quote: 'יש מחשב חדש — עכשיו אנחנו קיקר פרו מקס.',
  },
  sasivetheboiz: {
    shouts: ['אוגה בוגה!', 'ששי מטייל!', 'מבשלים!'],
    banalities: [B('שורפים את הבית של שניר', "BURNING SNIR'S HOUSE", 'oven', 'שרוף', 'חזרנו למקורות!'), B('אוגה בוגה', 'OOGA BOOGA', 'bonk', 'בונק', 'אוגה בוגההההה!')],
    intro: ['אוגה בוגהההה!'], reply: ['נחשו מי חזר, חזר שוב.', 'חזרנו למקורות.'],
    quote: 'הבטחתי חרישה — הנה חרישה!',
  },
  shotist: {
    shouts: ['גלגל קוביות!', 'VTuber!', 'זיוואייייי!'],
    banalities: [B('UWU', 'UWU', 'uwu', 'UWU', 'אני הסטרימר הכי טוב בארץ.'), B('הקובייה', 'THE DICE', 'dice', '6', 'חייב לתת קצת קארי.')],
    intro: ['אני הסטרימר הכי טוב בארץ.'], reply: ['זיוואייייי!', 'חייב לתת קצת Carry.'],
    quote: 'חייב לתת קצת Carry.',
  },
  nave: {
    shouts: ['שוקולד סולטיז!', 'האחרון שיוצא!', '10,000 ₪!'],
    banalities: [B('חפש את המטמון', 'TREASURE HUNT', 'treasure', 'נקבר', 'תירשמו לסולטיז!'), B('מיליון שוקולדים', 'A MILLION CHOCOLATES', 'chocolate', 'מתוק', 'האחרון שנשאר — זוכה.')],
    intro: ['האחרון שנשאר זוכה ב-10,000 שקל!'], reply: ['חילקנו מיליון שוקולדים. גם לך.', 'תצליח לזהות אותי?'],
    quote: 'האחרון שיוצא מהלמבורגיני זוכה ב-10,000 שקל!',
  },
  shoval: {
    shouts: ['פופקורן!', 'סול סטארס!', 'מחבואים!'],
    banalities: [B('THE END', 'THE END', 'credits', 'THE END', 'גבירותיי ורבותיי!'), B('הבכורה', 'THE PREMIERE', 'popcorn', 'SOLD OUT', 'סולטיז הסרט — עכשיו בקולנוע.')],
    intro: ['גבירותיי ורבותיי!'], reply: ['תקנו כרטיסים לסרט.', 'בנינו קולנוע בבית.'],
    quote: 'בנינו בית קולנוע בבית שלנו!',
  },
  paz: {
    shouts: ['הקוטב הצפוני!', '100 שעות בשלג!', 'בית חולים נטוש!'],
    banalities: [B('קפוא', 'FROZEN', 'frozen', 'קפוא', 'שרדנו את הקוטב הצפוני.'), B('פינגווינים', 'PENGUINS', 'penguins', 'נגרר', 'עוד 100 שעות? קטן עליי.')],
    intro: ['שרדנו את הקוטב הצפוני. אותך נשרוד.'], reply: ['100 שעות בשלג — קטן עליי.'],
    quote: 'שורדים 24 שעות במקומות הכי קיצוניים בעולם!',
  },
  ori: {
    shouts: ['מילקשייק!', 'הבריכה המסתורית!', 'תענה על השאלה!'],
    banalities: [B('תיפול לבריכה', 'FALL IN THE POOL', 'pool', 'רטוב', 'המלכה של סולטיז.'), B('מילקשייק ענק', 'GIANT MILKSHAKE', 'milkshake', 'דביק', 'תענה על השאלה — או שתיפול.')],
    intro: ['תענה על השאלה או שתיפול לבריכה!'], reply: ['תשובה לא נכונה.', 'המלכה של סולטיז.'],
    quote: 'תענה על השאלה או שתיפול לבריכה מסתורית!',
  },
};

/** Pair-specific pre-fight exchanges (either order). */
export const PAIR_BANTER: [string, string, string, string][] = [
  ['odedsvr', 'ronengg', 'היום מנצחים את רונן גיגי.', 'בפיפא אולי. פה — לא.'],
  ['nave', 'inde', 'תצליח לזהות אותי?', 'אני הייתי פה לפני עשר שנים.'],
  ['masterohad', 'shoval', 'מי הגיימר היותר טוב? אין מצב שאני מפסיד.', 'תבחר קלף. כל קלף.'],
  ['masterohad', 'nave', 'אני ואתה, סולטיז. עכשיו.', 'האחרון שנשאר עומד — זוכה.'],
  ['psyqr', 'devidtur', 'אני ואוהד נגד עודד ודויד. מי מנצח?', 'הקיקרים לא מפסידים.'],
  ['pedrofederer', 'maorameleh', 'עלק קבל מאור.', 'סנאקס תמיד מקבל.'],
  ['liorslife', 'ronengg', 'רונן גיגי המשיח.', 'תגיד את זה אחרי הקרב.'],
  ['igz', 'odedsvr', 'מה עודד עשה בצבא?', 'בושות, מיכאל.'],
  ['paz', 'ori', 'שרדנו יחד את הקוטב.', 'והבריכה? אותה לא שרדת.'],
  ['sasivetheboiz', 'k0nkamc', 'אוגה בוגה?', 'גב לקיר.'],
  ['shotist', 'k0nkamc', 'זיוואייייי!', 'הכלב שלי מפחד ממך. אני לא.'],
  ['shoval', 'paz', 'גבירותיי ורבותיי — פז!', 'אני פה בשביל ה-10,000.'],
];

export function banterFor(a: string, b: string): [string, string] {
  for (const [x, y, lx, ly] of PAIR_BANTER) {
    if (x === a && y === b) return [lx, ly];
    if (x === b && y === a) return [ly, lx];
  }
  const fa = FLAVOR[a], fb = FLAVOR[b];
  const pick = (l: string[]) => l[Math.floor(Math.random() * l.length)];
  return [pick(fa?.intro ?? ['יאללה.']), pick(fb?.reply ?? ['נראה אותך.'])];
}
