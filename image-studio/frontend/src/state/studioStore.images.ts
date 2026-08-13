import {
  OpenImageDialog,
  ImportImageFromB64,
  RegisterImportedImageAsset,
  SaveImageAs,
  SaveImagePathAs,
  ShareImageAs,
  ShareImagePathAs,
} from "../platform/runtime/host";
import { shareImageForPlatform, shareImagePathForPlatform, saveImageForPlatform } from "../platform/android/bridge";
import { base64ToBlob } from "../lib/images";
import { suggestImageFileName, suggestManualSaveImageFileName } from "../lib/imageFileNames";
import { removeHistoryItem } from "../lib/storage";
import type { HistoryItem, JobGroupSnapshot, JobSlotSnapshot, SourceImage } from "../types/domain";
import type { StudioState } from "./studioStore.types";
import { sourceImagesFromHistoryItem } from "./historySourceImages";
import {
  ensureFullHistoryItem,
  fileToBase64,
  materializeHistoryItem,
  toPreviewOnlyHistoryItem,
  withMediaAssetRef,
} from "./studioStore.runtime";
import { patchWorkspaceRuntime } from "./workspaceRuntime";
import { genId } from "./studioStore.shared";
import { rememberReversePromptImage } from "./reversePromptImageCache";

type StateAdapter = {
  getState: () => StudioState;
  setState: (patch: Partial<StudioState> | ((state: StudioState) => Partial<StudioState>)) => void;
};

function pathLeaf(filePath: string): string {
  const normalized = String(filePath || "").trim().replace(/[\\/]+$/, "");
  if (!normalized) return "image.png";
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || "image.png";
}

function sourceImagesFromJobPaths(paths: string[] | undefined): SourceImage[] {
  return (paths ?? [])
    .map((filePath) => String(filePath || "").trim())
    .filter(Boolean)
    .map((filePath) => ({
      path: filePath,
      name: pathLeaf(filePath),
      size: 0,
    }));
}

export function createImageActions(store: StateAdapter) {
  async function materializeForShare(item: HistoryItem): Promise<HistoryItem> {
    return await ensureFullHistoryItem(item, {
      setState: (fn) => store.setState((state) => fn(state)),
    }) ?? item;
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
        const baseName = res.path.split(/[\\/]/).pop() ?? res.path;
        const existing = store.getState().sources;
        if (existing.some((source) => source.path === res.path)) {
          store.setState({ mode: "edit", errorMessage: null, errorRawPath: null });
          return;
        }
        store.setState({
          sources: [...existing, {
            path: res.path,
            name: baseName,
            size: res.size,
            imageB64: res.previewUrl ? undefined : res.imageB64 || undefined,
            imageBlob: res.previewUrl ? null : res.imageB64 ? base64ToBlob(res.imageB64) : null,
            previewUrl: res.previewUrl,
          }],
          mode: "edit",
          errorMessage: null,
          errorRawPath: null,
        });
      } catch (error: any) {
        store.setState({ errorMessage: `选择图片失败:${error?.message ?? error}`, errorRawPath: null });
      }
    },

    async selectReversePromptImage() {
      try {
        const res = await OpenImageDialog();
        if (!res || (!res.path && !res.imageB64 && !res.previewUrl)) return;
        const baseName = res.path ? (res.path.split(/[\\/]/).pop() ?? res.path) : "reverse-prompt-image.png";
        const imageB64 = res.imageB64 || "";
        const reversePromptImage = {
          path: res.path || "",
          name: baseName,
          size: res.size || 0,
          imageB64: imageB64 || undefined,
          imageBlob: imageB64 ? base64ToBlob(imageB64) : null,
          previewUrl: res.previewUrl,
        };
        rememberReversePromptImage(reversePromptImage);
        store.setState({
          reversePromptImage,
          errorMessage: null,
          errorRawPath: null,
        });
        store.getState().pushToast("已导入反推图片", "success", 2200);
      } catch (error: any) {
        store.setState({ errorMessage: `选择反推图片失败:${error?.message ?? error}`, errorRawPath: null });
      }
    },

    async importReversePromptImageFile(file: File) {
      try {
        if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
          store.setState({ errorMessage: `不支持的图片类型:${file.type || "(未知)"},请用 PNG/JPG/WebP`, errorRawPath: null });
          return;
        }
        const b64 = await fileToBase64(file);
        const reversePromptImage = {
          path: "",
          name: file.name || "reverse-prompt-image.png",
          size: file.size || 0,
          imageB64: b64,
          imageBlob: base64ToBlob(b64, file.type || "image/png"),
        };
        rememberReversePromptImage(reversePromptImage);
        store.setState({
          reversePromptImage,
          errorMessage: null,
          errorRawPath: null,
        });
        store.getState().pushToast("已导入反推图片", "success", 2200);
      } catch (error: any) {
        store.setState({ errorMessage: `导入反推图片失败:${error?.message ?? error}`, errorRawPath: null });
      }
    },

    clearReversePromptImage() {
      rememberReversePromptImage(null);
      store.setState({ reversePromptImage: null });
    },

    removeSource(index: number) {
      const next = store.getState().sources.filter((_, i) => i !== index);
      store.setState({ sources: next });
    },

    clearSources() {
      store.setState({ sources: [] });
    },

    reorderSources(from: number, to: number) {
      const list = [...store.getState().sources];
      if (from < 0 || from >= list.length || to < 0 || to >= list.length) return;
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      store.setState({ sources: list });
    },

    async reuseAsSource(item: HistoryItem) {
      let localItem = await materializeHistoryItem(item, {
        setState: (fn) => store.setState((state) => fn(state)),
      }).catch((e: any) => {
        store.setState({ errorMessage: `源图准备失败:${e?.message ?? e}`, errorRawPath: null });
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
      store.setState({
        mode: "edit",
        currentImage: toPreviewOnlyHistoryItem(localItem),
        resultGridOpen: false,
        sources: alreadyIn
          ? existing
          : [...existing, {
              path: savedPath,
              name: baseName,
              size: 0,
              imageBlob: localItem.previewUrl ? null : (localItem.previewBlob ?? localItem.imageBlob ?? null),
              imageB64: localItem.previewUrl ? undefined : localItem.imageB64,
              previewUrl: localItem.previewUrl,
            }],
      });
    },

    applyHistoryParams(item: HistoryItem) {
      const sourceImages: SourceImage[] = item.mode === "edit" ? sourceImagesFromHistoryItem(item) : [];
      const patch: Partial<StudioState> = {
        promptPrefix: "",
        prompt: item.prompt ?? "",
        mode: item.mode,
        size: item.size,
        quality: item.quality,
        sources: sourceImages,
      };
      if (item.seed !== undefined) patch.seed = item.seed;
      if (item.negativePrompt !== undefined) patch.negativePrompt = item.negativePrompt;
      if (item.styleTag !== undefined) patch.styleTag = item.styleTag;
      if (item.outputFormat) patch.outputFormat = item.outputFormat;
      store.setState(patch);
      const sourceNote = item.mode === "edit" && sourceImages.length > 0 ? `和 ${sourceImages.length} 张输入图` : "";
      store.getState().pushToast(`已应用此图的参数${sourceNote}到控制台`, "success");
    },

    applyJobSlotParams(group: JobGroupSnapshot, slot: JobSlotSnapshot) {
      const sourceImages: SourceImage[] = group.mode === "edit" ? sourceImagesFromJobPaths(group.sourceImagePaths) : [];
      const seedBase = Number.isFinite(Number(group.seed)) ? Number(group.seed) : 0;
      const patch: Partial<StudioState> = {
        promptPrefix: "",
        prompt: group.prompt ?? "",
        mode: group.mode,
        size: group.size,
        quality: group.quality,
        outputFormat: group.outputFormat,
        seed: seedBase > 0 ? seedBase + slot.batchIndex : seedBase,
        negativePrompt: group.negativePrompt ?? "",
        styleTag: group.styleTag ?? "",
        sources: sourceImages,
        resultGridOpen: false,
      };
      store.setState(patch);
      const sourceNote = group.mode === "edit" && sourceImages.length > 0 ? `和 ${sourceImages.length} 张输入图` : "";
      store.getState().pushToast(`已应用第 ${slot.batchIndex + 1} 张任务参数${sourceNote}，未重新生成`, "success");
    },

    async regenerateJobSlot(group: JobGroupSnapshot, slot: JobSlotSnapshot) {
      this.applyJobSlotParams(group, slot);
      await Promise.resolve();
      await store.getState().submit();
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
        const msg = `保存失败:${e?.message ?? e}`;
        store.setState({ errorMessage: msg, errorRawPath: null });
        store.getState().pushToast(msg, "error");
      }
    },

    async saveHistoryItemAs(item: HistoryItem) {
      try {
        const saved = await saveHistoryImageToAlbum(item);
        if (saved) store.getState().pushToast("已保存", "success");
      } catch (e: any) {
        const msg = `保存失败:${e?.message ?? e}`;
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
        const msg = `分享失败:${e?.message ?? e}`;
        store.setState({ errorMessage: msg, errorRawPath: null });
        store.getState().pushToast(msg, "error");
      }
    },

    async shareHistoryItem(item: HistoryItem) {
      try {
        await shareHistoryImage(item);
        store.getState().pushToast("已打开系统分享", "success");
      } catch (e: any) {
        const msg = `分享失败:${e?.message ?? e}`;
        store.setState({ errorMessage: msg, errorRawPath: null });
        store.getState().pushToast(msg, "error");
      }
    },

    async importImageFile(file: File) {
      try {
        if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
          store.setState({ errorMessage: `不支持的图片类型:${file.type || "(未知)"},请用 PNG/JPG/WebP`, errorRawPath: null });
          return;
        }
        const b64 = await fileToBase64(file);
        const result = await ImportImageFromB64(b64, file.name);
        const ref = await RegisterImportedImageAsset(result.path).catch(() => null);
        const legacyB64 = result.previewUrl || ref?.previewUrl ? "" : (result.imageB64 || b64);
        const legacyBlob = legacyB64 ? base64ToBlob(legacyB64) : null;
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
        };
        const importedItem = ref ? withMediaAssetRef(transientItem, ref) : transientItem;
        const existingSources = store.getState().sources;
        const alreadyIn = existingSources.some((source) => source.path === result.path);
        store.setState({
          currentImage: ref ? { ...importedItem, previewOnly: true } : importedItem,
          batchResults: [],
          resultGridOpen: false,
          mode: "edit",
          sources: alreadyIn
            ? existingSources
            : [...existingSources, {
                path: result.path,
                name: file.name,
                size: file.size,
                imageBlob: legacyBlob,
                imageB64: legacyB64 || undefined,
                previewUrl: importedItem.previewUrl,
              }],
          errorMessage: null,
          errorRawPath: null,
        });
      } catch (e: any) {
        store.setState({ errorMessage: `导入失败:${e?.message ?? e}`, errorRawPath: null });
      }
    },
  };
}
