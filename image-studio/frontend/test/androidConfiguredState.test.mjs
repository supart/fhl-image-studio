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

test("Android header configured state accepts API key or RunningHub bridge", () => {
  assert.match(header, /activeProfileUsesBridgeKey = activeProfile\?\.apiMode === "runninghub"/);
  assert.match(header, /isRunningHubBaseURL\(activeProfile\.baseURL\)/);
  assert.match(header, /const hasConfiguredAPIKey = apiKey\.trim\(\)\.length > 0 \|\| activeProfileUsesBridgeKey;/);
  assert.match(header, /activeProfile\?\.apiMode === "runninghub"[\s\S]*\? "RH"/);
});

test("Android compose setup gate accepts API key or RunningHub bridge", () => {
  for (const source of [phoneCompose, padCompose]) {
    assert.match(source, /const hasAPIKey = apiKey\.trim\(\)\.length > 0;/);
    assert.match(source, /const hasBaseURL = baseURL\.trim\(\)\.length > 0;/);
    assert.match(source, /const runningHubBridgeConfigured = apiMode === "runninghub" && hasBaseURL;/);
    assert.match(source, /const hasUsableUpstream = hasAPIKey \|\| runningHubBridgeConfigured;/);
    assert.match(source, /const needsUpstreamSetup = !hasUsableUpstream;/);
    assert.match(source, /const needsBaseURLSetup = hasUsableUpstream && !hasBaseURL;/);
    assert.match(source, /disabled=\{!hasUsableUpstream \|\| !hasBaseURL \|\| !effectivePromptReady\}/);
    assert.doesNotMatch(source, /const needsUpstreamSetup = !apiKey\.trim\(\) \|\| !baseURL\.trim\(\);/);
  }
});

test("Android settings shows configured by API key or RunningHub bridge", () => {
  assert.match(settingsPanel, /const runningHubBridgeConfigured = apiMode === "runninghub" && !!baseURL\.trim\(\);/);
  assert.match(settingsPanel, /const upstreamReady = !!apiKey\.trim\(\) \|\| runningHubBridgeConfigured;/);
  assert.match(settingsPanel, /const canTestUpstream = upstreamReady && !!baseURL\.trim\(\);/);
  assert.match(settingsPanel, /canTestUpstream=\{canTestUpstream\}/);
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
  assert.match(brandAboutSheet, /const ANDROID_BRAND_VERSION = "V2\.0\.3";/);
  assert.match(brandAboutSheet, /方汤圆版 GitHub/);
  assert.match(brandAboutSheet, /原作者 GitHub/);
  assert.match(brandAboutSheet, /基于 RoseKhlifa\/Image-Studio 的独立修改发行版/);
});

test("generation submit freezes pool assignment while preserving the selected non-pool profile", () => {
  assert.match(store, /const selectedActiveProfile = s\.profiles\.find\(\(p\) => p\.id === s\.activeProfileId\);/);
  assert.match(store, /const useAndroidFHLPool = shouldUseAndroidFHLImagesPool\(\s*readRuntimePlatformState\(\)\.isAndroid,\s*s\.continuousGenerateTest === true,\s*selectedActiveProfile,\s*\);/);
  assert.match(store, /let poolAssignment = null;[\s\S]*if \(useAndroidFHLPool\)[\s\S]*poolAssignment = await resolveAndroidFHLPoolAssignment\(s\.profiles\)/);
  assert.match(store, /API 凭据安全迁移失败，请重新配置该 API/);
  assert.match(store, /const apiKey = await GetStoredAPIKey\(keyringUserFor\(profile\.id\)\);/);
  assert.match(store, /const activeProfile = poolAssignment\?\.profile \?\? selectedActiveProfile;/);
  assert.match(store, /const submitAPIMode = activeProfile\?\.apiMode \?\? s\.apiMode;/);
  assert.match(store, /const submitBaseURL = activeProfile\?\.baseURL \?\? s\.baseURL;/);
  assert.match(store, /const submitRequestPolicy = activeProfile\?\.requestPolicy \?\? s\.requestPolicy;/);
  assert.match(store, /const runningHubBridgeSubmit = submitAPIMode === "runninghub" \|\| isRunningHubBaseURL\(submitBaseURL\);/);
  assert.match(store, /if \(!runningHubBridgeSubmit && !submittedAPIKey\.trim\(\)\)/);
  assert.match(store, /if \(!runningHubBridgeSubmit\) \{\s*try \{/);
  assert.match(store, /const preliminaryAPIMode = effectiveAPIModeForSubmit\(s, activeProfile, submitAPIMode\);/);
  assert.match(store, /effectiveProviderMode\(profile, fallbackMode, state\.fhlTransportMode, state\.baseURL\)/);
  assert.match(store, /const effectiveAPIMode = preliminaryAPIMode;/);
  assert.match(store, /baseURL: cleanedBaseURL/);
  assert.match(store, /apiMode: effectiveAPIMode/);
  assert.match(store, /const fhlImagesPoolSlot = normalizeFHLImagesPoolSlot\(/);
  assert.match(store, /poolAssignment\?\.slot \?\? activeProfile\?\.fhlImagesPoolSlot/);
  assert.match(store, /fhlImagesPoolSlot,/);
  assert.match(store, /const resolvedSize = normalizeSizeSelection\(s\.size,/);
  assert.doesNotMatch(store, /normalizeFHLImagesBillingSize/);
});

test("Android startup migrates every stored profile credential and surfaces failures", () => {
  assert.match(store, /if \(runtimePlatform\.isAndroid\) \{\s*for \(const profile of profiles\) \{/);
  assert.match(store, /androidProfileKeys\.set\(profile\.id, await GetStoredAPIKey\(keyringUserFor\(profile\.id\)\)\)/);
  assert.match(store, /androidCredentialMigrationError = error\?\.message \?\? "API 凭据安全迁移失败，请重新配置该 API"/);
  assert.match(store, /errorMessage: androidCredentialMigrationError \|\|/);
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
  assert.match(fhlAPI, /export async function ensureFHLImagesProfile[\s\S]*isOfficialFHLPoolProfile\(profile\)/);
  assert.match(fhlAPI, /export async function ensureFHLResponsesProfile[\s\S]*apiMode: "responses"/);
  assert.match(fhlAPI, /export async function ensureFHLResponsesProfile[\s\S]*imagesNewAPICompat: false/);
  assert.match(fhlAPI, /export async function ensureFHLImagesProfile/);
  assert.match(fhlAPI, /baseURL: FHL_BASE_URL/);
  assert.match(fhlAPI, /imageModelID: FHL_IMAGE_MODEL_ID/);

  assert.match(profiles, /export const DEFAULT_CONCURRENCY_LIMIT = 1;/);
  assert.match(profiles, /export function makeFHLResponsesProfile[\s\S]*apiMode: "responses"/);
  assert.match(profiles, /export function makeFHLResponsesProfile[\s\S]*imagesNewAPICompat: false/);
  assert.match(store, /s\.profiles\s*\.filter\(isOfficialFHLTextProfile\)/);
  assert.match(store, /const nextFHLAPIMode: APIMode = localFHLConfig\?\.apiMode \?\? profile\.apiMode;/);
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
  assert.match(store, /const shouldKeepAndroidProfilesEmpty = runtimePlatform\.isAndroid && !localFHLConfig;/);
  assert.match(store, /profiles\.length === 1 && profiles\[0\]\?\.id === FHL_PROFILE_ID/);
  assert.match(store, /const storedDefaultKey = await GetStoredAPIKey\(keyringUserFor\(profiles\[0\]\.id\)\)\.catch\(\(\) => ""\);/);
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
