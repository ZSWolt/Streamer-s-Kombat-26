"""Convert every character model in the source folder into a game-ready rigged GLB.

  python tools/models/build_all.py [--src G:/AI/Claude/Models] [--only odedsvr,philip] [--debug]

Source file name -> fighter id (lower-case, first word): ODEDSVR.glb -> odedsvr, "Adam Drakes.glb" -> adam.
Output: client/public/assets/models/<id>.glb + index.json (the game loads whatever is listed there).
Per-model fixes live in tools/models/overrides/<id>.json (see build.py).
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'client', 'public', 'assets', 'models')
BLENDER_CANDIDATES = [
    os.environ.get('BLENDER', ''),
    r'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe',
    r'C:\Program Files\Blender Foundation\Blender 4.5\blender.exe',
    'blender',
]


def blender():
    for b in BLENDER_CANDIDATES:
        if b and (os.path.exists(b) or b == 'blender'):
            return b
    raise SystemExit('Blender not found (set BLENDER=path/to/blender.exe)')


def roster_ids():
    import re
    with open(os.path.join(ROOT, 'client', 'src', 'data', 'roster.ts'), encoding='utf8') as f:
        return re.findall(r"\bid: '([a-z0-9]+)'", f.read())


def fighter_id(stem: str) -> str:
    """'EDEN PSYQR' -> psyqr (any word that is a roster id wins), 'Adam Drakes' -> adam (first word otherwise)."""
    words = stem.lower().replace('_', ' ').replace('-', ' ').split()
    ids = roster_ids()
    for w in words:
        if w in ids:
            return w
    for i in ids:  # e.g. 'sasi' for sasivetheboiz
        if any(len(w) >= 4 and i.startswith(w) for w in words):
            return i
    return words[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=r'G:\AI\Claude\Models')
    ap.add_argument('--only', default='')
    ap.add_argument('--debug', action='store_true')
    ap.add_argument('--tris', default='110000')
    a = ap.parse_args()
    only = set(filter(None, a.only.split(',')))
    os.makedirs(OUT, exist_ok=True)
    manifest_path = os.path.join(OUT, 'index.json')
    manifest = json.load(open(manifest_path, encoding='utf8')) if os.path.exists(manifest_path) else {}
    for name in sorted(os.listdir(a.src)):
        if not name.lower().endswith('.glb'):
            continue
        fid = fighter_id(os.path.splitext(name)[0])
        if fid not in roster_ids():  # props such as "Concards Pack.glb" live in the same folder
            print(f'-- skipped {name}: no fighter with id "{fid}" in the roster', flush=True)
            continue
        if only and fid not in only:
            continue
        out = os.path.join(OUT, fid + '.glb')
        cmd = [blender(), '-b', '--factory-startup', '-P', os.path.join(ROOT, 'tools', 'models', 'build.py'), '--',
               os.path.join(a.src, name), out, '--tris', a.tris,
               '--overrides', os.path.join(ROOT, 'tools', 'models', 'overrides', fid + '.json')]
        if a.debug:
            cmd += ['--debug', os.path.join(ROOT, 'tools', 'models', 'debug')]
        print(f'== {name} -> {fid}', flush=True)
        r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf8', errors='replace')
        lines = [l for l in (r.stdout + r.stderr).splitlines() if l.startswith('@@') or 'Error' in l or 'Traceback' in l or l.strip().startswith('File "')]
        for l in lines:
            if not l.startswith('@@ material') and not l.startswith('@@ weights'):
                print('  ', l, flush=True)
        if not os.path.exists(out) or r.returncode != 0 and 'exported' not in r.stdout:
            print('   FAILED', flush=True)
            continue
        with open(out, 'rb') as f:
            v = hashlib.sha1(f.read()).hexdigest()[:8]
        manifest[fid] = {'file': fid + '.glb', 'v': v}
    with open(manifest_path, 'w', encoding='utf8') as f:
        json.dump(manifest, f, indent=1)
    print('manifest:', manifest)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
