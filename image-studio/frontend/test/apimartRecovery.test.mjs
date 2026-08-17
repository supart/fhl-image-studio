import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apiSource = await readFile(new URL("../src/lib/apimartAPI.ts", import.meta.url), "utf8");
const domainSource = await readFile(new URL("../src/types/domain.ts", import.meta.url), "utf8");
const remoteTypesSource = await readFile(new URL("../src/platform/runtime/remote-kernel/types.ts", import.meta.url), "utf8");
const kernelSource = await readFile(new URL("../src/platform/runtime/remote-kernel/apimart.ts", import.meta.url), "utf8");
const hostTasksSource = await readFile(new URL("../src/platform/runtime/hostTasks.ts", import.meta.url), "utf8");
const storeSource = await readFile(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
const storeTypesSource = await readFile(new URL("../src/state/studioStore.types.ts", import.meta.url), "utf8");
const sharedStoreSource = await readFile(new URL("../src/state/studioStore.shared.ts", import.meta.url), "utf8");
const taskRecordsSource = await readFile(new URL("../src/state/batchTaskRecords.ts", import.meta.url), "utf8");
const canvasStageSource = await readFile(new URL("../src/components/canvas/CanvasStage.tsx", import.meta.url), "utf8");
const gridSource = await readFile(new URL("../src/components/canvas/BatchResultGrid.tsx", import.meta.url), "utf8");
const rawModalSource = await readFile(new URL("../src/components/history/RawResponseModal.tsx", import.meta.url), "utf8");

test("apimart task ids are persisted from runtime events into task records", () => {
  assert.match(domainSource, /apimartTaskId\?: string/);
  assert.match(domainSource, /apimartTaskExpiresAt\?: number/);
  assert.match(remoteTypesSource, /apimartTaskId\?: string/);
  assert.match(kernelSource, /let submittedTaskId = ""/);
  assert.match(kernelSource, /submittedTaskId = submitted\.taskId \|\| ""/);
  assert.match(kernelSource, /apimartTaskId: submittedTaskId \|\| undefined/);
  assert.match(kernelSource, /if \(submittedTaskId && !error\.apimartTaskId\) error\.apimartTaskId = submittedTaskId/);
  assert.match(hostTasksSource, /apimartTaskId: result\.apimartTaskId \|\| undefined/);
  assert.match(hostTasksSource, /apimartTaskId: typed\.apimartTaskId \|\| undefined/);
  assert.match(sharedStoreSource, /apimartTaskId: typeof raw\.apimartTaskId === "string"/);
  assert.match(taskRecordsSource, /apimartTaskId: slot\.apimartTaskId \|\| task\.apimartTaskId/);
});

test("apimart recovery helpers query task status and download result images", () => {
  assert.match(apiSource, /export type APIMartRecoveredTask/);
  assert.match(apiSource, /export async function recoverAPIMartTask\(/);
  assert.match(apiSource, /\/v1\/tasks\/\$\{encodeURIComponent\(cleanTaskId\)\}\?language=zh/);
  assert.match(apiSource, /APIMART_LOCAL_PROXY_PREFIX/);
  assert.match(apiSource, /APIMART_LEGACY_LOCAL_PROXY_PREFIX/);
  assert.match(apiSource, /function apimartFallbackEndpoint/);
  assert.match(apiSource, /function isRetryableAPIMartRecoveryError/);
  assert.match(apiSource, /APIMART_SUCCESS_STATUSES/);
  assert.match(apiSource, /APIMART_FAILURE_STATUSES/);
  assert.match(apiSource, /export async function fetchAPIMartResultImage\(/);
  assert.match(apiSource, /APIMART_IMAGE_LOCAL_PROXY_PREFIX/);
  assert.match(apiSource, /export function extractAPIMartTaskIdFromText\(/);
  assert.match(apiSource, /const APIMART_TASK_ID_TEXT_RE = \/\\btask\[-_\]/);
  assert.match(apiSource, /\(\?=\[A-Z0-9_-\]\*\\d\)/);
});

test("studio store exposes apimart recovery and preserves the open batch grid", () => {
  assert.match(storeTypesSource, /recoverAPIMartResult: \(taskId: string\) => Promise<HistoryItem \| null>/);
  assert.match(storeTypesSource, /recoverAPIMartTaskResult: \(apimartTaskId: string, options\?: \{ rawPath\?: string \}\) => Promise<HistoryItem \| null>/);
  assert.match(storeSource, /recoverAPIMartResult: async \(taskId\) => \{/);
  assert.match(storeSource, /const direct = extractAPIMartTaskIdFromText\(task\.apimartTaskId\)/);
  assert.match(storeSource, /const apimartTaskId = await recoverableAPIMartTaskId\(task\)/);
  assert.match(storeSource, /recoverAPIMartTask\(baseURL, apiKey, apimartTaskId\)/);
  assert.match(storeSource, /fetchAPIMartResultImage\(firstImage\)/);
  assert.match(storeSource, /updateTaskFromHistoryItem\(/);
  assert.match(storeSource, /apimartTaskExpiresAt: recoveredTask\.expiresAt/);
  assert.match(storeSource, /mergeWorkspaceBatchResult\(current, task\.workspaceId, historyItem, nextHistory\)/);
  assert.match(storeSource, /const keepGridOpen = \(workspace\?\.resultGridOpen \?\? false\) \|\| \(\(workspace\?\.batchTaskIds\?\.length \?\? 0\) > 1\);/);
  assert.match(storeSource, /currentImageId: keepGridOpen \? previousCurrentImageId : historyItem\.id/);
  assert.match(storeSource, /currentImage: keepGridOpen \? current\.currentImage : activeItem/);
});

test("raw response logs can directly re-sync apimart results by task id", () => {
  assert.match(rawModalSource, /import \{ extractAPIMartTaskIdFromText \} from "\.\.\/\.\.\/lib\/apimartAPI"/);
  assert.match(rawModalSource, /setAPIMartTaskId\(extractAPIMartTaskIdFromText\(t\)\)/);
  assert.match(rawModalSource, /recoverAPIMartTaskResult\(apimartTaskId, \{ rawPath: path \}\)/);
  assert.match(rawModalSource, /重新同步 APIMart 结果/);
  assert.match(storeSource, /recoverAPIMartTaskResult: async \(apimartTaskId, options\) => \{/);
  assert.match(storeSource, /const cleanTaskId = extractAPIMartTaskIdFromText\(apimartTaskId\)/);
  assert.match(storeSource, /entry\.id === state\.activeProfileId && entry\.apiMode === "apimart"/);
  assert.match(storeSource, /recoverAPIMartTask\(baseURL, apiKey, cleanTaskId\)/);
  assert.match(storeSource, /fetchAPIMartResultImage\(firstImage\)/);
});

test("apimart failed slots show a dedicated re-sync action", () => {
  assert.match(canvasStageSource, /function apimartRecoveryState\(/);
  assert.doesNotMatch(canvasStageSource, /task\.status === "cancelled"\) return \{ recoverable: false \}/);
  assert.match(canvasStageSource, /const traceText = `\$\{task\.errorMessage \|\| ""\}\\n\$\{task\.lastLogLine \|\| ""\}\\n\$\{task\.rawPath \|\| ""\}`/);
  assert.match(canvasStageSource, /import \{ extractAPIMartTaskIdFromText \} from "\.\.\/\.\.\/lib\/apimartAPI"/);
  assert.match(canvasStageSource, /const hasTaskId = !!extractAPIMartTaskIdFromText\(task\.apimartTaskId\)/);
  assert.match(canvasStageSource, /const hasLoggedTaskId = !!extractAPIMartTaskIdFromText\(traceText\)/);
  assert.doesNotMatch(canvasStageSource, /\|\| !!String\(task\.rawPath \|\| ""\)\.trim\(\)/);
  assert.match(canvasStageSource, /label: hasRecoverableTrace \? \(hasTaskId \? "APIMart 可同步" : "APIMart 可尝试同步"\) : undefined/);
  assert.match(canvasStageSource, /if \(task\.status === "cancelled"\) \{\s*const apimartRecovery = apimartRecoveryState\(task\);/);
  assert.match(canvasStageSource, /apimartRecoverable: apimartRecovery\.recoverable/);
  assert.match(canvasStageSource, /apimartRecoverable: apimartRecovery\.recoverable/);
  assert.match(canvasStageSource, /apimartRecoveryLabel: apimartRecovery\.label/);
  assert.match(canvasStageSource, /onRecoverAPIMart=\{\(\{ taskId \}\) => \{/);
  assert.match(gridSource, /apimartRecoverable\?: boolean/);
  assert.match(gridSource, /apimartRecoveryLabel\?: string/);
  assert.match(gridSource, /const canRecoverAPIMart = !!\(slot\.taskId && slot\.apimartRecoverable && onRecoverAPIMart && \(status === "cancelled" \|\| status === "succeeded_no_image"\)\)/);
  assert.match(gridSource, /can-recover-apimart/);
  assert.match(gridSource, /重新同步 APIMart 结果/);
  assert.match(gridSource, /onRecoverAPIMart=\{canRecoverAPIMart \? \(\) => onRecoverAPIMart\?\.\(\{ taskId: slot\.taskId! \}\) : undefined\}/);
});
