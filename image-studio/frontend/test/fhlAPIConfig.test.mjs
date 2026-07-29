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
  assert.match(quickModal, /onOpenAdvanced=\{\(\) => void onOpenUpstream\(""\)\}/);
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
  assert.match(poolConfig, /旧配置未记录尾号；重新输入直接替换，无需删除/);
  assert.match(poolConfig, /function displayKeyHint/);
  assert.match(poolConfig, /sk-\.\.\.\$\{value\}/);
  assert.match(poolConfig, /if \(profile\)[\s\S]{0,1400}await updateProfile\(profile\.id/);
  assert.doesNotMatch(poolConfig, /hasUpstreamProfileCapacity/);
  assert.doesNotMatch(poolConfig, /precedingEmptySlotCount/);
  assert.doesNotMatch(poolConfig, /GetStoredAPIKey/);
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
  assert.match(poolConfig, /handleSave\(\{ autoTest = true \}/);
  assert.match(poolConfig, /handleSave\(\{ autoTest: false \}\)/);
  assert.match(poolConfig, /配置成功/);
  assert.match(poolConfig, /保存并测试 Images 池/);
  assert.match(poolConfig, /最大并发/);
  assert.match(poolConfig, /单个 FHL Images API 最大并发为 5/);
  assert.doesNotMatch(poolConfig, /共享并发设置控制全池总上限/);
  assert.match(poolConfig, /handleTest\(index: number\)/);
  assert.match(poolConfig, /当前普通生成 API/);
  assert.match(poolConfig, /!profile && !slot\.apiKey\.trim\(\)/);
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
  assert.doesNotMatch(upstreamConfig, /FHLQuickConfigModal/);

  assert.match(textAPI, /FHL_TEXT_API_CREDENTIAL_ID = "fhl-text-assistant"/);
  assert.match(textAPI, /FHL_TEXT_API_KEYRING_USER = keyringUserFor\(FHL_TEXT_API_CREDENTIAL_ID\)/);
  assert.match(textAPI, /OptimizePrompt\(\{/);
  assert.match(textAPI, /textModelID: FHL_TEXT_API_MODEL_ID/);
  assert.doesNotMatch(textAPI, /createProfile|updateProfile|localStorage/);

  assert.ok(desktopConfig.indexOf("<FHLTextAPIConfig") < desktopConfig.indexOf("<FHLImagesPoolConfig"));
  assert.match(textConfig, /data-audit-id="fhl-text-api-config"/);
  assert.match(textConfig, /type="password"/);
  assert.match(textConfig, /FHL Responses/);
  assert.match(textConfig, /FHL_TEXT_API_MODEL_ID/);
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
