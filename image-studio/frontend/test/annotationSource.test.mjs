import assert from "node:assert/strict";
import test from "node:test";

const source = await import(`../src/features/annotation/annotationSource.ts?annotation-source=${Date.now()}-${Math.random()}`);

test("annotation source keeps small images natural and never upscales", () => {
  const target = source.annotationSourceTargetDimensions(2048, 1360);
  assert.equal(target.width, 2048);
  assert.equal(target.height, 1360);
  assert.equal(target.scaled, false);
  assert.equal(target.resolution, "4k");
});

test("annotation source compresses oversized images to a 4K longest-edge cap", () => {
  const target = source.annotationSourceTargetDimensions(7876, 10835);
  assert.equal(target.width, 2791);
  assert.equal(target.height, 3840);
  assert.equal(target.scaled, true);
  assert.equal(target.size, "2791x3840");
});

test("annotation source preserves aspect within the 4K cap", () => {
  const target = source.annotationSourceTargetDimensions(8000, 4000);
  assert.equal(target.width, 3840);
  assert.equal(target.height, 1920);
  assert.ok(Math.abs(target.width / target.height - 2) < 0.001);
});

test("annotation source rejects unknown dimensions", () => {
  assert.throws(() => source.annotationSourceTargetDimensions(0, 1200), /尺寸/);
});
