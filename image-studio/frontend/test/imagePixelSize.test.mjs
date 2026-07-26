import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const images = await import("../src/lib/images.ts");

function b64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function pngBytes(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function jpegBytes(width, height) {
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xc0,
    0x00, 0x11,
    0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

function webpVp8xBytes(width, height) {
  const bytes = new Uint8Array(30);
  bytes.set(Buffer.from("RIFF"), 0);
  bytes.set([0x16, 0x00, 0x00, 0x00], 4);
  bytes.set(Buffer.from("WEBP"), 8);
  bytes.set(Buffer.from("VP8X"), 12);
  bytes.set([0x0a, 0x00, 0x00, 0x00], 16);
  const w = width - 1;
  const h = height - 1;
  bytes[24] = w & 0xff;
  bytes[25] = (w >> 8) & 0xff;
  bytes[26] = (w >> 16) & 0xff;
  bytes[27] = h & 0xff;
  bytes[28] = (h >> 8) & 0xff;
  bytes[29] = (h >> 16) & 0xff;
  return bytes;
}

test("image dimension helpers parse actual PNG JPEG and WebP headers", async () => {
  assert.deepEqual(images.getImageDimensionsFromBase64(b64(pngBytes(864, 1536))), { w: 864, h: 1536 });
  assert.deepEqual(images.getImageDimensionsFromBase64(b64(jpegBytes(1536, 864))), { w: 1536, h: 864 });
  assert.deepEqual(images.getImageDimensionsFromBase64(b64(webpVp8xBytes(1216, 1520))), { w: 1216, h: 1520 });
  assert.deepEqual(await images.getImageDimensionsFromBlob(new Blob([pngBytes(1024, 1024)])), { w: 1024, h: 1024 });
});

test("generated image views render bottom-right pixel size badges", () => {
  const badgeSource = readFileSync(new URL("../src/components/common/ImagePixelSizeBadge.tsx", import.meta.url), "utf8");
  const batchGridSource = readFileSync(new URL("../src/components/canvas/BatchResultGrid.tsx", import.meta.url), "utf8");
  const canvasStageSource = readFileSync(new URL("../src/components/canvas/CanvasStage.tsx", import.meta.url), "utf8");
  const historyTileSource = readFileSync(new URL("../src/components/history/HistoryTile.tsx", import.meta.url), "utf8");
  const timelineSource = readFileSync(new URL("../src/components/history/TimelineHistoryItem.tsx", import.meta.url), "utf8");
  const androidTileSource = readFileSync(new URL("../src/platform/android/history/AndroidHistoryTile.tsx", import.meta.url), "utf8");
  const historyCss = readFileSync(new URL("../src/styles/_history.css", import.meta.url), "utf8");
  const domainSource = readFileSync(new URL("../src/types/domain.ts", import.meta.url), "utf8");
  const modelsSource = readFileSync(new URL("../wailsjs/go/models.ts", import.meta.url), "utf8");

  assert.match(badgeSource, /naturalWidth/);
  assert.match(badgeSource, /naturalHeight/);
  assert.match(badgeSource, /image-pixel-size-badge/);
  assert.match(historyCss, /\.image-pixel-size-badge/);
  assert.match(batchGridSource, /<ImagePixelSizeBadge width=\{item\.width\} height=\{item\.height\} className="batch-grid-pixel-size" \/>/);
  assert.doesNotMatch(batchGridSource, /<ImagePixelSizeBadge[^>]*src=\{fullSrc \|\| src\}/);
  assert.match(historyTileSource, /historyFullSrc\(item, previewURL\)/);
  assert.match(historyTileSource, /renderPixelSizeBadge\("android-history-pixel-size"\)/);
  assert.match(historyTileSource, /windows-history-image-pixel-size/);
  assert.match(androidTileSource, /historyFullSrc\(item, previewURL\)/);
  assert.match(androidTileSource, /className = "android-history-pixel-size"/);
  assert.match(timelineSource, /<ImagePixelSizeBadge width=\{item\.width\} height=\{item\.height\}/);
  assert.match(canvasStageSource, /className="canvas-image-pixel-size"/);
  assert.match(canvasStageSource, /image\?\.naturalWidth/);
  assert.match(canvasStageSource, /image\?\.naturalHeight/);
  assert.match(domainSource, /export interface HistoryItem[\s\S]*?width\?: number;[\s\S]*?height\?: number;/);
  assert.match(modelsSource, /export class MediaAssetRef[\s\S]*?width\?: number;[\s\S]*?this\.width = source\["width"\]/);
});

test("backend events expose real generated image dimensions separately from preview dimensions", () => {
  const typesSource = readFileSync(new URL("../../backend/types.go", import.meta.url), "utf8");
  const mediaSource = readFileSync(new URL("../../backend/media.go", import.meta.url), "utf8");
  const serviceSource = readFileSync(new URL("../../backend/service.go", import.meta.url), "utf8");

  assert.match(typesSource, /type ResultPayload struct \{[\s\S]*?Width\s+int\s+.*json:"width,omitempty"[\s\S]*?Height\s+int\s+.*json:"height,omitempty"/);
  assert.match(typesSource, /type MediaAssetRef struct \{[\s\S]*?Width\s+int\s+.*json:"width,omitempty"[\s\S]*?PreviewWidth\s+int\s+.*json:"previewWidth,omitempty"/);
  assert.match(mediaSource, /imageConfig\(fullAbs\)/);
  assert.match(mediaSource, /Width:\s+asset\.Width/);
  assert.match(mediaSource, /Height:\s+asset\.Height/);
  assert.match(serviceSource, /Width:\s+asset\.Width/);
  assert.match(serviceSource, /Height:\s+asset\.Height/);
});
