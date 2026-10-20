#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
OUTPUT_DIR="$ROOT_DIR/release-assets"
declare -a ASSET_ARGUMENTS=()

usage() {
  cat <<'EOF'
Usage: ./scripts/create-release-checksums.sh [options] [asset ...]

Create SHA256SUMS.txt for macOS release assets and immediately verify it.
Without explicit asset arguments, the versioned DMG and Source.zip in the
output directory are used.

Options:
  --output-dir <path>  Release asset directory (default: release-assets).
  -h, --help           Show this help.

Relative asset arguments are resolved from the output directory. Every asset
must be a direct child of that directory.
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
    --)
      shift
      ASSET_ARGUMENTS+=("$@")
      break
      ;;
    -*)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      ASSET_ARGUMENTS+=("$1")
      shift
      ;;
  esac
done

for command_name in node shasum; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "missing required command: $command_name" >&2
    exit 1
  fi
done

if [[ ! -d "$OUTPUT_DIR" || -L "$OUTPUT_DIR" ]]; then
  echo "output directory must be a real directory: $OUTPUT_DIR" >&2
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

if [[ "${#ASSET_ARGUMENTS[@]}" -eq 0 ]]; then
  ASSET_ARGUMENTS=(
    "FHL-Image-Studio-Desktop-V${VERSION}-macOS-Universal.dmg"
    "FHL-Image-Studio-Desktop-V${VERSION}-Source.zip"
  )
fi

declare -a ASSET_NAMES=()
for argument in "${ASSET_ARGUMENTS[@]}"; do
  if [[ "$argument" == */* ]]; then
    asset_path="$argument"
  else
    asset_path="$OUTPUT_DIR/$argument"
  fi
  asset_parent="$(cd "$(dirname "$asset_path")" && pwd -P)"
  asset_name="$(basename "$asset_path")"
  if [[ "$asset_parent" != "$OUTPUT_DIR" ]]; then
    echo "release assets must be direct children of $OUTPUT_DIR: $argument" >&2
    exit 1
  fi
  if [[ "$asset_name" == "SHA256SUMS.txt" || "$asset_name" == *$'\n'* ]]; then
    echo "invalid release asset name: $asset_name" >&2
    exit 1
  fi
  if [[ ! -f "$asset_path" || -L "$asset_path" ]]; then
    echo "release asset must be a regular file: $asset_path" >&2
    exit 1
  fi
  for existing_name in "${ASSET_NAMES[@]:-}"; do
    if [[ "$asset_name" == "$existing_name" ]]; then
      echo "duplicate release asset: $asset_name" >&2
      exit 1
    fi
  done
  ASSET_NAMES+=("$asset_name")
done

declare -a SORTED_ASSET_NAMES=()
while IFS= read -r asset_name; do
  SORTED_ASSET_NAMES+=("$asset_name")
done < <(printf '%s\n' "${ASSET_NAMES[@]}" | LC_ALL=C sort)
ASSET_NAMES=("${SORTED_ASSET_NAMES[@]}")
CHECKSUM_PATH="$OUTPUT_DIR/SHA256SUMS.txt"
TEMP_CHECKSUM="$(mktemp "$OUTPUT_DIR/.SHA256SUMS.txt.XXXXXX")"

cleanup() {
  /bin/rm -f "$TEMP_CHECKSUM"
}
trap cleanup EXIT

(
  cd "$OUTPUT_DIR"
  for asset_name in "${ASSET_NAMES[@]}"; do
    shasum -a 256 -- "$asset_name"
  done
) >"$TEMP_CHECKSUM"

(
  cd "$OUTPUT_DIR"
  shasum -a 256 -c "$TEMP_CHECKSUM"
)

if [[ -e "$CHECKSUM_PATH" || -L "$CHECKSUM_PATH" ]]; then
  /bin/rm -f "$CHECKSUM_PATH"
fi
/bin/mv "$TEMP_CHECKSUM" "$CHECKSUM_PATH"
trap - EXIT

echo "[FHL release] Checksums: $CHECKSUM_PATH"
