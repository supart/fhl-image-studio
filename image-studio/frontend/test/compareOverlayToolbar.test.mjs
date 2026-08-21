import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const overlaySource = readFileSync(new URL("../src/components/canvas/CompareOverlay.tsx", import.meta.url), "utf8");
const sideBySideOverlaySource = readFileSync(new URL("../src/components/canvas/SideBySideCompareOverlay.tsx", import.meta.url), "utf8");
const canvasStageSource = readFileSync(new URL("../src/components/canvas/CanvasStage.tsx", import.meta.url), "utf8");
const toolbarSource = readFileSync(new URL("../src/components/canvas/Toolbar.tsx", import.meta.url), "utf8");
const toolbarSectionSource = readFileSync(new URL("../src/components/canvas/toolbarActionSections.tsx", import.meta.url), "utf8");
const toolbarPrimitivesSource = readFileSync(new URL("../src/components/canvas/toolbarPrimitives.tsx", import.meta.url), "utf8");
const windowsControlsSource = readFileSync(new URL("../src/styles/fluent/_windows-controls.css", import.meta.url), "utf8");

test("compare overlay uses left/right props and pointer drag events", () => {
  assert.match(overlaySource, /leftBlob/);
  assert.match(overlaySource, /rightBlob/);
  assert.match(overlaySource, /leftLabel/);
  assert.match(overlaySource, /rightLabel/);
  assert.match(overlaySource, /onPointerDown/);
  assert.match(overlaySource, /pointermove/);
  assert.match(overlaySource, /pointercancel/);
});

test("toolbar exposes side-by-side and curtain compare controls", () => {
  assert.match(toolbarSource, /showCompareToggle/);
  assert.match(toolbarSource, /compareDisabled/);
  assert.match(toolbarSource, /primaryCompareSourceFromCurrentImage/);
  assert.match(toolbarSource, /openCompareWithPrimarySource\("sideBySide"\)/);
  assert.match(toolbarSource, /openCompareWithPrimarySource\("curtain"\)/);
  assert.match(toolbarSource, /setCompareB\(compareB, "sideBySide"\)/);
  assert.match(toolbarSource, /setCompareB\(compareB, "curtain"\)/);
  assert.match(toolbarSectionSource, /showCompareToggle: boolean/);
  assert.match(toolbarSectionSource, /sideBySideTitle: string/);
  assert.match(toolbarSectionSource, /curtainTitle: string/);
  assert.ok(toolbarSectionSource.indexOf("双图对比") >= 0);
  assert.ok(toolbarSectionSource.indexOf("双图对比") < toolbarSectionSource.indexOf("卷帘对比"));
  assert.match(toolbarSectionSource, /showReturnFromSourcePreview: boolean/);
  assert.match(toolbarSectionSource, /returnFromSourcePreviewTitle: string/);
  assert.match(toolbarSectionSource, /dataAuditId="return-from-source-preview"/);
  assert.match(toolbarSource, /historyGallerySinglePreviewId === currentImage.id/);
  assert.match(toolbarSource, /openHistoryGallery/);
  assert.match(toolbarSectionSource, /showReturnFromHistoryGallery: boolean/);
  assert.match(toolbarSectionSource, /onReturnFromHistoryGallery/);
  assert.match(toolbarSectionSource, /dataAuditId="return-from-history-gallery"/);
  assert.ok(toolbarSectionSource.includes("回到完整相册"));
});

test("canvas supports side-by-side compare mode while preserving curtain compare", () => {
  assert.match(sideBySideOverlaySource, /side-by-side-compare-overlay/);
  assert.match(sideBySideOverlaySource, /side-by-side-compare-panel/);
  assert.match(canvasStageSource, /compareMode === "sideBySide"/);
  assert.match(canvasStageSource, /SideBySideCompareOverlay/);
  assert.match(canvasStageSource, /compareMode !== "sideBySide"/);
  assert.match(canvasStageSource, /CompareOverlay/);
});

test("windows compare overlays resolve the left source through the full-media helper", () => {
  assert.match(canvasStageSource, /leftUrl=\{historyFullSrc\(compareB, null\)\}/);
  assert.match(canvasStageSource, /rightUrl=\{historyFullSrc\(currentImage, null\)\}/);
  assert.doesNotMatch(canvasStageSource, /leftUrl=\{compareB\.fullUrl \|\| compareB\.previewUrl\}/);
});

test("toolbar buttons keep framed and selected states", () => {
  assert.ok(toolbarPrimitivesSource.includes("border border-black/[0.14] bg-[var(--surface)]"));
  assert.ok(toolbarPrimitivesSource.includes("aria-pressed={active !== undefined ? active : undefined}"));
  assert.ok(toolbarPrimitivesSource.includes("aria-pressed={selected !== undefined ? selected : undefined}"));
  assert.ok(toolbarPrimitivesSource.includes("dark:border-white/[0.14] dark:bg-white/[0.04]"));
  assert.ok(toolbarPrimitivesSource.includes("hover:border-[color:var(--accent)]/45"));
  assert.ok(toolbarPrimitivesSource.includes("border border-[color:var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] shadow-sm"));
  assert.ok(toolbarPrimitivesSource.includes("platform-pill inline-flex shrink-0 items-center justify-center gap-1"));
  assert.ok(toolbarPrimitivesSource.includes("liquid-primary-button inline-flex shrink-0 items-center justify-center gap-1.5 border border-[color:var(--accent)]"));
});

test("canvas toolbar buttons keep framed and selected states", () => {
  assert.ok(windowsControlsSource.includes(".canvas-toolbar .platform-icon-btn"));
  assert.ok(windowsControlsSource.includes("border: 1px solid color-mix(in srgb, var(--border) 92%, transparent);"));
  assert.ok(windowsControlsSource.includes("background: color-mix(in srgb, var(--surface) 98%, white 2%);"));
  assert.ok(windowsControlsSource.includes(".canvas-toolbar .platform-icon-btn:hover,"));
  assert.ok(windowsControlsSource.includes(".canvas-toolbar .platform-pill:hover"));
  assert.ok(windowsControlsSource.includes(".canvas-toolbar .platform-icon-btn[aria-pressed=\"true\"]"));
  assert.ok(windowsControlsSource.includes(".canvas-toolbar .platform-pill[aria-pressed=\"true\"]"));
  assert.ok(toolbarPrimitivesSource.includes("border border-black/[0.14] bg-[var(--surface)]"));
  assert.ok(toolbarPrimitivesSource.includes("aria-pressed={active !== undefined ? active : undefined}"));
  assert.ok(toolbarPrimitivesSource.includes("aria-pressed={selected !== undefined ? selected : undefined}"));
  assert.ok(toolbarPrimitivesSource.includes("dark:border-white/[0.14] dark:bg-white/[0.04]"));
});
