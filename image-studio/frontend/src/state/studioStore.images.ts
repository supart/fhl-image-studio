import {
  ChooseBatchInputDir,
  ChooseBatchOutputDir,
  ImportImageFromB64,
  ListBatchInputImages,
  OpenImageDialog,
  OpenImagesDialog,
  RegisterImportedImageAsset,
  SaveImageAs,
  SaveImagePathAs,
  ShareImageAs,
  ShareImagePathAs,
} from "../platform/runtime/host";
import { shareImageForPlatform, shareImagePathForPlatform, saveImageForPlatform } from "../platform/android/bridge";
import { base64ToBlob } from "../lib/images";
import { suggestImageFileName, suggestManualSaveImageFileName } from "../lib/imageFileNames";
import { persistHistoryItem, removeHistoryItem } from "../lib/storage";
import { buildPanoramaProjectRef, isLikelyPanoramaItem } from "../panorama/core";
import type { HistoryItem, SourceImage } from "../types/domain";
import type { StudioState } from "./studioStore.types";
import { sourceImagesFromHistoryItem } from "./historySourceImages";
import {
  persistMaterialGroups,
  removeHistoryRefsFromMaterialGroups,
} from "./materialLibrary";
import {
  ensureFullHistoryItem,
  fileToBase64,
  materializeHistoryItem,
  toPreviewOnlyHistoryItem,
  withMediaAssetRef,
} from "./studioStore.runtime";
import { patchWorkspaceRuntime } from "./workspaceRuntime";
import { genId, persistTrimmedHistory, trimHistory } from "./studioStore.shared";
import {
  setSharedEditAutoAspectLock,
  syncSharedEditAutoAspect,
} from "./sharedEditAutoAspect";

type StateAdapter = {
  getState: () => StudioState;
  setState: (patch: Partial<StudioState> | ((state: StudioState) => Partial<StudioState>)) => void;
};

type ImportImageFileOptions = {
  forcePanorama?: boolean;
};

function directoryFromPath(filePath: string): string {
  const normalized = String(filePath || "").trim();
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return index >= 0 ? normalized.slice(0, index) : "";
}

function commonDirectoryFromPaths(paths: string[]): string {
  const dirs = Array.from(new Set(paths.map(directoryFromPath).filter(Boolean)));
  return dirs.length === 1 ? dirs[0] : "";
}

function editSourceModeAfterReferenceUpdate(current: StudioState["editSourceMode"]): StudioState["editSourceMode"] {
  return current === "batch" ? "batch" : "manual";
}

export function createImageActions(store: StateAdapter) {
  async function materializeForShare(item: HistoryItem): Promise<HistoryItem> {
    return await ensureFullHistoryItem(item, {
      setState: (fn) => store.setState((state) => fn(state)),
    }) ?? item;
  }

  function mapBatchSource(source: {
    path: string;
    name: string;
    size: number;
    width?: number;
    height?: number;
    previewUrl?: string;
    previewWidth?: number;
    previewHeight?: number;
  }, selected = true) {
    return {
      path: source.path,
      name: source.name,
      size: source.size,
      width: source.width,
      height: source.height,
      previewUrl: source.previewUrl,
      previewWidth: source.previewWidth,
      previewHeight: source.previewHeight,
      selected,
    };
  }

  async function shareHistoryImage(item: HistoryItem) {
    const full = await materializeForShare(item);
    const suggested = suggestImageFileName({
      prompt: full.prompt,
      createdAt: full.createdAt,
      outputFormat: full.outputFormat,
    });
    const path = String(full.savedPath || "").trim();
    if (path) {
      await shareImagePathForPlatform(path, suggested, ShareImagePathAs);
      return;
    }
    const imageB64 = String(full.imageB64 || "").trim();
    if (!imageB64) throw new Error("没有可分享的图片");
    await shareImageForPlatform(imageB64, suggested, ShareImageAs);
  }

  async function saveHistoryImageToAlbum(item: HistoryItem) {
    const full = await materializeForShare(item);
    const suggested = suggestManualSaveImageFileName({
      prompt: full.prompt,
      outputFormat: full.outputFormat,
    });
    const path = String(full.savedPath || "").trim();
    if (path) {
      return await SaveImagePathAs(path, suggested);
    }
    const imageB64 = String(full.imageB64 || "").trim();
    if (!imageB64) throw new Error("没有可保存的原图");
    return await saveImageForPlatform(imageB64, suggested, SaveImageAs);
  }

  return {
    async selectSourceImage() {
      try {
        const res = await OpenImageDialog();
        if (!res || !res.path) return;
        const baseName = res.name || res.path.split(/[\\/]/).pop() || res.path;
        const currentState = store.getState();
        const existing = currentState.sources;
        const editSourceMode = editSourceModeAfterReferenceUpdate(currentState.editSourceMode);
        if (existing.some((source) => source.path === res.path)) {
          store.setState({ mode: "edit", editSourceMode, errorMessage: null, errorRawPath: null });
          return;
        }
        store.setState({
          sources: [...existing, {
            path: res.path,
            name: baseName,
            size: res.size,
            width: Number.isFinite(Number(res.previewWidth)) ? Number(res.previewWidth) : undefined,
            height: Number.isFinite(Number(res.previewHeight)) ? Number(res.previewHeight) : undefined,
            imageB64: res.imageB64 || undefined,
            imageBlob: res.imageB64 ? base64ToBlob(res.imageB64) : null,
            previewUrl: res.previewUrl,
          }],
          mode: "edit",
          editSourceMode,
          errorMessage: null,
          errorRawPath: null,
        });
        void syncSharedEditAutoAspect(store);
      } catch (error: any) {
        store.setState({ errorMessage: `选择图片失败: ${error?.message ?? error}`, errorRawPath: null });
      }
    },

    async selectBatchInputDir() {
      try {
        const result = await ChooseBatchInputDir();
        if (!result?.directory) return;
        store.setState((state) => ({
          mode: "edit",
          editSourceMode: "batch",
          batchProcess: {
            ...state.batchProcess,
            inputDir: result.directory,
            discoveredSources: (result.images ?? []).map((item) => mapBatchSource(item, false)),
          },
          errorMessage: null,
          errorRawPath: null,
        }));
        void syncSharedEditAutoAspect(store);
      } catch (error: any) {
        store.setState({ errorMessage: `选择批处理输入目录失败: ${error?.message ?? error}`, errorRawPath: null });
      }
    },

    async selectBatchInputFiles() {
      try {
        const result = await OpenImagesDialog();
        const files = result?.files ?? [];
        if (files.length === 0) return;
        store.setState((state) => {
          const existing = new Map(state.batchProcess.discoveredSources.map((item) => [item.path, item]));
          for (const file of files) {
            existing.set(file.path, mapBatchSource(file, true));
          }
          const inferredDirectory = commonDirectoryFromPaths(Array.from(existing.keys()));
          return {
            mode: "edit",
            editSourceMode: "batch",
            batchProcess: {
              ...state.batchProcess,
              inputDir: inferredDirectory || state.batchProcess.inputDir,
              discoveredSources: Array.from(existing.values()),
            },
            errorMessage: null,
            errorRawPath: null,
          };
        });
        void syncSharedEditAutoAspect(store);
      } catch (error: any) {
        store.setState({ errorMessage: `选择批处理图片失败: ${error?.message ?? error}`, errorRawPath: null });
      }
    },

    async refreshBatchInputDir() {
      const { batchProcess } = store.getState();
      if (!batchProcess.inputDir.trim()) return;
      try {
        const result = await ListBatchInputImages(batchProcess.inputDir);
        store.setState((state) => ({
          batchProcess: {
            ...state.batchProcess,
            inputDir: result.directory || state.batchProcess.inputDir,
            discoveredSources: (result.images ?? []).map((item) => {
              const existing = state.batchProcess.discoveredSources.find((source) => source.path === item.path);
              return mapBatchSource(item, existing?.selected !== false);
            }),
          },
          errorMessage: null,
          errorRawPath: null,
        }));
        void syncSharedEditAutoAspect(store);
      } catch (error: any) {
        store.setState({ errorMessage: `刷新批处理输入目录失败: ${error?.message ?? error}`, errorRawPath: null });
      }
    },

    async chooseBatchOutputDir() {
      try {
        const chosen = await ChooseBatchOutputDir();
        if (!String(chosen || "").trim()) return;
        store.setState((state) => ({
          batchProcess: {
            ...state.batchProcess,
            outputMode: "custom_dir",
            outputDir: String(chosen).trim(),
          },
          errorMessage: null,
          errorRawPath: null,
        }));
      } catch (error: any) {
        store.setState({ errorMessage: `选择批处理输出目录失败: ${error?.message ?? error}`, errorRawPath: null });
      }
    },

    async importSourceImageFile(file: File) {
      try {
        if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
          store.setState({ errorMessage: `不支持的图片类型: ${file.type || "(未知)"}，请用 PNG/JPG/WebP`, errorRawPath: null });
          return;
        }
        const b64 = await fileToBase64(file);
        const result = await ImportImageFromB64(b64, file.name);
        const ref = await RegisterImportedImageAsset(result.path).catch(() => null);
        const previewUrl = ref?.previewUrl || result.previewUrl;
        const legacyB64 = previewUrl ? "" : (result.imageB64 || b64);
        const currentState = store.getState();
        const existing = currentState.sources;
        const alreadyIn = existing.some((source) => source.path === result.path);
        store.setState({
          sources: alreadyIn
            ? existing
            : [...existing, {
                path: result.path,
                name: file.name,
                size: file.size,
                width: Number.isFinite(Number(result.previewWidth)) ? Number(result.previewWidth) : undefined,
                height: Number.isFinite(Number(result.previewHeight)) ? Number(result.previewHeight) : undefined,
                imageB64: legacyB64 || undefined,
                imageBlob: legacyB64 ? base64ToBlob(legacyB64) : null,
                previewUrl,
              }],
          mode: "edit",
          editSourceMode: editSourceModeAfterReferenceUpdate(currentState.editSourceMode),
          errorMessage: null,
          errorRawPath: null,
        });
        void syncSharedEditAutoAspect(store);
        store.getState().pushToast(alreadyIn ? "参考图已存在" : "已导入参考图", alreadyIn ? "warn" : "success", 2200);
      } catch (error: any) {
        store.setState({ errorMessage: `导入参考图失败: ${error?.message ?? error}`, errorRawPath: null });
      }
    },

    async selectReversePromptImage() {
      try {
        const res = await OpenImageDialog();
        if (!res || !res.path) return;
        const baseName = res.name || res.path.split(/[\\/]/).pop() || res.path;
        store.setState({
          reversePromptImage: {
            path: res.path,
            name: baseName,
            size: res.size,
            imageB64: res.imageB64 || undefined,
            imageBlob: res.imageB64 ? base64ToBlob(res.imageB64) : null,
            previewUrl: res.previewUrl,
          },
          errorMessage: null,
          errorRawPath: null,
        });
      } catch (error: any) {
        store.setState({ errorMessage: `选择反推图片失败: ${error?.message ?? error}`, errorRawPath: null });
      }
    },

    async importReversePromptImageFile(file: File) {
      try {
        if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
          store.setState({ errorMessage: `不支持的图片类型: ${file.type || "(未知)"}，请用 PNG/JPG/WebP`, errorRawPath: null });
          return;
        }
        const b64 = await fileToBase64(file);
        const result = await ImportImageFromB64(b64, file.name);
        const ref = await RegisterImportedImageAsset(result.path).catch(() => null);
        const previewUrl = ref?.previewUrl || result.previewUrl;
        const legacyB64 = previewUrl ? "" : (result.imageB64 || b64);
        store.setState({
          reversePromptImage: {
            path: result.path,
            name: file.name,
            size: file.size,
            imageB64: legacyB64 || undefined,
            imageBlob: legacyB64 ? base64ToBlob(legacyB64) : null,
            previewUrl,
          },
          errorMessage: null,
          errorRawPath: null,
        });
        store.getState().pushToast("已导入反推图片", "success", 2200);
      } catch (error: any) {
        store.setState({ errorMessage: `导入反推图片失败: ${error?.message ?? error}`, errorRawPath: null });
      }
    },

    clearReversePromptImage() {
      store.setState({ reversePromptImage: null });
    },

    removeSource(index: number) {
      const currentState = store.getState();
      const next = currentState.sources.filter((_, i) => i !== index);
      store.setState({
        sources: next,
        mode: "edit",
        editSourceMode: editSourceModeAfterReferenceUpdate(currentState.editSourceMode),
      });
      if (next.length === 0) {
        setSharedEditAutoAspectLock(store, false);
      } else {
        void syncSharedEditAutoAspect(store);
      }
    },

    clearSources() {
      const currentState = store.getState();
      store.setState({
        sources: [],
        mode: "edit",
        editSourceMode: editSourceModeAfterReferenceUpdate(currentState.editSourceMode),
      });
      setSharedEditAutoAspectLock(store, false);
    },

    reorderSources(from: number, to: number) {
      const list = [...store.getState().sources];
      if (from < 0 || from >= list.length || to < 0 || to >= list.length) return;
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      store.setState({ sources: list });
      void syncSharedEditAutoAspect(store);
    },

    async reuseAsSource(item: HistoryItem) {
      let localItem = await materializeHistoryItem(item, {
        setState: (fn) => store.setState((state) => fn(state)),
      }).catch((e: any) => {
        store.setState({ errorMessage: `源图准备失败: ${e?.message ?? e}`, errorRawPath: null });
        return null;
      });
      if (!localItem?.savedPath) return;
      const savedPath = localItem.savedPath;
      if (!localItem.previewUrl && !localItem.previewBlob && !localItem.imageB64) {
        const ref = await RegisterImportedImageAsset(savedPath).catch(() => null);
        if (ref) localItem = withMediaAssetRef(localItem, ref);
      }
      const baseName = savedPath.split(/[\\/]/).pop() ?? "source.png";
      const existing = store.getState().sources;
      const alreadyIn = existing.some((source) => source.path === savedPath);
      store.setState((state) => ({
        mode: "edit",
        editSourceMode: editSourceModeAfterReferenceUpdate(state.editSourceMode),
        currentImage: toPreviewOnlyHistoryItem(localItem),
        resultGridOpen: false,
        historyGalleryOpen: false,
        sources: alreadyIn
          ? existing
          : [...existing, {
              path: savedPath,
              name: baseName,
              size: 0,
              width: Number.isFinite(Number(localItem.previewWidth)) ? Number(localItem.previewWidth) : undefined,
              height: Number.isFinite(Number(localItem.previewHeight)) ? Number(localItem.previewHeight) : undefined,
              imageBlob: localItem.previewUrl ? null : (localItem.previewBlob ?? localItem.imageBlob ?? null),
              imageB64: localItem.previewUrl ? undefined : localItem.imageB64,
              previewUrl: localItem.previewUrl,
              panoramaRoundtrip: localItem.panoramaRoundtrip,
              panoramaProject: localItem.panoramaProject,
            }],
        workspaces: patchWorkspaceRuntime(state.workspaces, state.activeWorkspaceId, {
          currentImageId: localItem.id,
          resultGridOpen: false,
          historyGalleryOpen: false,
        }),
      }));
      void syncSharedEditAutoAspect(store);
    },

    applyHistoryParams(item: HistoryItem) {
      const sourceImages: SourceImage[] = item.mode === "edit" ? sourceImagesFromHistoryItem(item) : [];
      const patch: Partial<StudioState> = {
        prompt: item.prompt ?? "",
        mode: item.mode,
        editSourceMode: item.mode === "edit" ? "manual" : store.getState().editSourceMode,
        size: item.size,
        quality: item.quality,
        sources: sourceImages,
      };
      if (item.seed !== undefined) patch.seed = item.seed;
      if (item.negativePrompt !== undefined) patch.negativePrompt = item.negativePrompt;
      if (item.styleTag !== undefined) patch.styleTag = item.styleTag;
      if (item.outputFormat) patch.outputFormat = item.outputFormat;
      store.setState(patch);
      const sourceNote = item.mode === "edit" && sourceImages.length > 0 ? `，并带上 ${sourceImages.length} 张输入图` : "";
      store.getState().pushToast(`已应用此图的参数到控制台${sourceNote}`, "success");
    },

    async regenerateFromHistory(item: HistoryItem) {
      this.applyHistoryParams(item);
      await Promise.resolve();
      await store.getState().submit();
    },

    async deleteHistoryItem(id: string) {
      await removeHistoryItem(id);
      const currentBefore = store.getState().currentImage;
      const wasCurrent = currentBefore?.id === id;
      const nextBatch = store.getState().batchResults.filter((entry) => entry.id !== id);
      const patch: Partial<StudioState> = { batchResults: nextBatch };
      if (wasCurrent) patch.currentImage = null;
      if (nextBatch.length <= 1) patch.resultGridOpen = false;
      store.setState((state) => ({
        history: state.history.filter((entry) => entry.id !== id),
        resultDetail: state.resultDetail?.id === id ? null : state.resultDetail,
        panoramaViewerItem: state.panoramaViewerItem?.id === id ? null : state.panoramaViewerItem,
        panoramaAlignTarget: state.panoramaAlignTarget?.id === id ? null : state.panoramaAlignTarget,
        materialGroups: (() => {
          const next = removeHistoryRefsFromMaterialGroups(state.materialGroups, [id]);
          persistMaterialGroups(next);
          return next;
        })(),
        ...(patch as any),
        workspaces: patchWorkspaceRuntime(state.workspaces, state.activeWorkspaceId, {
          currentImageId: wasCurrent ? null : currentBefore?.id ?? null,
          batchResultIds: nextBatch.map((entry) => entry.id),
          resultGridOpen: nextBatch.length > 1 && (patch.resultGridOpen ?? state.resultGridOpen),
        }),
      }));
    },

    async saveCurrentImageAs() {
      const current = store.getState().currentImage;
      if (!current) return;
      try {
        const saved = await saveHistoryImageToAlbum(current);
        if (saved) store.getState().pushToast("已保存", "success");
      } catch (e: any) {
        const msg = `保存失败: ${e?.message ?? e}`;
        store.setState({ errorMessage: msg, errorRawPath: null });
        store.getState().pushToast(msg, "error");
      }
    },

    async saveHistoryItemAs(item: HistoryItem) {
      try {
        const saved = await saveHistoryImageToAlbum(item);
        if (saved) store.getState().pushToast("已保存", "success");
      } catch (e: any) {
        const msg = `保存失败: ${e?.message ?? e}`;
        store.setState({ errorMessage: msg, errorRawPath: null });
        store.getState().pushToast(msg, "error");
      }
    },

    async shareCurrentImage() {
      const current = store.getState().currentImage;
      if (!current) return;
      try {
        await shareHistoryImage(current);
        store.getState().pushToast("已打开系统分享", "success");
      } catch (e: any) {
        const msg = `分享失败: ${e?.message ?? e}`;
        store.setState({ errorMessage: msg, errorRawPath: null });
        store.getState().pushToast(msg, "error");
      }
    },

    async shareHistoryItem(item: HistoryItem) {
      try {
        await shareHistoryImage(item);
        store.getState().pushToast("已打开系统分享", "success");
      } catch (e: any) {
        const msg = `分享失败: ${e?.message ?? e}`;
        store.setState({ errorMessage: msg, errorRawPath: null });
        store.getState().pushToast(msg, "error");
      }
    },

    async importImageFile(file: File) {
      try {
        const options = arguments[1] as ImportImageFileOptions | undefined;
        if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
          store.setState({ errorMessage: `不支持的图片类型: ${file.type || "(未知)"}，请用 PNG/JPG/WebP`, errorRawPath: null });
          return;
        }
        const b64 = await fileToBase64(file);
        const result = await ImportImageFromB64(b64, file.name);
        const ref = await RegisterImportedImageAsset(result.path).catch(() => null);
        const legacyB64 = result.previewUrl || ref?.previewUrl ? "" : (result.imageB64 || b64);
        const legacyBlob = legacyB64 ? base64ToBlob(legacyB64) : null;
        const importedWidth = Number.isFinite(Number(result.previewWidth)) ? Number(result.previewWidth) : undefined;
        const importedHeight = Number.isFinite(Number(result.previewHeight)) ? Number(result.previewHeight) : undefined;
        const transientItem: HistoryItem = {
          id: genId(),
          imageB64: legacyB64 || undefined,
          imageBlob: null,
          previewBlob: legacyBlob,
          prompt: `(导入)${file.name}`,
          mode: "edit",
          size: "1024x1024",
          quality: "medium",
          createdAt: Date.now(),
          savedPath: result.path,
          width: importedWidth,
          height: importedHeight,
          previewWidth: importedWidth,
          previewHeight: importedHeight,
        };
        let importedItem = ref ? withMediaAssetRef(transientItem, ref) : transientItem;
        const isPanoramaImport = options?.forcePanorama === true || isLikelyPanoramaItem(importedItem);
        if (isPanoramaImport) {
          importedItem = {
            ...importedItem,
            panoramaProject: buildPanoramaProjectRef(importedItem, "source"),
          };
        }
        const existingSources = store.getState().sources;
        const alreadyIn = existingSources.some((source) => source.path === result.path);
        store.setState((state) => ({
          currentImage: ref ? { ...importedItem, previewOnly: true } : importedItem,
          history: isPanoramaImport
            ? trimHistory([importedItem, ...state.history.filter((entry) => entry.id !== importedItem.id)])
            : state.history,
          ...(isPanoramaImport ? { batchResults: [importedItem] } : {}),
          resultGridOpen: isPanoramaImport,
          historyGalleryOpen: false,
          mode: "edit",
          editSourceMode: editSourceModeAfterReferenceUpdate(state.editSourceMode),
          sources: alreadyIn
            ? existingSources
            : [...existingSources, {
                path: result.path,
                name: file.name,
                size: file.size,
                width: Number.isFinite(Number(result.previewWidth)) ? Number(result.previewWidth) : undefined,
                height: Number.isFinite(Number(result.previewHeight)) ? Number(result.previewHeight) : undefined,
                imageBlob: legacyBlob,
                imageB64: legacyB64 || undefined,
                previewUrl: importedItem.previewUrl,
                panoramaProject: importedItem.panoramaProject,
              }],
          errorMessage: null,
          errorRawPath: null,
          workspaces: patchWorkspaceRuntime(state.workspaces, state.activeWorkspaceId, {
            currentImageId: importedItem.id,
            ...(isPanoramaImport ? { batchResultIds: [importedItem.id] } : {}),
            resultGridOpen: isPanoramaImport,
            historyGalleryOpen: false,
          }),
        }));
        if (isPanoramaImport) {
          await persistHistoryItem(importedItem).catch(() => undefined);
          persistTrimmedHistory(store.getState().history);
        }
        void syncSharedEditAutoAspect(store);
      } catch (e: any) {
        store.setState({ errorMessage: `导入失败: ${e?.message ?? e}`, errorRawPath: null });
      }
    },
  };
}
