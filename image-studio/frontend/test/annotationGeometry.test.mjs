import assert from "node:assert/strict";
import test from "node:test";

const geometry = await import(`../src/features/annotation/annotationGeometry.ts?annotation-geometry=${Date.now()}-${Math.random()}`);
const annotationTypes = await import(`../src/features/annotation/annotationTypes.ts?annotation-types=${Date.now()}-${Math.random()}`);

test("Cowart arrow bend follows direction and clamps to the documented range", () => {
  assert.equal(geometry.getDefaultAnnotationArrowBend(100, 0, 1), -16);
  assert.equal(geometry.getDefaultAnnotationArrowBend(-1000, 0, 1), 48);
  assert.equal(geometry.getDefaultAnnotationArrowBend(0, 8, 1), 16);
});

test("annotation bounds and hit tests cover legacy and new drawing kinds", () => {
  const rect = { id: "r", kind: "rect", x: 10, y: 20, width: 40, height: 30, color: "red" };
  const ellipse = { id: "e", kind: "ellipse", x: 10, y: 20, width: 40, height: 30, color: "red" };
  const line = { id: "l", kind: "line", x: 0, y: 0, width: 100, height: 0, color: "red" };
  assert.deepEqual(geometry.annotationBounds(rect), { x: 10, y: 20, width: 40, height: 30 });
  assert.equal(geometry.annotationHitTest(rect, { x: 12, y: 22 }), true);
  assert.equal(geometry.annotationHitTest(ellipse, { x: 30, y: 20 }, 5), true);
  assert.equal(geometry.annotationHitTest(line, { x: 50, y: 4 }, 5), true);
});

test("annotation hit tests use outlines for rectangles and ellipses", () => {
  const rect = { id: "r", kind: "rect", x: 10, y: 10, width: 80, height: 60, color: "red" };
  const ellipse = { id: "e", kind: "ellipse", x: 10, y: 10, width: 80, height: 60, color: "red" };
  assert.equal(geometry.annotationHitTest(rect, { x: 50, y: 40 }, 2), false);
  assert.equal(geometry.annotationHitTest(rect, { x: 11, y: 40 }, 2), true);
  assert.equal(geometry.annotationHitTest(ellipse, { x: 50, y: 40 }, 2), false);
  assert.equal(geometry.annotationHitTest(ellipse, { x: 50, y: 11 }, 2), true);
});

test("annotation geometry handles reverse drags and degenerate paths", () => {
  const reverse = { id: "r", kind: "line", x: 100, y: 80, width: -60, height: -40, color: "red" };
  assert.deepEqual(geometry.annotationBounds(reverse), { x: 40, y: 40, width: 60, height: 40 });
  const point = { id: "p", kind: "freehand", x: 0, y: 0, color: "red", points: [20, 20, 20, 20] };
  assert.equal(geometry.annotationHitTest(point, { x: 21, y: 20 }, 2), true);
});

test("pointer selection halo follows image style and zoom without becoming unbounded", () => {
  const thin = { id: "l", kind: "line", x: 0, y: 0, width: 100, height: 0, color: "red", strokeWidth: 4 };
  const label = { id: "t", kind: "text", x: 20, y: 20, text: "标注", color: "red", fontSize: 20 };
  assert.equal(geometry.annotationSelectionTolerance(thin, 1), 10);
  assert.equal(geometry.annotationSelectionTolerance(thin, 0.5), 20);
  assert.equal(geometry.annotationSelectionTolerance(label, 1), 15);
  assert.ok(geometry.annotationSelectionTolerance(label, 0.05) <= 200);
});

test("pointer transform handles expose corners for boxes and endpoints for lines", () => {
  const rect = { id: "r", kind: "rect", x: 10, y: 20, width: 40, height: 30, color: "red" };
  const line = { id: "l", kind: "line", x: 10, y: 20, width: 40, height: 30, color: "red" };
  assert.deepEqual(geometry.annotationTransformHandles(rect), [
    { handle: "nw", x: 10, y: 20 },
    { handle: "ne", x: 50, y: 20 },
    { handle: "se", x: 50, y: 50 },
    { handle: "sw", x: 10, y: 50 },
  ]);
  assert.deepEqual(geometry.annotationTransformHandles(line), [
    { handle: "start", x: 10, y: 20 },
    { handle: "end", x: 50, y: 50 },
  ]);
});

test("box transform keeps the opposite corner anchored and enforces a minimum size", () => {
  const rect = { id: "r", kind: "rect", x: 10, y: 20, width: 40, height: 30, color: "red" };
  assert.deepEqual(geometry.resizeAnnotationFromHandle(rect, "se", { x: 80, y: 70 }), {
    x: 10, y: 20, width: 70, height: 50,
  });
  assert.deepEqual(geometry.resizeAnnotationFromHandle(rect, "nw", { x: 60, y: 60 }), {
    x: 42, y: 42, width: 8, height: 8,
  });
});

test("line endpoints, freehand points and text font size transform in image pixels", () => {
  const line = { id: "l", kind: "line", x: 10, y: 20, width: 40, height: 30, color: "red" };
  assert.deepEqual(geometry.resizeAnnotationFromHandle(line, "end", { x: 90, y: 80 }), {
    x: 10, y: 20, width: 80, height: 60,
  });
  const freehand = { id: "p", kind: "freehand", x: 0, y: 0, color: "red", points: [10, 20, 30, 40] };
  assert.deepEqual(geometry.resizeAnnotationFromHandle(freehand, "se", { x: 50, y: 60 }), {
    x: 10, y: 20, points: [10, 20, 50, 60],
  });
  const text = { id: "t", kind: "text", x: 10, y: 20, text: "AB", color: "red", fontSize: 20 };
  const textPatch = geometry.resizeAnnotationFromHandle(text, "se", { x: 50, y: 60 });
  assert.equal(textPatch.x, 10);
  assert.equal(textPatch.y, 20);
  assert.equal(textPatch.fontSize, 31);
});

test("arrow endpoint transforms preserve proportional bend and clamp text scale", () => {
  const arrow = { id: "a", kind: "arrow", x: 10, y: 20, width: 40, height: 0, bend: 16, color: "red" };
  assert.deepEqual(geometry.resizeAnnotationFromHandle(arrow, "end", { x: 90, y: 20 }), {
    x: 10, y: 20, width: 80, height: 0, bend: 32,
  });
  const text = { id: "t", kind: "text", x: 10, y: 20, text: "A", color: "red", fontSize: 128 };
  assert.equal(geometry.resizeAnnotationFromHandle(text, "se", { x: 1000, y: 1000 }).fontSize, 128);
});

test("arrow labels have an independent natural-pixel position and remain selectable", () => {
  const arrow = { id: "a", kind: "arrow", x: 100, y: 120, width: 80, height: 40, text: "标签", color: "red", fontSize: 20 };
  const defaultLabel = annotationTypes.annotationLabelPosition(arrow);
  assert.deepEqual(defaultLabel, { x: 100, y: 94 });
  const moved = { ...arrow, labelX: 240, labelY: 300 };
  assert.deepEqual(annotationTypes.annotationLabelPosition(moved), { x: 240, y: 300 });
  const bounds = geometry.annotationLabelBounds(moved);
  assert.ok(bounds);
  assert.equal(geometry.annotationHitTest(moved, { x: 242, y: 302 }, 2), true);
  assert.equal(geometry.annotationHitTest(moved, { x: 102, y: 120 }, 2), true);
});
