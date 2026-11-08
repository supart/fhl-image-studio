import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const header = readFileSync(new URL("../src/components/layout/AppHeader.tsx", import.meta.url), "utf8");
const settingsPanel = readFileSync(new URL("../src/components/panel/SettingsPanel.tsx", import.meta.url), "utf8");
const androidSettings = readFileSync(new URL("../src/platform/android/settings/AndroidSettingsPanel.tsx", import.meta.url), "utf8");
const phoneCompose = readFileSync(new URL("../src/platform/android/AndroidPhoneComposePanel.tsx", import.meta.url), "utf8");
const padCompose = readFileSync(new URL("../src/platform/android/AndroidPadComposePanel.tsx", import.meta.url), "utf8");
const quickProfileSheet = readFileSync(new URL("../src/platform/android/AndroidQuickProfileSheet.tsx", import.meta.url), "utf8");
const brandAboutSheet = readFileSync(new URL("../src/platform/android/AndroidBrandAboutSheet.tsx", import.meta.url), "utf8");
const store = readFileSync(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../src/state/studioStore.runtime.ts", import.meta.url), "utf8");
const layoutCss = readFileSync(new URL("../src/styles/_layout.css", import.meta.url), "utf8");
const upstreamConfig = readFileSync(new URL("../src/platform/android/upstream/useAndroidUpstreamConfig.ts", import.meta.url), "utf8");
const upstreamHeader = readFileSync(new URL("../src/platform/android/upstream/AndroidUpstreamHeader.tsx", import.meta.url), "utf8");
const upstreamRail = readFileSync(new URL("../src/platform/android/upstream/AndroidUpstreamProfileRail.tsx", import.meta.url), "utf8");
const upstreamProfileForm = readFileSync(new URL("../src/platform/android/upstream/AndroidUpstreamProfileForm.tsx", import.meta.url), "utf8");
const upstreamModal = readFileSync(new URL("../src/platform/android/upstream/AndroidUpstreamConfigModal.tsx", import.meta.url), "utf8");
const fhlPoolConfig = readFileSync(new URL("../src/platform/android/upstream/AndroidFHLImagesPoolConfig.tsx", import.meta.url), "utf8");
const fhlPoolSavePlan = readFileSync(new URL("../src/platform/android/upstream/fhlPoolSavePlan.ts", import.meta.url), "utf8");
const fhlBulkPasteDialog = readFileSync(new URL("../src/platform/android/upstream/AndroidBulkAPIKeyPasteDialog.tsx", import.meta.url), "utf8");
const transportSwitch = readFileSync(new URL("../src/platform/android/AndroidFHLTransportModeSwitch.tsx", import.meta.url), "utf8");
const upstreamCss = readFileSync(new URL("../src/styles/_android-upstream.css", import.meta.url), "utf8");
const runningHubChoiceModal = readFileSync(new URL("../src/components/panel/RunningHubAPIChoiceModal.tsx", import.meta.url), "utf8");
const runningHubQuickConfigModal = readFileSync(new URL("../src/components/panel/RunningHubQuickConfigModal.tsx", import.meta.url), "utf8");
const fhlAPI = readFileSync(new URL("../src/lib/fhlAPI.ts", import.meta.url), "utf8");
const profiles = readFileSync(new URL("../src/lib/profiles.ts", import.meta.url), "utf8");
const bootstrapHook = readFileSync(new URL("../src/app/hooks/useStudioBootstrap.ts", import.meta.url), "utf8");

test("Android header configured state accepts API key or RunningHub bridge", () => {
  assert.match(header, /activeProfileUsesBridgeKey = activeProfile\?\.apiMode === "runninghub"/);
  assert.match(header, /isRunningHubBaseURL\(activeProfile\.baseURL\)/);
  assert.match(header, /const hasConfiguredAPIKey = apiKey\.trim\(\)\.length > 0 \|\| activeProfileUsesBridgeKey;/);
  assert.match(header, /const credentialChecking = activeCredentialStatus === "checking";/);
  assert.match(header, /const credentialPending = activeCredentialStatus === "unknown" \|\| credentialChecking;/);
  assert.match(header, /credentialChecking[\s\S]*\? "确认中"/);
  assert.match(header, /activeProfile\?\.apiMode === "runninghub"[\s\S]*\? "RH"/);
});

test("Android compose setup gate accepts API key or RunningHub bridge", () => {
  for (const source of [phoneCompose, padCompose]) {
    assert.match(source, /const hasAPIKey = apiKey\.trim\(\)\.length > 0;/);
    assert.match(source, /const credentialChecking = activeCredentialStatus === "checking";/);
    assert.match(source, /const credentialPending = activeCredentialStatus === "unknown" \|\| credentialChecking;/);
    assert.match(source, /const hasBaseURL = baseURL\.trim\(\)\.length > 0;/);
    assert.match(source, /const runningHubBridgeConfigured = apiMode === "runninghub" && hasBaseURL;/);
    assert.match(source, /const hasUsableUpstream = hasAPIKey \|\| runningHubBridgeConfigured \|\| credentialPending;/);
    assert.match(source, /const canSubmitUpstream = hasAPIKey \|\| runningHubBridgeConfigured;/);
    assert.match(source, /const needsUpstreamSetup = !hasUsableUpstream;/);
    assert.match(source, /const needsBaseURLSetup = hasUsableUpstream && !hasBaseURL;/);
    assert.match(source, /disabled=\{!canSubmitUpstream \|\| !hasBaseURL \|\| !effectivePromptReady\}/);
    assert.match(source, /正在确认 API 凭据/);
    assert.doesNotMatch(source, /const needsUpstreamSetup = !apiKey\.trim\(\) \|\| !baseURL\.trim\(\);/);
  }
});

test("Android settings shows configured by API key or RunningHub bridge", () => {
  assert.match(settingsPanel, /const runningHubBridgeConfigured = apiMode === "runninghub" && !!baseURL\.trim\(\);/);
  assert.match(settingsPanel, /const upstreamReady = !!apiKey\.trim\(\) \|\| runningHubBridgeConfigured;/);
  assert.match(settingsPanel, /const canTestUpstream = upstreamReady && !!baseURL\.trim\(\);/);
  assert.match(settingsPanel, /activeCredentialStatus=\{activeCredentialStatus\}/);
  assert.match(settingsPanel, /canTestUpstream=\{canTestUpstream\}/);
  assert.match(androidSettings, /const credentialChecking = activeCredentialStatus === "checking";/);
  assert.match(androidSettings, /const credentialPending = activeCredentialStatus === "unknown" \|\| credentialChecking;/);
  assert.match(androidSettings, /credentialPending \? "上游凭据确认中"/);
  assert.match(androidSettings, /canTestUpstream: boolean;/);
  assert.match(androidSettings, /disabled=\{!canTestUpstream \|\| isTestingKey\}/);
});

test("Android header can switch active API without opening full settings", () => {
  assert.match(header, /AndroidQuickProfileSheet/);
  assert.match(header, /android-header-brand-button/);
  assert.match(header, /data-audit-id="android-quick-profile"/);
  assert.match(header, /activeProfileModeLabel/);
  assert.match(header, /onClick=\{openAndroidProfilePicker\}/);
  assert.match(header, /const generationProfiles = profiles\.filter\(isSelectableGenerationProfile\);/);
  assert.match(header, /const hasMultipleProfiles = generationProfiles\.length > 1;/);
  assert.match(header, /if \(hasMultipleProfiles\) \{\s*setAndroidProfileOpen\(true\);/);
  assert.match(header, /className=\{`android-header-api-chip \$\{hasMultipleProfiles \? "has-menu" : ""\}`\}/);
  assert.match(header, /hasMultipleProfiles \? <ChevronDown className="h-3 w-3" \/> : null/);
  assert.doesNotMatch(header, /onPointerUp=\{openAndroidProfilePicker\}/);
  assert.match(quickProfileSheet, /setActiveProfile\(profile\.id\)/);
  assert.match(quickProfileSheet, /openUpstreamConfig\("app"\)/);
  assert.match(layoutCss, /\.android-header-top-actions > \.android-header-config-toggle/);
  assert.match(layoutCss, /\.android-header-api-chip/);
  assert.match(layoutCss, /\.android-header-api-chip\.has-menu/);
});

test("Android quick API picker keeps readable contrast in dark mode", () => {
  assert.match(layoutCss, /html\.dark\[data-target-platform="android"\] \.android-quick-profile-card/);
  assert.match(layoutCss, /html\.dark\[data-target-platform="android"\] \.android-quick-profile-summary/);
  assert.match(layoutCss, /html\.dark\[data-target-platform="android"\] \.android-quick-profile-item/);
  assert.match(layoutCss, /html\.dark\[data-target-platform="android"\] \.android-quick-profile-copy strong/);
  assert.match(layoutCss, /html\.dark\[data-target-platform="android"\] \.android-quick-profile-copy small/);
  assert.match(layoutCss, /color: rgb\(248 250 252\)/);
  assert.match(layoutCss, /color: rgb\(226 232 240\)/);
  assert.match(layoutCss, /color: rgb\(204 251 241\)/);
});

test("Android header brand opens about sheet with fork and original GitHub links", () => {
  assert.match(header, /AndroidBrandAboutSheet/);
  assert.match(header, /const \[androidBrandAboutOpen, setAndroidBrandAboutOpen\] = useState\(false\);/);
  assert.match(header, /const openAndroidBrandAbout = \(event: MouseEvent<HTMLButtonElement>\) => \{/);
  assert.match(header, /title="关于 FHL Image Studio"/);
  assert.match(header, /aria-label="关于 FHL Image Studio"/);
  assert.match(header, /onClick=\{openAndroidBrandAbout\}/);
  assert.doesNotMatch(header, /className="no-drag min-w-0 flex-1 android-header-copy android-header-brand-button"[\s\S]{0,240}onClick=\{openAndroidProfilePicker\}/);
  assert.match(header, /onOpenRepo=\{\(\) => openAndroidExternal\(ANDROID_FHL_REPO_URL\)\}/);
  assert.match(header, /onOpenOriginalRepo=\{\(\) => openAndroidExternal\(ANDROID_ORIGINAL_REPO_URL\)\}/);
  assert.match(brandAboutSheet, /ANDROID_FHL_REPO_URL = "https:\/\/github\.com\/supart\/fhl-image-studio"/);
  assert.match(brandAboutSheet, /ANDROID_ORIGINAL_REPO_URL = "https:\/\/github\.com\/RoseKhlifa\/Image-Studio"/);
  assert.match(brandAboutSheet, /const ANDROID_BRAND_VERSION = "V2\.0\.5";/);
  assert.match(brandAboutSheet, /方汤圆版 GitHub/);
  assert.match(brandAboutSheet, /原作者 GitHub/);
  assert.match(brandAboutSheet, /基于 RoseKhlifa\/Image-Studio 的独立修改发行版/);
});

test("generation submit freezes pool assignment while preserving the selected non-pool profile", () => {
  assert.match(store, /const selectedActiveProfile = s\.profiles\.find\(\(p\) => p\.id === s\.activeProfileId\);/);
  assert.match(store, /const useAndroidFHLPool = !frozenReplay && shouldUseAndroidFHLImagesPool\(\s*readRuntimePlatformState\(\)\.isAndroid,\s*s\.continuousGenerateTest === true,\s*selectedActiveProfile,\s*\);/);
  assert.match(store, /let poolAssignment = null;[\s\S]*if \(useAndroidFHLPool\)[\s\S]*poolAssignment = await resolveAndroidFHLPoolAssignment\(s\.profiles\)/);
  assert.match(store, /API 凭据安全迁移失败，请重新配置该 API/);
  assert.match(store, /const apiKey = await GetStoredAPIKey\(keyringUserFor\(profile\.id\)\);/);
  assert.match(store, /const activeProfile = poolAssignment\?\.profile \?\? selectedActiveProfile;/);
  assert.match(store, /const submitAPIMode = frozenReplay\?\.apiMode \?\? activeProfile\?\.apiMode \?\? s\.apiMode;/);
  assert.match(store, /const submitBaseURL = activeProfile\?\.baseURL \?\? s\.baseURL;/);
  assert.match(store, /const submitRequestPolicy = activeProfile\?\.requestPolicy \?\? s\.requestPolicy;/);
  assert.match(store, /const runningHubBridgeSubmit = submitAPIMode === "runninghub" \|\| isRunningHubBaseURL\(submitBaseURL\);/);
  assert.match(store, /if \(!runningHubBridgeSubmit && !submittedAPIKey\.trim\(\)\)/);
  assert.match(store, /if \(!runningHubBridgeSubmit\) \{\s*try \{/);
  assert.match(store, /const preliminaryAPIMode = frozenReplay\?\.apiMode\s*\?\? effectiveAPIModeForSubmit\(s, activeProfile, submitAPIMode\);/);
  assert.match(store, /effectiveProviderMode\(profile, fallbackMode, state\.fhlTransportMode, state\.baseURL\)/);
  assert.match(store, /const effectiveAPIMode = preliminaryAPIMode;/);
  assert.match(store, /baseURL: cleanedBaseURL/);
  assert.match(store, /apiMode: effectiveAPIMode/);
  assert.match(store, /const fhlImagesPoolSlot = normalizeFHLImagesPoolSlot\(/);
  assert.match(store, /frozenReplay\?\.fhlImagesPoolSlot \?\? poolAssignment\?\.slot \?\? activeProfile\?\.fhlImagesPoolSlot/);
  assert.match(store, /fhlImagesPoolSlot,/);
  assert.match(store, /const resolvedSize = normalizeSizeSelection\(s\.size,/);
  assert.doesNotMatch(store, /normalizeFHLImagesBillingSize/);
});

test("Android bootstrap commits metadata before deferred credential, history, output, and job work", () => {
  const profilesReadyIndex = store.indexOf('markBootstrapStage("profiles-ready")');
  const nextPaintIndex = store.indexOf("const nextPaintPromise = waitForNextPaint()", profilesReadyIndex);
  const activeCredentialReadIndex = store.indexOf("const activeKey = await GetStoredAPIKey", profilesReadyIndex);
  const historyReadIndex = store.indexOf("const historyPagePromise = loadHistoryPage", profilesReadyIndex);
  const outputReadIndex = store.indexOf("const effectiveOutput = await GetOutputDir", profilesReadyIndex);
  const jobReadIndex = store.indexOf("const response = await listJobGroups", profilesReadyIndex);
  assert.ok(profilesReadyIndex >= 0);
  assert.ok(nextPaintIndex > profilesReadyIndex, "the paint gate must be created after the shell commit");
  for (const deferredIndex of [activeCredentialReadIndex, historyReadIndex, outputReadIndex, jobReadIndex]) {
    assert.ok(deferredIndex > profilesReadyIndex, "deferred work must start after the profiles-ready commit");
  }
  assert.doesNotMatch(store, /androidProfileKeys/);
  assert.doesNotMatch(store, /for \(const profile of profiles\)[\s\S]{0,240}GetStoredAPIKey/);
  assert.match(store, /activeCredentialStatus: activeProfile[\s\S]*\? "present"[\s\S]*: "checking"/);
  assert.match(store, /bootstrapEpoch !== studioBootstrapEpoch \|\| get\(\)\.activeProfileId !== expectedProfileId/);
  assert.match(store, /await waitForCredentialMutations\(\);\s*const expectedCredentialRevision = currentCredentialMutationRevision\(\);/);
  assert.match(store, /currentCredentialMutationRevision\(\) !== expectedCredentialRevision/);
  assert.match(store, /history: \[\],[\s\S]*historyLoading: true/);
  assert.match(store, /Promise\.allSettled\(\[[\s\S]*credentialTask[\s\S]*outputRootsTask[\s\S]*deferredContentTask/);
  assert.match(store, /function markBootstrapStage\(stage: "start" \| "profiles-ready" \| "credential-ready"\)/);
  assert.match(store, /performance\.mark\(`fhl-bootstrap-\$\{stage\}`\)/);
  assert.match(store, /function waitForNextPaint\(\)[\s\S]*requestAnimationFrame[\s\S]*requestFrame\(\(\) => resolve\(\)\)[\s\S]*setTimeout/);
  const localConfigTask = store.slice(store.indexOf("const localConfigTask"), store.indexOf("const credentialTask"));
  const credentialTask = store.slice(store.indexOf("const credentialTask"), store.indexOf("const outputRootsTask"));
  const outputRootsTask = store.slice(store.indexOf("const outputRootsTask"), store.indexOf("const deferredContentTask"));
  const deferredContentTask = store.slice(store.indexOf("const deferredContentTask"), store.indexOf("await Promise.allSettled"));
  for (const task of [localConfigTask, credentialTask, outputRootsTask, deferredContentTask]) {
    assert.match(task, /async \(\) => \{\s*await nextPaintPromise;/, "deferred bootstrap tasks must yield to paint first");
  }
  assert.doesNotMatch(store, /performance\.mark\([\s\S]{0,100}(apiKey|profile\.name|baseURL)/);
});

test("Studio bootstrap is coalesced in the hook and store under React StrictMode", () => {
  assert.match(bootstrapHook, /let bootstrapPromise: Promise<void> \| null = null;/);
  assert.match(bootstrapHook, /if \(!bootstrapPromise\) \{/);
  assert.match(bootstrapHook, /bootstrapPromise = bootstrap\(\)\.catch/);
  assert.match(store, /if \(studioBootstrapInFlight\) return studioBootstrapInFlight;/);
  assert.match(store, /const bootstrapEpoch = \+\+studioBootstrapEpoch;/);
});

test("Workspace persistence keeps the saved canvas while deferred history is loading", () => {
  assert.match(runtime, /const historyHydrationPending = s\.historyLoading && s\.history\.length === 0 && s\.batchResults\.length === 0;/);
  assert.match(runtime, /currentImageId: historyHydrationPending\s*\n\s*\? \(w\.currentImageId \?\? null\)/);
  assert.match(runtime, /batchResultIds: historyHydrationPending\s*\n\s*\? \[\.\.\.\(w\.batchResultIds \?\? \[\]\)\]/);
});

test("FHL Responses custom aspect sizes stay on Responses API", () => {
  assert.doesNotMatch(store, /FHL_RESPONSES_NATIVE_SIZES/);
  assert.doesNotMatch(store, /function shouldRouteFHLResponsesSizeThroughImages/);
  assert.match(store, /const effectiveAPIMode = preliminaryAPIMode;/);
  assert.match(store, /activeProfile\.imagesNewAPICompat === true \|\| isFHLBaseURL\(cleanedBaseURL\)/);
});

test("Android FHL entry opens a ten-slot Images pool and keeps Responses separate", () => {
  const presetBlock = upstreamConfig.match(/ANDROID_UPSTREAM_MODE_OPTIONS[\s\S]*?\];/)?.[0] ?? "";
  assert.match(presetBlock, /id: "fhl-images"[\s\S]*FHL Images 10 槽/);
  assert.match(presetBlock, /每槽并发 4/);
  assert.match(presetBlock, /id: "fhl-responses"[\s\S]*FHL Responses 文本/);
  assert.match(presetBlock, /独立于 Images 槽/);
  assert.match(presetBlock, /title: "一键配置 APIMart 异步"/);
  assert.match(presetBlock, /id: "apimart"/);
  assert.match(presetBlock, /title: "一键配置 RH"/);
  assert.match(presetBlock, /banana2 \+ image_g2/);
  const apiModeBlock = upstreamConfig.match(/ANDROID_API_MODE_OPTIONS[\s\S]*?\];/)?.[0] ?? "";
  assert.match(apiModeBlock, /id: "responses"/);
  assert.match(apiModeBlock, /id: "images"/);
  assert.match(apiModeBlock, /id: "apimart"/);
  assert.match(apiModeBlock, /id: "runninghub"/);

  assert.match(upstreamConfig, /ensureFHLResponsesProfile/);
  assert.match(upstreamConfig, /probeCurrentUpstream/);
  assert.match(upstreamConfig, /chooseAndroidTextModel/);
  assert.match(profiles, /export function chooseAndroidTextModel/);
  assert.match(upstreamConfig, /result\.models \?\? \[\]/);
  assert.match(upstreamProfileForm, /获取模型/);
  assert.match(upstreamProfileForm, /自定义模型 ID/);
  assert.match(upstreamModal, /onFetchTextModels=\{upstream\.handleFetchTextModels\}/);
  assert.match(upstreamConfig, /async function handleNew\(apiMode: APIMode = "images"\)/);
  assert.match(upstreamConfig, /requestPolicy: "openai"/);
  assert.match(upstreamConfig, /async function handleUseExistingFHLAPI\(apiMode: "responses" \| "images" = "images"\)/);
  assert.match(upstreamConfig, /apiMode === "images"[\s\S]*ensureFHLImagesProfile\(useStudioStore\.getState\(\)\)/);
  assert.match(upstreamConfig, /ensureFHLResponsesProfile\(useStudioStore\.getState\(\), \{ setActive: false \}\)/);
  assert.match(upstreamModal, /<AndroidFHLImagesPoolConfig/);
  assert.match(upstreamModal, /onConfigureFHLImages=\{\(\) => setFHLPoolOpen\(true\)\}/);
  assert.match(upstreamModal, /handleUseExistingFHLAPI\("responses"\)/);
  assert.doesNotMatch(upstreamModal, /FHLAPIChoiceModal|handleUseExistingFHLAPI\("images"\)/);
  assert.match(fhlPoolConfig, /FHL_IMAGES_POOL_SLOT_COUNT/);
  assert.match(fhlPoolConfig, /mapFHLImagesProfilesToPoolSlots/);
  assert.match(fhlPoolConfig, /setActive: false/);
  assert.match(fhlPoolConfig, /testProfileConnection/);
  assert.match(fhlPoolConfig, /ReadClipboardText/);
  assert.ok(fhlBulkPasteDialog.includes("parseBulkAPIKeyLines(incomingText, FHL_IMAGES_POOL_SLOT_COUNT)"));
  assert.ok(fhlPoolConfig.includes("批量配置 10 个 API"));
  assert.ok(fhlPoolConfig.includes("待保存 {pendingCount}"));
  assert.ok(fhlPoolConfig.includes("setSlotDrafts(nextDrafts)"));
  assert.ok(fhlPoolConfig.includes("setSlotResults({})"));
  assert.ok(fhlPoolConfig.includes("setExpandedIndex(-1)"));
  assert.ok(fhlPoolConfig.includes("saveSlots({ autoTest: false, targetIndexes: [index] })"));
  assert.ok(fhlPoolConfig.includes("onClick={() => void saveSlots()}"));
  assert.ok(fhlPoolConfig.includes("fhlPoolSaveConfirmation(savePlan)"));
  assert.ok(fhlPoolSavePlan.includes("同一 API 只保留新槽位"));
  assert.ok(fhlPoolConfig.includes("无法确认已有凭据，已停止保存"));
  const bulkConfirmBlock = fhlPoolConfig.slice(
    fhlPoolConfig.indexOf("function confirmBulkPaste"),
    fhlPoolConfig.indexOf("async function activateFirstSuccessfulProfile"),
  );
  for (const forbiddenCall of ["createProfile(", "updateProfile(", "testProfileConnection(", "saveSlots("]) {
    assert.ok(!bulkConfirmBlock.includes(forbiddenCall), "bulk prefill must not call " + forbiddenCall);
  }
  assert.match(fhlBulkPasteDialog, /ReadClipboardText\(\)/);
  assert.match(fhlBulkPasteDialog, /disabled=\{!parsed \|\| parsed\.inputTooLarge \|\| parsed\.keyCount === 0\}/);
  assert.match(fhlBulkPasteDialog, /MASKED_API_KEY_PREVIEW/);
  const saveSlotsBlock = fhlPoolConfig.slice(
    fhlPoolConfig.indexOf("async function saveSlots("),
    fhlPoolConfig.indexOf("async function testSlot("),
  );
  const overwriteConfirmIndex = saveSlotsBlock.indexOf("fhlPoolSaveConfirmation(savePlan)");
  const savingStateIndex = saveSlotsBlock.indexOf("setIsSaving(true)", overwriteConfirmIndex);
  const writeLoopIndex = saveSlotsBlock.indexOf("executeFHLPoolSavePlan(validatedKeys, savePlan");
  assert.ok(overwriteConfirmIndex >= 0 && overwriteConfirmIndex < savingStateIndex);
  assert.ok(savingStateIndex >= 0 && savingStateIndex < writeLoopIndex);
  assert.ok(saveSlotsBlock.includes("return false;"), "cancelled overwrite must stop before persistence");
  assert.match(saveSlotsBlock, /const normalizedTargets = normalizeFHLPoolTargetKeys\(rawValidatedKeys\)/);
  assert.match(saveSlotsBlock, /const savedIndexes = new Set\(\[[\s\S]*validatedKeys\.keys\(\)[\s\S]*draftMerges\.map/);
  assert.ok(saveSlotsBlock.includes("savedIndexes.has(index) ? { apiKey: \"\", isBulkStaged: false } : draft"));
  assert.match(fhlPoolConfig, /GetStoredAPIKey\(keyringUserFor\(profile\.id\)\)/);
  assert.match(fhlPoolConfig, /!profileHasCredential && !draft\.apiKey\.trim\(\)/);
  assert.match(upstreamModal, /handleUseExistingRunningHubAPI/);
  assert.match(upstreamHeader, /onConfigureRunningHub/);
  assert.doesNotMatch(upstreamModal, /onCreateImages/);
  assert.doesNotMatch(upstreamHeader, /onCreateImages/);
  assert.doesNotMatch(fhlAPI, /export async function ensureFHLResponsesProfile[\s\S]*return ensureFHLImagesProfile\(store\);/);
  assert.match(fhlAPI, /const fhlProfile = store\.profiles\.find\(isOfficialFHLTextProfile\)/);
  assert.match(fhlAPI, /export async function ensureFHLImagesProfile[\s\S]*store\.profiles\.find\(isOfficialFHLPoolProfile\)/);
  assert.match(fhlAPI, /export async function ensureFHLResponsesProfile[\s\S]*apiMode: "responses"/);
  assert.match(fhlAPI, /textModelID: fhlProfile\.textModelID\.trim\(\) \|\| FHL_TEXT_MODEL_ID/);
  assert.match(fhlAPI, /export async function ensureFHLResponsesProfile[\s\S]*imagesNewAPICompat: false/);
  assert.match(fhlAPI, /export async function ensureFHLImagesProfile/);
  assert.match(fhlAPI, /baseURL: FHL_BASE_URL/);
  assert.match(fhlAPI, /imageModelID: FHL_IMAGE_MODEL_ID/);

  assert.match(profiles, /export const DEFAULT_CONCURRENCY_LIMIT = 1;/);
  assert.match(profiles, /export function makeFHLResponsesProfile[\s\S]*apiMode: "responses"/);
  assert.match(profiles, /export function makeFHLResponsesProfile[\s\S]*imagesNewAPICompat: false/);
  assert.match(store, /s\.profiles\s*\.filter\(isOfficialFHLTextProfile\)/);
  assert.match(store, /const nextFHLAPIMode: APIMode = profile\.apiMode;/);
  assert.match(store, /apiMode: nextFHLAPIMode/);
  assert.match(store, /imagesNewAPICompat: nextFHLAPIMode === "images"/);
});

test("Android RunningHub one-click opens choice and quick config before creating profiles", () => {
  assert.match(upstreamModal, /import \{ RunningHubAPIChoiceModal \} from "\.\.\/\.\.\/\.\.\/components\/panel\/RunningHubAPIChoiceModal";/);
  assert.match(upstreamModal, /import \{ RunningHubQuickConfigModal \} from "\.\.\/\.\.\/\.\.\/components\/panel\/RunningHubQuickConfigModal";/);
  assert.match(upstreamModal, /const \[runningHubChoiceOpen, setRunningHubChoiceOpen\] = useState\(false\);/);
  assert.match(upstreamModal, /const \[runningHubQuickConfigOpen, setRunningHubQuickConfigOpen\] = useState\(false\);/);
  assert.match(upstreamModal, /function handleConfigureRunningHub\(\) \{\s*setRunningHubChoiceOpen\(true\);/);
  assert.match(upstreamModal, /function handleUseExistingRunningHubAPI\(\) \{\s*setRunningHubChoiceOpen\(false\);\s*setRunningHubQuickConfigOpen\(true\);/);
  assert.match(upstreamModal, /onConfigureRunningHub=\{handleConfigureRunningHub\}/);
  assert.match(upstreamModal, /<RunningHubAPIChoiceModal[\s\S]*onUseExistingAPI=\{handleUseExistingRunningHubAPI\}/);
  assert.match(upstreamModal, /<RunningHubQuickConfigModal[\s\S]*onOpenUpstream=\{\(banana2Id\) => \{/);
  assert.doesNotMatch(upstreamConfig, /handleUseExistingRunningHubAPI/);
  assert.doesNotMatch(upstreamConfig, /ensureRunningHubProfiles/);

  assert.match(runningHubChoiceModal, /data-runninghub-api-choice="existing"/);
  assert.match(runningHubChoiceModal, /data-runninghub-api-choice="get"/);
  assert.match(runningHubChoiceModal, /RUNNINGHUB_REGISTER_URL/);
  assert.match(runningHubChoiceModal, /安卓模拟器桥接地址/);

  assert.match(runningHubQuickConfigModal, /saveRunningHubConfig\(baseURL, \{ apiKey \}, controller\.signal\)/);
  assert.match(runningHubQuickConfigModal, /verifyRunningHubBridge\(baseURL, controller\.signal\)/);
  assert.match(runningHubQuickConfigModal, /ensureRunningHubProfiles\(useStudioStore\.getState\(\), baseURL\)/);
  assert.match(runningHubQuickConfigModal, /不会保存到安卓 profile/);
});

test("Android upstream starts with empty defaults and highlights one-click presets", () => {
  assert.match(store, /const runtimePlatform = readRuntimePlatformState\(\);/);
  assert.match(store, /const shouldKeepAndroidProfilesEmpty = runtimePlatform\.isAndroid;/);
  assert.match(store, /get\(\)\.profiles\.length === 1[\s\S]*get\(\)\.profiles\[0\]\?\.id === FHL_PROFILE_ID/);
  assert.match(store, /const activeKey = await GetStoredAPIKey\(keyringUserFor\(expectedProfileId\)\);/);
  assert.match(store, /profiles\.length === 0 && !shouldKeepAndroidProfilesEmpty/);
  assert.doesNotMatch(store, /if \(profiles\.length === 0\) \{\s*const profile = makeFHLResponsesProfile\(\);/);
  assert.match(upstreamHeader, /option\.id === "fhl-images" \? "android-upstream-onekey-button" : ""/);
  assert.match(upstreamCss, /\.android-upstream-create-grid \.android-upstream-onekey-button/);
  assert.match(upstreamCss, /animation: android-upstream-onekey-flash 1\.15s ease-in-out infinite;/);
  assert.match(upstreamCss, /@keyframes android-upstream-onekey-flash/);
});

test("Android FHL bulk paste stays responsive and marks unsaved slots without exposing keys", () => {
  assert.ok(upstreamCss.includes(".android-fhl-pool-summary-actions"));
  assert.ok(upstreamCss.includes(".android-fhl-slot-status.pending"));
  const compactLayout = upstreamCss.slice(upstreamCss.indexOf("@media (max-width: 380px)"));
  assert.ok(compactLayout.includes(".android-fhl-pool-summary-actions"));
  assert.ok(compactLayout.includes("grid-template-columns: 1fr 1fr"));
  for (const forbiddenDisplay of ["parsed.keys.join", "text.slice", "displayKeyHint(parsed"]) {
    assert.ok(!fhlPoolConfig.includes(forbiddenDisplay));
  }
});

test("Android FHL unified model panel is fixed and auto-validates the enabled pool", () => {
  assert.doesNotMatch(fhlPoolConfig, /统一获取并配置生图模型/);
  const summaryBlock = fhlPoolConfig.slice(
    fhlPoolConfig.indexOf("android-fhl-pool-summary"),
    fhlPoolConfig.indexOf("android-fhl-pool-model-config"),
  );
  assert.doesNotMatch(summaryBlock, /android-fhl-unified-model-fetch/);

  const panelBlock = fhlPoolConfig.slice(
    fhlPoolConfig.indexOf('data-testid="android-fhl-unified-model-panel"'),
    fhlPoolConfig.indexOf("android-fhl-slot-list"),
  );
  assert.match(panelBlock, /data-model-state=\{modelPanelState\}/);
  assert.match(panelBlock, /data-testid="android-fhl-unified-model-fetch"/);
  assert.match(panelBlock, /aria-label="刷新模型列表"/);
  assert.match(panelBlock, /title="刷新模型列表"/);
  assert.match(panelBlock, /data-testid="android-fhl-unified-model-apply"/);
  assert.match(panelBlock, /保存统一模型/);
  assert.match(panelBlock, /验证完成后选择共同模型/);
  assert.match(panelBlock, /modelPanelState !== "ready"/);
  assert.match(fhlPoolConfig, /prepareFHLPoolImageModelConfig/);
  assert.match(fhlPoolConfig, /\{ persist: false \}/);
  assert.match(fhlPoolConfig, /commitValidatedFHLPoolImageModelSelection/);
  assert.match(fhlPoolConfig, /catalog: modelSnapshot\.catalog/);
  assert.match(fhlPoolConfig, /currentCredentialMutationRevision\(\)/);
  assert.match(fhlPoolConfig, /buildFHLPoolModelValidationSignature/);
  assert.match(fhlPoolConfig, /credentialScanStatus/);
  assert.match(fhlPoolConfig, /credentialScanEpoch/);
  assert.match(fhlPoolConfig, /type CredentialScanStatus = [^;]*"error"/);
  assert.match(fhlPoolConfig, /setCredentialScanStatus\("error"\)/);
  assert.match(fhlPoolConfig, /无法读取已保存凭据，请刷新后重试/);
  assert.doesNotMatch(fhlPoolConfig, /GetStoredAPIKey\([\s\S]{0,120}\.catch\(\(\) => ""\)/);
  assert.match(fhlPoolConfig, /autoValidationSignature/);
  assert.match(fhlPoolConfig, /force: true/);
  assert.match(panelBlock, /onClick=\{refreshUnifiedImageModels\}/);
  assert.match(fhlPoolConfig, /只更新已配置且启用的槽位；空槽和停用槽不会参与目录请求/);

  assert.match(upstreamCss, /\.android-fhl-pool-model-config[\s\S]*height: 190px/);
  assert.match(upstreamCss, /\.android-fhl-pool-model-config[\s\S]*overflow: hidden/);
  assert.match(upstreamCss, /\.android-fhl-pool-model-status[\s\S]*overflow-y: auto/);
  assert.match(upstreamCss, /@media \(max-width: 380px\)[\s\S]*\.android-fhl-pool-model-config[\s\S]*height: 236px/);
  assert.match(upstreamCss, /\.android-fhl-pool-model-actions/);
  assert.match(upstreamCss, /\.android-fhl-pool-model-refresh/);
  const compactLayout = upstreamCss.slice(upstreamCss.lastIndexOf("@media (max-width: 380px)"));
  assert.doesNotMatch(compactLayout, /\.android-fhl-unified-model-fetch/);

  assert.match(upstreamProfileForm, /data-testid="android-image-model-unified-hint"/);
  assert.match(upstreamProfileForm, /FHL1-FHL10 的活动生图槽位由统一配置入口管理/);
  assert.match(upstreamProfileForm, /统一模型面板会自动验证活动槽位/);
  assert.match(upstreamProfileForm, /当前槽位等待统一模型面板验证/);
  assert.doesNotMatch(upstreamProfileForm, /统一获取并配置生图模型/);
  assert.doesNotMatch(upstreamProfileForm, /data-testid="android-image-model-(?:fetch|select)"/);
  assert.doesNotMatch(upstreamModal, /onFetchImageModels=|onSelectImageModel=/);
  assert.doesNotMatch(upstreamConfig, /function handleFetchImageModels|function handleSelectImageModel/);
});

test("Android API credential fields support native paste while keeping changes in draft state", () => {
  assert.match(upstreamCss, /\.android-upstream-secret input,[\s\S]*\.android-fhl-slot-secret input,[\s\S]*\.android-fhl-bulk-secret-input[\s\S]*-webkit-user-select: text;[\s\S]*user-select: text;/);

  const profilePasteHandler = upstreamProfileForm.slice(
    upstreamProfileForm.indexOf("onPaste={(event)"),
    upstreamProfileForm.indexOf('placeholder={savedKeyLoaded ? "sk-..."', upstreamProfileForm.indexOf("onPaste={(event)")),
  );
  assert.match(profilePasteHandler, /event\.preventDefault\(\)/);
  assert.match(profilePasteHandler, /event\.clipboardData\.getData\("text"\)/);
  assert.match(profilePasteHandler, /onPasteKey\(incomingText\)/);

  const profilePasteFunction = upstreamConfig.slice(
    upstreamConfig.indexOf("async function handlePasteKey"),
    upstreamConfig.indexOf("\n  return {", upstreamConfig.indexOf("async function handlePasteKey")),
  );
  assert.match(profilePasteFunction, /pastedText === undefined \? await ReadClipboardText\(\) : pastedText/);
  assert.match(profilePasteFunction, /handleChangeDraftKey\(text\.trim\(\)\)/);
  assert.match(profilePasteFunction, /finally \{\s*text = "";/);
  assert.doesNotMatch(profilePasteFunction, /updateProfile\(|SetStoredAPIKey|testProfileConnection\(/);

  const slotPasteStage = fhlPoolConfig.slice(
    fhlPoolConfig.indexOf("function stageSlotClipboardText"),
    fhlPoolConfig.indexOf("async function pasteSlot"),
  );
  assert.match(slotPasteStage, /parseBulkAPIKeyLines\(text, FHL_IMAGES_POOL_SLOT_COUNT\)/);
  assert.match(slotPasteStage, /openBulkPasteDialog\(\)/);
  assert.match(slotPasteStage, /patchSlot\(index, parsed\.keys\[0\]\)/);
  assert.doesNotMatch(slotPasteStage, /createProfile\(|updateProfile\(|saveSlots\(|testProfileConnection\(/);

  const slotInput = fhlPoolConfig.slice(
    fhlPoolConfig.indexOf('id={`android-fhl-key-${slotNumber}`}'),
    fhlPoolConfig.indexOf("</div>", fhlPoolConfig.indexOf('id={`android-fhl-key-${slotNumber}`}')),
  );
  assert.match(slotInput, /onPaste=\{\(event\) => \{/);
  assert.match(slotInput, /event\.clipboardData\.getData\("text"\)/);
  assert.match(slotInput, /stageSlotClipboardText\(index, incomingText\)/);
});

test("Android upstream keeps Responses labels and compat policy wording", () => {
  assert.match(upstreamHeader, /profile\.apiMode === "responses" \? "Responses API" : "Images API"/);
  assert.match(upstreamRail, /profile\.apiMode === "responses" \? "Responses" : "Images"/);
  assert.doesNotMatch(upstreamHeader, /FHL \/ Responses API/);
  assert.doesNotMatch(upstreamRail, /FHL \/ Responses/);
  assert.match(upstreamConfig, /id: "compat", title: "兼容中转扩展"/);
  assert.doesNotMatch(upstreamConfig, /id: "compat", title: "兼容中转",/);
});

test("Android FHL transport switch is explicit and keeps both protocols on the shared pool capacity", () => {
  assert.match(header, /AndroidFHLTransportModeSwitch/);
  assert.match(header, /mode=\{fhlTransportMode\}/);
  assert.match(header, /onChange=\{handleFHLTransportModeChange\}/);
  assert.match(transportSwitch, /mode: "images", label: "Images API"/);
  assert.match(transportSwitch, /mode: "responses", label: "Responses API"/);
  assert.match(transportSwitch, /aria-pressed=\{selected\}/);
  assert.match(transportSwitch, /data-audit-id=\{`fhl-transport-\$\{option\.mode\}`\}/);
  assert.match(layoutCss, /@media \(max-width: 380px\)[\s\S]*\.android-fhl-transport-switch[\s\S]*width: 100%/);
  for (const source of [phoneCompose, padCompose]) {
    assert.match(source, /isOfficialFHLPoolProfile\(activeProfile\)/);
    assert.doesNotMatch(source, /const fhlImagesPoolActive = apiMode === "images"/);
  }
  assert.match(upstreamProfileForm, /const officialFHLProfile = isOfficialFHLProfile\(draft\);/);
  assert.match(upstreamProfileForm, /由顶部 API 形态统一控制；只影响 FHL 新生图任务/);
});
