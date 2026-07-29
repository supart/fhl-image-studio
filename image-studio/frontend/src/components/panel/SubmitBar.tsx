import { useState } from "react";
import { Settings } from "lucide-react";
import { usePlatform } from "../../platform/context";
import { apiModeRequiresDirectAPIKey } from "../../lib/profiles";

export function SubmitBar({
  apiKey,
  apiMode,
  baseURL,
  prompt,
  mode,
  isRunning,
  continuousGenerateTest,
  failedBatchTaskCount,
  queuedBatchTaskCount,
  retryApiLabel,
  batchImageToImageCount,
  onOpenUpstreamConfig,
  onCancel,
  onSubmit,
  onRetryFailedBatchTasks,
  onCancelQueuedBatchTasks,
  onClearFailedBatchTasks,
}: {
  apiKey: string;
  apiMode: "responses" | "images" | "apimart" | "runninghub";
  baseURL: string;
  prompt: string;
  mode: "generate" | "edit";
  isRunning: boolean;
  continuousGenerateTest: boolean;
  failedBatchTaskCount: number;
  queuedBatchTaskCount: number;
  retryApiLabel?: string;
  batchImageToImageCount: number;
  onOpenUpstreamConfig: () => void;
  onCancel: () => void;
  onSubmit: () => void;
  onRetryFailedBatchTasks: () => void | Promise<void>;
  onCancelQueuedBatchTasks: () => void | Promise<void>;
  onClearFailedBatchTasks: () => void | Promise<void>;
}) {
  const { isMac, usesFluentUI } = usePlatform();
  const [retryingFailed, setRetryingFailed] = useState(false);
  const [cancellingQueued, setCancellingQueued] = useState(false);
  const [clearingFailed, setClearingFailed] = useState(false);
  const mainPromptMissing = !prompt.trim();
  const upstreamReady = !!baseURL.trim() && (!apiModeRequiresDirectAPIKey(apiMode) || !!apiKey.trim());
  const generateLabel = mainPromptMissing
    ? "主提示词未输入"
    : batchImageToImageCount > 0
      ? `生成（批量生图 ${batchImageToImageCount} 张）`
      : "生成";
  const retryTargetLabel = retryApiLabel?.trim() || "当前 API";
  const roundedButtonClass = usesFluentUI ? "rounded-[10px]" : "rounded-full";
  const maintenanceButtonClass = `batch-maintenance-button w-full border px-2.5 py-1.5 text-[12px] font-semibold leading-none shadow-sm transition-colors disabled:cursor-wait disabled:opacity-70 ${roundedButtonClass}`;
  const retryMaintenanceButtonClass = `retry-failed-batch-button batch-maintenance-button mb-2 w-full border px-2.5 py-1.5 text-[12px] font-semibold leading-none shadow-sm transition-colors disabled:cursor-wait disabled:opacity-70 ${roundedButtonClass}`;
  const cancelGenerationButtonClass = `cancel-generation-button w-14 shrink-0 border px-2 py-3 text-sm font-semibold leading-none transition-colors ${roundedButtonClass}`;
  const batchMaintenanceSlotClass = "h-[34px] overflow-hidden";
  const retrySlotClass = "h-[34px] overflow-hidden";
  const runningFooterSlotClass = "overflow-hidden";
  const showRetryFailedButton = failedBatchTaskCount > 0 && (!isRunning || continuousGenerateTest);
  const retryFailedLabel = retryingFailed
    ? `正在重试当前批次失败任务 ${failedBatchTaskCount} 个...`
    : `重试当前批次失败任务 ${failedBatchTaskCount}`;
  const cancelQueuedLabel = cancellingQueued
    ? `正在取消 ${queuedBatchTaskCount} 个...`
    : `一键取消排队 ${queuedBatchTaskCount}`;
  const clearFailedLabel = clearingFailed
    ? `正在清空失败/终图缺失 ${failedBatchTaskCount} 个...`
    : `清空失败/终图缺失 ${failedBatchTaskCount}`;
  const handleRetryFailedBatchTasks = async () => {
    if (retryingFailed) return;
    setRetryingFailed(true);
    try {
      await onRetryFailedBatchTasks();
    } finally {
      setRetryingFailed(false);
    }
  };
  const handleCancelQueuedBatchTasks = async () => {
    if (cancellingQueued) return;
    setCancellingQueued(true);
    try {
      await onCancelQueuedBatchTasks();
    } finally {
      setCancellingQueued(false);
    }
  };
  const handleClearFailedBatchTasks = async () => {
    if (clearingFailed) return;
    setClearingFailed(true);
    try {
      await onClearFailedBatchTasks();
    } finally {
      setClearingFailed(false);
    }
  };
  const queuedCancelButton = queuedBatchTaskCount > 0 ? (
    <button
      type="button"
      data-audit-id="cancel-queued-batch-tasks"
      onClick={() => void handleCancelQueuedBatchTasks()}
      disabled={cancellingQueued}
      className={`cancel-queued-batch-button ${maintenanceButtonClass}`}
      title="取消当前批次中尚未开始的排队任务；取消后不会进入一键重试"
    >
      {cancelQueuedLabel}
    </button>
  ) : null;
  const clearFailedButton = failedBatchTaskCount > 0 ? (
    <button
      type="button"
      data-audit-id="clear-failed-batch-tasks"
      onClick={() => void handleClearFailedBatchTasks()}
      disabled={retryingFailed || clearingFailed}
      className={`clear-failed-batch-button ${maintenanceButtonClass}`}
      title="把当前批次中的生成失败/终图缺失任务标记为已取消，不再进入一键重试；预览格子保留为灰色"
    >
      {clearFailedLabel}
    </button>
  ) : null;
  const batchMaintenanceRow = queuedBatchTaskCount > 0 || failedBatchTaskCount > 0 ? (
    <div className={`grid gap-2 ${queuedBatchTaskCount > 0 && failedBatchTaskCount > 0 ? "grid-cols-2" : "grid-cols-1"}`}>
      {queuedCancelButton}
      {clearFailedButton}
    </div>
  ) : null;
  return (
    <div className={`sticky bottom-0 mt-auto bg-gradient-to-t from-[var(--sidebar)] via-[color:var(--sidebar)]/96 to-transparent ${isMac ? "-mx-6 px-6 pb-5 pt-3" : "-mx-4 px-4 pb-1 pt-2"}`}>
      <div className={batchMaintenanceSlotClass}>{showRetryFailedButton ? batchMaintenanceRow : null}</div>
      {!upstreamReady && (
        <div className={`mb-2 border border-[color:var(--accent)]/18 bg-[var(--accent-soft)] px-3 py-2.5 text-center text-[11px] leading-relaxed text-[var(--accent)] ${usesFluentUI ? "rounded-[10px]" : "rounded-[16px]"}`}>
          <div className="font-medium">还没有可用上游配置</div>
          <div className="mt-1 opacity-90">
            先配置 BASE_URL 和 API Key，才能测试连接或开始生成。
          </div>
          <button
            type="button"
            data-audit-id="open-upstream-config"
            onClick={onOpenUpstreamConfig}
            className={`mt-2 inline-flex items-center gap-1.5 border border-[color:var(--accent)]/22 bg-white/70 px-3 py-1.5 text-[11px] font-medium text-[var(--accent)] transition-colors hover:bg-white/90 dark:bg-white/[0.06] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
          >
            <Settings className="h-3.5 w-3.5" /> 配置上游
          </button>
        </div>
      )}
      {!upstreamReady ? (
        <button
          type="button"
          data-audit-id="open-upstream-config"
          onClick={onOpenUpstreamConfig}
          className={`liquid-primary-button w-full bg-[var(--accent)] py-3 font-semibold text-white transition-colors hover:bg-[var(--accent-2)] ${usesFluentUI ? "rounded-[10px]" : "rounded-full"}`}
        >
          配置上游
        </button>
      ) : isRunning && !continuousGenerateTest ? (
        <div className="flex flex-col">
          <div className={retrySlotClass}>{batchMaintenanceRow}</div>
          <div className="flex items-stretch gap-2">
            <button
              type="button"
              data-audit-id="generate"
              onClick={onSubmit}
              disabled={mainPromptMissing}
              title={mainPromptMissing ? "主提示词未输入" : "当前正在生成，点击查看连续生成模式提示"}
              className={`liquid-primary-button min-w-0 flex-1 bg-zinc-300 py-3 font-semibold text-zinc-500 dark:bg-zinc-800 ${usesFluentUI ? "rounded-[10px]" : "rounded-full"}`}
            >
              {generateLabel}
            </button>
            <button type="button" data-audit-id="cancel" onClick={onCancel} className={cancelGenerationButtonClass}>
              取消
            </button>
          </div>
          <div className={runningFooterSlotClass}>
            <div className="mt-1 px-1 text-[10px] leading-4 text-zinc-500 dark:text-zinc-400">
              排队/生成中的格子可单独取消；已运行任务可能已计费。
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className={retrySlotClass}>
            {showRetryFailedButton ? (
              <button
                type="button"
                data-audit-id="retry-failed-batch-tasks"
                onClick={() => void handleRetryFailedBatchTasks()}
                disabled={retryingFailed || clearingFailed}
                className={retryMaintenanceButtonClass}
                title={`使用 ${retryTargetLabel} 重试当前批次里的 ${failedBatchTaskCount} 个生成失败/终图缺失任务`}
              >
                {retryFailedLabel}
              </button>
            ) : batchMaintenanceRow}
          </div>
          <div className="flex items-stretch gap-2">
            <button
              type="button"
              data-audit-id="generate"
              onClick={onSubmit}
              disabled={!upstreamReady || mainPromptMissing}
              title={mainPromptMissing ? "主提示词未输入" : undefined}
              className={`liquid-primary-button min-w-0 flex-1 bg-[var(--accent)] py-3 font-semibold text-white transition-colors hover:bg-[var(--accent-2)] disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 dark:disabled:bg-zinc-800 ${usesFluentUI ? "rounded-[10px]" : "rounded-full"}`}
            >
              {generateLabel}
            </button>
            {isRunning && continuousGenerateTest ? (
              <button type="button" data-audit-id="cancel" onClick={onCancel} className={cancelGenerationButtonClass}>
                取消
              </button>
            ) : null}
          </div>
          {isRunning && continuousGenerateTest ? (
            <div className={runningFooterSlotClass}>
              <div className="mt-1 px-1 text-[10px] leading-4 text-zinc-500 dark:text-zinc-400">
                排队/生成中的格子可单独取消；已运行任务可能已计费。
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
