#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_ROOT="${1:-${OUTPUT_ROOT:-$ROOT_DIR/release-assets}}"
PACKAGE_NAME="FHL-Image-Studio-Desktop-V2.0.3.1-Source"

mkdir -p "$OUTPUT_ROOT"
OUTPUT_ROOT="$(cd "$OUTPUT_ROOT" && pwd)"
ZIP_PATH="$OUTPUT_ROOT/$PACKAGE_NAME.zip"
STAGE_PARENT="$(mktemp -d "$OUTPUT_ROOT/.fhl-source-stage.XXXXXX")"
PACKAGE_DIR="$STAGE_PARENT/$PACKAGE_NAME"

cleanup() {
  rm -rf "$STAGE_PARENT"
}
trap cleanup EXIT

if git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -C "$ROOT_DIR" archive --format=tar --prefix="$PACKAGE_NAME/" HEAD | tar -xf - -C "$STAGE_PARENT"
else
  mkdir -p "$PACKAGE_DIR"
  rsync -a \
    --exclude '.git/' \
    --exclude '.build-tools/' \
    --exclude '.gocache/' \
    --exclude '.gomodcache/' \
    --exclude '.gopath/' \
    --exclude 'node_modules/' \
    --exclude 'frontend/dist/' \
    --exclude 'build/bin/' \
    --exclude 'test-results/' \
    --exclude 'release-assets/' \
    --exclude '.DS_Store' \
    --exclude '*.local' \
    --exclude '*.local.json' \
    --exclude '*.log' \
    --exclude '*.tmp' \
    --exclude '*.exe' \
    --exclude '*.dmg' \
    --exclude 'input/***' \
    --exclude 'output/***' \
    --exclude 'intermediate/***' \
    --exclude 'runtime/cli/***' \
    "$ROOT_DIR/" "$PACKAGE_DIR/"
fi

for directory in input output output/log intermediate runtime runtime/cli; do
  mkdir -p "$PACKAGE_DIR/$directory"
  : > "$PACKAGE_DIR/$directory/.gitkeep"
done

node "$PACKAGE_DIR/scripts/check-release-source.mjs" "$PACKAGE_DIR"
rm -f "$ZIP_PATH"
(
  cd "$STAGE_PARENT"
  /usr/bin/zip -X -q -r "$ZIP_PATH" "$PACKAGE_NAME"
)
unzip -t "$ZIP_PATH" >/dev/null
echo "$ZIP_PATH"
