import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useStudioStore } from "../../state/studioStore";
import { usePlatform } from "../../platform/context";
import type { BatchTaskRecord } from "../../types/domain";
import { sanitizeRuntimeText } from "../../lib/runtimeText.ts";
import { HistoryMetaBadges } from "../history/HistoryMetaBadges";
import { qualityLabel, sizeLabel } from "../history/historyLabels";
import { StreamPreviewBadge } from "./StreamPreviewBadge";

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function StatusBar() {
  const {
    isRunning,
    progress,
    currentImage,
    streamPreview,
    lastLogLine,
    viewZoom,
    recentDurations,
    jobsTotal,
    jobsCompleted,
    jobsFailed,
    runningJobs,
    continuousGenerateTest,
    activeWorkspaceId,
    workspaces,
    batchTasksById,
  } = useStudioStore();
  const { isAndroidPhone, isMac, isWindows, usesFluentUI, usesAppleUI } = usePlatform();
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [progressAnchor, setProgressAnchor] = useState(() => ({ elapsed: 0, at: Date.now() }));
  const zoomLabel = currentImage ? `${Math.round(viewZoom * 100)}%` : "";
  const avg = recentDurations.length > 0
    ? recentDurations.reduce((a, b) => a + b, 0) / recentDurations.length
    : 0;
  const eta = isRunning && progress && avg > 0
    ? Math.max(0, Math.round(avg - progress.elapsed))
    : null;
  const jobsSucceeded = Math.max(0, jobsCompleted - jobsFailed);
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const activeBatchTasks = (activeWorkspace?.batchTaskIds ?? [])
    .map((id) => batchTasksById[id])
    .filter((task): task is BatchTaskRecord => !!task && task.workspaceId === activeWorkspaceId);
  const taskStatusCounts = activeBatchTasks.reduce(
    (counts, task) => {
      if (task.status === "running") counts.running += 1;
      else if (task.status === "queued") counts.queued += 1;
      else if (task.status === "succeeded") counts.succeeded += 1;
      else if (task.status === "failed" || task.status === "interrupted") counts.failed += 1;
      else if (task.status === "cancelled") counts.cancelled += 1;
      return counts;
    },
    { running: 0, queued: 0, succeeded: 0, failed: 0, cancelled: 0 },
  );
  const hasBatchTaskCounts = activeBatchTasks.length > 0;
  const continuousRunningCount = hasBatchTaskCounts ? taskStatusCounts.running : runningJobs.length;
  const continuousQueuedCount = hasBatchTaskCounts ? taskStatusCounts.queued : 0;
  const continuousSucceededCount = hasBatchTaskCounts ? taskStatusCounts.succeeded : jobsSucceeded;
  const continuousFailedCount = hasBatchTaskCounts ? taskStatusCounts.failed : jobsFailed;
  const continuousCancelledCount = hasBatchTaskCounts ? taskStatusCounts.cancelled : 0;
  const liveElapsedSeconds = progress
    ? Math.max(progress.elapsed, progressAnchor.elapsed + (clockNow - progressAnchor.at) / 1000)
    : 0;
  const runningStage = progress ? sanitizeRuntimeText(progress.stage, "处理中") : "";
  const trailingLogLine = sanitizeRuntimeText(lastLogLine);

  useEffect(() => {
    if (!isRunning) return undefined;
    const timer = window.setInterval(() => setClockNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  useEffect(() => {
    if (!progress) return;
    setProgressAnchor({ elapsed: progress.elapsed, at: Date.now() });
  }, [progress?.elapsed, progress?.stage]);

  function formatElapsed(seconds: number): string {
    return `${seconds.toFixed(1)}s`;
  }

  if (isRunning) {
    return (
      <div className={`${isWindows ? "statusbar" : ""} relative flex min-w-0 flex-nowrap items-center gap-3 overflow-hidden whitespace-nowrap border-t border-[var(--border)] bg-[var(--toolbar)] px-3 py-2 text-[11px] text-zinc-700 backdrop-blur-2xl dark:text-zinc-300 ${usesAppleUI ? "liquid-glass-bar" : ""} ${usesFluentUI ? "min-h-[34px]" : ""} ${isAndroidPhone ? "min-h-[30px]" : ""} ${isMac ? "min-h-[28px]" : ""}`}>
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[var(--accent)]" />
        <span className="font-medium">
          {progress
            ? isMac
              ? `${runningStage} · ${formatElapsed(liveElapsedSeconds)}`
              : `${runningStage} · ${formatElapsed(liveElapsedSeconds)} · ${fmtBytes(progress.bytes)}`
            : "正在请求..."}
        </span>
        {continuousGenerateTest && (
          <span className="font-medium text-amber-600 dark:text-amber-300">
            连续测试 · 运行中 {continuousRunningCount} · 排队 {continuousQueuedCount} · 成功 {continuousSucceededCount} · 失败 {continuousFailedCount}
            {continuousCancelledCount > 0 ? ` · 取消 ${continuousCancelledCount}` : ""}
          </span>
        )}
        {!continuousGenerateTest && jobsTotal > 1 && (
          <span className="font-medium text-[var(--accent)]">
            并发 {runningJobs.length} · {jobsCompleted}/{jobsTotal}
          </span>
        )}
        {streamPreview ? <StreamPreviewBadge compact /> : null}
        {eta !== null && <span className="text-zinc-500">≈ 剩余 {eta}s</span>}
        <div className="absolute bottom-0 left-0 right-0 h-px animate-pulse bg-[color:var(--accent)]/35" />
        {!isAndroidPhone && !isMac && trailingLogLine && (
          <span className="text-zinc-500 truncate max-w-[30%] ml-auto" title={trailingLogLine}>
            {trailingLogLine}
          </span>
        )}
      </div>
    );
  }
  if (currentImage) {
    const headline = currentImage.mode === "edit" ? "编辑结果" : "生成结果";
    const metaBadges = [sizeLabel(currentImage.size), qualityLabel(currentImage.quality)];
    if (currentImage.elapsedSec) metaBadges.push(`${currentImage.elapsedSec}s`);
    if (!isMac && currentImage.seed) metaBadges.push(`seed ${currentImage.seed}`);
    if (!isMac && currentImage.styleTag) metaBadges.push(`#${currentImage.styleTag}`);
    return (
      <div className={`${isWindows ? "statusbar" : ""} flex min-w-0 flex-nowrap items-center gap-3 overflow-hidden whitespace-nowrap border-t border-[var(--border)] bg-[var(--toolbar)] px-3 py-2 text-[11px] text-zinc-600 backdrop-blur-2xl dark:text-zinc-400 ${usesAppleUI ? "liquid-glass-bar" : ""} ${usesFluentUI ? "min-h-[34px]" : ""} ${isAndroidPhone ? "min-h-[30px]" : ""} ${isMac ? "min-h-[28px]" : ""}`}>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[var(--accent)]">
          <CheckCircle2 className="w-3 h-3" />
          <span className="font-medium">{headline}</span>
        </span>
        <HistoryMetaBadges items={metaBadges} compact className="opacity-90" />
        {!isAndroidPhone && !isMac && <span className="text-zinc-500 font-mono-token">{new Date(currentImage.createdAt).toLocaleTimeString()}</span>}
        {!isAndroidPhone && !isMac && currentImage.revisedPrompt && (
          <span className="text-zinc-500 truncate flex-1 italic" title={currentImage.revisedPrompt}>
            ✨ {currentImage.revisedPrompt}
          </span>
        )}
        <span className="text-zinc-500 font-mono-token ml-auto shrink-0">{zoomLabel}</span>
      </div>
    );
  }
  if (isMac) return null;
  return (
    <div className={`${isWindows ? "statusbar" : ""} overflow-hidden whitespace-nowrap border-t border-[var(--border)] bg-[var(--toolbar)] px-3 py-2 text-[11px] text-zinc-500 backdrop-blur-2xl ${usesAppleUI ? "liquid-glass-bar" : ""} ${usesFluentUI ? "min-h-[34px]" : ""} ${isAndroidPhone ? "min-h-[30px]" : ""}`}>
      准备就绪
    </div>
  );
}
