import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { ChevronLeft, ChevronRight, RotateCw, Upload, WandSparkles } from "lucide-react";
import { Stage, Layer, Image as KonvaImage, Line, Rect, Arrow } from "react-konva";
import Konva from "konva";
import { useStudioStore } from "../../state/studioStore";
import type { BatchTaskRecord, HistoryItem } from "../../types/domain";
import { usePlatform } from "../../platform/context";
import { ContextMenu } from "../common/ContextMenu";
import { ImagePixelSizeBadge } from "../common/ImagePixelSizeBadge";
import { BatchResultGrid, type BatchGridSlot, type BatchGridSourcePreview } from "./BatchResultGrid";
import { CompareOverlay } from "./CompareOverlay";
import { SideBySideCompareOverlay } from "./SideBySideCompareOverlay";
import type { Stroke } from "../../state/studioStore.types";
import { EmptyState } from "./EmptyState";
import { copyHistoryItemImageToClipboard, useImageFromSource } from "./canvasImage";
import { AnnotationShape } from "./AnnotationShape";
import { useCanvasShortcuts } from "./useCanvasShortcuts";
import { StreamPreviewBadge } from "./StreamPreviewBadge";
import { streamPreviewItemsFromPreviews } from "../../state/studioStore.streamPreview";
import { historyFullSrc, isTransientPreviewItem, mediaFullUrlFromImageId } from "../../lib/images";
import { extractAPIMartTaskIdFromText } from "../../lib/apimartAPI";
import { latestContinuousSlotsByIndex } from "../../state/browserJobs";
import { displayStatusFromContinuousSlot } from "../../state/batchGridStatus";
import { isTemporarySourceCompareItem } from "../../state/compareSourceSelection";
import {
  minimalHistoryItemFromBatchTask,
  sortedBatchTasksForCurrentView,
  sortedBatchTasksForWorkspace,
} from "../../state/batchTaskRecords";
import { sortHistoryGalleryItems } from "./historyGallerySort";
import { RawResponseModal } from "../history/RawResponseModal";
import { HistoryApiSourceBadge } from "../history/HistoryApiSourceBadge";
import type { HistoryApiSource } from "../history/historyApiSource";
import { useHistoryContextMenu } from "../history/useHistoryContextMenu";
import { sortBatchGridSlotsForDisplay } from "./batchGridDisplayOrder";
import { PanoramaViewerModal } from "../panorama/PanoramaViewerModal";
import { PanoramaPastebackAlignModal } from "../panorama/PanoramaPastebackAlignModal";
import { hasPanoramaRoundtripRef } from "../../panorama/core";
import { recoverPanoramaItemMetadataFromTask } from "../../state/panoramaRoundtripRecovery";
import { ImportImagePath, ReadImageAsBase64 } from "../../platform/runtime/host";

function sourceFileName(filePath: string) {
  return filePath.split(/[\\/]/).pop() || "source.png";
}

function clampCanvasOverlayValue(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

function mergeSourcePreviewHint(
  current: BatchGridSourcePreview | undefined,
  candidate: BatchGridSourcePreview | undefined,
): BatchGridSourcePreview | undefined {
  if (!candidate?.path) return current;
  if (!current) return candidate;
  const currentScore = Number(!!current.previewUrl) + Number(!!current.imageB64);
  const candidateScore = Number(!!candidate.previewUrl) + Number(!!candidate.imageB64);
  if (candidateScore > currentScore) return candidate;
  return current;
}

function apiSourceFromRecord(source: HistoryApiSource | null | undefined): HistoryApiSource | null {
  const apiMode = source?.apiMode;
  const apiProfileId = String(source?.apiProfileId || "").trim();
  const apiProfileName = String(source?.apiProfileName || "").trim();
  if (!apiMode && !apiProfileId && !apiProfileName) return null;
  return {
    apiMode,
    apiProfileId: apiProfileId || undefined,
    apiProfileName: apiProfileName || undefined,
  };
}

function itemWithTaskApiSource(item: HistoryItem, task: BatchTaskRecord | null | undefined): HistoryItem {
  if (!task) return item;
  const apiMode = task.apiMode || item.apiMode;
  const apiProfileId = task.apiProfileId || item.apiProfileId;
  const apiProfileName = task.apiProfileName || item.apiProfileName;
  const size = task.size || item.size;
  const quality = task.quality || item.quality;
  const outputFormat = task.outputFormat || item.outputFormat;
  if (
    apiMode === item.apiMode
    && apiProfileId === item.apiProfileId
    && apiProfileName === item.apiProfileName
    && size === item.size
    && quality === item.quality
    && outputFormat === item.outputFormat
  ) {
    return item;
  }
  return {
    ...item,
    apiMode,
    apiProfileId,
    apiProfileName,
    size,
    quality,
    outputFormat,
  };
}

function apiSourceMatchesActiveProfile(
  source: Pick<HistoryItem, "apiMode" | "apiProfileId"> | null | undefined,
  apiMode: string,
  activeProfileId: string,
): boolean {
  if (!source?.apiMode) return true;
  if (source.apiMode !== apiMode) return false;
  if (source.apiMode === "runninghub" && apiMode === "runninghub") return true;
  const sourceProfileId = String(source.apiProfileId || "").trim();
  return !sourceProfileId || !activeProfileId || sourceProfileId === activeProfileId;
}

function runningHubFailureSummary(task: BatchTaskRecord | null | undefined): string {
  return [
    task?.errorMessage,
    task?.lastLogLine,
    task?.rawPath,
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean).join("\n");
}

function runningHubRecoveryState(task: BatchTaskRecord | null | undefined): {
  recoverable: boolean;
  label?: string;
} {
  if (!task || task.apiMode !== "runninghub") return { recoverable: false };
  if (task.status !== "failed" && task.status !== "interrupted") return { recoverable: false };
  const summary = runningHubFailureSummary(task);
  const looksHistoricalTimeout = summary.includes("runninghub_task_timeout")
    || summary.includes("timed out")
    || summary.includes("timeout")
    || summary.includes("image proxy")
    || summary.includes("result image")
    || summary.includes("bridge");
  return {
    recoverable: true,
    label: looksHistoricalTimeout ? "历史超时遗留" : undefined,
  };
}

function apimartRecoveryState(task: BatchTaskRecord | null | undefined): {
  recoverable: boolean;
  label?: string;
} {
  if (!task || task.apiMode !== "apimart") return { recoverable: false };
  if (task.status === "queued" || task.status === "running") return { recoverable: false };
  const hasTaskId = !!extractAPIMartTaskIdFromText(task.apimartTaskId);
  const traceText = `${task.errorMessage || ""}\n${task.lastLogLine || ""}\n${task.rawPath || ""}`;
  const hasLoggedTaskId = !!extractAPIMartTaskIdFromText(traceText);
  const hasRecoverableTrace = hasTaskId
    || hasLoggedTaskId;
  return {
    recoverable: hasRecoverableTrace,
    label: hasRecoverableTrace ? (hasTaskId ? "APIMart 可同步" : "APIMart 可尝试同步") : undefined,
  };
}

export function CanvasStage() {
  const {
    currentImage, tool, brushSize, brushMode,
    annotationKind, annotationColor,
    selectedAnnotationId,
    annotations, addAnnotation, removeAnnotation, clearAnnotations,
    setMaskDataURL,
    strokes, pushStroke,
    undoStack, redoStack, undo, redo,
    compareB, compareMode, compareSplit, setCompareSplit, setCompareB,
    isRunning, cancel, errorMessage, setField,
    streamPreview,
    streamPreviews,
    runningJobs,
    jobsTotal,
    jobsCompleted,
    toggleFullscreen,
    batchResults, resultGridOpen, selectBatchGridItem, selectBatchResult, closeResultGrid,
    history, historyHasMore, historyLoading, historyGalleryOpen, historyGallerySort,
    loadMoreHistory,
    selectHistoryGalleryGridItem, selectHistoryGalleryResult, closeHistoryGallery, closeHistoryGalleryToEmpty, setHistoryGallerySort,
    selectedBatchTaskId,
    selectBatchTask,
    pushToast,
    retryFailedJob,
    retryBatchTask,
    cancelBatchTask,
    promoteBatchTask,
    recoverRunningHubResult,
    recoverAPIMartResult,
    openResultDetail,
    applyHistoryParams,
    regenerateFromHistory,
    reuseAsSource,
    repastePanoramaRoundtrip,
    openPanoramaPastebackAligner,
    importExternalPanoramaPastebackImage,
    saveHistoryItemAs,
    shareHistoryItem,
    deleteHistoryItem,
    jobGroupsByWorkspace,
    batchTasksById,
    workspaces,
    activeWorkspaceId,
    canvasViewResetTick,
    apiMode,
    activeProfileId,
  } = useStudioStore(useShallow((state) => ({
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
    clearAnnotations: state.clearAnnotations,
    setMaskDataURL: state.setMaskDataURL,
    strokes: state.strokes,
    pushStroke: state.pushStroke,
    undoStack: state.undoStack,
    redoStack: state.redoStack,
    undo: state.undo,
    redo: state.redo,
    compareB: state.compareB,
    compareMode: state.compareMode,
    compareSplit: state.compareSplit,
    setCompareSplit: state.setCompareSplit,
    setCompareB: state.setCompareB,
    isRunning: state.isRunning,
    cancel: state.cancel,
    errorMessage: state.errorMessage,
    setField: state.setField,
    streamPreview: state.streamPreview,
    streamPreviews: state.streamPreviews,
    runningJobs: state.runningJobs,
    jobsTotal: state.jobsTotal,
    jobsCompleted: state.jobsCompleted,
    toggleFullscreen: state.toggleFullscreen,
    batchResults: state.batchResults,
    resultGridOpen: state.resultGridOpen,
    selectBatchGridItem: state.selectBatchGridItem,
    selectBatchResult: state.selectBatchResult,
    closeResultGrid: state.closeResultGrid,
    history: state.history,
    historyHasMore: state.historyHasMore,
    historyLoading: state.historyLoading,
    historyGalleryOpen: state.historyGalleryOpen,
    historyGallerySort: state.historyGallerySort,
    loadMoreHistory: state.loadMoreHistory,
    selectHistoryGalleryGridItem: state.selectHistoryGalleryGridItem,
    selectHistoryGalleryResult: state.selectHistoryGalleryResult,
    closeHistoryGallery: state.closeHistoryGallery,
    closeHistoryGalleryToEmpty: state.closeHistoryGalleryToEmpty,
    setHistoryGallerySort: state.setHistoryGallerySort,
    selectedBatchTaskId: state.selectedBatchTaskId,
    selectBatchTask: state.selectBatchTask,
    pushToast: state.pushToast,
    retryFailedJob: state.retryFailedJob,
    retryBatchTask: state.retryBatchTask,
    cancelBatchTask: state.cancelBatchTask,
    promoteBatchTask: state.promoteBatchTask,
    recoverRunningHubResult: state.recoverRunningHubResult,
    recoverAPIMartResult: state.recoverAPIMartResult,
    openResultDetail: state.openResultDetail,
    applyHistoryParams: state.applyHistoryParams,
    regenerateFromHistory: state.regenerateFromHistory,
    reuseAsSource: state.reuseAsSource,
    repastePanoramaRoundtrip: state.repastePanoramaRoundtrip,
    openPanoramaPastebackAligner: state.openPanoramaPastebackAligner,
    importExternalPanoramaPastebackImage: state.importExternalPanoramaPastebackImage,
    saveHistoryItemAs: state.saveHistoryItemAs,
    shareHistoryItem: state.shareHistoryItem,
    deleteHistoryItem: state.deleteHistoryItem,
    jobGroupsByWorkspace: state.jobGroupsByWorkspace,
    batchTasksById: state.batchTasksById,
    workspaces: state.workspaces,
    activeWorkspaceId: state.activeWorkspaceId,
    canvasViewResetTick: state.canvasViewResetTick,
    apiMode: state.apiMode,
    activeProfileId: state.activeProfileId,
  })));
  const { isMacHost } = usePlatform();
  const panoramaPastebackImportInputRef = useRef<HTMLInputElement>(null);
  const [panoramaPastebackImportAnchor, setPanoramaPastebackImportAnchor] = useState<HistoryItem | null>(null);
  const [panoramaQuickPastebackBusy, setPanoramaQuickPastebackBusy] = useState(false);
  const streamPreviewItems = streamPreviewItemsFromPreviews(streamPreviews, {
    workspaceId: useStudioStore.getState().activeWorkspaceId,
    mode: useStudioStore.getState().mode,
    prompt: useStudioStore.getState().prompt,
    size: useStudioStore.getState().size,
    quality: useStudioStore.getState().quality,
    outputFormat: useStudioStore.getState().outputFormat,
    currentImage,
  });
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const batchTasks = sortedBatchTasksForWorkspace(activeWorkspaceId, activeWorkspace?.batchTaskIds ?? [], batchTasksById);
  const displayBatchTasks = sortedBatchTasksForCurrentView(activeWorkspaceId, activeWorkspace?.batchTaskIds ?? [], batchTasksById);
  const historyById = new Map([...batchResults, ...useStudioStore.getState().history].map((item) => [item.id, item]));
  const workspaceBatchResultIds = activeWorkspace?.batchResultIds ?? [];
  const workspaceBatchResults = workspaceBatchResultIds
    .map((id) => historyById.get(id))
    .filter((item): item is HistoryItem => !!item);
  const visibleBatchResultsById = new Map<string, HistoryItem>();
  for (const item of workspaceBatchResults) visibleBatchResultsById.set(item.id, item);
  for (const item of batchResults) visibleBatchResultsById.set(item.id, item);
  const visibleBatchResults = Array.from(visibleBatchResultsById.values());
  const currentImageIsWorkspaceResult = !!currentImage
    && visibleBatchResults.some((item) => (
      item.id === currentImage.id
      || (!!item.savedPath && item.savedPath === currentImage.savedPath)
    ));
  const currentImageTask = currentImage
    ? batchTasks.find((task) => (
        task.historyItemId === currentImage.id
        || (!!currentImage.savedPath && task.savedPath === currentImage.savedPath)
      )) ?? null
    : null;
  const currentHistoryImage = currentImage ? historyById.get(currentImage.id) : null;
  const currentImageApiSource = currentImage
    ? itemWithTaskApiSource({
        ...currentImage,
        apiMode: currentImage.apiMode || currentHistoryImage?.apiMode,
        apiProfileId: currentImage.apiProfileId || currentHistoryImage?.apiProfileId,
        apiProfileName: currentImage.apiProfileName || currentHistoryImage?.apiProfileName,
      }, currentImageTask)
    : null;
  const sourcePreviewHintsByPath = useMemo(() => {
    const next = new Map<string, BatchGridSourcePreview>();
    const remember = (candidate: BatchGridSourcePreview | undefined) => {
      const path = String(candidate?.path || "").trim();
      if (!path) return;
      const normalizedCandidate: BatchGridSourcePreview = {
        path,
        name: candidate?.name || sourceFileName(path),
        previewUrl: candidate?.previewUrl || undefined,
        imageB64: candidate?.imageB64 || undefined,
      };
      next.set(path, mergeSourcePreviewHint(next.get(path), normalizedCandidate) ?? normalizedCandidate);
    };

    for (const source of activeWorkspace?.sources ?? []) {
      remember({
        path: source.path,
        name: source.name,
        previewUrl: source.previewUrl,
        imageB64: source.imageB64,
      });
    }
    for (const source of activeWorkspace?.batchProcess.discoveredSources ?? []) {
      remember({
        path: source.path,
        name: source.name,
        previewUrl: source.previewUrl,
      });
    }
    for (const item of historyById.values()) {
      if (item.savedPath) {
        remember({
          path: item.savedPath,
          name: sourceFileName(item.savedPath),
          previewUrl: item.previewUrl || item.fullUrl || undefined,
          imageB64: item.imageB64,
        });
      }
      for (const source of item.sourceImages ?? []) {
        remember({
          path: source.path,
          name: source.name,
          previewUrl: source.previewUrl,
          imageB64: source.imageB64,
        });
      }
    }
    if (currentImage?.savedPath) {
      remember({
        path: currentImage.savedPath,
        name: sourceFileName(currentImage.savedPath),
        previewUrl: currentImage.previewUrl || currentImage.fullUrl || undefined,
        imageB64: currentImage.imageB64,
      });
    }
    return next;
  }, [activeWorkspace?.batchProcess.discoveredSources, activeWorkspace?.sources, currentImage, historyById]);
  const resolveSourcePreview = useCallback((
    sourcePath: string | null | undefined,
    sourceImages?: Array<{ path: string; name: string; previewUrl?: string | null; imageB64?: string | null }>,
  ): BatchGridSourcePreview | null => {
    const explicit = sourceImages?.find((source) => String(source?.path || "").trim());
    const explicitPath = String(explicit?.path || sourcePath || "").trim();
    if (!explicitPath) return null;
    const hint = sourcePreviewHintsByPath.get(explicitPath);
    return {
      path: explicitPath,
      name: explicit?.name || hint?.name || sourceFileName(explicitPath),
      previewUrl: explicit?.previewUrl || hint?.previewUrl || undefined,
      imageB64: explicit?.imageB64 || hint?.imageB64 || undefined,
    };
  }, [sourcePreviewHintsByPath]);
  const hasBatchTaskRecords = batchTasks.length > 0;
  const latestContinuousSlots = latestContinuousSlotsByIndex(jobGroupsByWorkspace[activeWorkspaceId] ?? []);
  const continuousSlotCount = latestContinuousSlots.size > 0 ? Math.max(...latestContinuousSlots.keys()) + 1 : 0;
  const visibleBatchSlotCount = Math.max(
    jobsTotal,
    continuousSlotCount,
    visibleBatchResults.reduce((max, item) => (
      Math.max(max, typeof item.batchIndex === "number" && Number.isFinite(item.batchIndex) ? item.batchIndex + 1 : 0)
    ), 0),
    streamPreviewItems.reduce((max, item) => (
      Math.max(max, typeof item.batchIndex === "number" && Number.isFinite(item.batchIndex) ? item.batchIndex + 1 : 0)
    ), 0),
    continuousSlotCount > 0 ? 0 : visibleBatchResults.length + runningJobs.length,
    continuousSlotCount > 0 ? 0 : visibleBatchResults.length + streamPreviewItems.length,
  );
  const liveBatchSlots: BatchGridSlot[] = Array.from(
    { length: visibleBatchSlotCount },
    (_, index) => ({ type: "pending", id: `pending-${index}`, status: "waiting" }),
  );
  for (const item of visibleBatchResults) {
    const index = typeof item.batchIndex === "number" ? item.batchIndex : liveBatchSlots.findIndex((slot) => slot.type === "pending");
    if (index >= 0 && index < liveBatchSlots.length) {
      liveBatchSlots[index] = { type: "result", item, slotIndex: index, updatedAt: item.createdAt };
    }
  }
  for (const item of streamPreviewItems) {
    const index = typeof item.batchIndex === "number" ? item.batchIndex : liveBatchSlots.findIndex((slot) => slot.type === "pending");
    if (index >= 0 && index < liveBatchSlots.length && liveBatchSlots[index].type === "pending") {
      liveBatchSlots[index] = { type: "preview", item };
    }
  }
  const legacyDisplayBatchSlots: BatchGridSlot[] = liveBatchSlots.map((slot, index) => (
    slot.type !== "pending"
      ? slot
      : (() => {
          if (continuousSlotCount <= 0) return slot;
          const latest = latestContinuousSlots.get(index);
          const displayStatus = displayStatusFromContinuousSlot(latest?.slot);
          if (displayStatus === "failed" && latest) {
            return {
              type: "failed",
              id: `failed-${latest.slot.jobId}`,
              groupId: latest.group.groupId,
              jobId: latest.slot.jobId,
              prompt: latest.group.prompt,
              logMessage: latest.slot.errorMessage || latest.slot.stage,
              rawPath: latest.slot.rawPath,
              apiSource: apiSourceFromRecord(latest.group),
            };
          }
          if (displayStatus === "failed") return slot;
          return {
            ...slot,
            id: `${slot.id}-${displayStatus}`,
            status: displayStatus,
            apiSource: apiSourceFromRecord(latest?.group),
          };
        })()
  ));
  const taskDisplayBatchSlots: BatchGridSlot[] = displayBatchTasks.map((task) => {
    const item = (task.historyItemId ? historyById.get(task.historyItemId) : null)
      ?? minimalHistoryItemFromBatchTask(task);
    const sourcedItem = item ? itemWithTaskApiSource(item, task) : null;
    const sourcePreview = resolveSourcePreview(task.batchSourcePath || task.sourceImagePaths?.[0], sourcedItem?.sourceImages);
    const apiSource = apiSourceFromRecord(task);
    if (sourcedItem) return { type: "result", item: sourcedItem, slotIndex: task.slotIndex, updatedAt: task.updatedAt, sourcePreview };
    const preview = streamPreviewItems.find((entry) => entry.batchIndex === task.slotIndex);
    if (preview && (task.status === "queued" || task.status === "running")) {
      return { type: "preview", item: itemWithTaskApiSource(preview, task), slotIndex: task.slotIndex, updatedAt: task.updatedAt, sourcePreview };
    }
    if (task.status === "failed" || task.status === "interrupted") {
      const runningHubRecovery = runningHubRecoveryState(task);
      const apimartRecovery = apimartRecoveryState(task);
      return {
        type: "failed",
        id: `task-failed-${task.id}`,
        slotIndex: task.slotIndex,
        updatedAt: task.updatedAt,
        taskId: task.id,
        groupId: task.groupId,
        jobId: task.jobId,
        prompt: task.prompt,
        logMessage: task.errorMessage || task.lastLogLine,
        rawPath: task.rawPath,
        apiSource,
        sourcePreview,
        runningHubRecoverable: runningHubRecovery.recoverable,
        runningHubRecoveryLabel: runningHubRecovery.label,
        apimartRecoverable: apimartRecovery.recoverable,
        apimartRecoveryLabel: apimartRecovery.label,
      };
    }
    if (task.status === "cancelled") {
      const apimartRecovery = apimartRecoveryState(task);
      return {
        type: "pending",
        id: `task-cancelled-${task.id}`,
        slotIndex: task.slotIndex,
        updatedAt: task.updatedAt,
        taskId: task.id,
        prompt: task.prompt,
        status: "cancelled",
        apiSource,
        sourcePreview,
        apimartRecoverable: apimartRecovery.recoverable,
        apimartRecoveryLabel: apimartRecovery.label,
      };
    }
    if (task.status === "succeeded") {
      const apimartRecovery = apimartRecoveryState(task);
      if (apimartRecovery.recoverable) {
        return {
          type: "failed",
          id: `task-missing-image-${task.id}`,
          slotIndex: task.slotIndex,
          updatedAt: task.updatedAt,
          taskId: task.id,
          groupId: task.groupId,
          jobId: task.jobId,
          prompt: task.prompt,
          label: "结果未同步到本地",
          logMessage: task.errorMessage || task.lastLogLine || "APIMart 任务可能已经完成，但本地没有最终图片。",
          rawPath: task.rawPath,
          apiSource,
          sourcePreview,
          apimartRecoverable: true,
          apimartRecoveryLabel: apimartRecovery.label,
        };
      }
      return {
        type: "pending",
        id: `task-missing-image-${task.id}`,
        slotIndex: task.slotIndex,
        updatedAt: task.updatedAt,
        taskId: task.id,
        prompt: task.prompt,
        status: "succeeded_no_image",
        apiSource,
        sourcePreview,
        apimartRecoverable: apimartRecovery.recoverable,
        apimartRecoveryLabel: apimartRecovery.label,
      };
    }
    return {
      type: "pending",
      id: `task-${task.status}-${task.id}`,
      slotIndex: task.slotIndex,
      updatedAt: task.updatedAt,
      taskId: task.id,
      prompt: task.prompt,
      queuedReason: task.queuedReason,
      canPromote: task.status === "queued" && task.queuedReason === "local_concurrency" && !task.jobId,
      status: task.launchState === "submitting"
        ? "submitting"
        : task.status === "running"
        ? "running"
        : (task.queuedReason === "local_concurrency" || task.queuedReason === "batch_shared_concurrency") && !task.jobId
          ? "local_queued"
          : "queued",
      apiSource,
      sourcePreview,
    };
  });
  const taskSlotIndexes = new Set(batchTasks.map((task) => task.slotIndex));
  const taskDisplayWithLegacyResults = hasBatchTaskRecords
    ? [...taskDisplayBatchSlots]
    : taskDisplayBatchSlots;
  if (hasBatchTaskRecords) {
    for (const item of visibleBatchResults) {
      const index = typeof item.batchIndex === "number" && Number.isFinite(item.batchIndex)
        ? item.batchIndex
        : taskDisplayWithLegacyResults.findIndex((slot) => slot.type === "pending");
      if (index < 0 || taskSlotIndexes.has(index)) continue;
      taskDisplayWithLegacyResults.push({ type: "result", item, slotIndex: index, updatedAt: item.createdAt });
    }
  }
  const displayBatchSlots = hasBatchTaskRecords ? taskDisplayWithLegacyResults : legacyDisplayBatchSlots;
  const displaySlotCount = displayBatchSlots.length || visibleBatchSlotCount;
  const displayResultCount = displayBatchSlots.filter((slot) => slot.type === "result").length;
  const batchResultIds = new Set(visibleBatchResults.map((item) => item.id));
  const hasExplicitWorkspaceBatchResults = workspaceBatchResultIds.length > 0
    && workspaceBatchResultIds.every((id) => batchResultIds.has(id));
  const canShowResultGrid = hasBatchTaskRecords
    ? displaySlotCount > 0
    : displaySlotCount > 1 || (hasExplicitWorkspaceBatchResults && displaySlotCount > 0);
  const hasWorkspaceBatchResultContext = workspaceBatchResultIds.length > 0
    && workspaceBatchResultIds.every((id) => batchResultIds.has(id));
  const hasCurrentBatchSession = hasBatchTaskRecords
    || workspaceBatchResultIds.length > 0
    || visibleBatchResults.length > 0
    || runningJobs.length > 0
    || jobsTotal > 0
    || (jobGroupsByWorkspace[activeWorkspaceId] ?? []).length > 0;
  const resultGridMatchesActiveApiSource = displayBatchSlots.every((slot) => (
    (slot.type === "result" || slot.type === "preview")
      ? apiSourceMatchesActiveProfile(slot.item, apiMode, activeProfileId)
      : true
  ));
  const showingLiveBatchGrid = isRunning && resultGridOpen && canShowResultGrid;
  const showingCompletedBatchGrid = !isRunning
    && resultGridOpen
    && canShowResultGrid
    && (hasCurrentBatchSession || hasWorkspaceBatchResultContext || resultGridMatchesActiveApiSource);
  const showingResultGrid = showingLiveBatchGrid || showingCompletedBatchGrid;
  const historyGalleryItems = useMemo(
    () => sortHistoryGalleryItems(history, historyGallerySort),
    [history, historyGallerySort],
  );
  const showingHistoryGallery = !isRunning && historyGalleryOpen && historyGalleryItems.length > 0;
  const compareUsesSourceImage = isTemporarySourceCompareItem(compareB);
  const galleryTitle = historyHasMore || historyLoading
    ? `完整相册 · 已加载 ${historyGalleryItems.length} 张`
    : `完整相册 · ${historyGalleryItems.length} 张`;
  const singlePreviewItems = sortBatchGridSlotsForDisplay(
    displayBatchSlots.map((slot, index) => ({ slot, originalIndex: index })),
    historyGallerySort === "oldest",
  )
    .map(({ slot }) => slot)
    .filter((slot): slot is Extract<BatchGridSlot, { type: "result" }> => slot.type === "result")
    .map((slot) => slot.item);
  const singlePreviewIndex = currentImage ? singlePreviewItems.findIndex((item) => item.id === currentImage.id) : -1;
  const showSinglePreviewNav = !!currentImage
    && singlePreviewItems.length > 1
    && singlePreviewIndex >= 0
    && !showingResultGrid
    && !showingHistoryGallery
    && !compareB
    && !currentImage.id.startsWith("source-preview-");

  // Hold-space-for-pan: while space is held, override tool to "pan".
  const [spacePan, setSpacePan] = useState(false);
  const effectiveTool = spacePan ? "pan" : tool;

  const stageRef = useRef<Konva.Stage | null>(null);
  const imageLayerRef = useRef<Konva.Layer | null>(null);
  const previewImageRef = useRef<Konva.Image | null>(null);
  const maskLayerRef = useRef<Konva.Layer | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  const currentImageBlob = currentImage?.imageBlob ?? currentImage?.previewBlob ?? null;
  const currentImageURL = currentImage?.previewUrl?.startsWith("blob:")
    ? currentImage.previewUrl
    : historyFullSrc(currentImage, null);
  const handleCurrentImageLoadError = useCallback((failedSrc: string) => {
    if (!currentImage?.savedPath || currentImage.imageB64 || currentImage.imageBlob) return;
    const selectedId = currentImage.id;
    const savedPath = currentImage.savedPath;
    const originalFullUrl = currentImage.fullUrl || "";
    const originalImageId = currentImage.imageId || "";

    void (async () => {
      const materialized = await useStudioStore.getState().materializeCurrentImage(currentImage).catch(() => null);
      const latestAfterMaterialize = useStudioStore.getState().currentImage;
      if (latestAfterMaterialize?.id !== selectedId) return;
      if (materialized) {
        const nextFullUrl = materialized.fullUrl || "";
        const nextImageId = materialized.imageId || "";
        setField("currentImage", materialized);
        if (
          materialized.imageB64
          || materialized.imageBlob
          || (nextFullUrl && nextFullUrl !== failedSrc && (nextFullUrl !== originalFullUrl || nextImageId !== originalImageId))
        ) {
          return;
        }
      }

      const imported = await ImportImagePath(savedPath).catch(() => null);
      if (imported?.path) {
        const latest = useStudioStore.getState().currentImage;
        if (latest?.id !== selectedId) return;
        const importedFullUrl = mediaFullUrlFromImageId(imported.imageId);
        const next = {
          ...latest,
          savedPath: imported.path,
          imageId: imported.imageId || latest.imageId,
          fullUrl: importedFullUrl || latest.fullUrl,
          previewUrl: imported.previewUrl || latest.previewUrl,
          imageB64: imported.imageB64 || latest.imageB64,
          imageBlob: imported.imageB64 ? null : latest.imageBlob,
          previewBlob: null,
          previewOnly: false,
          width: imported.width || latest.width,
          height: imported.height || latest.height,
        };
        setField("currentImage", next);
        if (importedFullUrl || imported.imageB64) return;
      }

      const readablePath = imported?.path || savedPath;
      const imageB64 = await ReadImageAsBase64(readablePath).catch(() => "");
      if (!imageB64) return;
      const latest = useStudioStore.getState().currentImage;
      if (latest?.id !== selectedId) return;
      setField("currentImage", {
        ...latest,
        savedPath: readablePath,
        imageB64,
        imageBlob: null,
        previewBlob: null,
        previewOnly: false,
      });
    })();
  }, [currentImage, setField]);
  const image = useImageFromSource(
    currentImageBlob,
    currentImage?.imageB64,
    currentImageURL,
    handleCurrentImageLoadError,
  );
  const isCurrentStreamPreview = isTransientPreviewItem(currentImage);

  useEffect(() => {
    const node = previewImageRef.current;
    if (!node) return;
    if (isCurrentStreamPreview) {
      node.cache();
    } else {
      node.clearCache();
    }
    node.getLayer()?.batchDraw();
    return () => {
      node.clearCache();
    };
  }, [image, isCurrentStreamPreview]);

  useEffect(() => {
    if (!currentImage?.previewOnly) return;
    if (
      currentImage.fullUrl
      || currentImage.imageId
      || currentImage.imageB64
      || currentImage.imageBlob
      || currentImage.previewBlob
    ) return;
    if (currentImage.previewUrl?.startsWith("blob:")) return;
    if (currentImage.id.startsWith("preview-")) return;

    let cancelled = false;
    const selectedId = currentImage.id;
    void useStudioStore.getState().materializeCurrentImage(currentImage).then((full) => {
      if (cancelled || !full || full.previewOnly) return;
      if (useStudioStore.getState().currentImage?.id !== selectedId) return;
      setField("currentImage", full);
    }).catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [
    currentImage?.id,
    currentImage?.previewOnly,
    currentImage?.fullUrl,
    currentImage?.imageId,
    currentImage?.imageB64,
    currentImage?.imageBlob,
    currentImage?.previewBlob,
    currentImage?.previewUrl,
    setField,
  ]);

  // 鈽?Measure the OUTER wrapper (.stage-host) 鈥?which is a normal grid item
  // bounded by its parent shell 鈥?instead of the inner absolute container.
  // This breaks the feedback loop where the Konva canvas width (= hostSize.w)
  // would otherwise expand its parent in normal flow and push hostSize 鈫?鈭?
  const [hostSize, setHostSize] = useState({ w: 0, h: 0 });
  const hostRef = useCallback((node: HTMLDivElement | null) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null; }
    if (!node) return;
    const update = () => {
      const w = node.clientWidth;
      const h = node.clientHeight;
      if (w > 0 && h > 0) setHostSize({ w, h });
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

  // Plain function 鈥?not useMemo 鈥?so it is always computed with the very
  // latest hostSize / image references on every render. Avoids the closure
  // race we saw with useMemo deps.
  function computeFit(img: HTMLImageElement | null, hw: number, hh: number) {
    if (!img || hw === 0 || hh === 0) return { scale: 1, x: 0, y: 0, w: 0, h: 0 };
    const pad = 40;
    const sw = (hw - pad * 2) / img.width;
    const sh = (hh - pad * 2) / img.height;
    const scale = Math.min(sw, sh, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    return { scale, x: (hw - w) / 2, y: (hh - h) / 2, w, h };
  }
  const fit = computeFit(image, hostSize.w, hostSize.h);

  // `userView` only holds explicit user manipulation (pan / wheel zoom).
  // The effective view is `userView ?? fit`, so the displayed image is always
  // centered by default. userView is reset whenever currentImage.id changes.
  const [userView, setUserView] = useState<{ scale: number; x: number; y: number } | null>(null);
  const view = userView ?? { scale: fit.scale, x: fit.x, y: fit.y };
  const streamPreviewImageBounds = isCurrentStreamPreview && image
    ? {
        left: view.x,
        top: view.y,
        width: image.width * view.scale,
        height: image.height * view.scale,
      }
    : null;
  const currentImageBadgeBounds = currentImageApiSource && image && currentImageApiSource.apiMode
    ? {
        left: view.x,
        top: view.y,
        width: image.width * view.scale,
        height: image.height * view.scale,
      }
    : null;
  const currentImageBounds = image
    ? {
        left: view.x,
        top: view.y,
        width: image.width * view.scale,
        height: image.height * view.scale,
      }
    : null;
  const singlePreviewNavButtonSize = 46;
  const singlePreviewNavButtonGap = 14;
  const singlePreviewNavButtonInset = 12;
  const singlePreviewNavTop = currentImageBounds
    ? clampCanvasOverlayValue(
        currentImageBounds.top + currentImageBounds.height / 2 - singlePreviewNavButtonSize / 2,
        singlePreviewNavButtonInset,
        hostSize.h - singlePreviewNavButtonSize - singlePreviewNavButtonInset,
      )
    : 0;
  const singlePreviewNavBounds = showSinglePreviewNav && currentImageBounds
    ? {
        previous: {
          left: clampCanvasOverlayValue(
            currentImageBounds.left - singlePreviewNavButtonSize - singlePreviewNavButtonGap,
            singlePreviewNavButtonInset,
            hostSize.w - singlePreviewNavButtonSize - singlePreviewNavButtonInset,
          ),
          top: singlePreviewNavTop,
        },
        next: {
          left: clampCanvasOverlayValue(
            currentImageBounds.left + currentImageBounds.width + singlePreviewNavButtonGap,
            singlePreviewNavButtonInset,
            hostSize.w - singlePreviewNavButtonSize - singlePreviewNavButtonInset,
          ),
          top: singlePreviewNavTop,
        },
      }
    : null;
  const panoramaPastebackQuickWidth = 264;
  const panoramaPastebackQuickHeight = 34;
  const panoramaPastebackQuickInset = 12;
  const currentPanoramaPastebackItem = useMemo(
    () => {
      if (!currentImage) return null;
      const activeSources = currentImageIsWorkspaceResult && activeWorkspace?.mode === "edit"
        ? activeWorkspace.sources
        : [];
      const recoveryTask = activeSources.length > 0
        ? {
            ...currentImageTask,
            sourceImages: (currentImageTask?.sourceImages?.length ?? 0) > 0
              ? currentImageTask?.sourceImages
              : activeSources,
            sourceImagePaths: currentImageTask?.sourceImagePaths ?? activeSources.map((source) => source.path),
          }
        : currentImageTask;
      return recoverPanoramaItemMetadataFromTask(currentImage, recoveryTask, history);
    },
    [activeWorkspace?.mode, activeWorkspace?.sources, currentImage, currentImageIsWorkspaceResult, currentImageTask, history],
  );
  const canQuickPanoramaPasteback = !!currentPanoramaPastebackItem
    && !!currentImageBounds
    && !isCurrentStreamPreview
    && !currentPanoramaPastebackItem.id.startsWith("source-preview-")
    && hasPanoramaRoundtripRef(currentPanoramaPastebackItem);
  const panoramaPastebackQuickBounds = canQuickPanoramaPasteback && currentImageBounds
    ? {
        left: clampCanvasOverlayValue(
          currentImageBounds.left + currentImageBounds.width - panoramaPastebackQuickWidth - panoramaPastebackQuickInset,
          panoramaPastebackQuickInset,
          hostSize.w - panoramaPastebackQuickWidth - panoramaPastebackQuickInset,
        ),
        top: clampCanvasOverlayValue(
          currentImageBounds.top + panoramaPastebackQuickInset,
          panoramaPastebackQuickInset,
          hostSize.h - panoramaPastebackQuickHeight - panoramaPastebackQuickInset,
        ),
      }
    : null;

  // Imperatively push the latest fit onto the Konva Stage *after* React commits
  // and *before* paint. This is the belt-and-suspenders fix: even if React
  // props somehow lag a frame behind, this guarantees the visible stage is at
  // the right position whenever image / hostSize / userView changes.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.x(view.x);
    stage.y(view.y);
    stage.scaleX(view.scale);
    stage.scaleY(view.scale);
    stage.batchDraw();
    setField("viewZoom", view.scale);
  }, [view.x, view.y, view.scale, image, hostSize.w, hostSize.h]);

  // Double-click on the stage: cycle between fit and 100%.
  function onStageDblClick() {
    if (!image || hostSize.w === 0) return;
    if (!userView || Math.abs(userView.scale - 1) > 0.001) {
      // Currently fit (or not at 100%) 鈫?snap to 100% centred on image.
      const cx = (hostSize.w - image.width) / 2;
      const cy = (hostSize.h - image.height) / 2;
      setUserView({ scale: 1, x: cx, y: cy });
    } else {
      setUserView(null); // back to fit
    }
  }

  // Local "in-flight" stroke buffer 鈥?only the completed strokes live in the
  // store (so we don't spam zustand on every mousemove). Forces re-render via
  // a tick counter when the in-progress stroke needs to redraw.
  const drawingRef = useRef<{ active: boolean; current: Stroke | null }>({ active: false, current: null });
  const [, setDrawingTick] = useState(0);

  // Annotation drag state.
  const [drag, setDrag] = useState<null | { kind: "rect" | "arrow" | "freehand" | "text"; sx: number; sy: number; x: number; y: number }>(null);
  const {
    buildMenu,
    closeMenu,
    closeRaw,
    menu,
    openMenu,
    rawPath,
  } = useHistoryContextMenu({
    currentImageId: currentImage?.id ?? null,
    compareItemId: compareB?.id ?? null,
    onOpenDetail: openResultDetail,
    onOpenPanorama: (item) => void useStudioStore.getState().openPanoramaViewer(item),
    onApplyParams: applyHistoryParams,
    onRegenerate: (item) => void regenerateFromHistory(item),
    onReuseAsSource: (item) => void reuseAsSource(item),
    onRepastePanorama: (item) => openPanoramaPastebackAligner(item),
    onSaveOriginal: (item) => void saveHistoryItemAs(item),
    onShare: (item) => void shareHistoryItem(item),
    onToggleCompare: (item) => setCompareB(compareB?.id === item.id ? null : item),
    onDelete: (item) => {
      if (item.previewOnly) return;
      if (window.confirm(`确定删除此历史项？\n\n${item.prompt?.slice(0, 60) || "(无 prompt)"}`)) {
        void deleteHistoryItem(item.id);
      }
    },
    pushToast,
  });

  // When the displayed image identity changes, clear the user's manual view
  // and per-image canvas state. This guarantees the new image starts at fit.
  // canvasViewResetTick covers in-place edits such as rotate, flip, and crop.
  useEffect(() => {
    setUserView(null);
    setMaskDataURL(null);
    drawingRef.current = { active: false, current: null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentImage?.id, canvasViewResetTick]);

  // setView is the only writer of userView. Treat any explicit pan/zoom as a
  // user override; auto-recenter happens by resetting to null elsewhere.
  function setView(v: { scale: number; x: number; y: number }) {
    setUserView(v);
  }

  // Mouse wheel zoom around cursor.
  function onWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const oldScale = view.scale;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const mousePointTo = {
      x: (pointer.x - view.x) / oldScale,
      y: (pointer.y - view.y) / oldScale,
    };
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const factor = 1.15;
    const newScale = Math.max(0.05, Math.min(8, direction > 0 ? oldScale * factor : oldScale / factor));
    setView({
      scale: newScale,
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
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

  // In-progress freehand annotation buffer (kept in ref to keep mousemove cheap).
  const freehandRef = useRef<number[] | null>(null);

  function onMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    if (!image) return;
    const local = stagePointerToImageCoord();
    if (!local) return;
    if (effectiveTool === "mask") {
      drawingRef.current = { active: true, current: { points: [local.x, local.y], size: brushSize, erase: brushMode === "erase" } };
    } else if (effectiveTool === "annotate") {
      // Click on empty area while in annotate mode clears any selection.
      // Click on an annotation shape is handled by the shape's own onClick.
      const target = e.target;
      if (target === stageRef.current || target.getClassName?.() === "Image") {
        setField("selectedAnnotationId", null);
      }
      if (annotationKind === "freehand") {
        freehandRef.current = [local.x, local.y];
        setDrawingTick((n) => n + 1);
      } else if (annotationKind === "text") {
        // Text annotations are created via a prompt on mouse down (no drag).
        const text = window.prompt("文字标注内容:");
        if (text && text.trim()) {
          addAnnotation({
            id: crypto.randomUUID(),
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

  function openCanvasMenu(e: Konva.KonvaEventObject<PointerEvent>) {
    if (!currentPanoramaPastebackItem) return;
    e.evt.preventDefault();
    openMenu(currentPanoramaPastebackItem, e.evt.clientX, e.evt.clientY);
  }

  async function autoPasteCurrentPanorama(item: HistoryItem) {
    if (panoramaQuickPastebackBusy) return;
    setPanoramaQuickPastebackBusy(true);
    try {
      await repastePanoramaRoundtrip(item, { selectAsCurrent: true });
    } finally {
      setPanoramaQuickPastebackBusy(false);
    }
  }

  function openExternalPanoramaPastebackPicker(anchor: HistoryItem) {
    setPanoramaPastebackImportAnchor(anchor);
    const input = panoramaPastebackImportInputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  }

  async function handleExternalPanoramaPastebackFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    const anchor = panoramaPastebackImportAnchor;
    event.currentTarget.value = "";
    setPanoramaPastebackImportAnchor(null);
    if (!file || !anchor) return;
    await importExternalPanoramaPastebackImage(anchor, file);
  }


  function onMouseMove() {
    if (!image) return;
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

  function onMouseUp() {
    if (effectiveTool === "mask" && drawingRef.current.active && drawingRef.current.current) {
      const finished = drawingRef.current.current;
      drawingRef.current = { active: false, current: null };
      pushStroke(finished);
    } else if (effectiveTool === "annotate" && annotationKind === "freehand" && freehandRef.current) {
      const pts = freehandRef.current;
      freehandRef.current = null;
      if (pts.length >= 4) {
        addAnnotation({
          id: crypto.randomUUID(),
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
            id: crypto.randomUUID(),
            kind: "rect",
            x: Math.min(drag.sx, drag.x),
            y: Math.min(drag.sy, drag.y),
            width: Math.abs(w),
            height: Math.abs(h),
            color: annotationColor,
          });
        } else if (drag.kind === "arrow") {
          addAnnotation({
            id: crypto.randomUUID(),
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

  // Keep the store flag in sync so submit can cheaply know whether any mask
  // exists, but defer the expensive PNG export until the user actually submits.
  useEffect(() => {
    if (!image || strokes.length === 0) {
      setMaskDataURL(null);
      return;
    }
    const hasWhite = strokes.some((s) => !s.erase);
    setMaskDataURL(hasWhite ? "__PENDING_MASK__" : null);
  }, [strokes, image, setMaskDataURL]);

  function resetView() {
    setUserView(null);
  }

  const navigateSinglePreview = useCallback((direction: -1 | 1) => {
    if (!showSinglePreviewNav) return;
    const nextIndex = singlePreviewIndex + direction;
    if (nextIndex < 0) {
      pushToast("已经是第一张了", "info", 1800);
      return;
    }
    if (nextIndex >= singlePreviewItems.length) {
      pushToast("已经是最后一张了", "info", 1800);
      return;
    }
    const target = singlePreviewItems[nextIndex];
    if (!target || target.id === currentImage?.id) return;
    void selectBatchResult(target);
  }, [currentImage?.id, pushToast, selectBatchResult, showSinglePreviewNav, singlePreviewIndex, singlePreviewItems]);

  // Expose helpers via window for the toolbar reset buttons.
  useEffect(() => {
    (window as any).__canvasResetView = resetView;
    return () => {
      delete (window as any).__canvasResetView;
    };
  }, [fit.scale, fit.x, fit.y]);

  useCanvasShortcuts({
    brushSize,
    cancel,
    compareB,
    copyCurrentImage: () => {
      if (!currentImage) return;
      const copyPromise = copyHistoryItemImageToClipboard(
        currentImage,
        (item) => useStudioStore.getState().materializeCurrentImage(item),
      );
      copyPromise.then((result) => {
        const pushToast = useStudioStore.getState().pushToast;
        if (result === "success") pushToast("已复制图像，可直接粘贴到微信", "success");
        else if (result === "missing_original") pushToast("当前图片没有可复制的原图", "warn");
        else pushToast("复制图像失败", "error");
      });
    },
    currentImage,
    errorMessage,
    isMac: isMacHost,
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
    onNavigatePreview: showSinglePreviewNav ? navigateSinglePreview : undefined,
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const isTyping = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (isTyping) return;
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        setSpacePan(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpacePan(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Host div is rendered unconditionally so its ref (and the ResizeObserver
  // attached to it) survives the empty-state 鈫?has-image transition. Previously
  // the empty branch had its own <div ref={hostRef}>, the host unmounted on
  // first generate, and the observer kept reporting the stale initial size.
  return (
    <>
      <div
        ref={hostRef}
        className="stage-host"
        data-panorama-pasteback-available={hasPanoramaRoundtripRef(currentPanoramaPastebackItem) ? "true" : "false"}
        data-panorama-current-workspace-result={currentImageIsWorkspaceResult ? "true" : "false"}
        data-panorama-task-linked={currentImageTask ? "true" : "false"}
        data-panorama-active-source-count={activeWorkspace?.sources.length ?? 0}
        style={{ cursor: !currentImage ? "default" : (effectiveTool === "pan" ? (spacePan ? "grabbing" : "grab") : "crosshair") }}
      >
        {!currentImage && !showingResultGrid && !showingHistoryGallery && <EmptyState state={isRunning ? "running" : "idle"} />}
        {streamPreview && currentImage && !showingLiveBatchGrid ? (
          <div className="stream-preview-overlay">
            <StreamPreviewBadge />
          </div>
        ) : null}
        {showingResultGrid && (
          <BatchResultGrid
            items={visibleBatchResults}
            slots={showingLiveBatchGrid || showingCompletedBatchGrid ? displayBatchSlots : undefined}
            currentId={currentImage?.id ?? null}
            selectedTaskId={selectedBatchTaskId}
            onSelect={showingLiveBatchGrid ? () => undefined : selectBatchGridItem}
            onPreview={selectBatchResult}
            onOpenItemContextMenu={(item, x, y) => openMenu(item, x, y)}
            onSelectTask={selectBatchTask}
            onRetryFailed={({ groupId, jobId }) => retryFailedJob(groupId, jobId)}
            onRetryTask={({ taskId }) => retryBatchTask(taskId, { independent: true })}
            onRecoverRunningHub={({ taskId }) => {
              void recoverRunningHubResult(taskId);
            }}
            onRecoverAPIMart={({ taskId }) => {
              void recoverAPIMartResult(taskId);
            }}
            onCancelTask={({ taskId }) => cancelBatchTask(taskId)}
            onPromoteTask={({ taskId }) => promoteBatchTask(taskId)}
            onClose={closeResultGrid}
            showClose={!showingLiveBatchGrid}
            preserveSlotOrder={hasBatchTaskRecords}
            gallerySort={historyGallerySort}
            onGallerySortChange={setHistoryGallerySort}
            title={showingLiveBatchGrid ? `本批预览 · ${jobsCompleted}/${Math.max(jobsTotal, displaySlotCount)}` : `本批结果 · ${displayResultCount}/${displaySlotCount} 张`}
          />
        )}
        {showingHistoryGallery && !showingResultGrid && (
          <BatchResultGrid
            items={historyGalleryItems}
            currentId={currentImage?.id ?? null}
            onSelect={selectHistoryGalleryGridItem}
            onPreview={selectHistoryGalleryResult}
            onOpenItemContextMenu={(item, x, y) => openMenu(item, x, y)}
            onClose={closeHistoryGallery}
            onCloseToEmpty={closeHistoryGalleryToEmpty}
            title={galleryTitle}
            variant="historyGallery"
            gallerySort={historyGallerySort}
            onGallerySortChange={setHistoryGallerySort}
            hasMore={historyHasMore}
            loadingMore={historyLoading}
            onLoadMore={() => void loadMoreHistory()}
          />
        )}
        {!showingResultGrid && !showingHistoryGallery && currentImage && compareB && compareMode === "sideBySide" && (
          <SideBySideCompareOverlay
            leftBlob={compareB.imageBlob ?? null}
            leftB64={compareB.imageB64}
            leftUrl={compareB.fullUrl || compareB.previewUrl}
            rightBlob={currentImage.imageBlob ?? null}
            rightB64={currentImage.imageB64}
            rightUrl={currentImage.fullUrl || currentImage.previewUrl}
            leftLabel={compareUsesSourceImage ? "原图" : "对比图"}
            rightLabel={compareUsesSourceImage ? "成图" : "当前图"}
          />
        )}
        {!showingResultGrid && !showingHistoryGallery && currentImage && compareB && compareMode !== "sideBySide" && (
          <CompareOverlay
            leftBlob={compareB.imageBlob ?? null}
            leftB64={compareB.imageB64}
            leftUrl={compareB.fullUrl || compareB.previewUrl}
            rightBlob={currentImage.imageBlob ?? null}
            rightB64={currentImage.imageB64}
            rightUrl={currentImage.fullUrl || currentImage.previewUrl}
            split={compareSplit}
            onSplit={setCompareSplit}
            leftLabel={compareUsesSourceImage ? "原图" : "对比图"}
            rightLabel={compareUsesSourceImage ? "成图" : "当前图"}
          />
        )}
        {!showingResultGrid && !showingHistoryGallery && currentImage && !compareB && hostSize.w > 0 && hostSize.h > 0 && (
        <div
          className={`stage-canvas-wrap ${isCurrentStreamPreview ? "stream-preview-blur" : ""}`}
          style={{ position: "absolute", inset: 0, overflow: "hidden" }}
        >
        <Stage
          ref={stageRef}
          width={hostSize.w}
          height={hostSize.h}
          x={view.x}
          y={view.y}
          scaleX={view.scale}
          scaleY={view.scale}
          draggable={effectiveTool === "pan"}
          onDragEnd={(e) => setView({ ...view, x: e.target.x(), y: e.target.y() })}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onDblClick={onStageDblClick}
          onContextMenu={openCanvasMenu}
        >
          <Layer ref={imageLayerRef}>
            {image && (
              <KonvaImage
                ref={previewImageRef}
                image={image}
                listening={false}
                filters={isCurrentStreamPreview ? [Konva.Filters.Blur] : undefined}
                blurRadius={isCurrentStreamPreview ? 24 : 0}
              />
            )}
          </Layer>

          <Layer ref={maskLayerRef}>
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
                globalCompositeOperation={s.erase ? "destination-out" : "source-over"}
              />
            ))}
            {drawingRef.current.current && (
              <Line
                // Fresh array reference forces react-konva to repaint while drawing.
                points={drawingRef.current.current.points.slice()}
                stroke={drawingRef.current.current.erase ? "rgba(226,85,85,0.55)" : "rgba(77,124,255,0.55)"}
                strokeWidth={drawingRef.current.current.size}
                lineCap="round"
                lineJoin="round"
                tension={0.4}
                dash={drawingRef.current.current.erase ? [drawingRef.current.current.size * 0.4, drawingRef.current.current.size * 0.4] : undefined}
                listening={false}
                globalCompositeOperation={drawingRef.current.current.erase ? "destination-out" : "source-over"}
              />
            )}
          </Layer>

          <Layer>
            {annotations.map((a) => (
              <AnnotationShape
                key={a.id}
                annotation={a}
                selected={selectedAnnotationId === a.id}
                onSelect={() => setField("selectedAnnotationId", a.id)}
              />
            ))}
            {drag && drag.kind === "rect" && (
              <Rect
                x={Math.min(drag.sx, drag.x)}
                y={Math.min(drag.sy, drag.y)}
                width={Math.abs(drag.x - drag.sx)}
                height={Math.abs(drag.y - drag.sy)}
                stroke={annotationColor}
                strokeWidth={2 / view.scale}
                dash={[6 / view.scale, 4 / view.scale]}
                listening={false}
              />
            )}
            {drag && drag.kind === "arrow" && (
              <Arrow
                points={[drag.sx, drag.sy, drag.x, drag.y]}
                stroke={annotationColor}
                strokeWidth={2 / view.scale}
                fill={annotationColor}
                pointerLength={12 / view.scale}
                pointerWidth={12 / view.scale}
                listening={false}
              />
            )}
            {freehandRef.current && freehandRef.current.length >= 4 && (
              <Line
                // Fresh array reference forces react-konva to repaint while drawing.
                points={freehandRef.current.slice()}
                stroke={annotationColor}
                strokeWidth={3 / view.scale}
                lineCap="round"
                lineJoin="round"
                tension={0.4}
                listening={false}
              />
            )}
          </Layer>
        </Stage>
        {currentImageBadgeBounds && currentImageApiSource ? (
          <div className="canvas-api-source-badge-host" style={currentImageBadgeBounds} aria-hidden="true">
            <HistoryApiSourceBadge source={currentImageApiSource} className="canvas-api-source-badge rounded-[6px]" />
            <ImagePixelSizeBadge
              width={currentImage?.width || image?.naturalWidth}
              height={currentImage?.height || image?.naturalHeight}
              src={currentImageURL}
              className="canvas-image-pixel-size"
            />
          </div>
        ) : null}
        {panoramaPastebackQuickBounds && currentPanoramaPastebackItem ? (
          <div
            className="canvas-panorama-pasteback-actions"
            style={panoramaPastebackQuickBounds}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="canvas-panorama-pasteback-button"
              title="使用默认位置和羽化参数直接贴回当前 360 全景"
              disabled={panoramaQuickPastebackBusy}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void autoPasteCurrentPanorama(currentPanoramaPastebackItem);
              }}
            >
              <WandSparkles className="h-3.5 w-3.5" />
              <span>{panoramaQuickPastebackBusy ? "贴回中" : "自动贴回"}</span>
            </button>
            <button
              type="button"
              className="canvas-panorama-pasteback-button"
              title="贴回当前 360 大图"
              disabled={panoramaQuickPastebackBusy}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openPanoramaPastebackAligner(currentPanoramaPastebackItem);
              }}
            >
              <RotateCw className="h-3.5 w-3.5" />
              <span>手动贴回</span>
            </button>
            <button
              type="button"
              className="canvas-panorama-pasteback-button"
              title="导入同比例外部图像贴回当前 360 大图"
              disabled={panoramaQuickPastebackBusy}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openExternalPanoramaPastebackPicker(currentPanoramaPastebackItem);
              }}
            >
              <Upload className="h-3.5 w-3.5" />
              <span>导入贴回</span>
            </button>
          </div>
        ) : null}
        <input
          ref={panoramaPastebackImportInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="canvas-panorama-pasteback-file"
          tabIndex={-1}
          onChange={handleExternalPanoramaPastebackFile}
        />
        {singlePreviewNavBounds ? (
          <>
            <button
              type="button"
              className={`single-preview-nav-button single-preview-nav-button-left ${singlePreviewIndex <= 0 ? "single-preview-nav-button-disabled" : ""}`}
              style={singlePreviewNavBounds.previous}
              aria-disabled={singlePreviewIndex <= 0}
              aria-label="上一张"
              title={singlePreviewIndex <= 0 ? "已经是第一张了" : "上一张"}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                navigateSinglePreview(-1);
              }}
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              className={`single-preview-nav-button single-preview-nav-button-right ${singlePreviewIndex >= singlePreviewItems.length - 1 ? "single-preview-nav-button-disabled" : ""}`}
              style={singlePreviewNavBounds.next}
              aria-disabled={singlePreviewIndex >= singlePreviewItems.length - 1}
              aria-label="下一张"
              title={singlePreviewIndex >= singlePreviewItems.length - 1 ? "已经是最后一张了" : "下一张"}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                navigateSinglePreview(1);
              }}
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        ) : null}
        {streamPreviewImageBounds ? (
          <div
            className="stream-preview-image-cover"
            style={streamPreviewImageBounds}
            aria-live="polite"
          >
            <span className="stream-preview-final-wait">
              服务端最终图像已返回，等待最后结果...
            </span>
          </div>
        ) : null}
        </div>
        )}
      </div>
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenu(menu.item)}
          onClose={closeMenu}
        />
      ) : null}
      <PanoramaViewerModal />
      <PanoramaPastebackAlignModal />
      {rawPath ? <RawResponseModal path={rawPath} onClose={closeRaw} /> : null}
    </>
  );
}


