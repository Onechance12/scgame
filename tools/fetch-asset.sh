#!/usr/bin/env bash
# fetch-asset.sh — pull free CC0 assets from the deterministic APIs into assets/.
# Sources & IDs are catalogued in assets/asset-db.json.
#
# Usage:
#   tools/fetch-asset.sh ph-tex   <id> [res]     Poly Haven texture (diff+nor)   e.g. dirty_tiles 1k
#   tools/fetch-asset.sh ph-model <id> [res]     Poly Haven model (gltf+bin+tex)  e.g. GothicBed_01 1k
#   tools/fetch-asset.sh ph-hdri  <id> [res]     Poly Haven HDRI (.hdr)           e.g. dikhololo_night 1k
#   tools/fetch-asset.sh acg      <id> [res]     ambientCG material zip (unzipped) e.g. Rock030 1K
#
# Everything these endpoints serve is CC0 (no attribution required).
set -euo pipefail

CMD="${1:-}"; ID="${2:-}"; RES="${3:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/assets"

die(){ echo "error: $*" >&2; exit 1; }
[ -n "$CMD" ] && [ -n "$ID" ] || die "usage: fetch-asset.sh <ph-tex|ph-model|ph-hdri|acg> <id> [res]"

get(){ curl -fsSL --retry 3 --max-time 120 "$1" -o "$2" && echo "  ok  $2"; }

case "$CMD" in
  ph-tex)
    RES="${RES:-1k}"; D="$OUT/textures"; mkdir -p "$D"
    base="https://dl.polyhaven.org/file/ph-assets/Textures/jpg/$RES/$ID"
    get "$base/${ID}_diff_${RES}.jpg"   "$D/${ID}_diff.jpg"
    get "$base/${ID}_nor_gl_${RES}.jpg" "$D/${ID}_nor.jpg" || echo "  (no normal map)"
    ;;
  ph-model)
    RES="${RES:-1k}"; D="$OUT/models/$ID"; mkdir -p "$D"
    api="https://api.polyhaven.com/files/$ID"
    tmp="$(mktemp)"; get "$api" "$tmp"
    # download every gltf-related file listed for this resolution
    node -e '
      const f=JSON.parse(require("fs").readFileSync(process.argv[1]));
      const res=process.argv[2];
      const g=f.gltf&&f.gltf[res]&&f.gltf[res].gltf; if(!g){console.error("no gltf at "+res);process.exit(1);}
      const urls=new Set([g.url]);
      if(g.include) Object.values(g.include).forEach(v=>urls.add(v.url));
      console.log([...urls].join("\n"));
    ' "$tmp" "$RES" | while read -r u; do [ -n "$u" ] && get "$u" "$D/$(basename "$u")"; done
    rm -f "$tmp"
    ;;
  ph-hdri)
    RES="${RES:-1k}"; D="$OUT/hdris"; mkdir -p "$D"
    get "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/$RES/${ID}_${RES}.hdr" "$D/${ID}_${RES}.hdr"
    ;;
  acg)
    RES="${RES:-1K}"; D="$OUT/materials/$ID"; mkdir -p "$D"
    z="$(mktemp --suffix=.zip)"
    get "https://ambientcg.com/get?file=${ID}_${RES}-JPG.zip" "$z"
    ( cd "$D" && unzip -oq "$z" ) && echo "  unzipped -> $D"
    rm -f "$z"
    ;;
  *) die "unknown command: $CMD" ;;
esac
echo "done. (CC0 — log any CC-BY/RF assets in assets/CREDITS.txt)"
