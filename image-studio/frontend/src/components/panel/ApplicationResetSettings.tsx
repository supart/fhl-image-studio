import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { AlertCircle, LoaderCircle, RotateCcw, ShieldCheck } from "lucide-react";
import { hasActiveAPIWork } from "../../lib/apiCredentialLibrary.ts";
import { usePlatform } from "../../platform/context";
import { useStudioStore } from "../../state/studioStore";
import type { ResetSummary } from "../../state/applicationStateReset";
import { SettingsRow } from "./settingsPrimitives";

function useResetActivity() {
  const isRunning = useStudioStore((state) => state.isRunning);
  const runningJobs = useStudioStore((state) => state.runningJobs);
  const batchTasksById = useStudioStore((state) => state.batchTasksById);
  const runningJobMeta = useStudioStore((state) => state.runningJobMeta);
  const jobGroupsByWorkspace = useStudioStore((state) => state.jobGroupsByWorkspace);
  const isTestingKey = useStudioStore((state) => state.isTestingKey);
  const fhlTextAPITestStatus = useStudioStore((state) => state.fhlTextAPITestStatus);
  const isOptimizingPrompt = useStudioStore((state) => state.isOptimizingPrompt);
  const isReversingPrompt = useStudioStore((state) => state.isReversingPrompt);
  return hasActiveAPIWork({
    isRunning,
    runningJobs,
    batchTasksById,
    runningJobMeta,
    jobGroupsByWorkspace,
    isTestingKey,
    fhlTextAPITestStatus,
    isOptimizingPrompt,
    isReversingPrompt,
  });
}

export function ApplicationResetSettingsEntry({
  onOpen,
  triggerRef,
}: {
  onOpen: () => void;
  triggerRef?: RefObject<HTMLButtonElement>;
}) {
  const { usesFluentUI } = usePlatform();
  const activeWork = useResetActivity();
  const profileCount = useStudioStore((state) => state.profiles.length);
  const fhlTextConfigured = useStudioStore((state) => state.fhlTextAPIConfigured);
  const preservedCount = profileCount + (fhlTextConfigured ? 1 : 0);
  const descriptionId = "reset-preserving-api-description";

  return (
    <SettingsRow label="应用初始化">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div id={descriptionId} className="min-w-0 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
          <p>清空工作区、任务记录、历史、提示词历史、预设、素材组和界面偏好，普通设置恢复默认。</p>
          <p className="mt-1 font-medium text-emerald-700 dark:text-emerald-300">
            保留 {preservedCount} 项 API 配置及凭据；不删除图片和输入输出文件。
          </p>
        </div>
        <button
          ref={triggerRef}
          type="button"
          data-audit-id="reset-preserving-api-open"
          onClick={onOpen}
          disabled={activeWork}
          aria-describedby={descriptionId}
          className={`application-reset-entry-button inline-flex min-h-[44px] w-full shrink-0 items-center justify-center gap-1.5 border border-emerald-300 bg-emerald-50 px-3 text-[12px] font-semibold text-emerald-800 transition-colors hover:border-emerald-400 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-45 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200 dark:hover:bg-emerald-400/15 sm:w-auto ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          恢复默认但保留 API
        </button>
      </div>
      {activeWork ? (
        <p data-audit-id="reset-preserving-api-blocked" className="mt-2 text-[11px] leading-5 text-amber-700 dark:text-amber-300">
          当前有排队、运行、连接测试或提示词任务，结束后才能初始化。
        </p>
      ) : null}
    </SettingsRow>
  );
}

export function ApplicationResetConfirmView({
  onCancel,
  onComplete,
  onRunningChange,
}: {
  onCancel: () => void;
  onComplete: () => void;
  onRunningChange: (running: boolean) => void;
}) {
  const { usesFluentUI } = usePlatform();
  const activeWork = useResetActivity();
  const resetApplication = useStudioStore((state) => state.resetApplicationStatePreservingAPI);
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<ResetSummary | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    onRunningChange(isResetting);
    return () => onRunningChange(false);
  }, [isResetting, onRunningChange]);

  const summaryText = useMemo(() => {
    if (!summary) return "";
    return `已重置 ${summary.workspacesReset} 个工作区，清除 ${summary.historyEntriesCleared} 条历史、`
      + `${summary.taskRecordsCleared} 条任务记录，并保留 ${summary.apiConfigurationsPreserved} 项 API 配置。`;
  }, [summary]);

  async function confirmReset() {
    if (activeWork || isResetting) return;
    setIsResetting(true);
    setError("");
    try {
      setSummary(await resetApplication());
    } catch (resetError: any) {
      setError(resetError?.message ?? "初始化失败，请重试。");
    } finally {
      setIsResetting(false);
    }
  }

  if (summary) {
    return (
      <div data-audit-id="reset-preserving-api-summary" className="flex flex-col gap-4" aria-live="polite">
        <div className={`flex items-start gap-3 border border-emerald-300 bg-emerald-50 p-3 text-emerald-950 dark:border-emerald-400/35 dark:bg-emerald-400/10 dark:text-emerald-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}>
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-300" />
          <div className="min-w-0 text-[12px] leading-6">
            <p className="font-semibold">初始化完成，API 配置保持不变。</p>
            <p>{summaryText}</p>
            <p>{summary.warnings.join(" ")}</p>
          </div>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onComplete}
            className={`application-reset-complete-button inline-flex h-9 items-center bg-[var(--accent)] px-4 text-[12px] font-semibold text-white ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
          >
            完成
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-audit-id="reset-preserving-api-confirm-view" className="flex flex-col gap-4">
      <div className={`flex items-start gap-3 border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-400/35 dark:bg-amber-400/10 dark:text-amber-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}>
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" />
        <div className="min-w-0 text-[12px] leading-6">
          <p className="font-semibold">此操作不会删除任何 API Key 或磁盘图片。</p>
          <p>将清空所有工作区、任务运行态、历史、提示词历史、预设和素材组，并恢复界面与普通设置默认值。</p>
          <p className="mt-1">API Profile、URL、模型、FHL 文本、Images 池、RunningHub 配置及凭据将完整保留。</p>
        </div>
      </div>

      {activeWork ? (
        <div role="alert" className="text-[12px] leading-5 text-amber-700 dark:text-amber-300">
          检测到活动任务，当前不能初始化。关闭此页并等待任务结束后重试。
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="text-[12px] leading-5 text-red-700 dark:text-red-300">{error}</div>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          ref={cancelRef}
          type="button"
          data-audit-id="reset-preserving-api-cancel"
          onClick={onCancel}
          disabled={isResetting}
          className={`application-reset-action-button inline-flex min-h-[40px] items-center justify-center px-3 text-[12px] font-medium text-zinc-600 hover:bg-black/[0.04] disabled:opacity-45 dark:text-zinc-300 dark:hover:bg-white/[0.06] ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
        >
          取消
        </button>
        <button
          type="button"
          data-audit-id="reset-preserving-api-confirm"
          onClick={() => void confirmReset()}
          disabled={isResetting || activeWork}
          aria-live="polite"
          className={`application-reset-action-button inline-flex min-h-[40px] items-center justify-center gap-1.5 bg-emerald-600 px-3 text-[12px] font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-600 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
        >
          {isResetting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          {isResetting ? "正在初始化" : "确认恢复默认"}
        </button>
      </div>
    </div>
  );
}
