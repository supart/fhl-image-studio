import { AlertTriangle, CheckCircle2, Clock3, Loader2, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { HistoryMetaBadges } from "../../../components/history/HistoryMetaBadges";
import { HistoryModeBadge } from "../../../components/history/HistoryModeBadge";
import { pixelSizeLabel, qualityLabel, sizeLabel } from "../../../components/history/historyLabels";
import { historyPreviewSrc, useBlobURL, useImageLoadState } from "../../../lib/images";
import { normalizeFHLImagesPoolSlot } from "../../../lib/profiles";
import type { HistoryItem, JobGroupSnapshot, JobSlotSnapshot } from "../../../types/domain";

function browserHistoryId(jobId: string) {
  return `job:${jobId}`;
}

function apiShortLabel(
  apiMode: JobGroupSnapshot["apiMode"],
  apiLabel?: string,
  poolSlot?: number,
) {
  const label = apiLabel?.trim();
  const slot = normalizeFHLImagesPoolSlot(poolSlot)
    ?? Number(label?.match(/^FHL(\d+)$/i)?.[1]);
  if ((apiMode === "images" || apiMode === "responses") && Number.isInteger(slot) && slot >= 1 && slot <= 10) {
    return `FHL${slot} · ${apiMode === "responses" ? "Responses API" : "Images API"}`;
  }
  if (label) return label;
  if (apiMode === "apimart") return "APIMart";
  if (apiMode === "responses") return "Responses";
  return "Images";
}

function groupStateLabel(group: JobGroupSnapshot) {
  const summary = group.statusSummary;
  if (summary.running > 0 || summary.queued > 0) {
    return `运行中 ${summary.succeeded + summary.failed + summary.cancelled + summary.interrupted}/${group.batchCount}`;
  }
  if (summary.failed > 0 || summary.interrupted > 0) {
    return `${summary.succeeded} 成功 · ${summary.failed + summary.interrupted} 失败`;
  }
  if (summary.cancelled > 0) {
    return `${summary.succeeded} 成功 · ${summary.cancelled} 已取消`;
  }
  return `${summary.succeeded} 成功`;
}

function slotStateLabel(slot: JobSlotSnapshot) {
  if (slot.cancelRequested && slot.status === "running") return "取消中";
  switch (slot.status) {
    case "queued":
      return "排队中";
    case "running":
      return "生成中";
    case "succeeded":
      return "成功";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    case "interrupted":
      return "已中断";
    default:
      return slot.status;
  }
}

function slotIcon(status: JobSlotSnapshot["status"]) {
  if (status === "succeeded") return <CheckCircle2 />;
  if (status === "queued" || status === "running") return <Loader2 />;
  if (status === "failed" || status === "interrupted") return <AlertTriangle />;
  return <Clock3 />;
}

function slotMessage(slot: JobSlotSnapshot) {
  const message = (slot.errorMessage || slot.stage || "").trim();
  if (message) return message;
  if (slot.status === "queued") return "等待启动";
  if (slot.status === "running") return "等待上游返回结果";
  if (slot.status === "cancelled") return "任务已取消";
  if (slot.status === "interrupted") return "任务中断，可按原参数重新处理";
  if (slot.status === "failed") return "生成失败 / 未返回";
  return "";
}

export function AndroidHistoryJobGroup({
  group,
  historyById,
  onApplySlotParams,
  onRegenerateSlot,
  onQueryAPIMartTask,
  onSelect,
}: {
  group: JobGroupSnapshot;
  historyById: Map<string, HistoryItem>;
  onApplySlotParams: (group: JobGroupSnapshot, slot: JobSlotSnapshot) => void;
  onRegenerateSlot: (group: JobGroupSnapshot, slot: JobSlotSnapshot) => void | Promise<void>;
  onQueryAPIMartTask: (taskId: string) => void | Promise<void>;
  onSelect: (item: HistoryItem) => void | Promise<void>;
}) {
  const slots = [...group.slots].sort((a, b) => a.batchIndex - b.batchIndex);
  const apiLabel = apiShortLabel(group.apiMode, group.apiLabel, group.fhlImagesPoolSlot);
  return (
    <article className="android-history-job-group" data-android-history-job-group>
      <header className="android-history-job-head">
        <div className="android-history-job-title">
          <span>{apiLabel}</span>
          <strong>{groupStateLabel(group)}</strong>
        </div>
        <HistoryMetaBadges
          items={[sizeLabel(group.size), qualityLabel(group.quality), `${group.batchCount} 张`]}
          compact
          className="android-history-job-meta"
        />
      </header>
      <p className="android-history-job-prompt">{group.prompt || "(无 prompt)"}</p>
      <div className="android-history-job-slots">
        {slots.map((slot) => (
          <AndroidHistoryJobSlot
            key={slot.jobId}
            apiLabel={apiShortLabel(
              group.apiMode,
              slot.apiLabel || group.apiLabel,
              slot.fhlImagesPoolSlot ?? group.fhlImagesPoolSlot,
            )}
            group={group}
            item={historyById.get(browserHistoryId(slot.jobId)) ?? null}
            onApplySlotParams={onApplySlotParams}
            onRegenerateSlot={onRegenerateSlot}
            onQueryAPIMartTask={onQueryAPIMartTask}
            onSelect={onSelect}
            slot={slot}
          />
        ))}
      </div>
    </article>
  );
}

function AndroidHistoryJobSlot({
  apiLabel,
  group,
  item,
  onApplySlotParams,
  onRegenerateSlot,
  onQueryAPIMartTask,
  onSelect,
  slot,
}: {
  apiLabel: string;
  group: JobGroupSnapshot;
  item: HistoryItem | null;
  onApplySlotParams: (group: JobGroupSnapshot, slot: JobSlotSnapshot) => void;
  onRegenerateSlot: (group: JobGroupSnapshot, slot: JobSlotSnapshot) => void | Promise<void>;
  onQueryAPIMartTask: (taskId: string) => void | Promise<void>;
  onSelect: (item: HistoryItem) => void | Promise<void>;
  slot: JobSlotSnapshot;
}) {
  if (slot.status === "succeeded" && item) {
    return <AndroidHistoryJobImageSlot apiLabel={apiLabel} item={item} onSelect={onSelect} slot={slot} />;
  }
  const canApplyParams = slot.status === "failed" || slot.status === "cancelled" || slot.status === "interrupted";
  return (
    <div className={`android-history-job-slot state ${slot.status}`}>
      <span className="android-history-job-index">{slot.batchIndex + 1}</span>
      <span className="android-history-job-state-icon">{slotIcon(slot.status)}</span>
      <span className="android-history-job-slot-copy">
        <span className="android-history-job-slot-title">
          <strong>第 {slot.batchIndex + 1} 张</strong>
          <em>{apiLabel}</em>
          <b>{slotStateLabel(slot)}</b>
        </span>
        <small>{slotMessage(slot)}</small>
      </span>
      {canApplyParams || (slot.apimartTaskId && (slot.status === "failed" || slot.status === "interrupted")) ? (
        <span className="android-history-job-actions">
          {canApplyParams ? (
            <button
              type="button"
              className="android-history-job-apply"
              title="应用这格任务参数到控制台，不重新生成"
              onClick={() => onApplySlotParams(group, slot)}
            >
              <SlidersHorizontal />
              应用参数
            </button>
          ) : null}
          {canApplyParams ? (
            <button
              type="button"
              className="android-history-job-regenerate"
              title="按这格任务参数重新生成，可能产生新扣费"
              onClick={() => void onRegenerateSlot(group, slot)}
            >
              <RotateCcw />
              重新生成
            </button>
          ) : null}
          {slot.apimartTaskId && (slot.status === "failed" || slot.status === "interrupted") ? (
            <button
              type="button"
              className="android-history-job-query"
              title="继续查询 APIMart 后台任务，不重新生成，不重新扣费"
              onClick={() => void onQueryAPIMartTask(slot.apimartTaskId as string)}
            >
              <Search />
              查后台
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

function AndroidHistoryJobImageSlot({
  apiLabel,
  item,
  onSelect,
  slot,
}: {
  apiLabel: string;
  item: HistoryItem;
  onSelect: (item: HistoryItem) => void | Promise<void>;
  slot: JobSlotSnapshot;
}) {
  const previewURL = useBlobURL(item.previewBlob ?? item.imageBlob ?? null, item.imageB64 ?? null);
  const imageSrc = historyPreviewSrc(item, previewURL);
  const imageLoadState = useImageLoadState(imageSrc || null);
  const pixelLabel = pixelSizeLabel(item);
  return (
    <button
      type="button"
      className="android-history-job-slot success"
      title={item.prompt}
      onClick={() => void onSelect(item)}
    >
      <span className="android-history-job-thumb">
        {imageSrc && imageLoadState === "ready" ? (
          <img src={imageSrc} alt={item.prompt || `result ${slot.batchIndex + 1}`} loading="lazy" decoding="async" />
        ) : (
          <span className="history-thumb-fallback" aria-hidden="true" />
        )}
        <span className="android-history-job-index">{slot.batchIndex + 1}</span>
        <span className="android-history-job-source-label">{apiLabel}</span>
        {pixelLabel ? <span className="android-history-job-pixels">{pixelLabel}</span> : null}
      </span>
      <span className="android-history-job-slot-copy">
        <span className="android-history-job-slot-title">
          <strong>第 {slot.batchIndex + 1} 张</strong>
          <em>{apiLabel}</em>
          <b>成功</b>
        </span>
        <small>{slot.revisedPrompt || item.revisedPrompt || item.prompt}</small>
        <span className="android-history-job-badges">
          <HistoryModeBadge mode={item.mode} />
          <HistoryMetaBadges items={[sizeLabel(item.size), qualityLabel(item.quality)]} compact />
        </span>
      </span>
    </button>
  );
}
