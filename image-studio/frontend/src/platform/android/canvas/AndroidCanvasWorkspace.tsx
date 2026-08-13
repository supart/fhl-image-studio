import {
  ArrowRight,
  Brush,
  CheckCircle2,
  Clipboard,
  Crop,
  Eraser,
  Expand,
  FlipHorizontal,
  FlipVertical,
  Hand,
  ImagePlus,
  Info,
  Maximize,
  Minimize,
  MoreHorizontal,
  ZoomIn,
  ZoomOut,
  Pencil,
  RotateCcw,
  RotateCw,
  Save,
  Scissors,
  Share2,
  Split,
  Square,
  Trash2,
  Type as TypeIcon,
  Undo2,
  Redo2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { shallow } from "zustand/shallow";
import { ANNOTATION_COLORS, type AnnotationKind, type HistoryItem, type SourceImage } from "../../../types/domain";
import { useStudioStore } from "../../../state/studioStore";
import { historyPreviewSrc, useBlobURL } from "../../../lib/images";
import { sourceToDataURL } from "../../../lib/virtualHostStore";
import { copyImageB64ToClipboard, copyImageURLToClipboard } from "../../../components/canvas/canvasImage";
import { pixelSizeLabel, qualityLabel, sizeLabel } from "../../../components/history/historyLabels";
import { deriveAspectPreset, deriveResolutionPreset } from "../../../components/panel/sizeCapabilities";
import { StreamPreviewBadge } from "../../../components/canvas/StreamPreviewBadge";
import { usePlatform } from "../../context";
import { vibrateForPlatform } from "../bridge";
import { historySourceLabel } from "../history/historySourceLabel";
import {
  AndroidCanvasStage,
  androidCanvasModeLabel,
  androidCanvasScopedJobGroups,
  androidJobGroupSlotCount,
} from "./AndroidCanvasStage";

type CanvasTool = "pan" | "mask" | "annotate";
type BrushMode = "paint" | "erase";

export function AndroidCanvasWorkspace() {
  const {
    currentImage,
    activeWorkspaceId,
    mode,
    sources,
    isRunning,
    progressStage,
    streamPreviewActive,
    jobsCompleted,
    jobsTotal,
    tool,
    brushMode,
    brushSize,
    annotationKind,
    annotationColor,
    annotations,
    selectedAnnotationId,
    fullscreen,
    viewZoom,
    batchResults,
    jobGroupsByWorkspace,
    resultGridOpen,
    undoStack,
    redoStack,
    setField,
    undo,
    redo,
    resetMask,
    clearAnnotations,
    compareB,
    materializeCurrentImage,
    saveCurrentImageAs,
    shareCurrentImage,
    setCompareB,
    rotateCurrent,
    flipCurrent,
    cropToRect,
    openResultGrid,
    closeResultGrid,
    openResultDetail,
    selectSourceImage,
    removeSource,
    reorderSources,
    clearSources,
    reuseAsSource,
    pushToast,
    toggleFullscreen,
  } = useStudioStore((state) => ({
    currentImage: state.currentImage,
    activeWorkspaceId: state.activeWorkspaceId,
    mode: state.mode,
    sources: state.sources,
    isRunning: state.isRunning,
    progressStage: state.progress?.stage,
    streamPreviewActive: !!state.streamPreview,
    jobsCompleted: state.jobsCompleted,
    jobsTotal: state.jobsTotal,
    tool: state.tool,
    brushMode: state.brushMode,
    brushSize: state.brushSize,
    annotationKind: state.annotationKind,
    annotationColor: state.annotationColor,
    annotations: state.annotations,
    selectedAnnotationId: state.selectedAnnotationId,
    fullscreen: state.fullscreen,
    viewZoom: state.viewZoom,
    batchResults: state.batchResults,
    jobGroupsByWorkspace: state.jobGroupsByWorkspace,
    resultGridOpen: state.resultGridOpen,
    undoStack: state.undoStack,
    redoStack: state.redoStack,
    setField: state.setField,
    undo: state.undo,
    redo: state.redo,
    resetMask: state.resetMask,
    clearAnnotations: state.clearAnnotations,
    compareB: state.compareB,
    materializeCurrentImage: state.materializeCurrentImage,
    saveCurrentImageAs: state.saveCurrentImageAs,
    shareCurrentImage: state.shareCurrentImage,
    setCompareB: state.setCompareB,
    rotateCurrent: state.rotateCurrent,
    flipCurrent: state.flipCurrent,
    cropToRect: state.cropToRect,
    openResultGrid: state.openResultGrid,
    closeResultGrid: state.closeResultGrid,
    openResultDetail: state.openResultDetail,
    selectSourceImage: state.selectSourceImage,
    removeSource: state.removeSource,
    reorderSources: state.reorderSources,
    clearSources: state.clearSources,
    reuseAsSource: state.reuseAsSource,
    pushToast: state.pushToast,
    toggleFullscreen: state.toggleFullscreen,
  }), shallow);
  const { isAndroidPad, androidOrientation } = usePlatform();
  const [sourceOpen, setSourceOpen] = useState(true);
  const [imageActionsOpen, setImageActionsOpen] = useState(false);
  const hasImage = !!currentImage;
  const isEditMode = mode === "edit";
  const hasSources = isEditMode && sources.length > 0;
  const selRect = annotations.find((a) => a.id === selectedAnnotationId && a.kind === "rect");
  const cropAction = selRect && selRect.width && selRect.height
    ? () => cropToRect(selRect.x, selRect.y, selRect.width!, selRect.height!)
    : null;
  const workspaceJobGroups = jobGroupsByWorkspace[activeWorkspaceId] ?? [];
  const displayJobGroups = androidCanvasScopedJobGroups(workspaceJobGroups, isRunning);
  const jobGroupSlotCount = displayJobGroups.reduce((maxCount, group) => (
    Math.max(maxCount, androidJobGroupSlotCount(group))
  ), 0);
  const batchSlotCount = Math.max(jobsTotal, batchResults.length, jobGroupSlotCount);
  const showBatchToggle = batchSlotCount > 1;
  const statusLabel = isRunning ? (progressStage ?? "处理中") : androidCanvasModeLabel(currentImage);
  const shouldShowSourceStrip = isEditMode;
  const dockMode = tool === "mask" ? "mask" : tool === "annotate" ? "annotate" : "image";
  const currentPixelLabel = pixelSizeLabel(currentImage);
  const currentAspect = currentImage ? deriveAspectPreset(currentImage.size) : "auto";
  const currentResolution = currentImage ? deriveResolutionPreset(currentImage.size) : "auto";
  const currentAspectLabel = currentAspect === "auto" ? "Auto" : currentAspect;
  const currentApiLabel = currentImage && (currentImage.apiLabel?.trim() || currentImage.apiMode)
    ? historySourceLabel(currentImage)
    : "";
  const currentResolutionLabel = currentResolution === "auto" ? "自动" : currentResolution.toUpperCase();

  useEffect(() => {
    if (hasSources) setSourceOpen(true);
  }, [hasSources]);

  useEffect(() => {
    if (!hasImage) setImageActionsOpen(false);
  }, [hasImage]);

  const runAction = (action: () => void | Promise<void>, vibration = 8) => {
    vibrateForPlatform(vibration);
    void action();
  };

  const resetView = () => {
    vibrateForPlatform(6);
    (window as any).__androidCanvasResetView?.();
  };

  const zoomCanvas = (direction: "in" | "out") => {
    vibrateForPlatform(5);
    if (direction === "in") (window as any).__androidCanvasZoomIn?.();
    else (window as any).__androidCanvasZoomOut?.();
  };

  const copyCurrentImage = async () => {
    if (!currentImage) return;
    try {
      const full = await materializeCurrentImage(currentImage);
      const ok = full.fullUrl
        ? await copyImageURLToClipboard(full.fullUrl)
        : await copyImageB64ToClipboard(full.imageB64 ?? "");
      if (ok) {
        pushToast("已复制图片到剪贴板", "success");
      } else {
        pushToast("当前环境不支持复制图片，可改用分享或保存", "warn", 4200);
      }
    } catch (error: any) {
      pushToast(`复制失败:${error?.message ?? error}`, "error", 4200);
    }
  };

  const previewSourceOnCanvas = async (source: SourceImage) => {
    try {
      const dataURL = await sourceToDataURL(source).catch(() => "");
      const imageB64 = dataURLBase64(dataURL) || source.imageB64 || undefined;
      const preview: HistoryItem = {
        id: `android-source-preview-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        previewUrl: source.previewUrl || undefined,
        imageB64,
        imageBlob: source.imageBlob ?? null,
        previewBlob: source.imageBlob ?? null,
        previewOnly: !imageB64 && !source.imageBlob,
        prompt: `(参考图) ${source.name}`,
        mode: "edit",
        size: useStudioStore.getState().size,
        quality: useStudioStore.getState().quality,
        outputFormat: useStudioStore.getState().outputFormat,
        createdAt: Date.now(),
        savedPath: source.path,
      };
      setField("currentImage", preview);
      setField("resultGridOpen", false);
      pushToast("已在画布打开参考图大图", "success");
    } catch (error: any) {
      pushToast(`打开参考图失败:${error?.message ?? error}`, "error");
    }
  };

  return (
    <div
      className="android-canvas-workspace"
      data-dock-mode={dockMode}
      data-has-source-strip={shouldShowSourceStrip ? "true" : "false"}
      data-running={isRunning ? "true" : "false"}
      data-orientation={androidOrientation}
      data-device={isAndroidPad ? "pad" : "phone"}
    >
      <AndroidCanvasHeader
        currentImage={currentImage}
        isRunning={isRunning}
        progressLabel={statusLabel}
        streamPreviewActive={streamPreviewActive}
        zoomLabel={hasImage ? `${Math.round(viewZoom * 100)}%` : "Fit"}
        batchCount={batchSlotCount}
        sourceCount={sources.length}
        hasSources={hasSources}
        sourceOpen={shouldShowSourceStrip}
        onToggleSources={() => runAction(() => setSourceOpen(true), 5)}
        onOpenGrid={showBatchToggle ? () => runAction(() => (resultGridOpen ? closeResultGrid() : openResultGrid()), 8) : undefined}
        gridOpen={resultGridOpen}
        compareActive={!!compareB}
        onExitCompare={compareB ? () => runAction(() => setCompareB(null), 6) : undefined}
      />

      <div className="android-canvas-main">
        <div className="android-canvas-stage-panel">
          <AndroidCanvasStage />
          {hasImage && currentApiLabel ? (
            <span className="android-canvas-source-label" title={`API:${currentApiLabel}`}>{currentApiLabel}</span>
          ) : null}
          {hasImage ? (
            <div className="android-canvas-floating-meta">
              <span title={`选择尺寸:${currentImage.size}`}>{currentResolutionLabel}</span>
              <span title={`画幅比例:${currentImage.size}`}>{currentAspectLabel}</span>
              {currentPixelLabel ? <span title={`真实像素:${currentPixelLabel}`}>像素 {currentPixelLabel}</span> : null}
              <span>{qualityLabel(currentImage.quality)}</span>
              <span>{currentImage.mode === "edit" ? "图生图" : "文生图"}</span>
            </div>
          ) : null}
        </div>
      </div>

      {shouldShowSourceStrip ? (
        <AndroidSourceStrip
          sources={sources}
          onAdd={() => runAction(selectSourceImage, 8)}
          onPreview={(source) => runAction(() => previewSourceOnCanvas(source), 6)}
          onRemove={(index) => runAction(() => removeSource(index), 5)}
          onMove={(from, to) => runAction(() => reorderSources(from, to), 5)}
          onClear={() => runAction(clearSources, 5)}
        />
      ) : null}

      <AndroidCanvasDock>
        <div className="android-canvas-dock-scroll">
          <AndroidToolSegment
            value={tool}
            disabled={!hasImage}
            onChange={(next) => runAction(() => setField("tool", next), 8)}
          />
          <div className="android-canvas-dock-group compact">
            <DockIconButton
              title="更多操作"
              disabled={!hasImage}
              active={imageActionsOpen}
              onClick={() => runAction(() => setImageActionsOpen(true), 8)}
            >
              <MoreHorizontal />
            </DockIconButton>
            <DockIconButton title="撤销" disabled={undoStack.length === 0} onClick={() => runAction(undo, 6)}>
              <Undo2 />
            </DockIconButton>
            <DockIconButton title="重做" disabled={redoStack.length === 0} onClick={() => runAction(redo, 6)}>
              <Redo2 />
            </DockIconButton>
          </div>

          {tool === "mask" ? (
            <AndroidMaskControls
              brushMode={brushMode}
              brushSize={brushSize}
              onSetBrushMode={(next) => runAction(() => setField("brushMode", next), 5)}
              onSetBrushSize={(next) => setField("brushSize", next)}
              onResetMask={() => runAction(resetMask, 6)}
            />
          ) : null}

          {tool === "annotate" ? (
            <AndroidAnnotationControls
              annotationKind={annotationKind}
              annotationColor={annotationColor}
              onSetKind={(next) => runAction(() => setField("annotationKind", next), 5)}
              onSetColor={(next) => runAction(() => setField("annotationColor", next), 3)}
              onClear={() => runAction(clearAnnotations, 6)}
            />
          ) : null}

          <div className="android-canvas-dock-group">
            <DockIconButton title="缩小画布" disabled={!hasImage} onClick={() => zoomCanvas("out")}>
              <ZoomOut />
            </DockIconButton>
            <DockIconButton title="放大画布" disabled={!hasImage} onClick={() => zoomCanvas("in")}>
              <ZoomIn />
            </DockIconButton>
            <DockIconButton title="重置视图" disabled={!hasImage} onClick={resetView}>
              <Expand />
            </DockIconButton>
            <DockIconButton title="左转 90°" disabled={!currentImage?.savedPath} onClick={() => runAction(() => rotateCurrent(-90), 8)}>
              <RotateCcw />
            </DockIconButton>
            <DockIconButton title="右转 90°" disabled={!currentImage?.savedPath} onClick={() => runAction(() => rotateCurrent(90), 8)}>
              <RotateCw />
            </DockIconButton>
            <DockIconButton title="水平翻转" disabled={!currentImage?.savedPath} onClick={() => runAction(() => flipCurrent(true), 8)}>
              <FlipHorizontal />
            </DockIconButton>
            <DockIconButton title="竖直翻转" disabled={!currentImage?.savedPath} onClick={() => runAction(() => flipCurrent(false), 8)}>
              <FlipVertical />
            </DockIconButton>
            <DockIconButton title="裁出选中矩形" disabled={!cropAction} onClick={() => cropAction && runAction(cropAction, 8)}>
              <Crop />
            </DockIconButton>
          </div>

          <div className="android-canvas-dock-group">
            <DockIconButton title={fullscreen ? "退出全屏" : "全屏"} onClick={() => runAction(toggleFullscreen, 8)}>
              {fullscreen ? <Minimize /> : <Maximize />}
            </DockIconButton>
            <DockIconButton title="详情" disabled={!hasImage} onClick={() => currentImage && runAction(() => openResultDetail(currentImage), 8)}>
              <Info />
            </DockIconButton>
            <DockIconButton title="保存原图" disabled={!hasImage} onClick={() => runAction(saveCurrentImageAs, 8)}>
              <Save />
            </DockIconButton>
            <DockIconButton title="复制图片" disabled={!hasImage} onClick={() => runAction(copyCurrentImage, 8)}>
              <Clipboard />
            </DockIconButton>
            <DockIconButton title="分享图片" disabled={!hasImage} onClick={() => runAction(shareCurrentImage, 8)}>
              <Share2 />
            </DockIconButton>
            <DockIconButton title="设为图生图源图" disabled={!hasImage} onClick={() => currentImage && runAction(() => reuseAsSource(currentImage), 8)}>
              <Scissors />
            </DockIconButton>
            <DockIconButton title="清空画板" disabled={!hasImage} danger onClick={() => runAction(() => setField("currentImage", null), 8)}>
              <Trash2 />
            </DockIconButton>
          </div>
        </div>
      </AndroidCanvasDock>
      {imageActionsOpen && currentImage ? (
        <AndroidCurrentImageActionSheet
          item={currentImage}
          pixelLabel={currentPixelLabel}
          onClose={() => setImageActionsOpen(false)}
          onOpenDetail={() => runAction(() => openResultDetail(currentImage), 8)}
          onSave={() => runAction(saveCurrentImageAs, 8)}
          onCopy={() => runAction(copyCurrentImage, 8)}
          onShare={() => runAction(shareCurrentImage, 8)}
          onReuse={() => runAction(() => reuseAsSource(currentImage), 8)}
          onClear={() => runAction(() => setField("currentImage", null), 8)}
        />
      ) : null}
    </div>
  );
}

function AndroidCurrentImageActionSheet({
  item,
  pixelLabel,
  onClose,
  onOpenDetail,
  onSave,
  onCopy,
  onShare,
  onReuse,
  onClear,
}: {
  item: HistoryItem;
  pixelLabel: string | null;
  onClose: () => void;
  onOpenDetail: () => void;
  onSave: () => void;
  onCopy: () => void;
  onShare: () => void;
  onReuse: () => void;
  onClear: () => void;
}) {
  const previewURL = useBlobURL(item.previewBlob ?? item.imageBlob ?? null, item.imageB64 ?? null);
  const imageSrc = historyPreviewSrc(item, previewURL);
  const title = item.revisedPrompt || item.prompt || "当前图片";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = (action: () => void) => {
    action();
    onClose();
  };

  const sheet = (
    <div className="android-canvas-action-layer" role="presentation">
      <button type="button" className="android-canvas-action-backdrop" aria-label="关闭当前图操作" onClick={onClose} />
      <section className="android-canvas-action-sheet" role="dialog" aria-modal="true" aria-label="当前图操作">
        <div className="android-canvas-action-grabber" />
        <div className="android-canvas-action-head">
          <div className="android-canvas-action-preview">
            <img src={imageSrc} alt={title} loading="eager" decoding="async" />
          </div>
          <div className="android-canvas-action-copy">
            <span>当前图操作</span>
            <strong>{title}</strong>
            <small>
              {sizeLabel(item.size)}
              {pixelLabel ? ` · ${pixelLabel}` : ""}
              {" · "}
              {qualityLabel(item.quality)}
            </small>
          </div>
          <button type="button" className="android-canvas-action-close" onClick={onClose} aria-label="关闭">
            <X />
          </button>
        </div>

        <div className="android-canvas-action-grid">
          <button type="button" onClick={() => run(onOpenDetail)}>
            <span><Info /></span>
            详情
          </button>
          <button type="button" onClick={() => run(onCopy)}>
            <span><Clipboard /></span>
            复制图片
          </button>
          <button type="button" onClick={() => run(onSave)}>
            <span><Save /></span>
            保存原图
          </button>
          <button type="button" onClick={() => run(onShare)}>
            <span><Share2 /></span>
            分享图片
          </button>
          <button type="button" onClick={() => run(onReuse)}>
            <span><Scissors /></span>
            设为源图
          </button>
          <button type="button" className="danger" onClick={() => run(onClear)}>
            <span><Trash2 /></span>
            清空画板
          </button>
        </div>
      </section>
    </div>
  );

  if (typeof document === "undefined") return sheet;
  return createPortal(sheet, document.body);
}

function AndroidCanvasHeader({
  currentImage,
  isRunning,
  progressLabel,
  streamPreviewActive,
  zoomLabel,
  batchCount,
  sourceCount,
  hasSources,
  sourceOpen,
  onToggleSources,
  onOpenGrid,
  gridOpen,
  compareActive,
  onExitCompare,
}: {
  currentImage: HistoryItem | null;
  isRunning: boolean;
  progressLabel: string;
  streamPreviewActive: boolean;
  zoomLabel: string;
  batchCount: number;
  sourceCount: number;
  hasSources: boolean;
  sourceOpen: boolean;
  onToggleSources: () => void;
  onOpenGrid?: () => void;
  gridOpen: boolean;
  compareActive: boolean;
  onExitCompare?: () => void;
}) {
  const prompt = currentImage?.revisedPrompt || currentImage?.prompt || "";
  return (
    <header className="android-canvas-header">
      <div className="android-canvas-status-dot" data-running={isRunning ? "true" : "false"}>
        {isRunning ? <span className="android-canvas-spinner" aria-hidden="true" /> : currentImage ? <CheckCircle2 /> : <Square />}
      </div>
      <div className="android-canvas-header-copy">
        <div className="android-canvas-kicker">{progressLabel}</div>
        <div className="android-canvas-title">
          {currentImage ? (prompt || "当前图片") : "画布工作区"}
        </div>
      </div>
      <div className="android-canvas-header-actions">
        {streamPreviewActive ? (
          <button type="button" className="android-canvas-status-chip stream-preview-chip" title="流式预览">
            <StreamPreviewBadge compact />
          </button>
        ) : null}
        <button type="button" className="android-canvas-status-chip primary">
          {zoomLabel}
        </button>
        {compareActive && onExitCompare ? (
          <button
            type="button"
            className="android-canvas-status-chip compare-exit"
            onClick={onExitCompare}
            title="退出对比"
          >
            <Split className="h-3.5 w-3.5" /> 退出
          </button>
        ) : null}
        {onOpenGrid ? (
          <button
            type="button"
            className={`android-canvas-status-chip ${gridOpen ? "active" : ""}`}
            onClick={onOpenGrid}
          >
            {gridOpen ? "单图" : `${batchCount} 图`}
          </button>
        ) : null}
        {hasSources ? (
          <button
            type="button"
            className={`android-canvas-status-chip ${sourceOpen ? "active" : ""}`}
            onClick={onToggleSources}
          >
            参考 {sourceCount}
          </button>
        ) : null}
      </div>
    </header>
  );
}

export function AndroidCanvasProgressOverlay({
  stage,
  elapsed,
  bytes,
  runningJobs,
  jobsCompleted,
  jobsTotal,
  streamPreviewActive,
  placement = "canvas",
}: {
  stage?: string;
  elapsed?: number;
  bytes?: number;
  runningJobs: number;
  jobsCompleted: number;
  jobsTotal: number;
  streamPreviewActive: boolean;
  placement?: "canvas" | "compose";
}) {
  return (
    <div className={`android-canvas-progress ${placement === "compose" ? "android-canvas-progress-compose" : ""}`}>
      <div className="android-canvas-progress-head">
        <span className="android-canvas-spinner android-canvas-spinner-progress" aria-hidden="true" />
        <span>{stage ?? "正在请求"}</span>
      </div>
      <div className="android-canvas-progress-meta">
        {typeof elapsed === "number" ? <span>{elapsed.toFixed(1)}s</span> : null}
        {typeof bytes === "number" && bytes > 0 ? <span>{formatBytes(bytes)}</span> : null}
        {jobsTotal > 1 ? <span>{runningJobs} 并发 · {jobsCompleted}/{jobsTotal}</span> : null}
        {streamPreviewActive ? <span>流式预览</span> : null}
      </div>
    </div>
  );
}

function AndroidToolSegment({
  value,
  disabled,
  onChange,
}: {
  value: CanvasTool;
  disabled: boolean;
  onChange: (value: CanvasTool) => void;
}) {
  return (
    <div className="android-canvas-tool-segment" aria-label="画布工具">
      <SegmentButton active={value === "pan"} disabled={disabled} label="移动" onClick={() => onChange("pan")}>
        <Hand />
      </SegmentButton>
      <SegmentButton active={value === "mask"} disabled={disabled} label="蒙版" onClick={() => onChange("mask")}>
        <Brush />
      </SegmentButton>
      <SegmentButton active={value === "annotate"} disabled={disabled} label="标注" onClick={() => onChange("annotate")}>
        <Square />
      </SegmentButton>
    </div>
  );
}

function AndroidMaskControls({
  brushMode,
  brushSize,
  onSetBrushMode,
  onSetBrushSize,
  onResetMask,
}: {
  brushMode: BrushMode;
  brushSize: number;
  onSetBrushMode: (value: BrushMode) => void;
  onSetBrushSize: (value: number) => void;
  onResetMask: () => void;
}) {
  return (
    <div className="android-canvas-context-card mask">
      <div className="android-canvas-context-row">
        <DockIconButton title="画笔" active={brushMode === "paint"} onClick={() => onSetBrushMode("paint")}>
          <Brush />
        </DockIconButton>
        <DockIconButton title="橡皮" active={brushMode === "erase"} onClick={() => onSetBrushMode("erase")}>
          <Eraser />
        </DockIconButton>
        <button type="button" className="android-canvas-text-action danger" onClick={onResetMask}>
          清空
        </button>
      </div>
      <label className="android-canvas-slider-row">
        <span>大小</span>
        <input
          type="range"
          min={5}
          max={120}
          value={brushSize}
          onChange={(e) => onSetBrushSize(Number(e.target.value))}
        />
        <strong>{brushSize}</strong>
      </label>
    </div>
  );
}

function AndroidAnnotationControls({
  annotationKind,
  annotationColor,
  onSetKind,
  onSetColor,
  onClear,
}: {
  annotationKind: AnnotationKind;
  annotationColor: string;
  onSetKind: (value: AnnotationKind) => void;
  onSetColor: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="android-canvas-context-card annotate">
      <div className="android-canvas-context-row">
        <DockIconButton title="矩形" active={annotationKind === "rect"} onClick={() => onSetKind("rect")}>
          <Square />
        </DockIconButton>
        <DockIconButton title="箭头" active={annotationKind === "arrow"} onClick={() => onSetKind("arrow")}>
          <ArrowRight />
        </DockIconButton>
        <DockIconButton title="自由画" active={annotationKind === "freehand"} onClick={() => onSetKind("freehand")}>
          <Pencil />
        </DockIconButton>
        <DockIconButton title="文字" active={annotationKind === "text"} onClick={() => onSetKind("text")}>
          <TypeIcon />
        </DockIconButton>
        <button type="button" className="android-canvas-text-action danger" onClick={onClear}>
          清空
        </button>
      </div>
      <div className="android-canvas-color-row" aria-label="标注颜色">
        {ANNOTATION_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            title={color}
            className={annotationColor === color ? "active" : ""}
            style={{ backgroundColor: color }}
            onClick={() => onSetColor(color)}
          />
        ))}
      </div>
    </div>
  );
}

function AndroidSourceStrip({
  sources,
  onAdd,
  onPreview,
  onRemove,
  onMove,
  onClear,
}: {
  sources: SourceImage[];
  onAdd: () => void;
  onPreview: (source: SourceImage) => void;
  onRemove: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onClear: () => void;
}) {
  return (
    <div className="android-canvas-source-strip">
      <div className="android-canvas-source-head">
        <span>参考图</span>
        {sources.length > 0 ? (
          <button type="button" onClick={onClear}>
            清空
          </button>
        ) : null}
      </div>
      <div className="android-canvas-source-list">
        {sources.map((source, index) => (
          <AndroidSourceTile
            key={`${source.path}-${index}`}
            source={source}
            index={index}
            total={sources.length}
            onPreview={onPreview}
            onRemove={onRemove}
            onMove={onMove}
          />
        ))}
        <button type="button" className="android-canvas-source-add" onClick={onAdd} title="添加参考图">
          <ImagePlus />
        </button>
      </div>
    </div>
  );
}

function AndroidSourceTile({
  source,
  index,
  total,
  onPreview,
  onRemove,
  onMove,
}: {
  source: SourceImage;
  index: number;
  total: number;
  onPreview: (source: SourceImage) => void;
  onRemove: (index: number) => void;
  onMove: (from: number, to: number) => void;
}) {
  const objectURL = useBlobURL(source.imageBlob ?? null, source.imageB64 ?? null);
  const previewURL = source.previewUrl || objectURL;
  return (
    <div className="android-canvas-source-tile" title={source.name}>
      <button
        type="button"
        className="android-canvas-source-preview"
        onClick={() => onPreview(source)}
        title="打开参考图大图"
      >
        {previewURL ? <img src={previewURL} alt={source.name} loading="lazy" decoding="async" /> : <span>{source.name.split(".").pop()?.toUpperCase() ?? "IMG"}</span>}
      </button>
      <div className="android-canvas-source-index">{index + 1}</div>
      <button type="button" className="android-canvas-source-remove" onClick={() => onRemove(index)} title="移除">
        <X />
      </button>
      {total > 1 ? (
        <div className="android-canvas-source-move">
          <button type="button" disabled={index === 0} onClick={() => onMove(index, index - 1)}>
            <RotateCcw />
          </button>
          <button type="button" disabled={index === total - 1} onClick={() => onMove(index, index + 1)}>
            <RotateCw />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AndroidCanvasDock({ children }: { children: ReactNode }) {
  return (
    <div className="android-canvas-dock">
      <span className="android-canvas-dock-affordance left" aria-hidden="true">‹</span>
      {children}
      <span className="android-canvas-dock-affordance right" aria-hidden="true">›</span>
    </div>
  );
}

function AndroidCanvasProgressOverlayLive() {
  const {
    stage,
    elapsed,
    bytes,
    runningJobs,
    jobsCompleted,
    jobsTotal,
    streamPreviewActive,
  } = useStudioStore((state) => ({
    stage: state.progress?.stage,
    elapsed: quantizeProgressElapsed(state.progress?.elapsed),
    bytes: quantizeProgressBytes(state.progress?.bytes),
    runningJobs: state.runningJobs.length,
    jobsCompleted: state.jobsCompleted,
    jobsTotal: state.jobsTotal,
    streamPreviewActive: !!state.streamPreview,
  }), shallow);

  return (
    <AndroidCanvasProgressOverlay
      stage={stage}
      elapsed={elapsed}
      bytes={bytes}
      runningJobs={runningJobs}
      jobsCompleted={jobsCompleted}
      jobsTotal={jobsTotal}
      streamPreviewActive={streamPreviewActive}
    />
  );
}

function quantizeProgressElapsed(elapsed?: number) {
  return typeof elapsed === "number" ? Math.floor(elapsed) : undefined;
}

function quantizeProgressBytes(bytes?: number) {
  if (typeof bytes !== "number" || bytes <= 0) return bytes;
  if (bytes < 128 * 1024) return bytes;
  return Math.floor(bytes / (128 * 1024)) * 128 * 1024;
}

function SegmentButton({
  active,
  disabled,
  label,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={active ? "active" : ""} disabled={disabled} onClick={onClick} title={label}>
      <span>{children}</span>
      <small>{label}</small>
    </button>
  );
}

function DockIconButton({
  active,
  danger,
  disabled,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`android-canvas-icon-button ${active ? "active" : ""} ${danger ? "danger" : ""}`}
      disabled={disabled}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function dataURLBase64(dataURL: string): string {
  const comma = dataURL.indexOf(",");
  if (comma < 0 || !dataURL.slice(0, comma).includes(";base64")) return "";
  return dataURL.slice(comma + 1);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
