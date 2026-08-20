import assert from "node:assert/strict";
import test from "node:test";

const { clampLocalEditPreviewPosition } = await import("../src/localEdit/lens.ts");

test("floating preview position honors stage padding on every edge", () => {
  const stage = { width: 1000, height: 700 };
  const preview = { width: 240, height: 160 };
  assert.deepEqual(
    clampLocalEditPreviewPosition({ left: -80, top: 9999 }, stage, preview, 16),
    { left: 16, top: 524 },
  );
  assert.deepEqual(
    clampLocalEditPreviewPosition({ left: 9999, top: -20 }, stage, preview, 16),
    { left: 744, top: 16 },
  );
});

test("preview position is rounded and remains finite for malformed measurements", () => {
  assert.deepEqual(
    clampLocalEditPreviewPosition(
      { left: Number.NaN, top: Number.POSITIVE_INFINITY },
      { width: 640, height: 480 },
      { width: 200, height: 120 },
    ),
    { left: 12, top: 12 },
  );
  assert.deepEqual(
    clampLocalEditPreviewPosition({ left: 77.7, top: 88.2 }, { width: 640, height: 480 }, { width: 200, height: 120 }),
    { left: 78, top: 88 },
  );
});

test("an oversized preview pins safely to the available stage origin", () => {
  assert.deepEqual(
    clampLocalEditPreviewPosition({ left: 200, top: 200 }, { width: 120, height: 90 }, { width: 400, height: 300 }, 20),
    { left: 0, top: 0 },
  );
});
