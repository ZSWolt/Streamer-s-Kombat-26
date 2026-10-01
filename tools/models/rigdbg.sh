#!/bin/sh
# Debug helper: run stage 2 (rig.py) for one model into tools/models/proto and tile its debug renders.
#   sh tools/models/rigdbg.sh <id> [extra rig.py args]
BL="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
T="G:/AI/Claude/TEKKEN/tools/models"
id="$1"
shift
"$BL" -b --factory-startup -P "$T/rig.py" -- "$T/cache" "$id" "$T/proto/$id.glb" --debug "$T/dbg2" --overrides "$T/overrides/$id.json" "$@" 2>&1 \
  | grep -E "^@@ (pelvis|trunk|legs|knee|shoulders|thigh|shin|shoe|arm|rounded|rest pose|exported|ok|warn)|Error|Traceback|File \"|line [0-9]+"
cd "$T/dbg2" || exit 1
python ../sheet.py "${id}_fit.jpg" "${id}_fit_front.png" "${id}_fit_left.png" "${id}_fit_back.png" "${id}_fit_top.png" --cols 4 --h 760 >/dev/null
if [ -f "${id}_rest_front.png" ]; then
  python ../sheet.py "${id}_rest.jpg" "${id}_rest_front.png" "${id}_rest_left.png" "${id}_rest_back.png" "${id}_rest_fl.png" "${id}_restw_front.png" "${id}_restw_left.png" "${id}_restw_back.png" "${id}_restx_left.png" --cols 4 --h 760 >/dev/null
  python ../sheet.py "${id}_poses.jpg" "${id}_pose_guard_fl.png" "${id}_pose_guard_left.png" "${id}_pose_kick_fl.png" "${id}_pose_kick_left.png" "${id}_pose_armsup_fl.png" "${id}_pose_armsup_left.png" "${id}_pose_squat_fl.png" "${id}_pose_squat_left.png" --cols 4 --h 760 >/dev/null
fi
echo "sheets: $T/dbg2/${id}_fit.jpg ${id}_rest.jpg ${id}_poses.jpg"
