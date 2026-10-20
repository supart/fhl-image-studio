#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
DEFAULT_OUTPUT_DIR="$ROOT_DIR/release-assets"

GIT_REF="HEAD"
OUTPUT_DIR="$DEFAULT_OUTPUT_DIR"

usage() {
  cat <<'EOF'
Usage: ./scripts/package-release-source.sh [options]

Create the clean macOS release source ZIP directly from a Git commit. Files
that are untracked, ignored, or only present in the working tree are never
copied into the archive.

Options:
  --ref <git-ref>       Commit, tag, or branch to archive (default: HEAD).
  --output-dir <path>   Release asset directory (default: release-assets).
  -h, --help            Show this help.
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
    --ref)
      require_argument "$1" "${2:-}"
      GIT_REF="$2"
      shift 2
      ;;
    --ref=*)
      GIT_REF="${1#*=}"
      [[ -n "$GIT_REF" ]] || { echo "--ref requires a value" >&2; exit 2; }
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

for command_name in git node; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "missing required command: $command_name" >&2
    exit 1
  fi
done

COMMIT="$(git -C "$ROOT_DIR" rev-parse --verify "${GIT_REF}^{commit}")"
MANIFEST="$(git -C "$ROOT_DIR" show "$COMMIT:product-version.json")"
VERSION="$(printf '%s' "$MANIFEST" | node -e '
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  const manifest = JSON.parse(raw);
  const version = String(manifest.version || "").trim();
  const displayVersion = String(manifest.displayVersion || "").trim();
  if (!/^\d+\.\d+\.\d+$/.test(version) || displayVersion !== `V${version}`) {
    throw new Error("invalid or inconsistent product version metadata");
  }
  process.stdout.write(version);
});
')"

PACKAGE_NAME="FHL-Image-Studio-Desktop-V${VERSION}-Source"
ASSET_NAME="$PACKAGE_NAME.zip"

mkdir -p "$OUTPUT_DIR"
if [[ -L "$OUTPUT_DIR" ]]; then
  echo "output directory must not be a symbolic link: $OUTPUT_DIR" >&2
  exit 1
fi
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd -P)"
ZIP_PATH="$OUTPUT_DIR/$ASSET_NAME"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/fhl-source-release.XXXXXX")"
TEMP_ZIP="$WORK_DIR/$ASSET_NAME"

cleanup() {
  /bin/rm -rf "$WORK_DIR"
}
trap cleanup EXIT

echo "[FHL source release] Archiving $COMMIT" >&2
git -C "$ROOT_DIR" archive \
  --format=zip \
  --prefix="$PACKAGE_NAME/" \
  --output="$TEMP_ZIP" \
  "$COMMIT"

node "$ROOT_DIR/scripts/check-release-source.mjs" --zip "$TEMP_ZIP"

if [[ -e "$ZIP_PATH" || -L "$ZIP_PATH" ]]; then
  /bin/rm -f "$ZIP_PATH"
fi
/bin/mv "$TEMP_ZIP" "$ZIP_PATH"

echo "[FHL source release] Commit: $COMMIT"
echo "[FHL source release] ZIP:    $ZIP_PATH"
