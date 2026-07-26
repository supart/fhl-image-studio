import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const canvasSource = readFileSync(new URL("../src/components/canvas/CanvasStage.tsx", import.meta.url), "utf8");
const runtimeSource = readFileSync(new URL("../src/state/studioStore.runtime.ts", import.meta.url), "utf8");

test("a live blob result preview is not replaced by proactive disk materialization", () => {
  assert.match(
    canvasSource,
    /const currentImageBlob = currentImage\?\.imageBlob \?\? currentImage\?\.previewBlob \?\? null;/,
  );
  assert.match(
    canvasSource,
    /const currentImageURL = currentImage\?\.previewUrl\?\.startsWith\("blob:"\)\s*\? currentImage\.previewUrl\s*: historyFullSrc\(currentImage, null\);/,
  );
  assert.match(
    canvasSource,
    /if \(currentImage\.previewUrl\?\.startsWith\("blob:"\)\) return;/,
  );
  assert.match(
    canvasSource,
    /\|\| currentImage\.previewBlob\s*\) return;/,
  );
  assert.match(
    runtimeSource,
    /if \(item\.previewOnly && \(item\.imageB64 \|\| item\.imageBlob\)\) \{\s*const next: HistoryItem = \{ \.\.\.item, previewOnly: false \};/,
  );
});
