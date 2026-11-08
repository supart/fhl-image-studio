import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  LoaderCircle,
  RefreshCw,
  Save,
  Settings2,
  TestTube2,
  Trash2,
} from "lucide-react";
import { validateAPIKeyForHeader } from "../../../lib/apiKey";
import {
  fetchFHLImageModelCatalog,
  imageModelCatalogEntry,
  imageModelProviderForProfile,
} from "../../../lib/fhlImageModels";
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
import {
  commitValidatedFHLPoolImageModelSelection,
  currentCredentialMutationRevision,
} from "../../../state/studioStore.profiles";
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
import {
  buildFHLPoolModelValidationSignature,
  prepareFHLPoolImageModelConfig,
  selectConsistentFHLPoolImageModel,
  type PreparedFHLPoolImageModelConfig,
} from "./fhlPoolImageModelConfig";

type PoolSlotDraft = {
  apiKey: string;
  isBulkStaged: boolean;
};

type SlotConnectionResult = "testing" | "success" | "error";

type CredentialScanStatus = "idle" | "scanning" | "ready" | "error";
type UnifiedModelPanelState =
  | "waiting-credentials"
  | "pending-draft"
  | "no-targets"
  | "validating"
  | "ready"
  | "error";

type UnifiedModelSnapshot = PreparedFHLPoolImageModelConfig & {
  credentialRevision: number;
  validationSignature: string;
};

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
    proxyMode,
    proxyURL,
  } = useStudioStore();
  const [slotDrafts, setSlotDrafts] = useState<PoolSlotDraft[]>(createSlotDrafts);
  const [expandedIndex, setExpandedIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [testingSlotIndex, setTestingSlotIndex] = useState<number | null>(null);
  const [slotResults, setSlotResults] = useState<Record<number, SlotConnectionResult>>({});
  const [profilesWithStoredKeys, setProfilesWithStoredKeys] = useState<ReadonlySet<string>>(new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [modelConfigBusy, setModelConfigBusy] = useState(false);
  const [modelSnapshot, setModelSnapshot] = useState<UnifiedModelSnapshot | null>(null);
  const [selectedImageModelID, setSelectedImageModelID] = useState("");
  const [credentialScanStatus, setCredentialScanStatus] = useState<CredentialScanStatus>("idle");
  const [credentialScanEpoch, setCredentialScanEpoch] = useState(0);
  const [credentialScanRevision, setCredentialScanRevision] = useState(0);
  const [modelErrorMessage, setModelErrorMessage] = useState<string | null>(null);
  const [modelSuccessMessage, setModelSuccessMessage] = useState<string | null>(null);
  const [modelConfigGeneration, setModelConfigGeneration] = useState(0);
  const modelRequestVersion = useRef(0);
  const modelAbortController = useRef<AbortController | null>(null);
  const credentialScanVersion = useRef(0);
  const autoValidationSignature = useRef("");
  const validationSignatureRef = useRef("");
  const suppressCredentialRescan = useRef(false);
  const bulkPasteDialogRef = useRef<AndroidBulkAPIKeyPasteDialogHandle>(null);

  const mappedProfiles = useMemo(
    () => mapFHLImagesProfilesToPoolSlots(profiles),
    [profiles],
  );
  const hasSavedCredential = (profile: UpstreamProfile | null | undefined): boolean => (
    !!profile && (!!profile.fhlImagesPoolKeyHint || profilesWithStoredKeys.has(profile.id))
  );
  const savedCount = mappedProfiles.filter(hasSavedCredential).length;
  const enabledConfiguredProfiles = mappedProfiles.filter((profile): profile is UpstreamProfile => (
    hasSavedCredential(profile) && profile!.continuousPoolEnabled !== false
  ));
  const unifiedModelSignatures = new Set(enabledConfiguredProfiles.map((profile) => [
    profile.imageModelID,
    profile.imageModelValidatedAt || 0,
    profile.imageModelCatalogBaseUrl || "",
    profile.imageModelCatalogProvider || "",
  ].join("\u0000")));
  const unifiedModelLabel = enabledConfiguredProfiles.length > 0
    && unifiedModelSignatures.size === 1
    && enabledConfiguredProfiles.every((profile) => (
      !!profile.imageModelValidatedAt
      && !!profile.imageModelCatalogBaseUrl
      && !!profile.imageModelCatalogProvider
    ))
    ? enabledConfiguredProfiles[0].imageModelID
    : "待统一验证";

  const validationTargets = mappedProfiles.map((profile, index) => ({
    profileId: profile?.id ?? "",
    slotNumber: index + 1,
    exists: !!profile,
    enabled: !!profile && profile.continuousPoolEnabled !== false,
    credentialPresent: !!profile && profilesWithStoredKeys.has(profile.id),
    baseURL: profile?.baseURL ?? "",
    provider: profile?.provider ?? "fhl",
  }));
  const validationSignature = buildFHLPoolModelValidationSignature(
    validationTargets,
    modelConfigGeneration,
  );
  validationSignatureRef.current = validationSignature;
  const activeCredentialTargetCount = validationTargets.filter((target) => (
    target.enabled && target.credentialPresent
  )).length;

  useEffect(() => {
    if (!active) return undefined;
    setSlotDrafts(createSlotDrafts());
    setExpandedIndex(0);
    setSlotResults({});
    setProfilesWithStoredKeys(new Set());
    setCredentialScanStatus("scanning");
    setCredentialScanRevision(0);
    setCredentialScanEpoch(0);
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSaving(false);
    setModelConfigBusy(false);
    setModelSnapshot(null);
    setSelectedImageModelID("");
    setModelErrorMessage(null);
    setModelSuccessMessage(null);
    setModelConfigGeneration(0);
    modelRequestVersion.current += 1;
    modelAbortController.current?.abort();
    modelAbortController.current = null;
    credentialScanVersion.current += 1;
    autoValidationSignature.current = "";
    suppressCredentialRescan.current = false;
    return () => {
      modelRequestVersion.current += 1;
      modelAbortController.current?.abort();
      modelAbortController.current = null;
      credentialScanVersion.current += 1;
      autoValidationSignature.current = "";
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    if (suppressCredentialRescan.current) {
      suppressCredentialRescan.current = false;
      return;
    }
    const scanVersion = credentialScanVersion.current + 1;
    credentialScanVersion.current = scanVersion;
    const revisionAtStart = currentCredentialMutationRevision();
    let cancelled = false;
    setCredentialScanStatus("scanning");
    setProfilesWithStoredKeys(new Set());
    modelRequestVersion.current += 1;
    modelAbortController.current?.abort();
    modelAbortController.current = null;
    setModelConfigBusy(false);
    setModelSnapshot(null);
    setSelectedImageModelID("");
    setModelErrorMessage(null);
    setModelSuccessMessage(null);
    autoValidationSignature.current = "";
    const targets = mappedProfiles.filter((profile): profile is UpstreamProfile => !!profile);
    void Promise.all(targets.map(async (profile) => {
      const storedKey = await GetStoredAPIKey(keyringUserFor(profile.id));
      return storedKey.trim() ? profile.id : "";
    })).then((profileIds) => {
      if (cancelled || scanVersion !== credentialScanVersion.current) return;
      if (revisionAtStart !== currentCredentialMutationRevision()) {
        setCredentialScanEpoch((value) => value + 1);
        return;
      }
      setProfilesWithStoredKeys(new Set(profileIds.filter(Boolean)));
      setCredentialScanRevision(revisionAtStart);
      setCredentialScanStatus("ready");
    }).catch(() => {
      if (cancelled || scanVersion !== credentialScanVersion.current) return;
      if (revisionAtStart !== currentCredentialMutationRevision()) {
        setCredentialScanEpoch((value) => value + 1);
        return;
      }
      setCredentialScanRevision(revisionAtStart);
      setCredentialScanStatus("error");
      setModelErrorMessage("无法读取已保存凭据，请刷新后重试。");
      setModelSuccessMessage(null);
    });
    return () => { cancelled = true; };
  }, [active, mappedProfiles, credentialScanEpoch]);

  function invalidateModelValidation({ rescan = false }: { rescan?: boolean } = {}) {
    modelRequestVersion.current += 1;
    modelAbortController.current?.abort();
    modelAbortController.current = null;
    setModelConfigBusy(false);
    setModelSnapshot(null);
    setSelectedImageModelID("");
    setModelErrorMessage(null);
    setModelSuccessMessage(null);
    setModelConfigGeneration((value) => value + 1);
    autoValidationSignature.current = "";
    if (rescan) setCredentialScanEpoch((value) => value + 1);
  }

  function patchSlot(index: number, apiKey: string) {
    invalidateModelValidation();
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

  function stageSlotClipboardText(index: number, text: string) {
    if (!text.trim()) {
      pushToast("剪贴板里没有文本", "warn");
      return;
    }
    const parsed = parseBulkAPIKeyLines(text, FHL_IMAGES_POOL_SLOT_COUNT);
    const tokenCount = (text.match(/sk-/g) ?? []).length;
    if (parsed.inputTooLarge || /\r|\n/.test(text) || tokenCount > 1 || parsed.validUniqueCount > 1) {
      bulkPasteDialogRef.current?.stageParsedResult(parsed, text.length > 0);
      openBulkPasteDialog();
      return;
    }
    if (parsed.keys.length !== 1) {
      pushToast("未识别到有效 API，当前槽位未修改", "warn");
      return;
    }
    patchSlot(index, parsed.keys[0]);
  }

  async function pasteSlot(index: number) {
    let text = "";
    try {
      text = await ReadClipboardText();
      stageSlotClipboardText(index, text);
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
    invalidateModelValidation();
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
    invalidateModelValidation();
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
            // Keep an existing exact provider model. New slots inherit only
            // the model ID (never another slot's validation metadata or key)
            // and must be validated after their own credential is saved.
            imageModelID: profile?.imageModelID
              || currentSlots.find((candidate) => candidate?.imageModelID)?.imageModelID
              || FHL_IMAGE_MODEL_ID,
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

      setCredentialScanEpoch((value) => value + 1);

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
    invalidateModelValidation();
    try {
      await deleteProfile(profile.id);
      patchSlot(index, "");
      setCredentialScanEpoch((value) => value + 1);
      setSuccessMessage(`FHL${index + 1} 已清空；刷新后不会自动检测。`);
    } catch (error: any) {
      setErrorMessage(error?.message ?? `清空 FHL${index + 1} 失败。`);
    } finally {
      setIsSaving(false);
    }
  }

  function safeUnifiedModelError(error: unknown): string {
    const message = error instanceof Error ? error.message : "";
    if (/^FHL\d+ (?:无法读取已保存凭据|已保存凭据不可用|已保存凭据格式无效|模型目录验证失败)，统一配置未生效。$/.test(message)) {
      return message;
    }
    if (
      message === "没有已配置且启用的 FHL Images 槽位可验证。"
      || message === "已配置且启用的 FHL Images 槽位必须使用同一 Base URL 和 provider。"
      || message === "已配置且启用的 FHL Images 槽位没有共同可用的精确生图模型。"
      || message === "配置在验证期间发生变化，请重新获取模型目录。"
      || message === "配置在验证期间发生变化，请刷新模型列表。"
      || message === "统一生图模型目录保存失败，原配置未改变。"
    ) {
      return message;
    }
    return "统一生图模型配置失败，请检查活动槽位后重试。";
  }

  async function prepareUnifiedImageModels({
    force = false,
    signature = validationSignatureRef.current,
  }: {
    force?: boolean;
    signature?: string;
  } = {}) {
    const requestSignature = signature || validationSignatureRef.current;
    if (!force && autoValidationSignature.current === requestSignature) return;
    if (isSaving || isTestingKey || pendingCount > 0) {
      if (pendingCount > 0) {
        setModelErrorMessage("请先保存待保存的 API，再验证模型列表。");
      }
      return;
    }
    autoValidationSignature.current = requestSignature;
    const requestVersion = modelRequestVersion.current + 1;
    modelRequestVersion.current = requestVersion;
    modelAbortController.current?.abort();
    const controller = new AbortController();
    modelAbortController.current = controller;
    const credentialRevision = currentCredentialMutationRevision();
    setModelConfigBusy(true);
    setModelSnapshot(null);
    setSelectedImageModelID("");
    setModelErrorMessage(null);
    setModelSuccessMessage(null);
    try {
      const prepared = await prepareFHLPoolImageModelConfig({
        profiles: useStudioStore.getState().profiles,
        readCredential: (profileId) => GetStoredAPIKey(keyringUserFor(profileId)),
        fetchCatalog: (profile, apiKey) => fetchFHLImageModelCatalog(
          profile.baseURL,
          apiKey,
          imageModelProviderForProfile(profile),
          proxyMode,
          proxyURL,
          controller.signal,
          { persist: false },
        ),
      });
      if (requestVersion !== modelRequestVersion.current) return;
      if (credentialRevision !== currentCredentialMutationRevision()) {
        throw new Error("配置在验证期间发生变化，请重新获取模型目录。");
      }
      if (requestSignature !== validationSignatureRef.current) {
        throw new Error("配置在验证期间发生变化，请重新获取模型目录。");
      }
      const currentModel = selectConsistentFHLPoolImageModel(
        useStudioStore.getState().profiles,
        prepared.targetProfileIds,
      );
      setSelectedImageModelID(imageModelCatalogEntry(prepared.catalog, currentModel) ? currentModel : "");
      setModelSnapshot({ ...prepared, credentialRevision, validationSignature: requestSignature });
      const slots = prepared.targetSlotNumbers.map((slot) => `FHL${slot}`).join("、");
      const message = `已验证 ${prepared.targetProfileIds.length} 个活动槽位（${slots}），请选择统一生图模型并保存。`;
      setModelSuccessMessage(message);
      pushToast(message, "success", 5600);
    } catch (error) {
      if (requestVersion !== modelRequestVersion.current) return;
      const message = safeUnifiedModelError(error);
      setModelSnapshot(null);
      setSelectedImageModelID("");
      setModelErrorMessage(message);
      pushToast(message, "error", 6200);
    } finally {
      if (requestVersion === modelRequestVersion.current) {
        modelAbortController.current = null;
        setModelConfigBusy(false);
      }
    }
  }

  function applyUnifiedImageModel() {
    if (!modelSnapshot || modelConfigBusy || !selectedImageModelID) return;
    setModelErrorMessage(null);
    if (modelSnapshot.credentialRevision !== currentCredentialMutationRevision()) {
      const message = "配置在验证后发生变化，请重新获取模型目录。";
      setModelSnapshot(null);
      setSelectedImageModelID("");
      setModelErrorMessage(message);
      pushToast(message, "warn", 5200);
      return;
    }
    if (modelSnapshot.validationSignature !== validationSignatureRef.current) {
      const message = "配置在验证后发生变化，请刷新模型列表。";
      setModelSnapshot(null);
      setSelectedImageModelID("");
      setModelErrorMessage(message);
      pushToast(message, "warn", 5200);
      return;
    }
    const entry = imageModelCatalogEntry(modelSnapshot.catalog, selectedImageModelID);
    if (!entry) {
      const message = "所选模型不在全部活动槽位的共同目录中，请刷新模型列表。";
      setModelErrorMessage(message);
      pushToast(message, "warn", 5200);
      return;
    }
    try {
      suppressCredentialRescan.current = true;
      commitValidatedFHLPoolImageModelSelection({
        getState: () => useStudioStore.getState(),
        setState: (patch) => useStudioStore.setState(patch),
      }, {
        catalog: modelSnapshot.catalog,
        imageModelID: entry.id,
        targetProfileIds: modelSnapshot.targetProfileIds,
      });
      const message = `已保存统一模型 ${entry.id}，${modelSnapshot.targetProfileIds.length} 个活动槽位可共同调度。`;
      setModelSuccessMessage(message);
      pushToast(message, "success", 5600);
    } catch (error) {
      // A failed atomic commit must not suppress the next credential scan.
      suppressCredentialRescan.current = false;
      const message = safeUnifiedModelError(error);
      setModelErrorMessage(message);
      pushToast(message, "error", 6200);
    }
  }

  function refreshUnifiedImageModels() {
    if (credentialScanStatus === "error") {
      setCredentialScanEpoch((value) => value + 1);
      return;
    }
    void prepareUnifiedImageModels({ force: true, signature: validationSignature });
  }

  const busy = isSaving || isTestingKey || modelConfigBusy;
  const pendingCount = slotDrafts.filter((draft) => !!draft.apiKey.trim()).length;
  const modelPanelState: UnifiedModelPanelState = credentialScanStatus === "error"
    ? "error"
    : credentialScanStatus !== "ready"
    ? "waiting-credentials"
    : pendingCount > 0
      ? "pending-draft"
      : modelConfigBusy
        ? "validating"
        : modelErrorMessage
          ? "error"
          : modelSnapshot
            ? "ready"
            : activeCredentialTargetCount === 0
              ? "no-targets"
              : "validating";
  const modelPanelStatus = modelErrorMessage
    || modelSuccessMessage
    || (modelPanelState === "waiting-credentials"
      ? "正在检查已保存的 FHL 凭据…"
      : modelPanelState === "pending-draft"
        ? "请先保存待保存的 API，保存后会自动验证模型列表。"
        : modelPanelState === "no-targets"
          ? "没有已配置且启用的槽位；保存 API 后会自动验证。"
          : modelPanelState === "validating"
            ? "正在验证活动槽位的共同模型…"
            : "请选择全部活动槽位共同可用的精确生图模型。");

  useEffect(() => {
    if (!active || credentialScanStatus !== "ready") return;
    if (credentialScanRevision !== currentCredentialMutationRevision()) {
      setCredentialScanEpoch((value) => value + 1);
      return;
    }
    if (pendingCount > 0 || isSaving || isTestingKey || modelConfigBusy) return;
    if (activeCredentialTargetCount === 0) {
      autoValidationSignature.current = validationSignature;
      setModelSnapshot(null);
      setSelectedImageModelID("");
      setModelErrorMessage(null);
      setModelSuccessMessage("没有已配置且启用的槽位，未发起模型目录请求。");
      return;
    }
    if (autoValidationSignature.current === validationSignature) return;
    void prepareUnifiedImageModels({ signature: validationSignature });
  }, [
    active,
    activeCredentialTargetCount,
    credentialScanRevision,
    credentialScanStatus,
    isSaving,
    isTestingKey,
    modelConfigBusy,
    pendingCount,
    validationSignature,
  ]);

  return (
    <>
      <section className="android-fhl-pool" aria-label="FHL API 10槽配置" data-fhl-transport-mode={fhlTransportMode}>
      <div className="android-fhl-pool-summary">
        <div className="android-fhl-pool-summary-copy">
          <strong>FHL API 10槽</strong>
          <span>{fhlTransportLabel(fhlTransportMode)} · 统一模型 {unifiedModelLabel} · 已保存 {savedCount}/{FHL_IMAGES_POOL_SLOT_COUNT} · 待保存 {pendingCount} · 每槽 {FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT} · 总容量 40</span>
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

      <div
        className="android-fhl-pool-model-config"
        data-testid="android-fhl-unified-model-panel"
        data-model-state={modelPanelState}
        aria-busy={modelConfigBusy}
      >
        <div className="android-fhl-pool-model-config-header">
          <div className="android-fhl-pool-model-title">全部活动槽位共同可用的模型</div>
          <button
            type="button"
            className="android-fhl-pool-model-refresh"
            onClick={refreshUnifiedImageModels}
            disabled={busy
              || pendingCount > 0
              || (credentialScanStatus !== "ready" && credentialScanStatus !== "error")
              || (credentialScanStatus === "ready" && activeCredentialTargetCount === 0)}
            data-testid="android-fhl-unified-model-fetch"
            aria-label="刷新模型列表"
            title="刷新模型列表"
          >
            {modelConfigBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
        <div
          className={`android-fhl-pool-model-status ${modelErrorMessage ? "error" : modelSuccessMessage ? "success" : ""}`}
          data-state={modelPanelState}
          role="status"
          aria-live="polite"
        >
          {modelPanelStatus}
        </div>
        <div className="android-fhl-pool-model-controls">
          <select
            id="android-fhl-unified-image-model"
            value={selectedImageModelID}
            onChange={(event) => setSelectedImageModelID(event.target.value)}
            disabled={busy || modelPanelState !== "ready" || !modelSnapshot}
            className="focus-ring android-upstream-input font-mono-token"
          >
            <option value="">
              {modelPanelState === "ready" ? "请选择精确生图模型" : "验证完成后选择共同模型"}
            </option>
            {modelSnapshot?.catalog.models.map((model) => (
              <option key={model.id} value={model.id}>{model.id}</option>
            ))}
          </select>
        </div>
        <div className="android-fhl-pool-model-actions">
          <button
            type="button"
            className="primary"
            onClick={applyUnifiedImageModel}
            disabled={busy || modelPanelState !== "ready" || !modelSnapshot || !selectedImageModelID}
            data-testid="android-fhl-unified-model-apply"
          >
            <Save className="h-4 w-4" />
            保存统一模型
          </button>
          <span className="android-fhl-pool-model-save-hint">只更新已配置且启用的槽位；空槽和停用槽不会参与目录请求。</span>
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
                      onPaste={(event) => {
                        event.preventDefault();
                        let incomingText = "";
                        try {
                          incomingText = event.clipboardData.getData("text");
                          stageSlotClipboardText(index, incomingText);
                        } catch {
                          pushToast("粘贴内容读取失败，请重试。", "error", 5000);
                        } finally {
                          incomingText = "";
                        }
                      }}
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
