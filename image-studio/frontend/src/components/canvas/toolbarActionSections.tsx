import {
  Brush, Crop, Eraser, FlipHorizontal, FlipVertical, Hand,
  ArrowLeft, Compass, FolderOpen, Info, MoveRight, Pencil, RotateCcw, RotateCw, Save, Share2, Square,
  Trash2, Maximize, Minimize, Type as TypeIcon,
} from "lucide-react";
import { ANNOTATION_COLORS } from "../../types/domain";
import { fullscreenShortcutLabel, redoShortcutLabel, undoShortcutLabel } from "../../platform";
import { usePlatform } from "../../platform/context";
import { HistoryMetaBadges } from "../history/HistoryMetaBadges";
import {
  colorDotRadius,
  pillRadius,
  ToolBtn,
  ToolbarNote,
  ToolbarPrimaryButton,
  ToolbarTextButton,
} from "./toolbarPrimitives";

export function BaseToolSection({
  hasImage,
  tool,
  undoDisabled,
  redoDisabled,
  onSetTool,
  onUndo,
  onRedo,
}: {
  hasImage: boolean;
  tool: "pan" | "mask" | "annotate";
  undoDisabled: boolean;
  redoDisabled: boolean;
  onSetTool: (tool: "pan" | "mask" | "annotate") => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const { isMac } = usePlatform();
  if (!hasImage) return null;
  return (
    <>
      <ToolBtn active={tool === "pan"} disabled={!hasImage} onClick={() => onSetTool("pan")} title="拖动 / 缩放 (1)" label={isMac ? "拖动" : undefined}>
        <Hand className="w-3.5 h-3.5" />
      </ToolBtn>
      <ToolBtn active={tool === "mask"} disabled={!hasImage} onClick={() => onSetTool("mask")} title="蒙版画笔 (2)" label={isMac ? "蒙版" : undefined}>
        <Brush className="w-3.5 h-3.5" />
      </ToolBtn>
      <ToolBtn active={tool === "annotate"} disabled={!hasImage} onClick={() => onSetTool("annotate")} title="画框标注 (3)" label={isMac ? "标注" : undefined}>
        <Square className="w-3.5 h-3.5" />
      </ToolBtn>
      <ToolBtn disabled={undoDisabled} onClick={onUndo} title={`撤销 (${undoShortcutLabel})`} label={isMac ? "撤销" : undefined}>
        <RotateCcw className="w-3.5 h-3.5" />
      </ToolBtn>
      <ToolBtn disabled={redoDisabled} onClick={onRedo} title={`重做 (${redoShortcutLabel})`} label={isMac ? "重做" : undefined}>
        <RotateCw className="w-3.5 h-3.5" />
      </ToolBtn>
    </>
  );
}

export function ContextualSection({
  showMaskTools,
  showAnnotationTools,
  showViewReset,
  brushMode,
  brushSize,
  annotationKind,
  annotationColor,
  onSetBrushMode,
  onSetBrushSize,
  onResetMask,
  onSetAnnotationKind,
  onSetAnnotationColor,
  onClearAnnotations,
  onResetView,
}: {
  showMaskTools: boolean;
  showAnnotationTools: boolean;
  showViewReset: boolean;
  brushMode: "paint" | "erase";
  brushSize: number;
  annotationKind: "rect" | "arrow" | "freehand" | "text";
  annotationColor: string;
  onSetBrushMode: (mode: "paint" | "erase") => void;
  onSetBrushSize: (size: number) => void;
  onResetMask: () => void;
  onSetAnnotationKind: (kind: "rect" | "arrow" | "freehand" | "text") => void;
  onSetAnnotationColor: (color: string) => void;
  onClearAnnotations: () => void;
  onResetView: () => void;
}) {
  const { isMac, usesFluentUI } = usePlatform();
  return (
    <>
      {showMaskTools ? (
        <>
          <ToolBtn active={brushMode === "paint"} onClick={() => onSetBrushMode("paint")} title="画笔" label={isMac ? "画笔" : undefined}>
            <Brush className="w-3.5 h-3.5" />
          </ToolBtn>
          <ToolBtn active={brushMode === "erase"} onClick={() => onSetBrushMode("erase")} title="橡皮(取消蒙版)" label={isMac ? "橡皮" : undefined}>
            <Eraser className="w-3.5 h-3.5" />
          </ToolBtn>
          <span className="ml-1 text-[11px] text-zinc-500">大小</span>
          <input
            type="range"
            min={5}
            max={120}
            value={brushSize}
            onChange={(e) => onSetBrushSize(Number(e.target.value))}
            className="w-20 accent-[var(--accent)]"
          />
          <span className="text-[11px] text-zinc-500 min-w-[24px] tabular-nums">{brushSize}</span>
          <ToolbarTextButton onClick={onResetMask} tone="danger">
            清空
          </ToolbarTextButton>
        </>
      ) : null}

      {showAnnotationTools ? (
        <>
          <ToolBtn active={annotationKind === "rect"} onClick={() => onSetAnnotationKind("rect")} title="矩形" label={isMac ? "矩形" : undefined}>
            <Square className="w-3.5 h-3.5" />
          </ToolBtn>
          <ToolBtn active={annotationKind === "arrow"} onClick={() => onSetAnnotationKind("arrow")} title="箭头" label={isMac ? "箭头" : undefined}>
            <MoveRight className="w-3.5 h-3.5" />
          </ToolBtn>
          <ToolBtn active={annotationKind === "freehand"} onClick={() => onSetAnnotationKind("freehand")} title="自由画笔" label={isMac ? "自由画" : undefined}>
            <Pencil className="w-3.5 h-3.5" />
          </ToolBtn>
          <ToolBtn active={annotationKind === "text"} onClick={() => onSetAnnotationKind("text")} title="文字" label={isMac ? "文字" : undefined}>
            <TypeIcon className="w-3.5 h-3.5" />
          </ToolBtn>
          <span className="mx-0.5 h-4 w-px bg-black/10 dark:bg-white/10" />
          <div className="flex items-center gap-1">
            {ANNOTATION_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => onSetAnnotationColor(c)}
                title={c}
                style={{ background: c }}
                className={`h-4 w-4 ring-1 transition-all ${
                  annotationColor === c ? "ring-2 ring-offset-1 ring-[color:var(--accent)]" : "ring-black/10 dark:ring-white/10"
                } ${colorDotRadius(usesFluentUI)}`}
              />
            ))}
          </div>
          <ToolbarTextButton onClick={onClearAnnotations} tone="danger">
            清空标注
          </ToolbarTextButton>
        </>
      ) : null}

      {showViewReset ? (
        <>
          <ToolbarTextButton onClick={onResetView} title="重置视图 (F)">
            重置视图
          </ToolbarTextButton>
          {isMac ? <ToolbarNote>拖动画布 · 滚轮缩放</ToolbarNote> : null}
        </>
      ) : null}
    </>
  );
}

export function TransformSection({
  currentImageSavedPath,
  isAndroidPhone,
  mobileAdjustOpen,
  onToggleMobileAdjust,
  onRotate,
  onFlip,
  cropAction,
}: {
  currentImageSavedPath?: string;
  isAndroidPhone: boolean;
  mobileAdjustOpen: boolean;
  onToggleMobileAdjust: () => void;
  onRotate: (degrees: number) => void;
  onFlip: (horizontal: boolean) => void;
  cropAction: null | (() => void);
}) {
  const { isMac, usesFluentUI } = usePlatform();
  return (
    <>
      {isAndroidPhone ? (
        <ToolbarTextButton
          onClick={onToggleMobileAdjust}
          selected={mobileAdjustOpen}
          title="旋转 / 翻转"
        >
          调整
        </ToolbarTextButton>
      ) : (
        <>
          <ToolBtn onClick={() => onRotate(-90)} disabled={!currentImageSavedPath} title="左转 90°" label={isMac ? "左转" : undefined}>
            <RotateCcw className="w-3.5 h-3.5" />
          </ToolBtn>
          <ToolBtn onClick={() => onRotate(90)} disabled={!currentImageSavedPath} title="右转 90°" label={isMac ? "右转" : undefined}>
            <RotateCw className="w-3.5 h-3.5" />
          </ToolBtn>
          <ToolBtn onClick={() => onFlip(true)} disabled={!currentImageSavedPath} title="水平翻转" label={isMac ? "水平翻转" : undefined}>
            <FlipHorizontal className="w-3.5 h-3.5" />
          </ToolBtn>
          <ToolBtn onClick={() => onFlip(false)} disabled={!currentImageSavedPath} title="竖直翻转" label={isMac ? "竖直翻转" : undefined}>
            <FlipVertical className="w-3.5 h-3.5" />
          </ToolBtn>
        </>
      )}
      {cropAction ? (
        <ToolbarTextButton onClick={cropAction} title="裁出选中矩形" tone="accent">
          <Crop className="w-3.5 h-3.5" /> 裁出
        </ToolbarTextButton>
      ) : null}
    </>
  );
}

export function ResultMetaSection({
  showCompareToggle,
  sideBySideActive,
  curtainActive,
  compareDisabled,
  sideBySideTitle,
  curtainTitle,
  showReturnFromSourcePreview,
  returnFromSourcePreviewTitle,
  showReturnFromHistoryGallery,
  showReturnToBatchPreview,
  hasBatchTaskView,
  metaBadges,
  onToggleSideBySideCompare,
  onToggleCurtainCompare,
  onReturnFromSourcePreview,
  onReturnFromHistoryGallery,
  onToggleResultGrid,
}: {
  showCompareToggle: boolean;
  sideBySideActive: boolean;
  curtainActive: boolean;
  compareDisabled: boolean;
  sideBySideTitle: string;
  curtainTitle: string;
  showReturnFromSourcePreview: boolean;
  returnFromSourcePreviewTitle: string;
  showReturnFromHistoryGallery: boolean;
  showReturnToBatchPreview: boolean;
  hasBatchTaskView: boolean;
  metaBadges: string[];
  onToggleSideBySideCompare: () => void;
  onToggleCurtainCompare: () => void;
  onReturnFromSourcePreview: () => void;
  onReturnFromHistoryGallery: () => void;
  onToggleResultGrid: () => void;
}) {
  return (
    <>
      {showReturnFromSourcePreview ? (
        <ToolbarTextButton
          onClick={onReturnFromSourcePreview}
          dataAuditId="return-from-source-preview"
          title={returnFromSourcePreviewTitle}
          tone="accent"
        >
          回到生成图
        </ToolbarTextButton>
      ) : null}
      {showReturnFromHistoryGallery ? (
        <ToolbarTextButton
          onClick={onReturnFromHistoryGallery}
          dataAuditId="return-from-history-gallery"
          title="回到完整相册列表"
          tone="accent"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> 回到完整相册
        </ToolbarTextButton>
      ) : null}
      {showCompareToggle ? (
        <>
          <ToolbarTextButton
            onClick={onToggleSideBySideCompare}
            disabled={compareDisabled}
            selected={sideBySideActive}
            title={sideBySideTitle}
          >
            双图对比
          </ToolbarTextButton>
          <ToolbarTextButton
            onClick={onToggleCurtainCompare}
            disabled={compareDisabled}
            selected={curtainActive}
            title={curtainTitle}
          >
            卷帘对比
          </ToolbarTextButton>
        </>
      ) : null}
      {showReturnToBatchPreview ? (
        <ToolbarTextButton
          onClick={hasBatchTaskView ? onToggleResultGrid : undefined}
          disabled={!hasBatchTaskView}
          title={!hasBatchTaskView ? "暂无当前批次任务" : "回到批次预览"}
        >
          回到批次预览
        </ToolbarTextButton>
      ) : null}
      <HistoryMetaBadges items={metaBadges} compact className="opacity-90" />
    </>
  );
}

export function ActionSection({
  fullscreen,
  hasImage,
  showPanoramaButton = false,
  panoramaOutputCount = 0,
  hasViewContent,
  clearViewDisabled = false,
  onToggleFullscreen,
  onOpenPanorama,
  onOpenPanoramaOutputs,
  onOpenDetail,
  onClearView,
  onSaveAs,
  onShare,
}: {
  fullscreen: boolean;
  hasImage: boolean;
  showPanoramaButton?: boolean;
  panoramaOutputCount?: number;
  hasViewContent: boolean;
  clearViewDisabled?: boolean;
  onToggleFullscreen: () => void;
  onOpenPanorama?: () => void;
  onOpenPanoramaOutputs?: () => void;
  onOpenDetail: () => void;
  onClearView: () => void;
  onSaveAs: () => void;
  onShare: () => void;
}) {
  const { isMac, usesFluentUI, isAndroidPhone } = usePlatform();
  const clearViewTitle = clearViewDisabled ? "运行中暂不能清空视图" : "清空当前批次，不删除历史和文件";
  return (
    <>
      <ToolBtn onClick={onToggleFullscreen} title={fullscreen ? `退出全屏 (${fullscreenShortcutLabel})` : `全屏 (${fullscreenShortcutLabel})`} label={isMac ? "全屏" : undefined}>
        {fullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
      </ToolBtn>
      {hasViewContent ? (
        isAndroidPhone ? (
          <ToolBtn onClick={onClearView} disabled={clearViewDisabled} title={clearViewTitle}>
            <Trash2 className="w-3.5 h-3.5" />
          </ToolBtn>
        ) : (
          <ToolbarTextButton onClick={onClearView} disabled={clearViewDisabled} title={clearViewTitle} tone="danger">
            <Trash2 className="w-3.5 h-3.5" />
            清空视图
          </ToolbarTextButton>
        )
      ) : null}
      {hasImage ? (
        <>
          {onOpenPanoramaOutputs ? (
            isAndroidPhone ? (
              <ToolBtn onClick={onOpenPanoramaOutputs} title={`360输出管理 ${panoramaOutputCount}`}>
                <FolderOpen className="w-3.5 h-3.5" />
              </ToolBtn>
            ) : (
              <ToolbarTextButton onClick={onOpenPanoramaOutputs} title={`360输出管理 ${panoramaOutputCount}`} tone="accent">
                <FolderOpen className="w-3.5 h-3.5" />
                360输出管理{panoramaOutputCount > 0 ? ` ${panoramaOutputCount}` : ""}
              </ToolbarTextButton>
            )
          ) : null}
          {showPanoramaButton && onOpenPanorama ? (
            isAndroidPhone ? (
              <ToolBtn onClick={onOpenPanorama} title="进入360查看">
                <Compass className="w-3.5 h-3.5" />
              </ToolBtn>
            ) : (
              <ToolbarTextButton onClick={onOpenPanorama} title="进入360查看" tone="accent">
                <Compass className="w-3.5 h-3.5" />
                进入360查看
              </ToolbarTextButton>
            )
          ) : null}
          <ToolBtn onClick={onOpenDetail} title="查看本张图的详细信息" label={isMac ? "详情" : undefined}>
            <Info className="w-3.5 h-3.5" />
          </ToolBtn>
          <ToolBtn onClick={onShare} title="分享图片" label={isMac ? "分享" : undefined}>
            <Share2 className="w-3.5 h-3.5" />
          </ToolBtn>
          {!isAndroidPhone ? (
            <ToolbarPrimaryButton onClick={onSaveAs} title="另存为">
              <Save className="w-3.5 h-3.5" /> 另存为
            </ToolbarPrimaryButton>
          ) : (
            <ToolBtn onClick={onSaveAs} title="另存为">
              <Save className="w-3.5 h-3.5" />
            </ToolBtn>
          )}
        </>
      ) : null}
    </>
  );
}
