#!/bin/sh
# Debug helper: rig every cached model into tools/models/proto with debug sheets.
for id in "$@"; do
  echo "== $id"
  sh "G:/AI/Claude/TEKKEN/tools/models/rigdbg.sh" "$id"
done
