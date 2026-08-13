import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const header = readFileSync(new URL("../src/components/layout/AppHeader.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../src/styles/_layout.css", import.meta.url), "utf8");

test("Android quick settings defaults expanded and persists only strict collapsed state", () => {
  assert.match(header, /storageKey\("gptcodex\.androidQuickSettingsCollapsed\.v1"\)/);
  assert.match(header, /localStorage\.getItem\(ANDROID_QUICK_SETTINGS_COLLAPSED_KEY\) === "1"/);
  assert.match(header, /catch \{\s*return false;\s*\}/);
  assert.match(header, /localStorage\.setItem\(ANDROID_QUICK_SETTINGS_COLLAPSED_KEY, "1"\)/);
  assert.match(header, /localStorage\.removeItem\(ANDROID_QUICK_SETTINGS_COLLAPSED_KEY\)/);
});

test("Android quick settings toggle is accessible, stable, and precedes Settings", () => {
  const toggleIndex = header.indexOf('data-audit-id="toggle-android-quick-settings"');
  const settingsIndex = header.indexOf('auditId="open-settings"');
  assert.ok(toggleIndex >= 0);
  assert.ok(settingsIndex > toggleIndex);
  assert.match(header, /\? "展开快速设置"\s*: "折叠快速设置"/);
  assert.match(header, /title=\{androidQuickSettingsToggleLabel\}/);
  assert.match(header, /aria-label=\{androidQuickSettingsToggleLabel\}/);
  assert.match(header, /aria-expanded=\{!androidQuickSettingsCollapsed\}/);
  assert.match(header, /aria-controls="android-header-quick-settings"/);
  assert.match(header, /androidQuickSettingsCollapsed\s*\? <ChevronDown[\s\S]*: <ChevronUp/);
});

test("collapsed quick settings are not rendered and synchronize a root data state", () => {
  assert.match(header, /root\.dataset\.androidQuickSettings = androidQuickSettingsCollapsed \? "collapsed" : "expanded"/);
  assert.match(header, /if \(!usesAndroidUI \|\| fullscreen\) \{/);
  assert.match(header, /\[androidQuickSettingsCollapsed, fullscreen, usesAndroidUI\]/);
  assert.match(header, /showAndroidConfigRow && !androidQuickSettingsCollapsed && \(/);
  assert.match(header, /id="android-header-quick-settings"/);
});

test("collapsed headers reclaim height without animating and preserve 360px truncation", () => {
  assert.match(layout, /\[data-target-platform="android"\]\[data-android-quick-settings="collapsed"\][^{]*\{\s*--android-header-visual-height: 40px;/s);
  assert.match(layout, /\[data-target-platform="android"\]\[data-android-quick-settings="collapsed"\] \.android-header-top-actions \.platform-icon-btn[^{]*\{[\s\S]*width: 34px;[\s\S]*height: 34px;/);
  assert.match(layout, /\[data-target-platform="android-pad"\]\[data-android-quick-settings="collapsed"\][^{]*\{\s*--android-header-visual-height: 60px;/s);
  assert.match(layout, /\[data-ui-family="android"\]\[data-android-quick-settings="collapsed"\] \.android-app-header[^{]*\{[\s\S]*grid-template-areas: "copy top";[\s\S]*row-gap: 0;/);
  assert.match(layout, /@media \(max-width: 360px\)[\s\S]*\.android-header-brand-button \{\s*overflow: hidden;/);
  assert.match(layout, /@media \(max-width: 360px\)[\s\S]*\.android-header-title-main \{[\s\S]*text-overflow: ellipsis;/);
  assert.match(layout, /\.android-header-quick-settings-toggle::after[\s\S]*content: attr\(aria-label\)/);
  assert.match(layout, /\.android-header-quick-settings-toggle:focus-visible::after[\s\S]*opacity: 1/);
});
