import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const images = await import("../src/lib/images.ts");
const labels = await import("../src/components/history/historyLabels.ts");

function b64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

test("image dimensions parser reads final PNG JPEG and WebP sizes", () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47]);
  const pngView = new DataView(png.buffer);
  pngView.setUint32(16, 1536, false);
  pngView.setUint32(20, 1024, false);

  const jpeg = Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11,
    0x08, 0x04, 0x00, 0x06, 0x00,
    0x03, 0x01, 0x11, 0x00,
  ]);

  const webp = new Uint8Array(30);
  webp.set([0x52, 0x49, 0x46, 0x46], 0);
  webp.set([0x57, 0x45, 0x42, 0x50], 8);
  webp.set([0x56, 0x50, 0x38, 0x58], 12);
  const webpWidthMinusOne = 941 - 1;
  const webpHeightMinusOne = 1672 - 1;
  webp[24] = webpWidthMinusOne & 0xff;
  webp[25] = (webpWidthMinusOne >> 8) & 0xff;
  webp[26] = (webpWidthMinusOne >> 16) & 0xff;
  webp[27] = webpHeightMinusOne & 0xff;
  webp[28] = (webpHeightMinusOne >> 8) & 0xff;
  webp[29] = (webpHeightMinusOne >> 16) & 0xff;

  assert.deepEqual(images.getImageDimensionsFromBase64(b64(png)), { w: 1536, h: 1024 });
  assert.deepEqual(images.getImageDimensionsFromBase64(`data:image/jpeg;base64,${b64(jpeg)}`), { w: 1536, h: 1024 });
  assert.deepEqual(images.getImageDimensionsFromBase64(b64(webp)), { w: 941, h: 1672 });
});

test("pixel size label uses real output width and height only", () => {
  assert.equal(labels.pixelSizeLabel({ width: 1536, height: 1024 }), "1536x1024");
  assert.equal(labels.pixelSizeLabel({ previewWidth: 320, previewHeight: 213 }), null);
});

test("Android history batch grids and canvas render real pixel size as a labeled chip", () => {
  const domain = readFileSync(new URL("../src/types/domain.ts", import.meta.url), "utf8");
  const host = readFileSync(new URL("../src/platform/runtime/host.ts", import.meta.url), "utf8");
  const store = readFileSync(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
  const batchGrid = readFileSync(new URL("../src/components/canvas/BatchResultGrid.tsx", import.meta.url), "utf8");
  const androidCanvas = readFileSync(new URL("../src/platform/android/canvas/AndroidCanvasWorkspace.tsx", import.meta.url), "utf8");
  const androidTile = readFileSync(new URL("../src/platform/android/history/AndroidHistoryTile.tsx", import.meta.url), "utf8");
  const androidActionSheet = readFileSync(new URL("../src/platform/android/history/AndroidHistoryActionSheet.tsx", import.meta.url), "utf8");
  const androidCss = readFileSync(new URL("../src/styles/_android-history.css", import.meta.url), "utf8");
  const canvasCss = readFileSync(new URL("../src/styles/_canvas.css", import.meta.url), "utf8");
  const jobManager = readFileSync(new URL("../../../android-shell/app/src/main/java/top/gptcodex/imagestudio/android/AndroidJobManager.kt", import.meta.url), "utf8");

  assert.match(domain, /width\?: number;/);
  assert.match(domain, /height\?: number;/);
  assert.match(host, /getImageDimensionsFromBase64/);
  assert.match(host, /width: dimensions\?\.w/);
  assert.match(store, /width: resultDims\?\.w/);
  assert.match(store, /width: Number\.isFinite\(Number\(slot\.width\)\)/);
  assert.match(batchGrid, /pixelSizeLabel\(item\)/);
  assert.match(batchGrid, /batch-grid-pixels/);
  assert.match(androidCanvas, /pixelSizeLabel\(currentImage\)/);
  assert.match(androidCanvas, /deriveAspectPreset\(currentImage\.size\)/);
  assert.match(androidCanvas, /deriveResolutionPreset\(currentImage\.size\)/);
  assert.match(androidCanvas, /title=\{`选择尺寸:\$\{currentImage\.size\}`\}/);
  assert.match(androidCanvas, /title=\{`画幅比例:\$\{currentImage\.size\}`\}/);
  assert.match(androidCanvas, /title=\{`真实像素:\$\{currentPixelLabel\}`\}/);
  assert.match(androidCanvas, /像素 \{currentPixelLabel\}/);
  assert.doesNotMatch(androidCanvas, /currentPixelLabel \? <span>\{currentPixelLabel\}<\/span> : null/);
  assert.match(androidCanvas, /android-canvas-floating-meta/);
  assert.match(androidTile, /android-history-pixel-badge/);
  assert.match(androidTile, /pixelSizeLabel\(item\)/);
  assert.match(androidActionSheet, /pixelSizeLabel\(item\)/);
  assert.match(androidActionSheet, /pixelLabel \? ` · \$\{pixelLabel\}` : ""/);
  assert.match(androidCss, /\.android-history-pixel-badge/);
  assert.match(canvasCss, /\.batch-grid-pixels/);
  assert.match(jobManager, /current\.put\("width", preview\.sourceWidth\)/);
  assert.match(jobManager, /val sourceWidth: Int/);
});
