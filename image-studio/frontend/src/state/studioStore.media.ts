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
import { base64ToBlob } from "../lib/images";
import { persistHistoryItems, pruneHistoryStorage } from "../lib/storage";
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
import { patchWorkspaceRuntime } from "./workspaceRuntime";
import { syncSharedEditAutoAspect } from "./sharedEditAutoAspect";

type StateAdapter = {
  getState: () => StudioState;
  setState: (patch: Partial<StudioState> | ((state: StudioState) => Partial<StudioState>)) => void;
};

const TOAST_DEDUPE_MS = 6000;
const toastLastShownAt = new Map<string, number>();

async function ensureAllHistoryLoaded(store: StateAdapter): Promise<void> {
  for (let guard = 0; guard < 20 && store.getState().historyHasMore; guard += 1) {
    await store.getState().loadMoreHistory();
    if (store.getState().historyLoading) break;
  }
}

export function createMediaActions(store: StateAdapter) {
  return {
    async setCompareB(item: HistoryItem | null, mode?: CompareMode) {
      if (!item) {
        store.setState({ compareB: null, compareMode: "curtain", compareSplit: 0.5 });
        return;
      }
      const full = await ensureFullHistoryItem(item, {
        setState: (fn) => store.setState((state) => fn(state)),
      });
      if (full) {
        store.setState((state) => ({
          compareB: full,
          compareMode: mode ?? state.compareMode ?? "curtain",
          compareSplit: 0.5,
        }));
      }
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
      const workspace = state.workspaces.find((entry) => entry.id === state.activeWorkspaceId);
      const source = primaryCompareSourceFromCurrentImage(state.currentImage, workspace?.sources ?? []);
      if (!state.currentImage || !source) {
        state.pushToast("当前图片没有可用原图可对比", "warn", 2200);
        return;
      }
      const compareItem = await materializeCompareSourceAsHistoryItem(source, state.currentImage);
      if (!compareItem) {
        state.pushToast("当前原图暂时无法载入对比", "warn", 2200);
        return;
      }
      store.setState({ compareB: compareItem, compareMode: mode, compareSplit: 0.5 });
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
        void syncSharedEditAutoAspect(store);
      }
      const selectedId = item.id;
      const full = await ensureFullBatchItem(item, {
        setState: (fn) => store.setState((state) => fn(state)),
      });
      if (store.getState().currentImage?.id !== selectedId) return;
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
        void syncSharedEditAutoAspect(store);
      }
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
        void syncSharedEditAutoAspect(store);
      }
      const selectedId = item.id;
      const full = await ensureFullHistoryItem(item, {
        setState: (fn) => store.setState((current) => fn(current)),
      });
      if (store.getState().currentImage?.id !== selectedId) return;
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
        void syncSharedEditAutoAspect(store);
      }
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
      const full = await ensureFullHistoryItem(item, {
        setState: (fn) => store.setState((state) => fn(state)),
      });
      return full ?? item;
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
      let current = store.getState().currentImage;
      if (!current) {
        store.getState().pushToast("当前没有图片", "warn");
        return;
      }
      current = await materializeHistoryItem(current, {
        setState: (fn) => store.setState((state) => fn(state)),
      }).catch((e: any) => {
        store.getState().pushToast(`当前图无法落盘:${e?.message ?? e}`, "error");
        return null;
      });
      if (!current?.savedPath) return;
      try {
        const result = await RotateImage(current.savedPath, degrees);
        await loadTransformedAsCurrent(store, result.path);
        store.getState().pushToast(`已旋转 ${degrees}° · ${result.acceleration ?? "native"}`, "success");
      } catch (e: any) {
        store.getState().pushToast(`旋转失败:${e?.message ?? e}`, "error");
      }
    },

    async flipCurrent(horizontal: boolean) {
      let current = store.getState().currentImage;
      if (!current) {
        store.getState().pushToast("当前没有图片", "warn");
        return;
      }
      current = await materializeHistoryItem(current, {
        setState: (fn) => store.setState((state) => fn(state)),
      }).catch((e: any) => {
        store.getState().pushToast(`当前图无法落盘:${e?.message ?? e}`, "error");
        return null;
      });
      if (!current?.savedPath) return;
      try {
        const result = await FlipImage(current.savedPath, horizontal);
        await loadTransformedAsCurrent(store, result.path);
        store.getState().pushToast(`${horizontal ? "已水平翻转" : "已竖直翻转"} · ${result.acceleration ?? "native"}`, "success");
      } catch (e: any) {
        store.getState().pushToast(`翻转失败:${e?.message ?? e}`, "error");
      }
    },

    async cropToRect(x: number, y: number, w: number, h: number) {
      let current = store.getState().currentImage;
      if (!current) {
        store.getState().pushToast("当前没有图片", "warn");
        return;
      }
      current = await materializeHistoryItem(current, {
        setState: (fn) => store.setState((state) => fn(state)),
      }).catch((e: any) => {
        store.getState().pushToast(`当前图无法落盘:${e?.message ?? e}`, "error");
        return null;
      });
      if (!current?.savedPath) return;
      try {
        const result = await CropImage(current.savedPath, Math.round(x), Math.round(y), Math.round(w), Math.round(h));
        await loadTransformedAsCurrent(store, result.path);
        store.getState().pushToast(`已裁出 ${Math.round(w)}×${Math.round(h)} · ${result.acceleration ?? "native"}`, "success");
      } catch (e: any) {
        store.getState().pushToast(`裁剪失败:${e?.message ?? e}`, "error");
      }
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

async function loadTransformedAsCurrent(store: StateAdapter, path: string) {
  const snapshot = store.getState();
  try {
    const baseName = path.split(/[\\/]/).pop() ?? "transformed.png";
    const ref = await RegisterImportedImageAsset(path).catch(() => null);
    const fallbackB64 = ref ? "" : await ReadImageAsBase64(path).catch(() => "");
    const current = snapshot.currentImage;
    const updated: HistoryItem = current
      ? withMediaAssetRef({
          ...current,
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
          size: snapshot.size,
          quality: snapshot.quality,
          createdAt: Date.now(),
          savedPath: path,
        };
    const nextSources = snapshot.sources.length > 0
      ? [{
          path,
          name: baseName,
          size: 0,
          previewUrl: updated.previewUrl,
          imageB64: updated.previewUrl ? undefined : updated.imageB64,
          imageBlob: null,
        }, ...snapshot.sources.slice(1)]
      : [{
          path,
          name: baseName,
          size: 0,
          previewUrl: updated.previewUrl,
          imageB64: updated.previewUrl ? undefined : updated.imageB64,
          imageBlob: null,
        }];
    store.setState({
      currentImage: updated,
      sources: nextSources,
      mode: "edit",
      maskDataURL: null,
      strokes: [],
      annotations: [],
      canvasViewResetTick: snapshot.canvasViewResetTick + 1,
    });
  } catch (e: any) {
    store.getState().pushToast(`加载变换结果失败:${e?.message ?? e}`, "error");
  }
}
