import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Bookmark, Eye, EyeOff, Maximize2, Redo2, RotateCcw, Save, Trash2, Undo2, X } from "lucide-react";
import { historyFullSrc } from "../../lib/images";
import {
  clampLocalEditRect,
  createCenteredLocalEditLens,
  localEditLensRect,
  resizeLocalEditLensToAspect,
  resizeLocalEditRectFromCorner,
} from "../../localEdit/lens";
import { tempDataURLFromB64 } from "../../state/studioStore.shared";
import { useStudioStore } from "../../state/studioStore";
import { ReadImageAsBase64 } from "../../platform/runtime/host";
import type { HistoryItem, LocalEditLens, LocalEditWorkbenchDraft } from "../../types/domain";
import { aspectPresetsForAPIMode, type AspectPreset } from "../panel/sizeCapabilities";
import { AspectRatioPicker } from "../panel/AspectRatioPicker";
import "./localEditWorkbench.css";

type LocalEditSaveIntent = "edit" | "lens";

type DragState = {
  kind: "move" | "nw" | "ne" | "sw" | "se";
  startX: number;
  startY: number;
  rect: LocalEditWorkbenchDraft["cropRect"];
  snapshot: LensSnapshot;
} | null;
type DragKind = "move" | "nw" | "ne" | "sw" | "se";
type LensSnapshot = {
  lens: LocalEditLens;
  cropRect: LocalEditWorkbenchDraft["cropRect"];
  aspect: string;
  lensActive: boolean;
};

function clampRect(rect: LocalEditWorkbenchDraft["cropRect"], sourceWidth: number, sourceHeight: number, aspect = "free") {
  return clampLocalEditRect(rect, sourceWidth, sourceHeight, aspect);
}

function lensFromDraft(draft: LocalEditWorkbenchDraft): LocalEditLens {
  return draft.lens ?? {
    id: "local-edit-lens-1",
    aspect: draft.aspect,
    x: draft.cropRect.x,
    y: draft.cropRect.y,
    width: draft.cropRect.width,
    height: draft.cropRect.height,
    outputWidth: draft.cropRect.width,
    outputHeight: draft.cropRect.height,
  };
}

function lensSnapshot(draft: LocalEditWorkbenchDraft): LensSnapshot {
  const lens = lensFromDraft(draft);
  return {
    lens: { ...lens },
    cropRect: { ...draft.cropRect },
    aspect: draft.aspect,
    lensActive: draft.lensActive !== false,
  };
}

function sameLensSnapshot(a: LensSnapshot, b: LensSnapshot) {
  return a.aspect === b.aspect
    && a.lensActive === b.lensActive
    && a.cropRect.x === b.cropRect.x
    && a.cropRect.y === b.cropRect.y
    && a.cropRect.width === b.cropRect.width
    && a.cropRect.height === b.cropRect.height
    && a.lens.x === b.lens.x
    && a.lens.y === b.lens.y
    && a.lens.width === b.lens.width
    && a.lens.height === b.lens.height;
}

function centeredAspectLens(lens: LocalEditLens, aspect: string, sourceWidth: number, sourceHeight: number): LocalEditLens {
  return resizeLocalEditLensToAspect(lens, aspect, sourceWidth, sourceHeight);
}

function sourceUrl(item: HistoryItem | null) {
  if (!item) return "";
  const fullUrl = item.fullUrl && !item.fullUrl.includes("/media/thumb/") ? item.fullUrl : undefined;
  const candidate = historyFullSrc({ ...item, fullUrl, previewUrl: undefined }, null);
  if (candidate && !candidate.includes("/media/thumb/")) return candidate;
  return item.imageB64 ? tempDataURLFromB64(item.imageB64) : "";
}

function outputThumbUrl(item: HistoryItem) {
  if (item.imageB64) return tempDataURLFromB64(item.imageB64);
  return item.previewUrl || item.fullUrl || historyFullSrc(item, null);
}

export function LocalEditWorkspaceModal() {
  const draft = useStudioStore((state) => state.localEditWorkbenchDraft);
  const apiMode = useStudioStore((state) => state.apiMode);
  const activeWorkspaceId = useStudioStore((state) => state.activeWorkspaceId);
  const currentImage = useStudioStore((state) => state.currentImage);
  const history = useStudioStore((state) => state.history);
  const updateDraft = useStudioStore((state) => state.updateLocalEditWorkbenchDraft);
  const commitCrop = useStudioStore((state) => state.commitLocalEditWorkbenchCrop);
  const close = useStudioStore((state) => state.closeLocalEditWorkbench);
  const switchMode = useStudioStore((state) => state.switchLocalEditWorkbenchMode);
  const openPanoramaViewer = useStudioStore((state) => state.openPanoramaViewer);
  const openResultDetail = useStudioStore((state) => state.openResultDetail);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imageFrameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewImageRef = useRef<{ src: string; image: HTMLImageElement } | null>(null);
  const [sourceSrc, setSourceSrc] = useState("");
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [undoStack, setUndoStack] = useState<LensSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<LensSnapshot[]>([]);
  const aspectPresets = useMemo(() => aspectPresetsForAPIMode(apiMode, "edit"), [apiMode]);
  const sourceWidth = draft?.sourceWidth ?? 0;
  const sourceHeight = draft?.sourceHeight ?? 0;
  const sourceItem = useMemo(() => {
    if (!draft) return currentImage;
    return history.find((item) => item.id === draft.sourceHistoryId)
      ?? (currentImage?.id === draft.sourceHistoryId ? currentImage : null);
  }, [currentImage, draft, history]);
  const localOutputs = useMemo(() => {
    if (!draft) return [];
    return history
      .filter((item) => item.id !== draft.sourceHistoryId && item.localEditRoundtrip?.kind === "planar" && item.localEditRoundtrip.sourceHistoryId === draft.sourceHistoryId)
      .slice(0, 8);
  }, [draft, history]);
  const isPanorama = draft?.mode === "panorama";
  const draftSourceHistoryId = draft?.sourceHistoryId ?? "";
  const draftSourcePath = draft?.sourcePath ?? "";
  const sourceItemId = sourceItem?.id ?? "";
  const sourceImageB64 = sourceItem?.imageB64 ?? "";
  const sourcePreviewUrl = sourceItem?.previewUrl ?? "";
  const previewMode = draft?.mode;
  const previewLensActive = draft ? draft.lensActive !== false : false;
  const directSourceUrl = useMemo(() => sourceUrl(sourceItem), [sourceItem]);
  const previewLens = useMemo(() => (draft ? lensFromDraft(draft) : null), [draft]);

  useEffect(() => {
    if (!draftSourceHistoryId || !sourceItemId) {
      setSourceSrc("");
      return;
    }
    if (directSourceUrl) {
      setSourceSrc(directSourceUrl);
      return;
    }
    let cancelled = false;
    void (async () => {
      const b64 = draftSourcePath ? await ReadImageAsBase64(draftSourcePath).catch(() => "") : "";
      if (cancelled) return;
      if (b64) {
        setSourceSrc(tempDataURLFromB64(b64));
        return;
      }
      const fallback = sourceImageB64 ? tempDataURLFromB64(sourceImageB64) : sourcePreviewUrl;
      setSourceSrc(fallback);
    })();
    return () => { cancelled = true; };
  }, [draftSourceHistoryId, draftSourcePath, sourceItemId, sourceImageB64, sourcePreviewUrl, directSourceUrl]);

  useEffect(() => {
    setUndoStack([]);
    setRedoStack([]);
    setPreviewExpanded(false);
    dragRef.current = null;
  }, [activeWorkspaceId, draft?.sourceHistoryId, draft?.mode]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !sourceWidth || !sourceHeight) return;
    const updateFrameSize = () => {
      const bounds = stage.getBoundingClientRect();
      const scale = Math.min(bounds.width / sourceWidth, bounds.height / sourceHeight);
      setFrameSize({
        width: Math.max(1, Math.floor(sourceWidth * scale)),
        height: Math.max(1, Math.floor(sourceHeight * scale)),
      });
    };
    updateFrameSize();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateFrameSize) : null;
    observer?.observe(stage);
    return () => observer?.disconnect();
  }, [sourceWidth, sourceHeight, sourceSrc]);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !sourceSrc || !previewLens || previewMode !== "planar" || !previewLensActive) {
      if (canvas) {
        canvas.width = 1;
        canvas.height = 1;
        canvas.getContext("2d")?.clearRect(0, 0, 1, 1);
      }
      return undefined;
    }
    const cropLens = previewLens;
    const aspect = Math.max(0.1, cropLens.width / Math.max(1, cropLens.height));
    const maxWidth = previewExpanded ? 520 : 260;
    const maxHeight = previewExpanded ? 320 : 170;
    let width = maxWidth;
    let height = width / aspect;
    if (height > maxHeight) {
      height = maxHeight;
      width = height * aspect;
    }
    const targetWidth = Math.max(1, Math.round(width));
    const targetHeight = Math.max(1, Math.round(height));
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    let cancelled = false;
    const drawPreview = (image: HTMLImageElement) => {
      if (cancelled) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.clearRect(0, 0, targetWidth, targetHeight);
      try {
        context.drawImage(image, cropLens.x, cropLens.y, cropLens.width, cropLens.height, 0, 0, targetWidth, targetHeight);
      } catch {
        context.clearRect(0, 0, targetWidth, targetHeight);
      }
    };
    const cached = previewImageRef.current;
    if (cached?.src === sourceSrc && cached.image.complete && cached.image.naturalWidth > 0) {
      drawPreview(cached.image);
      return () => { cancelled = true; };
    }
    const image = new Image();
    image.onload = () => drawPreview(image);
    image.onerror = () => {
      if (!cancelled) canvas.getContext("2d")?.clearRect(0, 0, targetWidth, targetHeight);
    };
    previewImageRef.current = { src: sourceSrc, image };
    image.src = sourceSrc;
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [previewMode, previewLensActive, previewLens, previewExpanded, sourceSrc]);

  useEffect(() => {
    if (!draft) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // The shared aspect picker owns Escape while its portal list is open.
        if (document.querySelector(".aspect-picker-menu")) return;
        close();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [close, draft]);

  if (!draft) return null;

  const lens = lensFromDraft(draft);
  const crop = localEditLensRect(lens);
  const lensActive = draft.lensActive !== false;
  const isCropPhase = draft.phase === "crop";
  const outputSize = lensActive ? `${crop.width} × ${crop.height}` : "未选择";

  const recordUndo = (snapshot: LensSnapshot) => {
    setUndoStack((stack) => [...stack, snapshot].slice(-40));
    setRedoStack([]);
  };

  const applyLensSnapshot = (snapshot: LensSnapshot) => {
    updateDraft({
      cropRect: snapshot.cropRect,
      lens: snapshot.lens,
      lensActive: snapshot.lensActive,
      aspect: snapshot.aspect,
      dirty: true,
    });
  };

  const handleUndo = () => {
    const currentDraft = useStudioStore.getState().localEditWorkbenchDraft;
    const previous = undoStack[undoStack.length - 1];
    if (!currentDraft || !previous) return;
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, lensSnapshot(currentDraft)].slice(-40));
    applyLensSnapshot(previous);
  };

  const handleRedo = () => {
    const currentDraft = useStudioStore.getState().localEditWorkbenchDraft;
    const next = redoStack[redoStack.length - 1];
    if (!currentDraft || !next) return;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, lensSnapshot(currentDraft)].slice(-40));
    applyLensSnapshot(next);
  };

  const resetLens = () => {
    const currentDraft = useStudioStore.getState().localEditWorkbenchDraft;
    if (!currentDraft || currentDraft.mode !== "planar") return;
    const nextLens = createCenteredLocalEditLens(
      currentDraft.sourceWidth,
      currentDraft.sourceHeight,
      currentDraft.aspect,
    );
    recordUndo(lensSnapshot(currentDraft));
    updateDraft({
      cropRect: localEditLensRect(nextLens),
      lens: nextLens,
      lensActive: true,
      dirty: true,
    });
  };

  const clearLens = () => {
    const currentDraft = useStudioStore.getState().localEditWorkbenchDraft;
    if (!currentDraft || currentDraft.lensActive === false) return;
    recordUndo(lensSnapshot(currentDraft));
    setPreviewExpanded(false);
    updateDraft({ lensActive: false, dirty: true });
  };

  const updateRect = (next: LocalEditWorkbenchDraft["cropRect"]) => {
    if (!lensActive) return;
    const rect = clampRect(next, draft.sourceWidth, draft.sourceHeight, draft.aspect);
    const currentLens = lensFromDraft(draft);
    updateDraft({
      cropRect: rect,
      lens: {
        ...currentLens,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        outputWidth: rect.width,
        outputHeight: rect.height,
      },
      dirty: true,
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>, kind: DragKind) => {
    if (!isCropPhase || isPanorama || !lensActive) return;
    event.preventDefault();
    event.stopPropagation();
    const stage = stageRef.current;
    if (!stage) return;
    dragRef.current = { kind, startX: event.clientX, startY: event.clientY, rect: crop, snapshot: lensSnapshot(draft) };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const stage = stageRef.current;
    if (!drag || !stage) return;
    const bounds = imageFrameRef.current?.getBoundingClientRect() ?? stage.getBoundingClientRect();
    const dx = ((event.clientX - drag.startX) / Math.max(1, bounds.width)) * draft.sourceWidth;
    const dy = ((event.clientY - drag.startY) / Math.max(1, bounds.height)) * draft.sourceHeight;
    const rect = { ...drag.rect };
    if (drag.kind === "move") {
      rect.x += dx;
      rect.y += dy;
    } else {
      if (drag.kind.includes("w")) { rect.x += dx; rect.width -= dx; }
      if (drag.kind.includes("e")) rect.width += dx;
      if (drag.kind.includes("n")) { rect.y += dy; rect.height -= dy; }
      if (drag.kind.includes("s")) rect.height += dy;
      const resized = resizeLocalEditRectFromCorner(
        drag.rect,
        drag.kind as "nw" | "ne" | "sw" | "se",
        dx,
        dy,
        draft.sourceWidth,
        draft.sourceHeight,
        draft.aspect,
      );
      rect.x = resized.x;
      rect.y = resized.y;
      rect.width = resized.width;
      rect.height = resized.height;
    }
    updateRect(rect);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const drag = dragRef.current;
    const latestDraft = useStudioStore.getState().localEditWorkbenchDraft;
    if (drag && latestDraft) {
      const current = lensSnapshot(latestDraft);
      if (!sameLensSnapshot(drag.snapshot, current)) recordUndo(drag.snapshot);
    }
    dragRef.current = null;
  };

  const chooseAspect = (aspect: string) => {
    if (!lensActive) return;
    const nextLens = centeredAspectLens(lens, aspect, draft.sourceWidth, draft.sourceHeight);
    const nextRect = clampRect({ x: nextLens.x, y: nextLens.y, width: nextLens.width, height: nextLens.height }, draft.sourceWidth, draft.sourceHeight, aspect);
    recordUndo(lensSnapshot(draft));
    updateDraft({ aspect, cropRect: nextRect, lens: { ...nextLens, ...nextRect }, dirty: true });
  };

  const confirmCrop = async (intent: LocalEditSaveIntent = "edit") => {
    if (!lensActive) {
      useStudioStore.getState().pushToast("当前没有激活的镜头，请先重置镜头", "warn", 3000);
      return;
    }
    setBusy(true);
    try {
      // Keep this cast compatible with older store snapshots while the intent-aware
      // action is rolled out. The store remains the source of truth for both paths.
      const commitWithIntent = commitCrop as unknown as (saveIntent?: LocalEditSaveIntent) => Promise<HistoryItem | null>;
      await commitWithIntent(intent);
    } finally { setBusy(false); }
  };

  const pickerValue = draft.aspect === "free" || draft.aspect === "auto"
    ? "auto"
    : (aspectPresets.some((item) => item.value === draft.aspect) ? draft.aspect : "auto");

  return (
    <div className="lew-overlay" role="dialog" aria-modal="true" aria-labelledby="lew-title">
      <div className="lew-shell">
        <header className="lew-header">
          <div>
            <p className="lew-eyebrow">FHL STUDIO · LOCAL EDIT</p>
            <h2 id="lew-title">裁切局部重绘工作台</h2>
            <span>{isPanorama ? "360 编辑入口" : "镜头选区"}</span>
          </div>
          <div className="lew-mode-switch" role="tablist" aria-label="编辑模式">
            <button type="button" role="tab" aria-selected={!isPanorama} className={!isPanorama ? "active" : ""} onClick={() => switchMode("planar")}>普通图像</button>
            <button type="button" role="tab" aria-selected={isPanorama} className={isPanorama ? "active" : ""} onClick={() => switchMode("panorama")}>360 全景</button>
          </div>
          <button type="button" className="lew-icon-button" onClick={close} aria-label="关闭工作台" title="关闭"><X size={18} /></button>
        </header>

        <main className="lew-main">
          <section className="lew-stage-column">
            <div className="lew-stage-toolbar"><span>{isPanorama ? "360 源图" : "原图裁切"}</span><strong>{draft.sourceWidth} × {draft.sourceHeight}</strong></div>
            <div ref={stageRef} className={`lew-stage${isPanorama ? " is-pano" : ""}`} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
              {sourceSrc ? (
                <div
                  ref={imageFrameRef}
                  className="lew-image-frame"
                  style={{
                    width: frameSize?.width ?? "100%",
                    height: frameSize?.height ?? "100%",
                    aspectRatio: `${draft.sourceWidth} / ${draft.sourceHeight}`,
                  }}
                >
                  <img src={sourceSrc} alt="裁切局部重绘原图" draggable={false} />
                  {!isPanorama && isCropPhase && lensActive ? (
                    <div className="lew-crop-box" style={{ left: `${crop.x / draft.sourceWidth * 100}%`, top: `${crop.y / draft.sourceHeight * 100}%`, width: `${crop.width / draft.sourceWidth * 100}%`, height: `${crop.height / draft.sourceHeight * 100}%` }} onPointerDown={(event) => handlePointerDown(event, "move")}>
                      <span className="lew-crop-label">{outputSize}</span>
                      {(["nw", "ne", "sw", "se"] as const).map((handle) => <button key={handle} type="button" className={`lew-handle ${handle}`} aria-label={`调整${handle === "nw" ? "左上" : handle === "ne" ? "右上" : handle === "sw" ? "左下" : "右下"}角`} onPointerDown={(event) => handlePointerDown(event, handle)} />)}
                    </div>
                  ) : null}
                </div>
              ) : <div className="lew-empty">正在加载原图…</div>}
              {!isPanorama && isCropPhase && lensActive && sourceSrc ? (
                <div className={`lew-output-preview${previewExpanded ? " is-expanded" : ""}`}>
                  <div className="lew-output-preview-head"><span>镜头预览</span><span>{outputSize}</span></div>
                  <canvas ref={previewCanvasRef} className="lew-output-preview-canvas" aria-label="当前镜头输出预览" />
                  <button
                    type="button"
                    className="lew-output-preview-toggle"
                    aria-label={previewExpanded ? "收起镜头预览" : "展开镜头预览"}
                    title={previewExpanded ? "收起预览" : "展开预览"}
                    onClick={() => setPreviewExpanded((expanded) => !expanded)}
                  >
                    {previewExpanded ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              ) : null}
              {!isPanorama && isCropPhase ? (
                <div className="lew-floating-bottom" role="toolbar" aria-label="镜头工具">
                  <button type="button" className="lew-floating-btn" onClick={handleUndo} disabled={!undoStack.length} aria-label="撤销" title="撤销"><Undo2 size={16} /></button>
                  <button type="button" className="lew-floating-btn" onClick={handleRedo} disabled={!redoStack.length} aria-label="重做" title="重做"><Redo2 size={16} /></button>
                  <button type="button" className="lew-floating-btn lew-floating-text" onClick={resetLens} aria-label="重置镜头" title="重置镜头"><RotateCcw size={15} /><span>重置镜头</span></button>
                  <button type="button" className="lew-floating-btn" onClick={clearLens} disabled={!lensActive} aria-label="清除镜头" title="清除镜头"><Trash2 size={16} /></button>
                  <button type="button" className="lew-floating-btn" onClick={() => setPreviewExpanded((expanded) => !expanded)} disabled={!lensActive} aria-pressed={previewExpanded} aria-label={previewExpanded ? "收起预览" : "展开预览"} title={previewExpanded ? "收起预览" : "展开预览"}><Maximize2 size={15} /></button>
                </div>
              ) : null}
              {isPanorama ? <div className="lew-pano-note">全景模式由现有 360 编辑器接管。</div> : null}
            </div>
            <div className="lew-stage-footer"><span>{isPanorama ? "打开 360 编辑器调整镜头" : lensActive ? "拖动镜头框定位，四角调整范围" : "镜头已清除，请点击重置镜头"}</span><span className="lew-status-dot">离线工作流</span></div>
          </section>

          <aside className="lew-panel">
            <div className="lew-panel-scroll">
              {isPanorama ? (
                <section className="lew-section lew-pano-handoff"><div className="lew-section-title"><span>360 工作台</span><span className="lew-pill">球面</span></div><p>普通图面板不会修改全景镜头。打开现有 360 编辑器继续调整比例、视角和输出。</p></section>
              ) : (
                <>
                  <section className="lew-section lew-output-manager">
                    <div className="lew-section-title"><span>输出管理</span><span className="lew-output-count">{localOutputs.length}</span></div>
                    {localOutputs.length > 0 ? <div className="lew-output-list">{localOutputs.map((item) => <div key={item.id} className="lew-output-item"><button type="button" className="lew-output-thumb" onClick={() => void openResultDetail(item)} title="打开详情">{outputThumbUrl(item) ? <img src={outputThumbUrl(item)} alt="" /> : <span>无预览</span>}</button><div className="lew-output-meta"><div className="lew-output-line"><span>局部结果</span><span>{item.width || item.previewWidth || "?"} × {item.height || item.previewHeight || "?"}</span></div><button type="button" className="lew-text-button" onClick={() => void openResultDetail(item)}>详情</button></div></div>)}</div> : <div className="lew-output-empty">还没有局部输出</div>}
                  </section>

                  <section className="lew-section">
                    <div className="lew-section-title"><span>镜头参数</span><span className="lew-muted">{draft.aspect === "free" || draft.aspect === "auto" ? "自由" : draft.aspect}</span></div>
                    <fieldset className="lew-aspect-control" disabled={!lensActive}>
                      <AspectRatioPicker
                        ariaLabel="裁切局部重绘比例"
                        value={pickerValue as AspectPreset}
                        presets={aspectPresets}
                        autoLabel="自由"
                        showAutoHint={false}
                        portalMenu
                        className="lew-aspect-picker"
                        onChange={(value) => chooseAspect(value === "auto" ? "free" : value)}
                      />
                    </fieldset>
                    <div className="lew-lens-size"><span>镜头尺寸</span><strong>{outputSize}</strong></div>
                  </section>

                  <section className="lew-section lew-output-section">
                    <div className="lew-section-title"><span>输出</span><span className="lew-muted">{outputSize}</span></div>
                    <div className="lew-output-size-card"><span>自然像素</span><strong>{outputSize}</strong><small>保存后送入外部图生图编辑流程</small></div>
                  </section>
                </>
              )}
            </div>
            <footer className="lew-footer">
              <button type="button" className="lew-secondary" onClick={close}>取消</button>
              {isPanorama ? <button type="button" className="lew-primary" onClick={() => { close(); if (sourceItem) void openPanoramaViewer(sourceItem); }}>打开 360 编辑器</button> : (
                <div className="lew-footer-actions">
                  <button type="button" className="lew-secondary lew-lens-save" onClick={() => void confirmCrop("lens")} disabled={busy || !isCropPhase || !lensActive}>
                    <Bookmark size={15} />保存镜头（不修改）
                  </button>
                  <button type="button" className="lew-primary" onClick={() => void confirmCrop("edit")} disabled={busy || !isCropPhase || !lensActive}>
                    <Save size={16} />{busy ? "保存中…" : "保存并编辑"}
                  </button>
                </div>
              )}
            </footer>
          </aside>
        </main>
      </div>
    </div>
  );
}
