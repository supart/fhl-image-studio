import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const gridSource = await readFile(new URL("../src/components/canvas/BatchResultGrid.tsx", import.meta.url), "utf8");
const displayOrderSource = await readFile(new URL("../src/components/canvas/batchGridDisplayOrder.ts", import.meta.url), "utf8");
const canvasStageSource = await readFile(new URL("../src/components/canvas/CanvasStage.tsx", import.meta.url), "utf8");
const toolbarSource = await readFile(new URL("../src/components/canvas/Toolbar.tsx", import.meta.url), "utf8");
const toolbarActionsSource = await readFile(new URL("../src/components/canvas/toolbarActionSections.tsx", import.meta.url), "utf8");
const mediaStoreSource = await readFile(new URL("../src/state/studioStore.media.ts", import.meta.url), "utf8");
const imageStoreSource = await readFile(new URL("../src/state/studioStore.images.ts", import.meta.url), "utf8");
const submitBarSource = await readFile(new URL("../src/components/panel/SubmitBar.tsx", import.meta.url), "utf8");
const controlPanelSource = await readFile(new URL("../src/components/panel/ControlPanel.tsx", import.meta.url), "utf8");
const workspaceBarSource = await readFile(new URL("../src/components/layout/WorkspaceBar.tsx", import.meta.url), "utf8");
const storeSource = await readFile(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
const storeTypesSource = await readFile(new URL("../src/state/studioStore.types.ts", import.meta.url), "utf8");
const historyRailSource = await readFile(new URL("../src/components/history/HistoryRail.tsx", import.meta.url), "utf8");
const canvasCssSource = await readFile(new URL("../src/styles/_canvas.css", import.meta.url), "utf8");
const indexCssSource = await readFile(new URL("../src/styles/index.css", import.meta.url), "utf8");

test("pending batch tasks expose a direct cancel button", () => {
  assert.match(gridSource, /onCancelTask\?: \(slot: TaskCancelTarget\) => void \| Promise<void>/);
  assert.match(gridSource, /className="batch-grid-cancel-button"/);
  assert.match(gridSource, />\s*取消任务\s*<\/button>/);

  const canCancel = gridSource.match(/const canCancel = ([^;]+);/)?.[1] ?? "";
  assert.match(canCancel, /status === "local_queued"/);
  assert.match(canCancel, /status === "submitting"/);
  assert.match(canCancel, /status === "queued"/);
  assert.match(canCancel, /status === "running"/);
  assert.doesNotMatch(canCancel, /cancelled|succeeded_no_image|missing/);
});

test("local queued batch tasks expose a direct promote button", () => {
  assert.match(gridSource, /onPromoteTask\?: \(slot: TaskPromoteTarget\) => void \| Promise<void>/);
  assert.match(gridSource, /canPromote\?: boolean/);
  assert.match(gridSource, /const canPromote = !!slot\.taskId && !!onPromoteTask && slot\.canPromote === true/);
  assert.match(gridSource, /className="batch-grid-promote-button"/);
  assert.match(gridSource, />\s*立即插队\s*<\/button>/);
  assert.match(gridSource, /立即提交这个排队任务，新增一个并发；不打断当前生成/);
  assert.match(canvasStageSource, /canPromote: task\.status === "queued" && task\.queuedReason === "local_concurrency" && !task\.jobId/);
  assert.match(canvasStageSource, /onPromoteTask=\{\(\{ taskId \}\) => promoteBatchTask\(taskId\)\}/);
});

test("single tile retry runs independently from batch shared retry", () => {
  assert.match(storeTypesSource, /retryBatchTask: \(taskId: string, options\?: \{ independent\?: boolean; automatic\?: boolean; useTaskProfile\?: boolean \}\) => Promise<void>/);
  assert.match(canvasStageSource, /onRetryTask=\{\(\{ taskId \}\) => retryBatchTask\(taskId, \{ independent: true \}\)\}/);
  assert.match(storeSource, /const independentRetry = options\?\.independent === true/);
  assert.match(storeSource, /const batchSharedTask = !independentRetry && !!task\.batchOutputMode/);
  assert.match(storeSource, /const limit = continuousQueueLimitForState\(get\(\), queuedTask\.apiMode, queuedTask\.apiProfileId\)/);
  assert.match(storeSource, /const continuousPoolTask = task\.continuousPoolTask === true/);
  assert.match(storeSource, /queuedReason: continuousPoolTask[\s\S]+"continuous_pool"[\s\S]+batchSharedTask \? "batch_shared_concurrency" : retryQueueLimit > 0 \? "local_concurrency" : undefined/);
  assert.match(storeSource, /if \(queuedTask\.continuousPoolTask\) \{[\s\S]+requestContinuousPoolPump/);
});

test("transient failures schedule one automatic task retry and temporary concurrency cap", () => {
  assert.match(storeSource, /const AUTO_RETRY_DELAY_MS = 15_000/);
  assert.match(storeSource, /const AUTO_RETRY_MAX_COUNT = 1/);
  assert.match(storeSource, /function scheduleAutoRetryForTask/);
  assert.match(storeSource, /recordTransientFailureForTask\(task, reason\)/);
  assert.match(storeSource, /retryBatchTask\(latestTask\.id, \{ automatic: true, useTaskProfile: true \}\)/);
  assert.match(storeSource, /if \(reducedLimit !== null\)/);
  assert.match(storeSource, /state\.pushToast/);
  assert.match(storeSource, /temporaryConcurrencyCapsByProfile/);
  assert.match(storeSource, /effectiveConcurrencyLimitForProfile/);
});

test("single tile retry synchronizes duplicate running slot back onto the clicked failed tile", () => {
  assert.match(storeSource, /const existingRunningForSlotTasks = sortedBatchTasksForWorkspace/);
  assert.match(storeSource, /for \(const staleRetry of existingRunningForSlotTasks\)/);
  assert.match(storeSource, /status: "cancelled"/);
  assert.match(storeSource, /status: activeRetry\.status/);
  assert.match(storeSource, /jobId: activeRetry\.jobId/);
  assert.match(storeSource, /activeRetry\.status === "running"/);
  assert.match(storeSource, /\\u8fd9\\u4e2a\\u4f4d\\u7f6e\\u5df2\\u7ecf/);
});

test("batch image-to-image now uses the shared queue instead of its own worker loop", () => {
  assert.match(storeSource, /queuedReason: batchUsesFHLPool \? "continuous_pool" : "batch_shared_concurrency"/);
  assert.match(storeSource, /if \(batchUsesFHLPool\) \{[\s\S]+requestContinuousPoolPump\(\)/);
  assert.match(storeSource, /pumpContinuousQueue\(workspaceId, effectiveAPIMode\)/);
  assert.match(storeSource, /已提交 \$\{submittedTasks\.length\} 个批量任务，最大并发 \$\{concurrencyLimit\}/);
  assert.doesNotMatch(storeSource, /runBatchTaskWithController|Started batch run:|normalizeBatchProcessConcurrency\(batchProcess\.concurrency\)/);
});

test("batch grid uses task-id canceling instead of selected bottom canceling", () => {
  assert.match(canvasStageSource, /onCancelTask=\{\(\{ taskId \}\) => cancelBatchTask\(taskId\)\}/);
  assert.doesNotMatch(canvasStageSource, /onSelectTask=\{selectBatchTaskForCancel\}/);
  assert.doesNotMatch(submitBarSource, /cancel-selected|取消选中任务|先选中要取消的任务/);
  assert.match(submitBarSource, /排队\/生成中的格子可单独取消/);
});

test("submit bar keeps global cancel at the bottom of continuous batch actions", () => {
  const retryIndex = submitBarSource.indexOf('data-audit-id="retry-failed-batch-tasks"');
  const generateIndex = submitBarSource.indexOf('data-audit-id="generate"', retryIndex);
  const cancelIndex = submitBarSource.indexOf('data-audit-id="cancel"', generateIndex);
  const noteIndex = submitBarSource.indexOf("排队/生成中的格子可单独取消；已运行任务可能已计费", cancelIndex);
  assert.ok(retryIndex >= 0);
  assert.ok(generateIndex > retryIndex && cancelIndex > generateIndex);
  assert.ok(submitBarSource.slice(cancelIndex).includes("onClick={onCancel}"));
  assert.match(submitBarSource, /const cancelGenerationButtonClass = `cancel-generation-button w-14 shrink-0 border px-2 py-3 text-sm font-semibold leading-none/);
  assert.ok(submitBarSource.slice(cancelIndex).includes("className={cancelGenerationButtonClass}"));
  assert.match(submitBarSource.slice(cancelIndex), />\s*取消\s*<\/button>/);
  assert.ok(noteIndex > cancelIndex);
  assert.match(submitBarSource, /<div className="flex items-stretch gap-2">[\s\S]+data-audit-id="generate"[\s\S]+data-audit-id="cancel"[\s\S]+>\s*取消\s*<\/button>[\s\S]+排队\/生成中的格子可单独取消；已运行任务可能已计费/);
  assert.match(submitBarSource, /const batchMaintenanceSlotClass = "h-\[34px\] overflow-hidden";/);
  assert.match(submitBarSource, /const retrySlotClass = "h-\[34px\] overflow-hidden";/);
  assert.match(submitBarSource, /const runningFooterSlotClass = "overflow-hidden";/);
  assert.ok(submitBarSource.includes('const showRetryFailedButton = failedBatchTaskCount > 0 && (!isRunning || continuousGenerateTest);'));
  assert.ok(submitBarSource.includes('<div className={batchMaintenanceSlotClass}>{showRetryFailedButton ? batchMaintenanceRow : null}</div>'));
  assert.ok(submitBarSource.includes('<div className={retrySlotClass}>{batchMaintenanceRow}</div>'));
  assert.ok(submitBarSource.includes('{showRetryFailedButton ? ('));
  assert.ok(submitBarSource.includes(') : batchMaintenanceRow}'));
  assert.match(submitBarSource, /isRunning && continuousGenerateTest \? \(\s*<div className=\{runningFooterSlotClass\}>/);
});

test("toolbar only shows a batch return entry while previewing a single batch image", () => {
  assert.match(toolbarSource, /currentBatchTaskViewCount/);
  assert.match(toolbarSource, /showReturnToBatchPreview/);
  assert.match(toolbarSource, /&& !historyGalleryOpen/);
  assert.match(toolbarSource, /&& !!currentImage/);
  assert.doesNotMatch(toolbarSource, /activeWorkspace\?\.batchSinglePreviewOpen === true/);
  assert.match(toolbarSource, /showReturnToBatchPreview=\{showReturnToBatchPreview\}/);
  assert.match(toolbarSource, /hasBatchTaskView=\{hasBatchTaskView\}/);
  assert.match(toolbarActionsSource, /showReturnToBatchPreview: boolean/);
  assert.match(toolbarActionsSource, /showReturnToBatchPreview \? \(/);
  assert.match(toolbarActionsSource, /回到批次预览/);
  assert.match(toolbarActionsSource, /暂无当前批次任务/);
  assert.doesNotMatch(toolbarActionsSource, /当前批次任务视图 \{batchTaskCount\}/);
  assert.match(canvasStageSource, /const hasExplicitWorkspaceBatchResults = workspaceBatchResultIds\.length > 0/);
  assert.match(canvasStageSource, /: displaySlotCount > 1 \|\| \(hasExplicitWorkspaceBatchResults && displaySlotCount > 0\)/);
  assert.match(mediaStoreSource, /currentBatchTaskViewCount/);
  assert.doesNotMatch(mediaStoreSource, /Math\.max\(state\.jobsTotal, state\.batchResults\.length\) <= 1/);
});

test("returning to the batch grid from a source preview restores the generated image context", () => {
  const openGridBlock = mediaStoreSource.match(/openResultGrid\(\) \{[\s\S]+?\n    \},/)?.[0] ?? "";
  assert.match(openGridBlock, /const currentImageForGrid = state\.currentImage\?\.id\?\.startsWith\("source-preview-"\) === true/);
  assert.match(openGridBlock, /\? \(state\.sourcePreviewReturnImage \?\? state\.currentImage\)/);
  assert.match(openGridBlock, /currentImage: currentImageForGrid \? toPreviewOnlyHistoryItem\(currentImageForGrid\) : null/);
  assert.match(openGridBlock, /\.\.\.\(currentImageForGrid \? \{ currentImageId: currentImageForGrid\.id \} : \{\}\)/);
  assert.match(openGridBlock, /sourcePreviewReturnImage: null/);
});

test("importing a pasted image keeps the current batch session available", () => {
  const importBlock = imageStoreSource.match(/async importImageFile\(file: File\) \{[\s\S]+?\n    \},/)?.[0] ?? "";
  assert.match(importBlock, /currentImage: ref \? \{ \.\.\.importedItem, previewOnly: true \} : importedItem/);
  assert.match(importBlock, /\.\.\.\(isPanoramaImport \? \{ batchResults: \[importedItem\] \} : \{\}\)/);
  assert.match(importBlock, /\.\.\.\(isPanoramaImport \? \{ batchResultIds: \[importedItem\.id\] \} : \{\}\)/);
  assert.match(importBlock, /resultGridOpen: isPanoramaImport/);
  assert.doesNotMatch(importBlock, /batchResults:\s*\[\]/);
  assert.doesNotMatch(importBlock, /batchResultIds:\s*\[\]/);
  assert.match(mediaStoreSource, /state\.pushToast\("当前标签页没有可返回的批次预览", "info", 2200\)/);
  assert.match(canvasStageSource, /const hasCurrentBatchSession = hasBatchTaskRecords/);
  assert.match(canvasStageSource, /items=\{visibleBatchResults\}/);
});

test("clicking the active workspace tab returns to the current batch preview", () => {
  assert.match(workspaceBarSource, /openResultGrid/);
  assert.match(workspaceBarSource, /onSelect=\{\(\) => active \? openResultGrid\(\) : switchWorkspace\(w\.id\)\}/);
});

test("history rail single-image selection preserves its prompt group as a returnable batch", () => {
  assert.match(historyRailSource, /const promptGroup = promptEntries\.find/);
  assert.match(historyRailSource, /const groupBatchResults = promptGroup && promptGroup\.items\.length > 1 \? promptGroup\.items : \[\]/);
  assert.match(historyRailSource, /batchResults: groupBatchResults/);
  assert.match(historyRailSource, /batchResultIds: groupBatchResults\.map/);
  assert.match(historyRailSource, /batchSinglePreviewOpen: true/);
  assert.match(historyRailSource, /patchWorkspaceRuntime/);
});

test("clear view drops the current batch session instead of only hiding the canvas", () => {
  const clearBlock = mediaStoreSource.match(/closeHistoryGalleryToEmpty\(\) \{[\s\S]+?\n    \},/)?.[0] ?? "";
  assert.match(clearBlock, /batchResults:\s*\[\]/);
  assert.match(clearBlock, /selectedBatchTaskId:\s*null/);
  assert.match(clearBlock, /runningJobs:\s*\[\]/);
  assert.match(clearBlock, /jobsTotal:\s*0/);
  assert.match(clearBlock, /jobsCompleted:\s*0/);
  assert.match(clearBlock, /jobsFailed:\s*0/);
  assert.match(clearBlock, /progress:\s*null/);
  assert.match(clearBlock, /streamPreview:\s*null/);
  assert.match(clearBlock, /streamPreviews:\s*\{\}/);
  assert.match(clearBlock, /lastLogLine:\s*""/);
  assert.match(clearBlock, /errorMessage:\s*null/);
  assert.match(clearBlock, /errorRawPath:\s*null/);
  assert.match(clearBlock, /lastPayload:\s*null/);
  assert.match(clearBlock, /batchResultIds:\s*\[\]/);
  assert.match(clearBlock, /batchTaskIds:\s*\[\]/);
});

test("clear view copy describes clearing the current batch without deleting files", () => {
  assert.match(toolbarActionsSource, /清空当前批次，不删除历史和文件/);
});

test("one-click workspace reset keeps active queued and running batch tasks only", () => {
  const resetStart = storeSource.indexOf("resetCurrentWorkspaceDraft: () => {");
  const resetEnd = storeSource.indexOf("setFHLPoolPerAPIConcurrencyLimit:", resetStart);
  assert.ok(resetStart >= 0 && resetEnd > resetStart);
  const resetBlock = storeSource.slice(resetStart, resetEnd);
  assert.match(resetBlock, /if \(state\.isOptimizingPrompt \|\| state\.isReversingPrompt\)/);
  assert.doesNotMatch(resetBlock, /state\.isRunning \|\|/);
  assert.match(storeSource, /function activeBatchTaskIdsForReset/);
  assert.match(storeSource, /filter\(\(task\) => task\.status === "queued" \|\| task\.status === "running"\)/);
  assert.match(resetBlock, /const preservedTaskIds = activeBatchTaskIdsForReset\(workspaceId, workspace\?\.batchTaskIds \?\? \[\], state\.batchTasksById\);/);
  assert.match(resetBlock, /batchResultIds:\s*\[\]/);
  assert.match(resetBlock, /batchTaskIds:\s*preservedTaskIds/);
  assert.match(resetBlock, /resultGridOpen:\s*hasPreservedTasks/);
  assert.match(resetBlock, /batchResults:\s*\[\]/);
  assert.match(resetBlock, /runningJobs:\s*preservedRunningJobs/);
  assert.match(resetBlock, /isRunning:\s*preservedRunningJobs\.length > 0/);
  assert.match(resetBlock, /patchWorkspaceRuntime\(current\.workspaces, workspaceId, resetPatch\)/);
});

test("store keeps selected cancel compatibility while exposing cancelBatchTask", () => {
  assert.match(storeTypesSource, /cancelBatchTask: \(taskId: string\) => Promise<void>/);
  assert.match(storeSource, /cancelBatchTask: async \(taskId\) =>/);
  assert.match(storeSource, /const selectedId = typeof taskId === "string" \? taskId\.trim\(\) : ""/);
  assert.match(storeSource, /try \{ await wailsCancel\(jobId\); \} catch/);
  assert.match(storeSource, /await get\(\)\.cancelBatchTask\(selectedId\)/);
});

test("cancellation records the terminal state before asking the backend to stop", () => {
  const globalCancelStart = storeSource.indexOf("cancel: async () => {");
  const globalCancelEnd = storeSource.indexOf("selectBatchTask: (taskId)", globalCancelStart);
  const globalCancelBlock = storeSource.slice(globalCancelStart, globalCancelEnd);
  assert.ok(globalCancelStart >= 0 && globalCancelEnd > globalCancelStart);
  assert.ok(globalCancelBlock.indexOf('status: "cancelled"') < globalCancelBlock.indexOf("await wailsCancel(id)"));
  assert.match(globalCancelBlock, /const retainedFHLPoolJobIds = new Set\([\s\S]+shouldRetainFHLPoolCapacityOnCancel\(s, jobId\)/);

  const taskCancelStart = storeSource.indexOf("cancelBatchTask: async (taskId) =>");
  const taskCancelEnd = storeSource.indexOf("cancelQueuedBatchTasks: async () =>", taskCancelStart);
  const taskCancelBlock = storeSource.slice(taskCancelStart, taskCancelEnd);
  assert.ok(taskCancelStart >= 0 && taskCancelEnd > taskCancelStart);
  assert.ok(taskCancelBlock.indexOf('status: "cancelled"') < taskCancelBlock.indexOf("await wailsCancel(jobId)"));
  assert.match(taskCancelBlock, /if \(jobId && !shouldRetainFHLPoolCapacityOnCancel\(current, jobId\)\) delete nextMeta\[jobId\]/);
});

test("store exposes queue promotion for local queued tasks", () => {
  assert.match(storeTypesSource, /promoteBatchTask: \(taskId: string\) => Promise<void>/);
  assert.match(storeSource, /promoteBatchTask: async \(taskId\) =>/);
  assert.match(storeSource, /task\.status !== "queued" \|\| task\.jobId \|\| task\.queuedReason !== "local_concurrency"/);
  assert.match(storeSource, /startingContinuousTaskIds\.has\(currentTask\.id\)/);
  assert.match(storeSource, /const started = await startContinuousQueuedTask\(currentTask\.id\)/);
  assert.match(storeSource, /已立即插队，新增一个并发任务/);
  assert.match(storeSource, /runningOrSubmittedTaskCountForWorkspace\([\s\S]+startingContinuousTaskIds/);
});

test("current batch task grid normalizes visible labels while preserving task slot order", () => {
  assert.match(canvasStageSource, /sortedBatchTasksForCurrentView/);
  assert.match(canvasStageSource, /const displayBatchTasks = sortedBatchTasksForCurrentView/);
  assert.match(canvasStageSource, /slotIndex: task\.slotIndex/);
  assert.match(canvasStageSource, /preserveSlotOrder=\{hasBatchTaskRecords\}/);
  assert.match(canvasStageSource, /gallerySort=\{historyGallerySort\}/);
  assert.match(canvasStageSource, /onGallerySortChange=\{setHistoryGallerySort\}/);
  assert.match(gridSource, /function visibleBatchIndex/);
  assert.match(gridSource, /const slotIndexBase = useMemo/);
  assert.match(gridSource, /Math\.min\(\.\.\.indexes\)/);
  assert.match(gridSource, /const displayIndex = visibleBatchIndex\(slot, originalIndex, slotIndexBase\);/);
  assert.match(gridSource, /index=\{displayIndex\}/);
  assert.doesNotMatch(gridSource, /index=\{slot\.slotIndex \?\? originalIndex\}/);
  assert.match(gridSource, /const preserveDisplayOrder = onGallerySortChange/);
  assert.match(gridSource, /gallerySort === "oldest"/);
  assert.match(gridSource, /\{onGallerySortChange \? \(/);
  assert.match(gridSource, /aria-label=\{variant === "historyGallery" \? "完整相册时间排序" : "批次排列顺序"\}/);
  assert.match(gridSource, /sortBatchGridSlotsForDisplay/);
  assert.match(displayOrderSource, /batchGridSlotDisplayRank/);
  assert.match(displayOrderSource, /status === "running" \|\| status === "submitting"\) return 0/);
  assert.match(displayOrderSource, /status === "queued" \|\| status === "local_queued"/);
  assert.match(gridSource, /if \(variant === "historyGallery"\) return mapped;/);
});

test("submit button labels batch image-to-image count explicitly", () => {
  assert.match(submitBarSource, /\u751f\u6210\uff08\u6279\u91cf\u751f\u56fe \$\{batchImageToImageCount\} \u5f20\uff09/);
  assert.doesNotMatch(submitBarSource, /\u751f\u6210\uff08\$\{batchImageToImageCount\} \u5f20\uff09/);
});

test("submit bar exposes one-click cancel for queued batch tasks", () => {
  assert.match(storeTypesSource, /cancelQueuedBatchTasks: \(\) => Promise<void>/);
  assert.match(storeSource, /cancelQueuedBatchTasks: async \(\) =>/);
  const cancelQueuedIndex = storeSource.indexOf("cancelQueuedBatchTasks: async () =>");
  const promoteIndex = storeSource.indexOf("promoteBatchTask: async", cancelQueuedIndex);
  assert.ok(cancelQueuedIndex >= 0 && promoteIndex > cancelQueuedIndex);
  const cancelQueuedBlock = storeSource.slice(cancelQueuedIndex, promoteIndex);
  assert.match(cancelQueuedBlock, /filter\(\(task\) => task\.status === "queued"\)/);
  assert.match(cancelQueuedBlock, /status: "cancelled"/);
  assert.match(cancelQueuedBlock, /queuedReason: undefined/);
  assert.match(cancelQueuedBlock, /queuePriority: undefined/);
  assert.match(cancelQueuedBlock, /startingContinuousTaskIds\.delete\(task\.id\)/);
  assert.match(submitBarSource, /queuedBatchTaskCount: number/);
  assert.match(submitBarSource, /onCancelQueuedBatchTasks: \(\) => void \| Promise<void>/);
  assert.match(submitBarSource, /data-audit-id="cancel-queued-batch-tasks"/);
  assert.match(submitBarSource, /const queuedCancelButton = queuedBatchTaskCount > 0/);
  assert.match(submitBarSource, /cancel-queued-batch-button \$\{maintenanceButtonClass\}/);
  assert.match(submitBarSource, /const batchMaintenanceRow = queuedBatchTaskCount > 0 \|\| failedBatchTaskCount > 0/);
  assert.match(submitBarSource, /queuedBatchTaskCount > 0 && failedBatchTaskCount > 0 \? "grid-cols-2" : "grid-cols-1"/);
  assert.match(submitBarSource, /\{queuedCancelButton\}\s*\{clearFailedButton\}/);
  assert.match(controlPanelSource, /const queuedBatchTaskCount = activeBatchTasks\.filter\(\(task\) => task\.status === "queued"\)\.length/);
  assert.match(controlPanelSource, /queuedBatchTaskCount=\{queuedBatchTaskCount\}/);
  assert.match(controlPanelSource, /onCancelQueuedBatchTasks=\{cancelQueuedBatchTasks\}/);
});
test("submit bar exposes one-click retry for current failed batch tasks only", () => {
  assert.match(storeTypesSource, /retryFailedBatchTasks: \(\) => Promise<void>/);
  assert.match(storeSource, /retryFailedBatchTasks: async \(\) =>/);
  assert.match(storeSource, /const retryHistoryById = new Map\(\[\.\.\.s\.batchResults, \.\.\.s\.history\]/);
  assert.match(storeSource, /filter\(\(task\) => isRetryableBatchTask\(task, retryHistoryById\)\)/);
  assert.match(storeSource.match(/retryFailedBatchTasks: async \(\) => \{[\s\S]+?\n  \},/)?.[0] ?? "", /生成失败\/终图缺失任务/);
  assert.match(submitBarSource, /failedBatchTaskCount: number/);
  assert.match(submitBarSource, /retryApiLabel\?: string/);
  assert.match(submitBarSource, /data-audit-id="retry-failed-batch-tasks"/);
  assert.match(submitBarSource, /`重试当前批次失败任务 \$\{failedBatchTaskCount\}`/);
  assert.match(submitBarSource, /`正在重试当前批次失败任务 \$\{failedBatchTaskCount\} 个\.\.\.`/);
  assert.match(submitBarSource, /使用 \$\{retryTargetLabel\} 重试当前批次里的 \$\{failedBatchTaskCount\} 个生成失败\/终图缺失任务/);
  assert.doesNotMatch(submitBarSource, /\{retryFailedLabel\} · \{retryTargetLabel\}/);
  assert.match(submitBarSource, /const maintenanceButtonClass = `batch-maintenance-button/);
  assert.match(submitBarSource, /const retryMaintenanceButtonClass = `retry-failed-batch-button batch-maintenance-button/);
  assert.match(submitBarSource, /w-full border px-2\.5 py-1\.5 text-\[12px\] font-semibold leading-none/);
  assert.match(submitBarSource, /retry-failed-batch-button batch-maintenance-button mb-2 w-full border px-2\.5 py-1\.5 text-\[12px\]/);
  assert.match(submitBarSource, /cancel-generation-button w-14 shrink-0 border px-2 py-3 text-sm font-semibold leading-none/);
  assert.doesNotMatch(submitBarSource, /inline-flex items-center justify-center h-12/);
  assert.doesNotMatch(indexCssSource, /height: 47px|min-height: 47px/);
  assert.match(indexCssSource, /\.batch-maintenance-button,\s*\n\.retry-failed-batch-button/);
  assert.match(indexCssSource, /background: rgb\(254 243 199 \/ 0\.98\)/);
  assert.match(controlPanelSource, /const retryHistoryById = new Map\(\[\.\.\.batchResults, \.\.\.history\]/);
  assert.match(controlPanelSource, /isRetryableBatchTask\(task, retryHistoryById\)/);
  assert.match(controlPanelSource, /failedBatchTaskCount/);
  assert.match(controlPanelSource, /retryApiLabel=\{retryApiLabel\}/);
  assert.match(controlPanelSource, /onRetryFailedBatchTasks=\{retryFailedBatchTasks\}/);
});

test("submit bar exposes one-click clear for current failed batch tasks", () => {
  assert.match(storeTypesSource, /clearFailedBatchTasks: \(\) => Promise<void>/);
  assert.match(storeSource, /clearFailedBatchTasks: async \(\) =>/);
  const clearFailedIndex = storeSource.indexOf("clearFailedBatchTasks: async () =>");
  const promoteIndex = storeSource.indexOf("promoteBatchTask: async", clearFailedIndex);
  assert.ok(clearFailedIndex >= 0 && promoteIndex > clearFailedIndex);
  const clearFailedBlock = storeSource.slice(clearFailedIndex, promoteIndex);
  assert.match(clearFailedBlock, /filter\(\(task\) => isRetryableBatchTask\(task, retryHistoryById\)\)/);
  assert.match(clearFailedBlock, /!isRetryableBatchTask\(task, currentRetryHistoryById\)/);
  assert.match(clearFailedBlock, /clearAutoRetryTimer\(task\.id\)/);
  assert.match(clearFailedBlock, /status: "cancelled"/);
  assert.match(clearFailedBlock, /queuedReason: undefined/);
  assert.match(clearFailedBlock, /queuePriority: undefined/);
  assert.match(clearFailedBlock, /groupId: undefined/);
  assert.match(clearFailedBlock, /jobId: undefined/);
  assert.match(clearFailedBlock, /autoRetryScheduledAt: undefined/);
  assert.match(clearFailedBlock, /autoRetryReason: undefined/);
  assert.match(clearFailedBlock, /已清空 \$\{clearedCount\} 个生成失败\/终图缺失任务/);
  assert.match(submitBarSource, /onClearFailedBatchTasks: \(\) => void \| Promise<void>/);
  assert.match(submitBarSource, /const \[clearingFailed, setClearingFailed\] = useState\(false\)/);
  assert.match(submitBarSource, /const clearFailedButton = failedBatchTaskCount > 0/);
  assert.match(submitBarSource, /data-audit-id="clear-failed-batch-tasks"/);
  assert.match(submitBarSource, /clear-failed-batch-button \$\{maintenanceButtonClass\}/);
  assert.match(submitBarSource, /清空失败\/终图缺失 \$\{failedBatchTaskCount\}/);
  assert.match(submitBarSource, /正在清空失败\/终图缺失 \$\{failedBatchTaskCount\} 个/);
  assert.match(submitBarSource, /把当前批次中的生成失败\/终图缺失任务标记为已取消/);
  assert.match(controlPanelSource, /clearFailedBatchTasks/);
  assert.match(controlPanelSource, /onClearFailedBatchTasks=\{clearFailedBatchTasks\}/);
});

test("pending batch tasks expose clearer status chips and copy", () => {
  assert.match(gridSource, /label: "等待结果"/);
  assert.match(gridSource, /label: "等待生成"/);
  assert.match(gridSource, /label: "正在生成"/);
  assert.match(gridSource, /label: "最终图缺失"/);
  assert.match(gridSource, /等待 API 并发空位/);
  assert.match(gridSource, /API 并发队列里/);
  assert.match(gridSource, /badge: "处理中"/);
  assert.match(gridSource, /badge: "未提交"/);
  assert.match(gridSource, /badge: "最终图缺失"/);
  assert.match(gridSource, /白色卡片表示这张图还在处理中/);
  assert.match(gridSource, /黄色卡片表示这格缺少最终图/);
  assert.match(gridSource, /batch-grid-status-chip/);
  assert.match(gridSource, /batch-grid-status-chip-\$\{view\.badgeTone\}/);
  assert.match(canvasCssSource, /\.batch-grid-tile\.pending-cancelled/);
  assert.match(canvasCssSource, /filter: grayscale\(0\.9\) saturate\(0\.45\)/);
  assert.match(canvasCssSource, /opacity: 0\.84/);
});

test("failed and missing-final-image slots show a generation failed heading", () => {
  assert.match(gridSource, /status === "succeeded_no_image" \? <span className="batch-grid-failure-heading">生成失败<\/span> : null/);
  assert.match(gridSource, /<span className="batch-grid-failure-heading">生成失败<\/span>\s*<span className="batch-grid-failed-label">/);
  assert.match(canvasCssSource, /\.batch-grid-failure-heading/);
  assert.match(canvasCssSource, /pending-succeeded_no_image \.batch-grid-failure-heading/);
});

test("batch grid zoom can reduce the current batch view to one column", () => {
  assert.match(gridSource, /const MIN_ZOOM_COLUMNS = 1;/);
  assert.match(gridSource, /const MAX_MANUAL_COLUMNS = 10;/);
  assert.match(gridSource, /const minColumns = Math\.min\(defaultColumns, MIN_ZOOM_COLUMNS\);/);
  assert.match(gridSource, /const maxColumns = MAX_MANUAL_COLUMNS;/);
  assert.match(gridSource, /const canDecreaseColumns = effectiveColumns > minColumns;/);
  assert.match(gridSource, /const canIncreaseColumns = effectiveColumns < maxColumns;/);
  assert.match(gridSource, /const nextColumns = Math\.max\(minColumns, effectiveColumns - 1\);/);
  assert.match(gridSource, /const nextColumns = Math\.min\(maxColumns, effectiveColumns \+ 1\);/);
  assert.match(gridSource, /title="减少每行张数"/);
  assert.match(gridSource, /title="增加每行张数，最多 10 张"/);
  assert.match(gridSource, /setManualColumns\(null\);\s*\}, \[gridSlots\.length\]\);/);
  assert.doesNotMatch(gridSource, /\}, \[gridSlots\.length, defaultColumns\]\);/);
});
