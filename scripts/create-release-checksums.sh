#!/usr/bin/env bash
set -euo pipefail

OUTPUT_ROOT="${1:-release-assets}"
DMG="FHL-Image-Studio-Desktop-V2.0.3.1-macOS-AppleSilicon.dmg"
SOURCE="FHL-Image-Studio-Desktop-V2.0.3.1-Source.zip"

for artifact in "$DMG" "$SOURCE"; do
  if [[ ! -f "$OUTPUT_ROOT/$artifact" ]]; then
    echo "missing release artifact: $OUTPUT_ROOT/$artifact" >&2
    exit 1
  fi
done

(
  cd "$OUTPUT_ROOT"
  shasum -a 256 "$DMG" "$SOURCE" > SHA256SUMS.txt
)
echo "$OUTPUT_ROOT/SHA256SUMS.txt"
