import { DEFAULT_FHL_SIZE } from "../lib/generationDefaults.ts";
import type { FHLTransportMode, OutputFormatValue, Workspace } from "../types/domain";
import { defaultBatchProcessConfig } from "./workspaceRuntime.ts";

export interface WorkspaceDefaultsOptions {
  activeProfileId?: string;
  fhlTransportMode?: FHLTransportMode;
}

export const WORKSPACE_DEFAULT_FIELD_KEYS = [
  "id", "name", "activeProfileId", "fhlTransportMode",
  "promptPrefix", "prompt", "optimizationGuidance", "negativePrompt",
  "mode", "size", "quality", "outputFormat", "seed", "batchCount",
  "continuousGenerateTest", "editSourceMode", "editAutoAspectUserLocked",
  "batchProcess", "styleTag", "sources", "reversePromptImage",
  "currentImageId", "batchResultIds", "batchTaskIds", "selectedBatchTaskId",
  "batchSinglePreviewOpen", "resultGridOpen", "historyGalleryOpen",
  "historyGallerySinglePreviewId", "historyGallerySort", "runningJobIds",
  "jobsTotal", "jobsCompleted", "jobsFailed", "progress", "streamPreview",
  "streamPreviews", "lastLogLine", "errorMessage", "errorRawPath", "lastPayload",
  "localEditWorkbenchDraft",
] as const satisfies readonly (keyof Workspace)[];

export function createDefaultWorkspace(
  id: string,
  outputFormat: OutputFormatValue = "png",
  name = "图片 1",
  options: WorkspaceDefaultsOptions = {},
): Workspace {
  return {
    id,
    name,
    activeProfileId: options.activeProfileId?.trim() ?? "",
    fhlTransportMode: options.fhlTransportMode ?? "images",
    promptPrefix: "",
    prompt: "",
    optimizationGuidance: "",
    negativePrompt: "",
    mode: "generate",
    size: DEFAULT_FHL_SIZE,
    quality: "medium",
    outputFormat,
    seed: 0,
    batchCount: 1,
    continuousGenerateTest: false,
    editSourceMode: "manual",
    editAutoAspectUserLocked: false,
    batchProcess: defaultBatchProcessConfig(),
    styleTag: "",
    sources: [],
    reversePromptImage: null,
    currentImageId: null,
    batchResultIds: [],
    batchTaskIds: [],
    selectedBatchTaskId: null,
    batchSinglePreviewOpen: false,
    resultGridOpen: false,
    historyGalleryOpen: false,
    historyGallerySinglePreviewId: null,
    historyGallerySort: "newest",
    runningJobIds: [],
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
    localEditWorkbenchDraft: null,
  };
}
