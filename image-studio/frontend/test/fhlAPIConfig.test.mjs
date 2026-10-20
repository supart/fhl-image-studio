import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("desktop FHL setup uses ten independent Images slots while Android retains the legacy flow", () => {
  const fhlAPI = source("../src/lib/fhlAPI.ts");
  const profiles = source("../src/lib/profiles.ts");
  const choiceModal = source("../src/components/panel/FHLAPIChoiceModal.tsx");
  const quickModal = source("../src/components/panel/FHLQuickConfigModal.tsx");
  const poolConfig = source("../src/components/panel/FHLImagesPoolConfig.tsx");
  const textAPI = source("../src/lib/fhlTextAPI.ts");
  const textModel = source("../src/lib/fhlTextAPIModel.ts");
  const textConfig = source("../src/components/panel/FHLTextAPIConfig.tsx");
  const desktopConfig = source("../src/components/panel/FHLDesktopAPIConfig.tsx");
  const historyRail = source("../src/components/history/HistoryRail.tsx");
  const windowsHistoryRail = source("../src/components/history/WindowsHistoryRail.tsx");
  const upstreamConfig = source("../src/components/panel/UpstreamConfigModal.tsx");
  const desktopHeader = source("../src/components/layout/AppHeaderBrand.tsx");
  const androidHeader = source("../src/components/layout/AppHeader.tsx");
  const settingsPanel = source("../src/components/panel/SettingsPanel.tsx");
  const store = source("../src/state/studioStore.ts");

  assert.match(profiles, /FHL_IMAGES_POOL_SLOT_COUNT = 10/);
  assert.match(profiles, /FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT = 5/);
  assert.match(profiles, /export function mapFHLImagesProfilesToPoolSlots/);
  assert.match(profiles, /export function normalizeFHLImagesPoolKeyHint/);
  assert.match(profiles, /export function hasFHLImagesPoolSlotCapacity/);
  assert.match(profiles, /export function hasUsableFHLConfiguration/);
  assert.match(fhlAPI, /export async function configureFHLProfilesWithSharedAPIKey/);
  assert.match(fhlAPI, /export async function verifyFHLImageCapability/);

  assert.match(quickModal, /if \(!isAndroid\) return <DesktopFHLQuickConfigModal/);
  assert.match(quickModal, /function DesktopFHLQuickConfigModal/);
  assert.match(quickModal, /const \[bulkPasteOpen, setBulkPasteOpen\] = useState\(false\)/);
  assert.match(quickModal, /useEffect\(\(\) => \{[\s\S]{0,120}if \(!open\) setBulkPasteOpen\(false\)/);
  assert.match(quickModal, /function handleClose\(\)[\s\S]{0,120}setBulkPasteOpen\(false\)[\s\S]{0,80}onClose\(\)/);
  assert.match(quickModal, /function handleOpenUpstream\(\)[\s\S]{0,120}setBulkPasteOpen\(false\)[\s\S]{0,100}onOpenUpstream\(""\)/);
  assert.match(quickModal, /onOpenAdvanced=\{handleOpenUpstream\}/);
  assert.match(quickModal, /bulkPasteOpen=\{bulkPasteOpen\}/);
  assert.match(quickModal, /onBulkPasteOpenChange=\{setBulkPasteOpen\}/);
  assert.match(quickModal, /function LegacyFHLQuickConfigModal/);
  assert.match(quickModal, /<FHLDesktopAPIConfig/);
  assert.match(quickModal, /configureFHLProfilesWithSharedAPIKey/);
  assert.match(quickModal, /verifyFHLImageCapability/);

  assert.match(desktopHeader, /const hasFHLConfiguration = hasUsableFHLConfiguration\(\{/);
  assert.match(desktopHeader, /apiKey,\s*apiMode,\s*baseURL,\s*profiles,/);
  assert.match(desktopHeader, /const shouldPulseConfigButton = !hasFHLConfiguration/);
  assert.match(desktopHeader, /shouldPulseConfigButton \? "needs-config" : "is-configured"/);
  assert.match(desktopHeader, /if \(hasFHLConfiguration\) \{\s*useStudioStore\.getState\(\)\.openUpstreamConfig\("app"\);/);
  assert.match(desktopHeader, /修改统一 FHL 配置/);
  assert.doesNotMatch(desktopHeader, /const fhlProfiles =/);
  assert.doesNotMatch(desktopHeader, /activeFHLProfileId/);
  assert.doesNotMatch(desktopHeader, /switchingProfileId/);
  assert.doesNotMatch(desktopHeader, /handleProfileSelect/);
  assert.doesNotMatch(desktopHeader, /<select/);
  assert.doesNotMatch(desktopHeader, /setActiveProfile/);
  assert.doesNotMatch(desktopHeader, /const setMultiAPIMode = \(enabled: boolean\)/);
  assert.doesNotMatch(desktopHeader, /setField\("continuousGenerateTest", enabled\)/);
  assert.doesNotMatch(desktopHeader, /aria-label="生成 API 模式"/);

  assert.match(choiceModal, /mode\?: "desktopPool" \| "legacy"/);
  assert.match(choiceModal, /const useDesktopPool/);
  assert.match(choiceModal, /最多 10 个 FHL Images API/);

  assert.match(poolConfig, /FHL_IMAGES_POOL_SLOT_COUNT/);
  assert.match(poolConfig, /FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT/);
  assert.match(poolConfig, /mapFHLImagesProfilesToPoolSlots/);
  assert.match(poolConfig, /type="password"/);
  assert.match(poolConfig, /continuousPoolEnabled/);
  assert.match(poolConfig, /concurrencyLimit/);
  assert.match(poolConfig, /fhlImagesPoolSlot/);
  assert.match(poolConfig, /fhlImagesPoolKeyHint/);
  assert.match(poolConfig, /setActive: false/);
  assert.match(poolConfig, /FHL-\$\{slot\} Images/);
  assert.match(poolConfig, /fhlTransportMode,/);
  assert.match(poolConfig, /const transportLabel = fhlTransportMode === "responses" \? "FHL Responses" : "FHL Images"/);
  assert.match(poolConfig, /槽位配置不会随接口切换而改变/);
  assert.match(poolConfig, /已填写 \{savedPoolSlotCount\}/);
  assert.match(poolConfig, /批量配置 10 个 API/);
  assert.match(poolConfig, /批量预填已就绪；输入新值才替换/);
  assert.match(poolConfig, /profileHasCredential[\s\S]{0,600}已保存密钥/);
  assert.doesNotMatch(poolConfig, /function displayKeyHint/);
  assert.doesNotMatch(poolConfig, /sk-\.\.\.\$\{value\}/);
  assert.match(poolConfig, /if \(profile\)[\s\S]{0,1800}await updateProfile\(profile\.id/);
  assert.doesNotMatch(poolConfig, /hasUpstreamProfileCapacity/);
  assert.doesNotMatch(poolConfig, /precedingEmptySlotCount/);
  assert.match(poolConfig, /GetStoredAPIKey/);
  assert.match(poolConfig, /readFHLPoolStoredCredentials/);
  assert.match(poolConfig, /executeFHLPoolSavePlan/);
  assert.match(poolConfig, /profileHasActiveTasks/);
  assert.doesNotMatch(poolConfig, /apiMode:\s*"responses"/);
  assert.doesNotMatch(poolConfig, /verifyFHLImageCapability/);
  assert.match(poolConfig, /testProfileConnection/);
  assert.match(poolConfig, /slotConnectionResults/);
  assert.match(poolConfig, /autoTestSavedPoolSlots/);
  assert.match(poolConfig, /successfulProfileIds/);
  assert.match(poolConfig, /activateSuccessfulProfileIfNeeded/);
  assert.match(poolConfig, /await setActiveProfile\(target\.id\)/);
  assert.match(poolConfig, /hasReadyActiveProfile/);
  assert.match(poolConfig, /连接测试成功，但设为当前 API 失败/);
  assert.match(poolConfig, /async function handleSave\(\{/);
  assert.match(poolConfig, /targetIndexes\?: readonly number\[\]/);
  assert.match(poolConfig, /handleSave\(\{ autoTest: false, targetIndexes: \[index\] \}\)/);
  assert.match(poolConfig, /配置成功/);
  assert.match(poolConfig, /保存并测试 Images 池/);
  assert.match(poolConfig, /最大并发/);
  assert.match(poolConfig, /单个 FHL Images API 最大并发为 5/);
  assert.doesNotMatch(poolConfig, /共享并发设置控制全池总上限/);
  assert.match(poolConfig, /handleTest\(index: number\)/);
  assert.match(poolConfig, /当前普通生成 API/);
  assert.match(poolConfig, /!profileHasCredential && !draftHasCredential/);
  assert.match(poolConfig, /保存并测试 API/);

  for (const rail of [historyRail, windowsHistoryRail]) {
    assert.match(rail, /const hasActiveProfile = profiles\.some/);
    assert.match(rail, /value=\{hasActiveProfile \? activeProfileId : ""\}/);
    assert.match(rail, /请选择当前 API/);
  }

  const targetedTest = store.match(/testProfileConnection: async \(profileId\) => \{[\s\S]+?\n  \},\n\n  testAPIKey:/)?.[0] ?? "";
  assert.match(targetedTest, /apiKeyForProfileOrState\(s, profile\.id\)/);
  assert.match(targetedTest, /probeCurrentUpstream\(cleanedBaseURL, cleanedAPIKey/);
  assert.doesNotMatch(targetedTest, /setActiveProfile/);
  assert.doesNotMatch(targetedTest, /syncCLIConfigQuietly/);

  assert.match(upstreamConfig, /const \[configView, setConfigView\] = useState<"pool" \| "advanced">\("pool"\)/);
  assert.match(upstreamConfig, /if \(configView === "pool"\)/);
  assert.match(upstreamConfig, /<FHLImagesPoolConfig/);
  assert.match(upstreamConfig, /isAndroid \? \(/);
  assert.match(upstreamConfig, /<FHLDesktopAPIConfig/);
  assert.match(upstreamConfig, /onOpenAdvanced=\{\(\) => setConfigView\("advanced"\)\}/);
  assert.match(upstreamConfig, /const \[fhlBulkPasteOpen, setFHLBulkPasteOpen\] = useState\(false\)/);
  assert.match(upstreamConfig, /function handleCloseTopLayer\(\)/);
  assert.match(upstreamConfig, /bulkPasteOpen=\{fhlBulkPasteOpen\}/);
  assert.doesNotMatch(upstreamConfig, /FHLQuickConfigModal/);

  assert.match(textAPI, /FHL_TEXT_API_CREDENTIAL_ID = "fhl-text-assistant"/);
  assert.match(textAPI, /FHL_TEXT_API_KEYRING_USER = keyringUserFor\(FHL_TEXT_API_CREDENTIAL_ID\)/);
  assert.match(textAPI, /OptimizePrompt\(\{/);
  assert.match(textAPI, /textModelID: modelID/);
  assert.match(textModel, /FHL_TEXT_API_DEFAULT_MODEL_ID = "gpt-5\.6-sol"/);
  assert.match(textModel, /FHL_TEXT_API_LEGACY_MODEL_ID = "gpt-5\.5"/);
  assert.match(textModel, /gptcodex\.fhlTextAPI\.modelID\.v1/);
  assert.match(textModel, /不能超过 128 个字符/);
  assert.match(textModel, /不能包含控制字符/);
  assert.doesNotMatch(textAPI, /createProfile|updateProfile|localStorage/);

  assert.ok(desktopConfig.indexOf("<FHLTextAPIConfig") < desktopConfig.indexOf("<FHLImagesPoolConfig"));
  assert.match(textConfig, /data-audit-id="fhl-text-api-config"/);
  assert.match(textConfig, /type="password"/);
  assert.match(textConfig, /FHL Responses/);
  assert.match(textConfig, /fhl-text-model-select/);
  assert.match(textConfig, /fhl-text-custom-model-input/);
  assert.match(textConfig, /setFHLTextAPIModelID/);
  assert.match(textConfig, /保存并测试文本 API/);
  assert.match(textConfig, /已保存，测试失败/);
  assert.doesNotMatch(textConfig, /GetStoredAPIKey|SetStoredAPIKey|localStorage/);

  const saveTextActionStart = store.indexOf("saveAndTestFHLTextAPI: async");
  const deleteTextActionStart = store.indexOf("deleteFHLTextAPIConfig: async");
  const saveTextAction = store.slice(saveTextActionStart, deleteTextActionStart);
  assert.ok(saveTextActionStart >= 0 && deleteTextActionStart > saveTextActionStart);
  assert.ok(saveTextAction.indexOf("await saveFHLTextAPIKey(apiKey)") < saveTextAction.indexOf("await testFHLTextAPIKey(apiKey"));
  assert.match(saveTextAction, /fhlTextAPITestStatus: "error"/);
  assert.match(saveTextAction, /已保存，文本测试失败/);
  assert.doesNotMatch(saveTextAction, /deleteFHLTextAPIKey/);
  const deleteTextAction = store.slice(deleteTextActionStart, store.indexOf("testAPIKey: async", deleteTextActionStart));
  assert.match(deleteTextAction, /await deleteFHLTextAPIKey\(\)/);
  assert.doesNotMatch(deleteTextAction, /deleteProfile|updateProfile|persistProfiles/);

  assert.match(desktopHeader, /FHLQuickConfigModal/);
  assert.match(androidHeader, /FHLQuickConfigModal/);
  assert.match(settingsPanel, /FHLQuickConfigModal/);
});
