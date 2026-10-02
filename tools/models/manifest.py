"""Bring assets/models/index.json up to date with the model files beside it (the `v` of each is a hash of its file,
so a rebuilt model is fetched again and an untouched one stays cached): python tools/models/manifest.py"""
import hashlib
import io
import json
import os

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'client', 'public', 'assets', 'models')
p = os.path.join(D, 'index.json')
j = json.load(io.open(p, encoding='utf8'))
for k, m in j.items():
    v = hashlib.sha1(open(os.path.join(D, m['file']), 'rb').read()).hexdigest()[:8]
    if m.get('v') != v:
        print(k, m.get('v'), '->', v)
        m['v'] = v
io.open(p, 'w', encoding='utf8').write(json.dumps(j, indent=1))
print(len(j), 'models listed')
