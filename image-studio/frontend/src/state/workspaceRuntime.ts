import type { backend } from "../../wailsjs/go/models";
import type { APIMartRecoveryTask, ProgressInfo, StreamPreview, StreamPreviewMap, Workspace } from "../types/domain";

export type APIModeValue = "responses" | "images" | "apimart" | "runninghub";

export interface RunningJobMeta {
  workspaceId: string;
  apiMode: APIModeValue;
  apiLabel?: string;
  apiProfileId?: string;
  fhlImagesPoolSlot?: number;
  batchIndex?: number;
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
  progress: ProgressInfo | null;
  streamPreview: StreamPreview | null;
  streamPreviews?: StreamPreviewMap;
  lastLogLine: string;
  errorMessage: string | null;
  errorRawPath: string | null;
  apimartRecoveryTask?: APIMartRecoveryTask | null;
  apimartRecoveryTasks?: APIMartRecoveryTask[];
  lastPayload: backend.GenerateOptions | null;
  workspaces: Workspace[];
}

export interface WorkspaceRuntimeMirror {
  runningJobs: string[];
  jobsTotal: number;
  jobsCompleted: number;
  progress: ProgressInfo | null;
  streamPreview: StreamPreview | null;
  streamPreviews: StreamPreviewMap;
  lastLogLine: string;
  errorMessage: string | null;
  errorRawPath: string | null;
  apimartRecoveryTask?: APIMartRecoveryTask | null;
  apimartRecoveryTasks?: APIMartRecoveryTask[];
  lastPayload: backend.GenerateOptions | null;
  isRunning: boolean;
}

export function normalizeAPIMode(mode: string): APIModeValue {
  const normalized = String(mode).trim().toLowerCase();
  if (normalized === "images" || normalized === "apimart" || normalized === "runninghub") return normalized;
  return "responses";
}

export function apiModeLabel(mode: string): string {
  const shortLabel = apiModeShortLabel(mode);
  return shortLabel === "APIMart" || shortLabel === "RunningHub" ? shortLabel : `${shortLabel} API`;
}

export function apiModeShortLabel(mode: string): string {
  const normalized = normalizeAPIMode(mode);
  if (normalized === "apimart") return "APIMart";
  if (normalized === "runninghub") return "RunningHub";
  return normalized === "images" ? "Images" : "Responses";
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

export function patchWorkspaceRuntime(workspaces: Workspace[], workspaceId: string, patch: WorkspacePatch): Workspace[] {
  return workspaces.map((w) => {
    if (w.id !== workspaceId) return w;
    const next: Workspace = { ...w };
    if (patch.name !== undefined) next.name = patch.name;
    if (patch.promptPrefix !== undefined) next.promptPrefix = patch.promptPrefix;
    if (patch.currentImageId !== undefined) next.currentImageId = patch.currentImageId;
    if (patch.batchResultIds !== undefined) next.batchResultIds = patch.batchResultIds;
    if (patch.resultGridOpen !== undefined) next.resultGridOpen = patch.resultGridOpen;
    if (patch.runningJobs !== undefined) next.runningJobIds = patch.runningJobs;
    if (patch.runningJobIds !== undefined) next.runningJobIds = patch.runningJobIds;
    if (patch.jobsTotal !== undefined) next.jobsTotal = patch.jobsTotal;
    if (patch.jobsCompleted !== undefined) next.jobsCompleted = patch.jobsCompleted;
    if (patch.progress !== undefined) next.progress = patch.progress;
    if (patch.streamPreview !== undefined) next.streamPreview = patch.streamPreview;
    if (patch.streamPreviews !== undefined) next.streamPreviews = patch.streamPreviews;
    if (patch.lastLogLine !== undefined) next.lastLogLine = patch.lastLogLine;
    if (patch.errorMessage !== undefined) next.errorMessage = patch.errorMessage;
    if (patch.errorRawPath !== undefined) next.errorRawPath = patch.errorRawPath;
    if (patch.apimartRecoveryTask !== undefined) next.apimartRecoveryTask = patch.apimartRecoveryTask;
    if (patch.apimartRecoveryTasks !== undefined) next.apimartRecoveryTasks = patch.apimartRecoveryTasks;
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
      progress: s.progress,
      streamPreview: s.streamPreview,
      streamPreviews: s.streamPreviews ?? {},
      lastLogLine: s.lastLogLine,
      errorMessage: s.errorMessage,
      errorRawPath: s.errorRawPath,
      apimartRecoveryTask: s.apimartRecoveryTask,
      apimartRecoveryTasks: s.apimartRecoveryTasks,
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
    progress: w?.progress ?? null,
    streamPreview: w?.streamPreview ?? null,
    streamPreviews: w?.streamPreviews ?? {},
    lastLogLine: w?.lastLogLine ?? "",
    errorMessage: w?.errorMessage ?? null,
    errorRawPath: w?.errorRawPath ?? null,
    apimartRecoveryTask: w?.apimartRecoveryTask ?? null,
    apimartRecoveryTasks: w?.apimartRecoveryTasks ?? [],
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
  if (patch.progress !== undefined) out.progress = patch.progress;
  if (patch.streamPreview !== undefined) out.streamPreview = patch.streamPreview;
  if (patch.streamPreviews !== undefined) out.streamPreviews = patch.streamPreviews;
  if (patch.lastLogLine !== undefined) out.lastLogLine = patch.lastLogLine;
  if (patch.errorMessage !== undefined) out.errorMessage = patch.errorMessage;
  if (patch.errorRawPath !== undefined) out.errorRawPath = patch.errorRawPath;
  if (patch.apimartRecoveryTask !== undefined) out.apimartRecoveryTask = patch.apimartRecoveryTask;
  if (patch.apimartRecoveryTasks !== undefined) out.apimartRecoveryTasks = patch.apimartRecoveryTasks;
  if (patch.lastPayload !== undefined) out.lastPayload = patch.lastPayload;
  return out;
}

export function workspaceRunningCount(s: { runningJobMeta: Record<string, RunningJobMeta> }, apiMode: APIModeValue): number {
  return Object.values(s.runningJobMeta).filter((job) => job.apiMode === apiMode).length;
}

export function workspaceNonPoolProfileRunningCount(
  s: { runningJobMeta: Record<string, RunningJobMeta> },
  apiMode: APIModeValue,
  apiProfileId?: string,
): number {
  const targetProfileId = apiProfileId?.trim() || undefined;
  return Object.values(s.runningJobMeta).filter((job) => {
    if (job.apiMode !== apiMode) return false;
    const slot = job.fhlImagesPoolSlot;
    if (Number.isInteger(slot) && Number(slot) >= 1 && Number(slot) <= 10) return false;
    return (job.apiProfileId?.trim() || undefined) === targetProfileId;
  }).length;
}
