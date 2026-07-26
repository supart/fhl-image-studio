import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const canvasStageSource = await readFile(new URL("../src/components/canvas/CanvasStage.tsx", import.meta.url), "utf8");
const outputManagerSource = await readFile(new URL("../src/components/panorama/PanoramaOutputManagerModal.tsx", import.meta.url), "utf8");
const storeTypesSource = await readFile(new URL("../src/state/studioStore.types.ts", import.meta.url), "utf8");
const storeSource = await readFile(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
const detailDrawerSource = await readFile(new URL("../src/components/panel/ResultDetailDrawer.tsx", import.meta.url), "utf8");
const canvasCssSource = await readFile(new URL("../src/styles/_canvas.css", import.meta.url), "utf8");
const panoramaCssSource = await readFile(new URL("../src/components/panorama/panoramaTy360.css", import.meta.url), "utf8");

test("large single-preview canvas exposes direct panorama pasteback actions only for roundtrip images", () => {
  assert.match(canvasStageSource, /recoverPanoramaItemMetadataFromTask\(currentImage, recoveryTask, history\)/);
  assert.match(canvasStageSource, /currentImageIsWorkspaceResult && activeWorkspace\?\.mode === "edit"/);
  assert.match(canvasStageSource, /hasPanoramaRoundtripRef\(currentPanoramaPastebackItem\)/);
  assert.match(canvasStageSource, /!currentPanoramaPastebackItem\.id\.startsWith\("source-preview-"\)/);
  assert.match(canvasStageSource, /canvas-panorama-pasteback-actions/);
  assert.match(canvasStageSource, /repastePanoramaRoundtrip: state\.repastePanoramaRoundtrip/);
  assert.match(canvasStageSource, /repastePanoramaRoundtrip\(item, \{ selectAsCurrent: true \}\)/);
  assert.match(canvasStageSource, />\{panoramaQuickPastebackBusy \? "贴回中" : "自动贴回"\}<\/span>/);
  assert.match(canvasStageSource, /openPanoramaPastebackAligner\(currentPanoramaPastebackItem\)/);
  assert.match(canvasStageSource, /openExternalPanoramaPastebackPicker\(currentPanoramaPastebackItem\)/);
  assert.match(canvasStageSource, /accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(canvasCssSource, /\.canvas-panorama-pasteback-actions/);
  assert.match(canvasCssSource, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(canvasCssSource, /\.canvas-panorama-pasteback-button/);
});

test("store imports an external replacement image as an edited panorama shot and opens the aligner", () => {
  assert.match(storeTypesSource, /importExternalPanoramaPastebackImage: \(anchorItem: HistoryItem, file: File\) => Promise<HistoryItem \| null>/);
  assert.match(storeSource, /importExternalPanoramaPastebackImage: async \(anchorItem, file\) =>/);
  assert.match(storeSource, /resolvePanoramaRoundtripRef\(anchorItem\)/);
  assert.match(storeSource, /relativeDelta > 0\.01/);
  assert.match(storeSource, /role: "edited-shot" as const/);
  assert.match(storeSource, /sourceImages: \[sourceImage\]/);
  assert.match(storeSource, /panoramaRoundtrip: roundtrip/);
  assert.match(storeSource, /panoramaAlignTarget: item/);
});

test("panorama output manager keeps align pasteback and adds an external import path", () => {
  assert.match(outputManagerSource, /onImportPasteback/);
  assert.match(outputManagerSource, /importExternalPanoramaPastebackImage\(anchor, file\)/);
  assert.match(outputManagerSource, /pano-output-file-input/);
  assert.match(outputManagerSource, /accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(panoramaCssSource, /\.pano-output-file-input/);
});

test("result detail keeps a recognizable manual 360 pasteback action", () => {
  assert.match(detailDrawerSource, /\u624b\u52a8\u8d34\u56de360/);
});
