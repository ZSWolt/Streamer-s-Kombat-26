"""Tile debug renders into one contact sheet.

  python tools/models/sheet.py <out.jpg> <img> [<img> ...] [--cols 4] [--h 520]
"""
import sys

from PIL import Image

args = sys.argv[1:]
cols, hh = 4, 520
if '--cols' in args:
    i = args.index('--cols')
    cols = int(args[i + 1])
    del args[i:i + 2]
if '--h' in args:
    i = args.index('--h')
    hh = int(args[i + 1])
    del args[i:i + 2]
out, files = args[0], args[1:]
ims = []
for f in files:
    im = Image.open(f).convert('RGB')
    ims.append(im.resize((round(im.width * hh / im.height), hh), Image.LANCZOS))
rows = [ims[i:i + cols] for i in range(0, len(ims), cols)]
w = max(sum(im.width for im in r) for r in rows)
sheet = Image.new('RGB', (w, hh * len(rows)), (40, 40, 46))
for y, r in enumerate(rows):
    x = 0
    for im in r:
        sheet.paste(im, (x, y * hh))
        x += im.width
sheet.save(out, quality=88)
print(out, sheet.size)
