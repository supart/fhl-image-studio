import type { backend } from "../../wailsjs/go/models";
import type {
  BatchProcessAutoAspectResolution,
  BatchProcessConfig,
  BatchProcessSourceImage,
  EditSourceMode,
  ProgressInfo,
  StreamPreview,
  StreamPreviewMap,
  Workspace,
} from "../types/domain";
import { providerModeLabel } from "../lib/providerPolicy.ts";

export type APIModeValue = "responses" | "images" | "apimart" | "runninghub";

export interface RunningJobMeta {
  workspaceId: string;
  apiMode: APIModeValue;
  apiProfileId?: string;
}

export interface WorkspacePatch extends Partial<Workspace> {
  runningJobs?: string[];
  runningJobIds?: string[];
}

export interface WorkspaceRuntimeState {
  activeWorkspaceId: string;
  runningJobs: string[];
  jobsTotal: number;
  jobsCompleted: number;
  jobsFailed: number;
  progress: ProgressInfo | null;
  streamPreview: StreamPreview | null;
  streamPreviews?: StreamPreviewMap;
  lastLogLine: string;
  errorMessage: string | null;
  errorRawPath: string | null;
  lastPayload: backend.GenerateOptions | null;
  workspaces: Workspace[];
}

export interface WorkspaceRuntimeMirror {
  runningJobs: string[];
  jobsTotal: number;
  jobsCompleted: number;
  jobsFailed: number;
  progress: ProgressInfo | null;
  streamPreview: StreamPreview | null;
  streamPreviews: StreamPreviewMap;
  lastLogLine: string;
  errorMessage: string | null;
  errorRawPath: string | null;
  lastPayload: backend.GenerateOptions | null;
  isRunning: boolean;
}

export function normalizeAPIMode(mode: string): APIModeValue {
  const value = String(mode).trim();
  if (value === "images") return "images";
  if (value === "apimart") return "apimart";
  if (value === "runninghub") return "runninghub";
  return "responses";
}

export function apiModeLabel(mode: string): string {
  return providerModeLabel(normalizeAPIMode(mode));
}

export function normalizeConcurrencyLimit(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function normalizeBatchCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(9, Math.floor(n)));
}

export const DEFAULT_BATCH_PROCESS_CONCURRENCY = 2;
export const MAX_BATCH_PROCESS_CONCURRENCY = 9;

export function normalizeEditSourceMode(value: unknown): EditSourceMode {
  return value === "batch" ? "batch" : "manual";
}

export function defaultBatchProcessConfig(): BatchProcessConfig {
  return {
    inputDir: "",
    outputMode: "source_dir",
    outputDir: "",
    concurrency: DEFAULT_BATCH_PROCESS_CONCURRENCY,
    retryOnFailure: false,
    autoAspectResolution: "1k",
    batchSourceSlotIndex: 0,
    discoveredSources: [],
  };
}

export function normalizeBatchProcessAutoAspectResolution(value: unknown): BatchProcessAutoAspectResolution {
  return value === "1k" || value === "2k" || value === "4k"
    ? value
    : "";
}

export function normalizeBatchProcessConcurrency(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_BATCH_PROCESS_CONCURRENCY;
  return Math.max(1, Math.min(MAX_BATCH_PROCESS_CONCURRENCY, Math.floor(n)));
}

function isVolatileMemoryPath(value: unknown): boolean {
  return typeof value === "string" && value.trim().startsWith("memory://");
}

export function normalizeBatchProcessConfig(value: unknown): BatchProcessConfig {
  const source = value && typeof value === "object"
    ? value as Partial<BatchProcessConfig>
    : {};
  const rawAutoAspectResolution = source.autoAspectResolution;
  const discoveredSources: BatchProcessSourceImage[] = [];
  if (Array.isArray(source.discoveredSources)) {
    for (const item of source.discoveredSources) {
      if (!item || typeof item !== "object") continue;
      const candidate = item as Partial<BatchProcessSourceImage>;
      const itemPath = typeof candidate.path === "string" ? candidate.path.trim() : "";
      const itemName = typeof candidate.name === "string" ? candidate.name.trim() : "";
      if (!itemPath || !itemName) continue;
      discoveredSources.push({
        path: itemPath,
        name: itemName,
        size: Number.isFinite(Number(candidate.size)) ? Math.max(0, Math.floor(Number(candidate.size))) : 0,
        width: Number.isFinite(Number(candidate.width)) ? Math.floor(Number(candidate.width)) : undefined,
        height: Number.isFinite(Number(candidate.height)) ? Math.floor(Number(candidate.height)) : undefined,
        previewUrl: typeof candidate.previewUrl === "string" && candidate.previewUrl.trim()
          ? candidate.previewUrl
          : undefined,
        previewWidth: Number.isFinite(Number(candidate.previewWidth)) ? Math.floor(Number(candidate.previewWidth)) : undefined,
        previewHeight: Number.isFinite(Number(candidate.previewHeight)) ? Math.floor(Number(candidate.previewHeight)) : undefined,
        selected: candidate.selected !== false,
      });
    }
  }
  const inputDir = typeof source.inputDir === "string" ? source.inputDir.trim() : "";
  return {
    inputDir: isVolatileMemoryPath(inputDir) ? "" : inputDir,
    outputMode: source.outputMode === "custom_dir" ? "custom_dir" : "source_dir",
    outputDir: typeof source.outputDir === "string" ? source.outputDir.trim() : "",
    concurrency: normalizeBatchProcessConcurrency(source.concurrency),
    retryOnFailure: source.retryOnFailure === true,
    autoAspectResolution: rawAutoAspectResolution === ""
      ? ""
      : normalizeBatchProcessAutoAspectResolution(rawAutoAspectResolution) || "1k",
    batchSourceSlotIndex: Number.isFinite(Number(source.batchSourceSlotIndex))
      ? Math.max(0, Math.floor(Number(source.batchSourceSlotIndex)))
      : 0,
    discoveredSources,
  };
}

export function patchWorkspaceRuntime(workspaces: Workspace[], workspaceId: string, patch: WorkspacePatch): Workspace[] {
  return workspaces.map((w) => {
    if (w.id !== workspaceId) return w;
    const next: Workspace = { ...w };
    if (patch.name !== undefined) next.name = patch.name;
    if (patch.promptPrefix !== undefined) next.promptPrefix = patch.promptPrefix;
    if (patch.prompt !== undefined) next.prompt = patch.prompt;
    if (patch.optimizationGuidance !== undefined) next.optimizationGuidance = patch.optimizationGuidance;
    if (patch.negativePrompt !== undefined) next.negativePrompt = patch.negativePrompt;
    if (patch.mode !== undefined) next.mode = patch.mode;
    if (patch.size !== undefined) next.size = patch.size;
    if (patch.quality !== undefined) next.quality = patch.quality;
    if (patch.outputFormat !== undefined) next.outputFormat = patch.outputFormat;
    if (patch.seed !== undefined) next.seed = patch.seed;
    if (patch.batchCount !== undefined) next.batchCount = patch.batchCount;
    if (patch.continuousGenerateTest !== undefined) next.continuousGenerateTest = patch.continuousGenerateTest;
    if (patch.editSourceMode !== undefined) next.editSourceMode = normalizeEditSourceMode(patch.editSourceMode);
    if (patch.batchProcess !== undefined) next.batchProcess = normalizeBatchProcessConfig(patch.batchProcess);
    if (patch.editAutoAspectUserLocked !== undefined) next.editAutoAspectUserLocked = patch.editAutoAspectUserLocked;
    if (patch.styleTag !== undefined) next.styleTag = patch.styleTag;
    if (patch.sources !== undefined) next.sources = patch.sources;
    if (patch.currentImageId !== undefined) next.currentImageId = patch.currentImageId;
    if (patch.batchResultIds !== undefined) next.batchResultIds = patch.batchResultIds;
    if (patch.batchTaskIds !== undefined) next.batchTaskIds = patch.batchTaskIds;
    if (patch.clearedJobGroupsBefore !== undefined) next.clearedJobGroupsBefore = patch.clearedJobGroupsBefore;
    if (patch.selectedBatchTaskId !== undefined) next.selectedBatchTaskId = patch.selectedBatchTaskId;
    if (patch.batchSinglePreviewOpen !== undefined) next.batchSinglePreviewOpen = patch.batchSinglePreviewOpen;
    if (patch.resultGridOpen !== undefined) next.resultGridOpen = patch.resultGridOpen;
    if (patch.historyGalleryOpen !== undefined) next.historyGalleryOpen = patch.historyGalleryOpen;
    if (patch.historyGallerySinglePreviewId !== undefined) next.historyGallerySinglePreviewId = patch.historyGallerySinglePreviewId;
    if (patch.historyGallerySort !== undefined) next.historyGallerySort = patch.historyGallerySort;
    if (patch.runningJobs !== undefined) next.runningJobIds = patch.runningJobs;
    if (patch.runningJobIds !== undefined) next.runningJobIds = patch.runningJobIds;
    if (patch.jobsTotal !== undefined) next.jobsTotal = patch.jobsTotal;
    if (patch.jobsCompleted !== undefined) next.jobsCompleted = patch.jobsCompleted;
    if (patch.jobsFailed !== undefined) next.jobsFailed = patch.jobsFailed;
    if (patch.progress !== undefined) next.progress = patch.progress;
    if (patch.streamPreview !== undefined) next.streamPreview = patch.streamPreview;
    if (patch.streamPreviews !== undefined) next.streamPreviews = patch.streamPreviews;
    if (patch.lastLogLine !== undefined) next.lastLogLine = patch.lastLogLine;
    if (patch.errorMessage !== undefined) next.errorMessage = patch.errorMessage;
    if (patch.errorRawPath !== undefined) next.errorRawPath = patch.errorRawPath;
    if (patch.lastPayload !== undefined) next.lastPayload = patch.lastPayload;
    return next;
  });
}

export function resetWorkspaceSourcesAfterServiceRestart(workspaces: Workspace[]): Workspace[] {
  return workspaces.map((workspace) => (
    workspace.sources.length > 0
      ? { ...workspace, sources: [] }
      : workspace
  ));
}

export function workspaceRuntimeFromState(
  s: WorkspaceRuntimeState,
  workspaceId: string,
): WorkspaceRuntimeMirror {
  if (s.activeWorkspaceId === workspaceId) {
    return {
      runningJobs: s.runningJobs,
      jobsTotal: s.jobsTotal,
      jobsCompleted: s.jobsCompleted,
      jobsFailed: s.jobsFailed,
      progress: s.progress,
      streamPreview: s.streamPreview,
      streamPreviews: s.streamPreviews ?? {},
      lastLogLine: s.lastLogLine,
      errorMessage: s.errorMessage,
      errorRawPath: s.errorRawPath,
      lastPayload: s.lastPayload,
      isRunning: s.runningJobs.length > 0,
    };
  }
  const w = s.workspaces.find((item) => item.id === workspaceId);
  const runningJobs = w?.runningJobIds ?? [];
  return {
    runningJobs,
    jobsTotal: w?.jobsTotal ?? 0,
    jobsCompleted: w?.jobsCompleted ?? 0,
    jobsFailed: w?.jobsFailed ?? 0,
    progress: w?.progress ?? null,
    streamPreview: w?.streamPreview ?? null,
    streamPreviews: w?.streamPreviews ?? {},
    lastLogLine: w?.lastLogLine ?? "",
    errorMessage: w?.errorMessage ?? null,
    errorRawPath: w?.errorRawPath ?? null,
    lastPayload: w?.lastPayload ?? null,
    isRunning: runningJobs.length > 0,
  };
}

export function activeRuntimePatch(patch: WorkspacePatch): Partial<WorkspaceRuntimeMirror> {
  const out: Partial<WorkspaceRuntimeMirror> = {};
  if (patch.runningJobs !== undefined) {
    out.runningJobs = patch.runningJobs;
    out.isRunning = patch.runningJobs.length > 0;
  }
  if (patch.runningJobIds !== undefined) {
    out.runningJobs = patch.runningJobIds;
    out.isRunning = patch.runningJobIds.length > 0;
  }
  if (patch.jobsTotal !== undefined) out.jobsTotal = patch.jobsTotal;
  if (patch.jobsCompleted !== undefined) out.jobsCompleted = patch.jobsCompleted;
  if (patch.jobsFailed !== undefined) out.jobsFailed = patch.jobsFailed;
  if (patch.progress !== undefined) out.progress = patch.progress;
  if (patch.streamPreview !== undefined) out.streamPreview = patch.streamPreview;
  if (patch.streamPreviews !== undefined) out.streamPreviews = patch.streamPreviews;
  if (patch.lastLogLine !== undefined) out.lastLogLine = patch.lastLogLine;
  if (patch.errorMessage !== undefined) out.errorMessage = patch.errorMessage;
  if (patch.errorRawPath !== undefined) out.errorRawPath = patch.errorRawPath;
  if (patch.lastPayload !== undefined) out.lastPayload = patch.lastPayload;
  return out;
}

export function workspaceRunningCount(
  s: { runningJobMeta: Record<string, RunningJobMeta> },
  apiMode: APIModeValue,
  apiProfileId?: string,
): number {
  const cleanProfileId = String(apiProfileId || "").trim();
  return Object.values(s.runningJobMeta)
    // A profile is the capacity owner. When it is known, Images and Responses
    // jobs must share its limit across a global FHL transport switch. Calls
    // without a profile ID keep the historic API-mode fallback behavior.
    .filter((job) => cleanProfileId ? job.apiProfileId === cleanProfileId : job.apiMode === apiMode)
    .length;
}
