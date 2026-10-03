"""Bring assets/models/index.json up to date with the model files beside it (the `v` of each is a hash of its file,
so a rebuilt model is fetched again and an untouched one stays cached): python tools/models/manifest.py

A model file of a fighter in the roster that the manifest does not list yet is added (builds run side by side each
write the manifest they started from, and the last one to finish would drop the others' new models)."""
import hashlib
import io
import json
import os
import re

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
D = os.path.join(ROOT, 'client', 'public', 'assets', 'models')
p = os.path.join(D, 'index.json')
j = json.load(io.open(p, encoding='utf8'))
with io.open(os.path.join(ROOT, 'client', 'src', 'data', 'roster.ts'), encoding='utf8') as f:
    ids = set(re.findall(r"\bid: '([a-z0-9]+)'", f.read()))
for name in sorted(os.listdir(D)):
    stem, ext = os.path.splitext(name)
    if ext.lower() == '.glb' and stem in ids and stem not in j:
        print(stem, 'added')
        j[stem] = {'file': name}
for k, m in j.items():
    v = hashlib.sha1(open(os.path.join(D, m['file']), 'rb').read()).hexdigest()[:8]
    if m.get('v') != v:
        print(k, m.get('v'), '->', v)
        m['v'] = v
io.open(p, 'w', encoding='utf8').write(json.dumps(j, indent=1))
print(len(j), 'models listed')
