import { afterEach, beforeEach, expect, test, vi } from "vitest";

const { eventDetachers, eventHandlers, eventsOnMock, generateMock, setOutputDirMock } = vi.hoisted(() => {
  const eventHandlers = new Map<string, (payload?: unknown, meta?: unknown) => void>();
  const eventDetachers = new Map<string, ReturnType<typeof vi.fn>>();
  const eventsOnMock = vi.fn((eventName: string, callback: (payload?: unknown, meta?: unknown) => void) => {
    eventHandlers.set(eventName, callback);
    const detach = vi.fn(() => {
      if (eventHandlers.get(eventName) === callback) eventHandlers.delete(eventName);
    });
    eventDetachers.set(eventName, detach);
    return detach;
  });
  return {
    eventHandlers,
    eventDetachers,
    eventsOnMock,
    generateMock: vi.fn(async (options: { requestedJobId?: string }) => ({
    jobId: options.requestedJobId || "mock-job",
    })),
    setOutputDirMock: vi.fn(async () => undefined),
  };
});

vi.mock("../src/platform/runtime/host", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/platform/runtime/host")>();
  return {
    ...actual,
    detectHostKind: () => "wails",
    EventsOn: eventsOnMock,
    Generate: generateMock,
    Edit: generateMock,
    GetStoredAPIKey: async () => "offline-native-submit-test-key",
    SetOutputDir: setOutputDirMock,
  };
});

vi.mock("../src/lib/storage", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/lib/storage")>(),
  clearHistoryStorage: async () => ({ historyEntries: 0, fullHistoryEntries: 0 }),
  persistHistoryItem: async () => undefined,
  persistHistoryItems: async () => undefined,
}));

import { FHL_BASE_URL, FHL_IMAGE_MODEL_ID } from "../src/lib/profiles";
import { useStudioStore } from "../src/state/studioStore";
import type { UpstreamProfile, Workspace } from "../src/types/domain";

const workspaceId = "native-continuous-submit-workspace";
const profileId = "fhl-images-pool-1";

function testWorkspace(): Workspace {
  return {
    id: workspaceId,
    name: "Native submit test",
    promptPrefix: "",
    prompt: "offline native continuous task",
    optimizationGuidance: "",
    negativePrompt: "",
    mode: "generate",
    size: "9:16@2k",
    quality: "medium",
    outputFormat: "png",
    seed: 0,
    batchCount: 1,
    continuousGenerateTest: true,
    editSourceMode: "manual",
    editAutoAspectUserLocked: false,
    batchProcess: {
      inputDir: "",
      outputMode: "source_dir",
      outputDir: "",
      concurrency: 2,
      retryOnFailure: false,
      autoAspectResolution: "1k",
      batchSourceSlotIndex: 0,
      discoveredSources: [],
    },
    styleTag: "",
    sources: [],
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
  };
}

function testProfile(): UpstreamProfile {
  return {
    id: profileId,
    name: "FHL Images 1",
    apiMode: "images",
    requestPolicy: "openai",
    baseURL: FHL_BASE_URL,
    textModelID: "",
    imageModelID: FHL_IMAGE_MODEL_ID,
    concurrencyLimit: 5,
    continuousPoolEnabled: true,
    imagesNewAPICompat: true,
    fhlImagesPoolSlot: 1,
    fhlImagesPoolKeyHint: "offline-test",
    createdAt: 1,
  };
}

beforeEach(() => {
  generateMock.mockClear();
  eventsOnMock.mockClear();
  eventHandlers.clear();
  eventDetachers.clear();
  setOutputDirMock.mockClear();
  const workspace = testWorkspace();
  useStudioStore.setState({
    apiKey: "offline-native-submit-test-key",
    apiMode: "images",
    fhlTransportMode: "images",
    baseURL: FHL_BASE_URL,
    imageModelID: FHL_IMAGE_MODEL_ID,
    imagesNewAPICompat: true,
    profiles: [testProfile()],
    activeProfileId: profileId,
    prompt: workspace.prompt,
    mode: "generate",
    size: workspace.size,
    quality: workspace.quality,
    outputFormat: workspace.outputFormat,
    batchCount: 1,
    continuousGenerateTest: true,
    fhlPoolPerAPIConcurrencyLimit: 5,
    fhlPoolEffectiveConcurrencyByProfileId: {},
    workspaces: [workspace],
    activeWorkspaceId: workspaceId,
    batchTasksById: {},
    batchResults: [],
    history: [],
    runningJobs: [],
    runningJobMeta: {},
    jobGroupsByWorkspace: {},
    jobsTotal: 0,
    jobsCompleted: 0,
    jobsFailed: 0,
    isRunning: false,
    resultGridOpen: false,
    historyGalleryOpen: false,
    errorMessage: null,
    errorRawPath: null,
    toasts: [],
  });
});

afterEach(() => {
  for (const [eventName, callback] of Array.from(eventHandlers.entries())) {
    if (eventName.startsWith("settled:")) callback(undefined, { sequence: 99, state: "settled" });
  }
  eventHandlers.clear();
});

test("one native continuous submit creates and displays exactly one task", async () => {
  await useStudioStore.getState().submit();

  await vi.waitFor(() => expect(generateMock).toHaveBeenCalledTimes(1));
  const state = useStudioStore.getState();
  const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
  const taskIds = workspace?.batchTaskIds ?? [];

  expect(taskIds).toHaveLength(1);
  expect(Object.keys(state.batchTasksById)).toEqual(taskIds);
  expect(state.batchTasksById[taskIds[0]]?.workspaceId).toBe(workspaceId);
  expect(["queued", "running"]).toContain(state.batchTasksById[taskIds[0]]?.status);
  expect(workspace?.resultGridOpen).toBe(true);
  expect(state.resultGridOpen).toBe(true);
  expect(state.jobsTotal).toBe(1);
});

test("native startup failure remains visible as a failed task", async () => {
  generateMock.mockRejectedValueOnce(new Error("offline startup failure"));

  await useStudioStore.getState().submit();

  await vi.waitFor(() => {
    const state = useStudioStore.getState();
    const taskId = state.workspaces.find((entry) => entry.id === workspaceId)?.batchTaskIds[0];
    expect(taskId).toBeTruthy();
    expect(state.batchTasksById[taskId!]?.status).toBe("failed");
    expect(state.batchTasksById[taskId!]?.errorMessage).toContain("offline startup failure");
    expect(state.resultGridOpen).toBe(true);
  });
});

test("native result commits once and settled releases metadata and all handlers", async () => {
  await useStudioStore.getState().submit();
  await vi.waitFor(() => expect(generateMock).toHaveBeenCalledTimes(1));
  const jobId = Object.keys(useStudioStore.getState().runningJobMeta)[0];
  expect(jobId).toBeTruthy();
  const result = eventHandlers.get(`result:${jobId}`)!;
  const error = eventHandlers.get(`error:${jobId}`)!;
  const settled = eventHandlers.get(`settled:${jobId}`)!;
  const resultPayload = {
    imageId: "offline-result",
    prompt: "offline native continuous task",
    revisedPrompt: "",
    mode: "generate",
    savedPath: "C:\\offline\\result.png",
    rawPath: "C:\\offline\\result.json",
  };

  result(resultPayload, { sequence: 2, state: "succeeded" });
  result(resultPayload, { sequence: 3, state: "succeeded" });
  error({ message: "late duplicate" }, { sequence: 4, state: "failed" });
  settled(undefined, { sequence: 1, state: "settled" });

  await vi.waitFor(() => {
    const state = useStudioStore.getState();
    const taskId = state.workspaces[0]?.batchTaskIds[0];
    expect(state.batchTasksById[taskId]?.status).toBe("succeeded");
    expect(state.history.filter((item) => item.imageId === "offline-result")).toHaveLength(1);
    expect(state.runningJobMeta).not.toHaveProperty(jobId);
  });
  for (const eventName of ["progress", "log", "preview", "result", "error", "settled"]) {
    expect(eventDetachers.get(`${eventName}:${jobId}`)).toHaveBeenCalledTimes(1);
  }
});

test("application reset detaches a cancelled native lifecycle and ignores late settled", async () => {
  await useStudioStore.getState().submit();
  await vi.waitFor(() => expect(generateMock).toHaveBeenCalledTimes(1));
  const state = useStudioStore.getState();
  const jobId = Object.keys(state.runningJobMeta)[0];
  const workspace = state.workspaces[0];
  const taskId = workspace.batchTaskIds[0];
  const lateSettled = eventHandlers.get(`settled:${jobId}`)!;
  useStudioStore.setState({
    batchTasksById: {
      ...state.batchTasksById,
      [taskId]: { ...state.batchTasksById[taskId], status: "cancelled" },
    },
    runningJobMeta: {},
    runningJobs: [],
    isRunning: false,
    workspaces: [{ ...workspace, runningJobIds: [] }],
  });

  await useStudioStore.getState().resetApplicationStatePreservingAPI();
  const afterReset = useStudioStore.getState();
  expect(afterReset.runningJobMeta).toEqual({});
  expect(afterReset.batchTasksById).toEqual({});
  for (const eventName of ["progress", "log", "preview", "result", "error", "settled"]) {
    expect(eventDetachers.get(`${eventName}:${jobId}`)).toHaveBeenCalledTimes(1);
  }

  lateSettled(undefined, { sequence: 99, state: "settled" });
  expect(useStudioStore.getState().runningJobMeta).toEqual({});
  expect(useStudioStore.getState().batchTasksById).toEqual({});
});
