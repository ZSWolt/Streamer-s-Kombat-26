#!/bin/sh
# Dev loop for a model's hands: rig one model straight into the game's assets (no debug renders).
#   sh tools/models/rigquick.sh <id>
BL="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
T="G:/AI/Claude/TEKKEN/tools/models"
"$BL" -b --factory-startup -P "$T/rig.py" -- "$T/cache" "$1" "G:/AI/Claude/TEKKEN/client/public/assets/models/$1.glb" --overrides "$T/overrides/$1.json" 2>&1 | grep -E "^@@ (fingers|sleeveless|armhole|exported|ok|warn)|Error|Traceback|File \"|line [0-9]+"
python - "$1" <<'PY'
import hashlib, io, json, sys
p = 'G:/AI/Claude/TEKKEN/client/public/assets/models/index.json'
j = json.load(io.open(p, encoding='utf8'))
j[sys.argv[1]] = {'file': sys.argv[1] + '.glb', 'v': hashlib.sha1(open('G:/AI/Claude/TEKKEN/client/public/assets/models/' + sys.argv[1] + '.glb', 'rb').read()).hexdigest()[:8]}
io.open(p, 'w', encoding='utf8').write(json.dumps(j, indent=1))
print('manifest', j[sys.argv[1]])
PY
