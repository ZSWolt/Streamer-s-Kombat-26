"""Annotate the renders of reference_pose.py into one sheet: the pose and the part split new models should have.

  python tools/models/reference_sheet.py <render_dir> <out.png>
"""
import json
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont, features

src, out = sys.argv[1], sys.argv[2]
L = json.load(open(os.path.join(src, 'labels.json'), encoding='utf8'))
RAQM = features.check('raqm')
FONT = 'C:/Windows/Fonts/arialbd.ttf'
FONT_R = 'C:/Windows/Fonts/arial.ttf'


def he(s):
    """Visual order for a right-to-left line when the text engine cannot do it: reverse, keep numbers/Latin as they are."""
    if RAQM:
        return s
    runs = re.findall(r'[A-Za-z0-9°%+.\-/]+|[^A-Za-z0-9°%+.\-/]+', s)
    flip = {'(': ')', ')': '(', '[': ']', ']': '['}
    return ''.join(r if re.match(r'[A-Za-z0-9°%+.\-/]+$', r) else ''.join(flip.get(c, c) for c in r[::-1]) for r in runs[::-1])


def font(size, bold=True):
    return ImageFont.truetype(FONT if bold else FONT_R, size)


W, H = 3080, 1900
BG, INK, MUTED = (238, 240, 245), (22, 24, 32), (92, 98, 112)
sheet = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(sheet)

# ---- header
d.rectangle([0, 0, W, 130], fill=(22, 24, 32))
d.text((W - 50, 65), he('איך המודל צריך להיראות — תנוחת A, 15 חלקים'), font=font(64), fill=(255, 214, 102), anchor='rm')
d.text((50, 65), 'STREAM KOMBAT 26 · MODEL REFERENCE', font=font(40), fill=(200, 205, 220), anchor='lm')

# ---- the three views
TOP = 170
views = {}
x = 330
for name, title in (('front', 'מלפנים'), ('side', 'מהצד'), ('quarter', 'שלושה רבעים')):
    im = Image.open(os.path.join(src, f'ref_{name}.png')).convert('RGB')
    if name == 'quarter':
        im = im.crop((40, 0, 860, im.height))
    sheet.paste(im, (x, TOP))
    views[name] = (x, TOP, im.width)
    d.text((x + im.width // 2, TOP + im.height + 34), he(title), font=font(44), fill=INK, anchor='mm')
    x += im.width + (330 if name == 'front' else 60)

# ---- part labels on the front view (the figure's right side is on the left of the picture)
NAMES = {
    'head': ('1', 'ראש + צוואר', 'HEAD (hair, beard, headphones)'),
    'torso': ('2', 'חזה, בטן וכתפיים', 'TORSO'),
    'pelvis': ('3', 'אגן', 'PELVIS'),
    'upper arm': ('4', 'זרוע', 'UPPER ARM'),
    'forearm': ('5', 'אמה', 'FOREARM'),
    'hand': ('6', 'כף יד (אגרוף)', 'HAND'),
    'thigh': ('7', 'ירך', 'THIGH'),
    'shin': ('8', 'שוק', 'SHIN'),
    'foot': ('9', 'נעל', 'FOOT'),
}
fx, fy, fw = views['front']
P = L['views']['front']['parts']


def label(part, side, ly):
    key = part if part in P else f'{part} {side}'
    px, py = P[key]
    px, py = fx + px, fy + py
    num, heb, eng = NAMES[part]
    col = L['colors'][key]
    left = side == 'R' or (part in ('head', 'pelvis'))
    if part == 'torso':
        left = False
    bx = fx - 300 if left else fx + fw + 20
    bw = 280
    ly = fy + ly
    d.line([(px, py), (bx + bw if left else bx, ly)], fill=INK, width=3)
    d.ellipse([px - 9, py - 9, px + 9, py + 9], fill=(255, 255, 255), outline=INK, width=3)
    d.rounded_rectangle([bx, ly - 44, bx + bw, ly + 44], radius=12, fill=(255, 255, 255), outline=col, width=6)
    d.ellipse([bx + 10, ly - 26, bx + 62, ly + 26], fill=col)
    d.text((bx + 36, ly), num + ('' if part in P else side), font=font(24), fill=(255, 255, 255), anchor='mm')
    d.text((bx + bw - 12, ly - 14), he(heb), font=font(28), fill=INK, anchor='rm')
    d.text((bx + bw - 12, ly + 20), eng if len(eng) < 16 else eng.split(' ')[0], font=font(18, False), fill=MUTED, anchor='rm')


label('head', '', 150)
label('torso', '', 330)
label('pelvis', '', 640)
for side in 'RL':
    label('upper arm', side, 250 if side == 'R' else 215)
    label('forearm', side, 410 if side == 'R' else 440)
    label('hand', side, 520 if side == 'R' else 555)
    label('thigh', side, 760 if side == 'R' else 720)
    label('shin', side, 990)
    label('foot', side, 1170)

# ---- where the parts are cut: at the joints
Jf = L['views']['front']['joints']
for k, (jx, jy) in Jf.items():
    cx, cy = fx + jx, fy + jy
    d.ellipse([cx - 13, cy - 13, cx + 13, cy + 13], outline=(255, 255, 255), width=5)
    d.ellipse([cx - 16, cy - 16, cx + 16, cy + 16], outline=INK, width=2)

# the arm angle
sx, sy = fx + Jf['shL'][0], fy + Jf['shL'][1]
d.line([(sx, sy), (sx, sy + 190)], fill=(200, 40, 40), width=3)
d.arc([sx - 130, sy - 130, sx + 130, sy + 130], start=50, end=90, fill=(200, 40, 40), width=5)
d.text((sx + 34, sy + 175), '40°', font=font(34), fill=(200, 40, 40), anchor='lm')

# ---- the rules
RULES = [
    ('תנוחת A:', 'ידיים ישרות, פרושות בזווית 40° מהגוף ולא נוגעות בו. אגרופים סגורים, בלי חפצים ביד.'),
    ('רגליים:', 'ישרות לגמרי (בלי כיפוף בברך), כפות הרגליים ברוחב האגן ופונות קדימה.'),
    ('גוף וראש:', 'גב זקוף, ראש ישר, מבט קדימה, פה סגור. לא תנוחת קרב ולא כריעה.'),
    ('התמונה:', 'כל הגוף בפריים, מבט חזיתי ישר בגובה החזה, רקע חלק, תאורה אחידה.'),
    ('חלקים:', '15 חלקים נפרדים, והחיתוך בדיוק במפרקים (העיגולים הלבנים): צוואר, כתפיים, מרפקים, שורש כף היד, ירכיים, ברכיים, קרסוליים.'),
    ('בגדים:', 'בלי מעיל ארוך או שרוולים רחבים שנוגעים בירכיים. אוזניות, שיער וזקן שייכים לחלק של הראש.'),
]
y = TOP + 1260 + 90
d.line([(60, y - 22), (W - 60, y - 22)], fill=(200, 204, 214), width=3)
for i, (head, text) in enumerate(RULES):
    col = i % 2
    row = i // 2
    rx = W - 60 - col * (W // 2 - 20)
    ry = y + 26 + row * 92
    f1, f2 = font(34), font(31, False)
    hw = d.textlength(he(head), font=f1)
    d.text((rx, ry), he(head), font=f1, fill=(176, 28, 36), anchor='rm')
    # wrap the body to the column
    words, lines, cur = text.split(' '), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if d.textlength(he(t), font=f2) > W // 2 - 120 - hw - 20:
            lines.append(cur)
            cur = w
        else:
            cur = t
    lines.append(cur)
    for k, ln in enumerate(lines[:2]):
        d.text((rx - hw - 16, ry + k * 38), he(ln), font=f2, fill=INK, anchor='rm')

sheet.save(out, optimize=True)
print('saved', out, sheet.size, 'raqm' if RAQM else 'manual rtl')
