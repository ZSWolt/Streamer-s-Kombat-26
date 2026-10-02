"""Proportions of the prepared sculpts (stage-1 cache), side by side: python tools/models/measure.py [id ...]

Everything in units of the body's height. Reads cache/<id>.npz (point samples per part) and <id>.json (classes).
"""
import glob
import json
import os
import sys

import numpy as np

T = os.path.dirname(os.path.abspath(__file__))
ids = sys.argv[1:] or sorted(os.path.basename(f)[:-5] for f in glob.glob(os.path.join(T, 'cache', '*.json')))
rows = []
for i in ids:
    meta = json.load(open(os.path.join(T, 'cache', i + '.json'), encoding='utf8'))
    npz = np.load(os.path.join(T, 'cache', i + '.npz'))
    H = meta['height']
    P = {n: npz[n].astype(np.float64) / H for n in meta['parts']}
    cls = lambda c: [P[n] for n, m in meta['parts'].items() if m['cls'] == c]
    cat = lambda c: np.concatenate(cls(c)) if cls(c) else np.zeros((0, 3))
    head, hacc, torso, arm, leg, shoe = cat('head'), cat('headacc'), cat('torso'), cat('arm'), cat('leg'), cat('shoe')
    cx = float(np.median(torso[:, 0]))
    allp = np.concatenate(list(P.values()))
    # the head: everything above the neck (the narrowest level of the column over the collar); the face is the
    # front of it, measured at cheek height so that headphones, caps and hair do not count
    col = np.concatenate([p for n, p in P.items() if meta['parts'][n]['cls'] in ('head', 'headacc', 'torso', 'torso2')])
    col = col[np.abs(col[:, 0] - cx) < 0.16]
    top = float(col[:, 1].max())
    best = None
    for y in np.arange(0.76, top - 0.08, 0.004):
        b = col[(col[:, 1] >= y) & (col[:, 1] < y + 0.008)]
        if len(b) < 15:
            continue
        w = float(np.percentile(b[:, 0], 98) - np.percentile(b[:, 0], 2))
        if best is None or w < best[0]:
            best = (w, y)
    neck_w, neck = best
    hg = col[col[:, 1] > neck]
    z0, z1 = float(np.percentile(hg[:, 2], 2)), float(np.percentile(hg[:, 2], 98))
    cheeks = hg[(hg[:, 1] > neck + 0.3 * (top - neck)) & (hg[:, 1] < neck + 0.6 * (top - neck)) & (hg[:, 2] > z0 + 0.6 * (z1 - z0))]
    hw = float(np.percentile(cheeks[:, 0], 98) - np.percentile(cheeks[:, 0], 2))
    full = hg[(hg[:, 1] > neck + 0.3 * (top - neck)) & (hg[:, 1] < neck + 0.8 * (top - neck))]
    hd = float(np.percentile(full[:, 0], 98) - np.percentile(full[:, 0], 2))  # the whole head's width (hair, headphones)
    chin = neck
    span = float(arm[:, 0].max() - arm[:, 0].min()) if len(arm) else 0
    arm_y = float(np.median(arm[:, 1])) if len(arm) else 0
    def width(pts, y0, y1, q=98):
        b = pts[(pts[:, 1] >= y0) & (pts[:, 1] < y1)]
        return (float(np.percentile(b[:, 0], q) - np.percentile(b[:, 0], 100 - q)), float(np.percentile(b[:, 2], q) - np.percentile(b[:, 2], 100 - q))) if len(b) > 20 else (0, 0)
    chest = width(torso, 0.66, 0.72)
    waist = width(torso, 0.56, 0.62)
    hem_y = float(np.percentile(torso[:, 1], 1))
    hips = width(leg, 0.46, 0.52)
    thigh = width(leg[leg[:, 0] > cx], 0.36, 0.42)
    # fork of the legs: highest level at which the middle is empty
    fork = 0
    for y in np.arange(0.2, 0.6, 0.005):
        b = leg[(leg[:, 1] >= y) & (leg[:, 1] < y + 0.01)]
        if len(b) > 20 and (np.abs(b[:, 0] - cx) < 0.008).sum() < 3:
            fork = y
    shoe_len = float(shoe[:, 2].max() - shoe[:, 2].min()) if len(shoe) else 0
    rows.append((i, len(meta['parts']), top - chin, hw, hd, neck, neck_w, span, arm_y, chest[0], chest[1], waist[0], waist[1], hem_y, hips[0], thigh[0], fork, shoe_len))
hdr = ('id', 'parts', 'neck-top', 'face w', 'head w', 'neck y', 'neck w', 'arm span', 'arm y', 'chest w', 'chest d', 'waist w', 'waist d', 'hem y', 'hips w', 'thigh w', 'fork y', 'shoe')
print(' '.join(f'{h:>9s}' if k else f'{h:14s}' for k, h in enumerate(hdr)))
for r in rows:
    print(f'{r[0]:14s} {r[1]:9d} ' + ' '.join(f'{v:9.3f}' for v in r[2:]))
a = np.array([r[2:] for r in rows])
print(f'{"mean":14s} {"":9s} ' + ' '.join(f'{v:9.3f}' for v in a.mean(0)))
