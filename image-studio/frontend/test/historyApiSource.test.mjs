import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const domainSource = readFileSync(new URL("../src/types/domain.ts", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
const sharedSource = readFileSync(new URL("../src/state/studioStore.shared.ts", import.meta.url), "utf8");
const taskSource = readFileSync(new URL("../src/state/batchTaskRecords.ts", import.meta.url), "utf8");
const contractsSource = readFileSync(new URL("../src/platform/runtime/browserJobContracts.ts", import.meta.url), "utf8");
const proxySource = readFileSync(new URL("../dev/browserJobProxy.ts", import.meta.url), "utf8");
const detailSource = readFileSync(new URL("../src/components/panel/ResultDetailDrawer.tsx", import.meta.url), "utf8");
const canvasStageSource = readFileSync(new URL("../src/components/canvas/CanvasStage.tsx", import.meta.url), "utf8");
const tileSource = readFileSync(new URL("../src/components/history/HistoryTile.tsx", import.meta.url), "utf8");
const batchGridSource = readFileSync(new URL("../src/components/canvas/BatchResultGrid.tsx", import.meta.url), "utf8");
const androidTileSource = readFileSync(new URL("../src/platform/android/history/AndroidHistoryTile.tsx", import.meta.url), "utf8");
const apiSourceBadgeSource = readFileSync(new URL("../src/components/history/HistoryApiSourceBadge.tsx", import.meta.url), "utf8");
const apiSourceSource = readFileSync(new URL("../src/components/history/historyApiSource.ts", import.meta.url), "utf8");
const windowsHistoryRailSource = readFileSync(new URL("../src/components/history/WindowsHistoryRail.tsx", import.meta.url), "utf8");

const { apiSourceShortLabel, apiSourceDetailLabel } = await import("../src/components/history/historyApiSource.ts");

test("generated history items carry non-secret API source metadata", () => {
  assert.match(domainSource, /export interface HistoryItem[\s\S]*?apiMode\?: APIMode;/);
  assert.match(domainSource, /export interface HistoryItem[\s\S]*?apiProfileId\?: string;/);
  assert.match(domainSource, /export interface HistoryItem[\s\S]*?apiProfileName\?: string;/);
  assert.match(storeSource, /function apiProfileSnapshotForSubmit/);
  assert.match(storeSource, /apiMode: snapshot\.apiMode/);
  assert.match(storeSource, /apiProfileId: snapshot\.apiProfileId/);
  assert.match(storeSource, /apiProfileName: snapshot\.apiProfileName/);
  assert.match(storeSource, /apiMode: group\.apiMode/);
  assert.match(storeSource, /apiProfileId: group\.apiProfileId \|\| existing\?\.apiProfileId/);
  assert.match(storeSource, /apiProfileName: group\.apiProfileName \|\| existing\?\.apiProfileName/);
  assert.match(storeSource, /size: sourceIdentity\?\.size \?\? group\.size/);
});

test("batch and background jobs preserve API source metadata until history sync", () => {
  assert.match(domainSource, /export interface BatchTaskRecord[\s\S]*?apiProfileId\?: string;/);
  assert.match(domainSource, /export interface JobGroupSnapshot[\s\S]*?apiProfileName\?: string;/);
  assert.match(taskSource, /apiProfileId: input\.apiProfileId/);
  assert.match(taskSource, /apiProfileName: group\.apiProfileName \|\| task\.apiProfileName/);
  assert.match(sharedSource, /apiProfileId: typeof raw\.apiProfileId === "string"/);
  assert.match(contractsSource, /export interface BrowserJobSubmitPayload[\s\S]*?apiProfileName\?: string;/);
  assert.match(proxySource, /apiProfileId: typeof effectivePayload\.apiProfileId === "string"/);
  assert.match(storeSource, /apiProfileId: task\.apiProfileId/);
  assert.match(storeSource, /\.\.\.apiProfileSnapshot/);
});

test("new batch submissions preserve existing batch sessions across API profiles", () => {
  assert.match(storeSource, /function shouldPreserveBatchSessionForSubmit/);
  assert.doesNotMatch(storeSource, /function apiSourceMatchesSubmit/);
  const preserveBlock = storeSource.match(/function shouldPreserveBatchSessionForSubmit\([\s\S]+?\n\}/)?.[0] ?? "";
  assert.match(preserveBlock, /const hasSession = taskIds\.length > 0 \|\| resultIds\.length > 0 \|\| \(state\.activeWorkspaceId === workspaceId && state\.batchResults\.length > 0\);/);
  assert.match(preserveBlock, /return hasSession;/);
  assert.doesNotMatch(preserveBlock, /apiSourceMatchesSubmit|knownSources|normalizeAPIMode/);
  assert.match(storeSource, /shouldPreserveBatchSessionForSubmit\(s, workspaceId\)/);
  assert.doesNotMatch(storeSource, /shouldPreserveBatchSessionForSubmit\(s, workspaceId, effectiveAPIMode, apiProfileSnapshot\.apiProfileId\)/);
  assert.match(storeSource, /const batchSlotStart = preserveCurrentBatchSession \? nextBatchSlotStartForWorkspace\(s, workspaceId\) : 0;/);
  assert.match(storeSource, /const previousBatchResults = completeWorkspaceBatchResults\(s, workspaceId\);/);
  assert.match(storeSource, /const previousBatchResultIds = completeWorkspaceBatchResultIds\(s, workspaceId, previousBatchResults\);/);
  assert.match(storeSource, /const nextBatchTaskIds = preserveCurrentBatchSession\s*\?\s*\[\.\.\.previousBatchTaskIds, \.\.\.submittedTaskIds\]\s*:\s*submittedTaskIds;/);
});

test("current workspace batch sessions merge restored results instead of replacing them", () => {
  assert.match(storeSource, /function completeWorkspaceBatchResults/);
  assert.match(storeSource, /historyItemsByIds\(history, workspace\?\.batchResultIds \?\? \[\]\)/);
  assert.match(storeSource, /candidates\.push\(\.\.\.activeBatchResults\)/);
  assert.match(storeSource, /function mergeWorkspaceBatchResult/);
  assert.match(storeSource, /include: \[historyItem\]/);
  assert.match(storeSource, /batchResultIds: uniqueStrings/);

  const browserSyncBlock = storeSource.match(/async function syncHistoryItemFromBrowserJobSlot[\s\S]+?function ensureBrowserJobSubscription/)?.[0] ?? "";
  assert.match(browserSyncBlock, /const mergedBatch = mergeWorkspaceBatchResult\(state, group\.workspaceId, historyItem, nextHistory\);/);
  assert.match(browserSyncBlock, /batchResultIds: mergedBatch\.batchResultIds/);
  assert.match(browserSyncBlock, /batchResults = state\.activeWorkspaceId === group\.workspaceId\s*\? mergedBatch\.batchResults/);

  const localResultBlock = storeSource.match(/offResult = EventsOn\(`result:\$\{jobId\}`[\s\S]+?persistTrimmedHistory\(trimmed\);/)?.[0] ?? "";
  assert.match(localResultBlock, /const mergedBatch = mergeWorkspaceBatchResult\(state, snapshot\.workspaceId, historyItem, trimmed\);/);
  assert.match(localResultBlock, /batchResultIds: mergedBatch\.batchResultIds/);
  assert.match(localResultBlock, /batchResults = state\.activeWorkspaceId === snapshot\.workspaceId\s*\? mergedBatch\.batchResults/);
});

test("result details display the API source for generated images", () => {
  assert.match(detailSource, /import \{ apiSourceDetailLabel \} from "\.\.\/history\/historyApiSource"/);
  assert.match(detailSource, /apiSourceDetailLabel\(detail\)/);
});

test("generated image surfaces show a short API source badge directly on the image", () => {
  assert.match(apiSourceBadgeSource, /export function HistoryApiSourceBadge/);
  assert.match(apiSourceBadgeSource, /useStudioStore\(\(state\) => state\.profiles\)/);
  assert.match(apiSourceBadgeSource, /FHL_BASE_URL/);
  assert.match(apiSourceBadgeSource, /FHL_IMAGE_MODEL_ID/);
  assert.match(apiSourceBadgeSource, /function isFHLProfile/);
  assert.match(apiSourceBadgeSource, /const matchedProfile = profiles\.find/);
  assert.match(apiSourceBadgeSource, /sourceLooksLikeFHL/);
  assert.match(apiSourceBadgeSource, /apiMode: "responses"/);
  assert.match(apiSourceBadgeSource, /apiSourceShortLabel\(resolvedSource\)/);
  assert.match(apiSourceBadgeSource, /pointer-events-none/);
  assert.match(tileSource, /<HistoryApiSourceBadge source=\{item\}/);
  assert.match(batchGridSource, /<HistoryApiSourceBadge source=\{item\} className="batch-grid-api-source/);
  assert.match(canvasStageSource, /currentImageBadgeBounds/);
  assert.match(canvasStageSource, /<HistoryApiSourceBadge source=\{currentImageApiSource\} className="canvas-api-source-badge/);
  assert.match(androidTileSource, /<HistoryApiSourceBadge source=\{item\}/);
  assert.match(apiSourceSource, /apimart\/i\.test\(cleaned\)/);
});

test("batch result previews recover API source from their task records", () => {
  assert.match(canvasStageSource, /function itemWithTaskApiSource/);
  assert.match(canvasStageSource, /apiMode = task\.apiMode \|\| item\.apiMode/);
  assert.match(canvasStageSource, /const size = task\.size \|\| item\.size/);
  assert.match(canvasStageSource, /const sourcedItem = item \? itemWithTaskApiSource\(item, task\) : null;/);
  assert.match(canvasStageSource, /itemWithTaskApiSource\(preview, task\)/);
  assert.match(canvasStageSource, /currentImageApiSource/);
});

test("batch task placeholders show API source badges while queued or running", () => {
  assert.match(batchGridSource, /import type \{ HistoryApiSource \} from "\.\.\/history\/historyApiSource"/);
  assert.match(batchGridSource, /apiSource\?: HistoryApiSource \| null;/);
  assert.match(batchGridSource, /slot\.apiSource \? <HistoryApiSourceBadge source=\{slot\.apiSource\} className="batch-grid-api-source rounded-\[6px\]" \/> : null/);
  assert.match(canvasStageSource, /function apiSourceFromRecord/);
  assert.match(canvasStageSource, /const apiSource = apiSourceFromRecord\(task\);/);
  assert.match(canvasStageSource, /apiSource,\s*sourcePreview/);
  assert.match(canvasStageSource, /apiSource: apiSourceFromRecord\(latest\?\.group\)/);
});

test("Windows result summaries include short API source labels", () => {
  assert.match(windowsHistoryRailSource, /import \{ apiSourceShortLabel \} from "\.\/historyApiSource"/);
  assert.match(windowsHistoryRailSource, /function apiSourceMetaLabel/);
  assert.match(windowsHistoryRailSource, /const groupApiSource = apiSourceMetaLabel\(group\)/);
  assert.match(windowsHistoryRailSource, /items=\{\[groupApiSource, sizeLabel\(group\.size\), qualityLabel\(group\.quality\), `\$\{group\.batchCount\} 张`\]\.filter\(Boolean\)\}/);
  assert.match(windowsHistoryRailSource, /const slotApiSource = apiSourceMetaLabel\(\{\s*apiMode: slot\.task\?\.apiMode \?\? item\.apiMode/);
  assert.match(windowsHistoryRailSource, /const slotApiSource = apiSourceMetaLabel\(slot\.task\)/);
  assert.match(windowsHistoryRailSource, /items=\{\[slotApiSource, sizeLabel\(slotSize\), qualityLabel\(slotQuality\)\]\.filter\(Boolean\)\}/);
});

test("switching API profiles preserves the current batch preview", () => {
  const profileSource = readFileSync(new URL("../src/state/studioStore.profiles.ts", import.meta.url), "utf8");
  const setActiveProfileBlock = profileSource.match(/async setActiveProfile\(id: string\) \{[\s\S]+?\n    \},/)?.[0] ?? "";
  assert.match(setActiveProfileBlock, /activeProfileId: id/);
  assert.match(setActiveProfileBlock, /activeProfileRuntimePatch\(profile, before\.fhlTransportMode\)/);
  assert.doesNotMatch(setActiveProfileBlock, /resultGridOpen:\s*false/);
  assert.doesNotMatch(setActiveProfileBlock, /selectedBatchTaskId:\s*null/);
  assert.doesNotMatch(setActiveProfileBlock, /patchWorkspaceRuntime/);
  assert.match(canvasStageSource, /function apiSourceMatchesActiveProfile/);
  assert.match(canvasStageSource, /source\.apiMode === "runninghub" && apiMode === "runninghub"/);
  assert.match(canvasStageSource, /const resultGridMatchesActiveApiSource = displayBatchSlots\.every/);
  assert.match(canvasStageSource, /const hasCurrentBatchSession = hasBatchTaskRecords/);
  assert.match(canvasStageSource, /hasWorkspaceBatchResultContext/);
  assert.match(canvasStageSource, /\(hasCurrentBatchSession \|\| hasWorkspaceBatchResultContext \|\| resultGridMatchesActiveApiSource\)/);
});

test("API source badges use configured names as short labels", () => {
  assert.equal(apiSourceShortLabel({ apiMode: "apimart", apiProfileName: "APIMart main" }), "APIMart");
  assert.equal(apiSourceShortLabel({ apiMode: "responses", apiProfileName: "FHL main" }), "FHL");
  assert.equal(apiSourceShortLabel({ apiMode: "apimart", apiProfileName: "" }), "APIMart");
  assert.equal(apiSourceShortLabel({ apiMode: "apimart", apiProfileName: "FHL-1 Responses" }), "APIMart");
  assert.equal(apiSourceShortLabel({ apiMode: "runninghub", apiProfileName: "FHL-1 Images" }), "RunningHub");
  assert.equal(apiSourceShortLabel({ apiMode: "responses", apiProfileName: "" }), "FHL");
  assert.equal(apiSourceShortLabel({ apiMode: "images", apiProfileName: "" }), "Images");
  assert.equal(apiSourceShortLabel({ apiMode: "images", apiProfileId: "fhl-responses-default", apiProfileName: "配置1" }), "FHL");
  assert.equal(apiSourceShortLabel({ apiMode: "apimart", apiProfileName: "custom-production-profile" }), "APIMart");
  assert.equal(apiSourceShortLabel({ apiProfileName: "custom-production-profile" }), "custom");
  assert.equal(apiSourceDetailLabel({ apiMode: "apimart", apiProfileName: "APIMart main" }), "APIMart main | APIMart");
});
