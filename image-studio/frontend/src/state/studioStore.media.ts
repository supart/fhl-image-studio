import {
  CropImage,
  ExportHistoryToFile,
  FlipImage,
  ImportHistoryFromFile,
  RegisterImportedImageAsset,
  ReadImageAsBase64,
  RotateImage,
} from "../platform/runtime/host";
import { exportHistoryForPlatform } from "../platform/android/bridge";
import {
  sanitizeHistoryForExport,
  sanitizeImportedHistoryItem,
} from "../lib/security";
import { loadHistoryPage, persistHistoryItems, pruneHistoryStorage } from "../lib/storage";
import { storageKey } from "../lib/storageNamespace.ts";
import type { HistoryGallerySort, HistoryItem, Preset, Toast } from "../types/domain";
import type { CompareMode, StudioState } from "./studioStore.types";
import {
  genId,
  persistTrimmedHistory,
  trimHistory,
} from "./studioStore.shared";
import {
  ensureFullBatchItem,
  ensureFullHistoryItem,
  materializeHistoryItem,
  materializeMediaRefForHistoryItem,
  toPreviewOnlyHistoryItem,
  withMediaAssetRef,
} from "./studioStore.runtime";
import { currentBatchTaskViewCount } from "./batchTaskRecords";
import {
  materializeCompareSourceAsHistoryItem,
  primaryCompareSourceFromCurrentImage,
} from "./compareSourceSelection";
import { sourceContextPatchFromHistoryItem } from "./sourceContextSelection";
import { patchWorkspaceRuntime, type WorkspacePatch } from "./workspaceRuntime";
import { syncSharedEditAutoAspect } from "./sharedEditAutoAspect";
import { applicationStateEpoch } from "./applicationStateReset.ts";
import { recoverPanoramaHistoryMetadata } from "./panoramaRoundtripRecovery.ts";
import {
  captureWorkspaceAction,
  isWorkspaceActionCurrent,
  settleWorkspaceAction,
  type WorkspaceActionToken,
} from "./workspaceActionTokens.ts";

type StateAdapter = {
  getState: () => StudioState;
  setState: (patch: Partial<StudioState> | ((state: StudioState) => Partial<StudioState>)) => void;
};

function workspaceIds(state: StudioState): string[] {
  return state.workspaces.map((workspace) => workspace.id);
}

function actionIsCurrent(store: StateAdapter, token: WorkspaceActionToken): boolean {
  const state = store.getState();
  return !state.isResettingApplication && isWorkspaceActionCurrent(token, workspaceIds(state));
}

function scopedWorkspacePatch(
  state: StudioState,
  workspaceId: string,
  workspacePatch: WorkspacePatch,
  activePatch: Partial<StudioState>,
): Partial<StudioState> {
  return {
    workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, workspacePatch),
    ...(state.activeWorkspaceId === workspaceId ? activePatch : {}),
  };
}

function scopedMaterializationSetter(
  store: StateAdapter,
  workspaceId: string,
): (fn: (state: StudioState) => Partial<StudioState>) => void {
  return (fn) => store.setState((state) => {
    const patch = fn(state);
    return state.activeWorkspaceId === workspaceId
      ? patch
      : {
          ...patch,
          currentImage: state.currentImage,
          compareB: state.compareB,
          batchResults: state.batchResults,
        };
  });
}

const TOAST_DEDUPE_MS = 6000;
const toastLastShownAt = new Map<string, number>();
export const INITIAL_HISTORY_LOAD = 48;
const HISTORY_MEDIA_HYDRATE_CONCURRENCY = 4;
let deferredHistoryLoadPromise: Promise<void> | null = null;

function needsHistoryPreviewHydration(item: HistoryItem): boolean {
  return !!item.savedPath
    && !item.savedPath.startsWith("memory://")
    && !item.previewBlob
    && !item.imageB64
    && !item.previewUrl;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  };
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function mergeHistoryMediaRef(current: HistoryItem | null, nextById: Map<string, HistoryItem>): HistoryItem | null {
  if (!current) return current;
  const next = nextById.get(current.id);
  return next ? withMediaAssetRef(current, next) : current;
}

export async function hydrateHistoryPreviewRefs(items: HistoryItem[]): Promise<HistoryItem[]> {
  return mapWithConcurrency(items, HISTORY_MEDIA_HYDRATE_CONCURRENCY, async (item) => {
    if (!needsHistoryPreviewHydration(item)) return item;
    try {
      const ref = await materializeMediaRefForHistoryItem(item);
      return withMediaAssetRef(item, ref);
    } catch {
      return item;
    }
  });
}

async function backfillHistoryPreviewRefs(
  store: StateAdapter,
  items: HistoryItem[],
  requestEpoch: number,
): Promise<void> {
  const hydrated = await hydrateHistoryPreviewRefs(items);
  const changed = hydrated.filter((item, index) => item !== items[index]);
  if (
    changed.length === 0
    || !applicationStateEpoch.isCurrent(requestEpoch)
    || store.getState().isResettingApplication
  ) return;
  const changedById = new Map(changed.map((item) => [item.id, item]));
  store.setState((state) => ({
    history: state.history.map((item) => changedById.get(item.id) ?? item),
    batchResults: state.batchResults.map((item) => changedById.get(item.id) ?? item),
    currentImage: mergeHistoryMediaRef(state.currentImage, changedById),
    compareB: mergeHistoryMediaRef(state.compareB, changedById),
    resultDetail: mergeHistoryMediaRef(state.resultDetail, changedById),
  }));
  await persistHistoryItems(changed).catch(() => undefined);
}

function historyLoadDirection(state: StudioState): "oldest" | "newest" {
  return state.historyGalleryOpen && state.historyGallerySort === "oldest" ? "oldest" : "newest";
}

export function getPendingHistoryLoad(): Promise<void> | null {
  return deferredHistoryLoadPromise?.catch(() => undefined) ?? null;
}

async function ensureAllHistoryLoaded(store: StateAdapter): Promise<void> {
  for (let guard = 0; guard < 20 && store.getState().historyHasMore; guard += 1) {
    await store.getState().loadMoreHistory();
    if (store.getState().historyLoading) break;
  }
}

export function createMediaActions(store: StateAdapter) {
  async function transformCurrentImage(
    transform: (path: string) => Promise<{ path: string; acceleration?: string }>,
    successMessage: (result: { path: string; acceleration?: string }) => string,
    failureLabel: string,
  ): Promise<void> {
    const initial = store.getState();
    const workspaceId = initial.activeWorkspaceId;
    let current = initial.currentImage;
    if (!current) {
      initial.pushToast("当前没有图片", "warn");
      return;
    }
    const token = captureWorkspaceAction(workspaceId, "canvas-transform", { supersede: true });
    try {
      current = await materializeHistoryItem(current, {
        setState: scopedMaterializationSetter(store, workspaceId),
      });
      if (!current?.savedPath || !actionIsCurrent(store, token)) return;
      const result = await transform(current.savedPath);
      if (!actionIsCurrent(store, token)) return;
      await loadTransformedAsCurrent(store, result.path, workspaceId, token, current);
      if (actionIsCurrent(store, token)) store.getState().pushToast(successMessage(result), "success");
    } catch (error: any) {
      if (actionIsCurrent(store, token)) {
        store.getState().pushToast(`${failureLabel}:${error?.message ?? error}`, "error");
      }
    } finally {
      settleWorkspaceAction(token, workspaceIds(store.getState()));
    }
  }

  return {
    async setCompareB(item: HistoryItem | null, mode?: CompareMode) {
      if (!item) {
        store.setState({ compareB: null, compareMode: "curtain", compareSplit: 0.5 });
        return;
      }
      const workspaceId = store.getState().activeWorkspaceId;
      const token = captureWorkspaceAction(workspaceId, "select-history-result");
      const full = await ensureFullHistoryItem(item, {
        setState: scopedMaterializationSetter(store, workspaceId),
      });
      if (full && actionIsCurrent(store, token) && store.getState().activeWorkspaceId === workspaceId) {
        store.setState((state) => ({
          compareB: full,
          compareMode: mode ?? state.compareMode ?? "curtain",
          compareSplit: 0.5,
        }));
      }
      settleWorkspaceAction(token, workspaceIds(store.getState()));
    },

    setCompareSplit(v: number) {
      store.setState({ compareSplit: Math.max(0, Math.min(1, v)) });
    },

    openSourcePreview(item: HistoryItem) {
      const state = store.getState();
      const alreadyViewingSource = state.currentImage?.id?.startsWith("source-preview-") === true;
      const returnImage = state.sourcePreviewReturnImage ?? (alreadyViewingSource ? null : state.currentImage);
      store.setState({
        currentImage: item,
        sourcePreviewReturnImage: returnImage,
        resultGridOpen: false,
        historyGalleryOpen: false,
        compareB: null,
        compareMode: "curtain",
        compareSplit: 0.5,
        canvasViewResetTick: state.canvasViewResetTick + 1,
      });
    },

    closeSourcePreview() {
      const state = store.getState();
      const returnImage = state.sourcePreviewReturnImage;
      store.setState({
        currentImage: returnImage ?? null,
        sourcePreviewReturnImage: null,
        resultGridOpen: false,
        historyGalleryOpen: false,
        compareB: null,
        compareMode: "curtain",
        compareSplit: 0.5,
        canvasViewResetTick: state.canvasViewResetTick + 1,
        workspaces: patchWorkspaceRuntime(state.workspaces, state.activeWorkspaceId, {
          currentImageId: returnImage?.id ?? null,
          resultGridOpen: false,
          historyGalleryOpen: false,
        }),
      });
    },

    async openCompareWithPrimarySource(mode: CompareMode = "curtain") {
      const state = store.getState();
      const workspaceId = state.activeWorkspaceId;
      const token = captureWorkspaceAction(workspaceId, "select-history-result");
      const workspace = state.workspaces.find((entry) => entry.id === state.activeWorkspaceId);
      const source = primaryCompareSourceFromCurrentImage(state.currentImage, workspace?.sources ?? []);
      if (!state.currentImage || !source) {
        state.pushToast("当前图片没有可用原图可对比", "warn", 2200);
        return;
      }
      const compareItem = await materializeCompareSourceAsHistoryItem(source, state.currentImage);
      if (!actionIsCurrent(store, token) || store.getState().activeWorkspaceId !== workspaceId) {
        settleWorkspaceAction(token, workspaceIds(store.getState()));
        return;
      }
      if (!compareItem) {
        state.pushToast("当前原图暂时无法载入对比", "warn", 2200);
        return;
      }
      store.setState({ compareB: compareItem, compareMode: mode, compareSplit: 0.5 });
      settleWorkspaceAction(token, workspaceIds(store.getState()));
    },

    openResultGrid() {
      const state = store.getState();
      const workspace = state.workspaces.find((entry) => entry.id === state.activeWorkspaceId);
      const currentImageForGrid = state.currentImage?.id?.startsWith("source-preview-") === true
        ? (state.sourcePreviewReturnImage ?? state.currentImage)
        : state.currentImage;
      const batchTaskViewCount = currentBatchTaskViewCount(
        state.activeWorkspaceId,
        workspace?.batchTaskIds,
        state.batchTasksById,
        state.jobsTotal,
        state.batchResults,
        state.jobGroupsByWorkspace[state.activeWorkspaceId] ?? [],
      );
      if (batchTaskViewCount <= 0) {
        state.pushToast("当前标签页没有可返回的批次预览", "info", 2200);
        return;
      }
      store.setState({
        resultGridOpen: true,
        historyGalleryOpen: false,
        compareB: null,
        compareMode: "curtain",
        sourcePreviewReturnImage: null,
        currentImage: currentImageForGrid ? toPreviewOnlyHistoryItem(currentImageForGrid) : null,
        workspaces: patchWorkspaceRuntime(state.workspaces, state.activeWorkspaceId, {
          batchSinglePreviewOpen: false,
          ...(currentImageForGrid ? { currentImageId: currentImageForGrid.id } : {}),
          resultGridOpen: true,
          historyGalleryOpen: false,
        }),
      });
    },

    closeResultGrid() {
      const state = store.getState();
      store.setState({
        resultGridOpen: false,
        sourcePreviewReturnImage: null,
        currentImage: state.currentImage ? toPreviewOnlyHistoryItem(state.currentImage) : null,
        workspaces: patchWorkspaceRuntime(state.workspaces, state.activeWorkspaceId, {
          batchSinglePreviewOpen: false,
          resultGridOpen: false,
        }),
      });
    },

    selectBatchGridItem(item: HistoryItem) {
      const state = store.getState();
      store.setState({
        currentImage: toPreviewOnlyHistoryItem(item),
        compareB: null,
        compareMode: "curtain",
        sourcePreviewReturnImage: null,
        selectedBatchTaskId: null,
        workspaces: patchWorkspaceRuntime(state.workspaces, state.activeWorkspaceId, {
          currentImageId: item.id,
          selectedBatchTaskId: null,
          batchSinglePreviewOpen: false,
          resultGridOpen: true,
          historyGalleryOpen: false,
        }),
      });
    },

    async selectBatchResult(item: HistoryItem) {
      const state = store.getState();
      const workspaceId = state.activeWorkspaceId;
      const token = captureWorkspaceAction(workspaceId, "select-batch-result", { supersede: true });
      const sourceContextPatch = sourceContextPatchFromHistoryItem(state, item, null);
      store.setState({
        ...sourceContextPatch,
        currentImage: { ...item, previewOnly: false },
        resultGridOpen: false,
        historyGalleryOpen: false,
        historyGallerySinglePreviewId: null,
        compareB: null,
        compareMode: "curtain",
        sourcePreviewReturnImage: null,
        maskDataURL: null,
        annotations: [],
        tool: "pan",
        workspaces: patchWorkspaceRuntime(sourceContextPatch.workspaces, state.activeWorkspaceId, {
          currentImageId: item.id,
          historyGallerySinglePreviewId: null,
          selectedBatchTaskId: null,
          batchSinglePreviewOpen: true,
          resultGridOpen: false,
          historyGalleryOpen: false,
        }),
      });
      if ((sourceContextPatch.sources?.length ?? 0) > 0) {
        void syncSharedEditAutoAspect(store, { workspaceId });
      }
      const selectedId = item.id;
      const full = await ensureFullBatchItem(item, {
        setState: scopedMaterializationSetter(store, workspaceId),
      });
      if (!actionIsCurrent(store, token) || store.getState().activeWorkspaceId !== workspaceId || store.getState().currentImage?.id !== selectedId) {
        settleWorkspaceAction(token, workspaceIds(store.getState()));
        return;
      }
      const current = store.getState();
      const fullSourceContextPatch = sourceContextPatchFromHistoryItem(current, full, null);
      store.setState({
        ...fullSourceContextPatch,
        currentImage: { ...full, previewOnly: false },
        historyGallerySinglePreviewId: null,
        workspaces: patchWorkspaceRuntime(fullSourceContextPatch.workspaces, current.activeWorkspaceId, {
          currentImageId: selectedId,
          historyGallerySinglePreviewId: null,
          selectedBatchTaskId: null,
          batchSinglePreviewOpen: true,
          resultGridOpen: false,
          historyGalleryOpen: false,
        }),
      });
      if ((fullSourceContextPatch.sources?.length ?? 0) > 0) {
        void syncSharedEditAutoAspect(store, { workspaceId });
      }
      settleWorkspaceAction(token, workspaceIds(store.getState()));
    },

    async openHistoryGallery() {
      const state = store.getState();
      if (state.history.length === 0) {
        state.pushToast("暂无历史图片可查看", "warn", 2200);
        return;
      }
      store.setState({
        historyGalleryOpen: true,
        resultGridOpen: false,
        compareB: null,
        compareMode: "curtain",
        sourcePreviewReturnImage: null,
        currentImage: state.currentImage ? toPreviewOnlyHistoryItem(state.currentImage) : null,
        workspaces: patchWorkspaceRuntime(state.workspaces, state.activeWorkspaceId, {
          batchSinglePreviewOpen: false,
          historyGalleryOpen: true,
          resultGridOpen: false,
        }),
      });
    },

    closeHistoryGallery() {
      const state = store.getState();
      store.setState({
        historyGalleryOpen: false,
        currentImage: state.currentImage ? toPreviewOnlyHistoryItem(state.currentImage) : null,
        workspaces: patchWorkspaceRuntime(state.workspaces, state.activeWorkspaceId, {
          batchSinglePreviewOpen: false,
          historyGalleryOpen: false,
        }),
      });
    },

    closeHistoryGalleryToEmpty() {
      const state = store.getState();
      const clearedAt = Date.now();
      const batchTasksById = Object.fromEntries(
        Object.entries(state.batchTasksById).filter(([, task]) => task.workspaceId !== state.activeWorkspaceId),
      );
      store.setState({
        historyGalleryOpen: false,
        resultGridOpen: false,
        historyGallerySinglePreviewId: null,
        currentImage: null,
        sourcePreviewReturnImage: null,
        batchResults: [],
        compareB: null,
        compareMode: "curtain",
        maskDataURL: null,
        annotations: [],
        strokes: [],
        selectedAnnotationId: null,
        undoStack: [],
        redoStack: [],
        tool: "pan",
        selectedBatchTaskId: null,
        batchTasksById,
        jobGroupsByWorkspace: { ...state.jobGroupsByWorkspace, [state.activeWorkspaceId]: [] },
        runningJobs: [],
        jobsTotal: 0,
        jobsCompleted: 0,
        jobsFailed: 0,
        progress: null,
        streamPreview: null,
        streamPreviews: {},
        lastLogLine: "",
        errorMessage: null,
        errorRawPath: null,
        lastPayload: null,
        canvasViewResetTick: state.canvasViewResetTick + 1,
        workspaces: patchWorkspaceRuntime(state.workspaces, state.activeWorkspaceId, {
          currentImageId: null,
          historyGallerySinglePreviewId: null,
          batchResultIds: [],
          batchTaskIds: [],
          clearedJobGroupsBefore: clearedAt,
          selectedBatchTaskId: null,
          batchSinglePreviewOpen: false,
          historyGalleryOpen: false,
          resultGridOpen: false,
          runningJobs: [],
          jobsTotal: 0,
          jobsCompleted: 0,
          jobsFailed: 0,
          progress: null,
          streamPreview: null,
          streamPreviews: {},
          lastLogLine: "",
          errorMessage: null,
          errorRawPath: null,
          lastPayload: null,
        }),
      });
    },

    setHistoryGallerySort(value: HistoryGallerySort) {
      const normalized: HistoryGallerySort = value === "oldest" ? "oldest" : "newest";
      const state = store.getState();
      store.setState({
        historyGallerySort: normalized,
        historyCursor: null,
        historyHasMore: true,
        workspaces: patchWorkspaceRuntime(state.workspaces, state.activeWorkspaceId, {
          historyGallerySort: normalized,
        }),
      });
      void store.getState().loadMoreHistory();
    },

    selectHistoryGalleryGridItem(item: HistoryItem) {
      const state = store.getState();
      store.setState({
        currentImage: toPreviewOnlyHistoryItem(item),
        historyGallerySinglePreviewId: null,
        compareB: null,
        compareMode: "curtain",
        sourcePreviewReturnImage: null,
        selectedBatchTaskId: null,
        workspaces: patchWorkspaceRuntime(state.workspaces, state.activeWorkspaceId, {
          currentImageId: item.id,
          historyGallerySinglePreviewId: null,
          selectedBatchTaskId: null,
          batchSinglePreviewOpen: false,
          historyGalleryOpen: true,
          resultGridOpen: false,
        }),
      });
    },

    async selectHistoryGalleryResult(item: HistoryItem) {
      const state = store.getState();
      const workspaceId = state.activeWorkspaceId;
      const token = captureWorkspaceAction(workspaceId, "select-history-result", { supersede: true });
      const sourceContextPatch = sourceContextPatchFromHistoryItem(state, item, null);
      store.setState({
        ...sourceContextPatch,
        currentImage: { ...item, previewOnly: false },
        historyGalleryOpen: false,
        historyGallerySinglePreviewId: item.id,
        resultGridOpen: false,
        compareB: null,
        compareMode: "curtain",
        sourcePreviewReturnImage: null,
        maskDataURL: null,
        annotations: [],
        tool: "pan",
        workspaces: patchWorkspaceRuntime(sourceContextPatch.workspaces, state.activeWorkspaceId, {
          currentImageId: item.id,
          historyGallerySinglePreviewId: item.id,
          selectedBatchTaskId: null,
          batchSinglePreviewOpen: false,
          historyGalleryOpen: false,
          resultGridOpen: false,
        }),
      });
      if ((sourceContextPatch.sources?.length ?? 0) > 0) {
        void syncSharedEditAutoAspect(store, { workspaceId });
      }
      const selectedId = item.id;
      const full = await ensureFullHistoryItem(item, {
        setState: scopedMaterializationSetter(store, workspaceId),
      });
      if (!actionIsCurrent(store, token) || store.getState().activeWorkspaceId !== workspaceId || store.getState().currentImage?.id !== selectedId) {
        settleWorkspaceAction(token, workspaceIds(store.getState()));
        return;
      }
      const current = store.getState();
      const resolved = full ?? item;
      const fullSourceContextPatch = sourceContextPatchFromHistoryItem(current, resolved, null);
      store.setState({
        ...fullSourceContextPatch,
        currentImage: { ...resolved, previewOnly: false },
        historyGallerySinglePreviewId: selectedId,
        workspaces: patchWorkspaceRuntime(fullSourceContextPatch.workspaces, current.activeWorkspaceId, {
          currentImageId: selectedId,
          historyGallerySinglePreviewId: selectedId,
          selectedBatchTaskId: null,
          batchSinglePreviewOpen: false,
          historyGalleryOpen: false,
          resultGridOpen: false,
        }),
      });
      if ((fullSourceContextPatch.sources?.length ?? 0) > 0) {
        void syncSharedEditAutoAspect(store, { workspaceId });
      }
      settleWorkspaceAction(token, workspaceIds(store.getState()));
    },

    pushToast(text: string, kind: Toast["kind"] = "info", ttl = 3500, action?: Toast["action"]) {
      const now = Date.now();
      const dedupeKey = `${kind}|${text}|${action?.label ?? ""}`;
      const lastShownAt = toastLastShownAt.get(dedupeKey) ?? 0;
      const alreadyVisible = store.getState().toasts.some((toast) => (
        toast.text === text
        && toast.kind === kind
        && (toast.action?.label ?? "") === (action?.label ?? "")
      ));
      if (alreadyVisible || now - lastShownAt < TOAST_DEDUPE_MS) return;
      toastLastShownAt.set(dedupeKey, now);
      const id = genId();
      const toast: Toast = { id, text, kind, createdAt: now, ttl, action };
      store.setState((state) => ({ toasts: [...state.toasts, toast] }));
      if (ttl > 0) {
        setTimeout(() => {
          store.setState((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
        }, ttl);
      }
    },

    dismissToast(id: string) {
      store.setState((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    },

    async openResultDetail(item: HistoryItem) {
      const preview = toPreviewOnlyHistoryItem(item);
      store.setState({ resultDetail: preview });
      const full = await ensureFullHistoryItem(preview, {
        setState: (fn) => store.setState((state) => fn(state)),
      }).catch(() => null);
      if (!full || full.id !== item.id) return;
      store.setState((state) => (
        state.resultDetail?.id === item.id ? { resultDetail: full } : {}
      ));
    },

    closeResultDetail() {
      store.setState({ resultDetail: null });
    },

    async openPanoramaViewer(item: HistoryItem) {
      store.setState({ panoramaViewerItem: item });
      const full = await ensureFullHistoryItem(item, {
        setState: (fn) => store.setState((state) => fn(state)),
      }).catch(() => null);
      if (!full || full.id !== item.id) return;
      store.setState((state) => (
        state.panoramaViewerItem?.id === item.id
          ? { panoramaViewerItem: full }
          : {}
      ));
    },

    closePanoramaViewer() {
      store.setState({ panoramaViewerItem: null });
    },

    async materializeCurrentImage(item: HistoryItem) {
      const workspaceId = store.getState().activeWorkspaceId;
      const token = captureWorkspaceAction(workspaceId, "select-history-result");
      const full = await ensureFullHistoryItem(item, {
        setState: scopedMaterializationSetter(store, workspaceId),
      });
      settleWorkspaceAction(token, workspaceIds(store.getState()));
      return full ?? item;
    },

    async loadMoreHistory() {
      const initial = store.getState();
      if (initial.isResettingApplication) return;
      if (deferredHistoryLoadPromise) return deferredHistoryLoadPromise;
      if (!initial.historyHasMore || initial.historyLoading) return;

      const requestEpoch = applicationStateEpoch.capture();
      const direction = historyLoadDirection(initial);
      const cursor = initial.historyCursor?.direction === direction ? initial.historyCursor : null;
      store.setState({ historyLoading: true });
      deferredHistoryLoadPromise = (async () => {
        try {
          const nextPage = await loadHistoryPage({
            cursor,
            limit: INITIAL_HISTORY_LOAD,
            direction,
          });
          if (
            !applicationStateEpoch.isCurrent(requestEpoch)
            || store.getState().isResettingApplication
          ) return;

          let accepted = false;
          let incoming: HistoryItem[] = [];
          let repaired: HistoryItem[] = [];
          store.setState((live) => {
            if (
              live.isResettingApplication
              || historyLoadDirection(live) !== direction
              || !applicationStateEpoch.isCurrent(requestEpoch)
            ) return {};
            const existing = new Set(live.history.map((item) => item.id));
            incoming = nextPage.items.filter((item) => !existing.has(item.id));
            const recovered = recoverPanoramaHistoryMetadata(
              trimHistory([...live.history, ...incoming].sort((a, b) => b.createdAt - a.createdAt)),
              live.batchTasksById,
            );
            accepted = true;
            repaired = recovered.repaired;
            return {
              history: recovered.items,
              historyHasMore: !!nextPage.nextCursor,
              historyCursor: nextPage.nextCursor,
            };
          });
          if (!accepted) return;
          await Promise.all([
            repaired.length > 0 ? persistHistoryItems(repaired) : Promise.resolve(),
            backfillHistoryPreviewRefs(store, incoming, requestEpoch),
          ]);
        } catch (error) {
          if (typeof console !== "undefined") console.warn("load more history failed", error);
        } finally {
          deferredHistoryLoadPromise = null;
          const current = store.getState();
          if (applicationStateEpoch.isCurrent(requestEpoch)) {
            store.setState({ historyLoading: false });
          }
          if (
            applicationStateEpoch.isCurrent(requestEpoch)
            && !current.isResettingApplication
            && current.historyHasMore
            && historyLoadDirection(current) !== direction
          ) {
            queueMicrotask(() => void store.getState().loadMoreHistory());
          }
        }
      })();
      return deferredHistoryLoadPromise;
    },

    setHistoryRailCollapsed(collapsed: boolean) {
      store.setState({ historyRailCollapsed: collapsed });
    },

    openHistoryTimeline() {
      store.setState({ historyTimelineOpen: true });
    },

    closeHistoryTimeline() {
      store.setState({ historyTimelineOpen: false });
    },

    async pruneHistoryOlderThanDays(days: number) {
      await ensureAllHistoryLoaded(store);
      const cutoff = Date.now() - days * 24 * 3600 * 1000;
      const state = store.getState();
      const kept = state.history.filter((item) => item.createdAt >= cutoff);
      const removed = state.history.length - kept.length;
      if (removed <= 0) return 0;
      const keepIds = new Set(kept.map((item) => item.id));
      const nextBatchResults = state.batchResults.filter((item) => keepIds.has(item.id));
      const nextWorkspaces = state.workspaces.map((w) => ({
        ...w,
        currentImageId: w.currentImageId && keepIds.has(w.currentImageId) ? w.currentImageId : null,
        batchResultIds: (w.batchResultIds ?? []).filter((id) => keepIds.has(id)),
        resultGridOpen: (w.batchResultIds ?? []).filter((id) => keepIds.has(id)).length > 1 ? w.resultGridOpen : false,
        historyGalleryOpen: kept.length > 0 ? w.historyGalleryOpen : false,
      }));
      store.setState({
        history: kept,
        currentImage: state.currentImage && keepIds.has(state.currentImage.id) ? state.currentImage : null,
        compareB: state.compareB && keepIds.has(state.compareB.id) ? state.compareB : null,
        resultDetail: state.resultDetail && keepIds.has(state.resultDetail.id) ? state.resultDetail : null,
        panoramaViewerItem: state.panoramaViewerItem && keepIds.has(state.panoramaViewerItem.id) ? state.panoramaViewerItem : null,
        panoramaAlignTarget: state.panoramaAlignTarget && keepIds.has(state.panoramaAlignTarget.id) ? state.panoramaAlignTarget : null,
        batchResults: nextBatchResults,
        resultGridOpen: nextBatchResults.length > 1 && state.resultGridOpen,
        historyGalleryOpen: kept.length > 0 && state.historyGalleryOpen,
        workspaces: nextWorkspaces,
      });
      await pruneHistoryStorage(kept.map((item) => item.id));
      return removed;
    },

    async rotateCurrent(degrees: number) {
      await transformCurrentImage(
        (path) => RotateImage(path, degrees),
        (result) => `已旋转 ${degrees}° · ${result.acceleration ?? "native"}`,
        "旋转失败",
      );
    },

    async flipCurrent(horizontal: boolean) {
      await transformCurrentImage(
        (path) => FlipImage(path, horizontal),
        (result) => `${horizontal ? "已水平翻转" : "已竖直翻转"} · ${result.acceleration ?? "native"}`,
        "翻转失败",
      );
    },

    async cropToRect(x: number, y: number, w: number, h: number) {
      await transformCurrentImage(
        (path) => CropImage(path, Math.round(x), Math.round(y), Math.round(w), Math.round(h)),
        (result) => `已裁出 ${Math.round(w)}×${Math.round(h)} · ${result.acceleration ?? "native"}`,
        "裁剪失败",
      );
    },

    savePreset(name: string) {
      const state = store.getState();
      const trimmed = name.trim();
      if (!trimmed) return;
      const preset: Preset = {
        id: genId(),
        name: trimmed,
        size: state.size,
        quality: state.quality,
        outputFormat: state.outputFormat,
        negativePrompt: state.negativePrompt,
        batchCount: state.batchCount,
      };
      const next = [...state.presets, preset];
      store.setState({ presets: next });
      try { localStorage.setItem(storageKey("gptcodex.presets"), JSON.stringify(next)); } catch {}
      store.getState().pushToast(`已保存预设「${trimmed}」`, "success");
    },

    applyPreset(id: string) {
      const preset = store.getState().presets.find((x) => x.id === id);
      if (!preset) return;
      store.setState({
        size: preset.size,
        quality: preset.quality,
        outputFormat: preset.outputFormat ?? store.getState().outputFormat,
        negativePrompt: preset.negativePrompt,
        batchCount: preset.batchCount,
      });
      store.getState().pushToast(`已应用预设「${preset.name}」`, "success");
    },

    deletePreset(id: string) {
      const next = store.getState().presets.filter((preset) => preset.id !== id);
      store.setState({ presets: next });
      try { localStorage.setItem(storageKey("gptcodex.presets"), JSON.stringify(next)); } catch {}
    },

    async exportHistory() {
      await ensureAllHistoryLoaded(store);
      const state = store.getState();
      if (state.history.length === 0) {
        state.pushToast("没有可导出的历史记录", "warn");
        return;
      }
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        count: state.history.length,
        items: state.history.map(sanitizeHistoryForExport),
      };
      try {
        const dst = await exportHistoryForPlatform(JSON.stringify(payload, null, 2), ExportHistoryToFile);
        if (dst) state.pushToast(`已导出 ${state.history.length} 条 → ${dst.split(/[\\/]/).pop()}`, "success");
      } catch (e: any) {
        state.pushToast(`导出失败:${e?.message ?? e}`, "error");
      }
    },

    async importHistory() {
      const state = store.getState();
      try {
        const json = await ImportHistoryFromFile();
        if (!json) return;
        const parsed = JSON.parse(json);
        const incoming: HistoryItem[] = Array.isArray(parsed?.items) ? parsed.items : [];
        if (incoming.length === 0) {
          state.pushToast("文件里没有历史记录", "warn");
          return;
        }
        const existing = new Set(state.history.map((h) => h.id));
        const merged = [...state.history];
        const toPersist: HistoryItem[] = [];
        let added = 0;
        for (const item of incoming) {
          if (!item.id || existing.has(item.id)) continue;
          if (!item.createdAt) continue;
          const hasRenderableImage = !!(item.previewUrl || item.previewBlob || item.imageB64 || item.savedPath);
          if (!hasRenderableImage) continue;
          let safeItem = sanitizeImportedHistoryItem(item);
          if (safeItem.savedPath && !safeItem.previewUrl) {
            try {
              const ref = await materializeMediaRefForHistoryItem(safeItem);
              safeItem = withMediaAssetRef(safeItem, ref);
            } catch {
              // Keep the metadata/legacy preview if the file is unavailable in this environment.
            }
          }
          merged.push(safeItem);
          toPersist.push(safeItem);
          added++;
        }
        merged.sort((a, b) => b.createdAt - a.createdAt);
        const trimmed = trimHistory(merged);
        store.setState({ history: trimmed });
        await persistHistoryItems(toPersist).catch(() => undefined);
        persistTrimmedHistory(trimmed);
        state.pushToast(`已导入 ${added} 条(跳过 ${incoming.length - added} 条重复/无效)`, "success");
      } catch (e: any) {
        state.pushToast(`导入失败:${e?.message ?? e}`, "error");
      }
    },
  };
}

async function loadTransformedAsCurrent(
  store: StateAdapter,
  path: string,
  workspaceId: string,
  token: WorkspaceActionToken,
  sourceCurrent: HistoryItem,
) {
  const snapshot = store.getState();
  try {
    const baseName = path.split(/[\\/]/).pop() ?? "transformed.png";
    const ref = await RegisterImportedImageAsset(path).catch(() => null);
    if (!actionIsCurrent(store, token)) return;
    const fallbackB64 = ref ? "" : await ReadImageAsBase64(path).catch(() => "");
    if (!actionIsCurrent(store, token)) return;
    const workspace = store.getState().workspaces.find((entry) => entry.id === workspaceId);
    if (!workspace) return;
    const updated: HistoryItem = sourceCurrent
      ? withMediaAssetRef({
          ...sourceCurrent,
          imageB64: fallbackB64 || undefined,
          imageBlob: null,
          previewBlob: null,
          savedPath: path,
          previewOnly: !fallbackB64,
        }, ref ?? {})
      : {
          id: genId(),
          ...(ref ? {
            imageId: ref.imageId,
            previewUrl: ref.previewUrl,
            previewWidth: ref.previewWidth,
            previewHeight: ref.previewHeight,
            previewOnly: true,
          } : {
            imageB64: fallbackB64,
            previewOnly: false,
          }),
          imageBlob: null,
          previewBlob: null,
          prompt: `(变换)${baseName}`,
          mode: "edit",
          size: workspace.size,
          quality: workspace.quality,
          createdAt: Date.now(),
          savedPath: path,
        };
    const nextSources = workspace.sources.length > 0
      ? [{
          path,
          name: baseName,
          size: 0,
          previewUrl: updated.previewUrl,
          imageB64: updated.previewUrl ? undefined : updated.imageB64,
          imageBlob: null,
        }, ...workspace.sources.slice(1)]
      : [{
          path,
          name: baseName,
          size: 0,
          previewUrl: updated.previewUrl,
          imageB64: updated.previewUrl ? undefined : updated.imageB64,
          imageBlob: null,
        }];
    store.setState((state) => scopedWorkspacePatch(state, workspaceId, {
      currentImageId: updated.id,
      sources: nextSources,
      mode: "edit",
    }, {
      currentImage: updated,
      sources: nextSources,
      mode: "edit",
      maskDataURL: null,
      strokes: [],
      annotations: [],
      canvasViewResetTick: snapshot.canvasViewResetTick + 1,
    }));
  } catch (e: any) {
    if (actionIsCurrent(store, token)) {
      store.getState().pushToast(`加载变换结果失败:${e?.message ?? e}`, "error");
    }
  }
}
