import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Crop, FlipHorizontal, FlipVertical, RotateCcw, RotateCw } from "lucide-react";
import { useStudioStore } from "../../state/studioStore";
import { primaryCompareSourceFromCurrentImage } from "../../state/compareSourceSelection";
import { currentBatchTaskViewCount } from "../../state/batchTaskRecords";
import { isLikelyPanoramaItem, panoramaProjectOutputsForSource } from "../../panorama/core";
import { usePlatform } from "../../platform/context";
import { qualityLabel, sizeLabel } from "../history/historyLabels";
import {
  ActionSection,
  BaseToolSection,
  ContextualSection,
  ResultMetaSection,
  TransformSection,
} from "./toolbarActionSections";
import { Sep, ToolBtn, ToolbarGroup } from "./toolbarPrimitives";
import { PanoramaOutputManagerModal } from "../panorama/PanoramaOutputManagerModal";
import { AnnotationOverflowModal } from "../../features/annotation/AnnotationOverflowModal";
import { AnnotationActionBar } from "../../features/annotation/AnnotationActionBar";
import {
  annotationFontSize as getAnnotationFontSize,
  annotationStrokeWidth as getAnnotationStrokeWidth,
} from "../../features/annotation/annotationTypes";

export function Toolbar() {
  const {
    currentImage, tool, brushSize, annotationStrokeWidth, annotationFontSize, brushMode,
    annotationKind, annotationColor,
    annotations, selectedAnnotationId, undoStack, redoStack,
    fullscreen,
    compareB, compareMode, setCompareB, openCompareWithPrimarySource,
    sourcePreviewReturnImage, closeSourcePreview,
    isRunning,
    jobsTotal, history,
    activeWorkspaceId, workspaces, batchTasksById,
    jobGroupsByWorkspace,
    batchResults, resultGridOpen, openResultGrid, closeResultGrid,
    historyGalleryOpen, historyGallerySinglePreviewId, openHistoryGallery, closeHistoryGalleryToEmpty,
    setField, toggleFullscreen, saveCurrentImageAs, shareCurrentImage,
    resetMask, clearAnnotations, removeAnnotation, undo, redo,
    updateAnnotationStyle,
    rotateCurrent, flipCurrent, cropToRect, prepareAnnotationSource,
    startLocalEditRoundtrip,
    confirmAnnotationComposite,
    beginAnnotationSession, isAnnotationSessionDirty, cancelAnnotationSession, endAnnotationSession,
    openResultDetail,
    openPanoramaViewer,
  } = useStudioStore();
  // A newly drawn rectangle is visible immediately but may not yet have a
  // selectedAnnotationId. Prefer an explicit selection, then the newest
  // rectangle so the local-edit action can use the just-created region.
  const selRect = annotations.find((a) => a.id === selectedAnnotationId && a.kind === "rect")
    ?? [...annotations].reverse().find((a) => a.kind === "rect");
  const selectedAnnotation = annotations.find((annotation) => annotation.id === selectedAnnotationId) ?? null;
  const selectedAnnotationStrokeWidth = selectedAnnotation && selectedAnnotation.kind !== "text"
    ? getAnnotationStrokeWidth(selectedAnnotation, annotationStrokeWidth)
    : annotationStrokeWidth;
  const selectedAnnotationFontSize = selectedAnnotation && (selectedAnnotation.kind === "text" || selectedAnnotation.kind === "arrow")
    ? getAnnotationFontSize(selectedAnnotation, annotationFontSize)
    : annotationFontSize;
  const setAnnotationStrokeWidth = (value: number) => {
    if (selectedAnnotation && selectedAnnotation.kind !== "text") updateAnnotationStyle(selectedAnnotation.id, { strokeWidth: value });
    setField("annotationStrokeWidth", value);
  };
  const setAnnotationFontSize = (value: number) => {
    if (selectedAnnotation && (selectedAnnotation.kind === "text" || selectedAnnotation.kind === "arrow")) {
      updateAnnotationStyle(selectedAnnotation.id, { fontSize: value });
    }
    setField("annotationFontSize", value);
  };
  const { isAndroidPhone, usesMacDesktopUI, usesAppleUI } = usePlatform();
  const [mobileAdjustOpen, setMobileAdjustOpen] = useState(false);
  const [annotationToolsExpanded, setAnnotationToolsExpanded] = useState(tool === "annotate");
  const [annotationOverflowOpen, setAnnotationOverflowOpen] = useState(false);
  const [annotationCompositeBusy, setAnnotationCompositeBusy] = useState(false);
  const [annotationSourcePreparing, setAnnotationSourcePreparing] = useState(false);
  const [panoramaOutputManagerOpen, setPanoramaOutputManagerOpen] = useState(false);
  const [annotationActionPortal, setAnnotationActionPortal] = useState<HTMLElement | null>(null);
  const previousToolRef = useRef<typeof tool | null>(null);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const findPortal = () => setAnnotationActionPortal(document.querySelector<HTMLElement>("[data-annotation-action-portal]"));
    findPortal();
    const observer = typeof MutationObserver === "function"
      ? new MutationObserver(findPortal)
      : null;
    observer?.observe(document.body, { childList: true, subtree: true });
    return () => observer?.disconnect();
  }, []);
  useEffect(() => {
    setAnnotationToolsExpanded(tool === "annotate");
    if (tool === "annotate") {
      beginAnnotationSession();
    } else if (previousToolRef.current === "annotate") {
      endAnnotationSession();
    }
    previousToolRef.current = tool;
  }, [beginAnnotationSession, endAnnotationSession, tool]);
  const handleConfirmAnnotations = async () => {
    if (annotationCompositeBusy) return;
    setAnnotationCompositeBusy(true);
    try {
      const result = await confirmAnnotationComposite("strict");
      if (result === "overflow") setAnnotationOverflowOpen(true);
    } finally {
      setAnnotationCompositeBusy(false);
    }
  };
  const handleExpandAnnotationCanvas = async () => {
    if (annotationCompositeBusy) return;
    setAnnotationCompositeBusy(true);
    try {
      const result = await confirmAnnotationComposite("expand-white");
      if (result === "saved") setAnnotationOverflowOpen(false);
    } finally {
      setAnnotationCompositeBusy(false);
    }
  };
  const handleCancelAnnotations = () => {
    if (annotationCompositeBusy) return;
    if (isAnnotationSessionDirty()
      && typeof window !== "undefined"
      && !window.confirm("当前有未确认的标注修改，确定取消并丢弃本轮标注吗？")) return;
    cancelAnnotationSession();
    setAnnotationOverflowOpen(false);
    setAnnotationToolsExpanded(false);
  };
  const handleToggleAnnotationTools = async () => {
    if (annotationSourcePreparing || annotationCompositeBusy) return;
    if (tool === "annotate") {
      setAnnotationToolsExpanded((expanded) => !expanded);
      return;
    }
    setAnnotationSourcePreparing(true);
    try {
      const ready = await prepareAnnotationSource();
      if (!ready) return;
      setField("tool", "annotate");
      setAnnotationToolsExpanded(true);
    } finally {
      setAnnotationSourcePreparing(false);
    }
  };
  const hasImage = !!currentImage;
  const canOpenPanorama = !!currentImage;
  const panoramaOutputs = useMemo(
    () => (currentImage ? panoramaProjectOutputsForSource(history, currentImage) : []),
    [history, currentImage],
  );
  const canOpenPanoramaOutputs = !!currentImage && (
    panoramaOutputs.length > 0
    || !!currentImage.panoramaProject
    || isLikelyPanoramaItem(currentImage)
  );
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const batchTaskViewCount = currentBatchTaskViewCount(
    activeWorkspaceId,
    activeWorkspace?.batchTaskIds,
    batchTasksById,
    jobsTotal,
    batchResults,
    jobGroupsByWorkspace[activeWorkspaceId] ?? [],
  );
  const hasBatchTaskView = batchTaskViewCount > 0;
  const showReturnFromHistoryGallery = !!currentImage
    && !resultGridOpen
    && !historyGalleryOpen
    && historyGallerySinglePreviewId === currentImage.id;
  const showReturnToBatchPreview = hasBatchTaskView
    && !showReturnFromHistoryGallery
    && !resultGridOpen
    && !historyGalleryOpen
    && !!currentImage;
  // Keep the compare affordances mounted after the current view is cleared.
  // They remain disabled until an image/source is selected, which prevents the
  // toolbar from collapsing and makes the empty canvas state reversible.
  const showCompareToggle = !resultGridOpen && !historyGalleryOpen;
  const showReturnFromSourcePreview = currentImage?.id?.startsWith("source-preview-") === true
    && !resultGridOpen
    && !historyGalleryOpen;
  const returnFromSourcePreviewTitle = sourcePreviewReturnImage
    ? "退出参考图，回到生成图"
    : "退出参考图";
  const compareSource = primaryCompareSourceFromCurrentImage(currentImage, activeWorkspace?.sources ?? []);
  const compareActive = !!compareB;
  const sideBySideActive = compareActive && compareMode === "sideBySide";
  const curtainActive = compareActive && compareMode !== "sideBySide";
  const compareDisabled = !currentImage || (!compareActive && !compareSource);
  const sideBySideTitle = sideBySideActive
    ? "退出双图对比"
    : compareDisabled
      ? "当前图片没有可用原图可对比"
      : "并排查看原图和成图";
  const curtainTitle = curtainActive
    ? "退出卷帘对比"
    : compareDisabled
      ? "当前图片没有可用原图可对比"
      : "查看原图和成图的卷帘对比";
  const showToolSection = true;
  const showAnnotationTools = tool === "annotate" && hasImage && annotationToolsExpanded;
  const showAnnotationActionBar = tool === "annotate"
    && hasImage
    && !resultGridOpen
    && !historyGalleryOpen
    && !!annotationActionPortal;
  const showMaskTools = tool === "mask" && hasImage;
  const showViewReset = tool === "pan" && hasImage;
  const showTransformSection = true;
  const localEditAction = currentImage
    ? () => void startLocalEditRoundtrip(selRect && selRect.width && selRect.height
      ? { x: selRect.x, y: selRect.y, width: selRect.width, height: selRect.height }
      : undefined)
    : null;
  const showSecondaryBar = true;
  const hasViewContent = hasImage || resultGridOpen || historyGalleryOpen;
  const mergeViewTransformSection = usesMacDesktopUI && showViewReset && !showMaskTools && !showAnnotationTools;
  const hasContextSection = showMaskTools || showAnnotationTools || (showViewReset && !mergeViewTransformSection);
  const hasTransformTools = true;
  const contextCaption = showMaskTools ? "蒙版" : showAnnotationTools ? "标注" : showViewReset ? "视图" : undefined;
  const contextualGroupClassName = `toolbar-group-inline toolbar-group-card toolbar-contextual ${
    showMaskTools || showAnnotationTools ? "toolbar-contextual-expansive" : "toolbar-contextual-compact"
  }`;
  const transformGroupClassName = `toolbar-group-inline toolbar-group-card toolbar-transforms ${
    showMaskTools || showAnnotationTools ? "toolbar-transforms-balanced" : mergeViewTransformSection ? "toolbar-transforms-merged" : "toolbar-transforms-primary"
  }`;
  const macTransformGroup = mergeViewTransformSection ? (
    <ToolbarGroup className={`${transformGroupClassName} toolbar-view-transform`} caption="视图与变换">
      <ContextualSection
        showMaskTools={false}
        showAnnotationTools={false}
        showViewReset
        brushMode={brushMode}
        brushSize={brushSize}
        annotationStrokeWidth={selectedAnnotationStrokeWidth}
        annotationFontSize={selectedAnnotationFontSize}
        annotationKind={annotationKind}
        annotationColor={annotationColor}
        onSetBrushMode={(mode) => setField("brushMode", mode)}
        onSetBrushSize={(size) => setField("brushSize", size)}
        onSetAnnotationStrokeWidth={setAnnotationStrokeWidth}
        onSetAnnotationFontSize={setAnnotationFontSize}
        onResetMask={resetMask}
        onSetAnnotationKind={(kind) => setField("annotationKind", kind)}
        onSetAnnotationColor={(color) => setField("annotationColor", color)}
        onClearAnnotations={clearAnnotations}
        onConfirmAnnotations={() => { void handleConfirmAnnotations(); }}
        annotationConfirming={annotationCompositeBusy}
        onResetView={() => (window as any).__canvasResetView?.()}
      />
      <Sep />
      <TransformSection
        currentImageSavedPath={currentImage?.savedPath}
        isAndroidPhone={isAndroidPhone}
        mobileAdjustOpen={mobileAdjustOpen}
        onToggleMobileAdjust={() => setMobileAdjustOpen((v) => !v)}
        onRotate={rotateCurrent}
        onFlip={flipCurrent}
        cropAction={hasImage && !isAndroidPhone && selRect && selRect.width && selRect.height
          ? () => cropToRect(selRect.x, selRect.y, selRect.width!, selRect.height!)
          : null}
        localEditAction={localEditAction}
      />
    </ToolbarGroup>
  ) : hasTransformTools ? (
    <ToolbarGroup className={transformGroupClassName} caption="变换">
      <TransformSection
        currentImageSavedPath={currentImage?.savedPath}
        isAndroidPhone={isAndroidPhone}
        mobileAdjustOpen={mobileAdjustOpen}
        onToggleMobileAdjust={() => setMobileAdjustOpen((v) => !v)}
        onRotate={rotateCurrent}
        onFlip={flipCurrent}
        cropAction={hasImage && !isAndroidPhone && selRect && selRect.width && selRect.height
          ? () => cropToRect(selRect.x, selRect.y, selRect.width!, selRect.height!)
          : null}
        localEditAction={localEditAction}
      />
    </ToolbarGroup>
  ) : null;
  const outputManagerModal = (
    <PanoramaOutputManagerModal
      open={panoramaOutputManagerOpen}
      source={currentImage}
      onClose={() => setPanoramaOutputManagerOpen(false)}
    />
  );
  const annotationOverflowModal = (
    <AnnotationOverflowModal
      open={annotationOverflowOpen}
      busy={annotationCompositeBusy}
      onClose={() => setAnnotationOverflowOpen(false)}
      onExpand={() => { void handleExpandAnnotationCanvas(); }}
    />
  );
  const annotationActionBar = showAnnotationActionBar ? createPortal(
    <AnnotationActionBar
      canUndo={undoStack.length > 0}
      canRedo={redoStack.length > 0}
      canDelete={!!selectedAnnotationId && annotations.some((annotation) => annotation.id === selectedAnnotationId)}
      busy={annotationCompositeBusy}
      onUndo={undo}
      onRedo={redo}
      onDelete={() => {
        if (selectedAnnotationId) removeAnnotation(selectedAnnotationId);
      }}
      onConfirm={() => { void handleConfirmAnnotations(); }}
      onCancel={handleCancelAnnotations}
    />,
    annotationActionPortal,
  ) : null;

  if (usesMacDesktopUI) {
    return (
      <>
      <div className={`canvas-toolbar border-b border-[var(--border)] bg-[var(--toolbar)] px-3 py-2 backdrop-blur-2xl ${usesAppleUI ? "liquid-glass-bar" : ""}`}>
        <div className="toolbar-row toolbar-row-primary">
          {showToolSection ? (
            <ToolbarGroup className="toolbar-group-primary toolbar-group-card" caption="工具">
              <BaseToolSection
                hasImage={hasImage}
                tool={tool}
                annotationToolsExpanded={annotationToolsExpanded}
                annotationPreparing={annotationSourcePreparing}
                onSetTool={(nextTool) => setField("tool", nextTool)}
                onToggleAnnotationTools={() => { void handleToggleAnnotationTools(); }}
              />
            </ToolbarGroup>
          ) : null}
          {hasContextSection ? (
            <ToolbarGroup className={contextualGroupClassName} caption={contextCaption}>
              <ContextualSection
                showMaskTools={showMaskTools}
                showAnnotationTools={showAnnotationTools}
                showViewReset={showViewReset}
                brushMode={brushMode}
                brushSize={brushSize}
                annotationStrokeWidth={selectedAnnotationStrokeWidth}
                annotationFontSize={selectedAnnotationFontSize}
                annotationKind={annotationKind}
                annotationColor={annotationColor}
                onSetBrushMode={(mode) => setField("brushMode", mode)}
                onSetBrushSize={(size) => setField("brushSize", size)}
                onSetAnnotationStrokeWidth={setAnnotationStrokeWidth}
                onSetAnnotationFontSize={setAnnotationFontSize}
                onResetMask={resetMask}
                onSetAnnotationKind={(kind) => setField("annotationKind", kind)}
                onSetAnnotationColor={(color) => setField("annotationColor", color)}
                onClearAnnotations={clearAnnotations}
                onConfirmAnnotations={() => { void handleConfirmAnnotations(); }}
                annotationConfirming={annotationCompositeBusy}
                onResetView={() => (window as any).__canvasResetView?.()}
              />
            </ToolbarGroup>
          ) : null}
          {macTransformGroup}
        </div>

        {showSecondaryBar ? (
          <div className="toolbar-row toolbar-row-secondary">
            <ToolbarGroup className="toolbar-group-support toolbar-group-card min-w-0">
                <ResultMetaSection
                showCompareToggle={showCompareToggle}
                sideBySideActive={sideBySideActive}
                curtainActive={curtainActive}
                compareDisabled={compareDisabled}
                sideBySideTitle={sideBySideTitle}
                curtainTitle={curtainTitle}
                showReturnFromSourcePreview={showReturnFromSourcePreview}
                returnFromSourcePreviewTitle={returnFromSourcePreviewTitle}
                showReturnFromHistoryGallery={showReturnFromHistoryGallery}
                showReturnToBatchPreview={showReturnToBatchPreview}
                hasBatchTaskView={hasBatchTaskView}
                metaBadges={currentImage && !isAndroidPhone ? [sizeLabel(currentImage.size), qualityLabel(currentImage.quality)] : []}
                onToggleSideBySideCompare={() => {
                  if (sideBySideActive) setCompareB(null);
                  else if (compareB) void setCompareB(compareB, "sideBySide");
                  else void openCompareWithPrimarySource("sideBySide");
                }}
                onToggleCurtainCompare={() => {
                  if (curtainActive) setCompareB(null);
                  else if (compareB) void setCompareB(compareB, "curtain");
                  else void openCompareWithPrimarySource("curtain");
                }}
                onReturnFromSourcePreview={closeSourcePreview}
                onReturnFromHistoryGallery={() => { void openHistoryGallery(); }}
                onToggleResultGrid={() => (resultGridOpen ? closeResultGrid() : openResultGrid())}
              />
            </ToolbarGroup>
            <ToolbarGroup className="toolbar-group-actions toolbar-group-card ml-auto justify-end">
              <ActionSection
                fullscreen={fullscreen}
                hasImage={!!currentImage}
                showPanoramaButton={canOpenPanorama}
                panoramaOutputCount={panoramaOutputs.length}
                hasViewContent={hasViewContent}
                clearViewDisabled={isRunning}
                onToggleFullscreen={() => void toggleFullscreen()}
                onOpenPanorama={() => currentImage && void openPanoramaViewer(currentImage)}
                onOpenPanoramaOutputs={canOpenPanoramaOutputs ? () => setPanoramaOutputManagerOpen(true) : undefined}
                onOpenDetail={() => currentImage && openResultDetail(currentImage)}
                onClearView={closeHistoryGalleryToEmpty}
                onSaveAs={saveCurrentImageAs}
                onShare={shareCurrentImage}
              />
            </ToolbarGroup>
          </div>
        ) : null}
      </div>
      {outputManagerModal}
      {annotationOverflowModal}
      {annotationActionBar}
      </>
    );
  }

  return (
    <>
    <div className={`canvas-toolbar border-b border-[var(--border)] bg-[var(--toolbar)] px-3 py-2 backdrop-blur-2xl ${usesAppleUI ? "liquid-glass-bar" : ""}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        {showToolSection ? (
          <>
            <BaseToolSection
              hasImage={hasImage}
              tool={tool}
              annotationToolsExpanded={annotationToolsExpanded}
              annotationPreparing={annotationSourcePreparing}
              onSetTool={(nextTool) => setField("tool", nextTool)}
              onToggleAnnotationTools={() => { void handleToggleAnnotationTools(); }}
            />
            {showMaskTools || showAnnotationTools || showViewReset || showTransformSection ? <Sep /> : null}
          </>
        ) : null}
        {showTransformSection ? (
          <>
            <TransformSection
              currentImageSavedPath={currentImage?.savedPath}
              isAndroidPhone={isAndroidPhone}
              mobileAdjustOpen={mobileAdjustOpen}
              onToggleMobileAdjust={() => setMobileAdjustOpen((v) => !v)}
              onRotate={rotateCurrent}
              onFlip={flipCurrent}
              cropAction={hasImage && !isAndroidPhone && selRect && selRect.width && selRect.height
                ? () => cropToRect(selRect.x, selRect.y, selRect.width!, selRect.height!)
                : null}
              localEditAction={localEditAction}
            />
          </>
        ) : null}
        {showMaskTools || showAnnotationTools || showViewReset ? (
          <>
            {showTransformSection ? <Sep /> : null}
            <ContextualSection
              showMaskTools={showMaskTools}
              showAnnotationTools={showAnnotationTools}
              showViewReset={showViewReset}
              brushMode={brushMode}
              brushSize={brushSize}
              annotationStrokeWidth={selectedAnnotationStrokeWidth}
              annotationFontSize={selectedAnnotationFontSize}
              annotationKind={annotationKind}
              annotationColor={annotationColor}
              onSetBrushMode={(mode) => setField("brushMode", mode)}
              onSetBrushSize={(size) => setField("brushSize", size)}
              onSetAnnotationStrokeWidth={setAnnotationStrokeWidth}
              onSetAnnotationFontSize={setAnnotationFontSize}
              onResetMask={resetMask}
              onSetAnnotationKind={(kind) => setField("annotationKind", kind)}
              onSetAnnotationColor={(color) => setField("annotationColor", color)}
              onClearAnnotations={clearAnnotations}
              onConfirmAnnotations={() => { void handleConfirmAnnotations(); }}
              annotationConfirming={annotationCompositeBusy}
              onResetView={() => (window as any).__canvasResetView?.()}
            />
          </>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
        {isAndroidPhone && mobileAdjustOpen && currentImage ? (
          <div className="flex items-center gap-1 rounded-full bg-black/[0.03] px-1 py-0.5 dark:bg-white/[0.05]">
            <ToolBtn onClick={() => rotateCurrent(-90)} disabled={!currentImage.savedPath} title="左转 90°">
              <RotateCcw className="w-3.5 h-3.5" />
            </ToolBtn>
            <ToolBtn onClick={() => rotateCurrent(90)} disabled={!currentImage.savedPath} title="右转 90°">
              <RotateCw className="w-3.5 h-3.5" />
            </ToolBtn>
            <ToolBtn onClick={() => flipCurrent(true)} disabled={!currentImage.savedPath} title="水平翻转">
              <FlipHorizontal className="w-3.5 h-3.5" />
            </ToolBtn>
            <ToolBtn onClick={() => flipCurrent(false)} disabled={!currentImage.savedPath} title="竖直翻转">
              <FlipVertical className="w-3.5 h-3.5" />
            </ToolBtn>
            {selRect && selRect.width && selRect.height ? (
              <ToolBtn onClick={() => cropToRect(selRect.x, selRect.y, selRect.width!, selRect.height!)} title="裁出选中矩形">
                <Crop className="w-3.5 h-3.5" />
              </ToolBtn>
            ) : null}
          </div>
        ) : null}
        <ResultMetaSection
          showCompareToggle={showCompareToggle}
          sideBySideActive={sideBySideActive}
          curtainActive={curtainActive}
          compareDisabled={compareDisabled}
          sideBySideTitle={sideBySideTitle}
          curtainTitle={curtainTitle}
          showReturnFromSourcePreview={showReturnFromSourcePreview}
          returnFromSourcePreviewTitle={returnFromSourcePreviewTitle}
          showReturnFromHistoryGallery={showReturnFromHistoryGallery}
          showReturnToBatchPreview={showReturnToBatchPreview}
          hasBatchTaskView={hasBatchTaskView}
          metaBadges={currentImage && !isAndroidPhone ? [sizeLabel(currentImage.size), qualityLabel(currentImage.quality)] : []}
          onToggleSideBySideCompare={() => {
            if (sideBySideActive) setCompareB(null);
            else if (compareB) void setCompareB(compareB, "sideBySide");
            else void openCompareWithPrimarySource("sideBySide");
          }}
          onToggleCurtainCompare={() => {
            if (curtainActive) setCompareB(null);
            else if (compareB) void setCompareB(compareB, "curtain");
            else void openCompareWithPrimarySource("curtain");
          }}
          onReturnFromSourcePreview={closeSourcePreview}
          onReturnFromHistoryGallery={() => { void openHistoryGallery(); }}
          onToggleResultGrid={() => (resultGridOpen ? closeResultGrid() : openResultGrid())}
        />
        <ActionSection
          fullscreen={fullscreen}
          hasImage={!!currentImage}
          showPanoramaButton={canOpenPanorama}
          panoramaOutputCount={panoramaOutputs.length}
          hasViewContent={hasViewContent}
          clearViewDisabled={isRunning}
          onToggleFullscreen={() => void toggleFullscreen()}
          onOpenPanorama={() => currentImage && void openPanoramaViewer(currentImage)}
          onOpenPanoramaOutputs={canOpenPanoramaOutputs ? () => setPanoramaOutputManagerOpen(true) : undefined}
          onOpenDetail={() => currentImage && openResultDetail(currentImage)}
          onClearView={closeHistoryGalleryToEmpty}
          onSaveAs={saveCurrentImageAs}
          onShare={shareCurrentImage}
        />
        </div>
      </div>
    </div>
      {outputManagerModal}
      {annotationOverflowModal}
      {annotationActionBar}
      </>
  );
}
