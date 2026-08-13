import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  LoaderCircle,
  Save,
  Settings2,
  TestTube2,
  Trash2,
} from "lucide-react";
import { validateAPIKeyForHeader } from "../../../lib/apiKey";
import {
  parseBulkAPIKeyLines,
  type BulkAPIKeyParseResult,
} from "../../../lib/bulkAPIKeys";
import {
  FHL_BASE_URL,
  FHL_IMAGE_MODEL_ID,
  FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT,
  FHL_IMAGES_POOL_SLOT_COUNT,
  chooseFHLImagesPoolActivationTarget,
  keyringUserFor,
  mapFHLImagesProfilesToPoolSlots,
} from "../../../lib/profiles";
import { fhlTransportLabel } from "../../../lib/providerPolicy";
import {
  DeleteStoredAPIKey,
  GetStoredAPIKey,
  ReadClipboardText,
} from "../../runtime/host";
import { useStudioStore } from "../../../state/studioStore";
import type { UpstreamProfile } from "../../../types/domain";
import {
  AndroidBulkAPIKeyPasteDialog,
  type AndroidBulkAPIKeyPasteDialogHandle,
} from "./AndroidBulkAPIKeyPasteDialog";
import {
  createFHLPoolSavePlan,
  executeFHLPoolSavePlan,
  fhlPoolSaveConfirmation,
  normalizeFHLPoolTargetKeys,
  readFHLPoolStoredCredentials,
} from "./fhlPoolSavePlan";

type PoolSlotDraft = {
  apiKey: string;
  isBulkStaged: boolean;
};

type SlotConnectionResult = "testing" | "success" | "error";

function createSlotDrafts(): PoolSlotDraft[] {
  return Array.from(
    { length: FHL_IMAGES_POOL_SLOT_COUNT },
    () => ({ apiKey: "", isBulkStaged: false }),
  );
}

function poolProfileName(slot: number): string {
  return `FHL${slot} Images`;
}

function bulkPasteSummary(result: BulkAPIKeyParseResult): string {
  const parts = result.keys.length > 0
    ? [result.keys.length === 1
      ? "已预填 1 个 API 到 FHL1"
      : `已预填 ${result.keys.length} 个 API 到 FHL1-FHL${result.keys.length}`]
    : ["没有识别到有效 API"];
  if (result.emptyLineCount > 0) parts.push(`空行 ${result.emptyLineCount}`);
  if (result.duplicateCount > 0) parts.push(`重复 ${result.duplicateCount}`);
  if (result.invalidLineNumbers.length > 0) {
    const visible = result.invalidLineNumbers.slice(0, 8).join("、");
    const suffix = result.invalidLineNumbers.length > 8
      ? ` 等 ${result.invalidLineNumbers.length} 行`
      : "";
    parts.push(`无效行 ${visible}${suffix}`);
  }
  if (result.overflowCount > 0) parts.push(`超过10个，忽略 ${result.overflowCount}`);
  return `${parts.join("；")}。`;
}

function hasReadyActiveProfile(): boolean {
  const state = useStudioStore.getState();
  const active = state.profiles.find((profile) => profile.id === state.activeProfileId);
  if (!active || !active.baseURL.trim()) return false;
  return active.apiMode === "runninghub" || !!state.apiKey.trim();
}

export function AndroidFHLImagesPoolConfig({
  active,
  bulkPasteOpen,
  onBulkPasteOpenChange,
  onOpenAdvanced,
}: {
  active: boolean;
  bulkPasteOpen: boolean;
  onBulkPasteOpenChange: (open: boolean) => void;
  onOpenAdvanced: () => void;
}) {
  const {
    activeProfileId,
    createProfile,
    deleteProfile,
    isTestingKey,
    profiles,
    pushToast,
    setActiveProfile,
    testProfileConnection,
    updateProfile,
    fhlTransportMode,
  } = useStudioStore();
  const [slotDrafts, setSlotDrafts] = useState<PoolSlotDraft[]>(createSlotDrafts);
  const [expandedIndex, setExpandedIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [testingSlotIndex, setTestingSlotIndex] = useState<number | null>(null);
  const [slotResults, setSlotResults] = useState<Record<number, SlotConnectionResult>>({});
  const [profilesWithStoredKeys, setProfilesWithStoredKeys] = useState<ReadonlySet<string>>(new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const bulkPasteDialogRef = useRef<AndroidBulkAPIKeyPasteDialogHandle>(null);

  const mappedProfiles = useMemo(
    () => mapFHLImagesProfilesToPoolSlots(profiles),
    [profiles],
  );
  const hasSavedCredential = (profile: UpstreamProfile | null | undefined): boolean => (
    !!profile && (!!profile.fhlImagesPoolKeyHint || profilesWithStoredKeys.has(profile.id))
  );
  const savedCount = mappedProfiles.filter(hasSavedCredential).length;

  useEffect(() => {
    if (!active) return;
    setSlotDrafts(createSlotDrafts());
    setExpandedIndex(0);
    setSlotResults({});
    setProfilesWithStoredKeys(new Set());
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSaving(false);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const targets = mappedProfiles.filter((profile): profile is UpstreamProfile => !!profile);
    void Promise.all(targets.map(async (profile) => {
      const storedKey = await GetStoredAPIKey(keyringUserFor(profile.id)).catch(() => "");
      return storedKey.trim() ? profile.id : "";
    })).then((profileIds) => {
      if (!cancelled) setProfilesWithStoredKeys(new Set(profileIds.filter(Boolean)));
    });
    return () => { cancelled = true; };
  }, [active, mappedProfiles]);

  function patchSlot(index: number, apiKey: string) {
    setSlotDrafts((current) => current.map((slot, slotIndex) => (
      slotIndex === index ? { apiKey, isBulkStaged: false } : slot
    )));
    setSlotResults((current) => {
      if (!current[index]) return current;
      const next = { ...current };
      delete next[index];
      return next;
    });
    setErrorMessage(null);
    setSuccessMessage(null);
  }

  async function pasteSlot(index: number) {
    let text = "";
    try {
      text = await ReadClipboardText();
      if (!text.trim()) {
        pushToast("剪贴板里没有文本", "warn");
        return;
      }
      const parsed = parseBulkAPIKeyLines(text, FHL_IMAGES_POOL_SLOT_COUNT);
      const tokenCount = (text.match(/sk-/g) ?? []).length;
      if (parsed.inputTooLarge || /\r|\n/.test(text) || tokenCount > 1 || parsed.validUniqueCount > 1) {
        bulkPasteDialogRef.current?.stageParsedResult(parsed, text.length > 0);
        text = "";
        openBulkPasteDialog();
        return;
      }
      if (parsed.keys.length !== 1) {
        pushToast("未识别到有效 API，当前槽位未修改", "warn");
        return;
      }
      patchSlot(index, parsed.keys[0]);
    } catch {
      pushToast("读取剪贴板失败，请重试。", "error", 5000);
    } finally {
      text = "";
    }
  }

  function openBulkPasteDialog() {
    if (busy) return;
    onBulkPasteOpenChange(true);
  }

  function confirmBulkPaste(keys: readonly string[], result: BulkAPIKeyParseResult) {
    const nextDrafts = createSlotDrafts();
    keys.forEach((apiKey, index) => {
      nextDrafts[index] = { apiKey, isBulkStaged: true };
    });
    setSlotDrafts(nextDrafts);
    setSlotResults({});
    setExpandedIndex(-1);
    setErrorMessage(null);
    const summary = bulkPasteSummary(result);
    setSuccessMessage(summary);
    pushToast(summary, "success", 5200);
  }

  async function activateFirstSuccessfulProfile(
    successfulProfileIds: readonly string[],
    testedProfileIds: readonly string[],
  ) {
    const state = useStudioStore.getState();
    const targetId = chooseFHLImagesPoolActivationTarget({
      profiles: state.profiles,
      activeProfileId: state.activeProfileId,
      activeProfileReady: hasReadyActiveProfile(),
      testedProfileIds,
      successfulProfileIds,
    });
    if (!targetId) return;
    await setActiveProfile(targetId);
    if (useStudioStore.getState().activeProfileId !== targetId || !hasReadyActiveProfile()) {
      throw new Error("连接成功，但设为当前 API 失败。");
    }
  }

  async function testSavedSlot(index: number, profile: UpstreamProfile): Promise<boolean> {
    setTestingSlotIndex(index);
    setSlotResults((current) => ({ ...current, [index]: "testing" }));
    try {
      const connected = await testProfileConnection(profile.id);
      setSlotResults((current) => ({ ...current, [index]: connected ? "success" : "error" }));
      return connected;
    } finally {
      setTestingSlotIndex(null);
    }
  }

  async function testAllSavedSlots(): Promise<{
    tested: number;
    succeeded: number;
    testedIds: string[];
    successfulIds: string[];
  }> {
    const targets = mapFHLImagesProfilesToPoolSlots(useStudioStore.getState().profiles)
      .map((profile, index) => (hasSavedCredential(profile) ? { profile: profile!, index } : null))
      .filter((entry): entry is { profile: UpstreamProfile; index: number } => !!entry);
    let succeeded = 0;
    const successfulIds: string[] = [];
    for (const { profile, index } of targets) {
      if (await testSavedSlot(index, profile)) {
        succeeded += 1;
        successfulIds.push(profile.id);
      }
    }
    return {
      tested: targets.length,
      succeeded,
      testedIds: targets.map(({ profile }) => profile.id),
      successfulIds,
    };
  }

  async function saveSlots({
    autoTest = true,
    targetIndexes,
  }: {
    autoTest?: boolean;
    targetIndexes?: readonly number[];
  } = {}): Promise<boolean> {
    const selectedIndexes = Array.from(new Set(
      (targetIndexes ?? slotDrafts.map((_, index) => index))
        .filter((index) => Number.isInteger(index) && index >= 0 && index < FHL_IMAGES_POOL_SLOT_COUNT),
    )).sort((left, right) => left - right);
    const rawValidatedKeys = new Map<number, string>();
    for (const index of selectedIndexes) {
      const draft = slotDrafts[index];
      if (!draft.apiKey.trim()) continue;
      try {
        rawValidatedKeys.set(index, validateAPIKeyForHeader(draft.apiKey));
      } catch (error: any) {
        setErrorMessage(`FHL${index + 1} 无法保存：${error?.message ?? "API Key 格式不正确"}`);
        return false;
      }
    }
    const normalizedTargets = normalizeFHLPoolTargetKeys(rawValidatedKeys);
    const validatedKeys = normalizedTargets.targetKeys;
    if (validatedKeys.size === 0) {
      if (!autoTest) return true;
      setIsSaving(true);
      setErrorMessage(null);
      setSuccessMessage(null);
      try {
        const summary = await testAllSavedSlots();
        await activateFirstSuccessfulProfile(summary.successfulIds, summary.testedIds);
        const message = summary.tested > 0
          ? `连接测试完成：${summary.succeeded}/${summary.tested} 个槽成功。`
          : "没有已填写的槽位，未发起连接检测。";
        if (summary.tested > 0 && summary.succeeded < summary.tested) {
          setErrorMessage(message);
          pushToast(message, "warn", 5200);
        } else {
          setSuccessMessage(message);
          pushToast(message, "success", 3600);
        }
        return true;
      } catch (error: any) {
        setErrorMessage(error?.message ?? "连接测试失败。");
        return false;
      } finally {
        setIsSaving(false);
      }
    }
    const currentSlots = mapFHLImagesProfilesToPoolSlots(useStudioStore.getState().profiles);
    const storedSnapshot = await readFHLPoolStoredCredentials(
      currentSlots,
      (profileId) => GetStoredAPIKey(keyringUserFor(profileId)),
    );
    if (storedSnapshot.readErrors.length > 0) {
      const first = storedSnapshot.readErrors[0];
      setErrorMessage(`FHL${first.index + 1} 无法确认已有凭据，已停止保存。请重试或重新配置该槽位。`);
      return false;
    }
    const savePlan = createFHLPoolSavePlan(
      validatedKeys,
      storedSnapshot.credentials,
      normalizedTargets.draftMerges,
    );
    const confirmation = fhlPoolSaveConfirmation(savePlan);
    if (confirmation && !window.confirm(confirmation)) {
      return false;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await executeFHLPoolSavePlan(validatedKeys, savePlan, {
        writeTarget: async (index, apiKey) => {
          const slotNumber = index + 1;
          const profile = currentSlots[index];
          const patch = {
            name: profile?.name || poolProfileName(slotNumber),
            apiMode: "images" as const,
            requestPolicy: "openai" as const,
            baseURL: FHL_BASE_URL,
            textModelID: "",
            imageModelID: FHL_IMAGE_MODEL_ID,
            concurrencyLimit: FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT,
            continuousPoolEnabled: true,
            imagesNewAPICompat: true,
            fhlImagesPoolSlot: slotNumber,
            apiKey,
          };
          if (profile) {
            const updated = await updateProfile(profile.id, patch);
            if (!updated) throw new Error(`FHL${slotNumber} 已不存在。`);
            return profile.id;
          } else {
            return createProfile({ ...patch, setActive: false });
          }
        },
        readTarget: async (_index, profileId) => GetStoredAPIKey(keyringUserFor(profileId)),
        deleteCredential: async (profileId) => DeleteStoredAPIKey(keyringUserFor(profileId)),
        readCredential: async (profileId) => GetStoredAPIKey(keyringUserFor(profileId)),
        deleteProfile: async (profileId, expectedEmpty) => {
          if (!expectedEmpty || (await GetStoredAPIKey(keyringUserFor(profileId))).trim()) {
            throw new Error("credential not empty");
          }
          const existing = useStudioStore.getState().profiles.some((profile) => profile.id === profileId);
          if (!existing) throw new Error("profile missing");
          await deleteProfile(profileId);
          if (useStudioStore.getState().profiles.some((profile) => profile.id === profileId)) {
            throw new Error("profile still present");
          }
        },
      });

      const savedIndexes = new Set([
        ...validatedKeys.keys(),
        ...normalizedTargets.draftMerges.map((move) => move.fromIndex),
      ]);
      setSlotDrafts((current) => current.map((draft, index) => (
        savedIndexes.has(index) ? { apiKey: "", isBulkStaged: false } : draft
      )));
      if (!autoTest) return true;
      const summary = await testAllSavedSlots();
      await activateFirstSuccessfulProfile(summary.successfulIds, summary.testedIds);
      const message = summary.tested > 0
        ? `连接测试完成：${summary.succeeded}/${summary.tested} 个槽成功。`
        : "没有已填写的槽位，未发起连接检测。";
      if (summary.tested > 0 && summary.succeeded < summary.tested) {
        setErrorMessage(message);
        pushToast(message, "warn", 5200);
      } else {
        setSuccessMessage(message);
        pushToast(message, "success", 3600);
      }
      return true;
    } catch (error: any) {
      setErrorMessage(error?.message ?? "保存 FHL Images 槽失败。");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function testSlot(index: number) {
    if (isSaving || isTestingKey) return;
    let profile = mappedProfiles[index];
    if (slotDrafts[index]?.apiKey.trim()) {
      if (!await saveSlots({ autoTest: false, targetIndexes: [index] })) return;
      profile = mapFHLImagesProfilesToPoolSlots(useStudioStore.getState().profiles)[index];
    }
    if (!profile || !hasSavedCredential(profile)) return;
    setErrorMessage(null);
    setSuccessMessage(null);
    const connected = await testSavedSlot(index, profile);
    if (!connected) return;
    try {
      await activateFirstSuccessfulProfile([profile.id], [profile.id]);
      setSuccessMessage(`FHL${index + 1} 连接正常。`);
    } catch (error: any) {
      setErrorMessage(error?.message ?? "连接成功，但启用失败。");
    }
  }

  async function clearSlot(index: number) {
    const profile = mappedProfiles[index];
    if (!profile || isSaving) return;
    if (!window.confirm(`确认清空 FHL${index + 1} 吗？对应 API Key 也会删除。`)) return;
    setIsSaving(true);
    try {
      await deleteProfile(profile.id);
      patchSlot(index, "");
      setSuccessMessage(`FHL${index + 1} 已清空；刷新后不会自动检测。`);
    } catch (error: any) {
      setErrorMessage(error?.message ?? `清空 FHL${index + 1} 失败。`);
    } finally {
      setIsSaving(false);
    }
  }

  const busy = isSaving || isTestingKey;
  const pendingCount = slotDrafts.filter((draft) => !!draft.apiKey.trim()).length;

  return (
    <>
      <section className="android-fhl-pool" aria-label="FHL API 10槽配置" data-fhl-transport-mode={fhlTransportMode}>
      <div className="android-fhl-pool-summary">
        <div className="android-fhl-pool-summary-copy">
          <strong>FHL API 10槽</strong>
          <span>{fhlTransportLabel(fhlTransportMode)} · 已保存 {savedCount}/{FHL_IMAGES_POOL_SLOT_COUNT} · 待保存 {pendingCount} · 每槽 {FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT} · 总容量 40</span>
        </div>
        <div className="android-fhl-pool-summary-actions">
          <button type="button" onClick={() => openBulkPasteDialog()} disabled={busy} data-audit-id="fhl-bulk-config-open">
            <ClipboardPaste className="h-4 w-4" />
            批量配置 10 个 API
          </button>
          <button type="button" onClick={onOpenAdvanced} disabled={busy}>
            <Settings2 className="h-4 w-4" />
            其他上游
          </button>
        </div>
      </div>

      <div className="android-fhl-slot-list">
        {slotDrafts.map((draft, index) => {
          const profile = mappedProfiles[index];
          const slotNumber = index + 1;
          const expanded = expandedIndex === index;
          const profileHasCredential = hasSavedCredential(profile);
          const draftHasCredential = !!draft.apiKey.trim();
          const result = profileHasCredential || draftHasCredential ? slotResults[index] : undefined;
          const status = result === "testing"
            ? "测试中"
            : result === "success"
              ? "连接正常"
              : result === "error"
                ? "连接失败"
                : draftHasCredential
                  ? "待保存"
                : profileHasCredential
                  ? "已保存密钥"
                  : "空槽";
          return (
            <article key={slotNumber} className={`android-fhl-slot ${expanded ? "expanded" : ""}`}>
              <button
                type="button"
                className="android-fhl-slot-toggle"
                onClick={() => setExpandedIndex(expanded ? -1 : index)}
                aria-expanded={expanded}
              >
                <span className="android-fhl-slot-name">FHL{slotNumber}</span>
                <span className={`android-fhl-slot-status ${result ?? (draftHasCredential ? "pending" : profileHasCredential ? "saved" : "empty")}`}>{status}</span>
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>

              {expanded ? (
                <div className="android-fhl-slot-body">
                  <label htmlFor={`android-fhl-key-${slotNumber}`}>API Key</label>
                  <div className="android-fhl-slot-secret">
                    <input
                      id={`android-fhl-key-${slotNumber}`}
                      type="password"
                      value={draft.isBulkStaged ? "" : draft.apiKey}
                      onChange={(event) => patchSlot(index, event.target.value)}
                      placeholder={draft.isBulkStaged
                        ? "批量预填已就绪；输入新值才替换"
                        : profileHasCredential
                          ? "已保存密钥；输入新值才覆盖"
                          : "长按输入框或点右侧图标粘贴"}
                      autoComplete="new-password"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      disabled={busy}
                      data-fhl-pool-slot={slotNumber}
                    />
                    <button type="button" onClick={() => void pasteSlot(index)} disabled={busy} title={`粘贴到 FHL${slotNumber}`} aria-label={`粘贴到 FHL${slotNumber}`}>
                      <ClipboardPaste className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="android-fhl-slot-actions">
                    <button
                      type="button"
                      onClick={() => void testSlot(index)}
                      disabled={busy || (!profileHasCredential && !draft.apiKey.trim())}
                    >
                      {testingSlotIndex === index ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <TestTube2 className="h-4 w-4" />}
                      保存并测试
                    </button>
                    <button type="button" className="danger" onClick={() => void clearSlot(index)} disabled={busy || !profile}>
                      <Trash2 className="h-4 w-4" />
                      清空
                    </button>
                    {profile && profile.id !== activeProfileId ? (
                      <button type="button" onClick={() => void setActiveProfile(profile.id)} disabled={busy}>
                        设为当前
                      </button>
                    ) : profile ? <span className="android-fhl-active-label">当前 API</span> : null}
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      {errorMessage ? (
        <div className="android-fhl-pool-message error"><AlertCircle className="h-4 w-4" /><span>{errorMessage}</span></div>
      ) : null}
      {successMessage ? (
        <div className="android-fhl-pool-message success"><CheckCircle2 className="h-4 w-4" /><span>{successMessage}</span></div>
      ) : null}

      <button type="button" className="android-fhl-pool-save" onClick={() => void saveSlots()} disabled={busy}>
        {isSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {isSaving ? "处理中..." : "保存并测试已填写槽位"}
      </button>
      </section>

      <AndroidBulkAPIKeyPasteDialog
        ref={bulkPasteDialogRef}
        open={active && bulkPasteOpen}
        pendingDraftCount={pendingCount}
        onClose={() => {
          onBulkPasteOpenChange(false);
        }}
        onConfirm={confirmBulkPaste}
      />
    </>
  );
}
