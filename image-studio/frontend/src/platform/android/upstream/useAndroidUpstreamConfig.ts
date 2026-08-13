import { useEffect, useMemo, useState } from "react";
import { ensureAPIMartAsyncProfile, focusAPIMartAPIKeyInput } from "../../../lib/apimartAPI";
import { ensureFHLImagesProfile, ensureFHLResponsesProfile, focusFHLAPIKeyInput } from "../../../lib/fhlAPI";
import { isOfficialFHLTextProfile, keyringUserFor } from "../../../lib/profiles";
import { useStudioStore } from "../../../state/studioStore";
import type { APIMode, RequestPolicy, UpstreamProfile } from "../../../types/domain";
import { GetStoredAPIKey, ReadClipboardText } from "../../runtime/host";

export type AndroidUpstreamModeId = "fhl-images" | "fhl-responses" | "apimart" | "runninghub";

export const ANDROID_UPSTREAM_MODE_OPTIONS: Array<{
  id: AndroidUpstreamModeId;
  title: string;
  meta: string;
}> = [
  { id: "fhl-images", title: "FHL Images 10 槽", meta: "默认生图入口 · 每槽并发 4 · 总容量最高 40" },
  { id: "fhl-responses", title: "FHL Responses 文本", meta: "提示词优化和反推使用，独立于 Images 槽" },
  { id: "apimart", title: "一键配置 APIMart 异步", meta: "推荐异步 task_id 参数 / 不内置 API Key" },
  { id: "runninghub", title: "一键配置 RH", meta: "桥接 8117 / banana2 + image_g2 / 安卓端不写 RH Key" },
];

export const ANDROID_API_MODE_OPTIONS: Array<{
  id: APIMode;
  title: string;
  meta: string;
}> = [
  { id: "responses", title: "Responses API", meta: "SSE 保活" },
  { id: "images", title: "Images API", meta: "标准图像端点" },
  { id: "apimart", title: "APIMart 异步", meta: "task_id 异步轮询" },
  { id: "runninghub", title: "RunningHub", meta: "本地桥接，文生图 / 图生图" },
];

export const ANDROID_REQUEST_POLICY_OPTIONS: Array<{
  id: RequestPolicy;
  title: string;
  meta: string;
}> = [
  { id: "openai", title: "OpenAI 标准", meta: "只发送公开字段" },
  { id: "compat", title: "兼容中转扩展", meta: "允许中转扩展字段" },
];

export function useAndroidUpstreamConfig(open: boolean) {
  const {
    profiles,
    activeProfileId,
    createProfile,
    updateProfile,
    deleteProfile,
    duplicateProfile,
    setActiveProfile,
    testProfileConnection,
    isTestingKey,
    pushToast,
  } = useStudioStore();

  const [selectedId, setSelectedId] = useState(activeProfileId);
  const [draft, setDraft] = useState<UpstreamProfile | null>(null);
  const [draftKey, setDraftKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [savedKeyLoaded, setSavedKeyLoaded] = useState(false);
  const [savedKeyPresent, setSavedKeyPresent] = useState(false);
  const [saving, setSaving] = useState(false);

  function loadKeyForProfile(profileId: string) {
    let cancelled = false;
    setDraftKey("");
    setShowKey(false);
    setSavedKeyLoaded(false);
    setSavedKeyPresent(false);

    GetStoredAPIKey(keyringUserFor(profileId))
      .then((key) => {
        if (cancelled) return;
        setSavedKeyPresent(!!key?.trim());
        setSavedKeyLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setSavedKeyLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }

  function selectProfileForEditing(profileId: string) {
    const nextProfile = useStudioStore.getState().profiles.find((profile) => profile.id === profileId) ?? null;
    setSelectedId(profileId);
    setDraft(nextProfile ? { ...nextProfile } : null);
    if (nextProfile) {
      loadKeyForProfile(nextProfile.id);
    } else {
      setDraftKey("");
      setShowKey(false);
      setSavedKeyLoaded(true);
      setSavedKeyPresent(false);
    }
  }

  useEffect(() => {
    if (!open) return undefined;
    const nextSelectedId = selectedId && profiles.some((profile) => profile.id === selectedId)
      ? selectedId
      : activeProfileId || profiles[0]?.id || "";

    if (nextSelectedId !== selectedId) {
      setSelectedId(nextSelectedId);
      return undefined;
    }

    const selected = profiles.find((profile) => profile.id === nextSelectedId) ?? null;
    setDraft(selected ? { ...selected } : null);
    setDraftKey("");
    setShowKey(false);
    setSavedKeyLoaded(false);
    setSavedKeyPresent(false);

    if (!selected) {
      setSavedKeyLoaded(true);
      return undefined;
    }

    return loadKeyForProfile(selected.id);
  }, [activeProfileId, open, profiles, selectedId]);

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) ?? null,
    [activeProfileId, profiles],
  );

  const baseURLError = useMemo(() => null, [draft]);

  const canSave = !!draft
    && !!draft.name.trim()
    && !!draft.baseURL.trim()
    && (draft.apiMode === "runninghub" || !!draftKey.trim() || savedKeyPresent)
    && savedKeyLoaded
    && !saving;

  function patchDraft(patch: Partial<UpstreamProfile>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  async function handleNew(apiMode: APIMode = "images") {
    const id = await createProfile({
      apiMode,
      requestPolicy: "openai",
      setActive: profiles.length === 0,
    });
    selectProfileForEditing(id);
  }

  async function handleUseExistingFHLAPI(apiMode: "responses" | "images" = "images") {
    const id = apiMode === "images"
      ? await ensureFHLImagesProfile(useStudioStore.getState())
      : await ensureFHLResponsesProfile(useStudioStore.getState(), { setActive: false });
    selectProfileForEditing(id);
    pushToast(
      apiMode === "images"
        ? "FHL Images profile ready. Paste your API key to test."
        : "FHL Responses profile ready. Paste your API key to test.",
      "success",
      4200,
    );
    focusFHLAPIKeyInput();
  }

  async function handleUseExistingAPIMartAPI() {
    const id = await ensureAPIMartAsyncProfile(useStudioStore.getState());
    selectProfileForEditing(id);
    pushToast("APIMart async profile ready. Paste your API key to test.", "success", 4600);
    focusAPIMartAPIKeyInput();
  }

  async function handleDuplicate() {
    if (!selectedId) return;
    const id = await duplicateProfile(selectedId);
    if (id) {
      selectProfileForEditing(id);
      pushToast("Profile duplicated.", "success");
    }
  }

  async function handleDelete() {
    if (!draft) return;
    if (!window.confirm(`Delete "${draft.name}" and its stored API key?`)) return;
    await deleteProfile(draft.id);
    const remaining = useStudioStore.getState().profiles;
    setSelectedId(remaining[0]?.id ?? "");
    pushToast("Profile deleted.", "success");
  }

  async function handleSave() {
    if (!draft || !canSave) return false;
    setSaving(true);
    try {
      const nextKey = draftKey.trim();
      const ok = await updateProfile(draft.id, {
        name: draft.name,
        apiMode: draft.apiMode,
        requestPolicy: draft.requestPolicy,
        baseURL: draft.baseURL,
        textModelID: draft.textModelID,
        imageModelID: draft.imageModelID,
        concurrencyLimit: draft.concurrencyLimit,
        imagesNewAPICompat: draft.apiMode === "images" && draft.imagesNewAPICompat === true,
        ...(draft.apiMode !== "runninghub" && nextKey ? { apiKey: nextKey } : {}),
      });
      if (ok) {
        if (nextKey) setSavedKeyPresent(true);
        setDraftKey("");
        pushToast("Profile saved.", "success");
      }
      return ok;
    } finally {
      setSaving(false);
    }
  }

  async function handleSetActive() {
    if (!draft) return;
    if (isOfficialFHLTextProfile(draft)) {
      pushToast("该配置仅供提示词优化和图片反推使用，不能设为当前生图 API。", "warn", 4200);
      return;
    }
    await setActiveProfile(draft.id);
    pushToast("Active profile switched.", "success");
  }

  async function handleSaveAndSetActive(onSaved?: () => void) {
    if (!draft) return;
    const draftId = draft.id;
    const saved = await handleSave();
    if (saved && !isOfficialFHLTextProfile(draft) && draftId !== activeProfileId) {
      await setActiveProfile(draftId);
    }
    if (saved) onSaved?.();
  }

  async function handleSaveAndTest(onSaved?: () => void) {
    const saved = await handleSave();
    if (!saved || !draft) return;
    onSaved?.();
    setTimeout(() => { void testProfileConnection(draft.id); }, 0);
  }

  async function handlePasteKey() {
    try {
      const text = await ReadClipboardText();
      if (!text.trim()) {
        pushToast("剪贴板里没有文本", "warn");
        return;
      }
      setDraftKey(text.trim());
    } catch (error: any) {
      pushToast(`读取剪贴板失败：${error?.message ?? error}`, "error", 5000);
    }
  }

  return {
    activeProfile,
    activeProfileId,
    baseURLError,
    canSave,
    draft,
    draftKey,
    handleDelete,
    handleDuplicate,
    handleNew,
    handleSave,
    handleSaveAndSetActive,
    handleSaveAndTest,
    handlePasteKey,
    handleSetActive,
    handleUseExistingAPIMartAPI,
    handleUseExistingFHLAPI,
    isTestingKey,
    openProfileForEditing: selectProfileForEditing,
    patchDraft,
    profiles,
    savedKeyLoaded,
    savedKeyPresent,
    saving,
    selectedId,
    setDraftKey,
    setSelectedId,
    setShowKey,
    showKey,
  };
}
