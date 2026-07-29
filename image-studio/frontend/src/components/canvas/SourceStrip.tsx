import { Fragment, type DragEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Images, Plus, X } from "lucide-react";
import { useStudioStore } from "../../state/studioStore";
import { dataURLFromBase64, useBlobURL } from "../../lib/images";
import { materializeCompareSourceAsHistoryItem } from "../../state/compareSourceSelection";
import { sourceToDataURL } from "../../lib/virtualHostStore";
import { usePlatform } from "../../platform/context";
import { ImportImagePath, ReadImageAsBase64, RegisterImportedImageAsset } from "../../platform/runtime/host";
import type { BatchProcessConfig, BatchProcessSourceImage, HistoryItem, SourceImage } from "../../types/domain";

function clampBatchQueueSlotIndex(value: unknown, fixedSourceCount: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(Math.max(0, fixedSourceCount), Math.floor(n)));
}

async function sourceToRenderableDataURL(source: {
  path?: string;
  name?: string;
  mimeType?: string | null;
  imageB64?: string | null;
  imageBlob?: Blob | null;
} | null | undefined): Promise<string> {
  const dataURL = await sourceToDataURL(source).catch(() => "");
  if (dataURL || !source?.path) return dataURL;
  const imported = await ImportImagePath(source.path).catch(() => null);
  const readablePath = imported?.path || source.path;
  const imageB64 = imported?.imageB64 || await ReadImageAsBase64(readablePath).catch(() => "");
  return imageB64 ? dataURLFromBase64(imageB64, source.mimeType) : "";
}

export function SourceStrip() {
  const sources = useStudioStore((s) => s.sources);
  const removeSource = useStudioStore((s) => s.removeSource);
  const reorderSources = useStudioStore((s) => s.reorderSources);
  const mode = useStudioStore((s) => s.mode);
  const editSourceMode = useStudioStore((s) => s.editSourceMode);
  const batchProcess = useStudioStore((s) => s.batchProcess);
  const setField = useStudioStore((s) => s.setField);
  const currentImage = useStudioStore((s) => s.currentImage);
  const compareB = useStudioStore((s) => s.compareB);
  const setCompareB = useStudioStore((s) => s.setCompareB);
  const selectSourceImage = useStudioStore((s) => s.selectSourceImage);
  const selectBatchInputFiles = useStudioStore((s) => s.selectBatchInputFiles);
  const importSourceImageFile = useStudioStore((s) => s.importSourceImageFile);
  const pushToast = useStudioStore((s) => s.pushToast);
  const { isMac, usesFluentUI, usesAppleUI } = usePlatform();

  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [fileDragActive, setFileDragActive] = useState(false);
  const [batchQueueOpen, setBatchQueueOpen] = useState(false);
  const batchQueueTriggerRef = useRef<HTMLDivElement | null>(null);

  const batchMode = editSourceMode === "batch";
  const selectedBatchCount = batchProcess.discoveredSources.filter((source) => source.selected !== false).length;
  const totalBatchCount = batchProcess.discoveredSources.length;
  const batchSourceSlotIndex = batchMode
    ? clampBatchQueueSlotIndex(batchProcess.batchSourceSlotIndex, sources.length)
    : 0;
  const hasDraggedFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");
  const stripTitle = batchMode ? "批处理图生图队列，点击格子查看源图顺序" : "点击 + 添加参考图，或把图片拖入此区域";
  const stripLabel = batchMode
    ? `参考格 ${sources.length + 1} 格 · 批量 ${selectedBatchCount}/${totalBatchCount} 张`
    : fileDragActive ? "松开导入参考图" : `参考图 ${sources.length} 张`;
  const stripHint = batchMode
    ? "固定参考图会保留在序列中；批量队列格按位置逐张轮换提交。"
    : fileDragActive ? "释放鼠标后会把本地图片加入参考图。" : "图生图时常驻显示，支持拖拽排序、拖入图片和继续追加参考图。";

  const useSourceAsCompare = compareB && currentImage
    ? async (source: SourceImage) => {
        const compareItem = await materializeCompareSourceAsHistoryItem(source, currentImage);
        if (!compareItem) return;
        void setCompareB(compareItem);
      }
    : undefined;

  const importDroppedSourceImage = (files: FileList | null) => {
    const file = Array.from(files ?? []).find((item) => item.type.startsWith("image/"));
    if (!file) {
      pushToast("请拖入 PNG/JPG/WebP 图片", "warn", 2800);
      return;
    }
    void importSourceImageFile(file);
  };

  const updateBatchProcessSources = (
    updater: (source: BatchProcessSourceImage, index: number) => BatchProcessSourceImage,
  ) => {
    setField("batchProcess", {
      ...batchProcess,
      discoveredSources: batchProcess.discoveredSources.map(updater),
    } as BatchProcessConfig);
  };

  const toggleBatchSource = (path: string) => {
    updateBatchProcessSources((source) => (
      source.path === path
        ? { ...source, selected: source.selected === false }
        : source
    ));
  };

  const deselectBatchSource = (path: string) => {
    updateBatchProcessSources((source) => (
      source.path === path ? { ...source, selected: false } : source
    ));
  };

  const setBatchQueueSlotIndex = (slotIndex: number) => {
    setField("batchProcess", {
      ...batchProcess,
      batchSourceSlotIndex: clampBatchQueueSlotIndex(slotIndex, sources.length),
    } as BatchProcessConfig);
  };

  useEffect(() => {
    if (!batchMode) setBatchQueueOpen(false);
  }, [batchMode]);

  if (mode !== "edit") return null;

  return (
    <div
      data-audit-area="canvas"
      onDragEnter={(event) => {
        if (batchMode || !hasDraggedFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setFileDragActive(true);
      }}
      onDragOver={(event) => {
        if (batchMode || !hasDraggedFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
        setFileDragActive(true);
      }}
      onDragLeave={(event) => {
        if (batchMode || !hasDraggedFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFileDragActive(false);
        }
      }}
      onDrop={(event) => {
        if (batchMode || !hasDraggedFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setFileDragActive(false);
        importDroppedSourceImage(event.dataTransfer.files);
      }}
      title={stripTitle}
      className={`source-strip relative border-b border-[var(--border)] bg-[var(--toolbar)] backdrop-blur-2xl transition-colors ${
        fileDragActive ? "bg-[var(--accent-soft)] shadow-[inset_0_0_0_2px_var(--accent)]" : ""
      } ${usesAppleUI ? "liquid-glass-bar" : ""} ${isMac ? "px-3 py-2.5" : "px-3 py-2"}`}
    >
      <div className={`flex ${isMac ? "items-start justify-between gap-3" : "items-center gap-2"} overflow-x-auto`}>
        <div className="min-w-0 shrink-0">
          <div className={`source-strip-label shrink-0 text-[11px] ${fileDragActive ? "font-medium text-[var(--accent)]" : "text-zinc-500"}`}>
            {stripLabel}
          </div>
          {isMac && (
            <div className="mt-0.5 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
              {stripHint}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 overflow-x-auto">
      {batchMode ? (
        <>
          {Array.from({ length: sources.length + 1 }, (_, slot) => (
            <Fragment key={`batch-slot-${slot}`}>
              {slot === batchSourceSlotIndex ? (
                <BatchQueueStripTile
                  triggerRef={batchQueueTriggerRef}
                  sources={batchProcess.discoveredSources}
                  selectedCount={selectedBatchCount}
                  totalCount={totalBatchCount}
                  open={batchQueueOpen}
                  slotIndex={batchSourceSlotIndex}
                  maxSlotIndex={sources.length}
                  onMoveLeft={() => setBatchQueueSlotIndex(batchSourceSlotIndex - 1)}
                  onMoveRight={() => setBatchQueueSlotIndex(batchSourceSlotIndex + 1)}
                  onToggleOpen={() => setBatchQueueOpen(true)}
                />
              ) : null}
              {slot < sources.length ? (
                <SourceTile
                  source={sources[slot]}
                  index={slot}
                  dragFrom={dragFrom}
                  overIdx={overIdx}
                  setDragFrom={setDragFrom}
                  setOverIdx={setOverIdx}
                  reorderSources={reorderSources}
                  removeSource={removeSource}
                  onUseAsCompare={useSourceAsCompare}
                />
              ) : null}
            </Fragment>
          ))}
          <button
            data-audit-id="select-fixed-source-image"
            onClick={selectSourceImage}
            title="添加固定参考图"
            className={`source-thumb add flex h-12 w-12 shrink-0 items-center justify-center border border-dashed border-zinc-300 text-zinc-500 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-zinc-700 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            data-audit-id="select-batch-source-images"
            onClick={selectBatchInputFiles}
            title="加入批量图片"
            className={`source-thumb add flex h-12 w-12 shrink-0 items-center justify-center border border-dashed border-[color:var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent)] transition-colors hover:border-[color:var(--accent)]/50 dark:border-[color:var(--accent)]/35 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
          >
            <Images className="w-4 h-4" />
          </button>
        </>
      ) : (
        <>
          {sources.map((s, i) => (
            <SourceTile
              key={s.path}
              source={s}
              index={i}
              dragFrom={dragFrom}
              overIdx={overIdx}
              setDragFrom={setDragFrom}
              setOverIdx={setOverIdx}
              reorderSources={reorderSources}
              removeSource={removeSource}
              onUseAsCompare={useSourceAsCompare}
            />
          ))}
          <button
            data-audit-id="select-source-image"
            onClick={selectSourceImage}
            title="添加参考图，或把图片拖入此区域"
            className={`source-thumb add flex h-12 w-12 shrink-0 items-center justify-center border border-dashed border-zinc-300 text-zinc-500 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-zinc-700 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
          >
            <Plus className="w-4 h-4" />
          </button>
        </>
      )}
        </div>
      </div>
      {batchMode && batchQueueOpen ? (
        <BatchQueuePreviewPopover
          sources={batchProcess.discoveredSources}
          selectedCount={selectedBatchCount}
          totalCount={totalBatchCount}
          toggleSource={toggleBatchSource}
          deselectSource={deselectBatchSource}
          triggerRef={batchQueueTriggerRef}
          onClose={() => setBatchQueueOpen(false)}
          usesFluentUI={usesFluentUI}
        />
      ) : null}
    </div>
  );
}

function BatchQueueStripTile({
  triggerRef,
  sources,
  selectedCount,
  totalCount,
  open,
  slotIndex,
  maxSlotIndex,
  onMoveLeft,
  onMoveRight,
  onToggleOpen,
}: {
  triggerRef: { current: HTMLDivElement | null };
  sources: BatchProcessSourceImage[];
  selectedCount: number;
  totalCount: number;
  open: boolean;
  slotIndex: number;
  maxSlotIndex: number;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onToggleOpen: () => void;
}) {
  const cover = sources.find((source) => source.selected !== false) ?? sources[0] ?? null;
  const immediatePreviewURL = cover?.previewUrl || "";
  const [pathPreviewURL, setPathPreviewURL] = useState("");
  const [previewUrlFailed, setPreviewUrlFailed] = useState(false);
  const previewURL = !previewUrlFailed && immediatePreviewURL ? immediatePreviewURL : pathPreviewURL;
  const { usesFluentUI } = usePlatform();

  useEffect(() => {
    let cancelled = false;
    if ((!previewUrlFailed && immediatePreviewURL) || !cover?.path) {
      setPathPreviewURL("");
      return () => { cancelled = true; };
    }
    sourceToRenderableDataURL(cover)
      .then((dataURL) => {
        if (!cancelled) setPathPreviewURL(dataURL);
      })
      .catch(() => {
        if (!cancelled) setPathPreviewURL("");
      });
    return () => { cancelled = true; };
  }, [cover, immediatePreviewURL, previewUrlFailed]);

  useEffect(() => {
    setPreviewUrlFailed(false);
  }, [cover?.path, immediatePreviewURL]);

  return (
    <div
      ref={triggerRef}
      role="button"
      tabIndex={0}
      data-audit-id="batch-source-queue-tile"
      data-open={open ? "true" : "false"}
      aria-expanded={open ? "true" : "false"}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggleOpen();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        onToggleOpen();
      }}
      title={cover ? `批量图生图队列\n封面: ${cover.name}\n点击查看 ${selectedCount}/${totalCount} 张源图` : "批量图生图队列为空，点击 + 加入图片"}
      className={`batch-source-queue-tile relative flex h-12 w-48 shrink-0 cursor-pointer select-none items-center gap-2 overflow-hidden border bg-white/72 px-2 text-left transition-all hover:border-[color:var(--accent)]/35 dark:bg-white/[0.04] ${
        open
          ? "border-[color:var(--accent)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_24%,transparent)]"
          : "border-black/[0.06] dark:border-white/[0.06]"
      } ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
    >
      <span className={`pointer-events-none flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden bg-zinc-100 text-zinc-500 dark:bg-zinc-800 ${usesFluentUI ? "rounded-[8px]" : "rounded-[10px]"}`}>
        {previewURL ? (
          <img
            src={previewURL}
            draggable={false}
            alt={cover?.name ?? "批量队列封面"}
            loading="lazy"
            decoding="async"
            onError={() => {
              if (immediatePreviewURL && previewURL === immediatePreviewURL) setPreviewUrlFailed(true);
            }}
            className="h-full w-full object-cover"
          />
        ) : (
          <Images className="h-4 w-4" />
        )}
      </span>
      <span className="pointer-events-none min-w-0 flex-1">
        <span className="block truncate text-[12px] font-semibold text-zinc-800 dark:text-zinc-100">
          批量图生图队列
        </span>
        <span className="mt-0.5 block truncate text-[10px] text-zinc-500 dark:text-zinc-400">
          第 {slotIndex + 1} 格 · 已选 {selectedCount}/{totalCount} 张
        </span>
      </span>
      <span className="relative z-10 flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          data-audit-id="move-batch-source-slot-left"
          disabled={slotIndex <= 0}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onMoveLeft();
          }}
          title="批量队列前移一格"
          className={`flex h-6 w-6 items-center justify-center border border-black/[0.08] bg-white/70 text-zinc-500 transition hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-35 dark:border-white/[0.08] dark:bg-white/[0.05] ${usesFluentUI ? "rounded-[7px]" : "rounded-full"}`}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          data-audit-id="move-batch-source-slot-right"
          disabled={slotIndex >= maxSlotIndex}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onMoveRight();
          }}
          title="批量队列后移一格"
          className={`flex h-6 w-6 items-center justify-center border border-black/[0.08] bg-white/70 text-zinc-500 transition hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-35 dark:border-white/[0.08] dark:bg-white/[0.05] ${usesFluentUI ? "rounded-[7px]" : "rounded-full"}`}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </span>
    </div>
  );
}

function BatchQueuePreviewPopover({
  sources,
  selectedCount,
  totalCount,
  toggleSource,
  deselectSource,
  triggerRef,
  onClose,
  usesFluentUI,
}: {
  sources: BatchProcessSourceImage[];
  selectedCount: number;
  totalCount: number;
  toggleSource: (path: string) => void;
  deselectSource: (path: string) => void;
  triggerRef: { current: HTMLDivElement | null };
  onClose: () => void;
  usesFluentUI: boolean;
}) {
  const roundedClass = usesFluentUI ? "rounded-[12px]" : "rounded-[18px]";
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelStyle = {
    position: "fixed",
    left: "50%",
    top: 96,
    width: "min(880px, calc(100vw - 32px))",
    maxHeight: "calc(100vh - 128px)",
    transform: "translateX(-50%)",
  } as const;

  useEffect(() => {
    const openedAt = Date.now();
    const onDocumentClick = (event: MouseEvent) => {
      if (Date.now() - openedAt < 160) return;
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onDocumentClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, triggerRef]);

  const popover = (
    <div
      ref={panelRef}
      data-audit-id="batch-source-queue-popover"
      style={panelStyle}
      className={`z-[9200] overflow-hidden border border-black/[0.08] bg-[var(--surface)] p-3 shadow-[0_24px_70px_rgba(15,23,42,0.22)] dark:border-white/[0.08] ${roundedClass}`}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-100">
              批量图生图源图顺序
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              已选 {selectedCount}/{totalCount} 张；这里和侧边批处理队列同步。
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`inline-flex h-7 w-7 shrink-0 items-center justify-center border border-black/[0.08] text-zinc-500 hover:border-[color:var(--accent)]/30 hover:text-[var(--accent)] dark:border-white/[0.08] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
            title="关闭预览"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {sources.length > 0 ? (
          <div className="mt-3 grid max-h-[calc(100vh-220px)] grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-2 overflow-y-auto pr-1">
            {sources.map((source, index) => (
              <BatchQueuePreviewSourceTile
                key={source.path}
                source={source}
                index={index}
                toggleSource={toggleSource}
                deselectSource={deselectSource}
                usesFluentUI={usesFluentUI}
              />
            ))}
          </div>
        ) : (
          <div className={`mt-3 border border-dashed border-black/[0.08] bg-black/[0.02] px-3 py-4 text-center text-[11px] text-zinc-500 dark:border-white/[0.08] dark:bg-white/[0.02] dark:text-zinc-400 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
            还没有加入批量图生图源图
          </div>
        )}
      </div>
  );

  if (typeof document === "undefined") return popover;
  return createPortal(popover, document.body);
}

function BatchQueuePreviewSourceTile({
  source,
  index,
  toggleSource,
  deselectSource,
  usesFluentUI,
}: {
  source: BatchProcessSourceImage;
  index: number;
  toggleSource: (path: string) => void;
  deselectSource: (path: string) => void;
  usesFluentUI: boolean;
}) {
  const active = source.selected !== false;
  const immediatePreviewURL = source.previewUrl || "";
  const [pathPreviewURL, setPathPreviewURL] = useState("");
  const [previewUrlFailed, setPreviewUrlFailed] = useState(false);
  const previewURL = !previewUrlFailed && immediatePreviewURL ? immediatePreviewURL : pathPreviewURL;

  useEffect(() => {
    let cancelled = false;
    if ((!previewUrlFailed && immediatePreviewURL) || !source.path) {
      setPathPreviewURL("");
      return () => { cancelled = true; };
    }
    sourceToRenderableDataURL(source)
      .then((dataURL) => {
        if (!cancelled) setPathPreviewURL(dataURL);
      })
      .catch(() => {
        if (!cancelled) setPathPreviewURL("");
      });
    return () => { cancelled = true; };
  }, [immediatePreviewURL, previewUrlFailed, source]);

  useEffect(() => {
    setPreviewUrlFailed(false);
  }, [immediatePreviewURL, source.path]);

  return (
    <div
      role="button"
      tabIndex={0}
      data-audit-id="batch-source-preview-item"
      data-selected={active ? "true" : "false"}
      onClick={() => toggleSource(source.path)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleSource(source.path);
        }
      }}
      title={`${index + 1}. ${source.name}\n${source.path}\n点击选择/取消`}
      className={`group relative min-h-[82px] cursor-pointer overflow-hidden border bg-white/80 transition-all dark:bg-white/[0.04] ${
        active
          ? "border-[color:var(--accent)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_22%,transparent)]"
          : "border-black/[0.06] opacity-50 grayscale hover:opacity-80 dark:border-white/[0.06]"
      } ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
    >
      <span className="absolute left-0 top-0 z-10 rounded-br bg-zinc-950/70 px-1 text-[9px] text-white">
        {index + 1}
      </span>
      <div className="h-20 bg-zinc-100 dark:bg-zinc-800">
        {previewURL ? (
          <img
            src={previewURL}
            alt={source.name}
            loading="lazy"
            decoding="async"
            onError={() => {
              if (immediatePreviewURL && previewURL === immediatePreviewURL) setPreviewUrlFailed(true);
            }}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-500">
            {source.name.split(".").slice(-1)[0].toUpperCase()}
          </div>
        )}
      </div>
      <div className="absolute bottom-1 left-1 right-1 flex justify-center">
        <span className="rounded bg-zinc-950/70 px-1.5 py-0.5 text-[9px] text-white">
          {active ? "已选" : "未选"}
        </span>
      </div>
      {active ? (
        <button
          type="button"
          data-audit-id="deselect-batch-source-image"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            deselectSource(source.path);
          }}
          title="取消选择，不删除队列"
          className={`absolute right-1 top-1 z-20 hidden h-6 w-6 items-center justify-center border border-white bg-red-600 text-white shadow-[0_3px_10px_rgb(185_28_28)] group-hover:flex hover:bg-red-700 dark:border-zinc-950 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
        >
          <X className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
      ) : null}
    </div>
  );
}

function SourceTile({
  source,
  index,
  dragFrom,
  overIdx,
  setDragFrom,
  setOverIdx,
  reorderSources,
  removeSource,
  onUseAsCompare,
}: {
  source: SourceImage;
  index: number;
  dragFrom: number | null;
  overIdx: number | null;
  setDragFrom: (v: number | null) => void;
  setOverIdx: (v: number | null) => void;
  reorderSources: (from: number, to: number) => void;
  removeSource: (index: number) => void;
  onUseAsCompare?: (source: SourceImage) => void | Promise<void>;
}) {
  const objectURL = useBlobURL(source.imageBlob ?? null, source.imageB64 ?? null);
  const immediatePreviewURL = source.previewUrl || objectURL;
  const [pathPreviewURL, setPathPreviewURL] = useState("");
  const [previewUrlFailed, setPreviewUrlFailed] = useState(false);
  const previewURL = !previewUrlFailed && immediatePreviewURL ? immediatePreviewURL : pathPreviewURL;
  const { usesFluentUI } = usePlatform();

  async function openSourceOnCanvas() {
    const state = useStudioStore.getState();
    const dataURL = await sourceToRenderableDataURL(source).catch(() => "");
    let imageB64 = dataURLBase64(dataURL) || source.imageB64 || undefined;
    let imageBlob = source.imageBlob ?? null;
    let savedPath = source.path;
    let previewUrl = source.previewUrl || undefined;
    let imageId: string | undefined;
    let fullUrl: string | undefined;
    let width = source.width;
    let height = source.height;

    if (savedPath && !imageB64 && !imageBlob) {
      const imported = await ImportImagePath(savedPath).catch(() => null);
      if (imported?.path) {
        savedPath = imported.path;
        previewUrl = imported.previewUrl || previewUrl;
        imageId = imported.imageId || imageId;
        fullUrl = fullUrlFromImageId(imported.imageId) || fullUrl;
        imageB64 = imported.imageB64 || imageB64;
        width = imported.width || width;
        height = imported.height || height;
      }
    }

    if (savedPath && !fullUrl && !imageId && !imageB64 && !imageBlob) {
      const ref = await RegisterImportedImageAsset(savedPath).catch(() => null);
      if (ref) {
        savedPath = ref.savedPath || savedPath;
        previewUrl = ref.previewUrl || previewUrl;
        imageId = ref.imageId || imageId;
        fullUrl = ref.fullUrl || fullUrlFromImageId(ref.imageId) || fullUrl;
        width = ref.width || width;
        height = ref.height || height;
      }
    }

    if (savedPath && !fullUrl && !imageId && !imageB64 && !imageBlob) {
      const fullB64 = await ReadImageAsBase64(savedPath).catch(() => "");
      imageB64 = fullB64 || imageB64;
    }

    if (!fullUrl && imageId) fullUrl = fullUrlFromImageId(imageId);
    if (!fullUrl && !imageId && !imageB64 && !imageBlob) {
      state.pushToast("参考图原文件无法读取，请重新导入参考图", "warn", 2800);
      return;
    }

    const item: HistoryItem = {
      id: `source-preview-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      imageId,
      previewUrl,
      fullUrl,
      imageB64,
      imageBlob,
      previewBlob: imageBlob,
      previewOnly: false,
      prompt: `(参考图) ${source.name}`,
      mode: "edit",
      size: state.size,
      quality: state.quality,
      outputFormat: state.outputFormat,
      createdAt: Date.now(),
      savedPath,
      width,
      height,
    };
    state.openSourcePreview(item);
    state.pushToast("已在画布打开参考图大图", "success");
  }

  useEffect(() => {
    let cancelled = false;
    if ((!previewUrlFailed && immediatePreviewURL) || !source.path) {
      setPathPreviewURL("");
      return () => { cancelled = true; };
    }
    sourceToRenderableDataURL(source)
      .then((dataURL) => {
        if (!cancelled) setPathPreviewURL(dataURL);
      })
      .catch(() => {
        if (!cancelled) setPathPreviewURL("");
      });
    return () => { cancelled = true; };
  }, [immediatePreviewURL, previewUrlFailed, source]);

  useEffect(() => {
    setPreviewUrlFailed(false);
  }, [immediatePreviewURL, source.path]);

  return (
    <div
      data-audit-id="source-image"
      draggable
      onDragStart={() => setDragFrom(index)}
      onDragOver={(e) => { e.preventDefault(); setOverIdx(index); }}
      onDragLeave={() => setOverIdx(null)}
      onDrop={(e) => {
        e.preventDefault();
        if (dragFrom != null && dragFrom !== index) reorderSources(dragFrom, index);
        setDragFrom(null);
        setOverIdx(null);
      }}
      onDragEnd={() => { setDragFrom(null); setOverIdx(null); }}
      onClick={(event) => {
        if (!onUseAsCompare) return;
        event.stopPropagation();
        void onUseAsCompare(source);
      }}
      onDoubleClick={() => void openSourceOnCanvas()}
      title={`${index + 1}. ${source.name}\n${source.path}\n双击查看大图`}
      className={`source-thumb relative group h-12 w-12 shrink-0 overflow-hidden border transition-all ${
        onUseAsCompare ? "cursor-pointer" : "cursor-grab"
      } ${
        overIdx === index
          ? "scale-105 border-[color:var(--accent)] shadow-[0_0_0_1px_var(--accent)]"
          : "border-black/[0.06] hover:border-[color:var(--accent)]/30 dark:border-white/[0.06]"
      } ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
    >
      <span className="absolute top-0 left-0 z-10 px-1 text-[9px] bg-zinc-950/70 text-white rounded-br">
        {index + 1}
      </span>
      {previewURL ? (
        <img
          src={previewURL}
          alt={source.name}
          loading="lazy"
          decoding="async"
          onError={() => {
            if (immediatePreviewURL && previewURL === immediatePreviewURL) setPreviewUrlFailed(true);
          }}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-500 bg-zinc-100 dark:bg-zinc-800">
          {source.name.split(".").slice(-1)[0].toUpperCase()}
        </div>
      )}
      <button
        type="button"
        data-audit-id="remove-source-image"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); removeSource(index); }}
        title="移除"
        className={`source-thumb-remove absolute right-0.5 top-0.5 z-20 hidden h-6 w-6 items-center justify-center border border-white bg-red-600 text-white shadow-[0_3px_10px_rgb(185_28_28)] group-hover:flex hover:bg-red-700 dark:border-zinc-950 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
      >
        <X className="h-3.5 w-3.5" strokeWidth={2.5} />
      </button>
    </div>
  );
}

function dataURLBase64(dataURL: string): string {
  const comma = dataURL.indexOf(",");
  if (comma < 0 || !dataURL.slice(0, comma).includes(";base64")) return "";
  return dataURL.slice(comma + 1);
}

function fullUrlFromImageId(imageId?: string | null): string | undefined {
  return imageId ? `/media/full/${imageId}` : undefined;
}
