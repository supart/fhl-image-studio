import { useState, useEffect, useMemo } from "react";
import { Eye, EyeOff, HelpCircle, Info, Plug, Plus, Sparkles } from "lucide-react";
import { Modal } from "../common/Modal";
import { useStudioStore } from "../../state/studioStore";
import { GetStoredAPIKey } from "../../platform/runtime/host";
import { normalizeAPIKeyInput, validateAPIKeyForHeader } from "../../lib/apiKey";
import { ensureFHLResponsesProfile, focusFHLAPIKeyInput } from "../../lib/fhlAPI";
import { keyringUserFor, requestPolicyLabel } from "../../lib/profiles";
import type { APIMode, RequestPolicy, UpstreamProfile } from "../../types/domain";
import { FAQModal } from "./FAQModal";
import { FHLAPIChoiceModal } from "./FHLAPIChoiceModal";
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
  const { isAndroidPhone, usesFluentUI, usesAppleUI } = usePlatform();
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
  const [faqOpen, setFaqOpen] = useState(false);
  const [fhlChoiceOpen, setFHLChoiceOpen] = useState(false);

  // 打开 modal / 切 selected → 重新加载草稿与 keyring 里的 apiKey
  useEffect(() => {
    if (!open) return;
    const sid = selectedId && profiles.some((p) => p.id === selectedId)
      ? selectedId
      : (activeProfileId || profiles[0]?.id || "");
    setSelectedId(sid);
    const p = profiles.find((x) => x.id === sid) ?? null;
    setDraft(p);
    setDraftKey("");
    setSavedKeyLoaded(false);
    if (p) {
      GetStoredAPIKey(keyringUserFor(p.id))
        .then(() => { setDraftKey(""); setSavedKeyLoaded(true); })
        .catch(() => setSavedKeyLoaded(true));
    } else {
      setSavedKeyLoaded(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedId, profiles.length]);

  // 列表切换 selected
  function selectProfile(id: string) {
    if (id === selectedId) return;
    setSelectedId(id);
  }

  const baseURLError = useMemo(() => null, [draft?.baseURL]);

  const normalizedDraftKey = useMemo(() => normalizeAPIKeyInput(draftKey), [draftKey]);
  const apiKeyError = useMemo(() => {
    if (!draftKey.trim()) return null;
    try {
      validateAPIKeyForHeader(draftKey);
      return null;
    } catch (error: any) {
      return error?.message ?? "API Key 格式不正确";
    }
  }, [draftKey]);
  const canSave = !!draft && !!draft.baseURL.trim() && !!normalizedDraftKey && !apiKeyError;

  function patchDraft(patch: Partial<UpstreamProfile>) {
    if (!draft) return;
    setDraft({ ...draft, ...patch });
  }

  async function handleNew(apiMode: APIMode = "responses") {
    const id = await createProfile({
      apiMode,
      requestPolicy: "openai",
      setActive: profiles.length === 0, // 第一个自动 active,后续手动切
    });
    setSelectedId(id);
  }

  function handleConfigureFHL() {
    setFHLChoiceOpen(true);
  }

  async function handleUseExistingFHLAPI() {
    setFHLChoiceOpen(false);
    const store = useStudioStore.getState();
    const id = await ensureFHLResponsesProfile(store);
    const nextProfile = useStudioStore.getState().profiles.find((profile) => profile.id === id) ?? null;
    setSelectedId(id);
    setDraft(nextProfile);
    setSavedKeyLoaded(false);
    GetStoredAPIKey(keyringUserFor(id))
      .then(() => { setDraftKey(""); setSavedKeyLoaded(true); })
      .catch(() => setSavedKeyLoaded(true));
    focusFHLAPIKeyInput();
  }

  async function handleDuplicate() {
    if (!selectedId) return;
    const newId = await duplicateProfile(selectedId);
    if (newId) setSelectedId(newId);
  }

  async function handleDelete() {
    if (!draft) return;
    if (!window.confirm(`确认删除「${draft.name}」配置?对应的 API Key 也会从系统凭据存储清除。`)) return;
    const deletingId = draft.id;
    await deleteProfile(deletingId);
    // 删完 selected:切到第一个剩余(action 内部已经更新 active);UI 跟着
    const remaining = useStudioStore.getState().profiles;
    setSelectedId(remaining[0]?.id ?? "");
  }

  async function handleSave(): Promise<boolean> {
    if (!draft) return false;
    let cleanedAPIKey = "";
    try {
      cleanedAPIKey = validateAPIKeyForHeader(draftKey);
    } catch (error: any) {
      window.alert(error?.message ?? "API Key 格式不正确");
      return false;
    }
    if (cleanedAPIKey !== draftKey) setDraftKey(cleanedAPIKey);
    await updateProfile(draft.id, {
      name: draft.name,
      apiMode: draft.apiMode,
      requestPolicy: draft.requestPolicy,
      baseURL: draft.baseURL,
      textModelID: draft.textModelID,
      imageModelID: draft.imageModelID,
      concurrencyLimit: draft.concurrencyLimit,
      imagesNewAPICompat: draft.apiMode === "images" && draft.imagesNewAPICompat === true,
      apiKey: cleanedAPIKey,
    });
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
            ]).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNew(item.id)}
                className={`platform-card flex flex-col items-start gap-2 border border-black/[0.08] bg-white/70 p-4 text-left transition-colors hover:border-[color:var(--accent)]/35 hover:bg-[var(--accent-soft)]/60 dark:border-white/[0.06] dark:bg-white/[0.03] ${usesFluentUI ? "rounded-[10px]" : "rounded-[18px]"}`}
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 min-w-[32px] items-center justify-center rounded-full bg-[var(--accent-soft)] px-2 text-[11px] font-semibold text-[var(--accent)]">
                    {item.id === "responses" ? "R" : "I"}
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
                <div className="text-[13px] font-semibold tracking-[0]">FHL 推荐配置</div>
                <div className="mt-0.5 text-[11px] leading-5 opacity-85">Responses API · OpenAI 标准 · gpt-5.5 / gpt-image-2</div>
                <div className="mt-0.5 text-[11px] leading-5 font-semibold text-red-600 dark:text-red-300">不包含 API Key，用户需要粘贴自己的 FHL API Key。</div>
              </div>
              <button
                type="button"
                onClick={handleConfigureFHL}
                className={`inline-flex h-9 shrink-0 items-center gap-1.5 border border-amber-500/60 bg-amber-400 px-3 text-[13px] font-bold tracking-[0] text-zinc-950 shadow-sm transition-colors hover:bg-amber-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
              >
                <Sparkles className="h-4 w-4" />
                一键配置 FHL
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
    <FHLAPIChoiceModal
      open={fhlChoiceOpen}
      onClose={() => setFHLChoiceOpen(false)}
      onUseExistingAPI={handleUseExistingFHLAPI}
    />
    <FAQModal open={faqOpen} onClose={() => setFaqOpen(false)} />
    </>
  );
}
