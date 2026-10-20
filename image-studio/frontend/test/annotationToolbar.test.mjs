import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/features/annotation/AnnotationToolbar.tsx", import.meta.url), "utf8");
const textEditorSource = await readFile(new URL("../src/features/annotation/AnnotationTextEditor.tsx", import.meta.url), "utf8");
const interactionSource = await readFile(new URL("../src/features/annotation/useAnnotationInteractions.ts", import.meta.url), "utf8");
const canvasStageSource = await readFile(new URL("../src/components/canvas/CanvasStage.tsx", import.meta.url), "utf8");
const toolbarSource = await readFile(new URL("../src/components/canvas/Toolbar.tsx", import.meta.url), "utf8");
const sectionsSource = await readFile(new URL("../src/components/canvas/toolbarActionSections.tsx", import.meta.url), "utf8");
const actionBarSource = await readFile(new URL("../src/features/annotation/AnnotationActionBar.tsx", import.meta.url), "utf8");

test("annotation tool buttons expose a visible accent selected state", () => {
  assert.match(source, /aria-pressed=\{tool === id\}/);
  assert.match(source, /border-\[color:var\(--accent\)\]/);
  assert.match(source, /bg-\[var\(--accent-soft\)\]/);
  assert.match(source, /text-\[color:var\(--accent\)\]/);
  assert.match(source, /ring-2 ring-\[color:var\(--accent\)\]\/35/);
  assert.match(source, /backgroundColor: "var\(--accent-soft\)"/);
  assert.match(source, /borderColor: "var\(--accent\)"/);
  assert.match(source, /color: "var\(--accent\)"/);
});

test("annotation confirmation rasterizes and never submits an edit directly", () => {
  assert.match(source, /onConfirm,\s*disabled = false,\s*busy = false/);
  assert.match(source, /onClick=\{onConfirm\}/);
  assert.match(source, /确认标注/);
  assert.match(source, /backgroundColor: "var\(--accent\)"/);
  assert.match(source, /aria-busy=\{busy\}/);
  assert.match(source, /busy \? "合成中…" : "确认标注"/);
  assert.doesNotMatch(source, /批注修图/);
  assert.match(sectionsSource, /onConfirmAnnotations/);
  assert.match(sectionsSource, /onConfirm=\{onConfirmAnnotations\}/);
  assert.match(sectionsSource, /busy=\{annotationConfirming\}/);
  assert.doesNotMatch(sectionsSource, /onSubmitAnnotationEdit/);
  assert.match(toolbarSource, /handleConfirmAnnotations/);
  assert.match(toolbarSource, /confirmAnnotationComposite\("strict"\)/);
  assert.match(toolbarSource, /AnnotationOverflowModal/);
  assert.doesNotMatch(toolbarSource, /submitAnnotationEdit/);
});

test("annotation entry prepares a temporary 4K-bounded source before activating the tool", () => {
  assert.match(toolbarSource, /prepareAnnotationSource/);
  assert.match(toolbarSource, /handleToggleAnnotationTools/);
  assert.match(toolbarSource, /annotationSourcePreparing/);
  assert.match(sectionsSource, /正在压缩标注源图像/);
  assert.match(sectionsSource, /压缩中…/);
});

test("annotation action bar exposes canvas-local undo redo delete confirm and cancel controls", () => {
  assert.match(actionBarSource, /data-testid="annotation-action-bar"/);
  assert.match(actionBarSource, /后退（撤销）/);
  assert.match(actionBarSource, /前进（重做）/);
  assert.match(actionBarSource, /删除/);
  assert.match(actionBarSource, /确认标注/);
  assert.match(actionBarSource, /取消/);
  assert.match(toolbarSource, /createPortal/);
  assert.match(toolbarSource, /data-annotation-action-portal/);
  assert.match(toolbarSource, /onUndo=\{undo\}/);
  assert.match(toolbarSource, /onRedo=\{redo\}/);
  assert.match(toolbarSource, /removeAnnotation\(selectedAnnotationId\)/);
});

test("annotation action bar is restricted to the active image annotation canvas", () => {
  assert.match(toolbarSource, /const showAnnotationActionBar = tool === "annotate"/);
  assert.match(toolbarSource, /&& !resultGridOpen/);
  assert.match(toolbarSource, /&& !historyGalleryOpen/);
});

test("text editing confirms in the canvas and returns to pointer selection", () => {
  assert.match(textEditorSource, /data-testid="annotation-text-editor"/);
  assert.match(textEditorSource, /className="annotation-text-editor"/);
  assert.match(textEditorSource, /className="annotation-text-editor-input"/);
  assert.match(textEditorSource, /data-testid="annotation-text-confirm"/);
  assert.match(textEditorSource, /确认文字/);
  assert.match(textEditorSource, /onBlur={onBlurCommit \?\? onCommit}/);
  assert.match(textEditorSource, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
  assert.match(interactionSource, /annotationEditRef/);
  assert.match(interactionSource, /commitCurrentAnnotationEdit/);
  assert.match(interactionSource, /function onActivate\(id: string\)/);
  assert.match(interactionSource, /annotationKind !== "pointer"/);
  assert.match(interactionSource, /setAnnotationKind\("pointer"\)/);
  assert.match(interactionSource, /if \(annotationEditRef\.current\) \{\s*onEditCommit\(\);\s*return;/);
  assert.match(interactionSource, /const next = \{ \.\.\.target, text \};/);
  assert.doesNotMatch(interactionSource, /if \(!text && \(target\.kind === "arrow" \|\| target\.kind === "text"\)\) removeAnnotation/);
  assert.match(canvasStageSource, /onBlurCommit={annotationInteractions\.onEditBlur}/);
  assert.match(canvasStageSource, /onActivate={annotationInteractions\.onActivate}/);
  assert.match(canvasStageSource, /only the image or empty stage keeps the fit\/100% zoom shortcut/);
  assert.match(canvasStageSource, /e\.target !== stageRef\.current/);
  assert.match(canvasStageSource, /setAnnotationKind: \(kind\) => setField\("annotationKind", kind\)/);
  assert.match(textEditorSource, /const commitLatest = \(\) =>/);
  assert.match(textEditorSource, /ref\.current\?\.value/);
});
