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
import type { SourceImageImportOptions, StudioState } from "./studioStore.types";
import { applySourceImageImport } from "./sourceImageImport";
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
import { patchWorkspaceRuntime, type WorkspacePatch } from "./workspaceRuntime";
import {
  captureWorkspaceAction,
  isWorkspaceActionCurrent,
  settleWorkspaceAction,
  type WorkspaceActionToken,
} from "./workspaceActionTokens.ts";
import { mapWorkspaceCanvasHistoryItems } from "./workspaceCanvasRuntime.ts";
import { genId, persistTrimmedHistory, trimHistory } from "./studioStore.shared";
import {
  setSharedEditAutoAspectLock,
  syncSharedEditAutoAspect,
} from "./sharedEditAutoAspect";

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

function settleAction(store: StateAdapter, token: WorkspaceActionToken): void {
  settleWorkspaceAction(token, workspaceIds(store.getState()));
}

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
      const workspaceId = store.getState().activeWorkspaceId;
      const token = captureWorkspaceAction(workspaceId, "select-source", { supersede: true });
      try {
        const res = await OpenImageDialog();
        if (!res || !res.path || !actionIsCurrent(store, token)) return;
        const baseName = res.name || res.path.split(/[\\/]/).pop() || res.path;
        const currentState = store.getState();
        const workspace = currentState.workspaces.find((entry) => entry.id === workspaceId);
        if (!workspace) return;
        const existing = workspace.sources;
        const editSourceMode = editSourceModeAfterReferenceUpdate(workspace.editSourceMode);
        if (existing.some((source) => source.path === res.path)) {
          store.setState((state) => scopedWorkspacePatch(state, workspaceId, {
            mode: "edit", editSourceMode, errorMessage: null, errorRawPath: null,
          }, { mode: "edit", editSourceMode, errorMessage: null, errorRawPath: null }));
          return;
        }
        const sources = [...existing, {
            path: res.path,
            name: baseName,
            size: res.size,
            width: Number.isFinite(Number(res.previewWidth)) ? Number(res.previewWidth) : undefined,
            height: Number.isFinite(Number(res.previewHeight)) ? Number(res.previewHeight) : undefined,
            imageB64: res.imageB64 || undefined,
            imageBlob: res.imageB64 ? base64ToBlob(res.imageB64) : null,
            previewUrl: res.previewUrl,
          }];
        store.setState((state) => scopedWorkspacePatch(state, workspaceId, {
          sources, mode: "edit", editSourceMode, errorMessage: null, errorRawPath: null,
        }, { sources, mode: "edit", editSourceMode, errorMessage: null, errorRawPath: null }));
        void syncSharedEditAutoAspect(store, { workspaceId });
      } catch (error: any) {
        if (!actionIsCurrent(store, token)) return;
        const errorMessage = `选择图片失败: ${error?.message ?? error}`;
        store.setState((state) => scopedWorkspacePatch(state, workspaceId, { errorMessage, errorRawPath: null }, { errorMessage, errorRawPath: null }));
      } finally {
        settleAction(store, token);
      }
    },

    async selectBatchInputDir() {
      const workspaceId = store.getState().activeWorkspaceId;
      const token = captureWorkspaceAction(workspaceId, "select-batch-directory", { supersede: true });
      try {
        const result = await ChooseBatchInputDir();
        if (!result?.directory || !actionIsCurrent(store, token)) return;
        store.setState((state) => {
          const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
          if (!workspace) return {};
          const batchProcess = {
            ...workspace.batchProcess,
            inputDir: result.directory,
            discoveredSources: (result.images ?? []).map((item) => mapBatchSource(item, false)),
          };
          return scopedWorkspacePatch(state, workspaceId, {
            mode: "edit", editSourceMode: "batch", batchProcess, errorMessage: null, errorRawPath: null,
          }, { mode: "edit", editSourceMode: "batch", batchProcess, errorMessage: null, errorRawPath: null });
        });
        void syncSharedEditAutoAspect(store, { workspaceId });
      } catch (error: any) {
        if (!actionIsCurrent(store, token)) return;
        const errorMessage = `选择批处理输入目录失败: ${error?.message ?? error}`;
        store.setState((state) => scopedWorkspacePatch(state, workspaceId, { errorMessage, errorRawPath: null }, { errorMessage, errorRawPath: null }));
      } finally {
        settleAction(store, token);
      }
    },

    async selectBatchInputFiles() {
      const workspaceId = store.getState().activeWorkspaceId;
      const token = captureWorkspaceAction(workspaceId, "select-batch-files", { supersede: true });
      try {
        const result = await OpenImagesDialog();
        const files = result?.files ?? [];
        if (files.length === 0 || !actionIsCurrent(store, token)) return;
        store.setState((state) => {
          const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
          if (!workspace) return {};
          const existing = new Map(workspace.batchProcess.discoveredSources.map((item) => [item.path, item]));
          for (const file of files) {
            existing.set(file.path, mapBatchSource(file, true));
          }
          const inferredDirectory = commonDirectoryFromPaths(Array.from(existing.keys()));
          const batchProcess = {
              ...workspace.batchProcess,
              inputDir: inferredDirectory || workspace.batchProcess.inputDir,
              discoveredSources: Array.from(existing.values()),
          };
          return scopedWorkspacePatch(state, workspaceId, {
            mode: "edit", editSourceMode: "batch", batchProcess, errorMessage: null, errorRawPath: null,
          }, { mode: "edit", editSourceMode: "batch", batchProcess, errorMessage: null, errorRawPath: null });
        });
        void syncSharedEditAutoAspect(store, { workspaceId });
      } catch (error: any) {
        if (!actionIsCurrent(store, token)) return;
        const errorMessage = `选择批处理图片失败: ${error?.message ?? error}`;
        store.setState((state) => scopedWorkspacePatch(state, workspaceId, { errorMessage, errorRawPath: null }, { errorMessage, errorRawPath: null }));
      } finally {
        settleAction(store, token);
      }
    },

    async refreshBatchInputDir() {
      const initial = store.getState();
      const workspaceId = initial.activeWorkspaceId;
      const batchProcess = initial.workspaces.find((entry) => entry.id === workspaceId)?.batchProcess ?? initial.batchProcess;
      if (!batchProcess.inputDir.trim()) return;
      const token = captureWorkspaceAction(workspaceId, "refresh-batch-directory", { supersede: true });
      try {
        const result = await ListBatchInputImages(batchProcess.inputDir);
        if (!actionIsCurrent(store, token)) return;
        store.setState((state) => {
          const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
          if (!workspace) return {};
          const nextBatchProcess = {
            ...workspace.batchProcess,
            inputDir: result.directory || workspace.batchProcess.inputDir,
            discoveredSources: (result.images ?? []).map((item) => {
              const existing = workspace.batchProcess.discoveredSources.find((source) => source.path === item.path);
              return mapBatchSource(item, existing?.selected !== false);
            }),
          };
          return scopedWorkspacePatch(state, workspaceId, {
            batchProcess: nextBatchProcess, errorMessage: null, errorRawPath: null,
          }, { batchProcess: nextBatchProcess, errorMessage: null, errorRawPath: null });
        });
        void syncSharedEditAutoAspect(store, { workspaceId });
      } catch (error: any) {
        if (!actionIsCurrent(store, token)) return;
        const errorMessage = `刷新批处理输入目录失败: ${error?.message ?? error}`;
        store.setState((state) => scopedWorkspacePatch(state, workspaceId, { errorMessage, errorRawPath: null }, { errorMessage, errorRawPath: null }));
      } finally {
        settleAction(store, token);
      }
    },

    async chooseBatchOutputDir() {
      const workspaceId = store.getState().activeWorkspaceId;
      const token = captureWorkspaceAction(workspaceId, "select-batch-output", { supersede: true });
      try {
        const chosen = await ChooseBatchOutputDir();
        if (!String(chosen || "").trim() || !actionIsCurrent(store, token)) return;
        store.setState((state) => {
          const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
          if (!workspace) return {};
          const batchProcess = {
            ...workspace.batchProcess,
            outputMode: "custom_dir",
            outputDir: String(chosen).trim(),
          } as const;
          return scopedWorkspacePatch(state, workspaceId, {
            batchProcess, errorMessage: null, errorRawPath: null,
          }, { batchProcess, errorMessage: null, errorRawPath: null });
        });
      } catch (error: any) {
        if (!actionIsCurrent(store, token)) return;
        const errorMessage = `选择批处理输出目录失败: ${error?.message ?? error}`;
        store.setState((state) => scopedWorkspacePatch(state, workspaceId, { errorMessage, errorRawPath: null }, { errorMessage, errorRawPath: null }));
      } finally {
        settleAction(store, token);
      }
    },

    async importSourceImageFile(file: File, options?: SourceImageImportOptions) {
      const workspaceId = store.getState().activeWorkspaceId;
      const token = captureWorkspaceAction(workspaceId, "import-source");
      try {
        if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
          store.setState({ errorMessage: `不支持的图片类型: ${file.type || "(未知)"}，请用 PNG/JPG/WebP`, errorRawPath: null });
          return;
        }
        const replaceSourcePath = String(options?.replaceSourcePath || "").trim();
        const initialWorkspace = store.getState().workspaces.find((entry) => entry.id === workspaceId);
        if (!initialWorkspace) return;
        if (replaceSourcePath && !initialWorkspace.sources.some((source) => source.path === replaceSourcePath)) {
          store.getState().pushToast("目标参考图已变化，未执行替换", "warn", 2800);
          return;
        }
        const b64 = await fileToBase64(file);
        if (!actionIsCurrent(store, token)) return;
        const result = await ImportImageFromB64(b64, file.name);
        if (!actionIsCurrent(store, token)) return;
        const ref = await RegisterImportedImageAsset(result.path).catch(() => null);
        if (!actionIsCurrent(store, token)) return;
        const previewUrl = ref?.previewUrl || result.previewUrl;
        const legacyB64 = previewUrl ? "" : (result.imageB64 || b64);
        const currentState = store.getState();
        const imported: SourceImage = {
          path: result.path,
          name: file.name,
          size: file.size,
          width: Number.isFinite(Number(result.previewWidth)) ? Number(result.previewWidth) : undefined,
          height: Number.isFinite(Number(result.previewHeight)) ? Number(result.previewHeight) : undefined,
          imageB64: legacyB64 || undefined,
          imageBlob: legacyB64 ? base64ToBlob(legacyB64) : null,
          previewUrl,
        };
        const workspace = currentState.workspaces.find((entry) => entry.id === workspaceId);
        if (!workspace) return;
        const update = applySourceImageImport(workspace.sources, imported, replaceSourcePath || undefined);
        const editSourceMode = editSourceModeAfterReferenceUpdate(workspace.editSourceMode);
        store.setState((state) => scopedWorkspacePatch(state, workspaceId, {
          sources: update.sources,
          mode: "edit",
          editSourceMode,
          errorMessage: null,
          errorRawPath: null,
        }, {
          sources: update.sources,
          mode: "edit",
          editSourceMode,
          errorMessage: null,
          errorRawPath: null,
        }));
        if (update.outcome === "added" || update.outcome === "replaced") {
          void syncSharedEditAutoAspect(store, { workspaceId });
        }
        if (update.outcome === "stale") {
          store.getState().pushToast("目标参考图已变化，未执行替换", "warn", 2800);
        } else if (update.outcome === "duplicate") {
          store.getState().pushToast("参考图已存在", "warn", 2200);
        } else {
          store.getState().pushToast(update.outcome === "replaced" ? "已替换参考图" : "已导入参考图", "success", 2200);
        }
      } catch (error: any) {
        if (!actionIsCurrent(store, token)) return;
        const errorMessage = `导入参考图失败: ${error?.message ?? error}`;
        store.setState((state) => scopedWorkspacePatch(state, workspaceId, { errorMessage, errorRawPath: null }, { errorMessage, errorRawPath: null }));
      } finally {
        settleAction(store, token);
      }
    },

    async selectReversePromptImage() {
      const workspaceId = store.getState().activeWorkspaceId;
      const token = captureWorkspaceAction(workspaceId, "select-reverse-image", { supersede: true });
      try {
        const res = await OpenImageDialog();
        if (!res || !res.path || !actionIsCurrent(store, token)) return;
        const baseName = res.name || res.path.split(/[\\/]/).pop() || res.path;
        store.setState((state) => {
          const reversePromptImage = {
            path: res.path,
            name: baseName,
            size: res.size,
            imageB64: res.imageB64 || undefined,
            imageBlob: res.imageB64 ? base64ToBlob(res.imageB64) : null,
            previewUrl: res.previewUrl,
          };
          return {
            reversePromptImage,
            errorMessage: null,
            errorRawPath: null,
            workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, { reversePromptImage }),
            ...(state.activeWorkspaceId !== workspaceId ? { reversePromptImage: state.reversePromptImage } : {}),
          };
        });
      } catch (error: any) {
        if (!actionIsCurrent(store, token)) return;
        const errorMessage = `选择反推图片失败: ${error?.message ?? error}`;
        store.setState((state) => scopedWorkspacePatch(state, workspaceId, { errorMessage, errorRawPath: null }, { errorMessage, errorRawPath: null }));
      } finally {
        settleAction(store, token);
      }
    },

    async importReversePromptImageFile(file: File) {
      const workspaceId = store.getState().activeWorkspaceId;
      const token = captureWorkspaceAction(workspaceId, "import-reverse-image");
      try {
        if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
          store.setState({ errorMessage: `不支持的图片类型: ${file.type || "(未知)"}，请用 PNG/JPG/WebP`, errorRawPath: null });
          return;
        }
        const b64 = await fileToBase64(file);
        if (!actionIsCurrent(store, token)) return;
        const result = await ImportImageFromB64(b64, file.name);
        if (!actionIsCurrent(store, token)) return;
        const ref = await RegisterImportedImageAsset(result.path).catch(() => null);
        if (!actionIsCurrent(store, token)) return;
        const previewUrl = ref?.previewUrl || result.previewUrl;
        const legacyB64 = previewUrl ? "" : (result.imageB64 || b64);
        store.setState((state) => {
          const reversePromptImage = {
            path: result.path,
            name: file.name,
            size: file.size,
            imageB64: legacyB64 || undefined,
            imageBlob: legacyB64 ? base64ToBlob(legacyB64) : null,
            previewUrl,
          };
          return {
            reversePromptImage,
            errorMessage: null,
            errorRawPath: null,
            workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, { reversePromptImage }),
            ...(state.activeWorkspaceId !== workspaceId ? { reversePromptImage: state.reversePromptImage } : {}),
          };
        });
        store.getState().pushToast("已导入反推图片", "success", 2200);
      } catch (error: any) {
        if (!actionIsCurrent(store, token)) return;
        const errorMessage = `导入反推图片失败: ${error?.message ?? error}`;
        store.setState((state) => scopedWorkspacePatch(state, workspaceId, { errorMessage, errorRawPath: null }, { errorMessage, errorRawPath: null }));
      } finally {
        settleAction(store, token);
      }
    },

    clearReversePromptImage() {
      store.setState((state) => ({
        reversePromptImage: null,
        workspaces: patchWorkspaceRuntime(state.workspaces, state.activeWorkspaceId, { reversePromptImage: null }),
      }));
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
      const workspaceId = store.getState().activeWorkspaceId;
      const token = captureWorkspaceAction(workspaceId, "reuse-history-source");
      let localItem = await materializeHistoryItem(item, {
        setState: (fn) => store.setState((state) => {
          const patch = fn(state);
          return state.activeWorkspaceId === workspaceId
            ? patch
            : { ...patch, currentImage: state.currentImage };
        }),
      }).catch((e: any) => {
        if (!actionIsCurrent(store, token)) return null;
        const errorMessage = `源图准备失败: ${e?.message ?? e}`;
        store.setState((state) => scopedWorkspacePatch(state, workspaceId, { errorMessage, errorRawPath: null }, { errorMessage, errorRawPath: null }));
        return null;
      });
      if (!localItem?.savedPath || !actionIsCurrent(store, token)) {
        settleAction(store, token);
        return;
      }
      const savedPath = localItem.savedPath;
      if (!localItem.previewUrl && !localItem.previewBlob && !localItem.imageB64) {
        const ref = await RegisterImportedImageAsset(savedPath).catch(() => null);
        if (!actionIsCurrent(store, token)) {
          settleAction(store, token);
          return;
        }
        if (ref) localItem = withMediaAssetRef(localItem, ref);
      }
      const baseName = savedPath.split(/[\\/]/).pop() ?? "source.png";
      const workspace = store.getState().workspaces.find((entry) => entry.id === workspaceId);
      if (!workspace) {
        settleAction(store, token);
        return;
      }
      const existing = workspace.sources;
      const alreadyIn = existing.some((source) => source.path === savedPath);
      const sources = alreadyIn
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
            localEditRoundtrip: localItem.localEditRoundtrip,
          }];
      const currentImage = toPreviewOnlyHistoryItem(localItem);
      store.setState((state) => ({
        ...scopedWorkspacePatch(state, workspaceId, {
          mode: "edit",
          editSourceMode: editSourceModeAfterReferenceUpdate(workspace.editSourceMode),
          sources,
          currentImageId: localItem.id,
          resultGridOpen: false,
          historyGalleryOpen: false,
        }, {
        mode: "edit",
        editSourceMode: editSourceModeAfterReferenceUpdate(workspace.editSourceMode),
        currentImage,
        resultGridOpen: false,
        historyGalleryOpen: false,
        sources,
        }),
      }));
      settleAction(store, token);
      void syncSharedEditAutoAspect(store, { workspaceId });
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
        compareB: state.compareB?.id === id ? null : state.compareB,
        sourcePreviewReturnImage: state.sourcePreviewReturnImage?.id === id ? null : state.sourcePreviewReturnImage,
        workspaceCanvasRuntime: mapWorkspaceCanvasHistoryItems(
          state.workspaceCanvasRuntime,
          (item) => item?.id === id ? null : item,
        ),
        resultDetail: state.resultDetail?.id === id ? null : state.resultDetail,
        panoramaViewerItem: state.panoramaViewerItem?.id === id ? null : state.panoramaViewerItem,
        panoramaAlignTarget: state.panoramaAlignTarget?.id === id ? null : state.panoramaAlignTarget,
        materialGroups: (() => {
          const next = removeHistoryRefsFromMaterialGroups(state.materialGroups, [id]);
          persistMaterialGroups(next);
          return next;
        })(),
        ...(patch as any),
        workspaces: state.workspaces.map((workspace) => {
          const batchResultIds = workspace.id === state.activeWorkspaceId
            ? nextBatch.map((entry) => entry.id)
            : (workspace.batchResultIds ?? []).filter((resultId) => resultId !== id);
          const currentImageId = workspace.id === state.activeWorkspaceId
            ? (wasCurrent ? null : currentBefore?.id ?? workspace.currentImageId)
            : (workspace.currentImageId === id ? null : workspace.currentImageId);
          return {
            ...workspace,
            currentImageId,
            batchResultIds,
            resultGridOpen: batchResultIds.length > 1 && workspace.resultGridOpen,
          };
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
      const workspaceId = store.getState().activeWorkspaceId;
      const token = captureWorkspaceAction(workspaceId, "import-image");
      try {
        const options = arguments[1] as ImportImageFileOptions | undefined;
        if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
          store.setState({ errorMessage: `不支持的图片类型: ${file.type || "(未知)"}，请用 PNG/JPG/WebP`, errorRawPath: null });
          return;
        }
        const b64 = await fileToBase64(file);
        if (!actionIsCurrent(store, token)) return;
        const result = await ImportImageFromB64(b64, file.name);
        if (!actionIsCurrent(store, token)) return;
        const ref = await RegisterImportedImageAsset(result.path).catch(() => null);
        if (!actionIsCurrent(store, token)) return;
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
        const workspace = store.getState().workspaces.find((entry) => entry.id === workspaceId);
        if (!workspace) return;
        const existingSources = workspace.sources;
        const alreadyIn = existingSources.some((source) => source.path === result.path);
        store.setState((state) => ({
          ...scopedWorkspacePatch(state, workspaceId, {
            currentImageId: importedItem.id,
            ...(isPanoramaImport ? { batchResultIds: [importedItem.id] } : {}),
            resultGridOpen: isPanoramaImport,
            historyGalleryOpen: false,
            mode: "edit",
            editSourceMode: editSourceModeAfterReferenceUpdate(workspace.editSourceMode),
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
          }, {
          currentImage: ref ? { ...importedItem, previewOnly: true } : importedItem,
          ...(isPanoramaImport ? { batchResults: [importedItem] } : {}),
          resultGridOpen: isPanoramaImport,
          historyGalleryOpen: false,
          mode: "edit",
          editSourceMode: editSourceModeAfterReferenceUpdate(workspace.editSourceMode),
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
          }),
          history: isPanoramaImport
            ? trimHistory([importedItem, ...state.history.filter((entry) => entry.id !== importedItem.id)])
            : state.history,
        }));
        if (isPanoramaImport) {
          await persistHistoryItem(importedItem).catch(() => undefined);
          persistTrimmedHistory(store.getState().history);
        }
        void syncSharedEditAutoAspect(store, { workspaceId });
      } catch (e: any) {
        if (!actionIsCurrent(store, token)) return;
        const errorMessage = `导入失败: ${e?.message ?? e}`;
        store.setState((state) => scopedWorkspacePatch(state, workspaceId, { errorMessage, errorRawPath: null }, { errorMessage, errorRawPath: null }));
      } finally {
        settleAction(store, token);
      }
    },
  };
}
