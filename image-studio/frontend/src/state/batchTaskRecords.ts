import type {
  APIMode,
  BatchProcessAutoAspectResolution,
  BatchProcessOutputMode,
  BatchTaskRecord,
  HistoryItem,
  JobGroupSnapshot,
  JobSlotSnapshot,
  Mode,
  OutputFormatValue,
  QualityValue,
  RequestPolicy,
  SizeValue,
  PanoramaRoundtripRef,
  SourceImage,
  Workspace,
} from "../types/domain";
import { normalizeRuntimeText } from "../lib/runtimeText.ts";
import { normalizeFHLImagesPoolSlot } from "../lib/profiles.ts";
import { latestContinuousSlotsByIndex } from "./browserJobs.ts";

export type BatchTaskCreateInput = {
  runId?: string;
  workspaceId: string;
  slotIndex: number;
  mode: Mode;
  apiMode: APIMode;
  apiProfileId?: string;
  apiProfileName?: string;
  fhlImagesPoolSlot?: number;
  apiBaseURL?: string;
  continuousPoolTask?: boolean;
  prompt: string;
  size: SizeValue;
  autoAspectResolution?: BatchProcessAutoAspectResolution;
  quality: QualityValue;
  outputFormat: OutputFormatValue;
  requestPolicy?: RequestPolicy;
  imagesNewAPICompat?: boolean;
  textModelID?: string;
  imageModelID?: string;
  seed?: number;
  negativePrompt?: string;
  styleTag?: string;
  sourceImagePaths?: string[];
  sourceImages?: SourceImage[];
  panoramaRoundtrip?: PanoramaRoundtripRef;
  batchSourcePath?: string;
  batchSourceSlotIndex?: number;
  maskB64?: string;
  queuedReason?: BatchTaskRecord["queuedReason"];
  batchOutputMode?: BatchProcessOutputMode;
  batchOutputDir?: string;
  batchOutputPrefix?: string;
  createdAt?: number;
};

function normalizeTaskAutoAspectResolution(value: unknown): Exclude<BatchProcessAutoAspectResolution, ""> | undefined {
  return value === "1k" || value === "2k" || value === "4k" ? value : undefined;
}

export function makeBatchTaskId(workspaceId: string, slotIndex: number, createdAt = Date.now()) {
  return `task-${workspaceId}-${slotIndex}-${createdAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createBatchTaskRecord(input: BatchTaskCreateInput): BatchTaskRecord {
  const now = input.createdAt ?? Date.now();
  return {
    id: makeBatchTaskId(input.workspaceId, input.slotIndex, now),
    runId: input.runId,
    workspaceId: input.workspaceId,
    slotIndex: Math.max(0, Math.floor(input.slotIndex)),
    status: "queued",
    createdAt: now,
    updatedAt: now,
    mode: input.mode,
    apiMode: input.apiMode,
    apiProfileId: input.apiProfileId,
    apiProfileName: input.apiProfileName,
    fhlImagesPoolSlot: normalizeFHLImagesPoolSlot(input.fhlImagesPoolSlot),
    apiBaseURL: input.apiBaseURL,
    continuousPoolTask: input.continuousPoolTask === true,
    prompt: input.prompt,
    size: input.size,
    autoAspectResolution: normalizeTaskAutoAspectResolution(input.autoAspectResolution),
    quality: input.quality,
    outputFormat: input.outputFormat,
    requestPolicy: input.requestPolicy,
    imagesNewAPICompat: input.imagesNewAPICompat,
    textModelID: input.textModelID,
    imageModelID: input.imageModelID,
    seed: input.seed,
    negativePrompt: input.negativePrompt,
    styleTag: input.styleTag,
    sourceImagePaths: input.sourceImagePaths,
    sourceImages: input.sourceImages,
    panoramaRoundtrip: input.panoramaRoundtrip,
    batchSourcePath: input.batchSourcePath,
    batchSourceSlotIndex: input.batchSourceSlotIndex,
    maskB64: input.maskB64,
    autoRetryCount: 0,
    queuedReason: input.queuedReason,
    batchOutputMode: input.batchOutputMode,
    batchOutputDir: input.batchOutputDir,
    batchOutputPrefix: input.batchOutputPrefix,
  };
}

export function sortedBatchTasksForWorkspace(
  workspaceId: string,
  taskIds: string[],
  tasksById: Record<string, BatchTaskRecord>,
) {
  return taskIds
    .map((id) => tasksById[id])
    .filter((task): task is BatchTaskRecord => !!task && task.workspaceId === workspaceId)
    .sort((a, b) => a.slotIndex - b.slotIndex || a.createdAt - b.createdAt);
}

export function referencedBatchTasksForWorkspaces(
  workspaces: readonly Pick<Workspace, "id" | "batchTaskIds">[],
  tasksById: Record<string, BatchTaskRecord>,
) {
  const seen = new Set<string>();
  const tasks: BatchTaskRecord[] = [];
  for (const workspace of workspaces) {
    for (const taskId of workspace.batchTaskIds ?? []) {
      if (seen.has(taskId)) continue;
      const task = tasksById[taskId];
      if (!task || task.workspaceId !== workspace.id) continue;
      seen.add(taskId);
      tasks.push(task);
    }
  }
  return tasks;
}

export function historyItemHasRenderableResult(
  item: Pick<HistoryItem, "savedPath" | "imageId" | "imageB64" | "imageBlob" | "previewUrl" | "fullUrl"> | null | undefined,
) {
  return !!item && (
    !!String(item.savedPath || item.imageId || item.imageB64 || item.previewUrl || item.fullUrl || "").trim()
    || !!item.imageBlob
  );
}

export function minimalHistoryItemFromBatchTask(task: BatchTaskRecord): HistoryItem | null {
  const savedPath = String(task.savedPath || "").trim();
  if (task.status !== "succeeded" || !savedPath) return null;
  return {
    id: String(task.historyItemId || `task-result:${task.id}`),
    prompt: task.prompt,
    mode: task.mode,
    apiMode: task.apiMode,
    apiProfileId: task.apiProfileId,
    apiProfileName: task.apiProfileName,
    fhlImagesPoolSlot: normalizeFHLImagesPoolSlot(task.fhlImagesPoolSlot),
    size: task.size,
    quality: task.quality,
    outputFormat: task.outputFormat,
    createdAt: task.updatedAt || task.createdAt,
    seed: task.seed,
    negativePrompt: task.negativePrompt,
    styleTag: task.styleTag,
    batchIndex: task.slotIndex,
    elapsedSec: task.elapsedSec,
    sourceImages: task.sourceImages,
    panoramaRoundtrip: task.panoramaRoundtrip,
    parentId: task.batchSourcePath || task.sourceImagePaths?.[0],
    savedPath,
    rawPath: task.rawPath,
    previewOnly: true,
  };
}

export function batchTaskHasResult(
  task: Pick<BatchTaskRecord, "historyItemId" | "savedPath">,
  historyById?: ReadonlyMap<string, Pick<HistoryItem, "savedPath" | "imageId" | "imageB64" | "imageBlob" | "previewUrl" | "fullUrl">>,
) {
  const historyItemId = String(task.historyItemId || "").trim();
  const savedPath = String(task.savedPath || "").trim();
  if (historyById && typeof historyById.get === "function") {
    return !!savedPath || (historyItemId ? historyItemHasRenderableResult(historyById.get(historyItemId)) : false);
  }
  return !!(savedPath || historyItemId);
}

export function isRetryableBatchTask(
  task: Pick<BatchTaskRecord, "status" | "historyItemId" | "savedPath">,
  historyById?: ReadonlyMap<string, Pick<HistoryItem, "savedPath" | "imageId" | "imageB64" | "imageBlob" | "previewUrl" | "fullUrl">>,
) {
  return task.status === "failed"
    || task.status === "interrupted"
    || (task.status === "succeeded" && !batchTaskHasResult(task, historyById));
}

function currentViewStatusRank(task: BatchTaskRecord) {
  const hasResult = batchTaskHasResult(task);
  if (hasResult) return 3;
  if (task.status === "running") return 0;
  if (task.status === "queued") return 1;
  if (task.status === "succeeded") return 2;
  if (task.status === "failed" || task.status === "interrupted") return 2;
  if (task.status === "cancelled") return 4;
  return 5;
}

export function sortedBatchTasksForCurrentView(
  workspaceId: string,
  taskIds: string[],
  tasksById: Record<string, BatchTaskRecord>,
) {
  return sortedBatchTasksForWorkspace(workspaceId, taskIds, tasksById)
    .sort((a, b) => (
      currentViewStatusRank(a) - currentViewStatusRank(b)
      || a.slotIndex - b.slotIndex
      || a.createdAt - b.createdAt
      || a.updatedAt - b.updatedAt
    ));
}

export function nextSlotIndexFromTasks(tasks: BatchTaskRecord[]) {
  return tasks.reduce((max, task) => Math.max(max, task.slotIndex), -1) + 1;
}

export function currentBatchTaskViewCount(
  workspaceId: string,
  taskIds: string[] | undefined,
  tasksById: Record<string, BatchTaskRecord>,
  jobsTotal: number,
  batchResults: HistoryItem[],
  jobGroups?: JobGroupSnapshot[],
) {
  const taskCount = (taskIds ?? [])
    .map((id) => tasksById[id])
    .filter((task): task is BatchTaskRecord => !!task && task.workspaceId === workspaceId)
    .length;
  if (taskCount > 0) return taskCount;
  const workspaceGroups = (jobGroups ?? []).filter((group) => group.workspaceId === workspaceId);
  const latestContinuousSlots = latestContinuousSlotsByIndex(workspaceGroups);
  const continuousSlotCount = latestContinuousSlots.size > 0 ? Math.max(...latestContinuousSlots.keys()) + 1 : 0;
  const groupedBatchCount = workspaceGroups.reduce((max, group) => {
    const declaredCount = Number.isFinite(Number(group.batchCount))
      ? Math.max(0, Math.floor(Number(group.batchCount)))
      : 0;
    const indexedSlotCount = group.slots.reduce((slotMax, slot) => {
      const index = Number.isFinite(Number(slot.batchIndex)) ? Math.max(0, Math.floor(Number(slot.batchIndex))) : -1;
      return Math.max(slotMax, index + 1);
    }, 0);
    return Math.max(max, declaredCount, indexedSlotCount, group.slots.length);
  }, 0);
  return Math.max(
    Number.isFinite(Number(jobsTotal)) ? Math.max(0, Math.floor(Number(jobsTotal))) : 0,
    batchResults.length,
    continuousSlotCount,
    groupedBatchCount,
  );
}

export function findTaskForSlot(
  taskIds: string[],
  tasksById: Record<string, BatchTaskRecord>,
  workspaceId: string,
  slotIndex: number,
) {
  return sortedBatchTasksForWorkspace(workspaceId, taskIds, tasksById)
    .filter((task) => task.slotIndex === slotIndex)
    .sort((a, b) => (
      currentViewStatusRank(a) - currentViewStatusRank(b)
      || b.updatedAt - a.updatedAt
      || b.createdAt - a.createdAt
    ))[0] ?? null;
}

export function findTaskForJobSlot(
  taskIds: string[],
  tasksById: Record<string, BatchTaskRecord>,
  workspaceId: string,
  slotIndex: number,
  jobId?: string,
  clientTaskId?: string,
) {
  const cleanClientTaskId = String(clientTaskId || "").trim();
  const cleanJobId = String(jobId || "").trim();
  const tasks = sortedBatchTasksForWorkspace(workspaceId, taskIds, tasksById);
  if (cleanClientTaskId) {
    const matched = tasks.find((task) => task.id === cleanClientTaskId);
    if (matched) return matched;
  }
  if (cleanJobId) {
    const matched = tasks.find((task) => task.jobId === cleanJobId);
    if (matched) return matched;
  }
  return tasks
    .filter((task) => task.slotIndex === slotIndex)
    .sort((a, b) => (
      currentViewStatusRank(a) - currentViewStatusRank(b)
      || b.updatedAt - a.updatedAt
      || b.createdAt - a.createdAt
    ))[0] ?? null;
}

function findTaskForHistoryItem(
  taskIds: string[],
  tasksById: Record<string, BatchTaskRecord>,
  workspaceId: string,
  item: HistoryItem,
) {
  const jobId = String(item.id || "").startsWith("job:") ? String(item.id).slice(4).trim() : "";
  const tasks = sortedBatchTasksForWorkspace(workspaceId, taskIds, tasksById);
  if (jobId) {
    const matched = tasks.find((task) => task.jobId === jobId);
    if (matched) return matched;
  }
  const savedPath = String(item.savedPath || "").trim();
  if (savedPath) {
    const matched = tasks.find((task) => String(task.savedPath || "").trim() === savedPath);
    if (matched) return matched;
  }
  const slotIndex = Number.isFinite(Number(item.batchIndex)) ? Number(item.batchIndex) : -1;
  return slotIndex >= 0 ? findTaskForSlot(taskIds, tasksById, workspaceId, slotIndex) : null;
}

export function upsertBatchTasks(
  current: Record<string, BatchTaskRecord>,
  tasks: BatchTaskRecord[],
) {
  if (tasks.length === 0) return current;
  const next = { ...current };
  for (const task of tasks) next[task.id] = task;
  return next;
}

export function taskStatusFromSlot(slot: JobSlotSnapshot): BatchTaskRecord["status"] {
  if (slot.status === "queued" || slot.status === "running" || slot.status === "succeeded"
    || slot.status === "failed" || slot.status === "cancelled" || slot.status === "interrupted") {
    return slot.status;
  }
  return "queued";
}

export function slotIndexForGroupSlot(group: JobGroupSnapshot, slot: JobSlotSnapshot) {
  const groupStart = Number.isFinite(Number(group.continuousBatchIndex))
    ? Math.max(0, Math.floor(Number(group.continuousBatchIndex)))
    : -1;
  const localIndex = Number.isFinite(Number(slot.batchIndex))
    ? Math.max(0, Math.floor(Number(slot.batchIndex)))
    : -1;
  if (groupStart >= 0) {
    return groupStart + Math.max(localIndex, 0);
  }
  return localIndex;
}

export function updateTasksFromJobGroup(
  current: Record<string, BatchTaskRecord>,
  workspaceTaskIds: string[],
  group: JobGroupSnapshot,
) {
  let changed = false;
  const next = { ...current };
  for (const slot of group.slots) {
    const slotIndex = slotIndexForGroupSlot(group, slot);
    if (!Number.isFinite(slotIndex) || slotIndex < 0) continue;
    const task = findTaskForJobSlot(
      workspaceTaskIds,
      next,
      group.workspaceId,
      slotIndex,
      slot.jobId,
      group.clientTaskId,
    );
    if (!task) continue;
    if (task.status === "cancelled") continue;
    const keepOptimisticRunning = task.status === "running" && !task.jobId && slot.status === "queued";
    const updated: BatchTaskRecord = {
      ...task,
      status: keepOptimisticRunning ? "running" : taskStatusFromSlot(slot),
      updatedAt: keepOptimisticRunning
        ? Math.max(task.updatedAt, slot.updatedAt || 0)
        : (slot.updatedAt || Date.now()),
      apiProfileId: group.apiProfileId || task.apiProfileId,
      apiProfileName: group.apiProfileName || task.apiProfileName,
      fhlImagesPoolSlot: normalizeFHLImagesPoolSlot(group.fhlImagesPoolSlot)
        ?? normalizeFHLImagesPoolSlot(task.fhlImagesPoolSlot),
      runId: group.runId || task.runId,
      launchState: undefined,
      launchStartedAt: undefined,
      queuedReason: undefined,
      queuePriority: undefined,
      groupId: group.groupId,
      jobId: slot.jobId,
      savedPath: slot.savedPath || task.savedPath,
      rawPath: slot.rawPath || task.rawPath,
      apimartTaskId: slot.apimartTaskId || task.apimartTaskId,
      batchSourcePath: group.batchSourcePath || task.batchSourcePath,
      batchSourceSlotIndex: Number.isFinite(Number(group.batchSourceSlotIndex))
        ? Math.max(0, Math.floor(Number(group.batchSourceSlotIndex)))
        : task.batchSourceSlotIndex,
      errorMessage: normalizeRuntimeText(slot.errorMessage) || task.errorMessage,
      lastLogLine: normalizeRuntimeText(slot.stage) || task.lastLogLine,
      elapsedSec: Number.isFinite(Number(slot.elapsedSec)) ? Number(slot.elapsedSec) : task.elapsedSec,
    };
    if (keepOptimisticRunning) {
      updated.lastLogLine = task.lastLogLine;
    }
    if (JSON.stringify(updated) !== JSON.stringify(task)) {
      next[task.id] = updated;
      changed = true;
    }
  }
  return changed ? next : current;
}

export function markMissingJobTasksInterrupted(
  current: Record<string, BatchTaskRecord>,
  workspaceTaskIds: string[],
  knownJobIds: ReadonlySet<string>,
  now = Date.now(),
) {
  let changed = false;
  const next = { ...current };
  for (const taskId of workspaceTaskIds) {
    const task = next[taskId];
    if (!task?.jobId) continue;
    if (task.status !== "running" && task.status !== "queued") continue;
    if (knownJobIds.has(task.jobId)) continue;
    next[taskId] = {
      ...task,
      status: "interrupted",
      updatedAt: now,
      queuedReason: undefined,
      queuePriority: undefined,
      errorMessage: task.errorMessage || "本地任务记录已失效，请重试。",
      lastLogLine: "本地任务记录已失效",
    };
    changed = true;
  }
  return changed ? next : current;
}

export const RESTORED_DIRECT_TASK_INTERRUPTED_MESSAGE = "桌面端已重启，旧任务不会自动继续，可单独重试。";

export function interruptRestoredDirectTasks(
  current: Record<string, BatchTaskRecord>,
  workspaces: readonly Pick<Workspace, "id" | "batchTaskIds">[],
  now = Date.now(),
) {
  let changed = false;
  const next = { ...current };
  for (const workspace of workspaces) {
    for (const taskId of workspace.batchTaskIds ?? []) {
      const task = next[taskId];
      if (!task || task.workspaceId !== workspace.id) continue;
      if (task.status !== "queued" && task.status !== "running") continue;
      next[task.id] = {
        ...task,
        status: "interrupted",
        updatedAt: now,
        launchState: undefined,
        launchAttempt: undefined,
        launchStartedAt: undefined,
        jobId: undefined,
        groupId: undefined,
        queuedReason: undefined,
        queuePriority: undefined,
        autoRetryScheduledAt: undefined,
        autoRetryReason: undefined,
        errorMessage: RESTORED_DIRECT_TASK_INTERRUPTED_MESSAGE,
        lastLogLine: RESTORED_DIRECT_TASK_INTERRUPTED_MESSAGE,
      };
      changed = true;
    }
  }
  return changed ? next : current;
}

export function localQueuedTasksForWorkspace(
  workspaceId: string,
  taskIds: string[],
  tasksById: Record<string, BatchTaskRecord>,
) {
  return sortedBatchTasksForWorkspace(workspaceId, taskIds, tasksById)
    .filter((task) => task.status === "queued" && !task.jobId && (
      task.queuedReason === "local_concurrency"
      || task.queuedReason === "batch_shared_concurrency"
    ))
    .sort((a, b) => (
      (b.queuePriority ?? 0) - (a.queuePriority ?? 0)
      || a.slotIndex - b.slotIndex
      || a.createdAt - b.createdAt
    ));
}

export function runningOrSubmittedTaskCountForWorkspace(
  workspaceId: string,
  taskIds: string[],
  tasksById: Record<string, BatchTaskRecord>,
  apiMode?: APIMode,
  apiProfileId?: string | ReadonlySet<string>,
  startingTaskIds?: ReadonlySet<string>,
) {
  const apiProfileIdArg = typeof apiProfileId === "string" ? apiProfileId : "";
  const startingTaskIdsArg = apiProfileId && typeof apiProfileId !== "string" ? apiProfileId : startingTaskIds;
  const cleanProfileId = String(apiProfileIdArg || "").trim();
  return sortedBatchTasksForWorkspace(workspaceId, taskIds, tasksById)
    // A task's assigned profile owns its capacity across transport changes.
    // Keep the old API-mode filter only for legacy callers without a profile.
    .filter((task) => cleanProfileId ? task.apiProfileId === cleanProfileId : (!apiMode || task.apiMode === apiMode))
    .filter((task) => (
      startingTaskIdsArg?.has(task.id)
      || task.status === "running"
      || (task.status === "queued" && !!task.jobId)
    )).length;
}

export function updateTaskFromHistoryItem(
  current: Record<string, BatchTaskRecord>,
  workspaceTaskIds: string[],
  workspaceId: string,
  item: HistoryItem,
) {
  const task = findTaskForHistoryItem(workspaceTaskIds, current, workspaceId, item);
  if (!task) return current;
  if (task.status === "cancelled") return current;
  return {
    ...current,
    [task.id]: {
      ...task,
      status: "succeeded",
      updatedAt: Date.now(),
      queuedReason: undefined,
      queuePriority: undefined,
      errorMessage: undefined,
      autoRetryScheduledAt: undefined,
      autoRetryReason: undefined,
      historyItemId: item.id,
      savedPath: item.savedPath || task.savedPath,
      rawPath: item.rawPath || task.rawPath,
      elapsedSec: Number.isFinite(Number(item.elapsedSec)) ? Number(item.elapsedSec) : task.elapsedSec,
    },
  };
}

export function updateTaskForSlot(
  current: Record<string, BatchTaskRecord>,
  workspaceTaskIds: string[],
  workspaceId: string,
  slotIndex: number,
  patch: Partial<BatchTaskRecord>,
) {
  const task = findTaskForSlot(workspaceTaskIds, current, workspaceId, slotIndex);
  if (!task) return current;
  if (task.status === "cancelled" && patch.status !== "cancelled") return current;
  return {
    ...current,
    [task.id]: {
      ...task,
      ...patch,
      updatedAt: patch.updatedAt ?? Date.now(),
    },
  };
}

export function updateTaskById(
  current: Record<string, BatchTaskRecord>,
  workspaceTaskIds: readonly string[],
  workspaceId: string,
  taskId: string,
  patch: Partial<BatchTaskRecord>,
) {
  if (!workspaceTaskIds.includes(taskId)) return current;
  const task = current[taskId];
  if (!task || task.workspaceId !== workspaceId) return current;
  if (task.status === "cancelled" && patch.status !== "cancelled") return current;
  return {
    ...current,
    [task.id]: {
      ...task,
      ...patch,
      updatedAt: patch.updatedAt ?? Date.now(),
    },
  };
}

export function claimBatchTaskForLaunch(
  current: Record<string, BatchTaskRecord>,
  workspaceTaskIds: readonly string[],
  workspaceId: string,
  taskId: string,
  patch: Partial<BatchTaskRecord>,
) {
  if (!workspaceTaskIds.includes(taskId)) return { batchTasksById: current, claimed: false };
  const task = current[taskId];
  if (!task || task.workspaceId !== workspaceId) return { batchTasksById: current, claimed: false };
  const claimable = task.status === "queued"
    ? !task.jobId
    : task.status === "failed" || task.status === "interrupted";
  if (!claimable) return { batchTasksById: current, claimed: false };
  const batchTasksById = updateTaskById(current, workspaceTaskIds, workspaceId, taskId, {
    ...patch,
    status: "running",
  });
  return { batchTasksById, claimed: batchTasksById !== current };
}
