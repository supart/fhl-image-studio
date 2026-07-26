import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const modalSource = await readFile(new URL("../src/components/panorama/PanoramaPastebackAlignModal.tsx", import.meta.url), "utf8");
const coreSource = await readFile(new URL("../src/panorama/core.ts", import.meta.url), "utf8");
const panoCssSource = await readFile(new URL("../src/components/panorama/panoramaTy360.css", import.meta.url), "utf8");

test("manual pasteback align modal exposes original compare and color controls", () => {
  assert.match(modalSource, /showOriginalForCompare \? 0 : maskEffectPreviewActive \? 1 : compareMode === "curtain" \? 1 : opacity/);
  assert.match(modalSource, /setOpacity\(1\)/);
  assert.match(modalSource, /label="明暗"/);
  assert.match(modalSource, /label="对比度"/);
  assert.match(modalSource, /label="色相"/);
  assert.match(modalSource, /hue-rotate\(\$\{alignment\.hueRotationDeg \?\? 0\}deg\)/);
});

test("manual pasteback align modal includes a curtain compare mode", () => {
  assert.match(modalSource, /卷帘对比/);
  assert.match(modalSource, /compareMode === "curtain" \? `inset\(0 0 0 \$\{curtainSplit \* 100\}%\)` : "none"/);
  assert.match(modalSource, /pano-align-curtain-handle/);
  assert.match(modalSource, /updateCurtainSplit\(event\.clientX, previewElement\)/);
  assert.match(modalSource, /disabled=\{compareMode === "curtain"\}/);
  assert.match(panoCssSource, /\.pano-align-curtain-handle/);
});

test("manual pasteback preview fits tall edited shots into the visible modal frame", () => {
  assert.match(modalSource, /const \[viewportHeight, setViewportHeight\]/);
  assert.match(modalSource, /const previewMaxHeight = Math\.min\(820, Math\.max\(360, viewportHeight - 190\)\)/);
  assert.match(modalSource, /const previewFitWidth = preview/);
  assert.match(modalSource, /width: `min\(100%, \$\{Math\.round\(previewFitWidth\)\}px\)`/);
  assert.match(modalSource, /maxHeight: `\$\{Math\.round\(previewMaxHeight\)\}px`/);
  assert.match(panoCssSource, /justify-self: center/);
});

test("manual pasteback align modal includes a local fine mask tab", () => {
  assert.match(modalSource, /type AlignPanel = "align" \| "mask" \| "color"/);
  assert.match(modalSource, /启用精细蒙版/);
  assert.match(modalSource, /maskCanvasRef/);
  assert.match(modalSource, /const usesFineMask = maskEnabled && maskHasContent && maskCanvas/);
  assert.match(modalSource, /alignment: usesFineMask \? \{ \.\.\.alignment, featherFraction: 0 \} : alignment/);
  assert.match(modalSource, /pasteMask: usesFineMask/);
  assert.match(modalSource, /请先绘制贴回区域，或关闭精细蒙版/);
  assert.match(modalSource, /drawMaskStroke/);
  assert.match(modalSource, /undoMask/);
  assert.match(modalSource, /redoMask/);
  assert.match(modalSource, /maskPreviewMode/);
  assert.match(modalSource, /previewMaskEffect/);
  assert.match(modalSource, /const maskEffectPreviewActive = maskEnabled && maskPreviewMode/);
  assert.match(modalSource, /setActivePanel\("color"\)/);
  assert.match(modalSource, /maskPreviewDataURL/);
  assert.match(modalSource, /WebkitMaskImage/);
  assert.match(modalSource, /label="蒙版羽化" value=\{maskFeatherPx\}/);
  assert.match(panoCssSource, /\.pano-align-mask-layer/);
  assert.match(panoCssSource, /\.pano-align-mask-layer\.is-previewing/);
  assert.match(panoCssSource, /\.pano-align-mask-cursor/);
  assert.match(panoCssSource, /\.pano-align-tabs/);
});

test("places each feather control beside the geometry it affects", () => {
  const controlsStart = modalSource.indexOf('<div className="pano-align-controls">');
  const alignPanelStart = modalSource.indexOf('{activePanel === "align" ? (', controlsStart);
  const maskPanelStart = modalSource.indexOf('{activePanel === "mask" ? (', alignPanelStart);
  const colorPanelStart = modalSource.indexOf('{activePanel === "color" ? (', maskPanelStart);
  assert.ok(controlsStart >= 0 && alignPanelStart > controlsStart && maskPanelStart > alignPanelStart && colorPanelStart > maskPanelStart);
  const alignPanel = modalSource.slice(alignPanelStart, maskPanelStart);
  const maskPanel = modalSource.slice(maskPanelStart, colorPanelStart);
  const colorPanel = modalSource.slice(colorPanelStart);

  assert.match(alignPanel, /label="边缘羽化"/);
  assert.match(alignPanel, /featherFraction/);
  assert.match(maskPanel, /label="蒙版羽化"/);
  assert.match(maskPanel, /maskFeatherPx/);
  assert.doesNotMatch(colorPanel, /label="(?:边缘|蒙版)羽化"/);
});

test("manual pasteback color adjustments participate in the final pasteback blend", () => {
  assert.match(coreSource, /brightness: Number\.isFinite\(brightness\) \? clamp\(brightness, 0\.5, 1\.5\) : undefined/);
  assert.match(coreSource, /contrast: Number\.isFinite\(contrast\) \? clamp\(contrast, 0\.5, 1\.5\) : undefined/);
  assert.match(coreSource, /hueRotationDeg: Number\.isFinite\(hueRotationDeg\) \? clamp\(hueRotationDeg, -180, 180\) : undefined/);
  assert.match(coreSource, /function applyPastebackColorAdjustments/);
  assert.match(coreSource, /hueRotationDeg \* DEG2RAD/);
  assert.match(coreSource, /const \[r, g, b\] = applyPastebackColorAdjustments\(rgba, normalizedAlignment\);/);
  assert.match(coreSource, /output\[offset\] = r \* alpha \+ output\[offset\] \* \(1 - alpha\);/);
});

test("manual pasteback mask participates in the final pasteback alpha", () => {
  assert.match(coreSource, /export type PanoramaPastebackMaskInput/);
  assert.match(coreSource, /function imageToPastebackMask/);
  assert.match(coreSource, /const mask = imageToPastebackMask\(pasteMask\);/);
  assert.match(coreSource, /const maskAlpha = panoramaPastebackMaskAlphaAt\(mask, normalizedU, normalizedV\);/);
  assert.match(coreSource, /\) \* maskAlpha;/);
});
