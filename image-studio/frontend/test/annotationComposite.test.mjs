import assert from "node:assert/strict";
import test from "node:test";

const composite = await import(`../src/features/annotation/annotationComposite.ts?annotation-composite=${Date.now()}-${Math.random()}`);

test("annotation composite keeps natural source dimensions when all marks are inside", () => {
  const plan = composite.buildAnnotationCompositePlan(
    4000,
    3000,
    [{ id: "r", kind: "rect", x: 100, y: 120, width: 800, height: 600, color: "red" }],
    "strict",
  );
  assert.equal(plan.overflow, false);
  assert.equal(plan.outputWidth, 4000);
  assert.equal(plan.outputHeight, 3000);
  assert.equal(plan.offsetX, 0);
  assert.equal(plan.offsetY, 0);
});

test("strict mode reports overflow without changing the output canvas", () => {
  const plan = composite.buildAnnotationCompositePlan(
    1000,
    800,
    [{ id: "t", kind: "text", x: -80, y: 40, text: "边缘提示", color: "red" }],
    "strict",
  );
  assert.equal(plan.overflow, true);
  assert.equal(plan.outputWidth, 1000);
  assert.equal(plan.outputHeight, 800);
});

test("expand-white offsets the original image and preserves the natural interior", () => {
  const plan = composite.buildAnnotationCompositePlan(
    1000,
    800,
    [{ id: "a", kind: "arrow", x: 960, y: 300, width: 180, height: 0, color: "red", bend: 0 }],
    "expand-white",
  );
  assert.equal(plan.overflow, true);
  assert.ok(plan.outputWidth > 1000);
  assert.equal(plan.outputHeight, 800);
  assert.equal(plan.offsetY, 0);
  assert.equal(plan.offsetX, 0);
});

test("composite plan rejects dimensions beyond the desktop safety gates", () => {
  assert.throws(
    () => composite.buildAnnotationCompositePlan(20_000, 100, [], "strict"),
    /单边上限/,
  );
  assert.throws(
    () => composite.buildAnnotationCompositePlan(12_000, 9000, [], "strict"),
    /100MP|768MiB/,
  );
});
