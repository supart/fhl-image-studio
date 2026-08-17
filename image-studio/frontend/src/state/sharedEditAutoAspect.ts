import { ReadImageAsBase64 } from "../platform/runtime/host";
import { getImageDimensions, getImageDimensionsFromBase64 } from "../lib/images";
import type {
  BatchProcessAutoAspectResolution,
  BatchProcessSourceImage,
  HistoryItem,
  SourceImage,
  Workspace,
} from "../types/domain";
import { patchWorkspaceRuntime } from "./workspaceRuntime";
import type { StudioState } from "./studioStore.types";
import {
  type ResolutionPreset,
} from "../components/panel/sizeCapabilities";
import {
  autoAspectSizeInputFromState,
  buildAutoAspectSizeFromDimensions,
  nearestSourceAspectPreset,
  normalizedReferenceSlotIndex,
  sourceDimensionsFromMetadata,
  type AutoAspectSizeInput,
  type SourceDimensions,
} from "./autoAspectSizing";

export {
  autoAspectSizeInputFromState,
  buildAutoAspectSizeFromDimensions,
  nearestSourceAspectPreset,
  normalizedReferenceSlotIndex,
  sourceDimensionsFromMetadata,
  type AutoAspectSizeInput,
  type SourceDimensions,
} from "./autoAspectSizing";

type StateAdapter = {
  getState: () => StudioState;
  setState: (patch: Partial<StudioState> | ((state: StudioState) => Partial<StudioState>)) => void;
};

export function activeWorkspaceEditAutoAspectUserLocked(
  state: Pick<StudioState, "activeWorkspaceId" | "workspaces" | "editAutoAspectUserLocked">,
): boolean {
  const workspace = state.workspaces.find((entry) => entry.id === state.activeWorkspaceId);
  return workspace ? workspace.editAutoAspectUserLocked === true : state.editAutoAspectUserLocked === true;
}

type AutoAspectSource = {
  path?: string;
  width?: number;
  height?: number;
  previewWidth?: number;
  previewHeight?: number;
  imageBlob?: Blob | null;
  imageB64?: string | null;
  selected?: boolean;
};

function currentImageAutoAspectSource(
  currentImage: Pick<HistoryItem, "savedPath" | "width" | "height" | "previewWidth" | "previewHeight" | "imageB64" | "imageBlob"> | null | undefined,
): AutoAspectSource | null {
  if (!currentImage) return null;
  return {
    path: currentImage.savedPath || undefined,
    width: currentImage.width,
    height: currentImage.height,
    previewWidth: currentImage.previewWidth,
    previewHeight: currentImage.previewHeight,
    imageB64: currentImage.imageB64 ?? null,
    imageBlob: currentImage.imageBlob ?? null,
  };
}

export function shouldUseSharedEditAutoAspect(
  workspace: Pick<Workspace, "mode" | "editSourceMode" | "batchProcess" | "editAutoAspectUserLocked">,
  options?: {
    ignoreUserLock?: boolean;
  },
): boolean {
  if (workspace.mode !== "edit") return false;
  if (workspace.editSourceMode !== "manual" && workspace.editSourceMode !== "batch") return false;
  if (!workspace.batchProcess.autoAspectResolution) return false;
  if (!options?.ignoreUserLock && workspace.editSourceMode === "manual" && workspace.editAutoAspectUserLocked === true) return false;
  return true;
}

function firstSelectedBatchSource(sources: BatchProcessSourceImage[]): BatchProcessSourceImage | null {
  return sources.find((source) => source.selected !== false && String(source.path || "").trim()) ?? null;
}

function autoAspectSourceForWorkspace(
  workspace: Pick<Workspace, "editSourceMode" | "sources" | "batchProcess">,
  currentImage?: Pick<HistoryItem, "savedPath" | "width" | "height" | "previewWidth" | "previewHeight" | "imageB64" | "imageBlob"> | null,
): AutoAspectSource | null {
  if (workspace.editSourceMode === "batch") {
    const batchSourceSlotIndex = normalizedReferenceSlotIndex(
      workspace.batchProcess.batchSourceSlotIndex,
      workspace.sources.length,
    );
    if (batchSourceSlotIndex === 0) {
      return firstSelectedBatchSource(workspace.batchProcess.discoveredSources) ?? workspace.sources[0] ?? null;
    }
  }
  return workspace.sources[0]
    ?? firstSelectedBatchSource(workspace.batchProcess.discoveredSources)
    ?? currentImageAutoAspectSource(currentImage);
}

async function resolveSourceDimensions(source: AutoAspectSource): Promise<SourceDimensions | null> {
  const cached = sourceDimensionsFromMetadata(source);
  if (cached) return cached;
  const direct = await getImageDimensions(source);
  if (direct?.w && direct?.h) {
    return { width: direct.w, height: direct.h };
  }
  const path = String(source.path || "").trim();
  if (!path) return null;
  const imageB64 = await ReadImageAsBase64(path).catch(() => "");
  const fromPath = imageB64 ? getImageDimensionsFromBase64(imageB64) : null;
  if (!fromPath?.w || !fromPath?.h) return null;
  return { width: fromPath.w, height: fromPath.h };
}

function withSourceDimensions(
  sources: SourceImage[],
  sourcePath: string,
  dimensions: SourceDimensions | null,
): SourceImage[] {
  if (!dimensions) return sources;
  let changed = false;
  const next = sources.map((source) => {
    if (source.path !== sourcePath) return source;
    if (source.width === dimensions.width && source.height === dimensions.height) {
      return source;
    }
    changed = true;
    return {
      ...source,
      width: dimensions.width,
      height: dimensions.height,
    };
  });
  return changed ? next : sources;
}

export function setSharedEditAutoAspectLock(
  store: StateAdapter,
  locked: boolean,
  workspaceId = store.getState().activeWorkspaceId,
): void {
  store.setState((state) => {
    const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
    if (!workspace) return {};
    const workspaceChanged = workspace.editAutoAspectUserLocked !== locked;
    const activeMirrorChanged = state.activeWorkspaceId === workspaceId
      && state.editAutoAspectUserLocked !== locked;
    if (!workspaceChanged && !activeMirrorChanged) return {};
    return {
      ...(workspaceChanged
        ? {
            workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, {
              editAutoAspectUserLocked: locked,
            }),
          }
        : {}),
      ...(activeMirrorChanged ? { editAutoAspectUserLocked: locked } : {}),
    };
  });
}

export async function syncSharedEditAutoAspect(
  store: StateAdapter,
  options?: {
    workspaceId?: string;
    resetUserLock?: boolean;
  },
): Promise<void> {
  const workspaceId = options?.workspaceId ?? store.getState().activeWorkspaceId;
  const before = store.getState();
  const workspace = before.workspaces.find((entry) => entry.id === workspaceId);
  if (!workspace) return;

  const ignoreUserLock = options?.resetUserLock === true;
  const shouldApply = shouldUseSharedEditAutoAspect(workspace, { ignoreUserLock });

  if (!shouldApply) {
    if (options?.resetUserLock) {
      setSharedEditAutoAspectLock(store, false, workspaceId);
    }
    return;
  }

  const primarySource = autoAspectSourceForWorkspace(workspace, before.currentImage);
  const primarySourcePath = String(primarySource?.path || "").trim();
  if (!primarySource || !primarySourcePath) {
    if (options?.resetUserLock) {
      setSharedEditAutoAspectLock(store, false, workspaceId);
    }
    return;
  }

  const dimensions = await resolveSourceDimensions(primarySource);
  const after = store.getState();
  const currentWorkspace = after.workspaces.find((entry) => entry.id === workspaceId);
  if (!currentWorkspace) return;

  const currentPrimarySource = autoAspectSourceForWorkspace(currentWorkspace, after.currentImage);
  const currentPrimarySourcePath = String(currentPrimarySource?.path || "").trim();
  const currentResolution = currentWorkspace.batchProcess.autoAspectResolution as BatchProcessAutoAspectResolution;
  const canApplyNow = shouldUseSharedEditAutoAspect(currentWorkspace, { ignoreUserLock });
  if (!currentPrimarySourcePath || currentPrimarySourcePath !== primarySourcePath || !currentResolution || !canApplyNow) {
    if (options?.resetUserLock) {
      setSharedEditAutoAspectLock(store, false, workspaceId);
    }
    return;
  }

  const nextWorkspaceSources = withSourceDimensions(currentWorkspace.sources, currentPrimarySourcePath, dimensions);
  const nextSize = dimensions
    ? buildAutoAspectSizeFromDimensions(
        currentResolution as Exclude<ResolutionPreset, "auto">,
        dimensions.width,
        dimensions.height,
        autoAspectSizeInputFromState(after),
      )
    : null;

  const shouldUpdateSize = !!nextSize && nextSize !== currentWorkspace.size;
  const shouldUpdateSources = nextWorkspaceSources !== currentWorkspace.sources;
  const shouldResetLock = options?.resetUserLock === true && currentWorkspace.editAutoAspectUserLocked === true;
  if (!shouldUpdateSize && !shouldUpdateSources && !shouldResetLock) return;

  store.setState((state) => {
    const liveWorkspace = state.workspaces.find((entry) => entry.id === workspaceId);
    if (!liveWorkspace) return {};
    const livePrimarySource = autoAspectSourceForWorkspace(liveWorkspace, state.currentImage);
    const livePrimarySourcePath = String(livePrimarySource?.path || "").trim();
    const liveCanApply = shouldUseSharedEditAutoAspect(liveWorkspace, { ignoreUserLock });
    if (!livePrimarySourcePath || livePrimarySourcePath !== primarySourcePath || !liveCanApply) {
      if (options?.resetUserLock && liveWorkspace.editAutoAspectUserLocked === true) {
        return {
          workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, {
            editAutoAspectUserLocked: false,
          }),
          ...(state.activeWorkspaceId === workspaceId ? { editAutoAspectUserLocked: false } : {}),
        };
      }
      return {};
    }

    const patchedSources = withSourceDimensions(liveWorkspace.sources, livePrimarySourcePath, dimensions);
    const sizePatch = dimensions
      ? buildAutoAspectSizeFromDimensions(
          liveWorkspace.batchProcess.autoAspectResolution as Exclude<ResolutionPreset, "auto">,
          dimensions.width,
          dimensions.height,
          autoAspectSizeInputFromState(state),
        )
      : null;
    const workspacePatch: Partial<Workspace> = {
      sources: patchedSources,
      editAutoAspectUserLocked: options?.resetUserLock ? false : liveWorkspace.editAutoAspectUserLocked,
    };
    if (sizePatch) {
      workspacePatch.size = sizePatch;
    }
    const topLevelPatch: Partial<StudioState> = {
      workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, workspacePatch),
    };
    if (state.activeWorkspaceId === workspaceId) {
      topLevelPatch.sources = patchedSources;
      topLevelPatch.editAutoAspectUserLocked = workspacePatch.editAutoAspectUserLocked === true;
      if (sizePatch) {
        topLevelPatch.size = sizePatch;
      }
    }
    return topLevelPatch;
  });
}
