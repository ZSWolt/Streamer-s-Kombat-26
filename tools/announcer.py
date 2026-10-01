"""Generate the announcer lines with Microsoft neural TTS (edge-tts).

Usage:  python tools/announcer.py [--only name_philip,name_adam]   (no --only = regenerate everything)
Output: client/public/assets/audio/announcer/{he,en}/<key>.mp3
The in-game announcer adds reverb/compression at runtime.
"""
import asyncio
import os
import re
import sys

import edge_tts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'client', 'public', 'assets', 'audio', 'announcer')

LINES = {
    'title': ('סטרים קומבט עשרים ושש!', 'Stream Kombat twenty six!'),
    'select': ('בחר לוחם!', 'Choose your fighter!'),
    'round1': ('סיבוב ראשון', 'Round one'),
    'round2': ('סיבוב שני', 'Round two'),
    'round3': ('סיבוב שלישי', 'Round three'),
    'round4': ('סיבוב רביעי', 'Round four'),
    'round5': ('סיבוב חמישי', 'Round five'),
    'final': ('סיבוב אחרון!', 'Final round!'),
    'fight': ('להילחם!', 'Fight!'),
    'ko': ('נוקאאוט!', 'K. O.!'),
    'doubleko': ('נוקאאוט כפול!', 'Double K. O.!'),
    'finish_him': ('תגמור אותו!', 'Finish him!'),
    'finish_her': ('תגמור אותה!', 'Finish her!'),
    'flawless': ('ניצחון מושלם!', 'Flawless victory!'),
    'time': ('נגמר הזמן!', 'Time!'),
    'draw': ('תיקו!', 'Draw!'),
    'wins': ('מנצח!', 'wins!'),
    'banality': ('בנאליטי!', 'Banality!'),
    'hype': ('הייפ!', 'Hype!'),
    'combo': ('קומבו!', 'Combo!'),
    'raid': ('ריייייד!', 'Raid!'),
}

VOICES = {'he': 'he-IL-AvriNeural', 'en': 'en-US-GuyNeural'}


EN_SPOKEN = {
    'odedsvr': 'Oded S.V.R.', 'ronengg': 'Ronen G.G.', 'igz': 'I.G.Z.', 'liorslife': "Lior's Life", 'psyqr': 'Psy Q.R.',
    'sasivetheboiz': 'Sasi and the Boiz', 'devidtur': 'David Tur', 'pedrofederer': 'Pedro Federer', 'maorameleh': 'Maor', 'shilo': 'Shilo', 'philip': 'Philip', 'adam': 'Adam Drakes',
    'masterohad': 'Master Ohad', 'shotist': 'Shotist', 'inde': 'Inde',
}


# Hebrew names the voice would otherwise misread get vowel points here.
HE_SPOKEN = {'shotist': 'שׁוֹ', 'shilo': 'שִׁילֹה'}


def roster_names():
    src = open(os.path.join(ROOT, 'client', 'src', 'data', 'roster.ts'), encoding='utf8').read()
    out = {}
    for m in re.finditer(r"id: '([\w]+)', name: '([^']+)', he: '([^']+)'", src):
        out['name_' + m.group(1)] = (HE_SPOKEN.get(m.group(1), m.group(3)), EN_SPOKEN.get(m.group(1), m.group(2).title()))
    return out


async def render(key, text, lang):
    folder = os.path.join(OUT, lang)
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, key + '.mp3')
    shout = key in ('fight', 'ko', 'doubleko', 'finish_him', 'finish_her', 'banality', 'hype', 'raid', 'title', 'final')
    tts = edge_tts.Communicate(text, VOICES[lang], rate='-8%' if not shout else '-2%', pitch='-10Hz', volume='+20%')
    await tts.save(path)
    return path


async def main():
    lines = dict(LINES)
    lines.update(roster_names())
    if '--only' in sys.argv:
        keep = set(sys.argv[sys.argv.index('--only') + 1].split(','))
        lines = {k: v for k, v in lines.items() if k in keep}
    jobs = []
    for key, (he, en) in lines.items():
        jobs.append(render(key, he, 'he'))
        jobs.append(render(key, en, 'en'))
    done = 0
    for coro in asyncio.as_completed(jobs):
        try:
            await coro
            done += 1
        except Exception as e:  # keep going on single failures
            print('failed:', e, file=sys.stderr)
    print(f'{done} announcer files written to {OUT}')


if __name__ == '__main__':
    asyncio.run(main())
