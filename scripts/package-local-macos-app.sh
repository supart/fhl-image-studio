#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="$ROOT_DIR/image-studio"
WAILS_CONFIG="$PROJECT_DIR/wails.json"
WAILS_META_FILE="$(mktemp "${TMPDIR:-/tmp}/image-studio.meta.XXXXXX")"
GO_COMPILER="${GO_COMPILER:-go}"

node -e '
  const fs = require("fs");
  const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const appName = cfg.info?.productName || cfg.name || "FHL Studio";
  const output = cfg.outputfilename || "image-studio";
  const version = cfg.info?.productVersion || "0.0.0";
  const bundleId = `com.wails.${cfg.name || output}`;
  const comments = cfg.info?.comments || "";
  const copyright = cfg.info?.copyright || "";
  console.log(appName);
  console.log(output);
  console.log(version);
  console.log(bundleId);
  console.log(comments);
  console.log(copyright);
' "$WAILS_CONFIG" >"$WAILS_META_FILE"

APP_NAME="$(sed -n '1p' "$WAILS_META_FILE")"
OUTPUT_FILENAME="$(sed -n '2p' "$WAILS_META_FILE")"
APP_VERSION="$(sed -n '3p' "$WAILS_META_FILE")"
BUNDLE_ID="top.fangtangyuan.fhlstudio"
APP_COMMENTS="$(sed -n '5p' "$WAILS_META_FILE")"
APP_COPYRIGHT="$(sed -n '6p' "$WAILS_META_FILE")"
CLIENT_VERSION_LDFLAG="${CLIENT_VERSION_LDFLAG:--X github.com/yuanhua/image-gptcodex/pkg/client.Version=${VITE_APP_VERSION:-$APP_VERSION}}"

APP_BUNDLE="$PROJECT_DIR/build/bin/${APP_NAME}.app"
EXECUTABLE_SRC="$PROJECT_DIR/build/bin/${OUTPUT_FILENAME}"
EXECUTABLE_ARM64="$PROJECT_DIR/build/bin/${OUTPUT_FILENAME}-arm64"
EXECUTABLE_AMD64="$PROJECT_DIR/build/bin/${OUTPUT_FILENAME}-amd64"
EXECUTABLE_DST="$APP_BUNDLE/Contents/MacOS/${OUTPUT_FILENAME}"
RESOURCES_DIR="$APP_BUNDLE/Contents/Resources"
PLIST_PATH="$APP_BUNDLE/Contents/Info.plist"
ICON_SRC="$PROJECT_DIR/build/appicon.png"
ICON_ENCODER_DIR="$(mktemp -d "${TMPDIR:-/tmp}/fhl-studio-icns.XXXXXX")"
ICON_ENCODER="$ICON_ENCODER_DIR/make-icns.go"

cleanup() {
  rm -f "$WAILS_META_FILE"
  rm -rf "$ICON_ENCODER_DIR"
}
trap cleanup EXIT

ensure_frontend_deps() {
  if [[ -d "$PROJECT_DIR/frontend/node_modules" ]]; then
    return
  fi
  echo "frontend/node_modules missing; running npm ci" >&2
  (
    cd "$PROJECT_DIR/frontend"
    npm ci
  )
}

if [[ ! -f "$ICON_SRC" ]]; then
  echo "missing icon source: $ICON_SRC" >&2
  exit 1
fi

ensure_frontend_deps

(
  cd "$PROJECT_DIR/frontend"
  npm run build:macos
)

perl -0pi -e 's/[ \t]+\n/\n/g; s/\n+\z/\n/' "$PROJECT_DIR/frontend/wailsjs/go/models.ts"

mkdir -p "$PROJECT_DIR/build/bin"
rm -f "$EXECUTABLE_ARM64" "$EXECUTABLE_AMD64" "$EXECUTABLE_SRC"

(
  cd "$PROJECT_DIR"
  GOPATH="$ROOT_DIR/.gopath" \
  GOMODCACHE="$ROOT_DIR/.gomodcache" \
  GOCACHE="$ROOT_DIR/.gocache" \
  GOOS=darwin \
  GOARCH=arm64 \
  CGO_ENABLED=1 \
  CC='clang -arch arm64' \
  CXX='clang++ -arch arm64' \
  CGO_CFLAGS="-mmacosx-version-min=10.13" \
  CGO_CXXFLAGS="-I$PROJECT_DIR/build" \
  CGO_LDFLAGS="-framework UniformTypeIdentifiers -mmacosx-version-min=10.13" \
  "$GO_COMPILER" build -buildvcs=false -tags 'desktop,wv2runtime.download,production' -ldflags "-w -s ${CLIENT_VERSION_LDFLAG}" -o "$EXECUTABLE_ARM64" .
)

(
  cd "$PROJECT_DIR"
  GOPATH="$ROOT_DIR/.gopath" \
  GOMODCACHE="$ROOT_DIR/.gomodcache" \
  GOCACHE="$ROOT_DIR/.gocache" \
  GOOS=darwin \
  GOARCH=amd64 \
  CGO_ENABLED=1 \
  CC='clang -arch x86_64' \
  CXX='clang++ -arch x86_64' \
  CGO_CFLAGS="-mmacosx-version-min=10.13" \
  CGO_CXXFLAGS="-I$PROJECT_DIR/build" \
  CGO_LDFLAGS="-framework UniformTypeIdentifiers -mmacosx-version-min=10.13" \
  "$GO_COMPILER" build -buildvcs=false -tags 'desktop,wv2runtime.download,production' -ldflags "-w -s ${CLIENT_VERSION_LDFLAG}" -o "$EXECUTABLE_AMD64" .
)

/usr/bin/lipo -create -output "$EXECUTABLE_SRC" "$EXECUTABLE_ARM64" "$EXECUTABLE_AMD64"
rm -f "$EXECUTABLE_ARM64" "$EXECUTABLE_AMD64"

rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$RESOURCES_DIR"
cp "$EXECUTABLE_SRC" "$EXECUTABLE_DST"

cat >"$ICON_ENCODER" <<'EOF'
package main

import (
  "image/png"
  "os"

  "github.com/jackmordaunt/icns"
)

func main() {
  if len(os.Args) != 3 {
    panic("usage: make-icns <src.png> <dest.icns>")
  }
  src, err := os.Open(os.Args[1])
  if err != nil {
    panic(err)
  }
  defer src.Close()

  img, err := png.Decode(src)
  if err != nil {
    panic(err)
  }

  dest, err := os.Create(os.Args[2])
  if err != nil {
    panic(err)
  }
  defer dest.Close()

  if err := icns.Encode(dest, img); err != nil {
    panic(err)
  }
}
EOF
(
  cd "$PROJECT_DIR"
  GOPATH="$ROOT_DIR/.gopath" \
  GOMODCACHE="$ROOT_DIR/.gomodcache" \
  GOCACHE="$ROOT_DIR/.gocache" \
  go run "$ICON_ENCODER" "$ICON_SRC" "$RESOURCES_DIR/iconfile.icns"
)

cat >"$PLIST_PATH" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleName</key>
    <string>__APP_NAME__</string>
    <key>CFBundleExecutable</key>
    <string>__OUTPUT_FILENAME__</string>
    <key>CFBundleIdentifier</key>
    <string>__BUNDLE_ID__</string>
    <key>CFBundleVersion</key>
    <string>__APP_VERSION__</string>
    <key>CFBundleGetInfoString</key>
    <string>__APP_COMMENTS__</string>
    <key>CFBundleShortVersionString</key>
    <string>__APP_VERSION__</string>
    <key>CFBundleIconFile</key>
    <string>iconfile</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.13.0</string>
    <key>NSHighResolutionCapable</key>
    <string>true</string>
    <key>NSHumanReadableCopyright</key>
    <string>__APP_COPYRIGHT__</string>
  </dict>
</plist>
EOF

python3 - <<'PY' "$PLIST_PATH" "$APP_NAME" "$OUTPUT_FILENAME" "$BUNDLE_ID" "$APP_VERSION" "$APP_COMMENTS" "$APP_COPYRIGHT"
from pathlib import Path
import sys

plist_path, app_name, output_filename, bundle_id, app_version, app_comments, app_copyright = sys.argv[1:]
content = Path(plist_path).read_text()
replacements = {
    "__APP_NAME__": app_name,
    "__OUTPUT_FILENAME__": output_filename,
    "__BUNDLE_ID__": bundle_id,
    "__APP_VERSION__": app_version,
    "__APP_COMMENTS__": app_comments,
    "__APP_COPYRIGHT__": app_copyright,
}
for key, value in replacements.items():
    content = content.replace(key, value)
Path(plist_path).write_text(content)
PY

chmod +x "$EXECUTABLE_DST"
/usr/bin/xattr -rc "$APP_BUNDLE"
/usr/bin/codesign --force --deep --sign - "$APP_BUNDLE" >/dev/null
echo "$APP_BUNDLE"
