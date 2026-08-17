import type { BrowserJobEvent } from "../platform/runtime/browserJobContracts.ts";
import type { JobGroupSnapshot } from "../types/domain.ts";
import { runningJobIdsFromGroup } from "./browserJobs.ts";

type Detach = () => void;

type BrowserTaskLifecycleRuntime = {
  mode: () => "browser" | "android";
  getGroups: () => Record<string, JobGroupSnapshot[]>;
  isWorkspaceKnown: (workspaceId: string) => boolean;
  resolveWorkspaceIdForJob: (jobId: string) => string;
  jobStillLooksActive: (jobId: string) => boolean;
  applyEvent: (event: BrowserJobEvent) => boolean;
  refreshWorkspace: (
    workspaceId: string,
    jobIds: ReadonlySet<string>,
    isCurrent: () => boolean,
  ) => Promise<void>;
  subscribeJob: (
    jobId: string,
    onEvent: (event: BrowserJobEvent) => void,
    onError: (error: Error) => void,
    onClose: () => void,
  ) => Detach;
  subscribeWorkspace: (
    workspaceId: string,
    onEvent: (event: BrowserJobEvent) => void,
    onError: (error: Error) => void,
    onClose: () => void,
  ) => Detach;
};

type Subscription = {
  detach: Detach;
};

type RefreshRequest = {
  generation: number;
  pendingJobIds: Set<string>;
  promise: Promise<void>;
};

function once(callback: Detach): Detach {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    try { callback(); } catch {}
  };
}

export function createBrowserTaskLifecycle(runtime: BrowserTaskLifecycleRuntime) {
  const jobSubscriptions = new Map<string, Subscription>();
  const workspaceSubscriptions = new Map<string, Subscription>();
  const refreshes = new Map<string, RefreshRequest>();
  let generation = 0;

  const clearJob = (jobId: string) => {
    const subscription = jobSubscriptions.get(jobId);
    if (!subscription) return;
    jobSubscriptions.delete(jobId);
    subscription.detach();
  };

  const clearWorkspace = (workspaceId: string) => {
    const subscription = workspaceSubscriptions.get(workspaceId);
    if (!subscription) return;
    workspaceSubscriptions.delete(workspaceId);
    subscription.detach();
  };

  const requestRefresh = (workspaceId: string, jobId?: string): Promise<void> => {
    if (!workspaceId || !runtime.isWorkspaceKnown(workspaceId)) return Promise.resolve();
    const existing = refreshes.get(workspaceId);
    if (existing && existing.generation === generation) {
      if (jobId) existing.pendingJobIds.add(jobId);
      return existing.promise;
    }

    const refreshGeneration = generation;
    const pendingJobIds = new Set<string>();
    if (jobId) pendingJobIds.add(jobId);
    const isCurrent = () => refreshGeneration === generation && runtime.isWorkspaceKnown(workspaceId);
    const request: RefreshRequest = {
      generation: refreshGeneration,
      pendingJobIds,
      promise: Promise.resolve(),
    };
    const promise = Promise.resolve()
      .then(async () => {
        do {
          const requestedJobIds = new Set(request.pendingJobIds);
          request.pendingJobIds.clear();
          await runtime.refreshWorkspace(workspaceId, requestedJobIds, isCurrent);
        } while (isCurrent() && request.pendingJobIds.size > 0);
      })
      .catch(() => undefined)
      .finally(() => {
        const current = refreshes.get(workspaceId);
        if (current?.promise === promise) refreshes.delete(workspaceId);
        if (isCurrent()) sync(runtime.getGroups());
      });
    request.promise = promise;
    refreshes.set(workspaceId, request);
    return promise;
  };

  const ensureJob = (jobId: string) => {
    if (!jobId || jobSubscriptions.has(jobId)) return;
    let ended = false;
    const placeholder: Subscription = { detach: () => {} };
    jobSubscriptions.set(jobId, placeholder);
    const reconcileIfEndedEarly = () => {
      if (ended) return;
      ended = true;
      const workspaceId = runtime.resolveWorkspaceIdForJob(jobId);
      const shouldRefresh = runtime.jobStillLooksActive(jobId);
      clearJob(jobId);
      if (shouldRefresh && workspaceId) void requestRefresh(workspaceId, jobId);
    };
    const detach = once(runtime.subscribeJob(jobId, (event) => {
      if (event.slot.jobId !== jobId) return;
      const workspaceId = event.group.workspaceId;
      if (event.slot.workspaceId !== workspaceId) return;
      if (!runtime.isWorkspaceKnown(workspaceId)) return;
      if (runtime.resolveWorkspaceIdForJob(jobId) !== workspaceId) return;
      if (runtime.applyEvent(event)) clearJob(jobId);
    }, reconcileIfEndedEarly, reconcileIfEndedEarly));
    if (jobSubscriptions.get(jobId) === placeholder) {
      placeholder.detach = detach;
    } else {
      detach();
    }
  };

  const ensureWorkspace = (workspaceId: string) => {
    if (!workspaceId || !runtime.isWorkspaceKnown(workspaceId) || workspaceSubscriptions.has(workspaceId)) return;
    let ended = false;
    const placeholder: Subscription = { detach: () => {} };
    workspaceSubscriptions.set(workspaceId, placeholder);
    const reconcileIfEndedEarly = () => {
      if (ended) return;
      ended = true;
      const shouldRefresh = workspaceHasActiveJobs(runtime.getGroups(), workspaceId);
      clearWorkspace(workspaceId);
      if (shouldRefresh && runtime.isWorkspaceKnown(workspaceId)) void requestRefresh(workspaceId);
    };
    const detach = once(runtime.subscribeWorkspace(workspaceId, (event) => {
      if (event.group.workspaceId !== workspaceId || event.slot.workspaceId !== workspaceId) return;
      if (!runtime.isWorkspaceKnown(workspaceId)) return;
      if (runtime.applyEvent(event)) sync(runtime.getGroups());
    }, reconcileIfEndedEarly, reconcileIfEndedEarly));
    if (workspaceSubscriptions.get(workspaceId) === placeholder) {
      placeholder.detach = detach;
    } else {
      detach();
    }
  };

  const sync = (groupsByWorkspace: Record<string, JobGroupSnapshot[]>) => {
    if (runtime.mode() === "browser") {
      for (const jobId of Array.from(jobSubscriptions.keys())) clearJob(jobId);
      const liveWorkspaceIds = new Set<string>();
      for (const [workspaceId, groups] of Object.entries(groupsByWorkspace)) {
        if (!runtime.isWorkspaceKnown(workspaceId)) continue;
        if (!groups.some((group) => runningJobIdsFromGroup(group).length > 0)) continue;
        liveWorkspaceIds.add(workspaceId);
        ensureWorkspace(workspaceId);
      }
      for (const workspaceId of Array.from(workspaceSubscriptions.keys())) {
        if (!liveWorkspaceIds.has(workspaceId)) clearWorkspace(workspaceId);
      }
      return;
    }

    for (const workspaceId of Array.from(workspaceSubscriptions.keys())) clearWorkspace(workspaceId);
    const liveJobIds = new Set<string>();
    for (const [workspaceId, groups] of Object.entries(groupsByWorkspace)) {
      if (!runtime.isWorkspaceKnown(workspaceId)) continue;
      for (const group of groups) {
        for (const jobId of runningJobIdsFromGroup(group)) {
          liveJobIds.add(jobId);
          ensureJob(jobId);
        }
      }
    }
    for (const jobId of Array.from(jobSubscriptions.keys())) {
      if (!liveJobIds.has(jobId)) clearJob(jobId);
    }
  };

  const reset = () => {
    generation += 1;
    for (const jobId of Array.from(jobSubscriptions.keys())) clearJob(jobId);
    for (const workspaceId of Array.from(workspaceSubscriptions.keys())) clearWorkspace(workspaceId);
    refreshes.clear();
  };

  return {
    sync,
    reset,
    requestRefresh,
    activeJobIds: () => Array.from(jobSubscriptions.keys()),
    activeWorkspaceIds: () => Array.from(workspaceSubscriptions.keys()),
  };
}

function workspaceHasActiveJobs(
  groupsByWorkspace: Record<string, JobGroupSnapshot[]>,
  workspaceId: string,
) {
  return (groupsByWorkspace[workspaceId] ?? []).some((group) => runningJobIdsFromGroup(group).length > 0);
}
