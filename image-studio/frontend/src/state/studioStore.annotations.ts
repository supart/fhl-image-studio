import {
  ReadImageAsBase64,
  RegisterImportedImageAsset,
  RemoveManagedImage,
  SaveImageBlobToOutput,
} from "../platform/runtime/host.ts";
import { base64ToBlob, getImageDimensionsFromBlob } from "../lib/images.ts";
import type { AnnotationCompositeRef, HistoryItem, SourceImage } from "../types/domain";
import type { AnnotationOverflowMode, StudioState } from "./studioStore.types";
import { patchWorkspaceRuntime } from "./workspaceRuntime.ts";
import {
  prepareAnnotationSourceBlob,
  type AnnotationSourceSession,
} from "../features/annotation/annotationSource.ts";
import {
  AnnotationCompositeOverflowError,
  composeAnnotationImage,
} from "../features/annotation/annotationComposite.ts";
import { annotationFontSizeForImage } from "../features/annotation/annotationTypes.ts";

type StateAdapter = {
  getState: () => StudioState;
  setState: (patch: Partial<StudioState> | ((state: StudioState) => Partial<StudioState>)) => void;
};

const preserveAnnotationSubmitWorkspaces = new Set<string>();
const annotationCompositeWorkspaces = new Set<string>();
const annotationSourcePreparingWorkspaces = new Set<string>();

type AnnotationSessionSnapshot = {
  workspaceId: string;
  imageId: string;
  annotations: StudioState["annotations"];
  selectedAnnotationId: StudioState["selectedAnnotationId"];
  undoStack: StudioState["undoStack"];
  redoStack: StudioState["redoStack"];
};

const annotationSessionSnapshots = new Map<string, AnnotationSessionSnapshot>();

function annotationSessionKey(state: StudioState): string {
  const workspaceId = String(state.activeWorkspaceId || "").trim();
  const imageId = String(state.currentImage?.id || "").trim();
  return workspaceId && imageId ? `${workspaceId}:${imageId}` : "";
}

function cloneAnnotationSnapshot(annotations: StudioState["annotations"]): StudioState["annotations"] {
  return annotations.map((annotation) => ({
    ...annotation,
    ...(annotation.points ? { points: annotation.points.slice() } : {}),
  }));
}

function trimHistory(items: HistoryItem[]): HistoryItem[] {
  return items;
}

function persistTrimmedHistory(_items: HistoryItem[]): void {
  // History persistence is handled by persistHistoryItem; this mirrors the
  // existing store helper without importing the host-backed shared module.
}

function cryptoIDFallback(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `annotation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function withMediaAssetRef(item: HistoryItem, ref: {
  imageId?: string;
  savedPath?: string;
  thumbPath?: string;
  previewUrl?: string;
  fullUrl?: string;
  width?: number;
  height?: number;
  previewWidth?: number;
  previewHeight?: number;
}): HistoryItem {
  return {
    ...item,
    imageId: ref.imageId || item.imageId,
    savedPath: ref.savedPath || item.savedPath,
    thumbPath: ref.thumbPath || item.thumbPath,
    previewUrl: ref.previewUrl || item.previewUrl,
    fullUrl: ref.fullUrl || item.fullUrl,
    width: ref.width || item.width,
    height: ref.height || item.height,
    previewWidth: ref.previewWidth || item.previewWidth,
    previewHeight: ref.previewHeight || item.previewHeight,
  };
}

export function markPreserveAnnotationSubmit(workspaceId: string) {
  preserveAnnotationSubmitWorkspaces.add(workspaceId);
}

export function clearPreserveAnnotationSubmit(workspaceId: string) {
  preserveAnnotationSubmitWorkspaces.delete(workspaceId);
}

export function shouldPreserveAnnotationSubmit(workspaceId: string): boolean {
  return preserveAnnotationSubmitWorkspaces.has(workspaceId);
}

export function isAnnotationCompositeBusy(workspaceId: string): boolean {
  return annotationCompositeWorkspaces.has(workspaceId);
}

export function isAnnotationSourcePreparing(workspaceId: string): boolean {
  return annotationSourcePreparingWorkspaces.has(workspaceId);
}

function beginAnnotationSession(store: StateAdapter): void {
  const state = store.getState();
  const key = annotationSessionKey(state);
  if (!key || annotationSessionSnapshots.has(key)) return;
  annotationSessionSnapshots.set(key, {
    workspaceId: state.activeWorkspaceId,
    imageId: state.currentImage?.id ?? "",
    annotations: cloneAnnotationSnapshot(state.annotations),
    selectedAnnotationId: state.selectedAnnotationId,
    undoStack: state.undoStack.slice(),
    redoStack: state.redoStack.slice(),
  });
}

function isAnnotationSessionDirty(store: StateAdapter): boolean {
  const state = store.getState();
  const snapshot = annotationSessionSnapshots.get(annotationSessionKey(state));
  return !!snapshot && !sameAnnotationSnapshot(state.annotations, snapshot.annotations);
}

function cancelAnnotationSession(store: StateAdapter): void {
  const state = store.getState();
  const key = annotationSessionKey(state);
  const snapshot = annotationSessionSnapshots.get(key);
  if (!snapshot || snapshot.workspaceId !== state.activeWorkspaceId || snapshot.imageId !== state.currentImage?.id) {
    store.setState({
      tool: "pan",
      annotationSource: null,
      selectedAnnotationId: null,
      workspaceCanvasRuntime: {
        ...state.workspaceCanvasRuntime,
        [state.activeWorkspaceId]: {
          ...state.workspaceCanvasRuntime[state.activeWorkspaceId],
          tool: "pan",
          selectedAnnotationId: null,
        },
      },
    });
    if (key) annotationSessionSnapshots.delete(key);
    return;
  }
  const annotations = cloneAnnotationSnapshot(snapshot.annotations);
  const workspaceCanvasRuntime = {
    ...state.workspaceCanvasRuntime,
    [state.activeWorkspaceId]: {
      ...state.workspaceCanvasRuntime[state.activeWorkspaceId],
      tool: "pan" as const,
      selectedAnnotationId: snapshot.selectedAnnotationId,
      annotations,
      undoStack: snapshot.undoStack.slice(),
      redoStack: snapshot.redoStack.slice(),
    },
  };
  store.setState({
    tool: "pan",
    annotationSource: null,
    annotations,
    selectedAnnotationId: snapshot.selectedAnnotationId,
    undoStack: snapshot.undoStack.slice(),
    redoStack: snapshot.redoStack.slice(),
    workspaceCanvasRuntime,
  });
  annotationSessionSnapshots.delete(key);
}

function endAnnotationSession(store: StateAdapter): void {
  const key = annotationSessionKey(store.getState());
  if (key) annotationSessionSnapshots.delete(key);
}

function currentWorkspaceSources(state: StudioState, workspaceId: string): SourceImage[] | null {
  const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
  if (!workspace) return null;
  return state.activeWorkspaceId === workspaceId ? state.sources : workspace.sources;
}

function sameAnnotationSnapshot(a: StudioState["annotations"], b: StudioState["annotations"]): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function withoutAnnotationUndoEntries<T extends { label?: string }>(entries: T[]): T[] {
  return entries.filter((entry) => !new Set(["annotation", "remove-annotation", "clear-annotations"]).has(String(entry.label || "")));
}

async function hasDecodableNaturalDimensions(blob: Blob): Promise<boolean> {
  const binaryDimensions = await getImageDimensionsFromBlob(blob);
  if (binaryDimensions && binaryDimensions.w > 0 && binaryDimensions.h > 0) return true;
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      const valid = bitmap.width > 0 && bitmap.height > 0;
      bitmap.close();
      if (valid) return true;
    } catch {
      // SVG and other browser-decodable formats may not expose binary headers.
    }
  }
  if (typeof document === "undefined" || typeof URL === "undefined") return false;
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("无法解码原图"));
      element.src = url;
    });
    return image.naturalWidth > 0 && image.naturalHeight > 0;
  } catch {
    return false;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadFullAnnotationSource(item: HistoryItem): Promise<{ item: HistoryItem; blob: Blob }> {
  const candidates: Array<() => Promise<Blob | null>> = [];
  if (item.imageBlob) candidates.push(async () => item.imageBlob ?? null);
  if (item.imageB64) candidates.push(async () => base64ToBlob(item.imageB64 || ""));
  const fullUrl = String(item.fullUrl || "").trim();
  if (fullUrl && !/\/media\/(?:thumb|preview)\//i.test(fullUrl) && typeof fetch === "function") {
    candidates.push(async () => {
      const response = await fetch(fullUrl);
      return response.ok ? response.blob() : null;
    });
  }
  const previewUrl = String(item.previewUrl || "").trim();
  // Dev preview fixtures use a complete data URL rather than a thumbnail.
  // Treat only self-contained data/blob sources as readable media; hosted
  // preview URLs remain intentionally ineligible for natural-pixel synthesis.
  if (/^(data:|blob:)/i.test(previewUrl)) {
    candidates.push(async () => {
      const response = await fetch(previewUrl);
      return response.ok ? response.blob() : null;
    });
  }
  if (item.savedPath) {
    candidates.push(async () => {
      const b64 = await ReadImageAsBase64(item.savedPath || "");
      return b64 ? base64ToBlob(b64) : null;
    });
  }
  for (const load of candidates) {
    try {
      const blob = await load();
      if (blob && await hasDecodableNaturalDimensions(blob)) return { item, blob };
    } catch {
      // Try the next complete-media source. Preview URLs are never a fallback.
    }
  }
  throw new Error("无法确认原图自然像素尺寸，已阻止标注合成");
}

export function createAnnotationActions(
  store: StateAdapter,
  deps: {
    reuseAsSource: (item: HistoryItem) => Promise<void>;
  },
) {
  return {
    beginAnnotationSession: () => beginAnnotationSession(store),
    isAnnotationSessionDirty: () => isAnnotationSessionDirty(store),
    cancelAnnotationSession: () => cancelAnnotationSession(store),
    endAnnotationSession: () => endAnnotationSession(store),
    async prepareAnnotationSource() {
      const initial = store.getState();
      const workspaceId = initial.activeWorkspaceId;
      const current = initial.currentImage;
      if (!current) {
        initial.pushToast("当前没有图片可供标注", "warn", 2800);
        return false;
      }
      if (initial.annotationSource?.sourceHistoryId === current.id) return true;
      if (annotationSourcePreparingWorkspaces.has(workspaceId)) return false;
      annotationSourcePreparingWorkspaces.add(workspaceId);
      try {
        const materialized = typeof initial.materializeCurrentImage === "function"
          ? await initial.materializeCurrentImage(current).catch(() => current)
          : current;
        const source = await loadFullAnnotationSource(materialized);
        const prepared = await prepareAnnotationSourceBlob(source.blob);
        const latest = store.getState();
        if (latest.activeWorkspaceId !== workspaceId || latest.currentImage?.id !== current.id) return false;
        const session: AnnotationSourceSession = {
          sourceHistoryId: current.id,
          blob: prepared.blob,
          width: prepared.width,
          height: prepared.height,
          originalWidth: prepared.originalWidth,
          originalHeight: prepared.originalHeight,
          targetResolution: "4k",
          targetSize: prepared.targetSize,
        };
        const defaultFontSize = annotationFontSizeForImage(prepared.width, prepared.height);
        store.setState((state) => ({
          annotationSource: session,
          annotationFontSize: defaultFontSize,
          ...(state.workspaceCanvasRuntime[workspaceId]
            ? {
                workspaceCanvasRuntime: {
                  ...state.workspaceCanvasRuntime,
                  [workspaceId]: {
                    ...state.workspaceCanvasRuntime[workspaceId],
                    annotationFontSize: defaultFontSize,
                  },
                },
              }
            : {}),
        }));
        if (prepared.width !== prepared.originalWidth || prepared.height !== prepared.originalHeight) {
          latest.pushToast(
            `标注工作台已压缩为 ${prepared.width}×${prepared.height}（4K上限），原图仍保留`,
            "info",
            2800,
          );
        }
        return true;
      } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error || "未知错误");
        store.getState().pushToast(`图像标注准备失败：${message}`, "error", 4600);
        return false;
      } finally {
        annotationSourcePreparingWorkspaces.delete(workspaceId);
      }
    },

    async confirmAnnotationComposite(mode: AnnotationOverflowMode = "strict") {
      const initial = store.getState();
      const workspaceId = initial.activeWorkspaceId;
      const current = initial.currentImage;
      const annotations = initial.annotations.map((annotation) => ({ ...annotation, points: annotation.points?.slice() }));
      if (!current) {
        initial.pushToast("当前没有图片可供确认标注", "warn", 2800);
        return "cancelled" as const;
      }
      if (annotations.length === 0) {
        initial.pushToast("请先添加至少一条标注", "warn", 2800);
        return "cancelled" as const;
      }
      if (isAnnotationCompositeBusy(workspaceId)) {
        initial.pushToast("标注合成正在准备，请勿重复点击", "info", 2200);
        return "cancelled" as const;
      }
      annotationCompositeWorkspaces.add(workspaceId);
      let temporaryPath = "";
      let outputPath = "";
      let committed = false;
      const annotationSignature = JSON.stringify(annotations);
      const assertLive = () => {
        const state = store.getState();
        if (state.activeWorkspaceId !== workspaceId || state.currentImage?.id !== current.id
          || JSON.stringify(state.annotations) !== annotationSignature) {
          throw new Error("标注工作区已变化，已取消本次合成");
        }
      };
      const cleanup = async () => {
        const paths = [temporaryPath, outputPath]
          .map((path) => path.trim())
          .filter((path, index, all) => path && all.indexOf(path) === index);
        await Promise.all(paths.map((path) => RemoveManagedImage(path).catch(() => undefined)));
      };
      try {
        const preparedSource = initial.annotationSource?.sourceHistoryId === current.id
          ? initial.annotationSource
          : null;
        const materialized = preparedSource
          ? current
          : typeof initial.materializeCurrentImage === "function"
            ? await initial.materializeCurrentImage(current).catch(() => current)
            : current;
        assertLive();
        const source = preparedSource ?? await loadFullAnnotationSource(materialized);
        assertLive();
        const composite = await composeAnnotationImage({ blob: source.blob }, annotations, mode);
        assertLive();
        const suggestedName = `annotation-composite-${Date.now()}.png`;
        // Write the completed PNG directly as bytes in browser preview. This
        // avoids virtual paths and oversized base64 JSON for large originals.
        outputPath = String(await SaveImageBlobToOutput(composite.blob, suggestedName) || "").trim();
        temporaryPath = outputPath;
        if (!outputPath) throw new Error("无法将标注合成图保存到 Output");
        assertLive();
        const outputRef = await RegisterImportedImageAsset(outputPath);
        if (!outputRef) throw new Error("无法注册标注合成图媒体");
        const registeredWidth = Number(outputRef.width || 0);
        const registeredHeight = Number(outputRef.height || 0);
        if ((registeredWidth && registeredWidth !== composite.outputWidth)
          || (registeredHeight && registeredHeight !== composite.outputHeight)) {
          throw new Error(`标注合成输出尺寸 ${registeredWidth}×${registeredHeight} 与实际 ${composite.outputWidth}×${composite.outputHeight} 不一致`);
        }
        const savedPath = String(outputRef.savedPath || outputPath).trim();
        const compositeRef: AnnotationCompositeRef = {
          version: 1,
          kind: "annotation-composite",
          sourceHistoryId: current.id,
          sourcePath: current.savedPath,
          outputPath: savedPath,
          sourceWidth: composite.sourceWidth,
          sourceHeight: composite.sourceHeight,
          width: composite.outputWidth,
          height: composite.outputHeight,
          offsetX: composite.offsetX,
          offsetY: composite.offsetY,
          expanded: composite.expanded,
        };
        const compositeSource: SourceImage = {
          path: savedPath,
          name: suggestedName,
          size: 0,
          width: composite.outputWidth,
          height: composite.outputHeight,
          previewUrl: outputRef.previewUrl,
          localEditRoundtrip: undefined,
        };
        const latest = store.getState();
        const existingSources = currentWorkspaceSources(latest, workspaceId);
        if (!existingSources) throw new Error("目标工作区不存在");
        const nextSources = existingSources.some((sourceItem) => sourceItem.path === savedPath)
          ? existingSources
          : [...existingSources, compositeSource];
        const nextItemBase: HistoryItem = {
          id: cryptoIDFallback(),
          prompt: current.prompt || "",
          revisedPrompt: current.revisedPrompt,
          mode: "edit",
          apiMode: current.apiMode,
          apiProfileId: current.apiProfileId,
          apiProfileName: current.apiProfileName,
          fhlImagesPoolSlot: current.fhlImagesPoolSlot,
          size: `${composite.outputWidth}x${composite.outputHeight}` as HistoryItem["size"],
          quality: current.quality,
          outputFormat: "png",
          parentId: current.id,
          createdAt: Date.now(),
          savedPath,
          width: composite.outputWidth,
          height: composite.outputHeight,
          previewWidth: outputRef.previewWidth || composite.outputWidth,
          previewHeight: outputRef.previewHeight || composite.outputHeight,
          sourceImages: [compositeSource],
          annotationComposite: compositeRef,
        };
        const nextItem = withMediaAssetRef(nextItemBase, outputRef);
        // Persist before mutating runtime state so an IndexedDB failure cannot
        // leave a reference slot pointing at an unrecorded result.
        const { persistHistoryItem: saveHistoryItem } = await import("../lib/storage.ts");
        await saveHistoryItem(nextItem);
        assertLive();
        store.setState((state) => {
          if (state.activeWorkspaceId !== workspaceId || !sameAnnotationSnapshot(state.annotations, annotations)) return {};
          committed = true;
          const workspaceSources = currentWorkspaceSources(state, workspaceId) ?? nextSources;
          const mergedSources = workspaceSources.some((sourceItem) => sourceItem.path === savedPath)
            ? workspaceSources
            : [...workspaceSources, compositeSource];
          const active = state.activeWorkspaceId === workspaceId;
          return {
            history: trimHistory([nextItem, ...state.history.filter((item) => item.id !== nextItem.id)]),
            annotations: [],
            annotationSource: null,
            selectedAnnotationId: null,
            undoStack: withoutAnnotationUndoEntries(state.undoStack),
            redoStack: withoutAnnotationUndoEntries(state.redoStack),
            workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, {
              currentImageId: nextItem.id,
              sources: mergedSources,
              mode: "edit",
              editSourceMode: state.editSourceMode === "batch" ? "batch" : "manual",
            }),
            ...(active ? {
              currentImage: nextItem,
              sources: mergedSources,
              mode: "edit" as const,
              editSourceMode: state.editSourceMode === "batch" ? "batch" as const : "manual" as const,
              resultGridOpen: false,
              historyGalleryOpen: false,
              historyGallerySinglePreviewId: null,
              compareB: null,
              maskDataURL: null,
              errorMessage: null,
              errorRawPath: null,
              tool: "pan" as const,
            } : {}),
          } as Partial<StudioState>;
        });
        if (!committed) throw new Error("标注工作区已变化，已取消本次合成");
        annotationSessionSnapshots.delete(`${workspaceId}:${current.id}`);
        persistTrimmedHistory(store.getState().history);
        if (temporaryPath && temporaryPath !== savedPath) await RemoveManagedImage(temporaryPath).catch(() => undefined);
        store.getState().pushToast(
          composite.expanded
            ? `已扩展白底并保存标注图 ${composite.outputWidth}×${composite.outputHeight}，已追加到参考图`
            : `已保存标注图 ${composite.outputWidth}×${composite.outputHeight}，已追加到参考图`,
          "success",
          3400,
        );
        return "saved" as const;
      } catch (error: any) {
        if (!committed) await cleanup();
        if (error instanceof AnnotationCompositeOverflowError) {
          return "overflow" as const;
        }
        const message = error instanceof Error ? error.message : String(error || "未知错误");
        if (!/标注工作区已变化/.test(message)) {
          store.getState().pushToast(`确认标注失败：${message}`, "error", 4600);
        } else {
          store.getState().pushToast(message, "info", 3200);
        }
        return "cancelled" as const;
      } finally {
        annotationCompositeWorkspaces.delete(workspaceId);
      }
    },

    async submitAnnotationEdit() {
      const initial = store.getState();
      const current = initial.currentImage;
      const workspaceId = initial.activeWorkspaceId;
      if (!current) {
        initial.pushToast("当前没有图片可供批注修图", "warn", 2800);
        return;
      }
      if (initial.annotations.length === 0) {
        initial.pushToast("请先添加至少一条批注", "warn", 2800);
        return;
      }
      if (shouldPreserveAnnotationSubmit(workspaceId)) {
        initial.pushToast("批注修图正在准备，请勿重复提交", "info", 2200);
        return;
      }

      markPreserveAnnotationSubmit(workspaceId);
      try {
        try {
          await deps.reuseAsSource(current);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error || "未知错误");
          const state = store.getState();
          state.pushToast(`批注修图源图准备失败：${message}`, "error", 4200);
          return;
        }
        const state = store.getState();
        if (state.activeWorkspaceId !== workspaceId) {
          state.pushToast("工作区已切换，已取消本次批注修图", "info", 3000);
          return;
        }
        const materializedCurrent = state.currentImage?.id === current.id ? state.currentImage : current;
        const sourcePath = String(materializedCurrent.savedPath || "").trim();
        const source: SourceImage | undefined = sourcePath
          ? state.sources.find((candidate) => candidate.path === sourcePath)
          : undefined;
        if (!source) {
          state.pushToast("当前图片无法作为本地编辑源，请先保存或重新导入", "error", 4200);
          return;
        }

        const prompt = state.prompt.trim() || "请根据当前图片上的批注修改原图";
        store.setState((next) => ({
          mode: "edit",
          editSourceMode: "manual",
          prompt,
          sources: [source],
          workspaces: patchWorkspaceRuntime(next.workspaces, workspaceId, {
            mode: "edit",
            editSourceMode: "manual",
            prompt,
            sources: [source],
          }),
        }));
        await store.getState().submit();
      } finally {
        clearPreserveAnnotationSubmit(workspaceId);
      }
    },
  };
}
