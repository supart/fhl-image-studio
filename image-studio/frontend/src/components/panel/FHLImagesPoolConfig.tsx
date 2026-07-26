import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, Save, Settings2, TestTube2, Trash2 } from "lucide-react";
import { validateAPIKeyForHeader } from "../../lib/apiKey";
import {
  FHL_BASE_URL,
  FHL_IMAGE_MODEL_ID,
  FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT,
  FHL_IMAGES_POOL_SLOT_COUNT,
  mapFHLImagesProfilesToPoolSlots,
} from "../../lib/profiles";
import { usePlatform } from "../../platform/context";
import { useStudioStore } from "../../state/studioStore";
import type { UpstreamProfile } from "../../types/domain";

type PoolSlotDraft = {
  apiKey: string;
  continuousPoolEnabled: boolean;
  concurrencyLimit: number;
};

type SlotConnectionResult = {
  status: "testing" | "success" | "error";
};

function createSlotDraft(profile: UpstreamProfile | null): PoolSlotDraft {
  return {
    apiKey: "",
    continuousPoolEnabled: profile?.continuousPoolEnabled ?? true,
    concurrencyLimit: FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT,
  };
}

function createSlotDrafts(profiles: readonly UpstreamProfile[]): PoolSlotDraft[] {
  return mapFHLImagesProfilesToPoolSlots(profiles).map(createSlotDraft);
}

function poolProfileName(slot: number): string {
  return `FHL-${slot} Images`;
}

function displayKeyHint(value: string): string {
  return value.includes("...") ? value : `sk-...${value}`;
}

export function FHLImagesPoolConfig({
  active,
  onClose,
  onOpenAdvanced,
}: {
  active: boolean;
  onClose?: () => void;
  onOpenAdvanced?: () => void;
}) {
  const { usesFluentUI } = usePlatform();
  const {
    profiles,
    createProfile,
    updateProfile,
    deleteProfile,
    setActiveProfile,
    testProfileConnection,
    isTestingKey,
    activeProfileId,
    fhlTransportMode,
    pushToast,
  } = useStudioStore();
  const transportLabel = fhlTransportMode === "responses" ? "FHL Responses" : "FHL Images";
  const [slotDrafts, setSlotDrafts] = useState<PoolSlotDraft[]>(() => createSlotDrafts(profiles));
  const [isSaving, setIsSaving] = useState(false);
  const [testingSlotIndex, setTestingSlotIndex] = useState<number | null>(null);
  const [slotConnectionResults, setSlotConnectionResults] = useState<Record<number, SlotConnectionResult>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const mappedProfiles = useMemo(
    () => mapFHLImagesProfilesToPoolSlots(profiles),
    [profiles],
  );
  const savedPoolSlotCount = mappedProfiles.filter((profile) => !!profile?.fhlImagesPoolKeyHint).length;
  const legacyPoolProfileCount = mappedProfiles.filter((profile) => !!profile && !profile.fhlImagesPoolKeyHint).length;

  useEffect(() => {
    if (!active) {
      setSlotDrafts(createSlotDrafts([]));
      setSlotConnectionResults({});
      setErrorMessage(null);
      setSuccessMessage(null);
      setIsSaving(false);
      return;
    }
    setSlotDrafts(createSlotDrafts(profiles));
    setSlotConnectionResults({});
    setErrorMessage(null);
    setSuccessMessage(null);
  // The inputs intentionally do not refresh while the panel remains open.
  // This prevents a profile save from rehydrating or exposing typed API keys.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  function patchSlot(index: number, patch: Partial<PoolSlotDraft>) {
    setSlotDrafts((current) => current.map((slot, slotIndex) => (
      slotIndex === index ? { ...slot, ...patch } : slot
    )));
    setSlotConnectionResults((current) => {
      if (!current[index]) return current;
      const next = { ...current };
      delete next[index];
      return next;
    });
    setErrorMessage(null);
    setSuccessMessage(null);
  }

  function refreshAfterMutation({ clearAllKeys }: { clearAllKeys: boolean }) {
    const currentProfiles = useStudioStore.getState().profiles;
    const refreshed = createSlotDrafts(currentProfiles);
    setSlotDrafts((current) => refreshed.map((slot, index) => ({
      ...slot,
      apiKey: clearAllKeys ? "" : current[index]?.apiKey ?? "",
    })));
  }

  async function testSavedPoolSlot(index: number, profile: UpstreamProfile): Promise<boolean> {
    setTestingSlotIndex(index);
    setSlotConnectionResults((current) => ({ ...current, [index]: { status: "testing" } }));
    try {
      const connected = await testProfileConnection(profile.id);
      setSlotConnectionResults((current) => ({ ...current, [index]: { status: connected ? "success" : "error" } }));
      return connected;
    } finally {
      setTestingSlotIndex(null);
    }
  }

  async function autoTestSavedPoolSlots(): Promise<{ tested: number; succeeded: number }> {
    const savedSlots = mapFHLImagesProfilesToPoolSlots(useStudioStore.getState().profiles);
    const targets = savedSlots
      .map((profile, index) => (profile ? { profile, index } : null))
      .filter((item): item is { profile: UpstreamProfile; index: number } => !!item);
    let succeeded = 0;
    for (const { profile, index } of targets) {
      if (await testSavedPoolSlot(index, profile)) succeeded += 1;
    }
    return { tested: targets.length, succeeded };
  }

  async function handleSave({ autoTest = true }: { autoTest?: boolean } = {}): Promise<boolean> {
    const currentProfiles = useStudioStore.getState().profiles;
    const currentSlots = mapFHLImagesProfilesToPoolSlots(currentProfiles);
    const drafts = slotDrafts.slice(0, FHL_IMAGES_POOL_SLOT_COUNT);
    const validatedKeys = new Map<number, string>();

    for (const [index, slot] of drafts.entries()) {
      if (!slot.apiKey.trim()) continue;
      try {
        validatedKeys.set(index, validateAPIKeyForHeader(slot.apiKey));
      } catch (error: any) {
        setErrorMessage(`第 ${index + 1} 个 API Key 无法保存：${error?.message ?? "格式不正确"}`);
        return false;
      }
    }

    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      for (const [index, slot] of drafts.entries()) {
        const profile = currentSlots[index];
        const apiKey = validatedKeys.get(index);
        const profilePatch = {
          name: profile ? profile.name : poolProfileName(index + 1),
          apiMode: "images" as const,
          requestPolicy: "openai" as const,
          baseURL: FHL_BASE_URL,
          textModelID: "",
          imageModelID: FHL_IMAGE_MODEL_ID,
          concurrencyLimit: FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT,
          continuousPoolEnabled: slot.continuousPoolEnabled,
          imagesNewAPICompat: true,
          fhlImagesPoolSlot: index + 1,
        };

        if (profile) {
          const needsUpdate = !!apiKey
            || profile.requestPolicy !== "openai"
            || profile.baseURL !== FHL_BASE_URL
            || profile.textModelID !== ""
            || profile.imageModelID !== FHL_IMAGE_MODEL_ID
            || profile.concurrencyLimit !== FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT
            || (profile.continuousPoolEnabled ?? true) !== slot.continuousPoolEnabled
            || profile.imagesNewAPICompat !== true
            || profile.fhlImagesPoolSlot !== index + 1;
          if (needsUpdate) {
            const updated = await updateProfile(profile.id, {
              ...profilePatch,
              ...(apiKey ? { apiKey } : {}),
            });
            if (!updated) throw new Error(`第 ${index + 1} 个 FHL API 槽配置已不存在。`);
          }
        } else if (apiKey) {
          await createProfile({
            ...profilePatch,
            apiKey,
            setActive: false,
          });
        }
      }
      refreshAfterMutation({ clearAllKeys: true });
      if (autoTest) {
        const pendingMessage = `${transportLabel} 连续池配置已保存，正在自动测试连接...`;
        setSuccessMessage(pendingMessage);
        pushToast(pendingMessage, "info", 3200);
        const { tested, succeeded } = await autoTestSavedPoolSlots();
        const message = tested > 0
          ? `${transportLabel} API 配置测试完成：${succeeded}/${tested} 个成功。`
          : `${transportLabel} 连续池配置已保存。`;
        if (tested > 0 && succeeded < tested) {
          setSuccessMessage(null);
          setErrorMessage(message);
          pushToast(message, "warn", 5200);
        } else {
          setErrorMessage(null);
          setSuccessMessage(message);
          pushToast(message, "success", 3600);
        }
        return true;
      }
      const message = `${transportLabel} 连续池配置已保存。`;
      setSuccessMessage(message);
      pushToast(message, "success", 3200);
      return true;
    } catch (error: any) {
      setErrorMessage(error?.message ?? `保存 ${transportLabel} 连续池配置失败。`);
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleTest(index: number) {
    if (isSaving || isTestingKey) return;
    const slot = slotDrafts[index];
    let profile = mappedProfiles[index];
    if (slot?.apiKey.trim()) {
      const saved = await handleSave({ autoTest: false });
      if (!saved) return;
      profile = mapFHLImagesProfilesToPoolSlots(useStudioStore.getState().profiles)[index];
    }
    if (!profile) {
      setErrorMessage(`请先保存第 ${index + 1} 个 FHL API 槽再测试。`);
      return;
    }

    setTestingSlotIndex(index);
    setErrorMessage(null);
    setSuccessMessage(null);
    const connected = await testSavedPoolSlot(index, profile);
    if (connected) setSuccessMessage(`第 ${index + 1} 个 FHL API 槽连接正常。`);
  }

  async function handleSetActive(profile: UpstreamProfile) {
    if (isSaving || isTestingKey || profile.id === activeProfileId) return;
    try {
      await setActiveProfile(profile.id);
      setSuccessMessage(`${transportLabel} 已设为当前 API。`);
    } catch (error: any) {
      setErrorMessage(error?.message ?? "设置当前 API 失败。");
    }
  }

  async function handleDelete(index: number) {
    const profile = mappedProfiles[index];
    if (!profile || isSaving) return;
    if (!window.confirm(`确认删除第 ${index + 1} 个 FHL API 槽配置吗？对应 API Key 也会从系统凭据存储中删除。`)) return;

    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const deleted = await deleteProfile(profile.id);
      if (!deleted) {
        setErrorMessage("该配置仍有排队或运行中的任务，等待任务结束后再删除。");
        return;
      }
      refreshAfterMutation({ clearAllKeys: false });
      const message = `第 ${index + 1} 个 FHL API 槽配置已删除。`;
      setSuccessMessage(message);
      pushToast(message, "success", 3200);
    } catch (error: any) {
      setErrorMessage(error?.message ?? "删除 FHL API 槽配置失败。");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="fhl-images-pool-config flex min-w-0 flex-col gap-3">
      <div className={`flex flex-wrap items-start justify-between gap-3 border border-amber-300/70 bg-amber-50 px-3 py-2.5 text-amber-950 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">{transportLabel} 连续池</div>
          <p className="mt-0.5 text-[11px] leading-5 opacity-85">
            当前新任务使用 {transportLabel}；固定显示 {FHL_IMAGES_POOL_SLOT_COUNT} 个独立 FHL API 槽。槽位配置不会随接口切换而改变。
          </p>
        </div>
        <div className="shrink-0 text-right text-[11px] leading-5 opacity-85">
          <div>已填写 {savedPoolSlotCount}/{FHL_IMAGES_POOL_SLOT_COUNT} 个 API</div>
          {legacyPoolProfileCount ? <div>旧配置 {legacyPoolProfileCount} 条，尾号未记录</div> : null}
        </div>
      </div>

      <div className="grid gap-2">
        {slotDrafts.map((slot, index) => {
          const profile = mappedProfiles[index];
          const slotNumber = index + 1;
          const keyInputName = `fhl-images-pool-api-key-${slotNumber}`;
          const keyHint = profile?.fhlImagesPoolKeyHint;
          const redactedKeyHint = keyHint ? displayKeyHint(keyHint) : "";
          const slotConnectionResult = slotConnectionResults[index];
          const rowStatus = slotConnectionResult?.status === "testing"
            ? "测试中"
            : slotConnectionResult?.status === "success"
              ? "配置成功"
              : slotConnectionResult?.status === "error"
                ? "连接失败"
                : !profile ? "空槽" : keyHint ? "已保存" : "旧配置";
          const rowStatusClass = slotConnectionResult?.status === "testing"
            ? "text-sky-600 dark:text-sky-300"
            : slotConnectionResult?.status === "success"
              ? "text-emerald-600 dark:text-emerald-300"
              : slotConnectionResult?.status === "error"
                ? "text-red-600 dark:text-red-300"
                : keyHint
                  ? "text-emerald-600 dark:text-emerald-300"
                  : profile ? "text-amber-700 dark:text-amber-300" : "text-zinc-500 dark:text-zinc-400";
          const slotDisplayName = profile ? transportLabel : "待创建";
          const keyPlaceholder = keyHint
            ? `已保存：${redactedKeyHint}；重新输入直接替换，无需删除`
            : profile
              ? "旧配置未记录尾号；重新输入直接替换，无需删除"
              : "粘贴 API Key";
          return (
            <div
              key={slotNumber}
              className={`grid min-w-0 grid-cols-[100px_minmax(0,1fr)_92px_82px_34px_34px] items-center gap-2 border border-black/[0.08] bg-[var(--surface)]/75 px-2.5 py-2 dark:border-white/[0.08] ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
            >
              <div className="min-w-0" title={profile ? `${transportLabel} · API ${slotNumber}` : `API ${slotNumber} 空槽`}>
                <div className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-100">API {slotNumber}</div>
                <div className="mt-0.5 truncate text-[10px] text-zinc-500 dark:text-zinc-400">{slotDisplayName}</div>
                <div className={`mt-0.5 text-[10px] ${rowStatusClass}`}>
                  {rowStatus}{keyHint ? ` ${redactedKeyHint}` : ""}
                </div>
              </div>

              <input
                type="password"
                value={slot.apiKey}
                onChange={(event) => patchSlot(index, { apiKey: event.target.value })}
                placeholder={keyPlaceholder}
                spellCheck={false}
                autoComplete="new-password"
                autoCorrect="off"
                autoCapitalize="off"
                name={keyInputName}
                data-lpignore="true"
                data-1p-ignore="true"
                disabled={isSaving}
                className={`focus-ring min-w-0 border border-black/[0.08] bg-white/80 px-2.5 py-2 text-[12px] text-zinc-900 placeholder:text-zinc-400 dark:border-white/[0.08] dark:bg-black/10 dark:text-zinc-100 dark:placeholder:text-zinc-500 font-mono-token disabled:cursor-not-allowed disabled:opacity-70 ${usesFluentUI ? "rounded-[7px]" : "rounded-[10px]"}`}
              />

              <label className="flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-700 dark:text-zinc-300" title="允许连续生成自动分配到此 API">
                <input
                  type="checkbox"
                  checked={slot.continuousPoolEnabled}
                  onChange={(event) => patchSlot(index, { continuousPoolEnabled: event.target.checked })}
                  readOnly
                  disabled
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                />
                <span className="truncate">入池</span>
              </label>

              <label className="min-w-0 text-[10px] text-zinc-500 dark:text-zinc-400">
                <span className="mb-0.5 block text-center">最大并发</span>
                <input
                  type="number"
                  min={FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT}
                  max={FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT}
                  step={1}
                  value={FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT}
                  onChange={() => undefined}
                  readOnly
                  disabled
                  title="单个 FHL Images API 最大并发为 5；工作台的每 API 并发设置控制实际运行值"
                  className={`focus-ring w-full min-w-0 border border-black/[0.08] bg-white/80 px-2 py-2 text-center text-[12px] text-zinc-900 dark:border-white/[0.08] dark:bg-black/10 dark:text-zinc-100 font-mono-token disabled:cursor-not-allowed disabled:opacity-70 ${usesFluentUI ? "rounded-[7px]" : "rounded-[10px]"}`}
                />
              </label>

              <button
                type="button"
                onClick={() => void handleDelete(index)}
                disabled={!profile || isSaving}
                title={profile ? `删除 API ${slotNumber}` : "空槽无需删除"}
                aria-label={profile ? `删除 API ${slotNumber}` : "空槽无需删除"}
                className={`inline-flex h-8 w-8 items-center justify-center text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-35 dark:hover:bg-red-400/10 dark:hover:text-red-300 ${usesFluentUI ? "rounded-[7px]" : "rounded-[10px]"}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => void handleTest(index)}
                disabled={(!profile && !slot.apiKey.trim()) || isSaving || isTestingKey}
                title={profile ? `测试 API ${slotNumber}` : slot.apiKey.trim() ? `保存并测试 API ${slotNumber}` : "先填写 API 后再测试"}
                aria-label={profile ? `测试 API ${slotNumber}` : slot.apiKey.trim() ? `保存并测试 API ${slotNumber}` : "先填写 API 后再测试"}
                className={`inline-flex h-8 w-8 items-center justify-center text-zinc-500 transition-colors hover:bg-sky-50 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-35 dark:hover:bg-sky-400/10 dark:hover:text-sky-300 ${usesFluentUI ? "rounded-[7px]" : "rounded-[10px]"}`}
              >
                {testingSlotIndex === index || slotConnectionResult?.status === "testing" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <TestTube2 className="h-4 w-4" />}
              </button>
            </div>
          );
        })}
      </div>

      <label className="flex min-w-0 flex-wrap items-center justify-between gap-2 border border-black/[0.08] bg-[var(--surface)]/55 px-3 py-2 text-[11px] text-zinc-600 dark:border-white/[0.08] dark:text-zinc-300">
        <span>当前普通生成 API</span>
        <select
          value={mappedProfiles.some((profile) => profile?.id === activeProfileId) ? activeProfileId : ""}
          onChange={(event) => {
            const profile = mappedProfiles.find((item) => item?.id === event.target.value);
            if (profile) void handleSetActive(profile);
          }}
          disabled={isSaving || isTestingKey}
          title={`普通单次生成和侧栏测试使用此 API；当前接口为 ${transportLabel}，连续单图固定使用第一个已启用 API，批量图生图按入池设置调度`}
          className={`focus-ring min-w-[180px] border border-black/[0.08] bg-white/80 px-2 py-1.5 text-[12px] text-zinc-900 dark:border-white/[0.08] dark:bg-black/10 dark:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 ${usesFluentUI ? "rounded-[7px]" : "rounded-[10px]"}`}
        >
          <option value="">当前不是 FHL API 槽</option>
          {mappedProfiles.map((profile, index) => profile ? (
            <option key={profile.id} value={profile.id}>API {index + 1} · {transportLabel}</option>
          ) : null)}
        </select>
      </label>

      <div className="flex items-start gap-2 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
        <span>共享设置：{FHL_BASE_URL} · {FHL_IMAGE_MODEL_ID} · OpenAI 标准兼容。</span>
      </div>

      {errorMessage ? (
        <div className={`flex items-start gap-2 border border-red-300/70 bg-red-50 px-3 py-2 text-[12px] text-red-950 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}>
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">{errorMessage}</span>
        </div>
      ) : null}

      {successMessage ? (
        <div className={`flex items-start gap-2 border border-emerald-300/70 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-950 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}>
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        {onOpenAdvanced ? (
          <button
            type="button"
            onClick={onOpenAdvanced}
            disabled={isSaving}
            className={`platform-action-btn inline-flex h-9 items-center gap-1.5 border border-black/[0.08] px-3 text-[12px] text-zinc-700 transition-colors hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-55 dark:border-white/[0.08] dark:text-zinc-300 dark:hover:bg-white/[0.06] ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
          >
            <Settings2 className="h-3.5 w-3.5" />
            选择当前 API / 高级配置
          </button>
        ) : null}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className={`platform-action-btn h-9 border border-black/[0.08] px-3 text-[12px] text-zinc-700 transition-colors hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-55 dark:border-white/[0.08] dark:text-zinc-300 dark:hover:bg-white/[0.06] ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
          >
            关闭
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={isSaving}
          className={`liquid-primary-button inline-flex h-9 items-center gap-1.5 bg-[var(--accent)] px-3 text-[12px] font-medium text-white transition-colors hover:bg-[var(--accent-2)] disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-600 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
        >
          <Save className="h-3.5 w-3.5" />
          {isSaving ? "Images 池保存/测试中" : "保存并测试 Images 池"}
        </button>
      </div>
    </section>
  );
}
