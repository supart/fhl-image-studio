import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const historyMenus = readFileSync(new URL("../src/components/history/historyMenus.ts", import.meta.url), "utf8");
const historyHook = readFileSync(new URL("../src/components/history/useHistoryContextMenu.ts", import.meta.url), "utf8");
const historyRail = readFileSync(new URL("../src/components/history/HistoryRail.tsx", import.meta.url), "utf8");
const timeline = readFileSync(new URL("../src/components/history/HistoryTimelineModal.tsx", import.meta.url), "utf8");
const androidActionSheet = readFileSync(new URL("../src/platform/android/history/AndroidHistoryActionSheet.tsx", import.meta.url), "utf8");
const contextMenu = readFileSync(new URL("../src/components/common/ContextMenu.tsx", import.meta.url), "utf8");

test("copy-image history actions use clipboard icons on Android and context menus", () => {
  assert.match(androidActionSheet, /label\.includes\("复制图片"\)[\s\S]*<Clipboard \/>/);
  assert.match(contextMenu, /label\.includes\("复制图片"\)[\s\S]*<Clipboard className=\{iconClass\} \/>/);
});

test("Android history menus can copy the full image directly", () => {
  assert.match(historyMenus, /onCopyImage: \(\) => void/);
  assert.match(historyMenus, /label: "复制图片"/);
  assert.match(historyMenus, /onClick: actions\.onCopyImage/);
  assert.match(historyMenus, /disabled: !\(item\.savedPath \|\| item\.imageB64 \|\| item\.fullUrl \|\| item\.imageId\)/);

  assert.match(historyHook, /onCopyImage: \(item: HistoryItem\) => void/);
  assert.match(historyHook, /onCopyImage: \(\) => onCopyImage\(item\)/);

  for (const source of [historyRail, timeline]) {
    assert.match(source, /copyImageURLToClipboard/);
    assert.match(source, /copyImageB64ToClipboard/);
    assert.match(source, /materializeCurrentImage\(item\)/);
    assert.match(source, /async function copyHistoryImage\(item: HistoryItem\)/);
    assert.match(source, /onCopyImage: \(item\) => \{ void copyHistoryImage\(item\); \}/);
    assert.match(source, /当前环境不支持复制图片，可改用分享或保存/);
  }
});
