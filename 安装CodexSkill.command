#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_PATH="$SCRIPT_DIR/FHL Studio.app"
if [[ ! -d "$APP_PATH" ]]; then
  APP_PATH="/Applications/FHL Studio.app"
fi
CLI_SOURCE="$APP_PATH/Contents/Resources/runtime/cli/gptcodex-image"
if [[ ! -x "$CLI_SOURCE" ]]; then
  echo "[FHL Studio] 未找到 Mac CLI，请先将 FHL Studio.app 拖入 Applications。" >&2
  exit 1
fi

CODEX_ROOT="${CODEX_HOME:-$HOME/.codex}"
SKILL_DIR="$CODEX_ROOT/skills/fhl-image-studio-v2-0-3"
PACKAGE_ROOT="$HOME/Library/Application Support/fhl-studio/codex-package"

mkdir -p "$SKILL_DIR" "$PACKAGE_ROOT/runtime/cli" "$PACKAGE_ROOT/config"
ditto "$CLI_SOURCE" "$PACKAGE_ROOT/runtime/cli/gptcodex-image"
ditto "$SCRIPT_DIR/image-cli" "$PACKAGE_ROOT/image-cli"
ditto "$SCRIPT_DIR/SKILL.md" "$SKILL_DIR/SKILL.md"
if [[ -f "$SCRIPT_DIR/AGENTS.md" ]]; then
  ditto "$SCRIPT_DIR/AGENTS.md" "$PACKAGE_ROOT/AGENTS.md"
fi
if [[ -f "$SCRIPT_DIR/config/cli.env.example" ]]; then
  ditto "$SCRIPT_DIR/config/cli.env.example" "$PACKAGE_ROOT/config/cli.env.example"
fi
printf '%s\n' "$PACKAGE_ROOT" > "$SKILL_DIR/PACKAGE_ROOT.txt"
chmod 700 "$PACKAGE_ROOT" "$PACKAGE_ROOT/runtime" "$PACKAGE_ROOT/runtime/cli"
chmod 755 "$PACKAGE_ROOT/image-cli" "$PACKAGE_ROOT/runtime/cli/gptcodex-image"
chmod 600 "$SKILL_DIR/PACKAGE_ROOT.txt"

echo "[FHL Studio] Codex Skill 已安装：$SKILL_DIR"
echo "[FHL Studio] CLI 包目录：$PACKAGE_ROOT"
echo "[FHL Studio] API Key 不会写入 Skill 目录。"

if [[ "${FHL_INSTALL_NONINTERACTIVE:-0}" != "1" ]]; then
  read -r -p "按回车键关闭窗口..." _
fi
