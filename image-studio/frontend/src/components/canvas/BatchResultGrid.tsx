import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { HistoryGallerySort, HistoryItem } from "../../types/domain";
import { dataURLFromBase64, historyPreviewSrc, useBlobURL } from "../../lib/images";
import { ImagePixelSizeBadge } from "../common/ImagePixelSizeBadge";
import { sourceToDataURL } from "../../lib/virtualHostStore";
import type { BatchPendingStatus } from "../../state/batchGridStatus";
import { planBatchGridLayout } from "./batchGridLayout";
import { Modal } from "../common/Modal";
import { HistoryApiSourceBadge } from "../history/HistoryApiSourceBadge";
import type { HistoryApiSource } from "../history/historyApiSource";
import { RawResponseModal } from "../history/RawResponseModal";
import { RECENT_BATCH_SUCCESS_PIN_MS, sortBatchGridSlotsForDisplay } from "./batchGridDisplayOrder";
import { ReadImageAsBase64, RegisterMediaAsset } from "../../platform/runtime/host";

export type BatchGridSourcePreview = {
  path: string;
  name: string;
  previewUrl?: string | null;
  imageB64?: string | null;
};

export type BatchGridSlot =
  | { type: "result"; item: HistoryItem; slotIndex?: number; updatedAt?: number; sourcePreview?: BatchGridSourcePreview | null }
  | { type: "preview"; item: HistoryItem; slotIndex?: number; updatedAt?: number; sourcePreview?: BatchGridSourcePreview | null }
  | {
      type: "failed";
      id: string;
      slotIndex?: number;
      updatedAt?: number;
      groupId?: string;
      jobId?: string;
      taskId?: string;
      prompt?: string;
      label?: string;
      logMessage?: string;
      rawPath?: string;
      apiSource?: HistoryApiSource | null;
      sourcePreview?: BatchGridSourcePreview | null;
      runningHubRecoverable?: boolean;
      runningHubRecoveryLabel?: string;
      apimartRecoverable?: boolean;
      apimartRecoveryLabel?: string;
    }
  | {
      type: "pending";
      id: string;
      slotIndex?: number;
      updatedAt?: number;
      status?: BatchPendingStatus;
      taskId?: string;
      prompt?: string;
      queuedReason?: "local_concurrency" | "batch_shared_concurrency" | "continuous_pool";
      canPromote?: boolean;
      apiSource?: HistoryApiSource | null;
      sourcePreview?: BatchGridSourcePreview | null;
      apimartRecoverable?: boolean;
      apimartRecoveryLabel?: string;
    };

async function sourcePreviewToDataURL(sourcePreview: BatchGridSourcePreview): Promise<string> {
  const dataURL = await sourceToDataURL({
    path: sourcePreview.path,
    name: sourcePreview.name,
    imageB64: sourcePreview.imageB64 ?? undefined,
  }).catch(() => "");
  if (dataURL || !sourcePreview.path) return dataURL;
  const imageB64 = await ReadImageAsBase64(sourcePreview.path).catch(() => "");
  return imageB64 ? dataURLFromBase64(imageB64) : "";
}

type FailedRetryTarget = { groupId: string; jobId: string };
type TaskRetryTarget = { taskId: string };
type TaskCancelTarget = { taskId: string };
type TaskPromoteTarget = { taskId: string };
type TaskRecoverTarget = { taskId: string };

const MIN_ZOOM_COLUMNS = 1;
const DEFAULT_VIEW_COLUMNS = 6;
const MAX_MANUAL_COLUMNS = 10;

type ManualColumnsState = { columns: number } | null;

function slotIndexValue(slot: BatchGridSlot) {
  return typeof slot.slotIndex === "number" && Number.isFinite(slot.slotIndex)
    ? Math.max(0, Math.floor(slot.slotIndex))
    : null;
}

function visibleBatchIndex(slot: BatchGridSlot, fallbackIndex: number, slotIndexBase: number | null) {
  const slotIndex = slotIndexValue(slot);
  if (slotIndex !== null && slotIndexBase !== null) return Math.max(0, slotIndex - slotIndexBase);
  return fallbackIndex;
}

function compactText(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function failureLogText(slot: Extract<BatchGridSlot, { type: "failed" }>, index: number) {
  const lines = [
    `位置: 第 ${index + 1} 张`,
    slot.taskId ? `任务 ID: ${slot.taskId}` : "",
    slot.jobId ? `Job ID: ${slot.jobId}` : "",
    slot.groupId ? `任务组: ${slot.groupId}` : "",
    slot.prompt ? `Prompt: ${slot.prompt}` : "",
    compactText(slot.logMessage) ? `日志: ${compactText(slot.logMessage)}` : "",
    slot.rawPath ? `原始响应: ${slot.rawPath}` : "",
  ].filter(Boolean);
  return lines.join("\n") || `第 ${index + 1} 张生成失败 / 未返回`;
}

function failureLogSummary(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized;
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize((current) => {
        const width = Math.round(rect.width);
        const height = Math.round(rect.height);
        return current.width === width && current.height === height ? current : { width, height };
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}

function TaskSourcePreviewAnchor({
  sourcePreview,
  index,
}: {
  sourcePreview: BatchGridSourcePreview;
  index: number;
}) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const objectURL = useBlobURL(null, sourcePreview.imageB64 ?? null);
  const immediatePreviewURL = sourcePreview.previewUrl || objectURL;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties | null>(null);
  const [resolvedPreviewURL, setResolvedPreviewURL] = useState("");
  const [previewUrlFailed, setPreviewUrlFailed] = useState(false);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">(immediatePreviewURL ? "ready" : "idle");
  const open = hovered || focused;
  const previewSrc = resolvedPreviewURL || (!previewUrlFailed && immediatePreviewURL ? immediatePreviewURL : "");

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 210;
      const margin = 12;
      const left = Math.min(
        window.innerWidth - width - margin,
        Math.max(margin, rect.left + rect.width / 2 - width / 2),
      );
      const preferAbove = rect.top > 190;
      const top = preferAbove
        ? Math.max(margin, rect.top - 176)
        : Math.min(window.innerHeight - margin, rect.bottom + 10);
      setPopoverStyle({ left, top, width });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setLoadState("idle");
      return;
    }
    if (resolvedPreviewURL) {
      setLoadState("ready");
      return;
    }
    if (!sourcePreview.path) {
      setLoadState(immediatePreviewURL && !previewUrlFailed ? "ready" : "error");
      return;
    }
    let cancelled = false;
    setLoadState(immediatePreviewURL && !previewUrlFailed ? "ready" : "loading");
    sourcePreviewToDataURL(sourcePreview).then((dataURL) => {
      if (cancelled) return;
      if (dataURL) {
        setResolvedPreviewURL(dataURL);
        setLoadState("ready");
        return;
      }
      setLoadState(immediatePreviewURL && !previewUrlFailed ? "ready" : "error");
    }).catch(() => {
      if (!cancelled) setLoadState(immediatePreviewURL && !previewUrlFailed ? "ready" : "error");
    });
    return () => {
      cancelled = true;
    };
  }, [open, immediatePreviewURL, previewUrlFailed, resolvedPreviewURL, sourcePreview.imageB64, sourcePreview.name, sourcePreview.path, sourcePreview.previewUrl]);

  useEffect(() => {
    setPreviewUrlFailed(false);
    setResolvedPreviewURL("");
    setLoadState(immediatePreviewURL ? "ready" : "idle");
  }, [immediatePreviewURL, sourcePreview.path]);

  const popover = open && popoverStyle ? createPortal(
    <span
      className="batch-grid-source-popover"
      role="tooltip"
      aria-hidden="false"
      style={popoverStyle}
    >
      {previewSrc ? (
        <img
          src={previewSrc}
          alt="参考图预览"
          className="batch-grid-source-popover-image"
          decoding="async"
          draggable={false}
          onError={() => {
            if (immediatePreviewURL && previewSrc === immediatePreviewURL) {
              setPreviewUrlFailed(true);
              setLoadState("loading");
            }
          }}
        />
      ) : (
        <span className="batch-grid-source-popover-empty">
          {loadState === "loading" ? "正在读取参考图预览..." : "这张参考图暂时没有可用预览"}
        </span>
      )}
    </span>,
    document.body,
  ) : null;

  return (
    <span
      ref={anchorRef}
      className="batch-grid-source-anchor"
      data-open={open ? "true" : "false"}
      tabIndex={0}
      title="点击或悬浮预览参考图"
      aria-label={`第 ${index + 1} 张参考图预览`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onMouseDown={(event) => {
        setHovered(true);
        setFocused(true);
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      参考图
      {popover}
    </span>
  );
}

export function BatchResultGrid({
  items,
  slots,
  currentId,
  onSelect,
  onPreview,
  onOpenItemContextMenu,
  onRetryFailed,
  onRetryTask,
  onRecoverRunningHub,
  onRecoverAPIMart,
  onCancelTask,
  onPromoteTask,
  selectedTaskId,
  onSelectTask,
  onClose,
  onCloseToEmpty,
  showClose = true,
  title,
  variant = "batch",
  gallerySort = "newest",
  onGallerySortChange,
  preserveSlotOrder = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: {
  items: HistoryItem[];
  slots?: BatchGridSlot[];
  currentId: string | null;
  onSelect: (item: HistoryItem) => void | Promise<void>;
  onPreview?: (item: HistoryItem) => void | Promise<void>;
  onOpenItemContextMenu?: (item: HistoryItem, x: number, y: number) => void;
  onRetryFailed?: (slot: FailedRetryTarget) => void | Promise<void>;
  onRetryTask?: (slot: TaskRetryTarget) => void | Promise<void>;
  onRecoverRunningHub?: (slot: TaskRecoverTarget) => void | Promise<void>;
  onRecoverAPIMart?: (slot: TaskRecoverTarget) => void | Promise<void>;
  onCancelTask?: (slot: TaskCancelTarget) => void | Promise<void>;
  onPromoteTask?: (slot: TaskPromoteTarget) => void | Promise<void>;
  selectedTaskId?: string | null;
  onSelectTask?: (taskId: string | null) => void;
  onClose: () => void;
  onCloseToEmpty?: () => void;
  showClose?: boolean;
  title?: string;
  variant?: "batch" | "historyGallery";
  gallerySort?: HistoryGallerySort;
  onGallerySortChange?: (value: HistoryGallerySort) => void;
  preserveSlotOrder?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}) {
  const gridSlots = useMemo<BatchGridSlot[]>(
    () => slots ?? items.map((item) => ({ type: "result", item }) satisfies BatchGridSlot),
    [items, slots],
  );
  const { ref: gridRef, size: gridSize } = useElementSize<HTMLDivElement>();
  const [manualColumns, setManualColumns] = useState<ManualColumnsState>(null);
  const [recentSuccessClock, setRecentSuccessClock] = useState(() => Date.now());
  const autoLayout = useMemo(
    () => planBatchGridLayout(gridSlots.length, gridSize.width, gridSize.height),
    [gridSlots.length, gridSize.width, gridSize.height],
  );
  const defaultColumns = Math.min(autoLayout.columns, DEFAULT_VIEW_COLUMNS);
  const minColumns = Math.min(defaultColumns, MIN_ZOOM_COLUMNS);
  const maxColumns = MAX_MANUAL_COLUMNS;
  const manualColumnValue = manualColumns && typeof manualColumns === "object" ? manualColumns.columns : null;
  const effectiveColumns = Math.max(minColumns, Math.min(maxColumns, manualColumnValue ?? defaultColumns));
  const layout = useMemo(
    () => {
      if (effectiveColumns === autoLayout.columns) return autoLayout;
      return planBatchGridLayout(gridSlots.length, gridSize.width, gridSize.height, {
        columnsOverride: effectiveColumns,
      });
    },
    [autoLayout, effectiveColumns, gridSlots.length, gridSize.width, gridSize.height],
  );

  useEffect(() => {
    setManualColumns(null);
  }, [gridSlots.length]);

  const canDecreaseColumns = effectiveColumns > minColumns;
  const canIncreaseColumns = effectiveColumns < maxColumns;
  const preserveDisplayOrder = onGallerySortChange
    ? gallerySort === "oldest"
    : preserveSlotOrder;
  useEffect(() => {
    if (variant === "historyGallery") return;
    const now = Date.now();
    const nextExpiry = gridSlots.reduce((earliest, slot) => {
      if (slot.type !== "result") return earliest;
      const completedAt = Number(slot.updatedAt || 0);
      const expiresAt = completedAt > 0 ? completedAt + RECENT_BATCH_SUCCESS_PIN_MS : 0;
      return expiresAt > now && expiresAt < earliest ? expiresAt : earliest;
    }, Number.POSITIVE_INFINITY);
    if (!Number.isFinite(nextExpiry)) return;
    const timer = window.setTimeout(
      () => setRecentSuccessClock(Date.now()),
      Math.max(0, nextExpiry - now) + 20,
    );
    return () => window.clearTimeout(timer);
  }, [gridSlots, recentSuccessClock, variant]);
  const displaySlots = useMemo(() => {
    const mapped = gridSlots.map((slot, index) => ({
      slot,
      originalIndex: index,
      recentSuccessUntil: slot.type === "result" && Number(slot.updatedAt || 0) > 0
        ? Number(slot.updatedAt) + RECENT_BATCH_SUCCESS_PIN_MS
        : undefined,
    }));
    if (variant === "historyGallery") return mapped;
    return sortBatchGridSlotsForDisplay(mapped, preserveDisplayOrder, Math.max(recentSuccessClock, Date.now()));
  }, [gridSlots, preserveDisplayOrder, recentSuccessClock, variant]);
  const slotIndexBase = useMemo(() => {
    if (variant === "historyGallery") return null;
    const indexes = gridSlots
      .map((slot) => slotIndexValue(slot))
      .filter((index): index is number => index !== null);
    return indexes.length > 0 ? Math.min(...indexes) : null;
  }, [gridSlots, variant]);
  const rowCount = Math.ceil(displaySlots.length / Math.max(1, layout.columns));
  const rowStride = layout.tileHeight + layout.gap;
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => gridRef.current,
    estimateSize: () => rowStride,
    initialRect: {
      width: Math.max(1, gridSize.width),
      height: Math.max(1, gridSize.height),
    },
    overscan: 3,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const previousLayoutRef = useRef({ columns: layout.columns, rowStride });

  useEffect(() => {
    if (variant !== "historyGallery" || !hasMore || loadingMore || rowCount === 0) return;
    const lastVisibleRow = virtualRows[virtualRows.length - 1]?.index ?? -1;
    if (lastVisibleRow >= rowCount - 3) onLoadMore?.();
  }, [hasMore, loadingMore, onLoadMore, rowCount, variant, virtualRows]);

  useLayoutEffect(() => {
    const element = gridRef.current;
    const previous = previousLayoutRef.current;
    if (element && previous.columns !== layout.columns) {
      const topItemIndex = Math.floor(element.scrollTop / Math.max(1, previous.rowStride)) * previous.columns;
      element.scrollTop = Math.floor(topItemIndex / Math.max(1, layout.columns)) * rowStride;
    }
    previousLayoutRef.current = { columns: layout.columns, rowStride };
    virtualizer.measure();
  }, [layout.columns, rowStride, virtualizer]);

  return (
    <div className="batch-grid-overlay" data-variant={variant}>
      <div className="batch-grid-head">
        <span className="batch-grid-title">{title ?? `本批结果 · ${items.length} 张`}</span>
        <div className="batch-grid-head-actions">
          {onGallerySortChange ? (
            <div className="batch-grid-sort-controls" aria-label={variant === "historyGallery" ? "完整相册时间排序" : "批次排列顺序"}>
              <button
                type="button"
                className={`batch-grid-sort-button ${gallerySort === "newest" ? "active" : ""}`}
                onClick={() => onGallerySortChange("newest")}
                aria-pressed={gallerySort === "newest"}
              >
                最新优先
              </button>
              <button
                type="button"
                className={`batch-grid-sort-button ${gallerySort === "oldest" ? "active" : ""}`}
                onClick={() => onGallerySortChange("oldest")}
                aria-pressed={gallerySort === "oldest"}
              >
                最早优先
              </button>
            </div>
          ) : null}
          <div className="batch-grid-zoom-controls" aria-label="调整批量结果视图大小">
            <button
              type="button"
              className="batch-grid-zoom-button"
              onClick={() => {
                const nextColumns = Math.max(minColumns, effectiveColumns - 1);
                setManualColumns(nextColumns === defaultColumns ? null : { columns: nextColumns });
              }}
              disabled={!canDecreaseColumns}
              title="减少每行张数"
              aria-label="减少每行张数"
            >
              -
            </button>
            <span className="batch-grid-zoom-label">每行 {layout.columns} 张</span>
            <button
              type="button"
              className="batch-grid-zoom-button"
              onClick={() => {
                const nextColumns = Math.min(maxColumns, effectiveColumns + 1);
                setManualColumns(nextColumns === defaultColumns ? null : { columns: nextColumns });
              }}
              disabled={!canIncreaseColumns}
              title="增加每行张数，最多 10 张"
              aria-label="增加每行张数，最多 10 张"
            >
              +
            </button>
          </div>
          {variant === "historyGallery" && onCloseToEmpty ? (
            <button
              type="button"
              className="batch-grid-close batch-grid-close-empty"
              onClick={onCloseToEmpty}
              title="关闭完整相册并回到空白工作台"
            >
              关闭查看
            </button>
          ) : null}
          {showClose ? (
            <button type="button" className="batch-grid-close" onClick={onClose} title="返回当前图">
              返回当前图
            </button>
          ) : null}
        </div>
      </div>
      <div
        ref={gridRef}
        className="batch-grid"
        data-density={layout.density}
        onWheel={(event) => event.stopPropagation()}
      >
        <div className="batch-grid-virtual-spacer" style={{ height: virtualizer.getTotalSize() }}>
          {virtualRows.map((virtualRow) => {
            const rowStart = virtualRow.index * layout.columns;
            const rowSlots = displaySlots.slice(rowStart, rowStart + layout.columns);
            return (
              <div
                key={virtualRow.key}
                className="batch-grid-virtual-row"
                data-row-index={virtualRow.index}
                style={{
                  width: `${layout.columns * layout.tileWidth + Math.max(0, layout.columns - 1) * layout.gap}px`,
                  height: `${layout.tileHeight}px`,
                  gridTemplateColumns: `repeat(${layout.columns}, minmax(0, ${layout.tileWidth}px))`,
                  gridAutoRows: `${layout.tileHeight}px`,
                  gap: `${layout.gap}px`,
                  transform: `translate(-50%, ${virtualRow.start}px)`,
                }}
              >
                {rowSlots.map(({ slot, originalIndex }) => {
                  const displayIndex = visibleBatchIndex(slot, originalIndex, slotIndexBase);
                  if (slot.type === "pending") {
                    return (
                      <PendingGridTile
                        key={slot.id}
                        index={displayIndex}
                        slot={slot}
                        selected={!!slot.taskId && slot.taskId === selectedTaskId}
                        onSelectTask={onSelectTask}
                        onRetryTask={onRetryTask}
                        onCancelTask={onCancelTask}
                        onPromoteTask={onPromoteTask}
                        onRecoverAPIMart={onRecoverAPIMart}
                      />
                    );
                  }
                  if (slot.type === "failed") {
                    return (
                      <FailedGridTile
                        key={slot.id}
                        index={displayIndex}
                        slot={slot}
                        selected={!!slot.taskId && slot.taskId === selectedTaskId}
                        onSelectTask={onSelectTask}
                        onRetryFailed={onRetryFailed}
                        onRetryTask={onRetryTask}
                        onRecoverRunningHub={onRecoverRunningHub}
                        onRecoverAPIMart={onRecoverAPIMart}
                      />
                    );
                  }
                  return (
                    <BatchGridTile
                      key={slot.item.id}
                      item={slot.item}
                      index={displayIndex}
                      active={slot.type === "result" && slot.item.id === currentId}
                      preview={slot.type === "preview"}
                      sourcePreview={slot.sourcePreview}
                      onOpenItemContextMenu={onOpenItemContextMenu}
                      onSelect={onSelect}
                      onPreview={onPreview}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const BatchGridTile = memo(function BatchGridTile({
  item,
  index,
  active,
  preview,
  sourcePreview,
  onOpenItemContextMenu,
  onSelect,
  onPreview,
}: {
  item: HistoryItem;
  index: number;
  active: boolean;
  preview: boolean;
  sourcePreview?: BatchGridSourcePreview | null;
  onOpenItemContextMenu?: (item: HistoryItem, x: number, y: number) => void;
  onSelect: (item: HistoryItem) => void | Promise<void>;
  onPreview?: (item: HistoryItem) => void | Promise<void>;
}) {
  const previewURL = useBlobURL(item.imageBlob ?? item.previewBlob ?? null, item.imageB64 ?? null);
  const [registeredPreviewURL, setRegisteredPreviewURL] = useState("");
  const src = historyPreviewSrc(
    registeredPreviewURL ? { ...item, previewUrl: registeredPreviewURL } : item,
    previewURL,
  );
  useEffect(() => {
    if (src || !item.savedPath || item.savedPath.startsWith("memory://")) return;
    let cancelled = false;
    void RegisterMediaAsset(item.savedPath, item.thumbPath || "")
      .then((ref) => {
        if (!cancelled && ref.previewUrl) setRegisteredPreviewURL(ref.previewUrl);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [item.savedPath, item.thumbPath, src]);
  return (
    <button
      type="button"
      className={`batch-grid-tile ${active ? "active" : ""} ${preview ? "previewing" : ""}`}
      onClick={() => {
        if (!preview) void onSelect(item);
      }}
      onDoubleClick={() => {
        if (!preview) void (onPreview ?? onSelect)(item);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenItemContextMenu?.(item, event.clientX, event.clientY);
      }}
      aria-disabled={preview ? "true" : undefined}
      title={item.prompt}
    >
      <span className="batch-grid-image-shell" aria-hidden="true">
        <img
          src={src}
          alt={item.prompt || `batch result ${index + 1}`}
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      </span>
      {sourcePreview ? <TaskSourcePreviewAnchor sourcePreview={sourcePreview} index={index} /> : null}
      <span className="batch-grid-index">{index + 1}</span>
      <HistoryApiSourceBadge source={item} className="batch-grid-api-source rounded-[6px]" />
      {!preview ? <ImagePixelSizeBadge width={item.width} height={item.height} className="batch-grid-pixel-size" /> : null}
      {preview ? (
        <span className="batch-grid-preview-wait">生成中预览，不是最终结果</span>
      ) : null}
      {!preview && item.elapsedSec ? <span className="batch-grid-meta">{item.elapsedSec}s</span> : null}
    </button>
  );
});

const PENDING_STATUS_VIEW: Record<BatchPendingStatus, {
  label: string;
  title: string;
  loading: boolean;
  badge: string;
  badgeTone: "processing" | "queued" | "warning" | "muted";
}> = {
  waiting: {
    label: "等待结果",
    title: "任务已提交，正在等待上游返回预览图或最终图。白色卡片表示这张图还在处理中。",
    loading: true,
    badge: "处理中",
    badgeTone: "processing",
  },
  local_queued: {
    label: "等待并发",
    title: "任务还在本地并发队列里，暂时还没有提交给上游。绿色卡片表示它仍停留在本地排队阶段。",
    loading: false,
    badge: "未提交",
    badgeTone: "queued",
  },
  submitting: {
    label: "正在提交",
    title: "任务已预留 API 并发位，正在批量注册独立后台任务。",
    loading: true,
    badge: "提交中",
    badgeTone: "processing",
  },
  queued: {
    label: "等待生成",
    title: "任务已经进入队列，正在等待开始生成。白色卡片表示这张图还在处理中。",
    loading: true,
    badge: "处理中",
    badgeTone: "processing",
  },
  running: {
    label: "正在生成",
    title: "任务正在生成，但现在还没拿到最终图。白色卡片表示这张图还在处理中。",
    loading: true,
    badge: "处理中",
    badgeTone: "processing",
  },
  missing: {
    label: "旧记录缺失",
    title: "这是旧测试数据留下的空槽位，没有完整任务记录。新生成任务通常不会再出现这个状态。",
    loading: false,
    badge: "旧记录",
    badgeTone: "muted",
  },
  succeeded_no_image: {
    label: "最终图缺失",
    title: "任务流程已经结束，但没有找到可展示的最终图片文件。黄色卡片表示这格缺少最终图，可以直接重新生成。",
    loading: false,
    badge: "最终图缺失",
    badgeTone: "warning",
  },
  cancelled: {
    label: "已取消",
    title: "这个任务已经取消，可以按原参数重新生成。",
    loading: false,
    badge: "已取消",
    badgeTone: "muted",
  },
};

const SHARED_BATCH_LOCAL_QUEUE_VIEW = {
  label: "等待 API 并发空位",
  title: "这张批量图还在 API 并发队列里，等连续生成或批量图生图腾出空闲并发位后才会开始。绿色卡片表示它还没有提交给上游。",
  loading: false,
  badge: "未提交",
  badgeTone: "queued",
} as const;

function PendingGridTile({
  index,
  slot,
  selected,
  onSelectTask,
  onRetryTask,
  onCancelTask,
  onPromoteTask,
  onRecoverAPIMart,
}: {
  index: number;
  slot: Extract<BatchGridSlot, { type: "pending" }>;
  selected: boolean;
  onSelectTask?: (taskId: string | null) => void;
  onRetryTask?: (slot: TaskRetryTarget) => void | Promise<void>;
  onCancelTask?: (slot: TaskCancelTarget) => void | Promise<void>;
  onPromoteTask?: (slot: TaskPromoteTarget) => void | Promise<void>;
  onRecoverAPIMart?: (slot: TaskRecoverTarget) => void | Promise<void>;
}) {
  const status = slot.status ?? "waiting";
  const view = status === "local_queued" && slot.queuedReason === "batch_shared_concurrency"
    ? SHARED_BATCH_LOCAL_QUEUE_VIEW
    : PENDING_STATUS_VIEW[status];
  const canRetry = !!slot.taskId && (status === "cancelled" || status === "succeeded_no_image");
  const canCancel = !!slot.taskId && !!onCancelTask && (status === "queued" || status === "local_queued" || status === "submitting" || status === "running");
  const canPromote = !!slot.taskId && !!onPromoteTask && slot.canPromote === true;
  const canRecoverAPIMart = !!(slot.taskId && slot.apimartRecoverable && onRecoverAPIMart && (status === "cancelled" || status === "succeeded_no_image"));
  const selectable = !!onSelectTask && !!slot.taskId && (status === "queued" || status === "local_queued" || status === "submitting" || status === "running" || status === "cancelled");
  const cancelTitle = status === "running"
    ? "尽力取消这个运行任务；可能已计费"
    : status === "submitting"
      ? "取消这个正在提交的任务"
      : "取消这个排队任务";
  return (
    <div
      className={`batch-grid-tile pending pending-${status} ${canCancel ? "can-cancel" : ""} ${canPromote ? "can-promote" : ""} ${selected ? "task-selected" : ""} ${selectable ? "task-selectable" : ""}`}
      aria-label={`第 ${index + 1} 张 ${view.label}`}
      title={canCancel ? `${view.title} ${cancelTitle}。` : view.title}
      role={selectable ? "button" : undefined}
      tabIndex={selectable ? 0 : undefined}
      onClick={() => {
        if (selectable) onSelectTask?.(slot.taskId!);
      }}
      onKeyDown={(event) => {
        if (!selectable) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectTask?.(slot.taskId!);
        }
      }}
    >
      {slot.sourcePreview ? <TaskSourcePreviewAnchor sourcePreview={slot.sourcePreview} index={index} /> : null}
      {slot.apiSource ? <HistoryApiSourceBadge source={slot.apiSource} className="batch-grid-api-source rounded-[6px]" /> : null}
      <span className="batch-grid-index">{index + 1}</span>
      <span className={`batch-grid-status-chip batch-grid-status-chip-${view.badgeTone}`}>{view.badge}</span>
      {slot.apimartRecoveryLabel ? (
        <span className="batch-grid-recovery-chip">{slot.apimartRecoveryLabel}</span>
      ) : null}
      {view.loading ? (
        <span className="batch-grid-pending-ring" />
      ) : (
        <span className="batch-grid-pending-static-mark" />
      )}
      {status === "succeeded_no_image" ? <span className="batch-grid-failure-heading">生成失败</span> : null}
      <span className="batch-grid-pending-label">{view.label}</span>
      {canPromote ? (
        <button
          type="button"
          className="batch-grid-promote-button"
          title="立即提交这个排队任务，新增一个并发；不打断当前生成"
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            void onPromoteTask?.({ taskId: slot.taskId! });
          }}
        >
          立即插队
        </button>
      ) : null}
      {canCancel ? (
        <button
          type="button"
          className="batch-grid-cancel-button"
          title={cancelTitle}
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            void onCancelTask?.({ taskId: slot.taskId! });
          }}
        >
          取消任务
        </button>
      ) : null}
      {canRetry ? (
        <button
          type="button"
          className="batch-grid-retry-button"
          title={slot.prompt ? `重新生成: ${slot.prompt}` : "重新生成这个位置"}
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            void onRetryTask?.({ taskId: slot.taskId! });
          }}
        >
          重新生成
        </button>
      ) : null}
      {canRecoverAPIMart ? (
        <button
          type="button"
          className={`batch-grid-recover-button ${canRetry || canCancel || canPromote ? "stacked" : "solo"}`}
          title="重新同步 APIMart 后台里已经完成的结果"
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            void onRecoverAPIMart?.({ taskId: slot.taskId! });
          }}
        >
          重新同步 APIMart 结果
        </button>
      ) : null}
    </div>
  );
}

function FailedGridTile({
  index,
  slot,
  selected,
  onSelectTask,
  onRetryFailed,
  onRetryTask,
  onRecoverRunningHub,
  onRecoverAPIMart,
}: {
  index: number;
  slot: Extract<BatchGridSlot, { type: "failed" }>;
  selected: boolean;
  onSelectTask?: (taskId: string | null) => void;
  onRetryFailed?: (slot: FailedRetryTarget) => void | Promise<void>;
  onRetryTask?: (slot: TaskRetryTarget) => void | Promise<void>;
  onRecoverRunningHub?: (slot: TaskRecoverTarget) => void | Promise<void>;
  onRecoverAPIMart?: (slot: TaskRecoverTarget) => void | Promise<void>;
}) {
  const canRetryTask = !!(slot.taskId && onRetryTask);
  const canRetryFailed = !!(slot.groupId && slot.jobId && onRetryFailed);
  const canRetry = canRetryTask || canRetryFailed;
  const canRecoverRunningHub = !!(slot.taskId && slot.runningHubRecoverable && onRecoverRunningHub);
  const canRecoverAPIMart = !!(slot.taskId && slot.apimartRecoverable && onRecoverAPIMart);
  const [logOpen, setLogOpen] = useState(false);
  const logText = failureLogText(slot, index);
  const logSummary = failureLogSummary(logText);
  return (
    <div
      className={`batch-grid-tile failed ${selected ? "task-selected" : ""} ${slot.taskId ? "task-selectable" : ""} ${canRecoverRunningHub ? "can-recover-runninghub" : ""} ${canRecoverAPIMart ? "can-recover-apimart" : ""}`}
      aria-label={`第 ${index + 1} 张生成失败或未返回，点击感叹号查看日志`}
      role={slot.taskId ? "button" : undefined}
      tabIndex={slot.taskId ? 0 : undefined}
      onClick={() => {
        if (slot.taskId) onSelectTask?.(slot.taskId);
      }}
      onKeyDown={(event) => {
        if (!slot.taskId) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectTask?.(slot.taskId!);
        }
      }}
    >
      {slot.sourcePreview ? <TaskSourcePreviewAnchor sourcePreview={slot.sourcePreview} index={index} /> : null}
      {slot.apiSource ? <HistoryApiSourceBadge source={slot.apiSource} className="batch-grid-api-source rounded-[6px]" /> : null}
      <span className="batch-grid-index">{index + 1}</span>
      {slot.runningHubRecoveryLabel ? (
        <span className="batch-grid-recovery-chip">{slot.runningHubRecoveryLabel}</span>
      ) : null}
      {slot.apimartRecoveryLabel ? (
        <span className="batch-grid-recovery-chip">{slot.apimartRecoveryLabel}</span>
      ) : null}
      <button
        type="button"
        className="batch-grid-failed-mark batch-grid-failed-log-button"
        aria-label={`查看第 ${index + 1} 张失败日志`}
        title={logSummary}
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          setLogOpen(true);
        }}
      >
        !
        <span className="batch-grid-failed-log-tooltip">{logSummary}</span>
      </button>
      <span className="batch-grid-failure-heading">生成失败</span>
      <span className="batch-grid-failed-label">{slot.label ?? "生成失败 / 未返回"}</span>
      {canRetry ? (
        <button
          type="button"
          className="batch-grid-retry-button"
          title={slot.prompt ? `重新生成: ${slot.prompt}` : "重新生成这个位置"}
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            if (canRetryTask) {
              void onRetryTask?.({ taskId: slot.taskId! });
            } else {
              void onRetryFailed?.({ groupId: slot.groupId!, jobId: slot.jobId! });
            }
          }}
        >
          重新生成
        </button>
      ) : null}
      {canRecoverRunningHub ? (
        <button
          type="button"
          className={`batch-grid-recover-button ${canRetry ? "stacked" : "solo"}`}
          title="重新同步 RunningHub 桥接里可能已经完成的结果"
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            void onRecoverRunningHub?.({ taskId: slot.taskId! });
          }}
        >
          重新同步 RH 结果
        </button>
      ) : null}
      {canRecoverAPIMart ? (
        <button
          type="button"
          className={`batch-grid-recover-button ${canRetry || canRecoverRunningHub ? "stacked" : "solo"}`}
          title="重新同步 APIMart 后台里已经完成的结果"
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            void onRecoverAPIMart?.({ taskId: slot.taskId! });
          }}
        >
          重新同步 APIMart 结果
        </button>
      ) : null}
      {logOpen ? (
        <FailureLogModal
          index={index}
          logText={logText}
          rawPath={slot.rawPath}
          onRecoverRunningHub={canRecoverRunningHub ? () => onRecoverRunningHub?.({ taskId: slot.taskId! }) : undefined}
          onRecoverAPIMart={canRecoverAPIMart ? () => onRecoverAPIMart?.({ taskId: slot.taskId! }) : undefined}
          onClose={() => setLogOpen(false)}
        />
      ) : null}
    </div>
  );
}

function FailureLogModal({
  index,
  logText,
  onClose,
  rawPath,
  onRecoverRunningHub,
  onRecoverAPIMart,
}: {
  index: number;
  logText: string;
  onClose: () => void;
  rawPath?: string;
  onRecoverRunningHub?: (() => void | Promise<void>) | undefined;
  onRecoverAPIMart?: (() => void | Promise<void>) | undefined;
}) {
  const [rawOpen, setRawOpen] = useState(false);
  return (
    <>
      <Modal open onClose={onClose} title={`第 ${index + 1} 张失败日志`} width={720}>
        <div className="batch-grid-failure-log-modal">
          <pre className="batch-grid-failure-log-pre">{logText}</pre>
          {rawPath || onRecoverRunningHub || onRecoverAPIMart ? (
            <div className="batch-grid-failure-log-actions">
              {onRecoverRunningHub ? (
                <button
                  type="button"
                  className="batch-grid-failure-log-raw-button"
                  onClick={() => {
                    void onRecoverRunningHub();
                    onClose();
                  }}
                >
                  重新同步 RH 结果
                </button>
              ) : null}
              {onRecoverAPIMart ? (
                <button
                  type="button"
                  className="batch-grid-failure-log-raw-button"
                  onClick={() => {
                    void onRecoverAPIMart();
                    onClose();
                  }}
                >
                  重新同步 APIMart 结果
                </button>
              ) : null}
              <button
                type="button"
                className="batch-grid-failure-log-raw-button"
                onClick={() => setRawOpen(true)}
                disabled={!rawPath}
              >
                查看原始响应
              </button>
            </div>
          ) : null}
        </div>
      </Modal>
      {rawOpen && rawPath ? <RawResponseModal path={rawPath} onClose={() => setRawOpen(false)} /> : null}
    </>
  );
}
