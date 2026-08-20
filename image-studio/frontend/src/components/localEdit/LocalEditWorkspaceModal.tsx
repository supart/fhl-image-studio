import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Bookmark, Save, X } from "lucide-react";
import { historyFullSrc } from "../../lib/images";
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
} | null;
type DragKind = "move" | "nw" | "ne" | "sw" | "se";

function ratioValue(aspect: string) {
  const [w, h] = aspect.split(":").map(Number);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? w / h : null;
}

function clampRect(rect: LocalEditWorkbenchDraft["cropRect"], sourceWidth: number, sourceHeight: number, aspect = "free") {
  const ratio = ratioValue(aspect);
  let width = Math.max(8, Math.min(sourceWidth, Math.round(rect.width)));
  let height = Math.max(8, Math.min(sourceHeight, Math.round(rect.height)));
  if (ratio) {
    height = Math.max(8, Math.round(width / ratio));
    width = Math.max(8, Math.round(height * ratio));
    if (width > sourceWidth) {
      width = sourceWidth;
      height = Math.max(8, Math.round(width / ratio));
    }
    if (height > sourceHeight) {
      height = sourceHeight;
      width = Math.max(8, Math.round(height * ratio));
    }
  }
  return {
    x: Math.max(0, Math.min(sourceWidth - width, Math.round(rect.x))),
    y: Math.max(0, Math.min(sourceHeight - height, Math.round(rect.y))),
    width,
    height,
  };
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

function centeredAspectLens(lens: LocalEditLens, aspect: string, sourceWidth: number, sourceHeight: number): LocalEditLens {
  const ratio = ratioValue(aspect);
  if (!ratio) return { ...lens, aspect };
  const centerX = lens.x + lens.width / 2;
  const centerY = lens.y + lens.height / 2;
  let width = Math.min(lens.width, lens.height * ratio, sourceWidth);
  let height = width / ratio;
  if (height > sourceHeight) {
    height = sourceHeight;
    width = height * ratio;
  }
  width = Math.max(8, Math.min(sourceWidth, Math.round(width)));
  height = Math.max(8, Math.min(sourceHeight, Math.round(height)));
  return {
    ...lens,
    aspect,
    x: Math.max(0, Math.min(sourceWidth - width, Math.round(centerX - width / 2))),
    y: Math.max(0, Math.min(sourceHeight - height, Math.round(centerY - height / 2))),
    width,
    height,
    outputWidth: width,
    outputHeight: height,
  };
}

function sourceUrl(item: HistoryItem | null) {
  if (!item) return "";
  if (item.imageB64) return tempDataURLFromB64(item.imageB64);
  const fullUrl = item.fullUrl && !item.fullUrl.includes("/media/thumb/") ? item.fullUrl : undefined;
  const candidate = historyFullSrc({ ...item, fullUrl, previewUrl: undefined }, null);
  return candidate && !candidate.includes("/media/thumb/") ? candidate : "";
}

function outputThumbUrl(item: HistoryItem) {
  if (item.imageB64) return tempDataURLFromB64(item.imageB64);
  return item.previewUrl || item.fullUrl || historyFullSrc(item, null);
}

export function LocalEditWorkspaceModal() {
  const draft = useStudioStore((state) => state.localEditWorkbenchDraft);
  const apiMode = useStudioStore((state) => state.apiMode);
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
  const [sourceSrc, setSourceSrc] = useState("");
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const aspectPresets = useMemo(() => aspectPresetsForAPIMode(apiMode, "edit"), [apiMode]);
  const sourceWidth = draft?.sourceWidth ?? 0;
  const sourceHeight = draft?.sourceHeight ?? 0;
  const sourceItem = useMemo(() => draft ? history.find((item) => item.id === draft.sourceHistoryId) ?? currentImage : currentImage, [currentImage, draft, history]);
  const localOutputs = useMemo(() => {
    if (!draft) return [];
    return history
      .filter((item) => item.id !== draft.sourceHistoryId && item.localEditRoundtrip?.kind === "planar" && item.localEditRoundtrip.sourceHistoryId === draft.sourceHistoryId)
      .slice(0, 8);
  }, [draft, history]);
  const isPanorama = draft?.mode === "panorama";

  useEffect(() => {
    if (!draft || !sourceItem) {
      setSourceSrc("");
      return;
    }
    const direct = sourceUrl(sourceItem);
    if (direct) {
      setSourceSrc(direct);
      return;
    }
    let cancelled = false;
    void (async () => {
      const b64 = draft.sourcePath ? await ReadImageAsBase64(draft.sourcePath).catch(() => "") : "";
      if (cancelled) return;
      if (b64) {
        setSourceSrc(tempDataURLFromB64(b64));
        return;
      }
      const fallback = sourceItem.imageB64
        ? tempDataURLFromB64(sourceItem.imageB64)
        : sourceItem.previewUrl || "";
      setSourceSrc(fallback);
    })();
    return () => { cancelled = true; };
  }, [draft, sourceItem]);

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
    if (!draft) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
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
  const crop = { x: lens.x, y: lens.y, width: lens.width, height: lens.height };
  const isCropPhase = draft.phase === "crop";
  const outputSize = `${crop.width} × ${crop.height}`;

  const updateRect = (next: LocalEditWorkbenchDraft["cropRect"]) => {
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
    if (!isCropPhase || isPanorama) return;
    event.preventDefault();
    event.stopPropagation();
    const stage = stageRef.current;
    if (!stage) return;
    dragRef.current = { kind, startX: event.clientX, startY: event.clientY, rect: crop };
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
      const ratio = ratioValue(draft.aspect);
      if (ratio) {
        const anchorX = drag.kind.includes("w") ? drag.rect.x + drag.rect.width : drag.rect.x;
        const anchorY = drag.kind.includes("n") ? drag.rect.y + drag.rect.height : drag.rect.y;
        let nextWidth = Math.max(8, rect.width);
        let nextHeight = Math.max(8, nextWidth / ratio);
        if (nextHeight > draft.sourceHeight) {
          nextHeight = draft.sourceHeight;
          nextWidth = nextHeight * ratio;
        }
        rect.width = nextWidth;
        rect.height = nextHeight;
        if (drag.kind.includes("w")) rect.x = anchorX - nextWidth;
        if (drag.kind.includes("n")) rect.y = anchorY - nextHeight;
      }
    }
    updateRect(rect);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  };

  const chooseAspect = (aspect: string) => {
    const nextLens = centeredAspectLens(lens, aspect, draft.sourceWidth, draft.sourceHeight);
    const nextRect = clampRect({ x: nextLens.x, y: nextLens.y, width: nextLens.width, height: nextLens.height }, draft.sourceWidth, draft.sourceHeight, aspect);
    updateDraft({ aspect, cropRect: nextRect, lens: { ...nextLens, ...nextRect }, dirty: true });
  };

  const confirmCrop = async (intent: LocalEditSaveIntent = "edit") => {
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
    <div className="lew-overlay" role="dialog" aria-modal="true" aria-label="裁切局部重绘工作台">
      <div className="lew-shell">
        <header className="lew-header">
          <div>
            <p className="lew-eyebrow">FHL STUDIO · LOCAL EDIT</p>
            <h2>裁切局部重绘工作台</h2>
            <span>{isPanorama ? "360 编辑入口" : "镜头选区"}</span>
          </div>
          <div className="lew-mode-switch" role="tablist" aria-label="编辑模式">
            <button type="button" className={!isPanorama ? "active" : ""} onClick={() => switchMode("planar")}>普通图像</button>
            <button type="button" className={isPanorama ? "active" : ""} onClick={() => switchMode("panorama")}>360 全景</button>
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
                  {!isPanorama && isCropPhase ? (
                    <div className="lew-crop-box" style={{ left: `${crop.x / draft.sourceWidth * 100}%`, top: `${crop.y / draft.sourceHeight * 100}%`, width: `${crop.width / draft.sourceWidth * 100}%`, height: `${crop.height / draft.sourceHeight * 100}%` }} onPointerDown={(event) => handlePointerDown(event, "move")}>
                      <span className="lew-crop-label">{outputSize}</span>
                      {(["nw", "ne", "sw", "se"] as const).map((handle) => <button key={handle} type="button" className={`lew-handle ${handle}`} aria-label={`调整${handle}角`} onPointerDown={(event) => handlePointerDown(event, handle)} />)}
                    </div>
                  ) : null}
                </div>
              ) : <div className="lew-empty">正在加载原图…</div>}
              {isPanorama ? <div className="lew-pano-note">全景模式由现有 360 编辑器接管。</div> : null}
            </div>
            <div className="lew-stage-footer"><span>{isPanorama ? "打开 360 编辑器调整镜头" : "拖动镜头框定位，四角调整范围"}</span><span className="lew-status-dot">离线工作流</span></div>
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
                    <div className="lew-aspect-control">
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
                    </div>
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
              {isPanorama ? <button type="button" className="lew-primary" onClick={() => { close(); if (currentImage) void openPanoramaViewer(currentImage); }}>打开 360 编辑器</button> : (
                <div className="lew-footer-actions">
                  <button type="button" className="lew-secondary lew-lens-save" onClick={() => void confirmCrop("lens")} disabled={busy || !isCropPhase}>
                    <Bookmark size={15} />保存镜头（不修改）
                  </button>
                  <button type="button" className="lew-primary" onClick={() => void confirmCrop("edit")} disabled={busy || !isCropPhase}>
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
