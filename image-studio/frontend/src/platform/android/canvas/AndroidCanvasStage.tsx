import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Arrow, Image as KonvaImage, Layer, Line, Rect, Stage } from "react-konva";
import Konva from "konva";
import { shallow } from "zustand/shallow";
import { useStudioStore } from "../../../state/studioStore";
import type { APIMode, HistoryItem, JobGroupSnapshot, JobSlotSnapshot } from "../../../types/domain";
import type { Stroke } from "../../../state/studioStore.types";
import { AnnotationShape } from "../../../components/canvas/AnnotationShape";
import { BatchResultGrid, type BatchGridSlot } from "../../../components/canvas/BatchResultGrid";
import { CompareOverlay } from "../../../components/canvas/CompareOverlay";
import { copyImageB64ToClipboard, copyImageURLToClipboard, useImageFromSource } from "../../../components/canvas/canvasImage";
import { StreamPreviewBadge } from "../../../components/canvas/StreamPreviewBadge";
import { useCanvasShortcuts } from "../../../components/canvas/useCanvasShortcuts";
import { historyPreviewSrc, isTransientPreviewItem } from "../../../lib/images";
import { bestEffortUUID } from "../../../lib/runtimeCompat.ts";
import { normalizeFHLImagesPoolSlot, upstreamConfigShortLabel } from "../../../lib/profiles";
import { latestGroup } from "../../../state/browserJobs";
import { streamPreviewItemsFromPreviews } from "../../../state/studioStore.streamPreview";
import { vibrateForPlatform } from "../bridge";

type ViewState = { scale: number; x: number; y: number };
type PinchState = {
  distance: number;
  center: { x: number; y: number };
  view: ViewState;
};

const MIN_VIEW_SCALE = 0.05;
const MAX_VIEW_SCALE = 8;
const ZOOM_STEP = 1.2;
const ANDROID_KONVA_PIXEL_RATIO = 1;

if (typeof window !== "undefined") {
  Konva.pixelRatio = ANDROID_KONVA_PIXEL_RATIO;
}

function batchApiShortLabel(apiMode: APIMode, apiLabel?: string, poolSlot?: number) {
  const label = apiLabel?.trim();
  const slot = normalizeFHLImagesPoolSlot(poolSlot)
    ?? Number(label?.match(/^FHL(\d+)$/i)?.[1]);
  if ((apiMode === "images" || apiMode === "responses") && Number.isInteger(slot) && slot >= 1 && slot <= 10) {
    return `FHL${slot} · ${apiMode === "responses" ? "Responses API" : "Images API"}`;
  }
  if (label) return label;
  if (apiMode === "apimart") return "APIMart";
  if (apiMode === "responses") return "Responses API";
  return "Images API";
}

function firstBatchAPIItemLabel(items: HistoryItem[]) {
  for (const item of items) {
    const label = item.apiLabel?.trim();
    if (label) return label;
  }
  return "";
}

function androidJobSlotIsLive(slot: JobSlotSnapshot) {
  return slot.status === "queued" || slot.status === "running";
}

export function androidJobGroupHasLiveSlots(group: JobGroupSnapshot) {
  return group.slots.some(androidJobSlotIsLive);
}

export function androidJobGroupSlotCount(group: JobGroupSnapshot | null | undefined) {
  if (!group) return 0;
  return group.slots.reduce((slotMax, slot) => (
    Math.max(slotMax, Number.isFinite(Number(slot.batchIndex)) ? Number(slot.batchIndex) + 1 : 0)
  ), group.batchCount);
}

export function androidCanvasScopedJobGroups(groups: JobGroupSnapshot[], isRunning: boolean) {
  const liveGroups = groups.filter(androidJobGroupHasLiveSlots);
  if (isRunning) return liveGroups;
  const latest = latestGroup(groups);
  return latest ? [latest] : [];
}

function isGenericAPIShortLabel(label: string) {
  const trimmed = label.trim();
  return trimmed === "Images"
    || trimmed === "Images API"
    || trimmed === "Responses"
    || trimmed === "Responses API";
}

function preferredProviderAPIShortLabel(label: string, providerLabel: string) {
  return providerLabel && isGenericAPIShortLabel(label) ? "" : label;
}

function providerAPIShortLabel(label: string) {
  const trimmed = label.trim();
  return trimmed === "FHL" || trimmed === "APIMart" ? trimmed : "";
}

export function AndroidCanvasStage() {
  const {
    currentImage, tool, brushSize, brushMode,
    annotationKind, annotationColor,
    selectedAnnotationId,
    annotations, addAnnotation, removeAnnotation,
    setMaskDataURL,
    strokes, pushStroke,
    undo, redo,
    compareB, compareSplit, setCompareSplit, setCompareB,
    isRunning, cancel, errorMessage, setField,
    streamPreview,
    streamPreviews,
    apimartRecoveryTasks,
    applyJobSlotParams,
    jobGroupsByWorkspace,
    queryAPIMartRecoveryTask,
    regenerateJobSlot,
    runningJobMeta,
    runningJobs,
    jobsTotal,
    jobsCompleted,
    activeWorkspaceId,
    activeProfileId,
    apiMode,
    baseURL,
    profiles,
    mode,
    prompt,
    size,
    quality,
    outputFormat,
    toggleFullscreen,
    batchResults, resultGridOpen, selectBatchResult, closeResultGrid,
    canvasViewResetTick,
  } = useStudioStore((state) => ({
    currentImage: state.currentImage,
    tool: state.tool,
    brushSize: state.brushSize,
    brushMode: state.brushMode,
    annotationKind: state.annotationKind,
    annotationColor: state.annotationColor,
    selectedAnnotationId: state.selectedAnnotationId,
    annotations: state.annotations,
    addAnnotation: state.addAnnotation,
    removeAnnotation: state.removeAnnotation,
    setMaskDataURL: state.setMaskDataURL,
    strokes: state.strokes,
    pushStroke: state.pushStroke,
    undo: state.undo,
    redo: state.redo,
    compareB: state.compareB,
    compareSplit: state.compareSplit,
    setCompareSplit: state.setCompareSplit,
    setCompareB: state.setCompareB,
    isRunning: state.isRunning,
    cancel: state.cancel,
    errorMessage: state.errorMessage,
    setField: state.setField,
    streamPreview: state.streamPreview,
    streamPreviews: state.streamPreviews,
    apimartRecoveryTasks: state.apimartRecoveryTasks,
    applyJobSlotParams: state.applyJobSlotParams,
    jobGroupsByWorkspace: state.jobGroupsByWorkspace,
    queryAPIMartRecoveryTask: state.queryAPIMartRecoveryTask,
    regenerateJobSlot: state.regenerateJobSlot,
    runningJobMeta: state.runningJobMeta,
    runningJobs: state.runningJobs,
    jobsTotal: state.jobsTotal,
    jobsCompleted: state.jobsCompleted,
    activeWorkspaceId: state.activeWorkspaceId,
    activeProfileId: state.activeProfileId,
    apiMode: state.apiMode,
    baseURL: state.baseURL,
    profiles: state.profiles,
    mode: state.mode,
    prompt: state.prompt,
    size: state.size,
    quality: state.quality,
    outputFormat: state.outputFormat,
    toggleFullscreen: state.toggleFullscreen,
    batchResults: state.batchResults,
    resultGridOpen: state.resultGridOpen,
    selectBatchResult: state.selectBatchResult,
    closeResultGrid: state.closeResultGrid,
    canvasViewResetTick: state.canvasViewResetTick,
  }), shallow);
  const streamPreviewItems = streamPreviewItemsFromPreviews(streamPreviews, {
    workspaceId: activeWorkspaceId,
    mode,
    prompt,
    size,
    quality,
    outputFormat,
    currentImage,
  });
  const workspaceJobGroups = jobGroupsByWorkspace[activeWorkspaceId] ?? [];
  const displayJobGroups = androidCanvasScopedJobGroups(workspaceJobGroups, isRunning);
  const jobGroupSlotCount = displayJobGroups.reduce((maxCount, group) => (
    Math.max(maxCount, androidJobGroupSlotCount(group))
  ), 0);
  const visibleBatchSlotCount = Math.max(
    jobsTotal,
    jobGroupSlotCount,
    batchResults.length + runningJobs.length,
    batchResults.length + streamPreviewItems.length,
  );
  const activeJobGroup = latestGroup(displayJobGroups);
  const batchIdentity = activeJobGroup?.clientSubmissionId
    || activeJobGroup?.groupId
    || (batchResults[0]?.id ? `results:${batchResults[0].id}` : `workspace:${activeWorkspaceId}`);
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
  const selectedAPIShortLabel = upstreamConfigShortLabel({
    apiMode: activeProfile?.apiMode ?? apiMode,
    baseURL: activeProfile?.baseURL ?? baseURL,
  });
  const activeJobGroupModeLabel = activeJobGroup
    ? batchApiShortLabel(activeJobGroup.apiMode, activeJobGroup.apiLabel, activeJobGroup.fhlImagesPoolSlot)
    : "";
  const selectedAPIProviderLabel = providerAPIShortLabel(selectedAPIShortLabel);
  const selectedAPIProviderFitsBatch = selectedAPIProviderLabel === "FHL"
    ? !activeJobGroup || activeJobGroup.apiMode === "responses" || activeJobGroup.apiMode === "images"
    : !activeJobGroup || activeJobGroup.apiMode === (activeProfile?.apiMode ?? apiMode);
  const selectedBatchProviderLabel = selectedAPIProviderFitsBatch ? selectedAPIProviderLabel : "";
  const batchItemApiLabel = firstBatchAPIItemLabel(batchResults);
  const preferredBatchItemApiLabel = preferredProviderAPIShortLabel(batchItemApiLabel, selectedBatchProviderLabel);
  const preferredJobGroupApiLabel = preferredProviderAPIShortLabel(activeJobGroup?.apiLabel?.trim() || "", selectedBatchProviderLabel);
  const batchApiLabel = preferredBatchItemApiLabel
    || preferredJobGroupApiLabel
    || providerAPIShortLabel(activeJobGroupModeLabel)
    || selectedBatchProviderLabel
    || activeJobGroupModeLabel
    || undefined;
  const apimartRecoveryByBatchIndex = new Map<number, (typeof apimartRecoveryTasks)[number]>();
  for (const task of apimartRecoveryTasks) {
    if (task.workspaceId !== activeWorkspaceId) continue;
    if (typeof task.batchIndex !== "number") continue;
    apimartRecoveryByBatchIndex.set(task.batchIndex, task);
  }
  const jobEntryByBatchIndex = new Map<number, { group: JobGroupSnapshot; slot: JobSlotSnapshot }>();
  const jobEntryGroups = displayJobGroups;
  for (const group of [...jobEntryGroups].sort((a, b) => a.createdAt - b.createdAt)) {
    for (const slot of group.slots) {
      jobEntryByBatchIndex.set(slot.batchIndex, { group, slot });
    }
  }
  const runningMetaByBatchIndex = new Map<number, (typeof runningJobMeta)[string]>();
  for (const jobId of runningJobs) {
    const meta = runningJobMeta[jobId];
    if (!meta || meta.workspaceId !== activeWorkspaceId || typeof meta.batchIndex !== "number") continue;
    runningMetaByBatchIndex.set(meta.batchIndex, meta);
  }
  const apiLabelForBatchIndex = (index: number) => {
    const entry = jobEntryByBatchIndex.get(index);
    const recoveryTask = apimartRecoveryByBatchIndex.get(index);
    const meta = runningMetaByBatchIndex.get(index);
    const frozenMetaLabel = meta
      ? batchApiShortLabel(meta.apiMode, meta.apiLabel, meta.fhlImagesPoolSlot)
      : "";
    const frozenEntryLabel = entry
      ? batchApiShortLabel(
        entry.group.apiMode,
        entry.slot.apiLabel || entry.group.apiLabel,
        entry.slot.fhlImagesPoolSlot ?? entry.group.fhlImagesPoolSlot,
      )
      : "";
    return recoveryTask
      ? "APIMart"
      : frozenMetaLabel
        || frozenEntryLabel
        || batchApiLabel;
  };
  const liveBatchSlots: BatchGridSlot[] = Array.from({ length: visibleBatchSlotCount }, (_, index) => {
    const entry = jobEntryByBatchIndex.get(index);
    return {
      type: "pending",
      id: `pending-${index}`,
      apiLabel: apiLabelForBatchIndex(index),
      jobGroup: entry?.group,
      jobSlot: entry?.slot,
    };
  });
  for (const item of batchResults) {
    const index = typeof item.batchIndex === "number" ? item.batchIndex : liveBatchSlots.findIndex((slot) => slot.type === "pending");
    if (index >= 0 && index < liveBatchSlots.length) liveBatchSlots[index] = { type: "result", item, apiLabel: item.apiLabel || apiLabelForBatchIndex(index) };
  }
  for (const item of streamPreviewItems) {
    const index = typeof item.batchIndex === "number" ? item.batchIndex : liveBatchSlots.findIndex((slot) => slot.type === "pending");
    if (index >= 0 && index < liveBatchSlots.length && liveBatchSlots[index].type === "pending") {
      liveBatchSlots[index] = { type: "preview", item, apiLabel: item.apiLabel || apiLabelForBatchIndex(index) };
    }
  }
  const completedBatchSlots: BatchGridSlot[] = liveBatchSlots.map((slot, index) => {
    if (slot.type !== "pending") return slot;
    const entry = jobEntryByBatchIndex.get(index);
    return {
      type: "failed",
      id: `failed-${index}`,
      apiLabel: apiLabelForBatchIndex(index),
      recoveryTask: apimartRecoveryByBatchIndex.get(index),
      jobGroup: entry?.group,
      jobSlot: entry?.slot,
    };
  });
  const activeJobGroupHasFailedSlot = activeJobGroup?.slots.some((slot) => (
    slot.status === "failed" || slot.status === "interrupted" || slot.status === "cancelled"
  )) ?? false;
  const showingLiveBatchGrid = isRunning && visibleBatchSlotCount > 1;
  const showingCompletedBatchGrid = !isRunning && (resultGridOpen || activeJobGroupHasFailedSlot) && visibleBatchSlotCount > 1;
  const showingResultGrid = showingLiveBatchGrid || showingCompletedBatchGrid;
  const showingSingleLivePlaceholder = isRunning && visibleBatchSlotCount === 1 && !showingResultGrid && !currentImage;

  const stageRef = useRef<Konva.Stage | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const pinchRef = useRef<PinchState | null>(null);
  const [pinching, setPinching] = useState(false);
  const effectiveTool = pinching ? "pan" : tool;

  const currentImageURL = historyPreviewSrc(currentImage, null);
  const image = useImageFromSource(currentImage?.previewBlob ?? currentImage?.imageBlob ?? null, currentImage?.previewUrl ? undefined : currentImage?.imageB64, currentImageURL);
  const isCurrentStreamPreview = isTransientPreviewItem(currentImage);

  const [hostSize, setHostSize] = useState({ w: 0, h: 0 });
  const hostRef = useCallback((node: HTMLDivElement | null) => {
    if (roRef.current) {
      roRef.current.disconnect();
      roRef.current = null;
    }
    if (!node) return;
    const update = () => {
      const w = node.clientWidth;
      const h = node.clientHeight;
      if (w > 0 && h > 0) {
        setHostSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
      }
    };
    update();
    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(update);
      ro.observe(node);
      roRef.current = ro;
      return;
    }
    window.addEventListener("resize", update);
    roRef.current = {
      disconnect: () => window.removeEventListener("resize", update),
    } as ResizeObserver;
  }, []);

  function computeFit(img: HTMLImageElement | null, hw: number, hh: number) {
    if (!img || hw === 0 || hh === 0) return { scale: 1, x: 0, y: 0, w: 0, h: 0 };
    const pad = Math.max(18, Math.min(36, Math.floor(Math.min(hw, hh) * 0.07)));
    const sw = (hw - pad * 2) / img.width;
    const sh = (hh - pad * 2) / img.height;
    const scale = Math.min(sw, sh, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    return { scale, x: (hw - w) / 2, y: (hh - h) / 2, w, h };
  }

  const fit = computeFit(image, hostSize.w, hostSize.h);
  const [userView, setUserView] = useState<ViewState | null>(null);
  const view = userView ?? { scale: fit.scale, x: fit.x, y: fit.y };
  const streamPreviewImageBounds = isCurrentStreamPreview && image
    ? {
        left: view.x,
        top: view.y,
        width: image.width * view.scale,
        height: image.height * view.scale,
      }
    : null;

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.x(view.x);
    stage.y(view.y);
    stage.scaleX(view.scale);
    stage.scaleY(view.scale);
    stage.batchDraw();
    if (Math.abs(useStudioStore.getState().viewZoom - view.scale) > 0.001) {
      setField("viewZoom", view.scale);
    }
  }, [view.x, view.y, view.scale, image, hostSize.w, hostSize.h, setField]);

  function resetView() {
    setUserView(null);
  }

  function setView(next: ViewState) {
    setUserView(next);
  }

  function cycleZoom() {
    if (!image || hostSize.w === 0) return;
    vibrateForPlatform(10);
    if (!userView || Math.abs(userView.scale - 1) > 0.001) {
      setUserView({
        scale: 1,
        x: (hostSize.w - image.width) / 2,
        y: (hostSize.h - image.height) / 2,
      });
    } else {
      setUserView(null);
    }
  }

  function clampScale(value: number) {
    return Math.max(MIN_VIEW_SCALE, Math.min(MAX_VIEW_SCALE, value));
  }

  function zoomAround(point: { x: number; y: number }, nextScaleValue: number) {
    if (!image || hostSize.w === 0 || hostSize.h === 0) return;
    const oldScale = Math.max(MIN_VIEW_SCALE, view.scale);
    const nextScale = clampScale(nextScaleValue);
    const imagePoint = {
      x: (point.x - view.x) / oldScale,
      y: (point.y - view.y) / oldScale,
    };
    setView({
      scale: nextScale,
      x: point.x - imagePoint.x * nextScale,
      y: point.y - imagePoint.y * nextScale,
    });
  }

  function zoomBy(factor: number) {
    zoomAround({ x: hostSize.w / 2, y: hostSize.h / 2 }, view.scale * factor);
  }

  function stagePointerToImageCoord(): { x: number; y: number } | null {
    const stage = stageRef.current;
    if (!stage || !image) return null;
    const p = stage.getPointerPosition();
    if (!p) return null;
    return {
      x: (p.x - view.x) / view.scale,
      y: (p.y - view.y) / view.scale,
    };
  }

  const drawingRef = useRef<{ active: boolean; current: Stroke | null }>({ active: false, current: null });
  const freehandRef = useRef<number[] | null>(null);
  const [, setDrawingTick] = useState(0);
  const [drag, setDrag] = useState<null | { kind: "rect" | "arrow" | "freehand" | "text"; sx: number; sy: number; x: number; y: number }>(null);

  useEffect(() => {
    setUserView(null);
    setMaskDataURL(null);
    drawingRef.current = { active: false, current: null };
    freehandRef.current = null;
    setDrag(null);
    pinchRef.current = null;
    setPinching(false);
  }, [currentImage?.id, canvasViewResetTick, setMaskDataURL]);

  function beginPointer(e: Konva.KonvaEventObject<PointerEvent>) {
    if (!image || pinching) return;
    const local = stagePointerToImageCoord();
    if (!local) return;
    if (effectiveTool === "mask") {
      drawingRef.current = { active: true, current: { points: [local.x, local.y], size: brushSize, erase: brushMode === "erase" } };
      vibrateForPlatform(4);
    } else if (effectiveTool === "annotate") {
      const target = e.target;
      if (target === stageRef.current || target.getClassName?.() === "Image") {
        setField("selectedAnnotationId", null);
      }
      if (annotationKind === "freehand") {
        freehandRef.current = [local.x, local.y];
        setDrawingTick((n) => n + 1);
      } else if (annotationKind === "text") {
        const text = window.prompt("文字标注内容:");
        if (text && text.trim()) {
          addAnnotation({
            id: bestEffortUUID("annotation"),
            kind: "text",
            x: local.x,
            y: local.y,
            text: text.trim(),
            color: annotationColor,
          });
        }
      } else {
        setDrag({ kind: annotationKind, sx: local.x, sy: local.y, x: local.x, y: local.y });
      }
    }
  }

  function movePointer() {
    if (!image || pinching) return;
    const local = stagePointerToImageCoord();
    if (!local) return;
    if (effectiveTool === "mask" && drawingRef.current.active && drawingRef.current.current) {
      drawingRef.current.current.points.push(local.x, local.y);
      setDrawingTick((n) => n + 1);
    } else if (effectiveTool === "annotate" && annotationKind === "freehand" && freehandRef.current) {
      freehandRef.current.push(local.x, local.y);
      setDrawingTick((n) => n + 1);
    } else if (effectiveTool === "annotate" && drag) {
      setDrag({ ...drag, x: local.x, y: local.y });
    }
  }

  function endPointer() {
    if (pinching) return;
    if (effectiveTool === "mask" && drawingRef.current.active && drawingRef.current.current) {
      const finished = drawingRef.current.current;
      drawingRef.current = { active: false, current: null };
      pushStroke(finished);
    } else if (effectiveTool === "annotate" && annotationKind === "freehand" && freehandRef.current) {
      const pts = freehandRef.current;
      freehandRef.current = null;
      if (pts.length >= 4) {
        addAnnotation({
          id: bestEffortUUID("annotation"),
          kind: "freehand",
          x: 0,
          y: 0,
          color: annotationColor,
          points: pts,
        });
      }
    } else if (effectiveTool === "annotate" && drag) {
      const w = drag.x - drag.sx;
      const h = drag.y - drag.sy;
      if (Math.abs(w) > 3 && Math.abs(h) > 3) {
        if (drag.kind === "rect") {
          addAnnotation({
            id: bestEffortUUID("annotation"),
            kind: "rect",
            x: Math.min(drag.sx, drag.x),
            y: Math.min(drag.sy, drag.y),
            width: Math.abs(w),
            height: Math.abs(h),
            color: annotationColor,
          });
        } else if (drag.kind === "arrow") {
          addAnnotation({
            id: bestEffortUUID("annotation"),
            kind: "arrow",
            x: drag.sx,
            y: drag.sy,
            width: drag.x - drag.sx,
            height: drag.y - drag.sy,
            color: annotationColor,
          });
        }
      }
      setDrag(null);
    }
  }

  function touchPoint(touch: Touch) {
    const rect = stageRef.current?.container().getBoundingClientRect();
    return {
      x: touch.clientX - (rect?.left ?? 0),
      y: touch.clientY - (rect?.top ?? 0),
    };
  }

  function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function center(a: { x: number; y: number }, b: { x: number; y: number }) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function beginPinch(e: Konva.KonvaEventObject<TouchEvent>) {
    if (e.evt.touches.length < 2) return;
    e.evt.preventDefault();
    const a = touchPoint(e.evt.touches[0]);
    const b = touchPoint(e.evt.touches[1]);
    drawingRef.current = { active: false, current: null };
    freehandRef.current = null;
    setDrag(null);
    pinchRef.current = {
      distance: distance(a, b),
      center: center(a, b),
      view,
    };
    setPinching(true);
  }

  function movePinch(e: Konva.KonvaEventObject<TouchEvent>) {
    const pinch = pinchRef.current;
    if (!pinch || e.evt.touches.length < 2) return;
    e.evt.preventDefault();
    const a = touchPoint(e.evt.touches[0]);
    const b = touchPoint(e.evt.touches[1]);
    const nextCenter = center(a, b);
    const nextScale = clampScale(pinch.view.scale * (distance(a, b) / Math.max(1, pinch.distance)));
    const imagePoint = {
      x: (pinch.center.x - pinch.view.x) / pinch.view.scale,
      y: (pinch.center.y - pinch.view.y) / pinch.view.scale,
    };
    setView({
      scale: nextScale,
      x: nextCenter.x - imagePoint.x * nextScale,
      y: nextCenter.y - imagePoint.y * nextScale,
    });
  }

  function endPinch(e: Konva.KonvaEventObject<TouchEvent>) {
    if (e.evt.touches.length >= 2) return;
    pinchRef.current = null;
    setPinching(false);
  }

  function onWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const oldScale = view.scale;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const factor = 1.15;
    zoomAround(pointer, direction > 0 ? oldScale * factor : oldScale / factor);
  }

  useEffect(() => {
    if (!image || strokes.length === 0) {
      setMaskDataURL(null);
      return;
    }
    const hasWhite = strokes.some((s) => !s.erase);
    setMaskDataURL(hasWhite ? "__PENDING_MASK__" : null);
  }, [strokes, image, setMaskDataURL]);

  useEffect(() => {
    (window as any).__canvasResetView = resetView;
    (window as any).__androidCanvasResetView = resetView;
    (window as any).__androidCanvasZoomIn = () => zoomBy(ZOOM_STEP);
    (window as any).__androidCanvasZoomOut = () => zoomBy(1 / ZOOM_STEP);
    return () => {
      delete (window as any).__canvasResetView;
      delete (window as any).__androidCanvasResetView;
      delete (window as any).__androidCanvasZoomIn;
      delete (window as any).__androidCanvasZoomOut;
    };
  }, [fit.scale, fit.x, fit.y, hostSize.h, hostSize.w, image, view.scale, view.x, view.y]);

  useCanvasShortcuts({
    brushSize,
    cancel,
    compareB,
    copyCurrentImage: () => {
      if (!currentImage) return;
      const copyPromise = useStudioStore.getState().materializeCurrentImage(currentImage).then((full) => (
        full.fullUrl
          ? copyImageURLToClipboard(full.fullUrl)
          : copyImageB64ToClipboard(full.imageB64 ?? "")
      ));
      copyPromise.then((ok) => {
        const pushToast = useStudioStore.getState().pushToast;
        if (ok) pushToast("已复制图片到剪贴板", "success");
        else pushToast("复制失败,当前运行环境拒绝写剪贴板", "error");
      });
    },
    currentImage,
    errorMessage,
    isMac: false,
    isRunning,
    redo,
    removeAnnotation,
    resetView,
    selectedAnnotationId,
    setBrushSize: (value) => setField("brushSize", value),
    setCompareB,
    setErrorMessage: (value) => setField("errorMessage", value),
    toggleFullscreen,
    setSelectedAnnotationId: (value) => setField("selectedAnnotationId", value),
    setTool: (value) => setField("tool", value),
    undo,
  });

  const activeStroke = drawingRef.current.current;
  const activeFreehand = freehandRef.current;
  const hasStrokeLayer = strokes.length > 0 || !!activeStroke;
  const hasAnnotationLayer = annotations.length > 0 || !!drag || !!activeFreehand;

  return (
    <div
      ref={hostRef}
      className="stage-host android-stage-host"
      data-running={isRunning ? "true" : "false"}
      data-batch-grid-open={showingResultGrid ? "true" : "false"}
      style={{ cursor: !currentImage ? "default" : effectiveTool === "pan" ? "grab" : "crosshair" }}
    >
      {showingResultGrid ? (
        <BatchResultGrid
          items={batchResults}
          slots={showingLiveBatchGrid ? liveBatchSlots : showingCompletedBatchGrid ? completedBatchSlots : undefined}
          currentId={currentImage?.id ?? null}
          onSelect={selectBatchResult}
          onClose={closeResultGrid}
          onApplyJobSlotParams={applyJobSlotParams}
          onRegenerateJobSlot={(group, slot) => { void regenerateJobSlot(group, slot); }}
          onQueryAPIMartTask={(taskId) => { void queryAPIMartRecoveryTask(taskId); }}
          apiLabel={batchApiLabel}
          layoutMode="android-virtualized"
          batchIdentity={batchIdentity}
          showClose={!showingLiveBatchGrid}
          title={showingLiveBatchGrid ? `本批预览 · ${jobsCompleted}/${jobsTotal}` : `本批结果 · ${batchResults.length}/${visibleBatchSlotCount} 张`}
        />
      ) : null}
      {showingSingleLivePlaceholder ? (
        <AndroidSinglePendingPreview
          completed={jobsCompleted}
          total={Math.max(jobsTotal, 1)}
          apiLabel={apiLabelForBatchIndex(0)}
        />
      ) : null}
      {!showingResultGrid && currentImage && compareB ? (
        <CompareOverlay
          aBlob={currentImage.imageBlob ?? null}
          aB64={currentImage.imageB64}
          aUrl={currentImage.fullUrl || currentImage.previewUrl}
          bBlob={compareB.imageBlob ?? null}
          bB64={compareB.imageB64}
          bUrl={compareB.fullUrl || compareB.previewUrl}
          split={compareSplit}
          onSplit={setCompareSplit}
        />
      ) : null}
      {!showingResultGrid && currentImage && !compareB && hostSize.w > 0 && hostSize.h > 0 ? (
        <div className={`stage-canvas-wrap ${isCurrentStreamPreview ? "stream-preview-blur" : ""}`}>
          <Stage
            ref={stageRef}
            width={hostSize.w}
            height={hostSize.h}
            x={view.x}
            y={view.y}
            scaleX={view.scale}
            scaleY={view.scale}
            draggable={effectiveTool === "pan" && !pinching}
            onDragEnd={(e) => setView({ ...view, x: e.target.x(), y: e.target.y() })}
            onWheel={onWheel}
            onPointerDown={beginPointer}
            onPointerMove={movePointer}
            onPointerUp={endPointer}
            onPointerLeave={endPointer}
            onDblClick={cycleZoom}
            onDblTap={cycleZoom}
            onTouchStart={beginPinch}
            onTouchMove={movePinch}
            onTouchEnd={endPinch}
            onTouchCancel={endPinch}
          >
            <Layer listening={false}>
              {image ? (
                <KonvaImage
                  image={image}
                  listening={false}
                  perfectDrawEnabled={false}
                />
              ) : null}
            </Layer>

            {hasStrokeLayer ? (
              <Layer listening={false}>
                {strokes.map((s, i) => (
                  <Line
                    key={i}
                    points={s.points}
                    stroke={s.erase ? "rgba(226,85,85,0.55)" : "rgba(77,124,255,0.55)"}
                    strokeWidth={s.size}
                    lineCap="round"
                    lineJoin="round"
                    tension={0.4}
                    dash={s.erase ? [s.size * 0.4, s.size * 0.4] : undefined}
                    listening={false}
                    perfectDrawEnabled={false}
                    globalCompositeOperation={s.erase ? "destination-out" : "source-over"}
                  />
                ))}
                {activeStroke ? (
                  <Line
                    points={activeStroke.points.slice()}
                    stroke={activeStroke.erase ? "rgba(226,85,85,0.55)" : "rgba(77,124,255,0.55)"}
                    strokeWidth={activeStroke.size}
                    lineCap="round"
                    lineJoin="round"
                    tension={0.4}
                    dash={activeStroke.erase ? [activeStroke.size * 0.4, activeStroke.size * 0.4] : undefined}
                    listening={false}
                    perfectDrawEnabled={false}
                    globalCompositeOperation={activeStroke.erase ? "destination-out" : "source-over"}
                  />
                ) : null}
              </Layer>
            ) : null}

            {hasAnnotationLayer ? (
              <Layer listening={effectiveTool === "annotate"}>
                {annotations.map((a) => (
                  <AnnotationShape
                    key={a.id}
                    annotation={a}
                    selected={selectedAnnotationId === a.id}
                    onSelect={() => setField("selectedAnnotationId", a.id)}
                  />
                ))}
                {drag && drag.kind === "rect" ? (
                  <Rect
                    x={Math.min(drag.sx, drag.x)}
                    y={Math.min(drag.sy, drag.y)}
                    width={Math.abs(drag.x - drag.sx)}
                    height={Math.abs(drag.y - drag.sy)}
                    stroke={annotationColor}
                    strokeWidth={2 / view.scale}
                    dash={[6 / view.scale, 4 / view.scale]}
                    listening={false}
                    perfectDrawEnabled={false}
                  />
                ) : null}
                {drag && drag.kind === "arrow" ? (
                  <Arrow
                    points={[drag.sx, drag.sy, drag.x, drag.y]}
                    stroke={annotationColor}
                    strokeWidth={2 / view.scale}
                    fill={annotationColor}
                    pointerLength={12 / view.scale}
                    pointerWidth={12 / view.scale}
                    listening={false}
                    perfectDrawEnabled={false}
                  />
                ) : null}
                {activeFreehand && activeFreehand.length >= 4 ? (
                  <Line
                    points={activeFreehand.slice()}
                    stroke={annotationColor}
                    strokeWidth={3 / view.scale}
                    lineCap="round"
                    lineJoin="round"
                    tension={0.4}
                    listening={false}
                    perfectDrawEnabled={false}
                  />
                ) : null}
              </Layer>
            ) : null}
          </Stage>
          {streamPreviewImageBounds ? (
            <div
              className="stream-preview-image-cover"
              style={streamPreviewImageBounds}
              aria-live="polite"
            >
              <span className="stream-preview-final-wait">
                服务器信号图像已返回，等待最后结果...
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
      {streamPreview && currentImage && !showingLiveBatchGrid ? (
        <div className="stream-preview-overlay">
          <StreamPreviewBadge compact />
        </div>
      ) : null}
    </div>
  );
}

export function androidCanvasModeLabel(item: HistoryItem | null) {
  if (!item) return "空画布";
  return item.mode === "edit" ? "编辑结果" : "生成结果";
}

function AndroidSinglePendingPreview({
  completed,
  total,
  apiLabel,
}: {
  completed: number;
  total: number;
  apiLabel?: string;
}) {
  return (
    <div className="batch-grid-overlay android-single-live-placeholder">
      <div className="batch-grid-head">
        <span className="batch-grid-title">{`本批预览 · ${completed}/${total}`}</span>
      </div>
      <div className="batch-grid" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
        <div className="batch-grid-tile pending" aria-label="等待第 1 张预览">
          <span className="batch-grid-index">1</span>
          <span className="batch-grid-pending-ring" />
          <span className="batch-grid-pending-label">等待预览</span>
          {apiLabel ? <span className="batch-grid-api-label">{apiLabel}</span> : null}
        </div>
      </div>
    </div>
  );
}
