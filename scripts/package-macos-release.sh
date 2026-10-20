#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
DEFAULT_APP="$ROOT_DIR/image-studio/build/bin/FHL Studio.app"
DEFAULT_README="$ROOT_DIR/README_MACOS.md"
DEFAULT_OUTPUT_DIR="$ROOT_DIR/release-assets"

APP_PATH="$DEFAULT_APP"
README_PATH="$DEFAULT_README"
OUTPUT_DIR="$DEFAULT_OUTPUT_DIR"

usage() {
  cat <<'EOF'
Usage: ./scripts/package-macos-release.sh [options]

Package an already-built FHL Studio.app into the macOS release DMG. The DMG
contains only FHL Studio.app, an Applications symlink, and README_MACOS.md.

Options:
  --app <path>         App bundle to package.
  --readme <path>      macOS readme copied into the DMG.
  --output-dir <path>  Release asset directory (default: release-assets).
  -h, --help           Show this help.
EOF
}

require_argument() {
  local option="$1"
  local value="${2:-}"
  if [[ -z "$value" || "$value" == -* ]]; then
    echo "$option requires a value" >&2
    exit 2
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      require_argument "$1" "${2:-}"
      APP_PATH="$2"
      shift 2
      ;;
    --app=*)
      APP_PATH="${1#*=}"
      [[ -n "$APP_PATH" ]] || { echo "--app requires a value" >&2; exit 2; }
      shift
      ;;
    --readme)
      require_argument "$1" "${2:-}"
      README_PATH="$2"
      shift 2
      ;;
    --readme=*)
      README_PATH="${1#*=}"
      [[ -n "$README_PATH" ]] || { echo "--readme requires a value" >&2; exit 2; }
      shift
      ;;
    --output-dir)
      require_argument "$1" "${2:-}"
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --output-dir=*)
      OUTPUT_DIR="${1#*=}"
      [[ -n "$OUTPUT_DIR" ]] || { echo "--output-dir requires a value" >&2; exit 2; }
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS release packaging must run on Darwin" >&2
  exit 1
fi

for command_name in node; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "missing required command: $command_name" >&2
    exit 1
  fi
done

for tool_path in /usr/bin/ditto /usr/bin/hdiutil; do
  if [[ ! -x "$tool_path" ]]; then
    echo "missing required macOS tool: $tool_path" >&2
    exit 1
  fi
done

resolve_existing_path() {
  local input_path="$1"
  local parent_path
  local base_name
  parent_path="$(dirname "$input_path")"
  base_name="$(basename "$input_path")"
  printf '%s/%s\n' "$(cd "$parent_path" && pwd -P)" "$base_name"
}

APP_PATH="$(resolve_existing_path "$APP_PATH")"
README_PATH="$(resolve_existing_path "$README_PATH")"

if [[ ! -d "$APP_PATH" || -L "$APP_PATH" || "$APP_PATH" != *.app ]]; then
  echo "app bundle must be a real .app directory: $APP_PATH" >&2
  exit 1
fi
if [[ ! -f "$README_PATH" || -L "$README_PATH" || ! -s "$README_PATH" ]]; then
  echo "macOS readme must be a non-empty regular file: $README_PATH" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
if [[ -L "$OUTPUT_DIR" ]]; then
  echo "output directory must not be a symbolic link: $OUTPUT_DIR" >&2
  exit 1
fi
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd -P)"

VERSION="$(node - "$ROOT_DIR/product-version.json" <<'NODE'
const fs = require("fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const version = String(manifest.version || "").trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`invalid product version: ${version || "<empty>"}`);
}
process.stdout.write(version);
NODE
)"

ASSET_NAME="FHL-Image-Studio-Desktop-V${VERSION}-macOS-Universal.dmg"
DMG_PATH="$OUTPUT_DIR/$ASSET_NAME"
VOLUME_NAME="FHL Image Studio V${VERSION}"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/fhl-macos-release.XXXXXX")"
STAGE_DIR="$WORK_DIR/stage"
TEMP_DMG="$WORK_DIR/$ASSET_NAME"

cleanup() {
  /bin/rm -rf "$WORK_DIR"
}
trap cleanup EXIT

echo "[FHL macOS release] Validating app bundle" >&2
node "$ROOT_DIR/scripts/verify-local-macos-release.mjs" --app "$APP_PATH"

mkdir -p "$STAGE_DIR"
/usr/bin/ditto "$APP_PATH" "$STAGE_DIR/FHL Studio.app"
/usr/bin/ditto "$README_PATH" "$STAGE_DIR/README_MACOS.md"
/bin/ln -s /Applications "$STAGE_DIR/Applications"

stage_entry_count="$(/usr/bin/find "$STAGE_DIR" -mindepth 1 -maxdepth 1 -print | /usr/bin/wc -l | /usr/bin/tr -d '[:space:]')"
if [[ "$stage_entry_count" != "3" \
  || ! -L "$STAGE_DIR/Applications" \
  || ! -d "$STAGE_DIR/FHL Studio.app" \
  || ! -f "$STAGE_DIR/README_MACOS.md" ]]; then
  echo "refusing to create DMG with an unexpected root layout" >&2
  LC_ALL=C /bin/ls -1A "$STAGE_DIR" >&2
  exit 1
fi
if [[ "$(/usr/bin/readlink "$STAGE_DIR/Applications")" != "/Applications" ]]; then
  echo "Applications link must target /Applications" >&2
  exit 1
fi

echo "[FHL macOS release] Creating $ASSET_NAME" >&2
/usr/bin/hdiutil create \
  -quiet \
  -fs HFS+ \
  -format UDBZ \
  -imagekey zlib-level=9 \
  -ov \
  -srcfolder "$STAGE_DIR" \
  -volname "$VOLUME_NAME" \
  "$TEMP_DMG"
/usr/bin/hdiutil verify "$TEMP_DMG" >/dev/null

if [[ -e "$DMG_PATH" || -L "$DMG_PATH" ]]; then
  /bin/rm -f "$DMG_PATH"
fi
/bin/mv "$TEMP_DMG" "$DMG_PATH"

echo "[FHL macOS release] DMG: $DMG_PATH"
