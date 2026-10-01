#!/bin/sh
# One-off helper: run stage 1 (prep.py) for every character sculpt, writing the cache used by rig.py.
BL="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
SRC="G:/AI/Claude/Models"
CACHE="G:/AI/Claude/TEKKEN/tools/models/cache"
OVR="G:/AI/Claude/TEKKEN/tools/models/overrides"
run() {
  echo "== $1 -> $2"
  "$BL" -b --factory-startup -P "G:/AI/Claude/TEKKEN/tools/models/prep.py" -- "$SRC/$1" "$CACHE" "$2" --overrides "$OVR/$2.json" 2>&1 | grep -E "^@@ (part|weld|decimated|cached)|Error|Traceback|File \""
}
run "ODEDSVR.glb" odedsvr
run "RONENGG.glb" ronengg
run "Adam Drakes.glb" adam
run "PHILIP.glb" philip
run "IGZ.glb" igz
run "INDE.glb" inde
run "LIORSLIFE.glb" liorslife
run "EDEN PSYQR.glb" psyqr
run "SHILO.glb" shilo
echo "== all done"
