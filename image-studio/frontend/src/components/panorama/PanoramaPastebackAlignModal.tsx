import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { historyFullSrc } from "../../lib/images";
import { ReadImageAsBase64 } from "../../platform/runtime/host";
import {
  exportPanoramaCutoutBase64,
  panoramaShotFromRoundtripState,
  resolvePanoramaRoundtripRef,
} from "../../panorama/core";
import { useStudioStore } from "../../state/studioStore";
import { tempDataURLFromB64 } from "../../state/studioStore.shared";
import type { HistoryItem, PanoramaPastebackAlignment } from "../../types/domain";
import { Modal } from "../common/Modal";

type LoadedImage = {
  image: HTMLImageElement;
  src: string;
};

const DEFAULT_ALIGNMENT: PanoramaPastebackAlignment = {
  offsetXRatio: 0,
  offsetYRatio: 0,
  scale: 1,
  rotationDeg: 0,
  featherFraction: 0.1,
  brightness: 1,
  contrast: 1,
  hueRotationDeg: 0,
};

const DEFAULT_PIVOT_RATIO = { x: 0.5, y: 0.5 };
const MAX_MASK_HISTORY = 24;

type PivotRatio = typeof DEFAULT_PIVOT_RATIO;
type AlignCompareMode = "overlay" | "curtain";
type AlignPanel = "align" | "mask" | "color";
type MaskTool = "paint" | "erase";

type AlignDragState =
  | { type: "none"; pointerId: null }
  | { type: "move"; pointerId: number; lastX: number; lastY: number }
  | {
      type: "scale";
      pointerId: number;
      startDistance: number;
      startScale: number;
      startOffsetXRatio: number;
      startOffsetYRatio: number;
    }
  | { type: "pivot"; pointerId: number };

type MaskPaintState =
  | { type: "none"; pointerId: null }
  | { type: "paint"; pointerId: number; lastX: number; lastY: number };

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败"));
    image.src = src;
  });
}

async function loadHistoryImage(item: HistoryItem, fallbackPath?: string): Promise<LoadedImage> {
  const savedPath = String(item.savedPath || fallbackPath || "").trim();
  if (savedPath) {
    const b64 = await ReadImageAsBase64(savedPath).catch(() => "");
    if (b64) {
      const src = tempDataURLFromB64(b64);
      return { image: await loadHtmlImage(src), src };
    }
  }
  if (item.imageB64) {
    const src = tempDataURLFromB64(item.imageB64);
    return { image: await loadHtmlImage(src), src };
  }
  const src = historyFullSrc(item, null) || "";
  if (!src) throw new Error("找不到可读取的图片");
  return { image: await loadHtmlImage(src), src };
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function alignmentWithPatch(
  current: PanoramaPastebackAlignment,
  patch: Partial<PanoramaPastebackAlignment>,
): PanoramaPastebackAlignment {
  return {
    offsetXRatio: clampNumber(patch.offsetXRatio ?? current.offsetXRatio, -1, 1),
    offsetYRatio: clampNumber(patch.offsetYRatio ?? current.offsetYRatio, -1, 1),
    scale: clampNumber(patch.scale ?? current.scale, 0.2, 3),
    rotationDeg: clampNumber(patch.rotationDeg ?? current.rotationDeg, -45, 45),
    featherFraction: clampNumber(patch.featherFraction ?? current.featherFraction ?? 0.1, 0, 0.5),
    brightness: clampNumber(patch.brightness ?? current.brightness ?? 1, 0.5, 1.5),
    contrast: clampNumber(patch.contrast ?? current.contrast ?? 1, 0.5, 1.5),
    hueRotationDeg: clampNumber(patch.hueRotationDeg ?? current.hueRotationDeg ?? 0, -180, 180),
  };
}

function pointerRatioInElement(event: ReactPointerEvent<HTMLElement>, element: HTMLElement): PivotRatio {
  const rect = element.getBoundingClientRect();
  return {
    x: clampNumber((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1),
    y: clampNumber((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1),
  };
}

function distanceBetweenRatios(a: PivotRatio, b: PivotRatio) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function scaleAlignmentAroundPivot(
  current: PanoramaPastebackAlignment,
  pivot: PivotRatio,
  nextScale: number,
): PanoramaPastebackAlignment {
  const currentScale = Math.max(0.0001, current.scale || 1);
  const clampedScale = clampNumber(nextScale, 0.2, 3);
  const scaleRatio = clampedScale / currentScale;
  const centerX = 0.5 + current.offsetXRatio;
  const centerY = 0.5 + current.offsetYRatio;
  const nextCenterX = pivot.x - scaleRatio * (pivot.x - centerX);
  const nextCenterY = pivot.y - scaleRatio * (pivot.y - centerY);
  return alignmentWithPatch(current, {
    scale: clampedScale,
    offsetXRatio: nextCenterX - 0.5,
    offsetYRatio: nextCenterY - 0.5,
  });
}

function canvasHasVisibleAlpha(canvas: HTMLCanvasElement | null) {
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) return false;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 16) return true;
  }
  return false;
}

export function PanoramaPastebackAlignModal() {
  const target = useStudioStore((state) => state.panoramaAlignTarget);
  const history = useStudioStore((state) => state.history);
  const close = useStudioStore((state) => state.closePanoramaPastebackAligner);
  const repastePanoramaRoundtrip = useStudioStore((state) => state.repastePanoramaRoundtrip);
  const pushToast = useStudioStore((state) => state.pushToast);
  const [alignment, setAlignment] = useState<PanoramaPastebackAlignment>(DEFAULT_ALIGNMENT);
  const [opacity, setOpacity] = useState(0.72);
  const [scaleControlMode, setScaleControlMode] = useState(false);
  const [pivotRatio, setPivotRatio] = useState<PivotRatio>(DEFAULT_PIVOT_RATIO);
  const [scaleTouchRatio, setScaleTouchRatio] = useState<PivotRatio | null>(null);
  const [showOriginalForCompare, setShowOriginalForCompare] = useState(false);
  const [compareMode, setCompareMode] = useState<AlignCompareMode>("overlay");
  const [curtainSplit, setCurtainSplit] = useState(0.5);
  const [activePanel, setActivePanel] = useState<AlignPanel>("align");
  const [maskEnabled, setMaskEnabled] = useState(false);
  const [maskTool, setMaskTool] = useState<MaskTool>("paint");
  const [maskBrushSize, setMaskBrushSize] = useState(48);
  const [maskFeatherPx, setMaskFeatherPx] = useState(16);
  const [maskHasContent, setMaskHasContent] = useState(false);
  const [maskCanUndo, setMaskCanUndo] = useState(false);
  const [maskCanRedo, setMaskCanRedo] = useState(false);
  const [maskCursorRatio, setMaskCursorRatio] = useState<PivotRatio | null>(null);
  const [maskPreviewMode, setMaskPreviewMode] = useState(false);
  const [maskPreviewDataURL, setMaskPreviewDataURL] = useState<string | null>(null);
  const [viewportHeight, setViewportHeight] = useState(() => (
    typeof window === "undefined" ? 900 : window.innerHeight
  ));
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    originalSrc: string;
    editedSrc: string;
    rectWidth: number;
    rectHeight: number;
    editedWidth: number;
    editedHeight: number;
  } | null>(null);
  const dragRef = useRef<AlignDragState>({ type: "none", pointerId: null });
  const maskPaintRef = useRef<MaskPaintState>({ type: "none", pointerId: null });
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskUndoRef = useRef<ImageData[]>([]);
  const maskRedoRef = useRef<ImageData[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!target) {
      setPreview(null);
      setError(null);
      resetAlignment();
      resetMaskState(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPreview(null);
    setAlignment(DEFAULT_ALIGNMENT);
    setOpacity(0.72);
    setScaleControlMode(false);
    setPivotRatio(DEFAULT_PIVOT_RATIO);
    setScaleTouchRatio(null);
    setShowOriginalForCompare(false);
    setCompareMode("overlay");
    setCurtainSplit(0.5);
    setActivePanel("align");
    resetMaskState(true);
    void (async () => {
      const roundtrip = resolvePanoramaRoundtripRef(target);
      if (!roundtrip) throw new Error("这张图没有可用的 360 贴回信息");
      const sourceItem = roundtrip.sourceHistoryId
        ? history.find((item) => item.id === roundtrip.sourceHistoryId) ?? null
        : null;
      const sourceLoaded = await loadHistoryImage(
        sourceItem ?? ({
          id: "panorama-source",
          prompt: target.prompt,
          mode: "edit",
          size: `${roundtrip.roundtripState.source_erp.width}x${roundtrip.roundtripState.source_erp.height}`,
          quality: target.quality,
          createdAt: target.createdAt,
          savedPath: roundtrip.sourcePath || roundtrip.roundtripState.source_erp.path,
        } as HistoryItem),
        roundtrip.sourcePath || roundtrip.roundtripState.source_erp.path,
      );
      const shot = panoramaShotFromRoundtripState(roundtrip.roundtripState);
      const original = exportPanoramaCutoutBase64(sourceLoaded.image, shot);
      const edited = await loadHistoryImage(target);
      if (cancelled) return;
      setPreview({
        originalSrc: tempDataURLFromB64(original.imageB64),
        editedSrc: edited.src,
        rectWidth: original.width,
        rectHeight: original.height,
        editedWidth: edited.image.naturalWidth || edited.image.width,
        editedHeight: edited.image.naturalHeight || edited.image.height,
      });
    })().catch((err: any) => {
      if (!cancelled) setError(err?.message ?? String(err));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [history, target]);

  useEffect(() => {
    if (!preview) return;
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    canvas.width = Math.max(1, Math.round(preview.rectWidth));
    canvas.height = Math.max(1, Math.round(preview.rectHeight));
    clearMaskCanvas(false);
  }, [preview?.rectWidth, preview?.rectHeight, target?.id]);

  useEffect(() => {
    if (!maskPreviewMode) return;
    refreshMaskPreviewDataURL();
  }, [maskFeatherPx, maskPreviewMode]);

  const maskEffectPreviewActive = maskEnabled && maskPreviewMode;
  const maskEditingActive = maskEnabled && activePanel === "mask" && !maskPreviewMode;
  const previewMaxHeight = Math.min(820, Math.max(360, viewportHeight - 190));
  const previewFitWidth = preview
    ? Math.max(260, previewMaxHeight * (preview.rectWidth / Math.max(1, preview.rectHeight)))
    : 0;

  if (!target) return null;

  function resetAlignment() {
    setAlignment(DEFAULT_ALIGNMENT);
    setOpacity(0.72);
    setScaleControlMode(false);
    setPivotRatio(DEFAULT_PIVOT_RATIO);
    setScaleTouchRatio(null);
    setShowOriginalForCompare(false);
    setCompareMode("overlay");
    setCurtainSplit(0.5);
  }

  function resetMaskState(clearCanvas = true) {
    setMaskEnabled(false);
    setMaskTool("paint");
    setMaskBrushSize(48);
    setMaskFeatherPx(16);
    setMaskCursorRatio(null);
    setMaskPreviewMode(false);
    setMaskPreviewDataURL(null);
    maskPaintRef.current = { type: "none", pointerId: null };
    maskUndoRef.current = [];
    maskRedoRef.current = [];
    if (clearCanvas) clearMaskCanvas(false);
    syncMaskState();
  }

  function invalidateMaskPreview() {
    setMaskPreviewMode(false);
    setMaskPreviewDataURL(null);
  }

  function refreshMaskPreviewDataURL() {
    const source = maskCanvasRef.current;
    if (!source || !canvasHasVisibleAlpha(source)) {
      setMaskPreviewDataURL(null);
      return false;
    }
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setMaskPreviewDataURL(null);
      return false;
    }
    const feather = clampNumber(maskFeatherPx, 0, 256);
    if (feather > 0) ctx.filter = `blur(${feather}px)`;
    ctx.drawImage(source, 0, 0);
    ctx.filter = "none";
    setMaskPreviewDataURL(canvas.toDataURL("image/png"));
    return true;
  }

  function previewMaskEffect() {
    if (!maskEnabled || !maskHasContent) {
      setActivePanel("mask");
      pushToast("请先绘制贴回区域，再预览蒙版效果", "warn", 3200);
      return;
    }
    if (refreshMaskPreviewDataURL()) {
      setMaskPreviewMode(true);
      setActivePanel("color");
      setMaskCursorRatio(null);
    }
  }

  function syncMaskState() {
    setMaskHasContent(canvasHasVisibleAlpha(maskCanvasRef.current));
    setMaskCanUndo(maskUndoRef.current.length > 0);
    setMaskCanRedo(maskRedoRef.current.length > 0);
  }

  function clearMaskCanvas(pushUndo: boolean) {
    const canvas = maskCanvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    invalidateMaskPreview();
    if (!canvas || !ctx) {
      syncMaskState();
      return;
    }
    if (pushUndo && canvasHasVisibleAlpha(canvas)) pushMaskUndoSnapshot();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (pushUndo) maskRedoRef.current = [];
    syncMaskState();
  }

  function pushMaskUndoSnapshot() {
    const canvas = maskCanvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !ctx) return;
    maskUndoRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    while (maskUndoRef.current.length > MAX_MASK_HISTORY) maskUndoRef.current.shift();
    maskRedoRef.current = [];
    syncMaskState();
  }

  function restoreMaskSnapshot(snapshot: ImageData | undefined) {
    const canvas = maskCanvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !ctx || !snapshot) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(snapshot, 0, 0);
    syncMaskState();
  }

  function undoMask() {
    const canvas = maskCanvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    const snapshot = maskUndoRef.current.pop();
    invalidateMaskPreview();
    if (!canvas || !ctx || !snapshot) {
      syncMaskState();
      return;
    }
    maskRedoRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    restoreMaskSnapshot(snapshot);
  }

  function redoMask() {
    const canvas = maskCanvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    const snapshot = maskRedoRef.current.pop();
    invalidateMaskPreview();
    if (!canvas || !ctx || !snapshot) {
      syncMaskState();
      return;
    }
    maskUndoRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    restoreMaskSnapshot(snapshot);
  }

  function maskPointFromPointer(event: ReactPointerEvent<HTMLElement>, element: HTMLElement) {
    const canvas = maskCanvasRef.current;
    const rect = element.getBoundingClientRect();
    const width = canvas?.width || 1;
    const height = canvas?.height || 1;
    return {
      x: clampNumber(((event.clientX - rect.left) / Math.max(1, rect.width)) * width, 0, width),
      y: clampNumber(((event.clientY - rect.top) / Math.max(1, rect.height)) * height, 0, height),
    };
  }

  function drawMaskStroke(from: { x: number; y: number }, to: { x: number; y: number }) {
    const canvas = maskCanvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = clampNumber(maskBrushSize, 4, 320);
    if (maskTool === "erase") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
      ctx.fillStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "rgba(250,204,21,1)";
      ctx.fillStyle = "rgba(250,204,21,1)";
    }
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(to.x, to.y, ctx.lineWidth * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function beginMaskPaint(event: ReactPointerEvent<HTMLDivElement>) {
    if (!preview || !maskEnabled) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    invalidateMaskPreview();
    pushMaskUndoSnapshot();
    const point = maskPointFromPointer(event, event.currentTarget);
    maskPaintRef.current = { type: "paint", pointerId: event.pointerId, lastX: point.x, lastY: point.y };
    drawMaskStroke(point, point);
    syncMaskState();
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function continueMaskPaint(event: ReactPointerEvent<HTMLDivElement>) {
    const paint = maskPaintRef.current;
    if (paint.type !== "paint" || paint.pointerId !== event.pointerId) return;
    const point = maskPointFromPointer(event, event.currentTarget);
    drawMaskStroke({ x: paint.lastX, y: paint.lastY }, point);
    maskPaintRef.current = { ...paint, lastX: point.x, lastY: point.y };
    setMaskCursorRatio(pointerRatioInElement(event, event.currentTarget));
    syncMaskState();
  }

  function finishMaskPaint(element: HTMLElement, pointerId: number) {
    if (element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
    maskPaintRef.current = { type: "none", pointerId: null };
    syncMaskState();
  }

  function nudgeAlignment(deltaX: number, deltaY: number) {
    setAlignment((current) => alignmentWithPatch(current, {
      offsetXRatio: current.offsetXRatio + deltaX,
      offsetYRatio: current.offsetYRatio + deltaY,
    }));
  }

  function zoomAlignment(delta: number) {
    setAlignment((current) => {
      const nextScale = current.scale + delta;
      return scaleControlMode
        ? scaleAlignmentAroundPivot(current, pivotRatio, nextScale)
        : alignmentWithPatch(current, { scale: nextScale });
    });
  }

  function changeScale(value: number) {
    setAlignment((current) => scaleControlMode
      ? scaleAlignmentAroundPivot(current, pivotRatio, value)
      : alignmentWithPatch(current, { scale: value }));
  }

  function finishDrag(element: HTMLElement, pointerId: number) {
    if (element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
    setScaleTouchRatio(null);
    dragRef.current = { type: "none", pointerId: null };
  }

  function endOriginalCompare() {
    setShowOriginalForCompare(false);
    setOpacity(1);
  }

  function updateCurtainSplit(clientX: number, element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    setCurtainSplit(clampNumber((clientX - rect.left) / Math.max(1, rect.width), 0, 1));
  }

  async function confirmPasteback() {
    if (!target || busy) return;
    const maskCanvas = maskCanvasRef.current;
    const usesFineMask = maskEnabled && maskHasContent && maskCanvas;
    if (maskEnabled && !maskHasContent) {
      setActivePanel("mask");
      pushToast("请先绘制贴回区域，或关闭精细蒙版", "warn", 3200);
      return;
    }
    setBusy(true);
    try {
      const result = await repastePanoramaRoundtrip(target, {
        alignment: usesFineMask ? { ...alignment, featherFraction: 0 } : alignment,
        pasteMask: usesFineMask
          ? { image: maskCanvas, featherPx: maskFeatherPx }
          : null,
        selectAsCurrent: true,
      });
      if (result) close();
    } catch (err: any) {
      pushToast(`手动贴回失败: ${err?.message ?? err}`, "error", 4200);
    } finally {
      setBusy(false);
    }
  }

  function handlePreviewPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (maskEffectPreviewActive) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (maskEditingActive) {
      beginMaskPaint(event);
      return;
    }
    event.currentTarget.focus();
    if (scaleControlMode) {
      const pointer = pointerRatioInElement(event, event.currentTarget);
      const startDistance = distanceBetweenRatios(pointer, pivotRatio);
      if (startDistance < 0.01) return;
      setScaleTouchRatio(pointer);
      dragRef.current = {
        type: "scale",
        pointerId: event.pointerId,
        startDistance,
        startScale: alignment.scale,
        startOffsetXRatio: alignment.offsetXRatio,
        startOffsetYRatio: alignment.offsetYRatio,
      };
    } else {
      dragRef.current = { type: "move", pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePreviewPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (maskEditingActive) {
      setMaskCursorRatio(pointerRatioInElement(event, event.currentTarget));
      continueMaskPaint(event);
      return;
    }
    const drag = dragRef.current;
    if (drag.type === "none" || drag.pointerId !== event.pointerId) return;
    if (drag.type === "pivot") {
      setPivotRatio(pointerRatioInElement(event, event.currentTarget));
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    if (drag.type === "scale") {
      const pointer = pointerRatioInElement(event, event.currentTarget);
      setScaleTouchRatio(pointer);
      const distance = distanceBetweenRatios(pointer, pivotRatio);
      const nextScale = drag.startScale * distance / Math.max(0.01, drag.startDistance);
      setAlignment((current) => scaleAlignmentAroundPivot({
        ...current,
        scale: drag.startScale,
        offsetXRatio: drag.startOffsetXRatio,
        offsetYRatio: drag.startOffsetYRatio,
      }, pivotRatio, nextScale));
      return;
    }
    const dx = (event.clientX - drag.lastX) / Math.max(1, rect.width);
    const dy = (event.clientY - drag.lastY) / Math.max(1, rect.height);
    dragRef.current = { ...drag, lastX: event.clientX, lastY: event.clientY };
    setAlignment((current) => alignmentWithPatch(current, {
      offsetXRatio: current.offsetXRatio + dx,
      offsetYRatio: current.offsetYRatio + dy,
    }));
  }

  function handlePreviewPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (maskPaintRef.current.pointerId === event.pointerId) {
      finishMaskPaint(event.currentTarget, event.pointerId);
      return;
    }
    if (dragRef.current.pointerId === event.pointerId) finishDrag(event.currentTarget, event.pointerId);
  }

  return (
    <Modal open onClose={close} title="手动对齐贴回全景图" width={920} bodyClassName="pano-align-body">
      <div className="pano-align-layout">
        <div className="pano-align-preview-wrap">
          {loading ? <div className="pano-align-status">正在重建镜头对比...</div> : null}
          {error ? <div className="pano-align-error">{error}</div> : null}
          {preview ? (
            <div
              className="pano-align-preview"
              tabIndex={0}
              data-scale-mode={scaleControlMode ? "true" : "false"}
              data-mask-mode={maskEditingActive ? "true" : "false"}
              aria-label="手动对齐预览区"
              style={{
                aspectRatio: `${preview.rectWidth} / ${preview.rectHeight}`,
                width: `min(100%, ${Math.round(previewFitWidth)}px)`,
                maxHeight: `${Math.round(previewMaxHeight)}px`,
              }}
              onWheel={(event) => {
                if (maskEditingActive || maskEffectPreviewActive) return;
                event.preventDefault();
                event.stopPropagation();
                const baseStep = event.altKey ? 0.005 : event.shiftKey ? 0.05 : 0.02;
                zoomAlignment(event.deltaY < 0 ? baseStep : -baseStep);
              }}
              onKeyDown={(event) => {
                if (maskEditingActive || maskEffectPreviewActive) return;
                const baseStep = event.altKey ? 0.0005 : event.shiftKey ? 0.01 : 0.002;
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  nudgeAlignment(-baseStep, 0);
                } else if (event.key === "ArrowRight") {
                  event.preventDefault();
                  nudgeAlignment(baseStep, 0);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  nudgeAlignment(0, -baseStep);
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  nudgeAlignment(0, baseStep);
                }
              }}
              onPointerDown={handlePreviewPointerDown}
              onPointerMove={handlePreviewPointerMove}
              onPointerUp={handlePreviewPointerEnd}
              onPointerCancel={handlePreviewPointerEnd}
              onPointerLeave={() => {
                if (maskPaintRef.current.type === "none") setMaskCursorRatio(null);
              }}
            >
              <img className="pano-align-original" src={preview.originalSrc} alt="原始镜头图" draggable={false} />
              <div
                className="pano-align-edited-layer"
                style={{
                  clipPath: compareMode === "curtain" ? `inset(0 0 0 ${curtainSplit * 100}%)` : "none",
                  opacity: showOriginalForCompare ? 0 : maskEffectPreviewActive ? 1 : compareMode === "curtain" ? 1 : opacity,
                  WebkitMaskImage: maskEffectPreviewActive && maskPreviewDataURL ? `url(${maskPreviewDataURL})` : undefined,
                  maskImage: maskEffectPreviewActive && maskPreviewDataURL ? `url(${maskPreviewDataURL})` : undefined,
                  WebkitMaskSize: "100% 100%",
                  maskSize: "100% 100%",
                  WebkitMaskRepeat: "no-repeat",
                  maskRepeat: "no-repeat",
                }}
              >
                <img
                  className="pano-align-edited"
                  src={preview.editedSrc}
                  alt="编辑后的镜头图"
                  draggable={false}
                  style={{
                    left: `${50 + alignment.offsetXRatio * 100}%`,
                    top: `${50 + alignment.offsetYRatio * 100}%`,
                    filter: `brightness(${alignment.brightness ?? 1}) contrast(${alignment.contrast ?? 1}) hue-rotate(${alignment.hueRotationDeg ?? 0}deg) drop-shadow(0 0 0 rgba(0, 0, 0, 0.01))`,
                    transform: `translate(-50%, -50%) rotate(${alignment.rotationDeg}deg) scale(${alignment.scale})`,
                  }}
                />
              </div>
              <canvas
                ref={maskCanvasRef}
                className={`pano-align-mask-layer${maskEnabled ? " is-enabled" : ""}${maskEffectPreviewActive ? " is-previewing" : ""}`}
                aria-hidden="true"
              />
              {maskEditingActive && maskCursorRatio && preview ? (
                <span
                  className={`pano-align-mask-cursor ${maskTool}`}
                  style={{
                    left: `${maskCursorRatio.x * 100}%`,
                    top: `${maskCursorRatio.y * 100}%`,
                    width: `${(maskBrushSize / Math.max(1, preview.rectWidth)) * 100}%`,
                    height: `${(maskBrushSize / Math.max(1, preview.rectHeight)) * 100}%`,
                  }}
                  aria-hidden="true"
                />
              ) : null}
              {compareMode === "curtain" ? (
                <>
                  <div className="pano-align-curtain-label pano-align-curtain-label-left">原图</div>
                  <div className="pano-align-curtain-label pano-align-curtain-label-right">修改图</div>
                  <button
                    type="button"
                    className="pano-align-curtain-handle"
                    style={{ left: `${curtainSplit * 100}%` }}
                    aria-label="拖动卷帘对比分割线"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const previewElement = event.currentTarget.closest(".pano-align-preview") as HTMLElement | null;
                      if (!previewElement) return;
                      previewElement.focus();
                      updateCurtainSplit(event.clientX, previewElement);
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                      const previewElement = event.currentTarget.closest(".pano-align-preview") as HTMLElement | null;
                      if (!previewElement) return;
                      updateCurtainSplit(event.clientX, previewElement);
                    }}
                    onPointerUp={(event) => {
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                        event.currentTarget.releasePointerCapture(event.pointerId);
                      }
                    }}
                    onPointerCancel={(event) => {
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                        event.currentTarget.releasePointerCapture(event.pointerId);
                      }
                    }}
                  >
                    <span aria-hidden="true">{"<>"}</span>
                  </button>
                </>
              ) : null}
              {scaleControlMode && !maskEditingActive ? (
                <button
                  type="button"
                  className={`pano-align-pivot${scaleTouchRatio ? " pinch-active" : ""}`}
                  style={{ left: `${pivotRatio.x * 100}%`, top: `${pivotRatio.y * 100}%` }}
                  aria-label="缩放中心点"
                  title="拖动改变缩放中心点"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const previewElement = event.currentTarget.closest(".pano-align-preview") as HTMLElement | null;
                    if (!previewElement) return;
                    previewElement.focus();
                    dragRef.current = { type: "pivot", pointerId: event.pointerId };
                    previewElement.setPointerCapture(event.pointerId);
                  }}
                />
              ) : null}
              {scaleControlMode && scaleTouchRatio && !maskEditingActive ? (
                <span
                  className="pano-align-touch-point"
                  style={{ left: `${scaleTouchRatio.x * 100}%`, top: `${scaleTouchRatio.y * 100}%` }}
                  aria-hidden="true"
                />
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="pano-align-controls">
          <div className="pano-align-meta">
            <div>原镜头: {preview ? `${preview.rectWidth}x${preview.rectHeight}` : "-"}</div>
            <div>编辑图: {preview ? `${preview.editedWidth}x${preview.editedHeight}` : "-"}</div>
          </div>
          <div className="pano-align-tabs" role="tablist" aria-label="精细贴图控制">
            <button type="button" className={activePanel === "align" ? "active" : ""} aria-selected={activePanel === "align"} onClick={() => setActivePanel("align")}>对齐</button>
            <button type="button" className={activePanel === "mask" ? "active" : ""} aria-selected={activePanel === "mask"} onClick={() => setActivePanel("mask")}>蒙版</button>
            <button type="button" className={activePanel === "color" ? "active" : ""} aria-selected={activePanel === "color"} onClick={() => setActivePanel("color")}>色彩</button>
          </div>

          {activePanel === "align" ? (
            <div className="pano-align-panel">
              <div className="pano-align-mode-toggle" role="group" aria-label="对齐操作模式">
                <button
                  type="button"
                  className={!scaleControlMode ? "active" : ""}
                  aria-pressed={!scaleControlMode}
                  onClick={() => {
                    setScaleControlMode(false);
                    setScaleTouchRatio(null);
                  }}
                >
                  移动模式
                </button>
                <button
                  type="button"
                  className={scaleControlMode ? "active" : ""}
                  aria-pressed={scaleControlMode}
                  onClick={() => setScaleControlMode(true)}
                >
                  操控缩放模式
                </button>
              </div>
              <div className="pano-align-mode-toggle" role="group" aria-label="原图对比方式">
                <button
                  type="button"
                  className={compareMode === "overlay" ? "active" : ""}
                  aria-pressed={compareMode === "overlay"}
                  onClick={() => setCompareMode("overlay")}
                >
                  透明叠加
                </button>
                <button
                  type="button"
                  className={compareMode === "curtain" ? "active" : ""}
                  aria-pressed={compareMode === "curtain"}
                  onClick={() => {
                    setCompareMode("curtain");
                    setOpacity(1);
                  }}
                >
                  卷帘对比
                </button>
              </div>
              <AlignSlider label="水平" value={alignment.offsetXRatio} min={-0.5} max={0.5} step={0.001} onChange={(value) => setAlignment((current) => alignmentWithPatch(current, { offsetXRatio: value }))} />
              <AlignSlider label="垂直" value={alignment.offsetYRatio} min={-0.5} max={0.5} step={0.001} onChange={(value) => setAlignment((current) => alignmentWithPatch(current, { offsetYRatio: value }))} />
              <AlignSlider label="缩放" value={alignment.scale} min={0.2} max={3} step={0.005} onChange={changeScale} />
              <AlignSlider label="旋转" value={alignment.rotationDeg} min={-45} max={45} step={0.1} format="degree" onChange={(value) => setAlignment((current) => alignmentWithPatch(current, { rotationDeg: value }))} />
              {!maskEnabled ? (
                <AlignSlider label="边缘羽化" value={alignment.featherFraction ?? 0.1} min={0} max={0.5} step={0.01} format="percent" onChange={(value) => setAlignment((current) => alignmentWithPatch(current, { featherFraction: value }))} />
              ) : null}
              <AlignSlider label="预览透明度" value={opacity} min={0.1} max={1} step={0.01} format="percent" onChange={setOpacity} disabled={compareMode === "curtain"} />
            </div>
          ) : null}

          {activePanel === "mask" ? (
            <div className="pano-align-panel">
              <label className="pano-mask-switch">
                <input
                  type="checkbox"
                  checked={maskEnabled}
                  onChange={(event) => {
                    setMaskEnabled(event.target.checked);
                    if (!event.target.checked) invalidateMaskPreview();
                  }}
                />
                <span>启用精细蒙版</span>
              </label>
              <div className="pano-align-mode-toggle" role="group" aria-label="蒙版画笔模式">
                <button type="button" className={maskTool === "paint" ? "active" : ""} aria-pressed={maskTool === "paint"} onClick={() => setMaskTool("paint")}>画笔</button>
                <button type="button" className={maskTool === "erase" ? "active" : ""} aria-pressed={maskTool === "erase"} onClick={() => setMaskTool("erase")}>擦除</button>
              </div>
              <AlignSlider label="画笔大小" value={maskBrushSize} min={8} max={240} step={1} format="px" disabled={!maskEnabled} onChange={setMaskBrushSize} />
              <AlignSlider label="蒙版羽化" value={maskFeatherPx} min={0} max={96} step={1} format="px" disabled={!maskEnabled} onChange={setMaskFeatherPx} />
              <div className="pano-mask-actions">
                <button type="button" className="pano-align-secondary" disabled={!maskEnabled || !maskCanUndo} onClick={undoMask}>撤销</button>
                <button type="button" className="pano-align-secondary" disabled={!maskEnabled || !maskCanRedo} onClick={redoMask}>重做</button>
                <button type="button" className="pano-align-secondary" disabled={!maskEnabled || !maskHasContent} onClick={() => clearMaskCanvas(true)}>清空</button>
              </div>
              <button
                type="button"
                className={maskPreviewMode ? "pano-align-secondary" : "pano-align-primary"}
                disabled={!maskEnabled || !maskHasContent}
                onClick={maskPreviewMode ? invalidateMaskPreview : previewMaskEffect}
              >
                {maskPreviewMode ? "继续编辑蒙版" : "预览蒙版效果"}
              </button>
              <p className="pano-align-hint">
                开启后在左侧画黄色区域，只把黄色区域贴回全景图；预览蒙版效果可先检查实际贴回范围。启用精细蒙版时，羽化只作用于蒙版边缘。
              </p>
            </div>
          ) : null}

          {activePanel === "color" ? (
            <div className="pano-align-panel">
              <AlignSlider label="明暗" value={alignment.brightness ?? 1} min={0.5} max={1.5} step={0.01} format="percent" onChange={(value) => setAlignment((current) => alignmentWithPatch(current, { brightness: value }))} />
              <AlignSlider label="对比度" value={alignment.contrast ?? 1} min={0.5} max={1.5} step={0.01} format="percent" onChange={(value) => setAlignment((current) => alignmentWithPatch(current, { contrast: value }))} />
              <AlignSlider label="色相" value={alignment.hueRotationDeg ?? 0} min={-180} max={180} step={1} format="degree" onChange={(value) => setAlignment((current) => alignmentWithPatch(current, { hueRotationDeg: value }))} />
            </div>
          ) : null}

          <div className="pano-align-actions">
            <button
              type="button"
              className="pano-align-secondary"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setShowOriginalForCompare(true);
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
                endOriginalCompare();
              }}
              onPointerCancel={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
                endOriginalCompare();
              }}
              onBlur={endOriginalCompare}
              disabled={busy || loading || !preview}
            >
              按住看原图
            </button>
            <button type="button" className="pano-align-secondary" onClick={resetAlignment} disabled={busy}>
              重置
            </button>
            <button type="button" className="pano-align-primary" onClick={() => void confirmPasteback()} disabled={busy || loading || !preview}>
              {busy ? "正在贴回..." : "确认贴回"}
            </button>
          </div>
          <p className="pano-align-hint">
            {maskEnabled
              ? "对齐用于调整修改图位置；精细蒙版开启时，羽化只作用于蒙版边缘。确认贴回时预览透明度不会降低最终不透明度。"
              : "对齐用于调整修改图位置；蒙版用于限制局部贴回；色彩和边缘羽化会参与最终贴图。确认贴回时预览透明度不会降低最终不透明度。"}
          </p>
        </div>
      </div>
    </Modal>
  );
}

function AlignSlider({
  label,
  value,
  min,
  max,
  step,
  format = "number",
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: "number" | "percent" | "degree" | "px";
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const displayValue = format === "percent"
    ? `${Math.round(value * 100)}%`
    : format === "degree"
      ? `${Math.round(value)}°`
      : format === "px"
        ? `${Math.round(value)}px`
        : label === "缩放"
          ? value.toFixed(2)
          : value.toFixed(3);
  const adjust = (direction: -1 | 1) => {
    const precision = Math.max(0, String(step).split(".")[1]?.length ?? 0);
    const next = clampNumber(Number((value + direction * step).toFixed(precision)), min, max);
    onChange(next);
  };

  return (
    <label className="pano-align-slider">
      <span>{label}</span>
      <span className="pano-align-slider-control">
        <button type="button" onClick={() => adjust(-1)} disabled={disabled || value <= min} aria-label={`减少${label}`}>
          -
        </button>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <button type="button" onClick={() => adjust(1)} disabled={disabled || value >= max} aria-label={`增加${label}`}>
          +
        </button>
      </span>
      <span className="pano-align-value">{displayValue}</span>
    </label>
  );
}
