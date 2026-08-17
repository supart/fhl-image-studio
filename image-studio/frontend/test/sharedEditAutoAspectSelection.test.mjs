import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sharedSource = readFileSync(new URL("../src/state/sharedEditAutoAspect.ts", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
const imageActionsSource = readFileSync(new URL("../src/state/studioStore.images.ts", import.meta.url), "utf8");
const autoAspectSizingSource = readFileSync(new URL("../src/state/autoAspectSizing.ts", import.meta.url), "utf8");

test("shared edit auto-aspect uses the first reference slot in batch mode", () => {
  assert.match(sharedSource, /workspace\.editSourceMode !== "manual" && workspace\.editSourceMode !== "batch"/);
  assert.match(sharedSource, /workspace\.editSourceMode === "manual" && workspace\.editAutoAspectUserLocked === true/);
  assert.match(sharedSource, /function firstSelectedBatchSource\(sources: BatchProcessSourceImage\[\]\): BatchProcessSourceImage \| null \{/);
  assert.match(sharedSource, /source\.selected !== false && String\(source\.path \|\| ""\)\.trim\(\)/);
  assert.match(sharedSource, /const batchSourceSlotIndex = normalizedReferenceSlotIndex\([\s\S]*?workspace\.batchProcess\.batchSourceSlotIndex,[\s\S]*?workspace\.sources\.length,[\s\S]*?\);/s);
  assert.match(sharedSource, /if \(batchSourceSlotIndex === 0\) \{\s*return firstSelectedBatchSource\(workspace\.batchProcess\.discoveredSources\) \?\? workspace\.sources\[0\] \?\? null;\s*\}/s);
  assert.match(sharedSource, /normalizedReferenceSlotIndex/);
  assert.doesNotMatch(sharedSource, /\? batchSource\s*:\s*\(workspace\.sources\[0\] \?\? batchSource\)/s);
  assert.match(sharedSource, /function currentImageAutoAspectSource\(/);
  assert.match(sharedSource, /return workspace\.sources\[0\][\s\S]*?\?\? firstSelectedBatchSource\(workspace\.batchProcess\.discoveredSources\)[\s\S]*?\?\? currentImageAutoAspectSource\(currentImage\);/s);
  assert.match(sharedSource, /const primarySource = autoAspectSourceForWorkspace\(workspace, before\.currentImage\);/);
  assert.match(sharedSource, /const currentPrimarySource = autoAspectSourceForWorkspace\(currentWorkspace, after\.currentImage\);/);
  assert.match(sharedSource, /const livePrimarySource = autoAspectSourceForWorkspace\(liveWorkspace, state\.currentImage\);/);
});

test("batch auto-aspect uses preview dimensions and the current batch source slot", () => {
  assert.match(autoAspectSizingSource, /export function sourceDimensionsFromMetadata/);
  assert.match(autoAspectSizingSource, /export function autoAspectSizeInputFromState/);
  assert.match(autoAspectSizingSource, /dimensionsFromValues\(source\.width, source\.height\)\s*\?\?\s*dimensionsFromValues\(source\.previewWidth, source\.previewHeight\)/s);
  assert.match(storeSource, /sourceDimensionsFromMetadata\(source\)/);
  assert.match(storeSource, /batchReferenceOrderAutoAspectSource\(\s*batchFixedSources,\s*batchSelectedSources\[index\],\s*batchSourceSlotIndex,\s*\)/s);
  assert.match(storeSource, /const firstSlotIsBatchSource = normalizedReferenceSlotIndex\(batchSourceSlotIndex, fixedSources\.length\) === 0;/);
  assert.match(storeSource, /const firstFixedSource = fixedSources\[0\] \?\? null;/);
  assert.match(storeSource, /return \{ source: batchSource, label: "\\u7b2c1\\u683c\\u6279\\u91cf\\u6e90\\u56fe" \};/);
  assert.match(storeSource, /return \{ source: firstFixedSource, label: "\\u7b2c1\\u683c\\u53c2\\u8003\\u56fe" \};/);
  assert.match(storeSource, /buildAutoAspectSizeForSource\(editAutoAspectResolution, autoAspectSource\.source, autoAspectInput\)/);
  assert.match(storeSource, /\$\{autoAspectSource\.label\}/);
  assert.doesNotMatch(storeSource, /buildAutoAspectSizeFromDimensions\([\s\S]*?\)\s*\?\?\s*"1024x1024"/);
  assert.match(storeSource, /getImageDimensionsFromBase64\(imageB64\)/);
});

test("batch source changes resync the shared auto-aspect preview size", () => {
  assert.match(storeSource, /\(normalizedValue as EditSourceMode\) === "manual" \|\| \(normalizedValue as EditSourceMode\) === "batch"/);
  assert.match(storeSource, /stateBefore\.mode === "edit" && stateBefore\.editSourceMode === "batch"[\s\S]*?syncSharedEditAutoAspect\(\{ getState: get, setState: set \}\)/);
  assert.match(storeSource, /restoredActiveWorkspace\.mode === "edit"[\s\S]*?syncSharedEditAutoAspect\(\{ getState: get, setState: set \}\)/);
  assert.match(storeSource, /editAutoAspectUserLocked: restoredActiveWorkspace\.editAutoAspectUserLocked === true,/);
  assert.match(imageActionsSource, /async selectBatchInputDir\(\)[\s\S]*?void syncSharedEditAutoAspect\(store\);/s);
  assert.match(imageActionsSource, /async selectBatchInputFiles\(\)[\s\S]*?void syncSharedEditAutoAspect\(store\);/s);
  assert.match(imageActionsSource, /async refreshBatchInputDir\(\)[\s\S]*?void syncSharedEditAutoAspect\(store\);/s);
});

test("submit respects the edit auto-aspect lock and only stores auto-aspect retries when auto mode is active", () => {
  assert.match(storeSource, /const editAutoAspectUserLocked = activeWorkspaceEditAutoAspectUserLocked\(s\);/);
  assert.match(storeSource, /const editAutoAspectEnabled = s\.mode === "edit"[\s\S]*?&& \(batchProcessMode \|\| !editAutoAspectUserLocked\);/);
  assert.match(storeSource, /if \(editAutoAspectEnabled && !batchProcessMode\)/);
  assert.match(storeSource, /if \(editAutoAspectEnabled && batchProcessMode\)/);
  assert.match(storeSource, /function implicitEditAutoAspectSource\(/);
  assert.match(storeSource, /let materializedImplicitCurrentImage: RetryAutoAspectSource \| null = null;/);
  assert.match(storeSource, /materializedImplicitCurrentImage = implicitEditAutoAspectSource\(materialized\);/);
  assert.match(storeSource, /const primarySource = preparedSources\[0\][\s\S]*?\?\? materializedImplicitCurrentImage[\s\S]*?\?\? implicitEditAutoAspectSource\(s\.currentImage\);/s);
  assert.match(storeSource, /autoAspectResolution: editAutoAspectEnabled \? batchProcess\.autoAspectResolution \|\| undefined : undefined,/);
  assert.match(storeSource, /autoAspectResolution: editAutoAspectEnabled \? batchProcess\.autoAspectResolution : undefined,/);
});
