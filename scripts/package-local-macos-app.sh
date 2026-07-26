#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="$ROOT_DIR/image-studio"
OUTPUT_ROOT="${1:-${OUTPUT_ROOT:-$ROOT_DIR/release-assets}}"
VERSION="2.0.3"
APP_NAME="FHL Studio"
APP_BUNDLE="$PROJECT_DIR/build/bin/$APP_NAME.app"
WAILS_APP_BUNDLE="$PROJECT_DIR/build/bin/fhl-studio.app"
ENTITLEMENTS_PATH="$PROJECT_DIR/build/darwin/entitlements.plist"
DMG_NAME="FHL-Image-Studio-Desktop-V2.0.3-macOS-AppleSilicon.dmg"
DMG_PATH="$OUTPUT_ROOT/$DMG_NAME"
TOOLS_DIR="${FHL_BUILD_TOOLS_DIR:-$ROOT_DIR/.build-tools}"
WAILS_BIN="${WAILS_BIN:-$TOOLS_DIR/wails}"
WAILS_VERSION="v2.12.0"

export GOTOOLCHAIN="local"
export MACOSX_DEPLOYMENT_TARGET="13.0"
export VITE_TARGET_PLATFORM="macos"
export VITE_DESKTOP_UI_VARIANT="windows-parity"
export VITE_APP_VERSION="$VERSION"
export IMAGE_STUDIO_PRODUCT_VERSION="$VERSION"
export IMAGE_STUDIO_FRONTEND_VERSION="$VERSION"
export IMAGE_STUDIO_STORAGE_NAMESPACE="fhl-image-studio-desktop"

mkdir -p "$OUTPUT_ROOT" "$TOOLS_DIR"

if [[ ! -f "$ENTITLEMENTS_PATH" ]]; then
  echo "[FHL macOS] Missing hardened runtime entitlements: $ENTITLEMENTS_PATH" >&2
  exit 1
fi
plutil -lint "$ENTITLEMENTS_PATH" >/dev/null

CURRENT_NODE="$(node --version)"
if [[ "${FHL_REQUIRE_EXACT_TOOLCHAIN:-0}" == "1" && "$CURRENT_NODE" != "v24.13.1" ]]; then
  echo "[FHL macOS] Expected Node v24.13.1, found $CURRENT_NODE" >&2
  exit 1
fi
if [[ "$CURRENT_NODE" != v24.* ]]; then
  echo "[FHL macOS] Node 24.x is required, found $CURRENT_NODE" >&2
  exit 1
fi
echo "[FHL macOS] Using Node $CURRENT_NODE (release CI pins v24.13.1)" >&2

CURRENT_GO="$(go env GOVERSION)"
if [[ "${FHL_REQUIRE_EXACT_TOOLCHAIN:-0}" == "1" && "$CURRENT_GO" != "go1.26.3" ]]; then
  echo "[FHL macOS] Expected Go 1.26.3, found $CURRENT_GO" >&2
  exit 1
fi
if [[ "$CURRENT_GO" != go1.26.* ]]; then
  echo "[FHL macOS] Go 1.26.x is required, found $CURRENT_GO" >&2
  exit 1
fi
echo "[FHL macOS] Using $CURRENT_GO (release CI pins go1.26.3)" >&2

USE_WAILS_CLI=1
if [[ ! -x "$WAILS_BIN" ]] || ! "$WAILS_BIN" version 2>/dev/null | grep -Eq 'v?2\.12\.0([^0-9]|$)'; then
  if [[ "${FHL_SKIP_WAILS_INSTALL:-0}" == "1" ]]; then
    USE_WAILS_CLI=0
  else
    echo "[FHL macOS] Installing Wails $WAILS_VERSION into $TOOLS_DIR" >&2
    if ! GOBIN="$TOOLS_DIR" go install "github.com/wailsapp/wails/v2/cmd/wails@$WAILS_VERSION"; then
      echo "[FHL macOS] Wails CLI install unavailable; using the equivalent direct bundle build" >&2
      USE_WAILS_CLI=0
    fi
  fi
fi

if [[ "$USE_WAILS_CLI" == "1" ]]; then
  echo "[FHL macOS] Building Apple Silicon application with Wails $WAILS_VERSION" >&2
  (
    cd "$PROJECT_DIR"
    CGO_ENABLED=1 \
    GOOS=darwin \
    GOARCH=arm64 \
    CGO_CFLAGS="-mmacosx-version-min=13.0" \
    CGO_LDFLAGS="-mmacosx-version-min=13.0" \
    "$WAILS_BIN" build \
      -platform darwin/arm64 \
      -clean \
      -o "$APP_NAME" \
      -ldflags "-s -w -X github.com/yuanhua/image-gptcodex/pkg/client.Version=$VERSION"
  )

  if [[ ! -d "$WAILS_APP_BUNDLE" ]]; then
    echo "[FHL macOS] Missing Wails app bundle: $WAILS_APP_BUNDLE" >&2
    exit 1
  fi
  rm -rf "$APP_BUNDLE"
  mv "$WAILS_APP_BUNDLE" "$APP_BUNDLE"

  GENERATED_EXECUTABLES=("$APP_BUNDLE"/Contents/MacOS/*)
  if [[ "${#GENERATED_EXECUTABLES[@]}" != "1" || ! -f "${GENERATED_EXECUTABLES[0]}" ]]; then
    echo "[FHL macOS] Expected exactly one Wails executable in $APP_BUNDLE/Contents/MacOS" >&2
    exit 1
  fi
  if [[ "${GENERATED_EXECUTABLES[0]}" != "$APP_BUNDLE/Contents/MacOS/$APP_NAME" ]]; then
    mv "${GENERATED_EXECUTABLES[0]}" "$APP_BUNDLE/Contents/MacOS/$APP_NAME"
  fi
else
  echo "[FHL macOS] Building Apple Silicon application directly from the pinned Wails module" >&2
  (
    cd "$PROJECT_DIR/frontend"
    npm ci
    npm run build:macos
  )
  rm -rf "$APP_BUNDLE"
  mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources"
  (
    cd "$PROJECT_DIR"
    CGO_ENABLED=1 \
    GOOS=darwin \
    GOARCH=arm64 \
    CGO_CFLAGS="-mmacosx-version-min=13.0" \
    CGO_LDFLAGS="-mmacosx-version-min=13.0" \
    go build \
      -trimpath \
      -buildvcs=false \
      -tags "desktop,production" \
      -ldflags "-s -w -X github.com/yuanhua/image-gptcodex/pkg/client.Version=$VERSION" \
      -o "$APP_BUNDLE/Contents/MacOS/$APP_NAME" \
      .
  )
  ditto "$PROJECT_DIR/build/darwin/Info.plist" "$APP_BUNDLE/Contents/Info.plist"
  ICONSET_DIR="$PROJECT_DIR/build/bin/FHLStudio.iconset"
  rm -rf "$ICONSET_DIR"
  mkdir -p "$ICONSET_DIR"
  sips -z 16 16 "$PROJECT_DIR/build/appicon.png" --out "$ICONSET_DIR/icon_16x16.png" >/dev/null
  sips -z 32 32 "$PROJECT_DIR/build/appicon.png" --out "$ICONSET_DIR/icon_16x16@2x.png" >/dev/null
  sips -z 32 32 "$PROJECT_DIR/build/appicon.png" --out "$ICONSET_DIR/icon_32x32.png" >/dev/null
  sips -z 64 64 "$PROJECT_DIR/build/appicon.png" --out "$ICONSET_DIR/icon_32x32@2x.png" >/dev/null
  sips -z 128 128 "$PROJECT_DIR/build/appicon.png" --out "$ICONSET_DIR/icon_128x128.png" >/dev/null
  sips -z 256 256 "$PROJECT_DIR/build/appicon.png" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null
  sips -z 256 256 "$PROJECT_DIR/build/appicon.png" --out "$ICONSET_DIR/icon_256x256.png" >/dev/null
  sips -z 512 512 "$PROJECT_DIR/build/appicon.png" --out "$ICONSET_DIR/icon_256x256@2x.png" >/dev/null
  sips -z 512 512 "$PROJECT_DIR/build/appicon.png" --out "$ICONSET_DIR/icon_512x512.png" >/dev/null
  sips -z 1024 1024 "$PROJECT_DIR/build/appicon.png" --out "$ICONSET_DIR/icon_512x512@2x.png" >/dev/null
  iconutil -c icns "$ICONSET_DIR" -o "$APP_BUNDLE/Contents/Resources/iconfile.icns"
  rm -rf "$ICONSET_DIR"
fi

if [[ ! -d "$APP_BUNDLE" ]]; then
  echo "[FHL macOS] Missing app bundle: $APP_BUNDLE" >&2
  exit 1
fi

PLIST_PATH="$APP_BUNDLE/Contents/Info.plist"
plutil -replace CFBundleExecutable -string "$APP_NAME" "$PLIST_PATH"
plutil -replace CFBundleIdentifier -string "top.fangtangyuan.fhlstudio" "$PLIST_PATH"
plutil -replace CFBundleDisplayName -string "$APP_NAME" "$PLIST_PATH"
plutil -replace CFBundleName -string "$APP_NAME" "$PLIST_PATH"
plutil -replace CFBundleShortVersionString -string "$VERSION" "$PLIST_PATH"
plutil -replace CFBundleVersion -string "203" "$PLIST_PATH"
plutil -replace LSMinimumSystemVersion -string "13.0" "$PLIST_PATH"
plutil -replace LSApplicationCategoryType -string "public.app-category.graphics-design" "$PLIST_PATH"
plutil -replace NSHighResolutionCapable -bool YES "$PLIST_PATH"
if ! plutil -extract NSAppTransportSecurity xml1 -o - "$PLIST_PATH" >/dev/null 2>&1; then
  plutil -insert NSAppTransportSecurity -xml '<dict><key>NSAllowsLocalNetworking</key><true/></dict>' "$PLIST_PATH"
fi

RESOURCES_DIR="$APP_BUNDLE/Contents/Resources"
CLI_DIR="$RESOURCES_DIR/runtime/cli"
mkdir -p "$CLI_DIR" "$RESOURCES_DIR/config"

echo "[FHL macOS] Building bundled arm64 CLI" >&2
(
  cd "$ROOT_DIR/go-cli"
  CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build \
    -trimpath \
    -buildvcs=false \
    -ldflags "-s -w -X github.com/yuanhua/image-gptcodex/pkg/client.Version=$VERSION" \
    -o "$CLI_DIR/gptcodex-image" \
    ./cmd/gptcodex-image
)

ditto "$ROOT_DIR/image-cli" "$RESOURCES_DIR/image-cli"
ditto "$ROOT_DIR/SKILL.md" "$RESOURCES_DIR/SKILL.md"
ditto "$ROOT_DIR/AGENTS.md" "$RESOURCES_DIR/AGENTS.md"
ditto "$ROOT_DIR/README_MACOS.md" "$RESOURCES_DIR/README_MACOS.md"
ditto "$ROOT_DIR/config/cli.env.example" "$RESOURCES_DIR/config/cli.env.example"
chmod 755 "$CLI_DIR/gptcodex-image" "$RESOURCES_DIR/image-cli"

xattr -cr "$APP_BUNDLE"
codesign --force --sign - --timestamp=none "$CLI_DIR/gptcodex-image"
codesign --force --deep --options runtime --entitlements "$ENTITLEMENTS_PATH" --sign - --timestamp=none "$APP_BUNDLE"
codesign --verify --deep --strict "$APP_BUNDLE"

STAGE_DIR="$OUTPUT_ROOT/.fhl-macos-dmg-stage"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR/config"
ditto "$APP_BUNDLE" "$STAGE_DIR/$APP_NAME.app"
ditto "$ROOT_DIR/image-cli" "$STAGE_DIR/image-cli"
ditto "$ROOT_DIR/安装CodexSkill.command" "$STAGE_DIR/安装CodexSkill.command"
ditto "$ROOT_DIR/SKILL.md" "$STAGE_DIR/SKILL.md"
ditto "$ROOT_DIR/AGENTS.md" "$STAGE_DIR/AGENTS.md"
ditto "$ROOT_DIR/README_MACOS.md" "$STAGE_DIR/README_MACOS.md"
ditto "$ROOT_DIR/config/cli.env.example" "$STAGE_DIR/config/cli.env.example"
chmod 755 "$STAGE_DIR/image-cli" "$STAGE_DIR/安装CodexSkill.command"
ln -s /Applications "$STAGE_DIR/Applications"

rm -f "$DMG_PATH"
hdiutil create \
  -volname "FHL Studio V$VERSION" \
  -srcfolder "$STAGE_DIR" \
  -ov \
  -format UDZO \
  "$DMG_PATH" >/dev/null
hdiutil verify "$DMG_PATH" >/dev/null
rm -rf "$STAGE_DIR"

echo "$APP_BUNDLE"
echo "$DMG_PATH"
