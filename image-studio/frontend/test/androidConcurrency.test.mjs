import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  MAX_ANDROID_JOB_GROUPS,
  MAX_ANDROID_TERMINAL_JOB_GROUPS,
  mergeAndroidJobGroupList,
  mergeJobGroupList,
  retainAndroidJobGroups,
} from "../src/state/browserJobs.ts";
import { historyPageHasMore, historyPageIsStalled, retainHistoryItems } from "../src/state/historyRetention.ts";

const store = readFileSync(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
const workspaceActions = readFileSync(new URL("../src/state/studioStore.workspaces.ts", import.meta.url), "utf8");
const sharedStore = readFileSync(new URL("../src/state/studioStore.shared.ts", import.meta.url), "utf8");
const profiles = readFileSync(new URL("../src/lib/profiles.ts", import.meta.url), "utf8");
const fhlAPI = readFileSync(new URL("../src/lib/fhlAPI.ts", import.meta.url), "utf8");
const apimartAPI = readFileSync(new URL("../src/lib/apimartAPI.ts", import.meta.url), "utf8");
const upstreamForm = readFileSync(new URL("../src/platform/android/upstream/AndroidUpstreamProfileForm.tsx", import.meta.url), "utf8");
const phoneCompose = readFileSync(new URL("../src/platform/android/AndroidPhoneComposePanel.tsx", import.meta.url), "utf8");
const padCompose = readFileSync(new URL("../src/platform/android/AndroidPadComposePanel.tsx", import.meta.url), "utf8");
const layoutCss = readFileSync(new URL("../src/styles/_layout.css", import.meta.url), "utf8");
const phoneParams = readFileSync(new URL("../src/platform/android/parameters/AndroidPhoneParameterSection.tsx", import.meta.url), "utf8");
const padParams = readFileSync(new URL("../src/platform/android/parameters/AndroidPadParameterSection.tsx", import.meta.url), "utf8");
const primitives = readFileSync(new URL("../src/platform/android/parameters/AndroidParameterPrimitives.tsx", import.meta.url), "utf8");
const parameterEditor = readFileSync(new URL("../src/platform/android/parameters/AndroidParameterEditor.tsx", import.meta.url), "utf8");
const parameterOptions = readFileSync(new URL("../src/platform/android/parameters/parameterOptions.ts", import.meta.url), "utf8");
const browserJobs = readFileSync(new URL("../src/state/browserJobs.ts", import.meta.url), "utf8");
const contracts = readFileSync(new URL("../src/platform/runtime/browserJobContracts.ts", import.meta.url), "utf8");
const domain = readFileSync(new URL("../src/types/domain.ts", import.meta.url), "utf8");
const hostTypes = readFileSync(new URL("../src/platform/runtime/hostTypes.ts", import.meta.url), "utf8");
const remoteTypes = readFileSync(new URL("../src/platform/runtime/remote-kernel/types.ts", import.meta.url), "utf8");
const requestPayloads = readFileSync(new URL("../src/platform/runtime/remote-kernel/requestPayloads.ts", import.meta.url), "utf8");
const apimart = readFileSync(new URL("../src/platform/runtime/remote-kernel/apimart.ts", import.meta.url), "utf8");
const requestModel = readFileSync(new URL("../../../shared/kernel/requestModel.js", import.meta.url), "utf8");
const androidJobManager = readFileSync(new URL("../../../android-shell/app/src/main/java/top/gptcodex/imagestudio/android/AndroidJobManager.kt", import.meta.url), "utf8");
const androidSchedulingPolicy = readFileSync(new URL("../../../android-shell/app/src/main/java/top/gptcodex/imagestudio/android/AndroidJobSchedulingPolicy.kt", import.meta.url), "utf8");
const androidJobClient = readFileSync(new URL("../src/platform/runtime/androidJobClient.ts", import.meta.url), "utf8");
const mediaActions = readFileSync(new URL("../src/state/studioStore.media.ts", import.meta.url), "utf8");
const historyOperations = readFileSync(new URL("../src/state/historyOperations.ts", import.meta.url), "utf8");
const androidJobService = readFileSync(new URL("../../../android-shell/app/src/main/java/top/gptcodex/imagestudio/android/AndroidJobService.kt", import.meta.url), "utf8");
const settingsPanel = readFileSync(new URL("../src/components/panel/SettingsPanel.tsx", import.meta.url), "utf8");

test("Android upstream config exposes the shared concurrency limit stepper", () => {
  assert.match(upstreamForm, /concurrencyLimit/);
  assert.match(upstreamForm, /Math\.max\(1, phoneSafeConcurrency - 1\)/);
  assert.match(upstreamForm, /Math\.min\(2, phoneSafeConcurrency \+ 1\)/);
});

test("Android compose summary distinguishes the fixed FHL pool from non-pool limits", () => {
  for (const source of [phoneCompose, padCompose]) {
    assert.match(source, /activeProfileId/);
    assert.match(source, /const activeProfile = profiles\.find\(\(profile\) => profile\.id === activeProfileId\)/);
    assert.match(source, /isOfficialFHLPoolProfile/);
    assert.match(source, /const fhlImagesPoolActive = !!activeProfile && isOfficialFHLPoolProfile\(activeProfile\);/);
    assert.doesNotMatch(source, /const fhlImagesPoolActive = apiMode === "images"/);
    assert.match(source, /FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT/);
    assert.match(source, /concurrencyLimit=\{activeConcurrencyLimit\}/);
    assert.match(source, /fhlImagesPoolActive=\{fhlImagesPoolActive\}/);
  }
  for (const source of [phoneParams, padParams]) {
    assert.match(source, /concurrencyLimit: number;/);
    assert.match(source, /concurrencyLimit,/);
  }
  assert.match(primitives, /key: "concurrency"/);
  assert.match(primitives, /label: continuousGenerateTest === true \? "连续并发" : "并发上限"/);
  assert.match(primitives, /"每槽 4 \/ 总 40"/);
});

test("Android FHL pool bypasses the old frontend limit while non-pool jobs still enforce it", () => {
  assert.match(store, /const isAndroidFHLImagesPoolTask = isAndroidTaskProxyMode\(\)/);
  assert.match(store, /effectiveAPIMode === "images"/);
  assert.match(store, /fhlImagesPoolSlot !== undefined/);
  assert.match(store, /isAndroidFHLImagesPoolTask\s*\? FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT/);
  assert.match(store, /if \(!isAndroidFHLImagesPoolTask && concurrencyLimit > 0\)/);
  assert.match(store, /const rawConcurrencyLimit = normalizeConcurrencyLimit\(activeProfile\?\.concurrencyLimit \?\? 0\);/);
  assert.match(store, /Math\.min\(2, Math\.max\(1, rawConcurrencyLimit \|\| 1\)\)/);
  assert.match(store, /workspaceNonPoolProfileRunningCount\(s, effectiveAPIMode, activeProfile\?\.id\)/);
  assert.match(store, /if \(available <= 0\)/);
  assert.match(store, /else if \(!appendingContinuousRun && available < batchCount\)/);
  assert.match(store, /errorMessage: `\$\{apiLabel\} 并发限制 \$\{concurrencyLimit\}/);
});

test("one-click presets preserve existing profile concurrency settings", () => {
  assert.match(fhlAPI, /fhlProfile\.concurrencyLimit > 0 \? Math\.min\(2, fhlProfile\.concurrencyLimit\) : DEFAULT_CONCURRENCY_LIMIT/);
  assert.match(apimartAPI, /existing\.concurrencyLimit > 0 \? Math\.min\(2, existing\.concurrencyLimit\) : DEFAULT_CONCURRENCY_LIMIT/);
});

test("Android parameters expose continuous generation mode", () => {
  assert.match(parameterEditor, /AndroidToggleSetting/);
  assert.match(parameterEditor, /label="连续出图模式"/);
  assert.match(parameterEditor, /setField\("continuousGenerateTest", next\)/);
  assert.match(parameterEditor, /!\s*continuousGenerateTest \? \(/);
  assert.match(parameterEditor, /label="连续并发"/);
  assert.match(parameterEditor, /ANDROID_CONTINUOUS_CONCURRENCY_OPTIONS/);
  assert.match(parameterEditor, /onConcurrencyLimitChange/);
  assert.match(parameterOptions, /ANDROID_CONTINUOUS_CONCURRENCY_OPTIONS/);
  assert.match(primitives, /key: "continuous"/);
  assert.match(primitives, /label: "连续生成"/);
  assert.match(primitives, /label: continuousGenerateTest === true \? "连续并发" : "并发上限"/);
  for (const source of [phoneParams, padParams]) {
    assert.match(source, /continuousGenerateTest: boolean;/);
    assert.match(source, /continuousGenerateTest=\{continuousGenerateTest\}/);
    assert.match(source, /onConcurrencyLimitChange/);
  }
  for (const source of [phoneCompose, padCompose]) {
    assert.match(source, /continuousGenerateTest/);
    assert.match(source, /updateProfile/);
    assert.match(source, /concurrencyLimit: normalized/);
    assert.match(source, /追加生成/);
  }
});

test("Android defaults enable continuous generation with phone-safe API concurrency", () => {
  assert.match(store, /continuousGenerateTest: true/);
  assert.match(store, /const ANDROID_CONTINUOUS_DEFAULT_KEY = storageKey\("gptcodex\.androidContinuousDefault\.v1"\);/);
  assert.match(store, /runtimePlatform\.isAndroid && shouldApplyAndroidContinuousDefault\(\)/);
  assert.match(store, /continuousGenerateTest: restoredActiveWorkspace\.continuousGenerateTest \?\? true/);
  assert.match(workspaceActions, /continuousGenerateTest: true/);
  assert.match(workspaceActions, /continuousGenerateTest: newWorkspace\.continuousGenerateTest \?\? true/);
  assert.match(sharedStore, /continuousGenerateTest: raw\.continuousGenerateTest !== false/);
  assert.match(profiles, /export const DEFAULT_CONCURRENCY_LIMIT = 1;/);
  assert.match(profiles, /export function makeFHLResponsesProfile[\s\S]*concurrencyLimit: DEFAULT_CONCURRENCY_LIMIT/);
  assert.match(profiles, /export function makeAPIMartProfile[\s\S]*concurrencyLimit: DEFAULT_CONCURRENCY_LIMIT/);
  assert.match(fhlAPI, /concurrencyLimit: DEFAULT_CONCURRENCY_LIMIT/);
  assert.match(apimartAPI, /concurrencyLimit: DEFAULT_CONCURRENCY_LIMIT/);
});

test("Android parameters expose separate size and aspect controls", () => {
  assert.match(parameterEditor, /<AndroidParameterBlock title="画幅比例">/);
  assert.match(parameterEditor, /label="尺寸"/);
  assert.doesNotMatch(parameterEditor, /label="分辨率"/);
  assert.match(primitives, /\{ key: "aspect", label: "比例", value: activeAspectLabel \}/);
  assert.match(primitives, /\{ key: "resolution", label: "尺寸", value: activeResolutionLabel \}/);
  assert.match(primitives, /ariaLabel="画幅比例"/);
});

test("Android submit allows appending only when continuous mode is enabled", () => {
  assert.match(store, /const appendingContinuousRun = s\.isRunning && s\.continuousGenerateTest === true/);
  assert.match(store, /s\.isRunning && !s\.continuousGenerateTest/);
  assert.match(store, /连续生成模式关闭时不会并发提交/);
  assert.match(store, /const selectedBatchCount = normalizeBatchCount\(s\.batchCount\);/);
  assert.match(store, /const requestedBatchCount = s\.continuousGenerateTest === true \? 1 : selectedBatchCount;/);
  assert.match(store, /batchCount: selectedBatchCount/);
  assert.match(store, /batchCount = available/);
  assert.match(store, /batchIndexOffset \+ i/);
  assert.match(store, /continuousGenerateTest: s\.continuousGenerateTest === true/);
  assert.match(store, /continuousBatchIndex: appendingContinuousRun \? existingJobsTotal : 0/);
});

test("Android running append CTA gives more room to append and makes cancel bright red", () => {
  for (const source of [phoneCompose, padCompose]) {
    assert.match(source, /android-running-cta-row/);
    assert.match(source, /android-running-append-button/);
    assert.match(source, /android-running-cancel-button/);
  }
  assert.match(layoutCss, /grid-template-columns: minmax\(0, 1fr\) 78px/);
  assert.match(layoutCss, /background: linear-gradient\(180deg, #ff4d4f, #dc2626\)/);
  assert.match(layoutCss, /color: #fff/);
});

test("Android background job groups keep continuous append metadata and aggregate running groups", () => {
  assert.match(domain, /continuousGenerateTest\?: boolean/);
  assert.match(domain, /continuousBatchIndex\?: number/);
  assert.match(domain, /requestRunId\?: string/);
  assert.match(domain, /concurrencyLimit\?: number/);
  assert.match(contracts, /continuousGenerateTest\?: boolean/);
  assert.match(contracts, /continuousBatchIndex\?: number/);
  assert.match(contracts, /requestRunId\?: string/);
  assert.match(contracts, /concurrencyLimit\?: number/);
  assert.match(androidJobManager, /val continuousBatchIndex = payload\.optInt\("continuousBatchIndex", 0\)\.coerceAtLeast\(0\)/);
  assert.match(androidJobManager, /\.put\("concurrencyLimit", payload\.optInt\("concurrencyLimit", 0\)\.coerceAtLeast\(0\)\)/);
  assert.match(androidJobManager, /\.put\("batchIndex", continuousBatchIndex \+ index\)/);
  assert.match(androidJobManager, /\.put\("requestRunId", requestRunId\)/);
  assert.match(store, /concurrencyLimit,/);
  assert.match(browserJobs, /const runningGroups = groups/);
  assert.match(browserJobs, /runningGroups\.flatMap/);
  assert.match(browserJobs, /runningGroups\.reduce\(\(sum, group\) => sum \+ group\.batchCount, 0\)/);
});

test("Android job cache keeps every live group and the newest 500 terminal groups", () => {
  const makeGroup = (id, status, createdAt) => ({
    groupId: id,
    workspaceId: "workspace-1",
    createdAt,
    slots: [{ jobId: `job-${id}`, status, updatedAt: createdAt }],
  });
  const active = Array.from({ length: 200 }, (_, index) => makeGroup(`active-${index}`, "queued", 10_000 - index));
  const terminal = Array.from({ length: 510 }, (_, index) => makeGroup(`terminal-${index}`, "succeeded", 9_000 - index));

  const retained = retainAndroidJobGroups([...terminal, ...active]);
  assert.equal(MAX_ANDROID_JOB_GROUPS, 700);
  assert.equal(MAX_ANDROID_TERMINAL_JOB_GROUPS, 500);
  assert.equal(retained.length, 700);
  assert.equal(retained.filter((group) => group.slots[0].status === "queued").length, 200);
  assert.equal(retained.filter((group) => group.slots[0].status === "succeeded").length, 500);
  assert.ok(retained.some((group) => group.groupId === "terminal-499"));
  assert.ok(!retained.some((group) => group.groupId === "terminal-500"));

  const updated = mergeAndroidJobGroupList(retained, makeGroup("active-0", "running", 20_000));
  assert.equal(updated.filter((group) => group.groupId === "active-0").length, 1);
  assert.equal(updated.find((group) => group.groupId === "active-0")?.slots[0].status, "running");

  const browserRetained = terminal.slice(0, 60).reduce(
    (groups, group) => mergeJobGroupList(groups, group),
    [],
  );
  assert.equal(browserRetained.length, 50);
  assert.match(androidJobClient, /listAndroidJobGroups\(workspaceId: string, limit = 700\)/);
});

test("Android history keeps every page while desktop retains its 120 item cap", () => {
  const items = Array.from({ length: 200 }, (_, index) => index);
  assert.equal(retainHistoryItems(items, true).length, 200);
  assert.equal(retainHistoryItems(items, false).length, 120);
  assert.equal(historyPageHasMore({ beforeDayStart: 1 }, 200, true), true);
  assert.equal(historyPageHasMore({ beforeDayStart: 1 }, 120, false), false);
  assert.equal(historyPageHasMore(null, 10, true), false);
  assert.equal(historyPageIsStalled(100, 48, 100, 48, true), true);
  assert.equal(historyPageIsStalled(100, 48, 50, 48, true), false);
  assert.equal(historyPageIsStalled(100, 48, 100, 48, false), false);
  assert.match(sharedStore, /if \(isAndroid && !force\) return/);
  assert.match(historyOperations, /export async function ensureAllHistoryLoaded/);
  assert.match(historyOperations, /historyPageIsStalled\(/);
  assert.match(historyOperations, /export async function clearAllHistory/);
  assert.match(sharedStore, /persistTrimmedHistory\(items: HistoryItem\[\], force = false\): Promise<void>/);
  assert.match(sharedStore, /const keptIDs = items\.map\(\(item\) => item\.id\)/);
  assert.match(sharedStore, /return pruneHistoryStorage\(keptIDs\)/);
  assert.match(mediaActions, /await persistTrimmedHistory\(kept, true\)/);
  assert.match(mediaActions, /async exportHistory\(\) \{[\s\S]*?try \{[\s\S]*?await ensureAllHistoryLoaded\(store\.getState\);/);
  assert.match(settingsPanel, /await clearAllHistory\(/);
  assert.doesNotMatch(settingsPanel, /while \(useStudioStore\.getState\(\)\.historyHasMore\)/);
  assert.match(settingsPanel, /历史清空失败:\$\{e\?\.message \?\? e\}/);
  assert.match(settingsPanel, /async function pruneHistory\(days: number\) \{\s+try \{/);
  assert.match(settingsPanel, /历史清理失败:\$\{e\?\.message \?\? e\}/);
});

test("only the current worker generation may stop the Android foreground service", () => {
  assert.match(androidJobService, /stopSelfResult\(startId\)/);
  assert.doesNotMatch(androidJobService, /\bstopSelf\(\)/);
  assert.match(androidJobManager, /private val workerGeneration = AtomicLong\(0L\)/);
  assert.match(androidJobManager, /private val idleRegistration = AtomicReference\(IdleRegistration\(0L, null\)\)/);
  assert.match(androidJobManager, /invokeIdleIfCurrent\(generation\)/);
});

test("Android native background worker enforces independent 4/40 pool reservations", () => {
  assert.match(androidJobManager, /private const val registryVersion = 3/);
  assert.match(androidJobManager, /private val activeWorkerJobIds = ConcurrentHashMap\.newKeySet<String>\(\)/);
  assert.match(androidJobManager, /private val activeReservations = ConcurrentHashMap<String, AndroidJobSchedulingPolicy\.Reservation>\(\)/);
  assert.match(androidJobManager, /runWorkerConcurrent\(context, generation\)/);
  assert.match(androidJobManager, /private fun runWorkerConcurrent\(context: Context, generation: Long\)/);
  assert.match(androidJobManager, /val next = claimNextQueuedSlot\(context\) \?: break/);
  assert.match(androidJobManager, /thread\(name = "fhl-studio-android-job-\$\{jobId\.takeLast\(8\)\}"\)/);
  assert.match(androidJobManager, /activeWorkerJobIds\.remove\(jobId\)/);
  assert.match(androidJobManager, /private fun claimNextQueuedSlot\(context: Context\): Pair<JSONObject, JSONObject>\?/);
  assert.match(androidJobManager, /AndroidJobSchedulingPolicy\.selectNext/);
  assert.match(androidJobManager, /queueSequence/);
  assert.match(androidJobManager, /private fun releaseReservation\(context: Context, jobId: String\)/);
  assert.match(androidJobManager, /liveSlot\.put\("status", "running"\)/);
  assert.match(androidSchedulingPolicy, /const val FHL_IMAGES_POOL_SLOT_LIMIT = 4/);
  assert.match(androidSchedulingPolicy, /const val FHL_IMAGES_POOL_TOTAL_LIMIT = 40/);
  assert.match(androidSchedulingPolicy, /const val MAX_NON_TERMINAL_SLOTS = 200/);
  assert.match(androidSchedulingPolicy, /const val TERMINAL_GROUP_RETENTION = 500/);
  assert.match(androidSchedulingPolicy, /val nonPoolLaneKey: String/);
  assert.match(androidSchedulingPolicy, /val blockedDirectLanes = mutableSetOf<String>\(\)/);
  assert.match(androidSchedulingPolicy, /normalizedNonPoolLaneKey\(it\.nonPoolLaneKey\) == laneKey/);
  assert.match(androidJobManager, /slot\.optString\("apiProfileId"\)\.ifBlank \{ group\.optString\("apiProfileId"\) \}/);
  assert.match(androidJobManager, /liveSlot\.put\("reservationLaneKey", reservation\.nonPoolLaneKey\)/);
  assert.doesNotMatch(androidJobManager, /nativeDefaultParallelJobs/);
  assert.doesNotMatch(androidJobManager, /nativeMaxParallelJobs/);
});

test("Android background slots isolate random batch requests to avoid duplicate images", () => {
  assert.match(hostTypes, /requestRunId\?: string/);
  assert.match(hostTypes, /batchVariationKey\?: string/);
  assert.match(remoteTypes, /requestRunId\?: string/);
  assert.match(remoteTypes, /batchVariationKey\?: string/);
  assert.match(store, /requestRunId = requireSecureRandomUUID\("付费生图请求"\);/);
  assert.match(store, /requestRunId,/);
  assert.match(store, /batchVariationKey: `\$\{requestRunId\}-\$\{batchIndex \+ 1\}`/);
  assert.match(contracts, /requestRunId\?: string/);
  assert.match(androidJobManager, /seedForRandomBatchSlot\(jobId, batchIndex\)/);
  assert.match(androidJobManager, /slotPayload\.put\("batchIndex", batchIndex\)/);
  assert.match(androidJobManager, /slotPayload\.put\("requestRunId", requestRunId\)/);
  assert.match(androidJobManager, /slotPayload\.put\("batchVariationKey", "\$requestRunId-\$\{jobId\.takeLast\(12\)\}-\$\{batchIndex \+ 1\}"\)/);
  assert.match(androidJobManager, /slotPayload\.put\("apiMode", apiMode\)/);
  assert.match(androidJobManager, /"images" -> requestImages\(context, jobId, slotPayload, startedAt\)/);
  assert.match(androidJobManager, /else -> requestResponses\(context, jobId, slotPayload, startedAt\)/);
  assert.match(androidJobManager, /"apimart" -> requestAPIMart\(context, jobId, slotPayload, startedAt\)/);
  assert.match(androidJobManager, /"runninghub" -> requestRunningHub\(context, jobId, slotPayload, startedAt\)/);
  assert.match(androidJobManager, /content\.put\(JSONObject\(\)\.put\("type", "input_text"\)\.put\("text", variation\)\)/);
  assert.match(androidJobManager, /Request isolation: this is an independent generation task/);
  assert.match(androidJobManager, /distinct non-duplicate final image/);
  assert.match(androidJobManager, /UUID\.nameUUIDFromBytes\("\$jobId:\$batchIndex"\.toByteArray\(Charsets\.UTF_8\)\)/);
  assert.match(requestModel, /export function buildBatchVariationInstruction\(payload\)/);
  assert.match(requestModel, /You must return a distinct non-duplicate final image/);
  assert.match(requestModel, /content\.push\(\{ type: "input_text", text: variation \}\)/);
  assert.match(requestPayloads, /promptWithBatchVariation\(request\.payload\)/);
  assert.match(apimart, /prompt: promptWithBatchVariation\(request\.payload\)/);
});

test("Android paid submission failures cannot trigger a second POST", () => {
  const paidRoutes = [
    ["responses", "requestResponses", "requestResponsesOnce"],
    ["images", "requestImages", "requestImagesOnce"],
    ["apimart", "requestAPIMart", "requestAPIMartOnce"],
    ["runninghub", "requestRunningHub", "requestRunningHubOnce"],
  ];
  for (const [apiMode, route, onceRoute] of paidRoutes) {
    const start = androidJobManager.indexOf(`private fun ${route}(`);
    const end = androidJobManager.indexOf(`private fun ${onceRoute}(`, start);
    assert.ok(start >= 0 && end > start, `${apiMode} paid route should be present`);
    const routeSource = androidJobManager.slice(start, end);
    assert.match(routeSource, new RegExp(`paidSubmissionAttemptNumbers\\("${apiMode}"\\)\\.single\\(\\)`));
    assert.equal(
      routeSource.match(new RegExp(`${onceRoute}\\(`, "g"))?.length,
      1,
      `${apiMode} must invoke its paid submission exactly once`,
    );
    assert.doesNotMatch(routeSource, /for\s*\(|while\s*\(|retry|fallback/i);
  }

  assert.match(
    androidJobManager,
    /private fun paidSubmissionAttemptNumbers\(apiMode: String\): IntRange \{[\s\S]*?"images", "responses", "apimart", "runninghub" -> 1\.\.1[\s\S]*?\n    \}/,
  );
  assert.match(androidJobManager, /private fun shouldFollowRedirect\(method: String\): Boolean = method\.equals\("GET", ignoreCase = true\)/);
  assert.match(androidJobManager, /requestMethod = "POST"\s*instanceFollowRedirects = shouldFollowRedirect\("POST"\)/);
  assert.match(androidJobManager, /requestMethod = method\s*instanceFollowRedirects = shouldFollowRedirect\(method\)/);
  assert.doesNotMatch(androidJobManager, /WithRetries|maxAttempts|retryBackoffMs/);

  const submissionBasesStart = androidJobManager.indexOf("private fun apimartSubmissionBaseURLs(");
  const submissionBasesEnd = androidJobManager.indexOf("private fun apimartQueryBaseURLCandidates(", submissionBasesStart);
  const submissionBasesSource = androidJobManager.slice(submissionBasesStart, submissionBasesEnd);
  assert.match(submissionBasesSource, /return listOf\(/);
  assert.doesNotMatch(submissionBasesSource, /apimartLegacyBaseUrl/);

  const failureContracts = [
    ["EOF", /catch \(error: Exception\)/],
    ["timeout", /connectTimeout = 30_000[\s\S]*?readTimeout = 600_000/],
    ["5xx", /if \(status !in 200\.\.299\)/],
    ["empty response", /did not return an image|result image is empty|interface returned empty/i],
    ["parse failure", /JSON parse failed|extractFinalImageResult\(rawText\)/],
    ["3xx redirect", /shouldFollowRedirect\("POST"\)/],
  ];
  for (const [failure, contract] of failureContracts) {
    assert.match(androidJobManager, contract, `${failure} must remain on the single-attempt failure path`);
  }
});

test("Android non-background result writes are keyed by their own job id", () => {
  assert.match(store, /const itemID = browserHistoryId\(jobId\);/);
  assert.match(store, /\.\.\.store\.getState\(\)\.history\.filter\(\(entry\) => entry\.id !== historyItem\.id\)/);
  assert.match(store, /\[\.\.\.state\.batchResults\.filter\(\(item\) => item\.id !== historyItem\.id\), historyItem\]/);
  assert.match(store, /\.sort\(\(a, b\) => \(a\.batchIndex \?\? 0\) - \(b\.batchIndex \?\? 0\)\)/);
});
