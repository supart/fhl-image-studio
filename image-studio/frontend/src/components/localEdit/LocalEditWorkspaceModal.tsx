import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Check, ChevronDown, ImageUp, Sparkles, X } from "lucide-react";
import { historyFullSrc } from "../../lib/images";
import { tempDataURLFromB64 } from "../../state/studioStore.shared";
import { useStudioStore } from "../../state/studioStore";
import { ReadImageAsBase64 } from "../../platform/runtime/host";
import { SIZE_OPTIONS, QUALITY_OPTIONS, type HistoryItem, type LocalEditLens, type LocalEditWorkbenchDraft } from "../../types/domain";
import "./localEditWorkbench.css";

const ASPECTS = [
  { value: "free", label: "自由" },
  { value: "1:1", label: "1:1" },
  { value: "4:3", label: "4:3" },
  { value: "3:2", label: "3:2" },
  { value: "16:9", label: "16:9" },
  { value: "2:1", label: "2:1" },
];

type DragState = { kind: "move" | "nw" | "ne" | "sw" | "se"; startX: number; startY: number; rect: LocalEditWorkbenchDraft["cropRect"] } | null;
type DragKind = "move" | "nw" | "ne" | "sw" | "se";

function ratioValue(aspect: string) {
  const [w, h] = aspect.split(":").map(Number);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? w / h : null;
}

function clampRect(rect: LocalEditWorkbenchDraft["cropRect"], sourceWidth: number, sourceHeight: number) {
  const width = Math.max(8, Math.min(sourceWidth, Math.round(rect.width)));
  const height = Math.max(8, Math.min(sourceHeight, Math.round(rect.height)));
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

export function LocalEditWorkspaceModal() {
  const draft = useStudioStore((state) => state.localEditWorkbenchDraft);
  const currentImage = useStudioStore((state) => state.currentImage);
  const history = useStudioStore((state) => state.history);
  const updateDraft = useStudioStore((state) => state.updateLocalEditWorkbenchDraft);
  const commitCrop = useStudioStore((state) => state.commitLocalEditWorkbenchCrop);
  const close = useStudioStore((state) => state.closeLocalEditWorkbench);
  const switchMode = useStudioStore((state) => state.switchLocalEditWorkbenchMode);
  const openPanoramaViewer = useStudioStore((state) => state.openPanoramaViewer);
  const openAligner = useStudioStore((state) => state.openLocalPastebackAligner);
  const importExternal = useStudioStore((state) => state.importExternalLocalPastebackImage);
  const submit = useStudioStore((state) => state.submit);
  const setField = useStudioStore((state) => state.setField);
  const pushToast = useStudioStore((state) => state.pushToast);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imageFrameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState>(null);
  const importRef = useRef<HTMLInputElement | null>(null);
  const [sourceSrc, setSourceSrc] = useState("");
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const sourceWidth = draft?.sourceWidth ?? 0;
  const sourceHeight = draft?.sourceHeight ?? 0;
  const sourceItem = useMemo(() => draft ? history.find((item) => item.id === draft.sourceHistoryId) ?? currentImage : currentImage, [currentImage, draft, history]);
  const isPanorama = draft?.mode === "panorama";
  const isRatioCompatible = draft ? Math.abs((draft.sourceWidth / Math.max(1, draft.sourceHeight)) - 2) < 0.02 : false;

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
      const scale = Math.min(
        bounds.width / sourceWidth,
        bounds.height / sourceHeight,
      );
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

  const updateRect = (next: LocalEditWorkbenchDraft["cropRect"]) => {
    const rect = clampRect(next, draft.sourceWidth, draft.sourceHeight);
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
      aspect: draft.aspect,
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>, kind: DragKind) => {
    if (draft.phase !== "crop" || isPanorama) return;
    event.preventDefault();
    event.stopPropagation();
    const stage = stageRef.current;
    if (!stage) return;
    dragRef.current = { kind, startX: event.clientX, startY: event.clientY, rect: draft.cropRect };
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
    const nextLens = centeredAspectLens(lensFromDraft(draft), aspect, draft.sourceWidth, draft.sourceHeight);
    const nextRect = clampRect({ x: nextLens.x, y: nextLens.y, width: nextLens.width, height: nextLens.height }, draft.sourceWidth, draft.sourceHeight);
    updateDraft({ aspect, cropRect: nextRect, lens: { ...nextLens, ...nextRect }, dirty: true });
  };

  const confirmCrop = async () => {
    setBusy(true);
    try { await commitCrop(); } finally { setBusy(false); }
  };

  const startGeneration = async () => {
    if (isPanorama && !isRatioCompatible) {
      pushToast("只有 2:1 源图才能提交 360 全景生成", "warn", 3600);
      return;
    }
    setField("promptPrefix", draft.promptPrefix);
    setField("prompt", draft.prompt);
    setField("optimizationGuidance", draft.optimizationGuidance);
    setField("styleTag", draft.styleTag);
    setField("size", draft.size);
    setField("quality", draft.quality);
    setField("batchCount", 1);
    setBusy(true);
    try { await submit(); } finally { setBusy(false); }
  };

  const handleImport = async (file: File) => {
    if (!currentImage) return;
    setBusy(true);
    try {
      const imported = await importExternal(currentImage, file);
      if (imported) {
        updateDraft({ phase: "align", selectedResultId: imported.id, dirty: false });
        close();
      }
    } finally { setBusy(false); }
  };

  const enterAlign = () => {
    if (!currentImage) return;
    openAligner(currentImage);
    close();
  };

  const lens = lensFromDraft(draft);
  const crop = { x: lens.x, y: lens.y, width: lens.width, height: lens.height };
  return (
    <div className="lew-overlay" role="dialog" aria-modal="true" aria-label="局部编辑工作台">
      <div className="lew-shell">
        <header className="lew-header">
          <div>
            <p className="lew-eyebrow">FHL STUDIO · LOCAL EDIT</p>
            <h2>局部编辑工作台</h2>
            <span>{draft.phase === "crop" ? "选择区域" : draft.phase === "edit" ? "编辑与导入" : "对齐与贴回"}</span>
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
                  <img src={sourceSrc} alt="局部编辑原图" draggable={false} />
                  {!isPanorama && draft.phase === "crop" ? (
                    <div className="lew-crop-box" style={{ left: `${crop.x / draft.sourceWidth * 100}%`, top: `${crop.y / draft.sourceHeight * 100}%`, width: `${crop.width / draft.sourceWidth * 100}%`, height: `${crop.height / draft.sourceHeight * 100}%` }} onPointerDown={(event) => handlePointerDown(event, "move")}>
                      <span className="lew-crop-label">{crop.width} × {crop.height}</span>
                      {(["nw", "ne", "sw", "se"] as const).map((handle) => <button key={handle} type="button" className={`lew-handle ${handle}`} aria-label={`调整${handle}角`} onPointerDown={(event) => handlePointerDown(event, handle)} />)}
                    </div>
                  ) : null}
                </div>
              ) : <div className="lew-empty">正在加载原图…</div>}
              {isPanorama ? <div className="lew-pano-note">全景模式保留现有 360 球面查看、镜头和贴回流程。</div> : null}
            </div>
            <div className="lew-stage-footer"><span>选择比例后拖动镜头框定位，四角调整大小</span><span className="lew-status-dot">离线工作流</span></div>
          </section>

          <aside className="lew-panel">
            <div className="lew-panel-scroll">
              <section className="lew-section"><div className="lew-section-title"><span>工作阶段</span><span className="lew-pill">{draft.phase}</span></div><div className="lew-steps"><span className={draft.phase === "crop" ? "active" : "done"}>1 选择区域</span><span className={draft.phase === "edit" ? "active" : draft.phase === "align" ? "done" : ""}>2 编辑</span><span className={draft.phase === "align" ? "active" : ""}>3 贴回</span></div></section>
              <section className="lew-section"><div className="lew-section-title"><span>比例</span><span className="lew-muted">{draft.aspect}</span></div><div className="lew-aspect-grid">{ASPECTS.map((item) => <button key={item.value} type="button" className={draft.aspect === item.value ? "active" : ""} onClick={() => chooseAspect(item.value)} disabled={draft.phase !== "crop" || isPanorama}>{item.label}</button>)}</div></section>
              <section className="lew-section lew-fields"><label>输出尺寸<select value={draft.size} onChange={(event) => updateDraft({ size: event.target.value as LocalEditWorkbenchDraft["size"] })}>{SIZE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>质量<select value={draft.quality} onChange={(event) => updateDraft({ quality: event.target.value as LocalEditWorkbenchDraft["quality"] })}>{QUALITY_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></section>
              <section className="lew-section lew-prompt-section"><div className="lew-section-title"><span>提示词</span><button type="button" className="lew-text-button" onClick={() => updateDraft({ prompt: "", promptPrefix: "", optimizationGuidance: "" })}>清空</button></div><textarea value={draft.promptPrefix} onChange={(event) => updateDraft({ promptPrefix: event.target.value })} placeholder="前置要求（可选）" /><textarea className="lew-prompt" value={draft.prompt} onChange={(event) => updateDraft({ prompt: event.target.value })} placeholder="描述希望如何修改选区" /><textarea value={draft.optimizationGuidance} onChange={(event) => updateDraft({ optimizationGuidance: event.target.value })} placeholder="补充说明（可选）" /><div className="lew-style-row"><span>风格</span>{["写实", "电影感", "产品摄影"].map((style) => <button type="button" key={style} className={draft.styleTag === style ? "active" : ""} onClick={() => updateDraft({ styleTag: draft.styleTag === style ? "" : style })}>{style}</button>)}</div></section>
              {isPanorama && !isRatioCompatible ? <div className="lew-warning">当前源图不是 2:1，仍可查看普通工作台，但不能提交全景生成。</div> : null}
              {draft.phase === "edit" ? <section className="lew-section lew-edit-actions"><button type="button" className="lew-primary" onClick={() => void startGeneration()} disabled={busy}><Sparkles size={16} />{busy ? "处理中…" : "开始局部生成"}</button><input ref={importRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleImport(file); event.currentTarget.value = ""; }} /><button type="button" className="lew-secondary" onClick={() => importRef.current?.click()} disabled={busy}><ImageUp size={16} />导入 PNG / JPG / WebP</button><button type="button" className="lew-secondary" onClick={enterAlign} disabled={!currentImage}><Check size={16} />进入对齐贴回</button></section> : null}
            </div>
            <footer className="lew-footer"><button type="button" className="lew-secondary" onClick={close}>取消</button>{draft.phase === "crop" && !isPanorama ? <button type="button" className="lew-primary" onClick={() => void confirmCrop()} disabled={busy}><ChevronDown size={16} />确认裁切并编辑</button> : null}{isPanorama ? <button type="button" className="lew-primary" onClick={() => { close(); if (currentImage) void openPanoramaViewer(currentImage); }}>打开 360 编辑器</button> : null}</footer>
          </aside>
        </main>
      </div>
    </div>
  );
}
