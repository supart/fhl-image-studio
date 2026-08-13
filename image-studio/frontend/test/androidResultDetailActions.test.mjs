import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detailDrawer = readFileSync(
  new URL("../src/components/panel/ResultDetailDrawer.tsx", import.meta.url),
  "utf8",
);

test("result detail exposes image copy using full materialized history image", () => {
  assert.match(detailDrawer, /copyImageURLToClipboard/);
  assert.match(detailDrawer, /copyImageB64ToClipboard/);
  assert.match(detailDrawer, /materializeCurrentImage\(detail\)/);
  assert.match(detailDrawer, /async function copyImage\(\)/);
  assert.match(detailDrawer, /void copyImage\(\)/);
  assert.match(detailDrawer, /复制图片/);
  assert.match(detailDrawer, /当前环境不支持复制图片，可改用分享或保存/);
});

test("result detail shows real output pixel size when available", () => {
  assert.match(detailDrawer, /pixelSizeLabel\(detail\)/);
  assert.match(detailDrawer, /const pixelLabel = pixelSizeLabel\(detail\);/);
  assert.match(detailDrawer, /label="真实像素"/);
  assert.match(detailDrawer, /value=\{pixelLabel\}/);
  assert.match(detailDrawer, /pixelLabel \? <Kv label="真实像素" value=\{pixelLabel\} mono \/> : null/);
});
