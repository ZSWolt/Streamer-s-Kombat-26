"""Print a model-check report (tools/shots/<name>.json, written by /qa.html?out=<name>): python tools/models/qa_report.py <name> [id ...]"""
import io
import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')
R = json.load(io.open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'shots', sys.argv[1] + '.json'), encoding='utf8'))
for k, r in R.items():
    if sys.argv[2:] and k not in sys.argv[2:]:
        continue
    print(f"== {k}: {r['poses']} poses, {r['meshes']} meshes, {r['pairs']} seam pairs | back {r['backTotal']} px  lids {r.get('lidTotal', 0)} px (max {r.get('lidMax', 0)})  smear {r['smearTotal']} tris  gap max {r['gapMax']} cm, >1.5 cm in {r['gapPoses']} poses")
    print('   back by view', r['backByView'])
    for g in r['back'][:6]:
        print(f"   back  {g['pose']}^{g['view']}: {g['px']} px at {g['at']} {g['parts']}")
    for g in r.get('lids', [])[:6]:
        print(f"   lid   {g['pose']}^{g['view']}: {g['px']} px {g['parts']}")
    for g in r['smear'][:5]:
        print(f"   smear {g['pose']}: {g['tris']} tris, worst x{g['max']} in {g['part']}")
    for g in r['gap'][:6]:
        print(f"   gap   {g['pose']}: {g['cm']} cm ({g['n']} pairs over 1 cm) {g['pair']} at {g['h']}H")
    print('   lab:', r['lab'])
    print('   lab lids:', r.get('labLids', ''))
