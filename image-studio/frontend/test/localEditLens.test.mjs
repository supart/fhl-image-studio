import assert from "node:assert/strict";
import test from "node:test";

const lens = await import("../src/localEdit/lens.ts");

test("clamps planar lens geometry and preserves a fixed aspect", () => {
  const rect = lens.clampLocalEditRect({ x: 900, y: -20, width: 900, height: 100 }, 1000, 800, "16:9");
  assert.equal(rect.x, 100);
  assert.equal(rect.y, 0);
  assert.ok(rect.width <= 1000 && rect.height <= 800);
  assert.ok(Math.abs(rect.width / rect.height - 16 / 9) < 0.03);
});

test("centered lens keeps its center while changing aspect", () => {
  const start = lens.createCenteredLocalEditLens(2400, 1600, "1:1");
  const next = lens.resizeLocalEditLensToAspect(start, "16:9", 2400, 1600);
  assert.ok(Math.abs((start.x + start.width / 2) - (next.x + next.width / 2)) <= 1);
  assert.ok(Math.abs((start.y + start.height / 2) - (next.y + next.height / 2)) <= 1);
  assert.ok(Math.abs(next.width / next.height - 16 / 9) < 0.03);
});

test("free aspect does not force a ratio and reset remains inside source bounds", () => {
  const start = lens.createCenteredLocalEditLens(120, 90, "free");
  const normalized = lens.normalizeLocalEditLens({ ...start, x: -50, y: 100, width: 1000, height: 1000 }, 120, 90, "free");
  assert.equal(normalized.x, 0);
  assert.equal(normalized.y, 0);
  assert.equal(normalized.width, 120);
  assert.equal(normalized.height, 90);
});

test("fixed-corner resize responds to vertical movement and keeps the opposite corner", () => {
  const start = { x: 100, y: 100, width: 320, height: 180 };
  const next = lens.resizeLocalEditRectFromCorner(start, "se", 0, 90, 1000, 800, "16:9");
  assert.equal(next.x, start.x);
  assert.equal(next.y, start.y);
  assert.ok(next.height > start.height);
  assert.ok(Math.abs(next.width / next.height - 16 / 9) < 0.03);
});

test("centered lens helper creates a fresh centered frame for reset", () => {
  const next = lens.createCenteredLocalEditLens(1000, 800, "16:9");
  assert.ok(Math.abs(next.x + next.width / 2 - 500) <= 1);
  assert.ok(Math.abs(next.y + next.height / 2 - 400) <= 1);
});
