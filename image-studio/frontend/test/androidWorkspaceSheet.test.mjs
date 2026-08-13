import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const appHeader = readFileSync(new URL("../src/components/layout/AppHeader.tsx", import.meta.url), "utf8");
const workspaceBar = readFileSync(new URL("../src/components/layout/WorkspaceBar.tsx", import.meta.url), "utf8");
const layoutCss = readFileSync(new URL("../src/styles/_layout.css", import.meta.url), "utf8");

test("Android header hides the mobile workspace tag system", () => {
  assert.match(workspaceBar, /if \(isAndroidPhone\) return null;/);
  assert.doesNotMatch(appHeader, /AndroidWorkspaceSheet/);
  assert.doesNotMatch(appHeader, /androidWorkspaceOpen/);
  assert.doesNotMatch(appHeader, /setAndroidWorkspaceOpen/);
  assert.doesNotMatch(appHeader, /data-audit-id="android-workspaces"/);
  assert.doesNotMatch(appHeader, /className="android-header-workspace-toggle"/);
});

test("Legacy Android workspace styles are no longer surfaced from header", () => {
  for (const className of [
    "android-header-workspace-toggle",
    "android-workspace-sheet-card",
    "android-workspace-sheet-body",
    "android-workspace-sheet-summary",
    "android-workspace-list",
    "android-workspace-item",
    "android-workspace-main",
    "android-workspace-row-actions",
    "android-workspace-new",
  ]) {
    assert.match(layoutCss, new RegExp(`\\.${className}`));
  }
  assert.match(layoutCss, /data-target-platform="android"[\s\S]*android-workspace-sheet/);
  assert.match(layoutCss, /data-target-platform="android-pad"[\s\S]*android-workspace-sheet/);
  assert.match(layoutCss, /android-workspace-main[\s\S]*min-height: 48px;/);
  assert.match(layoutCss, /android-workspace-row-actions button[\s\S]*width: 40px;[\s\S]*height: 40px;/);
});
