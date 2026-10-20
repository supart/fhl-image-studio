#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
if [[ "$#" -gt 1 ]]; then
  echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
  exit 2
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
WAILS_CONFIG="$ROOT_DIR/image-studio/wails.json"
PACKAGE_SCRIPT="$ROOT_DIR/scripts/package-local-macos-app.sh"
VERIFY_SCRIPT="$ROOT_DIR/scripts/verify-local-macos-release.mjs"
ENTITLEMENTS_PATH="$ROOT_DIR/image-studio/build/darwin/entitlements.plist"
BUNDLE_ID="top.fangtangyuan.fhlstudio"
DEBUG_ENTITLEMENTS=""

export VITE_DESKTOP_UI_VARIANT="windows-parity"

cleanup() {
  if [[ -n "$DEBUG_ENTITLEMENTS" && -f "$DEBUG_ENTITLEMENTS" ]]; then
    /bin/rm -f "$DEBUG_ENTITLEMENTS"
  fi
}
trap cleanup EXIT

APP_NAME="$(node -e '
  const fs = require("fs");
  const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(String(cfg.info?.productName || ""));
' "$WAILS_CONFIG")"
OUTPUT_FILENAME="$(node -e '
  const fs = require("fs");
  const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(String(cfg.outputfilename || ""));
' "$WAILS_CONFIG")"

if [[ -z "$APP_NAME" || -z "$OUTPUT_FILENAME" ]]; then
  echo "wails.json must define info.productName and outputfilename" >&2
  exit 1
fi

APP_BUNDLE="$ROOT_DIR/image-studio/build/bin/${APP_NAME}.app"
EXPECTED_APP_BUNDLE="$ROOT_DIR/image-studio/build/bin/FHL Studio.app"
APP_EXECUTABLE="$APP_BUNDLE/Contents/MacOS/$OUTPUT_FILENAME"

if [[ "$APP_BUNDLE" != "$EXPECTED_APP_BUNDLE" ]]; then
  echo "refusing to run unexpected app bundle: $APP_BUNDLE" >&2
  exit 1
fi

usage() {
  echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
}

find_running_pids() {
  /bin/ps -axo pid=,command= | /usr/bin/awk -v executable="$APP_EXECUTABLE" '
    {
      pid = $1
      sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "", $0)
      if ($0 == executable) {
        print pid
      }
    }
  '
}

stop_running_app() {
  local pids
  pids="$(find_running_pids)"
  if [[ -z "$pids" ]]; then
    return
  fi

  echo "[FHL macOS] Stopping the existing app process" >&2
  /bin/kill $pids >/dev/null 2>&1 || true
  local attempt
  for attempt in 1 2 3 4 5; do
    if [[ -z "$(find_running_pids)" ]]; then
      return
    fi
    sleep 1
  done

  pids="$(find_running_pids)"
  if [[ -n "$pids" ]]; then
    /bin/kill -KILL $pids >/dev/null 2>&1 || true
  fi
}

wait_for_process() {
  local attempt
  local pid
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    pid="$(find_running_pids | sed -n '1p')"
    if [[ -n "$pid" ]]; then
      printf '%s\n' "$pid"
      return 0
    fi
    sleep 1
  done
  return 1
}

launch_app() {
  /usr/bin/open -n "$APP_BUNDLE"
}

prepare_debug_signature() {
  DEBUG_ENTITLEMENTS="$(mktemp "${TMPDIR:-/tmp}/fhl-studio-debug-entitlements.XXXXXX")"
  /usr/bin/ditto "$ENTITLEMENTS_PATH" "$DEBUG_ENTITLEMENTS"
  /usr/libexec/PlistBuddy \
    -c 'Add :com.apple.security.get-task-allow bool true' \
    "$DEBUG_ENTITLEMENTS"
  /usr/bin/codesign \
    --force \
    --deep \
    --options runtime \
    --entitlements "$DEBUG_ENTITLEMENTS" \
    --sign - \
    --timestamp=none \
    "$APP_BUNDLE"
  /usr/bin/codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE"
  /bin/rm -f "$DEBUG_ENTITLEMENTS"
  DEBUG_ENTITLEMENTS=""
}

case "$MODE" in
  run|--debug|debug|--logs|logs|--telemetry|telemetry|--verify|verify)
    ;;
  *)
    usage
    exit 2
    ;;
esac

stop_running_app
bash "$PACKAGE_SCRIPT"
if [[ "$MODE" == "--debug" || "$MODE" == "debug" ]]; then
  prepare_debug_signature
fi
launch_app

APP_PID="$(wait_for_process || true)"
if [[ -z "$APP_PID" ]]; then
  echo "app did not start from bundle: $APP_BUNDLE" >&2
  exit 1
fi
echo "[FHL macOS] Launched $APP_NAME (pid $APP_PID)" >&2

case "$MODE" in
  run)
    ;;
  --debug|debug)
    LLDB_BIN="$(xcrun --find lldb)"
    exec "$LLDB_BIN" -p "$APP_PID"
    ;;
  --logs|logs)
    exec /usr/bin/log stream \
      --info \
      --style compact \
      --predicate "process == \"$OUTPUT_FILENAME\""
    ;;
  --telemetry|telemetry)
    exec /usr/bin/log stream \
      --info \
      --style compact \
      --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  --verify|verify)
    node "$VERIFY_SCRIPT"
    echo "[FHL macOS] Process and app bundle verification passed" >&2
    ;;
esac
