import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const imageActionsSource = readFileSync(new URL("../src/state/studioStore.images.ts", import.meta.url), "utf8");

function actionBlock(startMarker, endMarker) {
  const start = imageActionsSource.indexOf(startMarker);
  const end = imageActionsSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `${startMarker} action should exist`);
  return imageActionsSource.slice(start, end);
}

test("reference updates preserve an enabled batch image-to-image mode", () => {
  assert.match(
    imageActionsSource,
    /function editSourceModeAfterReferenceUpdate[\s\S]*?return current === "batch" \? "batch" : "manual";/,
  );

  const selectSourceImage = actionBlock("async selectSourceImage()", "async selectBatchInputDir()");
  const importSourceImageFile = actionBlock("async importSourceImageFile(file: File)", "async selectReversePromptImage()");
  const reuseAsSource = actionBlock("async reuseAsSource(item: HistoryItem)", "applyHistoryParams(item: HistoryItem)");
  const importImageFile = actionBlock("async importImageFile(file: File)", "\n  };");

  assert.match(selectSourceImage, /editSourceModeAfterReferenceUpdate\(currentState\.editSourceMode\)/);
  assert.match(importSourceImageFile, /editSourceModeAfterReferenceUpdate\(currentState\.editSourceMode\)/);
  assert.match(reuseAsSource, /editSourceModeAfterReferenceUpdate\(state\.editSourceMode\)/);
  assert.match(importImageFile, /editSourceModeAfterReferenceUpdate\(state\.editSourceMode\)/);
});

test("removing the last edit source keeps image-to-image mode active", () => {
  const removeSource = actionBlock("removeSource(index: number)", "clearSources()");
  assert.match(
    removeSource,
    /mode: "edit",[\s\S]*?editSourceMode: editSourceModeAfterReferenceUpdate\(currentState\.editSourceMode\)/,
  );
  assert.doesNotMatch(
    removeSource,
    /mode: next\.length > 0 \? "edit" : "generate"/,
  );
});

test("clearing all edit sources keeps image-to-image mode active", () => {
  const clearSources = actionBlock("clearSources()", "reorderSources(from: number, to: number)");
  assert.match(
    clearSources,
    /mode: "edit",[\s\S]*?editSourceMode: editSourceModeAfterReferenceUpdate\(currentState\.editSourceMode\)/,
  );
});
