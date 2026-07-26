import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const gridSource = readFileSync(new URL("../src/components/canvas/BatchResultGrid.tsx", import.meta.url), "utf8");
const stageSource = readFileSync(new URL("../src/components/canvas/CanvasStage.tsx", import.meta.url), "utf8");
const sourceStripSource = readFileSync(new URL("../src/components/canvas/SourceStrip.tsx", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../src/styles/_canvas.css", import.meta.url), "utf8");

test("batch task cards expose a hoverable source preview anchor", () => {
  assert.match(gridSource, /export type BatchGridSourcePreview/);
  assert.match(gridSource, /TaskSourcePreviewAnchor/);
  assert.match(gridSource, /createPortal/);
  assert.match(gridSource, /document\.body/);
  assert.match(gridSource, /setPopoverStyle\(\{ left, top, width \}\)/);
  assert.match(gridSource, /sourceToDataURL/);
  assert.match(gridSource, /const previewSrc = resolvedPreviewURL \|\| \(!previewUrlFailed && immediatePreviewURL \? immediatePreviewURL : ""\);/);
  assert.match(gridSource, /setResolvedPreviewURL\(""\);/);
  assert.match(gridSource, /data-open=\{open \? "true" : "false"\}/);
  assert.match(gridSource, /batch-grid-image-shell/);
  assert.match(gridSource, /batch-grid-source-anchor/);
  assert.match(gridSource, /正在读取参考图预览/);
  assert.match(gridSource, /alt="参考图预览"/);
  assert.match(gridSource, /title="点击或悬浮预览参考图"/);
  assert.doesNotMatch(gridSource, /title=\{`第 \$\{index \+ 1\} 张参考图：\$\{sourcePreview\.name\}`\}/);
  assert.doesNotMatch(gridSource, /aria-label=\{`第 \$\{index \+ 1\} 张参考图：\$\{sourcePreview\.name\}`\}/);
  assert.doesNotMatch(gridSource, /batch-grid-source-popover-title/);
  assert.doesNotMatch(gridSource, /batch-grid-source-popover-path/);
  assert.match(stageSource, /sourcePreviewHintsByPath/);
  assert.match(stageSource, /resolveSourcePreview/);
  assert.match(stageSource, /task\.batchSourcePath \|\| task\.sourceImagePaths\?\.\[0\]/);
  assert.match(cssSource, /\.batch-grid-source-anchor/);
  assert.match(cssSource, /\.batch-grid-image-shell/);
  assert.match(cssSource, /z-index: 9500/);
  assert.match(cssSource, /position: fixed/);
  assert.doesNotMatch(cssSource, /\.batch-grid-source-anchor\[data-open="true"\] \.batch-grid-source-popover/);
  assert.match(cssSource, /\.batch-grid-source-popover/);
});

test("batch task source preview control stays out of the crowded top row", () => {
  assert.match(cssSource, /\.batch-grid-source-anchor \{[^}]*left: 8px;[^}]*top: 34px;[^}]*transform: none;/);
  assert.doesNotMatch(cssSource, /\.batch-grid-source-anchor \{[^}]*left: 50%;[^}]*transform: translateX\(-50%\);/);
  assert.match(cssSource, /\.batch-grid\[data-density="dense"\] \.batch-grid-source-anchor,[\s\S]*?\.batch-grid\[data-density="micro"\] \.batch-grid-source-anchor \{[^}]*left: 5px;[^}]*top: 27px;[^}]*font-size: 8px;/);
});

test("source strip shows fixed reference slots plus one movable batch queue tile", () => {
  assert.match(sourceStripSource, /const editSourceMode = useStudioStore\(\(s\) => s\.editSourceMode\);/);
  assert.match(sourceStripSource, /const batchProcess = useStudioStore\(\(s\) => s\.batchProcess\);/);
  assert.match(sourceStripSource, /const batchMode = editSourceMode === "batch";/);
  assert.match(sourceStripSource, /clampBatchQueueSlotIndex/);
  assert.match(sourceStripSource, /batchSourceSlotIndex = batchMode/);
  assert.match(sourceStripSource, /Array\.from\(\{ length: sources\.length \+ 1 \}/);
  assert.doesNotMatch(sourceStripSource, /batchMode \? \(\s*batchProcess\.discoveredSources\.map/s);
  assert.match(sourceStripSource, /<BatchQueueStripTile/);
  assert.match(sourceStripSource, /const batchQueueTriggerRef = useRef<HTMLDivElement \| null>\(null\);/);
  assert.match(sourceStripSource, /triggerRef=\{batchQueueTriggerRef\}/);
  assert.match(sourceStripSource, /data-audit-id="batch-source-queue-tile"/);
  assert.match(sourceStripSource, /data-audit-id="select-fixed-source-image"/);
  assert.match(sourceStripSource, /data-audit-id="select-batch-source-images"/);
  assert.match(sourceStripSource, /data-audit-id="move-batch-source-slot-left"/);
  assert.match(sourceStripSource, /data-audit-id="move-batch-source-slot-right"/);
  assert.match(sourceStripSource, /onMoveLeft=\{\(\) => setBatchQueueSlotIndex\(batchSourceSlotIndex - 1\)\}/);
  assert.match(sourceStripSource, /onMoveRight=\{\(\) => setBatchQueueSlotIndex\(batchSourceSlotIndex \+ 1\)\}/);
  assert.match(sourceStripSource, /ref=\{triggerRef\}/);
  assert.match(sourceStripSource, /role="button"/);
  assert.match(sourceStripSource, /aria-expanded=\{open \? "true" : "false"\}/);
  assert.match(sourceStripSource, /onToggleOpen=\{\(\) => setBatchQueueOpen\(true\)\}/);
  assert.doesNotMatch(sourceStripSource, /pointerToggledRef/);
  assert.doesNotMatch(sourceStripSource, /onPointerDown=\{\(event\) => \{[\s\S]{0,220}onToggleOpen\(\);/);
  assert.doesNotMatch(sourceStripSource, /onMouseDown=\{\(event\) => \{[\s\S]{0,220}onToggleOpen\(\);/);
  assert.match(sourceStripSource, /onClick=\{\(event\) => \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\);[\s\S]*?onToggleOpen\(\);/);
  assert.match(sourceStripSource, /onKeyDown=\{\(event\) => \{/);
  assert.match(sourceStripSource, /event\.key !== "Enter" && event\.key !== " "/);
  assert.match(sourceStripSource, /className=\{`batch-source-queue-tile/);
  assert.match(sourceStripSource, /pointer-events-none flex h-9 w-9/);
  assert.match(sourceStripSource, /draggable=\{false\}/);
  assert.match(sourceStripSource, /pointer-events-none min-w-0 flex-1/);
  assert.doesNotMatch(sourceStripSource, /data-audit-id="batch-source-queue-tile"[\s\S]{0,400}className=\{`source-thumb/);
  assert.match(sourceStripSource, /data-audit-id="batch-source-queue-popover"/);
  assert.match(sourceStripSource, /createPortal\(popover, document\.body\)/);
  assert.match(sourceStripSource, /const openedAt = Date\.now\(\);/);
  assert.match(sourceStripSource, /if \(Date\.now\(\) - openedAt < 160\) return;/);
  assert.match(sourceStripSource, /triggerRef\.current\?\.contains\(target\)/);
  assert.match(sourceStripSource, /position: "fixed"/);
  assert.match(sourceStripSource, /z-\[9200\]/);
  assert.doesNotMatch(sourceStripSource, /batch-source-queue-popover-layer/);
  assert.match(sourceStripSource, /data-audit-id="batch-source-preview-item"/);
  assert.match(sourceStripSource, /source\.path === path \? \{ \.\.\.source, selected: false \} : source/);
  assert.match(sourceStripSource, /data-selected=\{active \? "true" : "false"\}/);
  assert.doesNotMatch(sourceStripSource, /\{source\.name\}\s*<\/div>/);
});

test("reference thumbnails can switch the compare source with a single click while compare is open", () => {
  assert.ok(sourceStripSource.includes("const currentImage = useStudioStore((s) => s.currentImage);"));
  assert.ok(sourceStripSource.includes("const compareB = useStudioStore((s) => s.compareB);"));
  assert.ok(sourceStripSource.includes("const setCompareB = useStudioStore((s) => s.setCompareB);"));
  assert.ok(sourceStripSource.includes("materializeCompareSourceAsHistoryItem"));
  assert.ok(sourceStripSource.includes("const useSourceAsCompare = compareB && currentImage"));
  assert.ok(sourceStripSource.includes("void setCompareB(compareItem);"));
  assert.equal((sourceStripSource.match(/onUseAsCompare=\{useSourceAsCompare\}/g) ?? []).length, 2);
  assert.ok(sourceStripSource.includes("void onUseAsCompare(source);"));
  assert.ok(sourceStripSource.includes('onUseAsCompare ? "cursor-pointer" : "cursor-grab"'));
});


test("fixed reference thumbnails open a temporary source preview with a return path", () => {
  assert.match(sourceStripSource, /id: `source-preview-\$\{Date\.now\(\)\.toString\(36\)\}-/);
  assert.match(sourceStripSource, /prompt: `\(参考图\) \$\{source\.name\}`/);
  assert.match(sourceStripSource, /state\.openSourcePreview\(item\)/);
  assert.match(sourceStripSource, /已在画布打开参考图大图/);
  assert.doesNotMatch(sourceStripSource, /state\.setField\("currentImage", item\)/);
});
