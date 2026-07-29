import { useMemo, useState } from "react";
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

export function Toolbar() {
  const {
    currentImage, tool, brushSize, brushMode,
    annotationKind, annotationColor,
    annotations, selectedAnnotationId,
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
    resetMask, clearAnnotations,
    undoStack, redoStack, undo, redo,
    rotateCurrent, flipCurrent, cropToRect,
    openResultDetail,
    openPanoramaViewer,
  } = useStudioStore();
  const selRect = annotations.find((a) => a.id === selectedAnnotationId && a.kind === "rect");
  const { isAndroidPhone, isMac, usesAppleUI } = usePlatform();
  const [mobileAdjustOpen, setMobileAdjustOpen] = useState(false);
  const [panoramaOutputManagerOpen, setPanoramaOutputManagerOpen] = useState(false);
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
  const showCompareToggle = !!currentImage && !resultGridOpen && !historyGalleryOpen;
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
  const compareDisabled = !compareActive && !compareSource;
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
  const showToolSection = hasImage;
  const showAnnotationTools = tool === "annotate";
  const showMaskTools = tool === "mask";
  const showViewReset = tool === "pan" && hasImage;
  const showTransformSection = !!currentImage;
  const showSecondaryBar = true;
  const hasViewContent = hasImage || resultGridOpen || historyGalleryOpen;
  const mergeViewTransformSection = isMac && showViewReset && !showMaskTools && !showAnnotationTools;
  const hasContextSection = showMaskTools || showAnnotationTools || (showViewReset && !mergeViewTransformSection);
  const hasTransformTools = !!currentImage;
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
        annotationKind={annotationKind}
        annotationColor={annotationColor}
        onSetBrushMode={(mode) => setField("brushMode", mode)}
        onSetBrushSize={(size) => setField("brushSize", size)}
        onResetMask={resetMask}
        onSetAnnotationKind={(kind) => setField("annotationKind", kind)}
        onSetAnnotationColor={(color) => setField("annotationColor", color)}
        onClearAnnotations={clearAnnotations}
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
        cropAction={!isAndroidPhone && selRect && selRect.width && selRect.height
          ? () => cropToRect(selRect.x, selRect.y, selRect.width!, selRect.height!)
          : null}
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
        cropAction={!isAndroidPhone && selRect && selRect.width && selRect.height
          ? () => cropToRect(selRect.x, selRect.y, selRect.width!, selRect.height!)
          : null}
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

  if (isMac) {
    return (
      <>
      <div className={`canvas-toolbar border-b border-[var(--border)] bg-[var(--toolbar)] px-3 py-2 backdrop-blur-2xl ${usesAppleUI ? "liquid-glass-bar" : ""}`}>
        <div className="toolbar-row toolbar-row-primary">
          {showToolSection ? (
            <ToolbarGroup className="toolbar-group-primary toolbar-group-card" caption="工具">
              <BaseToolSection
                hasImage={hasImage}
                tool={tool}
                undoDisabled={undoStack.length === 0}
                redoDisabled={redoStack.length === 0}
                onSetTool={(nextTool) => setField("tool", nextTool)}
                onUndo={undo}
                onRedo={redo}
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
                annotationKind={annotationKind}
                annotationColor={annotationColor}
                onSetBrushMode={(mode) => setField("brushMode", mode)}
                onSetBrushSize={(size) => setField("brushSize", size)}
                onResetMask={resetMask}
                onSetAnnotationKind={(kind) => setField("annotationKind", kind)}
                onSetAnnotationColor={(color) => setField("annotationColor", color)}
                onClearAnnotations={clearAnnotations}
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
              undoDisabled={undoStack.length === 0}
              redoDisabled={redoStack.length === 0}
              onSetTool={(nextTool) => setField("tool", nextTool)}
              onUndo={undo}
              onRedo={redo}
            />
            {showMaskTools || showAnnotationTools || showViewReset || showTransformSection ? <Sep /> : null}
          </>
        ) : null}
        {showMaskTools || showAnnotationTools || showViewReset ? (
          <ContextualSection
            showMaskTools={showMaskTools}
            showAnnotationTools={showAnnotationTools}
            showViewReset={showViewReset}
            brushMode={brushMode}
            brushSize={brushSize}
            annotationKind={annotationKind}
            annotationColor={annotationColor}
            onSetBrushMode={(mode) => setField("brushMode", mode)}
            onSetBrushSize={(size) => setField("brushSize", size)}
            onResetMask={resetMask}
            onSetAnnotationKind={(kind) => setField("annotationKind", kind)}
            onSetAnnotationColor={(color) => setField("annotationColor", color)}
            onClearAnnotations={clearAnnotations}
            onResetView={() => (window as any).__canvasResetView?.()}
          />
        ) : null}
        {showTransformSection ? (
          <>
            {showMaskTools || showAnnotationTools || showViewReset ? <Sep /> : null}
            <TransformSection
              currentImageSavedPath={currentImage?.savedPath}
              isAndroidPhone={isAndroidPhone}
              mobileAdjustOpen={mobileAdjustOpen}
              onToggleMobileAdjust={() => setMobileAdjustOpen((v) => !v)}
              onRotate={rotateCurrent}
              onFlip={flipCurrent}
              cropAction={!isAndroidPhone && selRect && selRect.width && selRect.height
                ? () => cropToRect(selRect.x, selRect.y, selRect.width!, selRect.height!)
                : null}
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
    </>
  );
}
