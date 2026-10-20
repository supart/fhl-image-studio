import assert from "node:assert/strict";
import test from "node:test";

const prompt = await import(`../src/features/annotation/annotationPrompt.ts?annotation-prompt=${Date.now()}-${Math.random()}`);

test("annotation prompt serializes all drawing kinds and removes markup", () => {
  const annotations = [
    { id: "a", kind: "arrow", x: 10, y: 20, width: 80, height: 40, color: "red", text: "不要衬线体" },
    { id: "r", kind: "rect", x: 20, y: 30, width: 100, height: 60, color: "blue" },
    { id: "h", kind: "highlight", x: 0, y: 0, color: "yellow", points: [0, 0, 20, 20] },
    { id: "t", kind: "text", x: 50, y: 50, color: "red", text: "保持构图" },
  ];
  const result = prompt.serializeAnnotationsForPrompt(annotations, { w: 200, h: 100 });
  assert.match(result, /不要衬线体/);
  assert.match(result, /矩形/);
  assert.match(result, /高亮/);
  assert.match(result, /移除所有箭头/);
  assert.match(prompt.augmentPromptWithAnnotationSemantics("基础提示", annotations, { w: 200, h: 100 }), /基础提示/);
});

test("annotation dimensions prefer complete media over preview metadata", async () => {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(bytes.buffer).setUint32(16, 12000, false);
  new DataView(bytes.buffer).setUint32(20, 8000, false);
  const imageB64 = Buffer.from(bytes).toString("base64");
  assert.deepEqual(
    await prompt.resolveAnnotationImageDimensions({ imageB64, width: 800, height: 533, previewWidth: 400, previewHeight: 267 }),
    { w: 12000, h: 8000 },
  );
  assert.deepEqual(
    await prompt.resolveAnnotationImageDimensions({ width: 800, height: 533, previewWidth: 400, previewHeight: 267 }),
    { w: 800, h: 533 },
  );
  const fullDataUrl = `data:image/png;base64,${imageB64}`;
  assert.deepEqual(
    await prompt.resolveAnnotationImageDimensions({ fullUrl: fullDataUrl, width: 800, height: 533, previewWidth: 400, previewHeight: 267 }),
    { w: 12000, h: 8000 },
  );
});

test("annotation prompt keeps natural coordinates when source and preview sizes differ", async () => {
  const annotations = [{ id: "a", kind: "arrow", x: 6000, y: 4000, width: 100, height: 100, color: "red", text: "修复" }];
  const result = prompt.serializeAnnotationsForPrompt(annotations, { w: 12000, h: 8000 });
  assert.match(result, /0\.508/);
  assert.doesNotMatch(prompt.serializeAnnotationsForPrompt(annotations, { w: 800, h: 533 }), /0\.508/);
});
