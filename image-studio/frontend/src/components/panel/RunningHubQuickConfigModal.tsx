import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react";
import { Modal } from "../common/Modal";
import { useStudioStore } from "../../state/studioStore";
import { usePlatform } from "../../platform/context";
import { RUNNINGHUB_BASE_URL } from "../../lib/profiles";
import {
  ensureRunningHubProfiles,
  saveRunningHubConfig,
  verifyRunningHubBridge,
  type RunningHubQuickSummary,
} from "../../lib/runninghubAPI";

type SummaryState = RunningHubQuickSummary & {
  banana2Id: string;
  imageG2Id: string;
};

export function RunningHubQuickConfigModal({
  open,
  onClose,
  onOpenUpstream,
}: {
  open: boolean;
  onClose: () => void;
  onOpenUpstream: (banana2Id: string) => void | Promise<void>;
}) {
  const { usesFluentUI } = usePlatform();
  const pushToast = useStudioStore((state) => state.pushToast);
  const [baseURLInput, setBaseURLInput] = useState(RUNNINGHUB_BASE_URL);
  const [apiKeyInput, setAPIKeyInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [stageText, setStageText] = useState("");
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      return;
    }
    setBaseURLInput(RUNNINGHUB_BASE_URL);
    setAPIKeyInput("");
    setIsRunning(false);
    setStageText("");
    setFatalError(null);
    setSummary(null);
  }, [open]);

  function normalizedBaseURL() {
    return String(baseURLInput || "").trim().replace(/\/+$/, "") || RUNNINGHUB_BASE_URL;
  }

  function handleClose() {
    abortRef.current?.abort();
    abortRef.current = null;
    onClose();
  }

  async function handleSubmit() {
    const baseURL = normalizedBaseURL();
    const apiKey = apiKeyInput.trim();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsRunning(true);
    setFatalError(null);
    setSummary(null);

    try {
      if (apiKey) {
        setStageText("正在写入 RunningHub API Key 到 8117 桥接...");
        await saveRunningHubConfig(baseURL, { apiKey }, controller.signal);
      }
      setStageText("正在验证桥接状态...");
      const verified = await verifyRunningHubBridge(baseURL, controller.signal);
      if (!verified.config.api_key_configured) {
        throw new Error("桥接可达，但还没有 RunningHub API Key。可以在这里粘贴 Key，或先去 8117 桥接模块里保存。");
      }
      setStageText("正在写入安卓端 RunningHub profiles...");
      const ids = await ensureRunningHubProfiles(useStudioStore.getState(), baseURL);
      setSummary({
        ...verified.summary,
        banana2Id: ids.banana2Id,
        imageG2Id: ids.imageG2Id,
      });
      setStageText("");
      pushToast("RunningHub 双模型配置已写入安卓端。", "success", 3600);
    } catch (error: any) {
      if (controller.signal.aborted) return;
      setFatalError(error?.message ?? "RunningHub 配置失败");
      setStageText("");
      pushToast(`RunningHub 配置失败：${error?.message ?? error}`, "error", 5200);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsRunning(false);
    }
  }

  async function handleOpenUpstream() {
    if (!summary) return;
    await onOpenUpstream(summary.banana2Id);
    onClose();
  }

  function resultRow(label: string, result: { ok: boolean; detail: string }) {
    const ok = result.ok;
    return (
      <div
        className={`border px-3 py-2 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"} ${
          ok
            ? "border-emerald-300/70 bg-emerald-50 text-emerald-950 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-100"
            : "border-red-300/70 bg-red-50 text-red-950 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-100"
        }`}
      >
        <div className="flex items-center gap-2 text-[13px] font-semibold tracking-[0]">
          {ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <span>{label}</span>
        </div>
        <div className="mt-1 break-words text-[12px] leading-5 [overflow-wrap:anywhere]">{result.detail}</div>
      </div>
    );
  }

  return (
    <Modal open={open} onClose={handleClose} title="RunningHub 一键配置" width={520}>
      <div className="flex flex-col gap-3">
        <div className={`border border-sky-300/70 bg-sky-50 px-3 py-2 text-sky-950 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
          <div className="text-[13px] font-semibold tracking-[0]">一次完成桥接写 Key + 安卓端双模型 profile</div>
          <div className="mt-1 text-[12px] leading-5">
            会创建 `RH-1 全能图像2` 和 `RH-1 全能图像G2`，默认激活前者。安卓模拟器访问电脑本机桥接请使用 `{RUNNINGHUB_BASE_URL}`。
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-semibold tracking-[0] text-zinc-700 dark:text-zinc-200">桥接地址</label>
          <input
            type="text"
            value={baseURLInput}
            onChange={(event) => setBaseURLInput(event.target.value)}
            disabled={isRunning || !!summary}
            spellCheck={false}
            className={`focus-ring w-full min-w-0 border border-black/[0.08] bg-[var(--surface)] px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-white/[0.08] dark:text-zinc-100 dark:placeholder:text-zinc-500 font-mono-token ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-semibold tracking-[0] text-zinc-700 dark:text-zinc-200">RunningHub API Key</label>
          <input
            type="password"
            value={apiKeyInput}
            onChange={(event) => setAPIKeyInput(event.target.value)}
            disabled={isRunning || !!summary}
            placeholder="留空表示复用 8117 里已经保存的 Key"
            spellCheck={false}
            className={`focus-ring w-full min-w-0 border border-black/[0.08] bg-[var(--surface)] px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-white/[0.08] dark:text-zinc-100 dark:placeholder:text-zinc-500 font-mono-token ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
          />
          <div className="text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
            这里的 Key 只写入 8117 桥接模块，不会保存到安卓 profile 里。
          </div>
        </div>

        {isRunning ? (
          <div className={`border border-sky-300/70 bg-sky-50 px-3 py-2 text-sky-950 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
            <div className="flex items-center gap-2 text-[13px] font-semibold tracking-[0]">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              <span>{stageText || "正在处理..."}</span>
            </div>
          </div>
        ) : null}

        {fatalError ? (
          <div className={`border border-red-300/70 bg-red-50 px-3 py-2 text-red-950 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
            <div className="flex items-center gap-2 text-[13px] font-semibold tracking-[0]">
              <AlertCircle className="h-4 w-4" />
              <span>配置失败</span>
            </div>
            <div className="mt-1 break-words text-[12px] leading-5 [overflow-wrap:anywhere]">{fatalError}</div>
          </div>
        ) : null}

        {summary ? (
          <div className="flex flex-col gap-3">
            {resultRow("桥接状态", summary.bridge)}
            {resultRow("文生图能力", summary.textToImage)}
            {resultRow("图生图能力", summary.imageToImage)}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={handleClose}
            className={`platform-action-btn border border-black/[0.08] px-4 py-2 text-sm text-zinc-700 transition-colors hover:bg-black/[0.04] dark:border-white/[0.08] dark:text-zinc-300 dark:hover:bg-white/[0.06] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
          >
            取消
          </button>
          {summary ? (
            <button
              type="button"
              onClick={() => void handleOpenUpstream()}
              className={`liquid-primary-button bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-2)] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
            >
              打开上游配置
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={isRunning || !normalizedBaseURL()}
              className={`liquid-primary-button bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-2)] disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500 dark:disabled:bg-zinc-800 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
            >
              确认并配置
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
