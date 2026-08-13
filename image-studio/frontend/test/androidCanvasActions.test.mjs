import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const canvasWorkspace = readFileSync(
  new URL("../src/platform/android/canvas/AndroidCanvasWorkspace.tsx", import.meta.url),
  "utf8",
);
const canvasStage = readFileSync(
  new URL("../src/platform/android/canvas/AndroidCanvasStage.tsx", import.meta.url),
  "utf8",
);
const androidCanvasCss = readFileSync(
  new URL("../src/styles/_android-canvas.css", import.meta.url),
  "utf8",
);
const appHeader = readFileSync(
  new URL("../src/components/layout/AppHeader.tsx", import.meta.url),
  "utf8",
);
const indexCss = readFileSync(
  new URL("../src/styles/index.css", import.meta.url),
  "utf8",
);
const androidShell = readFileSync(
  new URL("../src/platform/android/AndroidShell.tsx", import.meta.url),
  "utf8",
);

test("Android canvas dock exposes desktop-like current image actions", () => {
  assert.match(canvasWorkspace, /MoreHorizontal/);
  assert.match(canvasWorkspace, /imageActionsOpen/);
  assert.match(canvasWorkspace, /title="更多操作"/);
  assert.match(canvasWorkspace, /AndroidCurrentImageActionSheet/);
  assert.match(canvasWorkspace, /aria-label="当前图操作"/);
  assert.match(canvasWorkspace, /saveCurrentImageAs/);
  assert.match(canvasWorkspace, /materializeCurrentImage/);
  assert.match(canvasWorkspace, /copyImageURLToClipboard/);
  assert.match(canvasWorkspace, /copyImageB64ToClipboard/);
  assert.match(canvasWorkspace, /shareCurrentImage/);
  assert.match(canvasWorkspace, /reuseAsSource/);
  assert.match(canvasWorkspace, /title="保存原图"/);
  assert.match(canvasWorkspace, /title="复制图片"/);
  assert.match(canvasWorkspace, /title="分享图片"/);
  assert.match(canvasWorkspace, /title="设为图生图源图"/);
  assert.match(canvasWorkspace, /<Save \/>/);
  assert.match(canvasWorkspace, /<Clipboard \/>/);
  assert.match(canvasWorkspace, /<Share2 \/>/);
  assert.match(canvasWorkspace, /<Scissors \/>/);
  assert.match(canvasWorkspace, /runAction\(copyCurrentImage, 8\)/);
  assert.match(canvasWorkspace, /runAction\(shareCurrentImage, 8\)/);
  assert.match(androidCanvasCss, /\.android-canvas-action-sheet/);
  assert.match(androidCanvasCss, /\.android-canvas-action-grid/);
  assert.match(androidCanvasCss, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test("Android source strip can preview a reference image on the canvas", () => {
  assert.match(canvasWorkspace, /sourceToDataURL/);
  assert.match(canvasWorkspace, /const previewSourceOnCanvas = async \(source: SourceImage\) =>/);
  assert.match(canvasWorkspace, /prompt: `\(参考图\) \$\{source\.name\}`/);
  assert.match(canvasWorkspace, /setField\("currentImage", preview\)/);
  assert.match(canvasWorkspace, /setField\("resultGridOpen", false\)/);
  assert.match(canvasWorkspace, /onPreview=\{\(source\) => runAction\(\(\) => previewSourceOnCanvas\(source\), 6\)\}/);
  assert.match(canvasWorkspace, /onPreview: \(source: SourceImage\) => void;/);
  assert.match(canvasWorkspace, /className="android-canvas-source-preview"/);
  assert.match(canvasWorkspace, /title="打开参考图大图"/);
  assert.match(canvasWorkspace, /function dataURLBase64\(dataURL: string\): string/);
});

test("Android canvas keeps the image-to-image source strip resident without the old empty import card", () => {
  assert.match(canvasWorkspace, /const isEditMode = mode === "edit";/);
  assert.match(canvasWorkspace, /const shouldShowSourceStrip = isEditMode;/);
  assert.match(canvasWorkspace, /data-has-source-strip=\{shouldShowSourceStrip \? "true" : "false"\}/);
  assert.match(canvasWorkspace, /sourceOpen=\{shouldShowSourceStrip\}/);
  assert.match(canvasWorkspace, /onToggleSources=\{\(\) => runAction\(\(\) => setSourceOpen\(true\), 5\)\}/);
  assert.doesNotMatch(canvasWorkspace, /AndroidCanvasEmptyState/);
  assert.doesNotMatch(canvasWorkspace, /className="android-canvas-empty"/);
  assert.doesNotMatch(canvasWorkspace, /还没有图片/);
  assert.doesNotMatch(canvasWorkspace, /先导入一张图/);
  assert.doesNotMatch(canvasWorkspace, /去参数页/);
  assert.match(canvasWorkspace, /<AndroidSourceStrip/);
  assert.match(canvasWorkspace, /sources\.length > 0 \? \(\s*<button type="button" onClick=\{onClear\}>/);
  assert.match(androidCanvasCss, /\.android-canvas-source-strip/);
  assert.match(androidCanvasCss, /\.android-canvas-source-add/);
});

test("Android canvas can exit image compare without returning to history", () => {
  assert.match(canvasWorkspace, /compareB/);
  assert.match(canvasWorkspace, /setCompareB/);
  assert.match(canvasWorkspace, /compareActive=\{!!compareB\}/);
  assert.match(canvasWorkspace, /onExitCompare=\{compareB \? \(\) => runAction\(\(\) => setCompareB\(null\), 6\) : undefined\}/);
  assert.match(canvasWorkspace, /className="android-canvas-status-chip compare-exit"/);
  assert.match(canvasWorkspace, /title="退出对比"/);
  assert.match(canvasWorkspace, /<Split className="h-3\.5 w-3\.5" \/> 退出/);
  assert.match(androidCanvasCss, /html\[data-platform="android"\] \.android-canvas-status-chip\.compare-exit/);
});

test("Android single running canvas renders one pending placeholder", () => {
  assert.match(canvasStage, /const showingSingleLivePlaceholder = isRunning && visibleBatchSlotCount === 1 && !showingResultGrid && !currentImage;/);
  assert.match(canvasStage, /<AndroidSinglePendingPreview/);
  assert.match(canvasStage, /apiLabel=\{apiLabelForBatchIndex\(0\)\}/);
  assert.match(canvasStage, /className="batch-grid-overlay android-single-live-placeholder"/);
  assert.match(canvasStage, /gridTemplateColumns: "minmax\(0, 1fr\)"/);
  assert.match(canvasStage, /aria-label="等待第 1 张预览"/);
});

test("Android canvas keeps failed continuous job slots visible after running state clears", () => {
  assert.match(canvasWorkspace, /jobGroupsByWorkspace: state\.jobGroupsByWorkspace/);
  assert.match(canvasWorkspace, /const workspaceJobGroups = jobGroupsByWorkspace\[activeWorkspaceId\] \?\? \[\];/);
  assert.match(canvasWorkspace, /const displayJobGroups = androidCanvasScopedJobGroups\(workspaceJobGroups, isRunning\);/);
  assert.match(canvasWorkspace, /const jobGroupSlotCount = displayJobGroups\.reduce/);
  assert.match(canvasWorkspace, /const batchSlotCount = Math\.max\(jobsTotal, batchResults\.length, jobGroupSlotCount\);/);
  assert.match(canvasStage, /const workspaceJobGroups = jobGroupsByWorkspace\[activeWorkspaceId\] \?\? \[\];/);
  assert.match(canvasStage, /export function androidJobGroupHasLiveSlots\(group: JobGroupSnapshot\)/);
  assert.match(canvasStage, /slot\.status === "queued" \|\| slot\.status === "running"/);
  assert.match(canvasStage, /export function androidJobGroupSlotCount\(group: JobGroupSnapshot \| null \| undefined\)/);
  assert.match(canvasStage, /export function androidCanvasScopedJobGroups\(groups: JobGroupSnapshot\[\], isRunning: boolean\)/);
  assert.match(canvasStage, /if \(isRunning\) return liveGroups;/);
  assert.match(canvasStage, /const latest = latestGroup\(groups\);/);
  assert.match(canvasStage, /return latest \? \[latest\] : \[\];/);
  assert.match(canvasStage, /const displayJobGroups = androidCanvasScopedJobGroups\(workspaceJobGroups, isRunning\);/);
  assert.match(canvasStage, /const jobGroupSlotCount = displayJobGroups\.reduce/);
  assert.match(canvasStage, /const activeJobGroup = latestGroup\(displayJobGroups\);/);
  assert.match(canvasStage, /const jobEntryGroups = displayJobGroups;/);
  assert.doesNotMatch(canvasStage, /const jobEntryGroups = isRunning \? workspaceJobGroups : displayJobGroups;/);
  assert.doesNotMatch(canvasStage, /const jobGroupSlotCount = workspaceJobGroups\.reduce/);
  assert.match(canvasStage, /jobsTotal,\s*jobGroupSlotCount,\s*batchResults\.length \+ runningJobs\.length/s);
  assert.match(canvasStage, /const completedBatchSlots: BatchGridSlot\[\] = liveBatchSlots\.map/);
  assert.match(canvasStage, /type: "failed"/);
  assert.match(canvasStage, /jobSlot: entry\?\.slot/);
  assert.match(canvasStage, /const activeJobGroupHasFailedSlot = activeJobGroup\?\.slots\.some/);
  assert.match(canvasStage, /slot\.status === "failed" \|\| slot\.status === "interrupted" \|\| slot\.status === "cancelled"/);
  assert.match(canvasStage, /const showingCompletedBatchGrid = !isRunning && \(resultGridOpen \|\| activeJobGroupHasFailedSlot\) && visibleBatchSlotCount > 1;/);
});

test("Android single image canvas shows the API label chip from the result item", () => {
  assert.match(canvasWorkspace, /import \{ historySourceLabel \} from "\.\.\/history\/historySourceLabel";/);
  assert.match(canvasWorkspace, /currentImage && \(currentImage\.apiLabel\?\.trim\(\) \|\| currentImage\.apiMode\)/);
  assert.match(canvasWorkspace, /historySourceLabel\(currentImage\)/);
  assert.match(canvasWorkspace, /className="android-canvas-source-label"/);
  assert.match(canvasWorkspace, /title=\{`API:\$\{currentApiLabel\}`\}>\{currentApiLabel\}<\/span>/);
  assert.match(canvasWorkspace, /hasImage && currentApiLabel/);
});

test("Android waiting canvas avoids expensive blur and checker animations", () => {
  assert.match(canvasStage, /import Konva from "konva";/);
  assert.match(canvasStage, /Konva\.pixelRatio = ANDROID_KONVA_PIXEL_RATIO;/);
  assert.doesNotMatch(canvasStage, /Konva\.Filters\.Blur/);
  assert.doesNotMatch(canvasStage, /blurRadius=\{isCurrentStreamPreview/);
  assert.doesNotMatch(appHeader, /backdrop-blur-2xl android-app-header/);
  assert.doesNotMatch(canvasWorkspace, /Loader2/);
  assert.match(canvasWorkspace, /className="android-canvas-spinner/);
  assert.doesNotMatch(androidCanvasCss, /android-canvas-progress-head svg \{[^}]*animation:/);
  assert.doesNotMatch(androidCanvasCss, /\.android-canvas-progress\.android-canvas-progress-compose \{[^}]*backdrop-filter: blur/);
  assert.doesNotMatch(androidCanvasCss, /\.android-canvas-action-layer \{[^}]*backdrop-filter: blur/);
  assert.match(androidCanvasCss, /html\[data-platform="android"\] \.android-stage-host \{[\s\S]*animation: none !important;/);
  assert.match(androidCanvasCss, /html\[data-platform="android"\] \.stage-canvas-wrap\.stream-preview-blur canvas \{[\s\S]*filter: none !important;/);
  assert.match(androidCanvasCss, /--android-backdrop-filter-none: none;/);
  assert.match(androidCanvasCss, /html\[data-platform="android"\] \.android-app-header \{[\s\S]*backdrop-filter: var\(--android-backdrop-filter-none\) !important;/);
  assert.ok(indexCss.indexOf('@import "./_canvas.css";') < indexCss.indexOf('@import "./_android-canvas.css";'));
  assert.match(androidCanvasCss, /html\[data-platform="android"\] \.batch-grid-pending-ring \{[\s\S]*animation: none !important;/);
  assert.match(androidCanvasCss, /html\[data-platform="android"\] \.batch-grid-tile\.previewing img \{[\s\S]*filter: none !important;[\s\S]*transform: none !important;/);
  assert.match(androidCanvasCss, /html\[data-platform="android"\] \.batch-grid-tile\.previewing::after \{[\s\S]*box-shadow: none !important;/);
  assert.match(androidCanvasCss, /html\[data-platform="android"\] \.batch-grid-index,[\s\S]*html\[data-platform="android"\] \.batch-grid-pixels,[\s\S]*backdrop-filter: none !important;[\s\S]*filter: none !important;/);
  assert.match(androidCanvasCss, /html\[data-platform="android"\] \.batch-grid-preview-wait,[\s\S]*html\[data-platform="android"\] \.android-canvas-workspace\[data-running="true"\] \.batch-grid-preview-wait \{[\s\S]*box-shadow: none !important;[\s\S]*backdrop-filter: none !important;[\s\S]*filter: none !important;/);
  assert.match(androidCanvasCss, /html\[data-platform="android"\] \.android-canvas-workspace\[data-running="true"\] \.batch-grid-index,[\s\S]*html\[data-platform="android"\] \.android-canvas-workspace\[data-running="true"\] \.batch-grid-pixels \{[\s\S]*box-shadow: none !important;[\s\S]*backdrop-filter: none !important;[\s\S]*filter: none !important;/);
  assert.match(androidCanvasCss, /-webkit-backdrop-filter: none !important;/);
  assert.match(androidCanvasCss, /\.android-canvas-workspace\[data-running="true"\] \.stream-preview-image-cover,[\s\S]*\.android-canvas-workspace\[data-running="true"\] \.stream-preview-overlay \{[\s\S]*contain: layout paint style;[\s\S]*filter: none !important;/);
  assert.match(androidCanvasCss, /\.android-canvas-workspace\[data-running="true"\] \.batch-grid-overlay,[\s\S]*\.android-canvas-workspace\[data-running="true"\] \.batch-grid \{[\s\S]*contain: layout paint style;/);
  assert.match(androidCanvasCss, /\.android-canvas-workspace\[data-running="true"\] \.batch-grid-tile \{[\s\S]*box-shadow: none !important;[\s\S]*transition: none !important;/);
  assert.match(androidCanvasCss, /\.android-canvas-workspace\[data-running="true"\] \.batch-grid-tile:hover \{[\s\S]*transform: none !important;/);
  assert.match(androidCanvasCss, /\.android-canvas-workspace\[data-running="true"\] \.batch-grid-tile\.pending \{[\s\S]*background: var\(--surface\) !important;/);
  assert.match(canvasWorkspace, /data-running=\{isRunning \? "true" : "false"\}/);
  assert.match(canvasStage, /data-running=\{isRunning \? "true" : "false"\}/);
  assert.match(androidCanvasCss, /html\[data-platform="android"\] \.android-stage-host\[data-running="true"\] \{[\s\S]*background-image: none !important;/);
  assert.match(androidCanvasCss, /\.android-canvas-workspace\[data-running="true"\] \.android-canvas-status-dot \.android-canvas-spinner \{[\s\S]*animation: none !important;/);
  assert.match(androidCanvasCss, /\.android-canvas-workspace\[data-running="true"\] \.android-canvas-progress \.android-canvas-spinner-progress \{[\s\S]*animation: none !important;/);
});

test("Android canvas isolates progress ticks from heavy canvas renders", () => {
  assert.match(canvasWorkspace, /import \{ shallow \} from "zustand\/shallow";/);
  assert.match(canvasStage, /import \{ shallow \} from "zustand\/shallow";/);
  assert.doesNotMatch(canvasWorkspace, /\}\s*=\s*useStudioStore\(\);/);
  assert.doesNotMatch(canvasStage, /\}\s*=\s*useStudioStore\(\);/);
  assert.match(canvasWorkspace, /progressStage: state\.progress\?\.stage/);
  assert.match(canvasWorkspace, /function AndroidCanvasProgressOverlayLive\(\)/);
  assert.match(canvasWorkspace, /elapsed: quantizeProgressElapsed\(state\.progress\?\.elapsed\)/);
  assert.match(canvasWorkspace, /bytes: quantizeProgressBytes\(state\.progress\?\.bytes\)/);
  assert.match(canvasWorkspace, /function quantizeProgressElapsed\(elapsed\?: number\)/);
  assert.match(canvasWorkspace, /Math\.floor\(elapsed\)/);
  assert.match(canvasWorkspace, /function quantizeProgressBytes\(bytes\?: number\)/);
  assert.match(canvasWorkspace, /128 \* 1024/);
  assert.match(canvasStage, /useStudioStore\(\(state\) => \(\{/);
  assert.match(canvasStage, /setHostSize\(\(prev\) => \(prev\.w === w && prev\.h === h \? prev : \{ w, h \}\)\)/);
  assert.match(canvasStage, /Math\.abs\(useStudioStore\.getState\(\)\.viewZoom - view\.scale\) > 0\.001/);
  assert.match(canvasStage, /const hasStrokeLayer = strokes\.length > 0 \|\| !!activeStroke;/);
  assert.match(canvasStage, /const hasAnnotationLayer = annotations\.length > 0 \|\| !!drag \|\| !!activeFreehand;/);
  assert.match(canvasStage, /\{hasStrokeLayer \? \(/);
  assert.match(canvasStage, /\{hasAnnotationLayer \? \(/);
  assert.match(canvasStage, /perfectDrawEnabled=\{false\}/);
  assert.match(canvasStage, /<Layer listening=\{false\}>/);
  assert.match(canvasStage, /<Layer listening=\{effectiveTool === "annotate"\}>/);
  assert.match(androidCanvasCss, /html\[data-platform="android"\] \.android-canvas-stage-panel \{[\s\S]*contain: layout paint style;/);
  assert.match(androidCanvasCss, /html\[data-platform="android"\] \.android-canvas-progress \{[\s\S]*contain: layout paint style;/);
  assert.match(androidCanvasCss, /html\[data-platform="android"\] \.android-canvas-progress \{[\s\S]*will-change: transform;/);
  assert.match(androidCanvasCss, /html\[data-platform="android"\] \.android-canvas-progress \{[\s\S]*min-height: 68px;/);
  assert.match(androidCanvasCss, /html\[data-platform="android"\] \.android-canvas-progress-meta span \{[\s\S]*min-width: 44px;/);
});

test("Android canvas hides the live polling overlay on the canvas page", () => {
  assert.match(canvasWorkspace, /progressStage: state\.progress\?\.stage/);
  assert.match(canvasWorkspace, /function AndroidCanvasProgressOverlayLive\(\)/);
  assert.doesNotMatch(canvasWorkspace, /\{isRunning \? <AndroidCanvasProgressOverlayLive \/> : null\}/);
});

test("Android shell only mounts the active heavy workspace panes", () => {
  assert.match(androidShell, /const mountCompose = androidView === "compose";/);
  assert.match(androidShell, /const mountCanvas = androidView === "canvas" \|\| usePadWorkspace \|\| fullscreen;/);
  assert.match(androidShell, /const mountHistory = androidView === "history";/);
  assert.match(androidShell, /\{mountCompose \? <ControlPanel \/> : null\}/);
  assert.match(androidShell, /\{mountCanvas \? \(/);
  assert.match(androidShell, /\{mountHistory \? <HistoryRail \/> : null\}/);
  assert.doesNotMatch(androidShell, /\n\s*<ControlPanel \/>\n\s*<div className="canvas-shell">[\s\S]*?<HistoryRail \/>\n/);
});
