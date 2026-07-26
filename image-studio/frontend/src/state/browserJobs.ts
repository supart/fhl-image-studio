import type {
  JobGroupSnapshot,
  JobSlotSnapshot,
  JobStatus,
  ProgressInfo,
  Workspace,
} from "../types/domain";
import { normalizeRuntimeText } from "../lib/runtimeText.ts";
import {
  MAX_BROWSER_JOB_GROUPS,
  retainBrowserJobGroups,
} from "../platform/runtime/browserJobContracts.ts";

export function isTerminalJobStatus(status: JobStatus) {
  return status === "succeeded"
    || status === "failed"
    || status === "cancelled"
    || status === "interrupted";
}

export function runningJobIdsFromGroup(group: JobGroupSnapshot) {
  return group.slots
    .filter((slot) => slot.status === "queued" || slot.status === "running")
    .map((slot) => slot.jobId);
}

export function jobsCompletedFromGroup(group: JobGroupSnapshot) {
  return group.slots.filter((slot) => isTerminalJobStatus(slot.status)).length;
}

export function jobsFailedFromGroup(group: JobGroupSnapshot) {
  return group.slots.filter((slot) => slot.status === "failed" || slot.status === "interrupted").length;
}

export function latestUpdatedSlot(slots: JobSlotSnapshot[]) {
  if (slots.length === 0) return null;
  return [...slots].sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export function latestRunningSlot(group: JobGroupSnapshot) {
  return latestUpdatedSlot(group.slots.filter((slot) => slot.status === "queued" || slot.status === "running"));
}

export function latestTerminalSlot(group: JobGroupSnapshot) {
  return latestUpdatedSlot(group.slots.filter((slot) => isTerminalJobStatus(slot.status)));
}

export function continuousSlotIndex(group: JobGroupSnapshot, slot: JobSlotSnapshot) {
  if (group.continuousGenerateTest === true && Number.isFinite(Number(group.continuousBatchIndex))) {
    return Number(group.continuousBatchIndex);
  }
  return Number.isFinite(Number(slot.batchIndex)) ? Number(slot.batchIndex) : -1;
}

export type ContinuousSlotSnapshot = {
  group: JobGroupSnapshot;
  slot: JobSlotSnapshot;
  index: number;
};

export function latestContinuousSlotsByIndex(groups: JobGroupSnapshot[]) {
  const out = new Map<number, ContinuousSlotSnapshot>();
  for (const group of groups) {
    if (group.continuousGenerateTest !== true || group.batchCount !== 1) continue;
    for (const slot of group.slots) {
      const index = continuousSlotIndex(group, slot);
      if (!Number.isFinite(index) || index < 0) continue;
      const previous = out.get(index);
      if (
        !previous
        || slot.updatedAt > previous.slot.updatedAt
        || (slot.updatedAt === previous.slot.updatedAt && group.createdAt > previous.group.createdAt)
      ) {
        out.set(index, { group, slot, index });
      }
    }
  }
  return out;
}

export function runtimeProgressFromGroup(group: JobGroupSnapshot): ProgressInfo | null {
  const slot = latestRunningSlot(group);
  if (!slot) return null;
  return {
    stage: normalizeRuntimeText(slot.stage) || (slot.status === "queued" ? "排队中" : "处理中"),
    elapsed: Number.isFinite(slot.elapsedSec) ? Math.max(0, Number(slot.elapsedSec)) : 0,
    bytes: Number.isFinite(slot.bytes) ? Math.max(0, Number(slot.bytes)) : 0,
  };
}

export function latestRunningGroup(groups: JobGroupSnapshot[]) {
  return [...groups]
    .filter((group) => runningJobIdsFromGroup(group).length > 0)
    .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

export function latestGroup(groups: JobGroupSnapshot[]) {
  return [...groups].sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

function groupsInContinuousWindow(groups: JobGroupSnapshot[]) {
  return [...groups]
    .filter((group) => group.continuousGenerateTest === true)
    .filter((group) => group.batchCount === 1)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function mergeJobGroupList(existing: JobGroupSnapshot[], incoming: JobGroupSnapshot) {
  const next = existing.filter((group) => group.groupId !== incoming.groupId);
  next.unshift(incoming);
  return retainBrowserJobGroups(next, MAX_BROWSER_JOB_GROUPS);
}

export function replaceWorkspaceJobGroups(
  current: Record<string, JobGroupSnapshot[]>,
  workspaceId: string,
  groups: JobGroupSnapshot[],
) {
  return {
    ...current,
    [workspaceId]: retainBrowserJobGroups(groups, MAX_BROWSER_JOB_GROUPS),
  };
}

export function mergeWorkspaceJobGroup(
  current: Record<string, JobGroupSnapshot[]>,
  group: JobGroupSnapshot,
) {
  const existing = current[group.workspaceId] ?? [];
  return {
    ...current,
    [group.workspaceId]: mergeJobGroupList(existing, group),
  };
}

export function isJobGroupVisibleForWorkspace(
  workspace: Pick<Workspace, "clearedJobGroupsBefore"> | null | undefined,
  group: JobGroupSnapshot,
) {
  const cutoff = Number(workspace?.clearedJobGroupsBefore ?? 0);
  if (!Number.isFinite(cutoff) || cutoff <= 0) return true;
  return Number(group.createdAt) > cutoff;
}

export function filterVisibleJobGroupsForWorkspace(
  workspace: Pick<Workspace, "clearedJobGroupsBefore"> | null | undefined,
  groups: readonly JobGroupSnapshot[],
) {
  if (!workspace?.clearedJobGroupsBefore) return [...groups];
  return groups.filter((group) => isJobGroupVisibleForWorkspace(workspace, group));
}

export function runtimeStateFromJobGroups(groups: JobGroupSnapshot[]) {
  const runningGroup = latestRunningGroup(groups);
  if (!runningGroup) {
    const latest = latestGroup(groups);
    const latestTerminal = latest ? latestTerminalSlot(latest) : null;
    return {
      runningJobs: [] as string[],
      jobsTotal: latest?.batchCount ?? 0,
      jobsCompleted: latest ? jobsCompletedFromGroup(latest) : 0,
      jobsFailed: latest ? jobsFailedFromGroup(latest) : 0,
      progress: null as ProgressInfo | null,
      lastLogLine: normalizeRuntimeText(latestTerminal?.stage),
      errorMessage: latestTerminal?.status === "failed" || latestTerminal?.status === "interrupted"
        ? (normalizeRuntimeText(latestTerminal.errorMessage) || null)
        : null,
      errorRawPath: latestTerminal?.status === "failed" || latestTerminal?.status === "interrupted"
        ? (latestTerminal.rawPath?.trim() || null)
        : null,
      isRunning: false,
    };
  }

  const runningJobs = runningJobIdsFromGroup(runningGroup);
  const progress = runtimeProgressFromGroup(runningGroup);
  return {
    runningJobs,
    jobsTotal: runningGroup.batchCount,
    jobsCompleted: jobsCompletedFromGroup(runningGroup),
    jobsFailed: jobsFailedFromGroup(runningGroup),
    progress,
    lastLogLine: progress?.stage || "",
    errorMessage: null,
    errorRawPath: null,
    isRunning: runningJobs.length > 0,
  };
}

export function continuousRuntimeStateFromJobGroups(groups: JobGroupSnapshot[]) {
  const windowGroups = groupsInContinuousWindow(groups);
  if (windowGroups.length === 0) return runtimeStateFromJobGroups(groups);
  const latestByIndex = latestContinuousSlotsByIndex(windowGroups);
  const latestSlots = [...latestByIndex.values()]
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.slot);
  const runningJobs = latestSlots
    .filter((slot) => slot.status === "queued" || slot.status === "running")
    .map((slot) => slot.jobId);
  const latestRunning = latestUpdatedSlot(
    latestSlots.filter((slot) => slot.status === "queued" || slot.status === "running"),
  );
  const latestTerminal = latestUpdatedSlot(
    latestSlots.filter((slot) => isTerminalJobStatus(slot.status)),
  );
  const failedTerminal = latestTerminal && (latestTerminal.status === "failed" || latestTerminal.status === "interrupted")
    ? latestTerminal
    : null;
  const progress = latestRunning
    ? {
        stage: normalizeRuntimeText(latestRunning.stage) || (latestRunning.status === "queued" ? "排队中" : "处理中"),
        elapsed: Number.isFinite(latestRunning.elapsedSec) ? Math.max(0, Number(latestRunning.elapsedSec)) : 0,
        bytes: Number.isFinite(latestRunning.bytes) ? Math.max(0, Number(latestRunning.bytes)) : 0,
      }
    : null;
  return {
    runningJobs,
    jobsTotal: latestByIndex.size > 0 ? Math.max(...latestByIndex.keys()) + 1 : 0,
    jobsCompleted: latestSlots.filter((slot) => isTerminalJobStatus(slot.status)).length,
    jobsFailed: latestSlots.filter((slot) => slot.status === "failed" || slot.status === "interrupted").length,
    progress,
    lastLogLine: progress?.stage || normalizeRuntimeText(latestTerminal?.stage),
    errorMessage: failedTerminal ? (normalizeRuntimeText(failedTerminal.errorMessage) || null) : null,
    errorRawPath: failedTerminal ? (failedTerminal.rawPath?.trim() || null) : null,
    isRunning: runningJobs.length > 0,
  };
}
