"""Convert every character model in the source folder into a game-ready rigged GLB.

  python tools/models/build_all.py [--src G:/AI/Claude/Models] [--only odedsvr,philip] [--debug] [--prep] [--unlisted]

Two Blender stages per model:
  prep.py  (slow, cached in tools/models/cache): import the 60 MB sculpt, classify its parts, decimate, materials
  rig.py   (fast): fit the skeleton, straighten the body into a neutral standing pose, skin, export

Source file name -> fighter id (lower-case, first word): ODEDSVR.glb -> odedsvr, "Adam Drakes.glb" -> adam.
Output: client/public/assets/models/<id>.glb + index.json (the game loads whatever is listed there).
Per-model fixes live in tools/models/overrides/<id>.json (see prep.py / rig.py).
--prep forces stage 1 again; --unlisted also builds models whose id is not in the roster (not added to the manifest).
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'client', 'public', 'assets', 'models')
TOOLS = os.path.join(ROOT, 'tools', 'models')
CACHE = os.path.join(TOOLS, 'cache')
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


def fighter_id(stem: str):
    """File name -> (fighter id, version).

    'EDEN PSYQR' -> psyqr (any word that is a roster id wins), 'OHAD' -> masterohad (a word of 4+ letters that is
    part of an id), 'Adam Drakes' -> adam (first word otherwise). A trailing V<n> is the version of the model:
    'IGZV2' / 'IGZ V2' -> (igz, 2); the highest version of a fighter is the one that gets built.
    """
    import re
    words, version = [], 1
    for w in stem.lower().replace('_', ' ').replace('-', ' ').split():
        m = re.fullmatch(r'(.*?)v(\d+)', w)
        if m:
            version = int(m.group(2))
            w = m.group(1)
        if w:
            words.append(w)
    ids = roster_ids()
    for w in words:
        if w in ids:
            return w, version
    for i in ids:  # e.g. 'sasi' for sasivetheboiz, 'ohad' for masterohad
        if any(len(w) >= 4 and w in i for w in words):
            return i, version
    return words[0], version


def run(script, args):
    cmd = [blender(), '-b', '--factory-startup', '-P', os.path.join(TOOLS, script), '--'] + args
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf8', errors='replace')
    out = r.stdout + r.stderr
    for l in out.splitlines():
        if l.startswith('@@') or 'Error' in l or 'Traceback' in l or l.strip().startswith('File "'):
            if not l.startswith('@@ material') and not l.startswith('@@ weights'):
                print('  ', l, flush=True)
    return r.returncode == 0 or '@@ ok' in out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=r'G:\AI\Claude\Models')
    ap.add_argument('--only', default='')
    ap.add_argument('--debug', action='store_true')
    ap.add_argument('--prep', action='store_true')
    ap.add_argument('--unlisted', action='store_true')
    ap.add_argument('--tris', default='110000')
    a = ap.parse_args()
    only = set(filter(None, a.only.split(',')))
    os.makedirs(OUT, exist_ok=True)
    manifest_path = os.path.join(OUT, 'index.json')
    manifest = json.load(open(manifest_path, encoding='utf8')) if os.path.exists(manifest_path) else {}
    ids = roster_ids()
    files = {}
    for name in sorted(os.listdir(a.src)):
        if not name.lower().endswith('.glb'):
            continue
        fid, version = fighter_id(os.path.splitext(name)[0])
        if fid in files and files[fid][0] >= version:
            print(f'-- skipped {name}: {files[fid][1]} is a newer version of {fid}', flush=True)
            continue
        if fid in files:
            print(f'-- skipped {files[fid][1]}: {name} is a newer version of {fid}', flush=True)
        files[fid] = (version, name)
    for fid, (_, name) in files.items():
        listed = fid in ids
        if not listed and not (a.unlisted and fid in only):  # props such as "Concards Pack.glb" live in the same folder
            print(f'-- skipped {name}: no fighter with id "{fid}" in the roster', flush=True)
            continue
        if only and fid not in only:
            continue
        src = os.path.join(a.src, name)
        ovr = os.path.join(TOOLS, 'overrides', fid + '.json')
        blend = os.path.join(CACHE, fid + '.blend')
        print(f'== {name} -> {fid}', flush=True)
        stale = not os.path.exists(blend) or os.path.getmtime(blend) < os.path.getmtime(src)
        if a.prep or stale:
            if not run('prep.py', [src, CACHE, fid, '--tris', a.tris, '--overrides', ovr]) or not os.path.exists(blend):
                print('   FAILED (prep)', flush=True)
                continue
        out = os.path.join(OUT, fid + '.glb')
        args = [CACHE, fid, out, '--overrides', ovr]
        if a.debug:
            args += ['--debug', os.path.join(TOOLS, 'debug')]
        before = os.path.getmtime(out) if os.path.exists(out) else 0
        ok = run('rig.py', args)
        if not ok or not os.path.exists(out) or os.path.getmtime(out) == before:
            print('   FAILED (rig)', flush=True)
            continue
        if listed:
            with open(out, 'rb') as f:
                v = hashlib.sha1(f.read()).hexdigest()[:8]
            manifest[fid] = {'file': fid + '.glb', 'v': v}
    with open(manifest_path, 'w', encoding='utf8') as f:
        json.dump(manifest, f, indent=1)
    print('manifest:', manifest)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
