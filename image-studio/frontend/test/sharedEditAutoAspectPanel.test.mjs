import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const desktopSource = readFileSync(new URL("../src/components/panel/DesktopComposeSections.tsx", import.meta.url), "utf8");
const macSource = readFileSync(new URL("../src/components/panel/MacComposeStyleAndSize.tsx", import.meta.url), "utf8");
const batchSource = readFileSync(new URL("../src/components/panel/BatchProcessSection.tsx", import.meta.url), "utf8");
const controlPanelSource = readFileSync(new URL("../src/components/panel/ControlPanel.tsx", import.meta.url), "utf8");

test("shared auto-aspect controls live in the shared edit panels", () => {
  assert.match(desktopSource, /const showTopLevelAspectPicker = mode !== "edit";/);
  assert.match(desktopSource, /const showEditManualAspectPicker = mode === "edit" && batchProcess\.autoAspectResolution === "";/);
  assert.match(desktopSource, /showTopLevelAspectPicker \? \(\s*<Section label="比例">/s);
  assert.match(desktopSource, /showEditManualAspectPicker \? \(\s*<div className=\{`mt-3 border/s);
  assert.match(desktopSource, /只有在沿用当前尺寸时，才需要手动选择图生图使用的比例。/);

  assert.match(macSource, /const showTopLevelAspectPicker = mode !== "edit";/);
  assert.match(macSource, /const showEditManualAspectPicker = mode === "edit" && batchProcess\.autoAspectResolution === "";/);
  assert.match(macSource, /showTopLevelAspectPicker \? \(\s*<div>\s*<div className="mb-2 text-\[12px\] text-zinc-500">比例<\/div>/s);
  assert.match(macSource, /showEditManualAspectPicker \? \(\s*<div className="mt-3 rounded-\[16px\] border/s);
  assert.match(macSource, /当前 \{batchProcess\.autoAspectResolution\.toUpperCase\(\)\}/);
});

test("shared auto-aspect resolution routes through the top resolution control", () => {
  assert.match(desktopSource, /const resolutionOptions = RESOLUTION_PRESETS\.filter\(\(item\) => \(\s*availableResolutions\.includes\(item\.value\)\s*&& \(batchProcess\.autoAspectResolution === "" \|\| item\.value !== "auto"\)\s*\)\);/s);
  assert.match(macSource, /const resolutionOptions = RESOLUTION_PRESETS\.filter\(\(item\) => \(\s*availableResolutions\.includes\(item\.value\)\s*&& \(batchProcess\.autoAspectResolution === "" \|\| item\.value !== "auto"\)\s*\)\);/s);
  assert.match(controlPanelSource, /const activeResolution = mode === "edit" && batchProcess\.autoAspectResolution !== ""\s*\?\s*batchProcess\.autoAspectResolution\s*:\s*deriveResolutionPreset\(size\);/s);
  assert.match(controlPanelSource, /if \(mode === "edit" && batchProcess\.autoAspectResolution !== ""\) {\s*setField\("batchProcess", {\s*\.\.\.batchProcess,\s*autoAspectResolution: resolution === "auto" \? "" : resolution,\s*}\);\s*return;\s*}/s);
});

test("edit auto-aspect ratio controls appear before resolution and quality", () => {
  const desktopAutoAspectIndex = desktopSource.indexOf("autoAspectResolution: batchProcess.autoAspectResolution || DEFAULT_AUTO_ASPECT_RESOLUTION");
  const desktopResolutionIndex = desktopSource.indexOf("resolutionOptions.map");
  const desktopQualityIndex = desktopSource.indexOf("QUALITY_TIERS.map");
  assert.ok(desktopAutoAspectIndex >= 0, "desktop edit ratio policy should exist");
  assert.ok(desktopAutoAspectIndex < desktopResolutionIndex, "desktop ratio policy should be before resolution");
  assert.ok(desktopResolutionIndex < desktopQualityIndex, "desktop quality should stay after resolution");

  const macAutoAspectIndex = macSource.indexOf("autoAspectResolution: batchProcess.autoAspectResolution || DEFAULT_AUTO_ASPECT_RESOLUTION");
  const macResolutionIndex = macSource.indexOf("resolutionOptions.map");
  const macQualityIndex = macSource.indexOf("QUALITY_TIERS.map");
  assert.ok(macAutoAspectIndex >= 0, "mac edit ratio policy should exist");
  assert.ok(macAutoAspectIndex < macResolutionIndex, "mac ratio policy should be before resolution");
  assert.ok(macResolutionIndex < macQualityIndex, "mac quality should stay after resolution");
});

test("edit ratio policy toggle uses concise automatic and manual labels", () => {
  assert.match(desktopSource, /\\u81ea\\u52a8\\u9002\\u914d/);
  assert.match(desktopSource, /\\u624b\\u52a8\\u6bd4\\u4f8b/);
  assert.match(macSource, /\\u81ea\\u52a8\\u9002\\u914d/);
  assert.match(macSource, /\\u624b\\u52a8\\u6bd4\\u4f8b/);
});

test("batch process section no longer renders a second editable auto-aspect block", () => {
  assert.doesNotMatch(batchSource, /统一分辨率档位/);
  assert.doesNotMatch(batchSource, /按源图比例自动适配\n\s*<\/div>\n\s*<div className="mt-3">\n\s*<Seg>/);
});
