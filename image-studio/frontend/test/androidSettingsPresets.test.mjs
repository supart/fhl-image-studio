import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const androidSettings = readFileSync(new URL("../src/platform/android/settings/AndroidSettingsPanel.tsx", import.meta.url), "utf8");
const androidPresets = readFileSync(new URL("../src/platform/android/settings/AndroidSettingsPresetsRow.tsx", import.meta.url), "utf8");
const desktopPresets = readFileSync(new URL("../src/components/panel/SettingsPresetsRow.tsx", import.meta.url), "utf8");
const androidSettingsCss = readFileSync(new URL("../src/styles/_android-settings.css", import.meta.url), "utf8");

test("Android settings uses mobile preset editor instead of browser prompt", () => {
  assert.match(androidSettings, /AndroidSettingsPresetsRow/);
  assert.doesNotMatch(androidSettings, /components\/panel\/SettingsPresetsRow/);
  assert.doesNotMatch(androidSettings, /<SettingsPresetsRow/);
  assert.match(androidPresets, /placeholder="给当前参数起个名字"/);
  assert.match(androidPresets, /onKeyDown=\{\(event\) => \{/);
  assert.match(androidPresets, /if \(event\.key === "Enter"\) handleSave\(\);/);
  assert.match(androidPresets, /savePreset\(trimmedName\);/);
  assert.doesNotMatch(androidPresets, /\bprompt\(/);
});

test("Desktop preset row keeps its existing prompt save flow", () => {
  assert.match(desktopPresets, /prompt\("预设名:"\)/);
});

test("Android preset editor has mobile-scoped layout styles", () => {
  assert.match(androidSettingsCss, /\.android-settings-presets-row/);
  assert.match(androidSettingsCss, /\.android-settings-preset-save/);
  assert.match(androidSettingsCss, /\.android-settings-preset-item/);
  assert.match(androidSettingsCss, /data-target-platform="android-pad"[\s\S]*android-settings-preset-save/);
});
