import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { APIMartRecoveryTask, HistoryItem, JobGroupSnapshot, JobSlotSnapshot } from "../../types/domain";
import { historyPreviewSrc, useBlobURL } from "../../lib/images";
import { pixelSizeLabel } from "../history/historyLabels";
import {
  ANDROID_BATCH_GRID_COLUMNS,
  androidBatchGridMetrics,
  androidBatchGridWindow,
  type AndroidBatchGridWindow,
} from "./androidBatchGridVirtualization.ts";

export type BatchGridLayoutMode = "adaptive" | "android-virtualized";

export type BatchGridSlot =
  | { type: "result"; item: HistoryItem; apiLabel?: string }
  | { type: "preview"; item: HistoryItem; apiLabel?: string }
  | { type: "failed"; id: string; apiLabel?: string; recoveryTask?: APIMartRecoveryTask; jobGroup?: JobGroupSnapshot; jobSlot?: JobSlotSnapshot }
  | { type: "pending"; id: string; apiLabel?: string; jobGroup?: JobGroupSnapshot; jobSlot?: JobSlotSnapshot };

export function BatchResultGrid({
  items,
  slots,
  currentId,
  onSelect,
  onClose,
  showClose = true,
  title,
  apiLabel,
  layoutMode = "adaptive",
  batchIdentity,
  onApplyJobSlotParams,
  onRegenerateJobSlot,
  onQueryAPIMartTask,
}: {
  items: HistoryItem[];
  slots?: BatchGridSlot[];
  currentId: string | null;
  onSelect: (item: HistoryItem) => void | Promise<void>;
  onClose: () => void;
  showClose?: boolean;
  title?: string;
  apiLabel?: string;
  layoutMode?: BatchGridLayoutMode;
  batchIdentity?: string;
  onApplyJobSlotParams?: (group: JobGroupSnapshot, slot: JobSlotSnapshot) => void;
  onRegenerateJobSlot?: (group: JobGroupSnapshot, slot: JobSlotSnapshot) => void | Promise<void>;
  onQueryAPIMartTask?: (taskId: string) => void | Promise<void>;
}) {
  const gridSlots = slots ?? items.map((item) => ({ type: "result", item }) satisfies BatchGridSlot);
  const columns = gridSlots.length <= 2 ? 2 : gridSlots.length <= 4 ? 2 : 3;
  const androidVirtualized = layoutMode === "android-virtualized";
  return (
    <div
      className={`batch-grid-overlay ${androidVirtualized ? "batch-grid-overlay-virtualized" : ""}`}
      data-batch-grid-layout={layoutMode}
    >
      <div className="batch-grid-head">
        <span className="batch-grid-title">{title ?? `本批结果 · ${items.length} 张`}</span>
        {showClose ? (
          <button type="button" className="batch-grid-close" onClick={onClose} title="返回当前图">
            返回当前图
          </button>
        ) : null}
      </div>
      {androidVirtualized ? (
        <AndroidVirtualizedBatchGrid
          slots={gridSlots}
          currentId={currentId}
          onSelect={onSelect}
          apiLabel={apiLabel}
          batchIdentity={batchIdentity ?? "android-batch"}
          onApplyJobSlotParams={onApplyJobSlotParams}
          onRegenerateJobSlot={onRegenerateJobSlot}
          onQueryAPIMartTask={onQueryAPIMartTask}
        />
      ) : (
        <div
          className="batch-grid"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {gridSlots.map((slot, index) => (
            <BatchGridSlotView
              key={batchGridSlotKey(slot, index)}
              slot={slot}
              index={index}
              currentId={currentId}
              onSelect={onSelect}
              apiLabel={apiLabel}
              lazyImage={false}
              onApplyJobSlotParams={onApplyJobSlotParams}
              onRegenerateJobSlot={onRegenerateJobSlot}
              onQueryAPIMartTask={onQueryAPIMartTask}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function batchGridSlotKey(slot: BatchGridSlot, index: number) {
  if (slot.type === "result" || slot.type === "preview") return slot.item.id;
  return slot.id || `batch-slot-${index}`;
}

function sameAndroidBatchGridWindow(a: AndroidBatchGridWindow, b: AndroidBatchGridWindow) {
  return a.startRow === b.startRow
    && a.endRow === b.endRow
    && a.totalRows === b.totalRows
    && a.totalHeight === b.totalHeight;
}

function AndroidVirtualizedBatchGrid({
  slots,
  currentId,
  onSelect,
  apiLabel,
  batchIdentity,
  onApplyJobSlotParams,
  onRegenerateJobSlot,
  onQueryAPIMartTask,
}: {
  slots: BatchGridSlot[];
  currentId: string | null;
  onSelect: (item: HistoryItem) => void | Promise<void>;
  apiLabel?: string;
  batchIdentity: string;
  onApplyJobSlotParams?: (group: JobGroupSnapshot, slot: JobSlotSnapshot) => void;
  onRegenerateJobSlot?: (group: JobGroupSnapshot, slot: JobSlotSnapshot) => void | Promise<void>;
  onQueryAPIMartTask?: (taskId: string) => void | Promise<void>;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const updateVirtualWindowRef = useRef<(scrollTop: number, viewportHeight?: number) => void>(() => {});
  const [viewport, setViewport] = useState({ width: 360, height: 600 });
  const metrics = useMemo(() => androidBatchGridMetrics(viewport.width), [viewport.width]);
  const calculateWindow = useCallback((scrollTop: number, viewportHeight = viewport.height) => (
    androidBatchGridWindow({
      itemCount: slots.length,
      scrollTop,
      viewportHeight,
      rowStride: metrics.rowStride,
      rowHeight: metrics.rowHeight,
    })
  ), [metrics.rowHeight, metrics.rowStride, slots.length, viewport.height]);
  const [virtualWindow, setVirtualWindow] = useState(() => androidBatchGridWindow({
    itemCount: slots.length,
    scrollTop: 0,
    viewportHeight: 600,
    rowStride: androidBatchGridMetrics(360).rowStride,
    rowHeight: androidBatchGridMetrics(360).rowHeight,
  }));

  const updateVirtualWindow = useCallback((scrollTop: number, viewportHeight?: number) => {
    const next = calculateWindow(scrollTop, viewportHeight);
    setVirtualWindow((current) => sameAndroidBatchGridWindow(current, next) ? current : next);
  }, [calculateWindow]);
  updateVirtualWindowRef.current = updateVirtualWindow;

  useLayoutEffect(() => {
    const viewportElement = viewportRef.current;
    if (!viewportElement) return;
    const measure = () => {
      const next = {
        width: viewportElement.clientWidth || 360,
        height: viewportElement.clientHeight || 600,
      };
      setViewport((current) => (
        current.width === next.width && current.height === next.height ? current : next
      ));
    };
    measure();
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    resizeObserver?.observe(viewportElement);
    window.addEventListener("resize", measure);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useLayoutEffect(() => {
    const viewportElement = viewportRef.current;
    updateVirtualWindow(viewportElement?.scrollTop ?? 0, viewportElement?.clientHeight ?? viewport.height);
  }, [metrics.rowHeight, metrics.rowStride, slots.length, updateVirtualWindow, viewport.height]);

  useEffect(() => {
    const viewportElement = viewportRef.current;
    if (!viewportElement) return;
    const handleScroll = () => {
      if (animationFrameRef.current !== null) return;
      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null;
        updateVirtualWindow(viewportElement.scrollTop, viewportElement.clientHeight);
      });
    };
    viewportElement.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      viewportElement.removeEventListener("scroll", handleScroll);
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [updateVirtualWindow]);

  useLayoutEffect(() => {
    const viewportElement = viewportRef.current;
    if (!viewportElement) return;
    viewportElement.scrollTop = 0;
    updateVirtualWindowRef.current(0, viewportElement.clientHeight);
  }, [batchIdentity]);

  const rows = [];
  for (let rowIndex = virtualWindow.startRow; rowIndex < virtualWindow.endRow; rowIndex += 1) {
    const firstItemIndex = rowIndex * ANDROID_BATCH_GRID_COLUMNS;
    const rowSlots = slots.slice(firstItemIndex, firstItemIndex + ANDROID_BATCH_GRID_COLUMNS);
    rows.push(
      <div
        key={`batch-row-${rowIndex}`}
        className="batch-grid-virtual-row"
        data-batch-grid-row={rowIndex}
        style={{
          height: `${metrics.rowHeight}px`,
          top: `${rowIndex * metrics.rowStride}px`,
        }}
      >
        {rowSlots.map((slot, columnIndex) => {
          const index = firstItemIndex + columnIndex;
          return (
            <BatchGridSlotView
              key={batchGridSlotKey(slot, index)}
              slot={slot}
              index={index}
              currentId={currentId}
              onSelect={onSelect}
              apiLabel={apiLabel}
              lazyImage
              onApplyJobSlotParams={onApplyJobSlotParams}
              onRegenerateJobSlot={onRegenerateJobSlot}
              onQueryAPIMartTask={onQueryAPIMartTask}
            />
          );
        })}
      </div>,
    );
  }

  return (
    <div
      ref={viewportRef}
      className="batch-grid batch-grid-virtual-scroll"
      data-batch-grid-total-rows={virtualWindow.totalRows}
      data-batch-grid-start-row={virtualWindow.startRow}
      data-batch-grid-end-row={virtualWindow.endRow}
    >
      <div
        className="batch-grid-virtual-content"
        style={{ height: `${virtualWindow.totalHeight}px` }}
      >
        {rows}
      </div>
    </div>
  );
}

const BatchGridSlotView = memo(function BatchGridSlotView({
  slot,
  index,
  currentId,
  onSelect,
  apiLabel,
  lazyImage,
  onApplyJobSlotParams,
  onRegenerateJobSlot,
  onQueryAPIMartTask,
}: {
  slot: BatchGridSlot;
  index: number;
  currentId: string | null;
  onSelect: (item: HistoryItem) => void | Promise<void>;
  apiLabel?: string;
  lazyImage: boolean;
  onApplyJobSlotParams?: (group: JobGroupSnapshot, slot: JobSlotSnapshot) => void;
  onRegenerateJobSlot?: (group: JobGroupSnapshot, slot: JobSlotSnapshot) => void | Promise<void>;
  onQueryAPIMartTask?: (taskId: string) => void | Promise<void>;
}) {
  const slotApiLabel = apiLabelForGridSlot(slot, apiLabel);
  if (slot.type === "pending") {
    return <PendingGridTile index={index} apiLabel={slotApiLabel} />;
  }
  if (slot.type === "failed") {
    return (
      <FailedGridTile
        index={index}
        apiLabel={slotApiLabel}
        recoveryTask={slot.recoveryTask}
        jobGroup={slot.jobGroup}
        jobSlot={slot.jobSlot}
        onApplyJobSlotParams={onApplyJobSlotParams}
        onRegenerateJobSlot={onRegenerateJobSlot}
        onQueryAPIMartTask={onQueryAPIMartTask}
      />
    );
  }
  return (
    <BatchGridTile
      item={slot.item}
      index={index}
      active={slot.type === "result" && slot.item.id === currentId}
      preview={slot.type === "preview"}
      onSelect={onSelect}
      apiLabel={slotApiLabel}
      lazyImage={lazyImage}
    />
  );
});

function apiLabelForGridSlot(slot: BatchGridSlot, fallback?: string) {
  const itemLabel = (slot.type === "result" || slot.type === "preview")
    ? slot.item.apiLabel?.trim()
    : "";
  const slotLabel = slot.apiLabel?.trim();
  const groupLabel = (slot.type === "pending" || slot.type === "failed")
    ? slot.jobGroup?.apiLabel?.trim()
    : "";
  const modeLabel = (slot.type === "pending" || slot.type === "failed")
    ? apiModeFallbackLabel(slot.jobGroup?.apiMode)
    : "";
  return itemLabel || slotLabel || groupLabel || modeLabel || fallback;
}

function apiModeFallbackLabel(apiMode?: JobGroupSnapshot["apiMode"]) {
  if (apiMode === "apimart") return "APIMart";
  if (apiMode === "responses") return "Responses";
  if (apiMode === "images") return "Images";
  return "";
}

function BatchGridTile({
  item,
  index,
  active,
  preview,
  onSelect,
  apiLabel,
  lazyImage,
}: {
  item: HistoryItem;
  index: number;
  active: boolean;
  preview: boolean;
  onSelect: (item: HistoryItem) => void | Promise<void>;
  apiLabel?: string;
  lazyImage: boolean;
}) {
  const previewURL = useBlobURL(item.imageBlob ?? item.previewBlob ?? null, item.imageB64 ?? null);
  const src = historyPreviewSrc(item, previewURL);
  const pixelLabel = pixelSizeLabel(item);
  return (
    <button
      type="button"
      className={`batch-grid-tile ${active ? "active" : ""} ${preview ? "previewing" : ""}`}
      onClick={() => {
        if (!preview) void onSelect(item);
      }}
      disabled={preview}
      title={item.prompt}
    >
      <img
        src={src}
        alt={item.prompt || `batch result ${index + 1}`}
        loading={lazyImage ? "lazy" : "eager"}
        decoding="async"
        draggable={false}
      />
      <span className="batch-grid-index">{index + 1}</span>
      {preview ? (
        <span className="batch-grid-preview-wait">服务器信号图像已返回，等待最后结果...</span>
      ) : null}
      {!preview && item.elapsedSec ? <span className="batch-grid-meta">{item.elapsedSec}s</span> : null}
      {apiLabel ? <span className="batch-grid-api-label">{apiLabel}</span> : null}
      {!preview && pixelLabel ? <span className="batch-grid-pixels">{pixelLabel}</span> : null}
    </button>
  );
}

function PendingGridTile({ index, apiLabel }: { index: number; apiLabel?: string }) {
  return (
    <div className="batch-grid-tile pending" aria-label={`等待第 ${index + 1} 张预览`}>
      <span className="batch-grid-index">{index + 1}</span>
      <span className="batch-grid-pending-ring" />
      <span className="batch-grid-pending-label">等待预览</span>
      {apiLabel ? <span className="batch-grid-api-label">{apiLabel}</span> : null}
    </div>
  );
}

function FailedGridTile({
  index,
  apiLabel,
  jobGroup,
  jobSlot,
  onApplyJobSlotParams,
  onRegenerateJobSlot,
  recoveryTask,
  onQueryAPIMartTask,
}: {
  index: number;
  apiLabel?: string;
  jobGroup?: JobGroupSnapshot;
  jobSlot?: JobSlotSnapshot;
  onApplyJobSlotParams?: (group: JobGroupSnapshot, slot: JobSlotSnapshot) => void;
  onRegenerateJobSlot?: (group: JobGroupSnapshot, slot: JobSlotSnapshot) => void | Promise<void>;
  recoveryTask?: APIMartRecoveryTask;
  onQueryAPIMartTask?: (taskId: string) => void | Promise<void>;
}) {
  const canApplyParams = Boolean(
    jobGroup
      && jobSlot
      && jobSlot.status !== "queued"
      && jobSlot.status !== "running"
      && onApplyJobSlotParams,
  );
  const canRegenerate = Boolean(
    jobGroup
      && jobSlot
      && jobSlot.status !== "queued"
      && jobSlot.status !== "running"
      && onRegenerateJobSlot,
  );
  return (
    <div className="batch-grid-tile failed" aria-label={`第 ${index + 1} 张生成失败或未返回`}>
      <span className="batch-grid-index">{index + 1}</span>
      <span className="batch-grid-failed-mark">!</span>
      <span className="batch-grid-failed-label">生成失败 / 未返回</span>
      {apiLabel ? <span className="batch-grid-api-label">{apiLabel}</span> : null}
      {canApplyParams || canRegenerate || (recoveryTask?.taskId && onQueryAPIMartTask) ? (
        <span className="batch-grid-failed-actions">
          {canApplyParams && jobGroup && jobSlot && onApplyJobSlotParams ? (
            <button
              type="button"
              className="batch-grid-apply-params"
              title="应用这格任务参数到控制台，不重新生成"
              onClick={(event) => {
                event.stopPropagation();
                onApplyJobSlotParams(jobGroup, jobSlot);
              }}
            >
              应用参数
            </button>
          ) : null}
          {canRegenerate && jobGroup && jobSlot && onRegenerateJobSlot ? (
            <button
              type="button"
              className="batch-grid-regenerate-slot"
              title="按这格任务参数重新生成，可能产生新扣费"
              onClick={(event) => {
                event.stopPropagation();
                void onRegenerateJobSlot(jobGroup, jobSlot);
              }}
            >
              重新生成
            </button>
          ) : null}
          {recoveryTask?.taskId && onQueryAPIMartTask ? (
            <button
              type="button"
              className="batch-grid-apimart-query"
              title="继续查询 APIMart 后台任务，不重新生成，不重新扣费"
              onClick={(event) => {
                event.stopPropagation();
                void onQueryAPIMartTask(recoveryTask.taskId);
              }}
            >
              查后台
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
