import { describe, expect, it, vi } from "vitest";
import type { BrowserJobEvent } from "../src/platform/runtime/browserJobContracts.ts";
import { createBrowserTaskLifecycle } from "../src/state/studioStore.browserTaskLifecycle.ts";
import type { JobGroupSnapshot, JobStatus } from "../src/types/domain.ts";

function makeGroup(workspaceId: string, jobId: string, status: JobStatus): JobGroupSnapshot {
  const slot = {
    jobId,
    groupId: `group-${jobId}`,
    workspaceId,
    batchIndex: 0,
    status,
    createdAt: 1,
    updatedAt: 1,
  };
  return {
    groupId: slot.groupId,
    workspaceId,
    createdAt: 1,
    mode: "generate",
    apiMode: "images",
    prompt: "prompt",
    batchCount: 1,
    size: "1024x1024",
    quality: "medium",
    outputFormat: "png",
    slotIds: [jobId],
    slots: [slot],
    statusSummary: {
      queued: status === "queued" ? 1 : 0,
      running: status === "running" ? 1 : 0,
      succeeded: status === "succeeded" ? 1 : 0,
      failed: status === "failed" ? 1 : 0,
      cancelled: status === "cancelled" ? 1 : 0,
      interrupted: status === "interrupted" ? 1 : 0,
    },
  };
}

function eventFor(group: JobGroupSnapshot, type: BrowserJobEvent["type"]): BrowserJobEvent {
  return { type, group, slot: group.slots[0] } as BrowserJobEvent;
}

function createHarness(mode: "browser" | "android" = "browser") {
  let groups: Record<string, JobGroupSnapshot[]> = {};
  const knownWorkspaces = new Set<string>();
  const appliedEvents: BrowserJobEvent[] = [];
  const workspaceStreams = new Map<string, {
    event: (event: BrowserJobEvent) => void;
    error: (error: Error) => void;
    close: () => void;
    detach: ReturnType<typeof vi.fn>;
  }>();
  const jobStreams = new Map<string, {
    event: (event: BrowserJobEvent) => void;
    error: (error: Error) => void;
    close: () => void;
    detach: ReturnType<typeof vi.fn>;
  }>();
  const refreshWorkspace = vi.fn(async () => undefined);
  const subscribeWorkspace = vi.fn((
    workspaceId: string,
    onEvent: (event: BrowserJobEvent) => void,
    onError: (error: Error) => void,
    onClose: () => void,
  ) => {
    const detach = vi.fn();
    workspaceStreams.set(workspaceId, { event: onEvent, error: onError, close: onClose, detach });
    return detach;
  });
  const subscribeJob = vi.fn((
    jobId: string,
    onEvent: (event: BrowserJobEvent) => void,
    onError: (error: Error) => void,
    onClose: () => void,
  ) => {
    const detach = vi.fn();
    jobStreams.set(jobId, { event: onEvent, error: onError, close: onClose, detach });
    return detach;
  });
  const lifecycle = createBrowserTaskLifecycle({
    mode: () => mode,
    getGroups: () => groups,
    isWorkspaceKnown: (workspaceId) => knownWorkspaces.has(workspaceId),
    resolveWorkspaceIdForJob: (jobId) => {
      for (const [workspaceId, workspaceGroups] of Object.entries(groups)) {
        if (workspaceGroups.some((group) => group.slots.some((slot) => slot.jobId === jobId))) return workspaceId;
      }
      return "";
    },
    jobStillLooksActive: (jobId) => Object.values(groups).some((workspaceGroups) => (
      workspaceGroups.some((group) => group.slots.some((slot) => (
        slot.jobId === jobId && (slot.status === "queued" || slot.status === "running")
      )))
    )),
    applyEvent: (event) => {
      appliedEvents.push(event);
      groups = { ...groups, [event.group.workspaceId]: [event.group] };
      return event.type !== "snapshot";
    },
    refreshWorkspace,
    subscribeJob,
    subscribeWorkspace,
  });
  return {
    lifecycle,
    knownWorkspaces,
    appliedEvents,
    workspaceStreams,
    jobStreams,
    refreshWorkspace,
    subscribeWorkspace,
    subscribeJob,
    setGroups(next: Record<string, JobGroupSnapshot[]>) { groups = next; },
    getGroups() { return groups; },
  };
}

describe("browser task lifecycle", () => {
  it("uses one workspace stream in browser mode and detaches dead workspaces once", () => {
    const harness = createHarness("browser");
    const running = makeGroup("workspace-1", "job-1", "running");
    harness.knownWorkspaces.add("workspace-1");
    harness.setGroups({ "workspace-1": [running] });

    harness.lifecycle.sync(harness.getGroups());
    harness.lifecycle.sync(harness.getGroups());

    expect(harness.subscribeWorkspace).toHaveBeenCalledTimes(1);
    expect(harness.subscribeJob).not.toHaveBeenCalled();
    const stream = harness.workspaceStreams.get("workspace-1")!;
    stream.event(eventFor(makeGroup("workspace-1", "job-1", "succeeded"), "terminal"));
    harness.lifecycle.sync(harness.getGroups());

    expect(stream.detach).toHaveBeenCalledTimes(1);
    expect(harness.lifecycle.activeWorkspaceIds()).toEqual([]);
  });

  it("uses per-job Android subscriptions and isolates jobs and workspaces", () => {
    const harness = createHarness("android");
    const first = makeGroup("workspace-1", "job-1", "running");
    const second = makeGroup("workspace-2", "job-2", "running");
    harness.knownWorkspaces.add("workspace-1");
    harness.knownWorkspaces.add("workspace-2");
    harness.setGroups({ "workspace-1": [first], "workspace-2": [second] });

    harness.lifecycle.sync(harness.getGroups());
    harness.lifecycle.sync(harness.getGroups());

    expect(harness.subscribeJob).toHaveBeenCalledTimes(2);
    expect(harness.subscribeWorkspace).not.toHaveBeenCalled();
    const firstStream = harness.jobStreams.get("job-1")!;
    firstStream.event(eventFor(second, "snapshot"));
    firstStream.event(eventFor(makeGroup("workspace-2", "job-1", "running"), "snapshot"));
    expect(harness.appliedEvents).toEqual([]);

    firstStream.event(eventFor(makeGroup("workspace-1", "job-1", "succeeded"), "terminal"));
    expect(harness.appliedEvents).toHaveLength(1);
    expect(firstStream.detach).toHaveBeenCalledTimes(1);
    expect(harness.lifecycle.activeJobIds()).toEqual(["job-2"]);
  });

  it("refreshes once when a stream reports both error and close, then resubscribes without duplication", async () => {
    const harness = createHarness("browser");
    const running = makeGroup("workspace-1", "job-1", "running");
    harness.knownWorkspaces.add("workspace-1");
    harness.setGroups({ "workspace-1": [running] });
    let resolveRefresh!: () => void;
    harness.refreshWorkspace.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    }));
    harness.lifecycle.sync(harness.getGroups());
    const firstStream = harness.workspaceStreams.get("workspace-1")!;

    firstStream.error(new Error("stream ended"));
    firstStream.close();
    await vi.waitFor(() => expect(harness.refreshWorkspace).toHaveBeenCalledTimes(1));
    expect(firstStream.detach).toHaveBeenCalledTimes(1);
    resolveRefresh();
    await vi.waitFor(() => expect(harness.subscribeWorkspace).toHaveBeenCalledTimes(2));

    firstStream.error(new Error("late duplicate"));
    expect(harness.refreshWorkspace).toHaveBeenCalledTimes(1);
    expect(harness.lifecycle.activeWorkspaceIds()).toEqual(["workspace-1"]);
  });

  it("coalesces same-workspace job refreshes without dropping either job id", async () => {
    const harness = createHarness("android");
    const first = makeGroup("workspace-1", "job-1", "running");
    const second = makeGroup("workspace-1", "job-2", "running");
    harness.knownWorkspaces.add("workspace-1");
    harness.setGroups({ "workspace-1": [first, second] });
    let resolveRefresh!: () => void;
    let requestedJobIds: ReadonlySet<string> | undefined;
    harness.refreshWorkspace.mockImplementationOnce((_workspaceId, jobIds) => {
      requestedJobIds = jobIds;
      return new Promise<void>((resolve) => { resolveRefresh = resolve; });
    });
    harness.lifecycle.sync(harness.getGroups());

    harness.jobStreams.get("job-1")!.error(new Error("first ended"));
    harness.jobStreams.get("job-2")!.close();
    await vi.waitFor(() => expect(harness.refreshWorkspace).toHaveBeenCalledTimes(1));

    expect(Array.from(requestedJobIds ?? []).sort()).toEqual(["job-1", "job-2"]);
    resolveRefresh();
    await vi.waitFor(() => expect(harness.subscribeJob).toHaveBeenCalledTimes(4));
  });

  it("ignores late removed-workspace events and reset prevents pending refresh resurrection", async () => {
    const harness = createHarness("browser");
    const running = makeGroup("workspace-1", "job-1", "running");
    harness.knownWorkspaces.add("workspace-1");
    harness.setGroups({ "workspace-1": [running] });
    let resolveRefresh!: () => void;
    harness.refreshWorkspace.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    }));
    harness.lifecycle.sync(harness.getGroups());
    const stream = harness.workspaceStreams.get("workspace-1")!;
    stream.error(new Error("stream ended"));
    await vi.waitFor(() => expect(harness.refreshWorkspace).toHaveBeenCalledTimes(1));

    harness.knownWorkspaces.delete("workspace-1");
    stream.event(eventFor(makeGroup("workspace-1", "job-1", "succeeded"), "terminal"));
    harness.lifecycle.reset();
    resolveRefresh();
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.appliedEvents).toEqual([]);
    expect(harness.subscribeWorkspace).toHaveBeenCalledTimes(1);
    expect(harness.lifecycle.activeWorkspaceIds()).toEqual([]);
  });
});
