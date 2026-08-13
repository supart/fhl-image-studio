import {
  CropImage,
  ExportHistoryToFile,
  FlipImage,
  ImportHistoryFromFile,
  RegisterImportedImageAsset,
  RegisterMediaAsset,
  ReadImageAsBase64,
  RotateImage,
} from "../platform/runtime/host";
import { exportHistoryForPlatform } from "../platform/android/bridge";
import {
  sanitizeHistoryForExport,
  sanitizeImportedHistoryItem,
} from "../lib/security";
import { base64ToBlob } from "../lib/images";
import { persistHistoryItems } from "../lib/storage";
import { storageKey } from "../lib/storageNamespace.ts";
import type { HistoryItem, Preset, Toast } from "../types/domain";
import type { StudioState } from "./studioStore.types";
import {
  ensureAllHistoryLoaded,
  historyItemsAtOrAfter,
} from "./historyOperations.ts";
import {
  genId,
  persistTrimmedHistory,
  trimHistory,
} from "./studioStore.shared";
import {
  ensureFullBatchItem,
  ensureFullHistoryItem,
  materializeHistoryItem,
  toPreviewOnlyHistoryItem,
  withMediaAssetRef,
} from "./studioStore.runtime";
import { patchWorkspaceRuntime } from "./workspaceRuntime";

type StateAdapter = {
  getState: () => StudioState;
  setState: (patch: Partial<StudioState> | ((state: StudioState) => Partial<StudioState>)) => void;
};

export function createMediaActions(store: StateAdapter) {
  return {
    async setCompareB(item: HistoryItem | null) {
      if (!item) {
        store.setState({ compareB: null, compareSplit: 0.5 });
        return;
      }
      const full = await ensureFullHistoryItem(item, {
        setState: (fn) => store.setState((state) => fn(state)),
      });
      if (full) store.setState({ compareB: full, compareSplit: 0.5 });
    },

    setCompareSplit(v: number) {
      store.setState({ compareSplit: Math.max(0, Math.min(1, v)) });
    },

    openResultGrid() {
      const state = store.getState();
      if (Math.max(state.jobsTotal, state.batchResults.length) <= 1) return;
      store.setState({
        resultGridOpen: true,
        compareB: null,
        currentImage: state.currentImage ? toPreviewOnlyHistoryItem(state.currentImage) : null,
        workspaces: patchWorkspaceRuntime(state.workspaces, state.activeWorkspaceId, { resultGridOpen: true }),
      });
    },

    closeResultGrid() {
      const state = store.getState();
      store.setState({
        resultGridOpen: false,
        currentImage: state.currentImage ? toPreviewOnlyHistoryItem(state.currentImage) : null,
        workspaces: patchWorkspaceRuntime(state.workspaces, state.activeWorkspaceId, { resultGridOpen: false }),
      });
    },

    async selectBatchResult(item: HistoryItem) {
      const full = await ensureFullBatchItem(item, {
        setState: (fn) => store.setState((state) => fn(state)),
      });
      const state = store.getState();
      store.setState({
        currentImage: { ...full, previewOnly: false },
        resultGridOpen: false,
        compareB: null,
        maskDataURL: null,
        annotations: [],
        tool: "pan",
        workspaces: patchWorkspaceRuntime(state.workspaces, state.activeWorkspaceId, {
          currentImageId: full.id,
          resultGridOpen: false,
        }),
      });
    },

    pushToast(text: string, kind: Toast["kind"] = "info", ttl = 3500, action?: Toast["action"]) {
      const id = genId();
      const toast: Toast = { id, text, kind, createdAt: Date.now(), ttl, action };
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
      store.setState({ resultDetail: toPreviewOnlyHistoryItem(item) });
    },

    closeResultDetail() {
      store.setState({ resultDetail: null });
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
      await ensureAllHistoryLoaded(store.getState);
      const cutoff = Date.now() - days * 24 * 3600 * 1000;
      const state = store.getState();
      const kept = historyItemsAtOrAfter(state.history, cutoff);
      const removed = state.history.length - kept.length;
      if (removed <= 0) return 0;
      const keepIds = new Set(kept.map((item) => item.id));
      const nextBatchResults = state.batchResults.filter((item) => keepIds.has(item.id));
      const nextWorkspaces = state.workspaces.map((w) => ({
        ...w,
        currentImageId: w.currentImageId && keepIds.has(w.currentImageId) ? w.currentImageId : null,
        batchResultIds: (w.batchResultIds ?? []).filter((id) => keepIds.has(id)),
        resultGridOpen: (w.batchResultIds ?? []).filter((id) => keepIds.has(id)).length > 1 ? w.resultGridOpen : false,
      }));
      store.setState({
        history: kept,
        currentImage: state.currentImage && keepIds.has(state.currentImage.id) ? state.currentImage : null,
        compareB: state.compareB && keepIds.has(state.compareB.id) ? state.compareB : null,
        resultDetail: state.resultDetail && keepIds.has(state.resultDetail.id) ? state.resultDetail : null,
        batchResults: nextBatchResults,
        resultGridOpen: nextBatchResults.length > 1 && state.resultGridOpen,
        workspaces: nextWorkspaces,
      });
      await persistTrimmedHistory(kept, true);
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
      let state = store.getState();
      try {
        await ensureAllHistoryLoaded(store.getState);
        state = store.getState();
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
              const ref = safeItem.thumbPath
                ? await RegisterMediaAsset(safeItem.savedPath, safeItem.thumbPath)
                : await RegisterImportedImageAsset(safeItem.savedPath);
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
        void persistTrimmedHistory(trimmed);
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
