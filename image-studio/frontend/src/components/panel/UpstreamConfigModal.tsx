import { useState, useEffect, useMemo } from "react";
import { Info, Plus, Sparkles } from "lucide-react";
import { Modal } from "../common/Modal";
import { useStudioStore } from "../../state/studioStore";
import { GetStoredAPIKey } from "../../platform/runtime/host";
import { normalizeAPIKeyInput, validateAPIKeyForHeader } from "../../lib/apiKey";
import { ensureAPIMartProfile, focusAPIMartAPIKeyInput } from "../../lib/apimartAPI";
import {
  apiModeUsesBridgeStoredKey,
  hasUpstreamProfileCapacity,
  keyringUserFor,
  MAX_UPSTREAM_PROFILES,
  upstreamProfileLimitMessage,
} from "../../lib/profiles";
import type { APIMode, RequestPolicy, UpstreamProfile } from "../../types/domain";
import { FAQModal } from "./FAQModal";
import { APIMartAPIChoiceModal } from "./APIMartAPIChoiceModal";
import { RunningHubAPIChoiceModal } from "./RunningHubAPIChoiceModal";
import { FHLImagesPoolConfig } from "./FHLImagesPoolConfig";
import { FHLDesktopAPIConfig } from "./FHLDesktopAPIConfig";
import { RunningHubQuickConfigModal } from "./RunningHubQuickConfigModal";
import { UpstreamProfileEditor } from "./UpstreamProfileEditor";
import { UpstreamProfileList } from "./UpstreamProfileList";
import { usePlatform } from "../../platform/context";

// v0.1.6 多 profile 配置 modal。左侧 profile 列表 + 右侧编辑表单。
// 列表点击 = 切 active(立即生效);右侧改字段 = 编辑当前选中,点保存才落盘。
export function UpstreamConfigModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { isAndroid, isAndroidPhone, usesFluentUI, usesAppleUI } = usePlatform();
  const {
    profiles, activeProfileId,
    createProfile, updateProfile, deleteProfile, duplicateProfile, setActiveProfile,
    testAPIKey, isTestingKey,
  } = useStudioStore();

  // selected = 当前编辑的 profile id(可以跟 active 不同 —— 用户在浏览/编辑
  // 别的 profile,但还没把它设为 active)。打开 modal 默认 selected = active。
  const [selectedId, setSelectedId] = useState<string>(activeProfileId);
  // 当前 selected 的草稿副本,改完字段后调 updateProfile 才生效
  const [draft, setDraft] = useState<UpstreamProfile | null>(null);
  const [draftKey, setDraftKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [savedKeyLoaded, setSavedKeyLoaded] = useState(false);
  const [savedKeyAvailable, setSavedKeyAvailable] = useState(false);
  const [faqOpen, setFaqOpen] = useState(false);
  const [configView, setConfigView] = useState<"pool" | "advanced">("pool");
  const [apimartChoiceOpen, setAPIMartChoiceOpen] = useState(false);
  const [runningHubChoiceOpen, setRunningHubChoiceOpen] = useState(false);
  const [runningHubQuickConfigOpen, setRunningHubQuickConfigOpen] = useState(false);

  // 打开 modal / 切 selected → 重新加载草稿与 keyring 里的 apiKey
  useEffect(() => {
    if (!open || configView !== "advanced") return;
    const sid = selectedId && profiles.some((p) => p.id === selectedId)
      ? selectedId
      : (activeProfileId || profiles[0]?.id || "");
    setSelectedId(sid);
    const p = profiles.find((x) => x.id === sid) ?? null;
    setDraft(p);
    setDraftKey("");
    setSavedKeyAvailable(false);
    setSavedKeyLoaded(false);
    if (p) {
      GetStoredAPIKey(keyringUserFor(p.id))
        .then((storedKey) => {
          const activeKeyFallback = p.id === useStudioStore.getState().activeProfileId
            ? useStudioStore.getState().apiKey
            : "";
          setSavedKeyAvailable(!!normalizeAPIKeyInput(storedKey || activeKeyFallback));
          setDraftKey("");
          setSavedKeyLoaded(true);
        })
        .catch(() => {
          const activeKeyFallback = p.id === useStudioStore.getState().activeProfileId
            ? useStudioStore.getState().apiKey
            : "";
          setSavedKeyAvailable(!!normalizeAPIKeyInput(activeKeyFallback));
          setSavedKeyLoaded(true);
        });
    } else {
      setSavedKeyAvailable(false);
      setSavedKeyLoaded(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedId, profiles.length, configView]);

  useEffect(() => {
    if (!open) {
      setConfigView("pool");
      return;
    }
    setConfigView("pool");
  }, [open]);

  // 列表切换 selected
  function selectProfile(id: string) {
    if (id === selectedId) return;
    setSelectedId(id);
  }

  const baseURLError = useMemo(() => null, [draft?.baseURL]);

  const normalizedDraftKey = useMemo(() => normalizeAPIKeyInput(draftKey), [draftKey]);
  const draftUsesBridgeStoredKey = !!draft && apiModeUsesBridgeStoredKey(draft.apiMode);
  const apiKeyError = useMemo(() => {
    if (draftUsesBridgeStoredKey) return null;
    if (!draftKey.trim()) return null;
    try {
      validateAPIKeyForHeader(draftKey);
      return null;
    } catch (error: any) {
      return error?.message ?? "API Key 格式不正确";
    }
  }, [draftKey, draftUsesBridgeStoredKey]);
  const canSave = !!draft
    && !!draft.baseURL.trim()
    && !apiKeyError
    && (draftUsesBridgeStoredKey || !!normalizedDraftKey || (savedKeyLoaded && savedKeyAvailable));

  function patchDraft(patch: Partial<UpstreamProfile>) {
    if (!draft) return;
    setDraft({ ...draft, ...patch });
  }

  async function handleNew(apiMode: APIMode = "images") {
    try {
      const id = await createProfile({
        apiMode,
        requestPolicy: "openai",
        setActive: profiles.length === 0, // 第一个自动 active,后续手动切
      });
      setSelectedId(id);
    } catch (error: any) {
      window.alert(error?.message ?? upstreamProfileLimitMessage());
    }
  }

  function handleConfigureFHL() {
    setConfigView("pool");
  }

  function refreshSavedKeyState(id: string) {
    setSavedKeyAvailable(false);
    setSavedKeyLoaded(false);
    GetStoredAPIKey(keyringUserFor(id))
      .then((storedKey) => {
        const activeKeyFallback = id === useStudioStore.getState().activeProfileId
          ? useStudioStore.getState().apiKey
          : "";
        setSavedKeyAvailable(!!normalizeAPIKeyInput(storedKey || activeKeyFallback));
        setDraftKey("");
        setSavedKeyLoaded(true);
      })
      .catch(() => {
        const activeKeyFallback = id === useStudioStore.getState().activeProfileId
          ? useStudioStore.getState().apiKey
          : "";
        setSavedKeyAvailable(!!normalizeAPIKeyInput(activeKeyFallback));
        setSavedKeyLoaded(true);
      });
  }

  async function handleConfigureAPIMart() {
    setAPIMartChoiceOpen(false);
    try {
      const store = useStudioStore.getState();
      const id = await ensureAPIMartProfile(store);
      const nextProfile = useStudioStore.getState().profiles.find((profile) => profile.id === id) ?? null;
      setSelectedId(id);
      setDraft(nextProfile);
      refreshSavedKeyState(id);
      focusAPIMartAPIKeyInput();
    } catch (error: any) {
      window.alert(error?.message ?? upstreamProfileLimitMessage());
    }
  }

  function handleConfigureRunningHub() {
    setRunningHubChoiceOpen(true);
  }

  function handleUseExistingRunningHubAPI() {
    setRunningHubChoiceOpen(false);
    setRunningHubQuickConfigOpen(true);
  }

  async function handleDuplicate() {
    if (!selectedId) return;
    const newId = await duplicateProfile(selectedId);
    if (newId) setSelectedId(newId);
    else if (!hasUpstreamProfileCapacity(useStudioStore.getState().profiles)) window.alert(upstreamProfileLimitMessage());
  }

  async function handleDelete() {
    if (!draft) return;
    if (!window.confirm(`确认删除「${draft.name}」配置?对应的 API Key 也会从系统凭据存储清除。`)) return;
    const deletingId = draft.id;
    const deleted = await deleteProfile(deletingId);
    if (!deleted) {
      window.alert("该配置仍有排队或运行中的任务，等待任务结束后再删除。");
      return;
    }
    // 删完 selected:切到第一个剩余(action 内部已经更新 active);UI 跟着
    const remaining = useStudioStore.getState().profiles;
    setSelectedId(remaining[0]?.id ?? "");
  }

  async function handleSave(): Promise<boolean> {
    if (!draft) return false;
    const usesBridgeStoredKey = apiModeUsesBridgeStoredKey(draft.apiMode);
    const updatePatch: Partial<Omit<UpstreamProfile, "id" | "createdAt">> & { apiKey?: string } = {
      name: draft.name,
      apiMode: draft.apiMode,
      requestPolicy: usesBridgeStoredKey ? "openai" : draft.requestPolicy,
      baseURL: draft.baseURL,
      textModelID: usesBridgeStoredKey ? "" : draft.textModelID,
      imageModelID: draft.imageModelID,
      concurrencyLimit: draft.concurrencyLimit,
      continuousPoolEnabled: draft.apiMode === "images" && draft.continuousPoolEnabled === true,
      imagesNewAPICompat: draft.apiMode === "images" && draft.imagesNewAPICompat === true,
    };
    if (!usesBridgeStoredKey && draftKey.trim()) {
      let cleanedAPIKey = "";
      try {
        cleanedAPIKey = validateAPIKeyForHeader(draftKey);
      } catch (error: any) {
        window.alert(error?.message ?? "API Key 格式不正确");
        return false;
      }
      if (cleanedAPIKey !== draftKey) setDraftKey(cleanedAPIKey);
      updatePatch.apiKey = cleanedAPIKey;
    } else if (!usesBridgeStoredKey && !savedKeyAvailable) {
      window.alert("请先填写 API Key");
      return false;
    }
    await updateProfile(draft.id, updatePatch);
    // 如果当前 selected 不是 active,问要不要切;不弹了,直接什么都不做
    return true;
  }

  async function handleSetActive() {
    if (!draft) return;
    await setActiveProfile(draft.id);
  }

  async function handleTest() {
    if (!draft || !canSave) return;
    // 先保存,再测;testAPIKey 读 active profile 的字段,所以要让它先切到 selected
    const saved = await handleSave();
    if (!saved) return;
    if (draft.id !== activeProfileId) {
      await setActiveProfile(draft.id);
    }
    onClose();
    setTimeout(() => { void testAPIKey(); }, 0);
  }

  if (configView === "pool") {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="上游配置"
        width={920}
        cardClassName="upstream-config-modal"
        bodyClassName="upstream-config-modal-body"
      >
        {isAndroid ? (
          <FHLImagesPoolConfig
            active={open}
            onClose={onClose}
            onOpenAdvanced={() => setConfigView("advanced")}
          />
        ) : (
          <FHLDesktopAPIConfig
            active={open}
            onClose={onClose}
            onOpenAdvanced={() => setConfigView("advanced")}
          />
        )}
      </Modal>
    );
  }

  if (profiles.length === 0) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="上游配置"
        width={760}
        cardClassName="upstream-config-modal"
        bodyClassName="upstream-config-modal-body"
      >
        <section className={`flex flex-col ${isAndroidPhone ? "gap-4" : "gap-5"}`}>
          <div className={`border border-black/[0.06] bg-[var(--surface)]/70 dark:border-white/[0.06] dark:bg-white/[0.03] ${isAndroidPhone ? "rounded-[20px] px-4 py-4" : "rounded-[22px] px-5 py-5"}`}>
            <div className="flex items-start gap-3">
              <div className={`flex shrink-0 items-center justify-center border border-[color:var(--accent)]/18 bg-[var(--accent-soft)] ${isAndroidPhone ? "h-11 w-11 rounded-[14px]" : "h-12 w-12 rounded-[16px]"}`}>
                <Sparkles className="h-5 w-5 text-[var(--accent)]" />
              </div>
              <div className="min-w-0">
                <h4 className={`text-zinc-900 dark:text-zinc-100 ${isAndroidPhone ? "text-[17px] font-semibold" : "text-[18px] font-semibold"}`}>先连上一个可用上游</h4>
                <p className={`mt-1 text-zinc-500 dark:text-zinc-400 ${isAndroidPhone ? "text-[13px] leading-6" : "text-sm leading-6"}`}>
                  先保存一条可用的 API 中转配置，后面所有生成、编辑、提示词优化都会走这里。
                </p>
              </div>
            </div>
          </div>

          <div className={`grid gap-2 ${isAndroidPhone ? "grid-cols-1" : "grid-cols-2"}`}>
            {([
              {
                id: "responses" as APIMode,
                title: "Responses API",
                sub: "首选。支持 SSE 保活，长任务更稳。",
                note: "适合 GPT 图像链路和提示词优化。",
              },
              {
                id: "images" as APIMode,
                title: "Images API",
                sub: "兼容性更广，接标准 generations / edits。",
                note: "适合只想尽快接上常规生图接口。",
              },
              {
                id: "runninghub" as APIMode,
                title: "RunningHub 桥接",
                sub: "本地 8117 桥接，支持文生图和图生图。",
                note: "适合复用 RunningHub PHP 模块与双模型配置。",
              },
              {
                id: "apimart" as APIMode,
                title: "APIMart 异步",
                sub: "提交 task_id 后轮询结果,长任务更稳。",
                note: "适合按示例模块接入 api.apimart.ai。",
              },
            ]).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNew(item.id)}
                className={`platform-card flex flex-col items-start gap-2 border border-black/[0.08] bg-white/70 p-4 text-left transition-colors hover:border-[color:var(--accent)]/35 hover:bg-[var(--accent-soft)]/60 dark:border-white/[0.06] dark:bg-white/[0.03] ${usesFluentUI ? "rounded-[10px]" : "rounded-[18px]"}`}
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 min-w-[32px] items-center justify-center rounded-full bg-[var(--accent-soft)] px-2 text-[11px] font-semibold text-[var(--accent)]">
                    {item.id === "responses" ? "R" : item.id === "apimart" ? "A" : item.id === "runninghub" ? "RH" : "I"}
                  </span>
                  <span className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-100">{item.title}</span>
                </div>
                <p className="text-[12px] leading-5 text-zinc-600 dark:text-zinc-300">{item.sub}</p>
                <p className="text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">{item.note}</p>
                <span className={`mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent)] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}>
                  <Plus className="h-3 w-3" /> 新建这类配置
                </span>
              </button>
            ))}
          </div>

          <div className={`flex items-start gap-2 border border-[color:var(--accent)]/18 bg-[var(--accent-soft)] px-3 py-2 text-[11px] text-[var(--accent)] ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>保存后会写入系统凭据存储。之后你可以在这里继续新增多个上游配置，再按场景切换。</span>
          </div>
          <div className={`flex items-start gap-2 border border-violet-300/70 bg-violet-50 px-3 py-2 text-violet-950 shadow-sm dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold tracking-[0]">RH 一键配置</div>
              <div className="mt-0.5 text-[11px] leading-5 opacity-85">桥接地址默认 `http://127.0.0.1:8117`，可直接写入或复用桥接模块里的 RunningHub API Key。</div>
            </div>
            <button
              type="button"
              onClick={handleConfigureRunningHub}
              className={`ml-auto inline-flex h-9 shrink-0 items-center gap-1.5 border border-violet-500/60 bg-violet-400 px-3 text-[13px] font-bold tracking-[0] text-zinc-950 shadow-sm transition-colors hover:bg-violet-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
            >
              <Sparkles className="h-4 w-4" />
              一键配置 RH
            </button>
          </div>
        </section>
      </Modal>
    );
  }

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      title="上游配置"
      width={760}
      cardClassName="upstream-config-modal"
      bodyClassName="upstream-config-modal-body"
    >
      <div className={`flex min-w-0 gap-4 ${isAndroidPhone ? "flex-col" : ""}`}>
        <UpstreamProfileList
          profiles={profiles}
          selectedId={selectedId}
          activeProfileId={activeProfileId}
          draftId={draft?.id}
          isAndroidPhone={isAndroidPhone}
          profileLimit={MAX_UPSTREAM_PROFILES}
          canCreateProfile={hasUpstreamProfileCapacity(profiles)}
          onSelectProfile={selectProfile}
          onHandleNew={() => handleNew()}
          onHandleDuplicate={handleDuplicate}
          onHandleDelete={handleDelete}
          onHandleSetActive={handleSetActive}
        />

        {/* ---------------- 右侧编辑表单 ---------------- */}
        <section className="flex-1 min-w-0">
          <div className={`mb-3 border border-amber-300/70 bg-amber-50 px-3 py-2 text-amber-900 shadow-sm dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold tracking-[0]">FHL Images 连续池</div>
                <div className="mt-0.5 text-[11px] leading-5 opacity-85">最多 10 个独立 Images API · gpt-image-2</div>
                <div className="mt-0.5 text-[11px] leading-5 font-semibold text-red-600 dark:text-red-300">每个非空槽独立保存，不会自动创建 Responses 配置。</div>
              </div>
              <button
                type="button"
                onClick={handleConfigureFHL}
                className={`inline-flex h-9 shrink-0 items-center gap-1.5 border border-amber-500/60 bg-amber-400 px-3 text-[13px] font-bold tracking-[0] text-zinc-950 shadow-sm transition-colors hover:bg-amber-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
              >
                <Sparkles className="h-4 w-4" />
                管理 Images 池
              </button>
            </div>
          </div>
          <div className={`mb-3 border border-violet-300/70 bg-violet-50 px-3 py-2 text-violet-950 shadow-sm dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold tracking-[0]">RH 桥接配置</div>
                <div className="mt-0.5 text-[11px] leading-5 opacity-85">本地桥接 · 默认 `http://127.0.0.1:8117` · banana2 / image_g2</div>
                <div className="mt-0.5 text-[11px] leading-5 font-semibold">Key 保存在桥接模块，不走当前桌面版的本地 keyring。</div>
              </div>
              <button
                type="button"
                onClick={handleConfigureRunningHub}
                className={`ml-auto inline-flex h-9 shrink-0 items-center gap-1.5 border border-violet-500/60 bg-violet-400 px-3 text-[13px] font-bold tracking-[0] text-zinc-950 shadow-sm transition-colors hover:bg-violet-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
              >
                <Sparkles className="h-4 w-4" />
                一键配置 RH
              </button>
            </div>
          </div>
          <div className={`mb-3 border border-sky-300/70 bg-sky-50 px-3 py-2 text-sky-950 shadow-sm dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold tracking-[0]">APIMart 异步配置</div>
                <div className="mt-0.5 text-[11px] leading-5 opacity-85">Async API · gpt-image-2 · api.apimart.ai</div>
                <div className="mt-0.5 text-[11px] leading-5 font-semibold text-red-600 dark:text-red-300">不包含 API Key，请粘贴自己的 APIMart API Key。</div>
              </div>
              <button
                type="button"
                onClick={() => setAPIMartChoiceOpen(true)}
                className={`inline-flex h-9 shrink-0 items-center gap-1.5 border border-sky-500/60 bg-sky-400 px-3 text-[13px] font-bold tracking-[0] text-zinc-950 shadow-sm transition-colors hover:bg-sky-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
              >
                <Sparkles className="h-4 w-4" />
                一键配置 APIMart
              </button>
            </div>
          </div>

          {!draft ? (
            <div className="grid h-full place-items-center py-10 text-sm text-zinc-500">
              在左侧选一个配置,或新建一个。
            </div>
          ) : (
            <UpstreamProfileEditor
              draft={draft}
              draftKey={draftKey}
              showKey={showKey}
              savedKeyLoaded={savedKeyLoaded}
              savedKeyAvailable={savedKeyAvailable}
              baseURLError={baseURLError}
              apiKeyError={apiKeyError}
              canSave={canSave}
              isTestingKey={isTestingKey}
              usesAppleUI={usesAppleUI}
              onOpenFAQ={() => setFaqOpen(true)}
              onPatchDraft={patchDraft}
              onChangeDraftKey={setDraftKey}
              onToggleShowKey={() => setShowKey((v) => !v)}
              onTest={handleTest}
              onClose={onClose}
              onSaveAndClose={async () => { if (await handleSave()) onClose(); }}
            />
          )}
        </section>
      </div>
    </Modal>
    <APIMartAPIChoiceModal
      open={apimartChoiceOpen}
      onClose={() => setAPIMartChoiceOpen(false)}
      onUseExistingAPI={handleConfigureAPIMart}
    />
    <RunningHubAPIChoiceModal
      open={runningHubChoiceOpen}
      onClose={() => setRunningHubChoiceOpen(false)}
      onUseExistingAPI={handleUseExistingRunningHubAPI}
    />
    <RunningHubQuickConfigModal
      open={runningHubQuickConfigOpen}
      onClose={() => setRunningHubQuickConfigOpen(false)}
      onOpenUpstream={(banana2Id) => {
        const nextProfile = useStudioStore.getState().profiles.find((profile) => profile.id === banana2Id) ?? null;
        setSelectedId(banana2Id);
        setDraft(nextProfile);
        refreshSavedKeyState(banana2Id);
        setRunningHubQuickConfigOpen(false);
      }}
    />
    <FAQModal open={faqOpen} onClose={() => setFaqOpen(false)} />
    </>
  );
}
