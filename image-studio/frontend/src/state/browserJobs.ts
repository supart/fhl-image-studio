import type {
  JobGroupSnapshot,
  JobSlotSnapshot,
  JobStatus,
  ProgressInfo,
} from "../types/domain.ts";
import {
  MAX_BROWSER_JOB_GROUPS,
  summarizeJobStatuses,
} from "../platform/runtime/browserJobContracts.ts";

export const MAX_ANDROID_JOB_GROUPS = 700;
export const MAX_ANDROID_TERMINAL_JOB_GROUPS = 500;

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

export function runtimeProgressFromGroup(group: JobGroupSnapshot): ProgressInfo | null {
  const slot = latestRunningSlot(group);
  if (!slot) return null;
  return {
    stage: slot.stage?.trim() || (slot.status === "queued" ? "排队中" : "处理中"),
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

export function mergeJobGroupList(existing: JobGroupSnapshot[], incoming: JobGroupSnapshot) {
  const next = existing.filter((group) => group.groupId !== incoming.groupId);
  next.unshift(incoming);
  next.sort((a, b) => b.createdAt - a.createdAt);
  return next.slice(0, MAX_BROWSER_JOB_GROUPS);
}

export function retainAndroidJobGroups(groups: JobGroupSnapshot[]) {
  const ordered = [...groups].sort((a, b) => b.createdAt - a.createdAt);
  const nonTerminal = ordered.filter((group) => group.slots.some((slot) => !isTerminalJobStatus(slot.status)));
  const terminalBudget = Math.max(
    0,
    Math.min(MAX_ANDROID_TERMINAL_JOB_GROUPS, MAX_ANDROID_JOB_GROUPS - nonTerminal.length),
  );
  const terminal = ordered
    .filter((group) => group.slots.every((slot) => isTerminalJobStatus(slot.status)))
    .slice(0, terminalBudget);
  return [...nonTerminal, ...terminal].sort((a, b) => b.createdAt - a.createdAt);
}

function jobStatusProgressRank(status: JobStatus) {
  if (isTerminalJobStatus(status)) return 2;
  return status === "running" ? 1 : 0;
}

function monotonicAndroidJobSlot(
  existing: JobSlotSnapshot,
  incoming: JobSlotSnapshot,
): JobSlotSnapshot {
  if (incoming.updatedAt > existing.updatedAt) return incoming;
  if (incoming.updatedAt < existing.updatedAt) return existing;

  const existingRank = jobStatusProgressRank(existing.status);
  const incomingRank = jobStatusProgressRank(incoming.status);
  if (incomingRank > existingRank) return incoming;

  // Equal-time terminal snapshots may represent competing final callbacks.
  // Keep the value already accepted by the store instead of flipping outcomes.
  return existing;
}

export function mergeAndroidJobGroupSnapshot(
  existing: JobGroupSnapshot,
  incoming: JobGroupSnapshot,
): JobGroupSnapshot {
  const incomingSlots = new Map(incoming.slots.map((slot) => [slot.jobId, slot]));
  const mergedSlots = existing.slots.map((slot) => {
    const next = incomingSlots.get(slot.jobId);
    incomingSlots.delete(slot.jobId);
    return next ? monotonicAndroidJobSlot(slot, next) : slot;
  });
  mergedSlots.push(...incomingSlots.values());

  return {
    ...incoming,
    ...existing,
    slotIds: mergedSlots.map((slot) => slot.jobId),
    slots: mergedSlots,
    statusSummary: summarizeJobStatuses(mergedSlots),
  };
}

function withRecomputedAndroidStatusSummary(group: JobGroupSnapshot): JobGroupSnapshot {
  return {
    ...group,
    slotIds: group.slots.map((slot) => slot.jobId),
    statusSummary: summarizeJobStatuses(group.slots),
  };
}

export function mergeAndroidJobGroupList(existing: JobGroupSnapshot[], incoming: JobGroupSnapshot) {
  const current = existing.find((group) => group.groupId === incoming.groupId);
  const merged = current
    ? mergeAndroidJobGroupSnapshot(current, incoming)
    : withRecomputedAndroidStatusSummary(incoming);
  return retainAndroidJobGroups([
    merged,
    ...existing.filter((group) => group.groupId !== incoming.groupId),
  ]);
}

export function replaceWorkspaceJobGroups(
  current: Record<string, JobGroupSnapshot[]>,
  workspaceId: string,
  groups: JobGroupSnapshot[],
) {
  return {
    ...current,
    [workspaceId]: [...groups].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_BROWSER_JOB_GROUPS),
  };
}

export function replaceAndroidWorkspaceJobGroups(
  current: Record<string, JobGroupSnapshot[]>,
  workspaceId: string,
  groups: JobGroupSnapshot[],
) {
  const merged = groups.reduce(
    (next, group) => mergeAndroidJobGroupList(next, group),
    current[workspaceId] ?? [],
  );
  return {
    ...current,
    [workspaceId]: retainAndroidJobGroups(merged),
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

export function mergeAndroidWorkspaceJobGroup(
  current: Record<string, JobGroupSnapshot[]>,
  group: JobGroupSnapshot,
) {
  const existing = current[group.workspaceId] ?? [];
  return {
    ...current,
    [group.workspaceId]: mergeAndroidJobGroupList(existing, group),
  };
}

export function runtimeStateFromJobGroups(groups: JobGroupSnapshot[]) {
  const runningGroups = groups
    .filter((group) => runningJobIdsFromGroup(group).length > 0)
    .sort((a, b) => b.createdAt - a.createdAt);
  if (runningGroups.length === 0) {
    const latest = latestGroup(groups);
    const latestTerminal = latest ? latestTerminalSlot(latest) : null;
    return {
      runningJobs: [] as string[],
      jobsTotal: 0,
      jobsCompleted: 0,
      progress: null as ProgressInfo | null,
      lastLogLine: latestTerminal?.stage?.trim() || "",
      errorMessage: latestTerminal?.status === "failed" || latestTerminal?.status === "interrupted"
        ? (latestTerminal.errorMessage?.trim() || null)
        : null,
      errorRawPath: latestTerminal?.status === "failed" || latestTerminal?.status === "interrupted"
        ? (latestTerminal.rawPath?.trim() || null)
        : null,
      isRunning: false,
    };
  }

  const runningJobs = runningGroups.flatMap((group) => runningJobIdsFromGroup(group));
  const runningGroup = runningGroups[0];
  const progress = runtimeProgressFromGroup(runningGroup);
  return {
    runningJobs,
    jobsTotal: runningGroups.reduce((sum, group) => sum + group.batchCount, 0),
    jobsCompleted: runningGroups.reduce((sum, group) => sum + jobsCompletedFromGroup(group), 0),
    progress,
    lastLogLine: progress?.stage || "",
    errorMessage: null,
    errorRawPath: null,
    isRunning: runningJobs.length > 0,
  };
}
