import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import {
  FHL_TEXT_API_BASE_URL,
  FHL_TEXT_API_DEFAULT_MODEL_ID,
  FHL_TEXT_API_LEGACY_MODEL_ID,
  fetchFHLTextAPIModels,
  loadFHLTextAPIKey,
  validateFHLTextAPIKey,
  validateFHLTextAPIModelInput,
} from "../../lib/fhlTextAPI";
import { usePlatform } from "../../platform/context";
import { useStudioStore } from "../../state/studioStore";

const STATUS_LABELS = {
  unconfigured: "未配置",
  saved: "已保存，待测试",
  testing: "测试中",
  success: "配置成功",
  error: "已保存，测试失败",
} as const;

const CUSTOM_MODEL_VALUE = "";

function modelChoice(modelID: string | undefined, fetchedModels: string[] | null = null): string {
  if (modelID === FHL_TEXT_API_DEFAULT_MODEL_ID || modelID === FHL_TEXT_API_LEGACY_MODEL_ID) {
    return modelID;
  }
  if (fetchedModels && modelID) return modelID;
  return CUSTOM_MODEL_VALUE;
}

export function FHLTextAPIConfig({ active }: { active: boolean }) {
  const { usesFluentUI } = usePlatform();
  const fhlTextAPIConfigured = useStudioStore((state) => state.fhlTextAPIConfigured);
  const fhlTextAPIModelID = useStudioStore((state) => state.fhlTextAPIModelID);
  const fhlTextAPIKeyHint = useStudioStore((state) => state.fhlTextAPIKeyHint);
  const fhlTextAPITestStatus = useStudioStore((state) => state.fhlTextAPITestStatus);
  const fhlTextAPITestMessage = useStudioStore((state) => state.fhlTextAPITestMessage);
  const proxyMode = useStudioStore((state) => state.proxyMode);
  const proxyURL = useStudioStore((state) => state.proxyURL);
  const refreshFHLTextAPIConfig = useStudioStore((state) => state.refreshFHLTextAPIConfig);
  const setFHLTextAPIModelID = useStudioStore((state) => state.setFHLTextAPIModelID);
  const saveAndTestFHLTextAPI = useStudioStore((state) => state.saveAndTestFHLTextAPI);
  const deleteFHLTextAPIConfig = useStudioStore((state) => state.deleteFHLTextAPIConfig);
  const [apiKeyInput, setAPIKeyInput] = useState("");
  const [operationError, setOperationError] = useState<string | null>(null);
  const [selectedModelChoice, setSelectedModelChoice] = useState(() => modelChoice(fhlTextAPIModelID));
  const [customModelInput, setCustomModelInput] = useState(() => (
    modelChoice(fhlTextAPIModelID) === CUSTOM_MODEL_VALUE ? fhlTextAPIModelID : ""
  ));
  const [fetchedModels, setFetchedModels] = useState<string[] | null>(null);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [modelListError, setModelListError] = useState<string | null>(null);
  const [modelValidationError, setModelValidationError] = useState<string | null>(null);
  const activeModelID = fhlTextAPIModelID || FHL_TEXT_API_DEFAULT_MODEL_ID;
  const isTesting = fhlTextAPITestStatus === "testing";

  useEffect(() => {
    setAPIKeyInput("");
    setOperationError(null);
    setFetchedModels(null);
    setModelListError(null);
    if (active) void refreshFHLTextAPIConfig();
  }, [active, refreshFHLTextAPIConfig]);

  useEffect(() => {
    const choice = modelChoice(activeModelID, fetchedModels);
    setSelectedModelChoice(choice);
    if (choice === CUSTOM_MODEL_VALUE) setCustomModelInput(activeModelID);
    setModelValidationError(null);
  }, [activeModelID, fetchedModels]);

  const modelOptions = fetchedModels
    ? fetchedModels.includes(activeModelID) ? fetchedModels : [activeModelID, ...fetchedModels]
    : [FHL_TEXT_API_DEFAULT_MODEL_ID, FHL_TEXT_API_LEGACY_MODEL_ID];

  function handleModelChoiceChange(value: string) {
    setSelectedModelChoice(value);
    setOperationError(null);
    setModelValidationError(null);
    if (value === CUSTOM_MODEL_VALUE) {
      if (modelChoice(activeModelID) !== CUSTOM_MODEL_VALUE) setCustomModelInput("");
      return;
    }
    setFHLTextAPIModelID(value);
  }

  function handleCustomModelChange(value: string) {
    setCustomModelInput(value);
    setOperationError(null);
    const validation = validateFHLTextAPIModelInput(value);
    setModelValidationError(validation.valid ? null : validation.message);
    if (validation.valid) setFHLTextAPIModelID(validation.value);
  }

  async function handleFetchModels() {
    if (isFetchingModels || isTesting) return;
    setModelListError(null);
    setIsFetchingModels(true);
    try {
      const input = apiKeyInput.trim();
      const apiKey = input ? validateFHLTextAPIKey(input) : await loadFHLTextAPIKey();
      if (!apiKey) throw new Error("请先输入或保存 FHL 文本 API Key。");
      const models = await fetchFHLTextAPIModels(apiKey, { proxyMode, proxyURL });
      setFetchedModels(models);
    } catch (error: any) {
      setModelListError(error?.message ?? "获取 FHL 模型列表失败。");
    } finally {
      setIsFetchingModels(false);
    }
  }

  async function handleSaveAndTest() {
    if (isTesting) return;
    const input = apiKeyInput.trim();
    const modelValidation = validateFHLTextAPIModelInput(
      selectedModelChoice === CUSTOM_MODEL_VALUE ? customModelInput : selectedModelChoice,
    );
    if (!modelValidation.valid) {
      setModelValidationError(modelValidation.message);
      return;
    }
    let validatedInput = "";
    try {
      validatedInput = input ? validateFHLTextAPIKey(input) : "";
    } catch (error: any) {
      setOperationError(error?.message ?? "FHL 文本 API Key 格式不正确。");
      return;
    }

    setOperationError(null);
    setAPIKeyInput("");
    try {
      await saveAndTestFHLTextAPI(validatedInput, modelValidation.value);
    } catch (error: any) {
      setOperationError(error?.message ?? "保存 FHL 文本 API 失败。");
    }
  }

  async function handleDelete() {
    if (!fhlTextAPIConfigured || isTesting) return;
    if (!window.confirm("确认删除 FHL 文本 API 吗？这不会影响 10 个 Images 生图 Key。")) return;
    setOperationError(null);
    try {
      await deleteFHLTextAPIConfig();
      setAPIKeyInput("");
      setFetchedModels(null);
      setModelListError(null);
    } catch (error: any) {
      setOperationError(error?.message ?? "删除 FHL 文本 API 失败。");
    }
  }

  const statusClass = fhlTextAPITestStatus === "success"
    ? "text-emerald-700 dark:text-emerald-300"
    : fhlTextAPITestStatus === "error"
      ? "text-red-700 dark:text-red-300"
      : fhlTextAPITestStatus === "testing"
        ? "text-sky-700 dark:text-sky-300"
        : fhlTextAPITestStatus === "saved"
          ? "text-amber-700 dark:text-amber-300"
          : "text-zinc-500 dark:text-zinc-400";
  const statusIcon = fhlTextAPITestStatus === "success"
    ? <CheckCircle2 className="h-4 w-4" />
    : fhlTextAPITestStatus === "error"
      ? <AlertCircle className="h-4 w-4" />
      : fhlTextAPITestStatus === "testing"
        ? <LoaderCircle className="h-4 w-4 animate-spin" />
        : <KeyRound className="h-4 w-4" />;
  const messageTone = fhlTextAPITestStatus === "error"
    ? "border-red-300/70 bg-red-50 text-red-950 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-100"
    : fhlTextAPITestStatus === "success"
      ? "border-emerald-300/70 bg-emerald-50 text-emerald-950 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-100"
      : "border-sky-300/70 bg-sky-50 text-sky-950 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-100";

  return (
    <section className="fhl-text-api-config flex min-w-0 flex-col gap-3" data-audit-id="fhl-text-api-config">
      <div className={`flex flex-wrap items-start justify-between gap-3 border border-sky-300/70 bg-sky-50 px-3 py-2.5 text-sky-950 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-[14px]"}`}>
        <div className="flex min-w-0 items-start gap-2.5">
          <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">FHL 文本 API</div>
            <p className="mt-0.5 text-[11px] leading-5 opacity-85">
              仅用于 AI 优化和图片反推，不参与 Images 生图池和并发调度。
            </p>
          </div>
        </div>
        <div className={`flex shrink-0 items-center gap-1.5 text-[11px] font-medium ${statusClass}`}>
          {statusIcon}
          <span>{STATUS_LABELS[fhlTextAPITestStatus]}</span>
        </div>
      </div>

      <div className={`grid min-w-0 grid-cols-[116px_minmax(0,1fr)_34px] items-start gap-2 border border-black/[0.08] bg-[var(--surface)]/75 px-3 py-2.5 dark:border-white/[0.08] ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}>
        <div className="min-w-0 text-[11px] leading-5 text-zinc-600 dark:text-zinc-300">
          <div className="font-semibold text-zinc-900 dark:text-zinc-100">FHL Responses</div>
          <div className="break-all">{activeModelID}</div>
        </div>
        <div className="grid min-w-0 gap-2">
          <div
            className="grid min-w-0 items-start gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
            data-testid="fhl-text-model-controls"
          >
            <div className={`grid min-w-0 gap-2 ${selectedModelChoice === CUSTOM_MODEL_VALUE ? "sm:grid-cols-2" : ""}`}>
              <select
                value={selectedModelChoice}
                onChange={(event) => handleModelChoiceChange(event.target.value)}
                disabled={isTesting}
                aria-label="FHL 文本模型"
                title="FHL 文本模型"
                data-testid="fhl-text-model-select"
                className={`focus-ring min-w-0 border border-black/[0.08] bg-white/80 px-2.5 py-2 text-[12px] text-zinc-900 dark:border-white/[0.08] dark:bg-zinc-900 dark:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-70 ${usesFluentUI ? "rounded-[7px]" : "rounded-[10px]"}`}
              >
                {modelOptions.map((modelID) => (
                  <option key={modelID} value={modelID}>
                    {modelID}{fetchedModels && modelID === activeModelID && !fetchedModels.includes(modelID) ? "（当前已保存，列表未返回）" : ""}
                  </option>
                ))}
                <option value={CUSTOM_MODEL_VALUE}>自定义模型</option>
              </select>
              {selectedModelChoice === CUSTOM_MODEL_VALUE ? (
              <input
                type="text"
                value={customModelInput}
                onChange={(event) => handleCustomModelChange(event.target.value)}
                onBlur={() => {
                  const validation = validateFHLTextAPIModelInput(customModelInput);
                  if (validation.valid) setCustomModelInput(validation.value);
                }}
                placeholder="输入模型 ID"
                spellCheck={false}
                autoComplete="off"
                disabled={isTesting}
                maxLength={129}
                aria-label="自定义 FHL 文本模型 ID"
                title="自定义 FHL 文本模型 ID"
                data-testid="fhl-text-custom-model-input"
                className={`focus-ring min-w-0 border border-black/[0.08] bg-white/80 px-2.5 py-2 text-[12px] text-zinc-900 placeholder:text-zinc-400 dark:border-white/[0.08] dark:bg-black/10 dark:text-zinc-100 dark:placeholder:text-zinc-500 font-mono-token disabled:cursor-not-allowed disabled:opacity-70 ${usesFluentUI ? "rounded-[7px]" : "rounded-[10px]"}`}
              />
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => void handleFetchModels()}
              disabled={isFetchingModels || isTesting}
              title="使用当前输入或已保存的 Key 拉取模型列表"
              aria-label="获取 FHL 文本模型"
              data-testid="fhl-text-fetch-models"
              className={`focus-ring inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap border border-sky-400 bg-sky-50 px-3 text-[12px] font-medium text-sky-700 transition-colors hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-sky-400/60 dark:bg-sky-400/10 dark:text-sky-200 dark:hover:bg-sky-400/20 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
            >
              {isFetchingModels ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {isFetchingModels ? "拉取中" : "拉取模型列表"}
            </button>
          </div>
          <input
            type="password"
            value={apiKeyInput}
            onChange={(event) => {
              setAPIKeyInput(event.target.value);
              setOperationError(null);
              setFetchedModels(null);
              setModelListError(null);
            }}
            placeholder={fhlTextAPIConfigured
              ? `已保存：${fhlTextAPIKeyHint}；输入新 Key 可替换`
              : "粘贴专用 FHL 文本 API Key"}
            spellCheck={false}
            autoComplete="new-password"
            autoCorrect="off"
            autoCapitalize="off"
            name="fhl-text-api-key"
            data-lpignore="true"
            data-1p-ignore="true"
            disabled={isTesting}
            className={`focus-ring min-w-0 border border-black/[0.08] bg-white/80 px-2.5 py-2 text-[12px] text-zinc-900 placeholder:text-zinc-400 dark:border-white/[0.08] dark:bg-black/10 dark:text-zinc-100 dark:placeholder:text-zinc-500 font-mono-token disabled:cursor-not-allowed disabled:opacity-70 ${usesFluentUI ? "rounded-[7px]" : "rounded-[10px]"}`}
          />
        </div>
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={!fhlTextAPIConfigured || isTesting}
          title="删除 FHL 文本 API"
          aria-label="删除 FHL 文本 API"
          className={`inline-flex h-8 w-8 items-center justify-center text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-35 dark:hover:bg-red-400/10 dark:hover:text-red-300 ${usesFluentUI ? "rounded-[7px]" : "rounded-[10px]"}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
        <span>{FHL_TEXT_API_BASE_URL} · FHL Responses · {activeModelID}</span>
        <button
          type="button"
          onClick={() => void handleSaveAndTest()}
          disabled={isTesting || isFetchingModels || !!modelValidationError || (!apiKeyInput.trim() && !fhlTextAPIConfigured)}
          title={`使用 ${activeModelID} 保存并测试文本 API`}
          aria-label="保存并测试文本 API"
          data-testid="fhl-text-save-test"
          className={`liquid-primary-button inline-flex h-9 items-center gap-1.5 bg-[var(--accent)] px-3 text-[12px] font-medium text-white transition-colors hover:bg-[var(--accent-2)] disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-600 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
        >
          {isTesting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {isTesting ? `正在测试 ${activeModelID}` : "保存并测试文本 API"}
        </button>
      </div>

      {modelValidationError ? (
        <div className={`flex items-start gap-2 border border-red-300/70 bg-red-50 px-3 py-2 text-[12px] text-red-950 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`} data-testid="fhl-text-model-error">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">{modelValidationError}</span>
        </div>
      ) : modelListError ? (
        <div className={`flex items-start gap-2 border border-red-300/70 bg-red-50 px-3 py-2 text-[12px] text-red-950 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`} data-testid="fhl-text-model-list-error">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">{modelListError}</span>
        </div>
      ) : operationError ? (
        <div className={`flex items-start gap-2 border border-red-300/70 bg-red-50 px-3 py-2 text-[12px] text-red-950 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}>
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">{operationError}</span>
        </div>
      ) : null}

      {!modelValidationError && !modelListError && !operationError && fetchedModels ? (
        <div className="text-[11px] leading-5 text-emerald-700 dark:text-emerald-300" data-testid="fhl-text-model-list-success">
          已获取 {fetchedModels.length} 个模型。
        </div>
      ) : null}

      {!modelValidationError && !modelListError && !operationError && fhlTextAPITestMessage ? (
        <div className={`flex items-start gap-2 border px-3 py-2 text-[12px] ${messageTone} ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}>
          {statusIcon}
          <span className="min-w-0 break-words">{fhlTextAPITestMessage}</span>
        </div>
      ) : null}
    </section>
  );
}
