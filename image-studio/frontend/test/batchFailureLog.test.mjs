import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const gridSource = await readFile(new URL("../src/components/canvas/BatchResultGrid.tsx", import.meta.url), "utf8");
const canvasStageSource = await readFile(new URL("../src/components/canvas/CanvasStage.tsx", import.meta.url), "utf8");
const taskRecordsSource = await readFile(new URL("../src/state/batchTaskRecords.ts", import.meta.url), "utf8");
const sharedStoreSource = await readFile(new URL("../src/state/studioStore.shared.ts", import.meta.url), "utf8");
const storeSource = await readFile(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
const domainSource = await readFile(new URL("../src/types/domain.ts", import.meta.url), "utf8");
const canvasCss = await readFile(new URL("../src/styles/_canvas.css", import.meta.url), "utf8");

test("failed batch slots expose hover and click log affordances", () => {
  assert.match(gridSource, /logMessage\?: string/);
  assert.match(gridSource, /rawPath\?: string/);
  assert.match(gridSource, /function failureLogText/);
  assert.match(gridSource, /function failureLogSummary/);
  assert.match(gridSource, /className="batch-grid-failed-mark batch-grid-failed-log-button"/);
  assert.match(gridSource, /className="batch-grid-failed-log-tooltip"/);
  assert.match(gridSource, /setLogOpen\(true\)/);
  assert.match(gridSource, /function FailureLogModal/);
  assert.match(gridSource, /<RawResponseModal path=\{rawPath\}/);
});

test("failed batch slots expose the shared history parameter menu without generating", () => {
  assert.match(gridSource, /contextItem\?: HistoryItem \| null/);
  assert.match(gridSource, /onContextMenu=\{\(event\) => \{/);
  assert.match(gridSource, /onOpenItemContextMenu\?\.\(slot\.contextItem, event\.clientX, event\.clientY\)/);
  assert.match(canvasStageSource, /contextItem: sourcedItem \?\? historyContextItemFromBatchTask\(task\)/);
  assert.match(canvasStageSource, /function historyContextItemFromBatchTask/);
});

test("failed grid logs include task context, prompt, raw response path, and message", () => {
  assert.match(gridSource, /任务 ID: \$\{slot\.taskId\}/);
  assert.match(gridSource, /Job ID: \$\{slot\.jobId\}/);
  assert.match(gridSource, /任务组: \$\{slot\.groupId\}/);
  assert.match(gridSource, /Prompt: \$\{slot\.prompt\}/);
  assert.match(gridSource, /日志: \$\{compactText\(slot\.logMessage\)\}/);
  assert.match(gridSource, /原始响应: \$\{slot\.rawPath\}/);
});

test("canvas stage passes persisted failure logs into failed grid slots", () => {
  assert.match(canvasStageSource, /logMessage: latest\.slot\.errorMessage \|\| latest\.slot\.stage/);
  assert.match(canvasStageSource, /rawPath: latest\.slot\.rawPath/);
  assert.match(canvasStageSource, /logMessage: task\.errorMessage \|\| task\.lastLogLine/);
  assert.match(canvasStageSource, /rawPath: task\.rawPath/);
});

test("batch task records persist last log line and normalize it after reload", () => {
  assert.match(domainSource, /lastLogLine\?: string/);
  assert.match(taskRecordsSource, /lastLogLine: normalizeRuntimeText\(slot\.stage\) \|\| task\.lastLogLine/);
  assert.match(sharedStoreSource, /lastLogLine: typeof raw\.lastLogLine === "string" \? raw\.lastLogLine : undefined/);
  assert.match(storeSource, /lastLogLine: runtime\.lastLogLine \|\| undefined/);
  assert.match(storeSource, /lastLogLine: `提交失败:\$\{error\?\.message \?\? error\}`/);
  assert.match(storeSource, /const message = `重新生成提交失败:\$\{error\?\.message \?\? error\}`/);
  assert.match(storeSource, /lastLogLine: message/);
});

test("failure log tooltip can float outside the failed tile", () => {
  assert.match(canvasCss, /\.batch-grid-tile\.failed\s*\{[\s\S]*?overflow: visible;/);
  assert.match(canvasCss, /\.batch-grid-failed-log-button/);
  assert.match(canvasCss, /\.batch-grid-failed-log-tooltip/);
  assert.match(canvasCss, /\.batch-grid-failed-log-button:hover \.batch-grid-failed-log-tooltip/);
  assert.match(canvasCss, /\.batch-grid-failure-log-pre/);
});

test("failure modal keeps a path open for runninghub result recovery", () => {
  assert.match(gridSource, /runningHubRecoverable\?: boolean/);
  assert.match(gridSource, /runningHubRecoveryLabel\?: string/);
  assert.match(gridSource, /className=\{`batch-grid-recover-button \$\{canRetry \? "stacked" : "solo"\}`\}/);
  assert.match(gridSource, /onRecoverRunningHub=\{canRecoverRunningHub \? \(\) => onRecoverRunningHub\?\.\(\{ taskId: slot\.taskId! \}\) : undefined\}/);
  assert.match(gridSource, /rawPath \|\| onRecoverRunningHub/);
});

test("runninghub result recovery preserves the open batch grid preview", () => {
  const recoveryBlock = storeSource.match(/recoverRunningHubResult: async \(taskId\) => \{[\s\S]+?\r?\n  \},\r?\n\r?\n  applyHistoryParams:/)?.[0] ?? "";
  assert.match(recoveryBlock, /const keepGridOpen = \(workspace\?\.resultGridOpen \?\? false\) \|\| \(\(workspace\?\.batchTaskIds\?\.length \?\? 0\) > 1\);/);
  assert.match(recoveryBlock, /const previousCurrentImageId = current\.activeWorkspaceId === task\.workspaceId/);
  assert.match(recoveryBlock, /currentImageId: keepGridOpen \? previousCurrentImageId : historyItem\.id/);
  assert.match(recoveryBlock, /currentImage: keepGridOpen \? current\.currentImage : activeItem/);
});
