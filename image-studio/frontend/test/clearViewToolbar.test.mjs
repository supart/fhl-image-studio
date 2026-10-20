import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const toolbarSource = await readFile(new URL("../src/components/canvas/Toolbar.tsx", import.meta.url), "utf8");
const sectionsSource = await readFile(new URL("../src/components/canvas/toolbarActionSections.tsx", import.meta.url), "utf8");

test("clearing the view keeps the canvas tool and transform groups mounted", () => {
  assert.match(toolbarSource, /const showToolSection = true;/);
  assert.match(toolbarSource, /const showTransformSection = true;/);
  assert.match(toolbarSource, /const hasTransformTools = true;/);
  assert.doesNotMatch(toolbarSource, /undoDisabled=\{/);
  assert.doesNotMatch(toolbarSource, /redoDisabled=\{/);
  assert.doesNotMatch(toolbarSource, /const showToolSection = hasImage;/);
  assert.doesNotMatch(toolbarSource, /const showTransformSection = !!currentImage;/);
});

test("empty-view tool actions stay visible but disabled", () => {
  assert.doesNotMatch(sectionsSource, /if \(!hasImage\) return null;/);
  assert.match(sectionsSource, /active=\{tool === "pan"\} disabled=\{!hasImage\}/);
  assert.match(sectionsSource, /active=\{tool === "mask"\} disabled=\{!hasImage\}/);
  assert.match(sectionsSource, /dataAuditId="annotation-tool-entry"/);
  assert.match(sectionsSource, /disabled=\{!hasImage\}/);
  assert.match(sectionsSource, /图像标注工具/);
  assert.match(sectionsSource, /ChevronDown/);
  assert.match(sectionsSource, /ChevronUp/);
  assert.doesNotMatch(sectionsSource, /title="画框标注 \(3\)"/);
  assert.doesNotMatch(sectionsSource, /undoDisabled|redoDisabled|undoShortcutLabel|redoShortcutLabel/);
  assert.match(sectionsSource, /onClick=\{onToggleMobileAdjust\}[\s\S]+disabled=\{!currentImageSavedPath\}/);
});

test("stale rectangle annotations cannot expose crop on an empty view", () => {
  const guardedCropActions = toolbarSource.match(/cropAction=\{hasImage && !isAndroidPhone && selRect/g) ?? [];
  assert.equal(guardedCropActions.length, 3);
  assert.doesNotMatch(toolbarSource, /cropAction=\{!isAndroidPhone && selRect/);
});

test("compare controls remain mounted after clear but cannot act without a current image", () => {
  assert.match(toolbarSource, /const showCompareToggle = !resultGridOpen && !historyGalleryOpen;/);
  assert.match(toolbarSource, /const compareDisabled = !currentImage \|\| \(!compareActive && !compareSource\);/);
  assert.match(sectionsSource, /<ToolbarTextButton[\s\S]+disabled=\{compareDisabled\}[\s\S]+双图对比/);
  assert.match(sectionsSource, /<ToolbarTextButton[\s\S]+disabled=\{compareDisabled\}[\s\S]+卷帘对比/);
});

test("windows transform actions stay in the first toolbar row when annotations expand", () => {
  const windowsToolbarStart = toolbarSource.lastIndexOf("return (\n    <>");
  const transformBlock = toolbarSource.indexOf("{showTransformSection ? (", windowsToolbarStart);
  const contextualBlock = toolbarSource.indexOf("{showMaskTools || showAnnotationTools || showViewReset ? (", windowsToolbarStart);
  assert.ok(windowsToolbarStart >= 0);
  assert.ok(transformBlock >= 0);
  assert.ok(contextualBlock >= 0);
  assert.ok(transformBlock < contextualBlock);
});
