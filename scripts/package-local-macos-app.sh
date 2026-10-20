#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
PROJECT_DIR="$ROOT_DIR/image-studio"
PRODUCT_MANIFEST="$ROOT_DIR/product-version.json"
WAILS_CONFIG="$PROJECT_DIR/wails.json"
PLIST_TEMPLATE="$PROJECT_DIR/build/darwin/Info.plist"
ENTITLEMENTS_PATH="$PROJECT_DIR/build/darwin/entitlements.plist"
ICON_SRC="$PROJECT_DIR/build/appicon.png"
HEADER_PROMOTION_FILE_NAME="顶部推广信息.txt"
HEADER_PROMOTION_SRC="$ROOT_DIR/$HEADER_PROMOTION_FILE_NAME"
BUILD_BIN_DIR="$PROJECT_DIR/build/bin"
EXPECTED_APP_BUNDLE="$BUILD_BIN_DIR/FHL Studio.app"
BUNDLE_ID="top.fangtangyuan.fhlstudio"
MIN_SYSTEM_VERSION="13.0"
DESKTOP_UI_VARIANT="windows-parity"
VISUAL_BASELINE="macos-v2.0.3-windows-parity"
GO_COMPILER="${GO_COMPILER:-go}"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/fhl-studio-macos.XXXXXX")"
META_FILE="$WORK_DIR/metadata"

cleanup() {
  /bin/rm -rf "$WORK_DIR"
}
trap cleanup EXIT

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

for command_name in node npm "$GO_COMPILER" xcrun; do
  require_command "$command_name"
done

for tool_path in \
  /usr/bin/codesign \
  /usr/bin/ditto \
  /usr/bin/iconutil \
  /usr/bin/lipo \
  /usr/bin/plutil \
  /usr/bin/sips \
  /usr/bin/xattr; do
  if [[ ! -x "$tool_path" ]]; then
    echo "missing required macOS tool: $tool_path" >&2
    exit 1
  fi
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS packaging must run on Darwin" >&2
  exit 1
fi

node - "$PRODUCT_MANIFEST" "$WAILS_CONFIG" >"$META_FILE" <<'NODE'
const fs = require("fs");
const path = require("path");

const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const config = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const version = String(manifest.version || "").trim();
const productName = String(config.info?.productName || "").trim();
const outputFilename = String(config.outputfilename || "").trim();
const wailsVersion = String(config.info?.productVersion || "").trim();
const comments = String(config.info?.comments || "").replace(/[\r\n]+/g, " ").trim();
const copyright = String(config.info?.copyright || "").replace(/[\r\n]+/g, " ").trim();

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`invalid product-version.json version: ${version || "<empty>"}`);
}
if (!productName || !outputFilename) {
  throw new Error("wails.json must define info.productName and outputfilename");
}
if (path.basename(outputFilename) !== outputFilename) {
  throw new Error(`unsafe wails.json outputfilename: ${outputFilename}`);
}
if (wailsVersion !== version) {
  throw new Error(`version drift: product-version.json=${version}, wails.json=${wailsVersion || "<empty>"}`);
}

for (const value of [productName, outputFilename, version, comments, copyright]) {
  console.log(value);
}
NODE

APP_NAME="$(sed -n '1p' "$META_FILE")"
OUTPUT_FILENAME="$(sed -n '2p' "$META_FILE")"
APP_VERSION="$(sed -n '3p' "$META_FILE")"
APP_COMMENTS="$(sed -n '4p' "$META_FILE")"
APP_COPYRIGHT="$(sed -n '5p' "$META_FILE")"
APP_BUNDLE="$BUILD_BIN_DIR/${APP_NAME}.app"

if [[ "$APP_BUNDLE" != "$EXPECTED_APP_BUNDLE" ]]; then
  echo "refusing to replace unexpected app bundle: $APP_BUNDLE" >&2
  echo "expected: $EXPECTED_APP_BUNDLE" >&2
  exit 1
fi

for required_file in "$ICON_SRC" "$PLIST_TEMPLATE" "$ENTITLEMENTS_PATH" "$HEADER_PROMOTION_SRC"; do
  if [[ ! -f "$required_file" ]]; then
    echo "missing required packaging input: $required_file" >&2
    exit 1
  fi
done

/usr/bin/plutil -lint "$PLIST_TEMPLATE" >/dev/null
/usr/bin/plutil -lint "$ENTITLEMENTS_PATH" >/dev/null
node "$ROOT_DIR/scripts/sync-version-metadata.mjs" --check

mkdir -p "$BUILD_BIN_DIR"
if [[ -L "$PROJECT_DIR/build" || -L "$BUILD_BIN_DIR" ]]; then
  echo "refusing to package through a symlinked build directory" >&2
  exit 1
fi
if [[ "$(cd "$BUILD_BIN_DIR" && pwd -P)" != "$BUILD_BIN_DIR" ]]; then
  echo "refusing to package outside the repository build directory" >&2
  exit 1
fi

if [[ ! -d "$PROJECT_DIR/frontend/node_modules" ]]; then
  echo "[FHL macOS] frontend dependencies missing; running npm ci" >&2
  (
    cd "$PROJECT_DIR/frontend"
    npm ci
  )
fi

export GOTOOLCHAIN="local"
export MACOSX_DEPLOYMENT_TARGET="$MIN_SYSTEM_VERSION"
export VITE_TARGET_PLATFORM="macos"
export VITE_DESKTOP_UI_VARIANT="windows-parity"
export VITE_APP_VERSION="$APP_VERSION"
export IMAGE_STUDIO_PRODUCT_VERSION="$APP_VERSION"
export IMAGE_STUDIO_FRONTEND_VERSION="$APP_VERSION"
export IMAGE_STUDIO_STORAGE_NAMESPACE="fhl-image-studio-desktop"

echo "[FHL macOS] Building frontend for macOS V$APP_VERSION" >&2
(
  cd "$PROJECT_DIR/frontend"
  npm run build:macos
)

STAGED_APP="$WORK_DIR/${APP_NAME}.app"
STAGED_CONTENTS="$STAGED_APP/Contents"
STAGED_EXECUTABLE="$STAGED_CONTENTS/MacOS/$OUTPUT_FILENAME"
STAGED_RESOURCES="$STAGED_CONTENTS/Resources"
ARM64_EXECUTABLE="$WORK_DIR/$OUTPUT_FILENAME-arm64"
AMD64_EXECUTABLE="$WORK_DIR/$OUTPUT_FILENAME-amd64"
ICONSET_DIR="$WORK_DIR/FHLStudio.iconset"
mkdir -p "$STAGED_CONTENTS/MacOS" "$STAGED_RESOURCES" "$ICONSET_DIR"

CLANG_BIN="$(xcrun --sdk macosx --find clang)"
CLANGXX_BIN="$(xcrun --sdk macosx --find clang++)"
MACOS_SDKROOT="$(xcrun --sdk macosx --show-sdk-path)"

build_slice() {
  local goarch="$1"
  local clang_arch="$2"
  local output_path="$3"

  echo "[FHL macOS] Building $goarch desktop slice" >&2
  (
    cd "$PROJECT_DIR"
    GOOS=darwin \
    GOARCH="$goarch" \
    CGO_ENABLED=1 \
    SDKROOT="$MACOS_SDKROOT" \
    CC="$CLANG_BIN -arch $clang_arch" \
    CXX="$CLANGXX_BIN -arch $clang_arch" \
    CGO_CFLAGS="-isysroot $MACOS_SDKROOT -mmacosx-version-min=$MIN_SYSTEM_VERSION" \
    CGO_CPPFLAGS="-isysroot $MACOS_SDKROOT -mmacosx-version-min=$MIN_SYSTEM_VERSION" \
    CGO_CXXFLAGS="-isysroot $MACOS_SDKROOT -I$PROJECT_DIR/build -mmacosx-version-min=$MIN_SYSTEM_VERSION" \
    CGO_LDFLAGS="-isysroot $MACOS_SDKROOT -framework UniformTypeIdentifiers -mmacosx-version-min=$MIN_SYSTEM_VERSION" \
    "$GO_COMPILER" build \
      -trimpath \
      -buildvcs=false \
      -tags 'desktop,production' \
      -ldflags "-s -w -X github.com/yuanhua/image-gptcodex/pkg/client.Version=$APP_VERSION" \
      -o "$output_path" \
      .
  )
}

build_slice arm64 arm64 "$ARM64_EXECUTABLE"
build_slice amd64 x86_64 "$AMD64_EXECUTABLE"
/usr/bin/lipo -create -output "$STAGED_EXECUTABLE" "$ARM64_EXECUTABLE" "$AMD64_EXECUTABLE"
chmod 755 "$STAGED_EXECUTABLE"

create_icon() {
  local size="$1"
  local output_name="$2"
  /usr/bin/sips -z "$size" "$size" "$ICON_SRC" --out "$ICONSET_DIR/$output_name" >/dev/null
}

create_icon 16 icon_16x16.png
create_icon 32 icon_16x16@2x.png
create_icon 32 icon_32x32.png
create_icon 64 icon_32x32@2x.png
create_icon 128 icon_128x128.png
create_icon 256 icon_128x128@2x.png
create_icon 256 icon_256x256.png
create_icon 512 icon_256x256@2x.png
create_icon 512 icon_512x512.png
create_icon 1024 icon_512x512@2x.png
/usr/bin/iconutil -c icns "$ICONSET_DIR" -o "$STAGED_RESOURCES/iconfile.icns"
/usr/bin/ditto "$HEADER_PROMOTION_SRC" "$STAGED_RESOURCES/$HEADER_PROMOTION_FILE_NAME"

/usr/bin/ditto "$PLIST_TEMPLATE" "$STAGED_CONTENTS/Info.plist"
/usr/bin/plutil -replace CFBundleDisplayName -string "$APP_NAME" "$STAGED_CONTENTS/Info.plist"
/usr/bin/plutil -replace CFBundleExecutable -string "$OUTPUT_FILENAME" "$STAGED_CONTENTS/Info.plist"
/usr/bin/plutil -replace CFBundleIdentifier -string "$BUNDLE_ID" "$STAGED_CONTENTS/Info.plist"
/usr/bin/plutil -replace CFBundleName -string "$APP_NAME" "$STAGED_CONTENTS/Info.plist"
/usr/bin/plutil -replace CFBundleShortVersionString -string "$APP_VERSION" "$STAGED_CONTENTS/Info.plist"
/usr/bin/plutil -replace CFBundleVersion -string "$APP_VERSION" "$STAGED_CONTENTS/Info.plist"
/usr/bin/plutil -replace CFBundleGetInfoString -string "$APP_COMMENTS" "$STAGED_CONTENTS/Info.plist"
/usr/bin/plutil -replace LSMinimumSystemVersion -string "$MIN_SYSTEM_VERSION" "$STAGED_CONTENTS/Info.plist"
/usr/bin/plutil -replace NSHumanReadableCopyright -string "$APP_COPYRIGHT" "$STAGED_CONTENTS/Info.plist"
/usr/bin/plutil -replace FHLDesktopUIVariant -string "$DESKTOP_UI_VARIANT" "$STAGED_CONTENTS/Info.plist"
/usr/bin/plutil -replace FHLVisualBaseline -string "$VISUAL_BASELINE" "$STAGED_CONTENTS/Info.plist"
/usr/bin/plutil -lint "$STAGED_CONTENTS/Info.plist" >/dev/null

/usr/bin/xattr -rc "$STAGED_APP"
/usr/bin/codesign \
  --force \
  --deep \
  --options runtime \
  --entitlements "$ENTITLEMENTS_PATH" \
  --sign - \
  --timestamp=none \
  "$STAGED_APP"
/usr/bin/codesign --verify --deep --strict --verbose=2 "$STAGED_APP"

if [[ -e "$APP_BUNDLE" || -L "$APP_BUNDLE" ]]; then
  /bin/rm -rf "$APP_BUNDLE"
fi
/usr/bin/ditto "$STAGED_APP" "$APP_BUNDLE"
/usr/bin/codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE"

echo "$APP_BUNDLE"
