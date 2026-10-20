import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const types = await import(`../src/features/annotation/annotationTypes.ts?annotation-style=${Date.now()}-${Math.random()}`);
const compositeSource = await readFile(new URL("../src/features/annotation/annotationComposite.ts", import.meta.url), "utf8");
const shapeSource = await readFile(new URL("../src/components/canvas/AnnotationShape.tsx", import.meta.url), "utf8");
const interactionSource = await readFile(new URL("../src/features/annotation/useAnnotationInteractions.ts", import.meta.url), "utf8");
const toolbarSource = await readFile(new URL("../src/features/annotation/AnnotationToolbar.tsx", import.meta.url), "utf8");
const sectionsSource = await readFile(new URL("../src/components/canvas/toolbarActionSections.tsx", import.meta.url), "utf8");
const canvasSource = await readFile(new URL("../src/components/canvas/CanvasStage.tsx", import.meta.url), "utf8");
const storeSource = await readFile(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
const annotationActionsSource = await readFile(new URL("../src/state/studioStore.annotations.ts", import.meta.url), "utf8");
const mainToolbarSource = await readFile(new URL("../src/components/canvas/Toolbar.tsx", import.meta.url), "utf8");

test("annotation style values clamp to the image-pixel controls", () => {
  assert.equal(types.clampAnnotationStrokeWidth(-4), 1);
  assert.equal(types.clampAnnotationStrokeWidth(200), 96);
  assert.equal(types.clampAnnotationStrokeWidth(undefined), 4);
  assert.equal(types.clampAnnotationFontSize(2), 8);
  assert.equal(types.clampAnnotationFontSize(200), 128);
  assert.equal(types.clampAnnotationFontSize(undefined), 20);
  assert.equal(types.annotationFontSizeForImage(480, 480), 16);
  assert.equal(types.annotationFontSizeForImage(1152, 1536), 24);
  assert.equal(types.annotationFontSizeForImage(3840, 2791), 60);
  assert.equal(types.annotationFontSizeForImage(0, 0), 20);
  assert.equal(types.annotationArrowHeadSize(4), 12);
  assert.equal(types.annotationArrowHeadSize(20), 60);
});

test("legacy annotations keep stroke pixels and receive a compatible font default", () => {
  const legacy = types.normalizeAnnotation({ id: "legacy", kind: "arrow", x: 0, y: 0, width: 40, height: 0, color: "red", strokeWidth: 7 });
  assert.equal(legacy.strokeWidth, 7);
  assert.equal(legacy.fontSize, 20);
});

test("preview and composite use image-pixel styles without a second view-scale conversion", () => {
  assert.doesNotMatch(shapeSource, /strokeWidth=\{[^}]*\/ Math\.max\(0\.05, viewScale\)/);
  assert.doesNotMatch(shapeSource, /fontSize=\{[^}]*\/ Math\.max\(0\.05, viewScale\)/);
  assert.doesNotMatch(compositeSource, /strokeWidth[^\n]*\/ Math\.max\(0\.05, scale\)/);
  assert.doesNotMatch(compositeSource, /ANNOTATION_TEXT_FONT_SIZE \/ Math\.max/);
  assert.doesNotMatch(canvasSource, /composeAnnotationImage\([^\n]*canvasView/);
});

test("toolbar exposes separate stroke/font controls and locks proportional scaling", () => {
  assert.match(toolbarSource, /id: "pointer", label: "指针（选择标注）"/);
  assert.match(toolbarSource, /标注描边宽度（图像像素）/);
  assert.match(toolbarSource, /标注字体大小（图像像素）/);
  assert.match(toolbarSource, /ANNOTATION_STROKE_WIDTH_MIN/);
  assert.match(toolbarSource, /ANNOTATION_STROKE_WIDTH_MAX/);
  assert.match(toolbarSource, /ANNOTATION_FONT_SIZE_MIN/);
  assert.match(toolbarSource, /ANNOTATION_FONT_SIZE_MAX/);
  assert.match(toolbarSource, /标注按图像像素随画布等比缩放/);
  assert.match(sectionsSource, /annotationStrokeWidth/);
  assert.match(sectionsSource, /annotationFontSize/);
});

test("pointer mode selects and moves existing annotations with a bounded halo", () => {
  assert.match(interactionSource, /annotationKind === "pointer"/);
  assert.match(interactionSource, /pointerDragRef/);
  assert.match(interactionSource, /annotationSelectionTolerance/);
  assert.match(interactionSource, /onContextMenu/);
  assert.match(canvasSource, /annotationInteractions\.onContextMenu/);
  assert.match(interactionSource, /onAnnotationContextMenu/);
  assert.match(interactionSource, /const labelBounds = annotationLabelBounds\(annotation\)/);
  assert.match(interactionSource, /Boolean\(labelHit\)/);
  assert.match(canvasSource, /复制标注/);
  assert.match(canvasSource, /删除标注/);
  assert.match(annotationActionsSource, /annotationFontSizeForImage/);
  assert.match(annotationActionsSource, /defaultFontSize = annotationFontSizeForImage/);
  assert.match(mainToolbarSource, /selectedAnnotationFontSize/);
  assert.match(mainToolbarSource, /selectedAnnotationStrokeWidth/);
});

test("copying an annotation preserves style and offsets image-local geometry", () => {
  const source = {
    id: "a",
    kind: "arrow",
    x: 20,
    y: 30,
    width: 80,
    height: 10,
    bend: 16,
    text: "标签",
    labelX: 20,
    labelY: 4,
    strokeWidth: 6,
    fontSize: 24,
    color: "red",
  };
  const copy = types.cloneAnnotationForCopy(source, "b", 16, -8);
  assert.equal(copy.id, "b");
  assert.equal(copy.x, 36);
  assert.equal(copy.y, 22);
  assert.equal(copy.labelX, 36);
  assert.equal(copy.labelY, -4);
  assert.equal(copy.strokeWidth, 6);
  assert.equal(copy.fontSize, 24);
});

test("new annotations use independent image-pixel defaults and style edits are undoable", () => {
  assert.match(interactionSource, /annotationStrokeWidth/);
  assert.match(interactionSource, /annotationFontSize/);
  assert.doesNotMatch(interactionSource, /brushSize \/ 8/);
  assert.match(storeSource, /updateAnnotationStyle:/);
  assert.match(storeSource, /label: "annotation-style"/);
  assert.match(storeSource, /redoStack: \[\]/);
});
