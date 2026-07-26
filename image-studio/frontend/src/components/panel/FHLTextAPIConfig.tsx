import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  MessageSquareText,
  Save,
  Trash2,
} from "lucide-react";
import {
  FHL_TEXT_API_BASE_URL,
  FHL_TEXT_API_MODEL_ID,
  validateFHLTextAPIKey,
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

export function FHLTextAPIConfig({ active }: { active: boolean }) {
  const { usesFluentUI } = usePlatform();
  const fhlTextAPIConfigured = useStudioStore((state) => state.fhlTextAPIConfigured);
  const fhlTextAPIKeyHint = useStudioStore((state) => state.fhlTextAPIKeyHint);
  const fhlTextAPITestStatus = useStudioStore((state) => state.fhlTextAPITestStatus);
  const fhlTextAPITestMessage = useStudioStore((state) => state.fhlTextAPITestMessage);
  const refreshFHLTextAPIConfig = useStudioStore((state) => state.refreshFHLTextAPIConfig);
  const saveAndTestFHLTextAPI = useStudioStore((state) => state.saveAndTestFHLTextAPI);
  const deleteFHLTextAPIConfig = useStudioStore((state) => state.deleteFHLTextAPIConfig);
  const [apiKeyInput, setAPIKeyInput] = useState("");
  const [operationError, setOperationError] = useState<string | null>(null);
  const isTesting = fhlTextAPITestStatus === "testing";

  useEffect(() => {
    setAPIKeyInput("");
    setOperationError(null);
    if (active) void refreshFHLTextAPIConfig();
  }, [active, refreshFHLTextAPIConfig]);

  async function handleSaveAndTest() {
    if (isTesting) return;
    const input = apiKeyInput.trim();
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
      await saveAndTestFHLTextAPI(validatedInput);
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

      <div className={`grid min-w-0 grid-cols-[116px_minmax(0,1fr)_34px] items-center gap-2 border border-black/[0.08] bg-[var(--surface)]/75 px-3 py-2.5 dark:border-white/[0.08] ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}>
        <div className="min-w-0 text-[11px] leading-5 text-zinc-600 dark:text-zinc-300">
          <div className="font-semibold text-zinc-900 dark:text-zinc-100">FHL Responses</div>
          <div>{FHL_TEXT_API_MODEL_ID}</div>
        </div>
        <input
          type="password"
          value={apiKeyInput}
          onChange={(event) => {
            setAPIKeyInput(event.target.value);
            setOperationError(null);
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
        <span>{FHL_TEXT_API_BASE_URL} · FHL Responses · {FHL_TEXT_API_MODEL_ID}</span>
        <button
          type="button"
          onClick={() => void handleSaveAndTest()}
          disabled={isTesting || (!apiKeyInput.trim() && !fhlTextAPIConfigured)}
          className={`liquid-primary-button inline-flex h-9 items-center gap-1.5 bg-[var(--accent)] px-3 text-[12px] font-medium text-white transition-colors hover:bg-[var(--accent-2)] disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-600 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
        >
          {isTesting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {isTesting ? "正在测试文本响应" : "保存并测试文本 API"}
        </button>
      </div>

      {operationError ? (
        <div className={`flex items-start gap-2 border border-red-300/70 bg-red-50 px-3 py-2 text-[12px] text-red-950 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}>
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">{operationError}</span>
        </div>
      ) : null}

      {!operationError && fhlTextAPITestMessage ? (
        <div className={`flex items-start gap-2 border px-3 py-2 text-[12px] ${messageTone} ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}>
          {statusIcon}
          <span className="min-w-0 break-words">{fhlTextAPITestMessage}</span>
        </div>
      ) : null}
    </section>
  );
}
