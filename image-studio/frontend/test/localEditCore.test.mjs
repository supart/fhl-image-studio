import assert from "node:assert/strict";
import test from "node:test";

const localEdit = await import("../src/localEdit/core.ts");

function solid(width, height, rgba) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) data.set(rgba, index);
  return { width, height, data };
}

const roundtrip = {
  version: 1,
  kind: "planar",
  sourceHistoryId: "source-1",
  sourceWidth: 4,
  sourceHeight: 4,
  cropRect: { x: 1, y: 1, width: 2, height: 2 },
  editWidth: 2,
  editHeight: 2,
};

test("planar pasteback replaces only the selected crop", () => {
  const source = solid(4, 4, [0, 0, 255, 255]);
  const edited = solid(2, 2, [255, 0, 0, 255]);
  const output = localEdit.composePlanarRoundtripPixels(source, edited, roundtrip, {
    offsetXRatio: 0,
    offsetYRatio: 0,
    scale: 1,
    rotationDeg: 0,
    featherFraction: 0,
  });
  assert.deepEqual(Array.from(output.data.slice(0, 4)), [0, 0, 255, 255]);
  assert.deepEqual(Array.from(output.data.slice((1 * 4 + 1) * 4, (1 * 4 + 1) * 4 + 4)), [255, 0, 0, 255]);
  assert.deepEqual(Array.from(output.data.slice((3 * 4 + 3) * 4, (3 * 4 + 3) * 4 + 4)), [0, 0, 255, 255]);
});

test("planar alignment supports translation and arbitrary edited dimensions", () => {
  const mapped = localEdit.mapPlanarPastebackSample(
    2.5,
    1.5,
    roundtrip.cropRect,
    4,
    2,
    roundtrip.editWidth,
    roundtrip.editHeight,
    { offsetXRatio: 0.5, offsetYRatio: 0, scale: 1, rotationDeg: 0 },
  );
  assert.equal(mapped.inside, true);
  assert.ok(mapped.u >= 0 && mapped.u <= 1);
  assert.ok(mapped.v >= 0 && mapped.v <= 1);
});

test("planar automatic pasteback keeps high-resolution results inside the crop bounds", () => {
  const source = solid(8, 8, [0, 0, 255, 255]);
  const edited = solid(8, 8, [255, 0, 0, 255]);
  const highResolutionRoundtrip = {
    ...roundtrip,
    sourceWidth: 8,
    sourceHeight: 8,
    cropRect: { x: 2, y: 2, width: 2, height: 2 },
    editWidth: 2,
    editHeight: 2,
  };
  const output = localEdit.composePlanarRoundtripPixels(
    source,
    edited,
    highResolutionRoundtrip,
    { offsetXRatio: 0, offsetYRatio: 0, scale: 1, rotationDeg: 0, featherFraction: 0 },
  );

  assert.deepEqual(Array.from(output.data.slice((1 * 8 + 1) * 4, (1 * 8 + 1) * 4 + 4)), [0, 0, 255, 255]);
  assert.deepEqual(Array.from(output.data.slice((2 * 8 + 2) * 4, (2 * 8 + 2) * 4 + 4)), [255, 0, 0, 255]);
  assert.deepEqual(Array.from(output.data.slice((3 * 8 + 3) * 4, (3 * 8 + 3) * 4 + 4)), [255, 0, 0, 255]);
  assert.deepEqual(Array.from(output.data.slice((4 * 8 + 4) * 4, (4 * 8 + 4) * 4 + 4)), [0, 0, 255, 255]);

  const outside = localEdit.mapPlanarPastebackSample(
    4.5,
    3.5,
    highResolutionRoundtrip.cropRect,
    edited.width,
    edited.height,
    highResolutionRoundtrip.editWidth,
    highResolutionRoundtrip.editHeight,
  );
  assert.equal(outside.inside, false);
});

test("planar size guard blocks oversized sources", () => {
  assert.throws(
    () => localEdit.validateLocalEditDimensions(16_385, 100),
    /超过裁切局部重绘上限/,
  );
  assert.throws(
    () => localEdit.validateLocalEditDimensions(10_000, 10_000),
    /超过裁切局部重绘上限/,
  );
  assert.deepEqual(localEdit.validateLocalEditSourceDimensions(10_000, 10_000), {
    width: 10_000,
    height: 10_000,
  });
  assert.throws(
    () => localEdit.validateLocalEditSourceDimensions(10_001, 10_000),
    /超过裁切局部重绘上限/,
  );
});
