import { beforeEach, expect, test, vi } from "vitest";

const { generateMock } = vi.hoisted(() => ({
  generateMock: vi.fn(async (options: { requestedJobId?: string }) => ({
    jobId: options.requestedJobId || "mock-job",
  })),
}));

vi.mock("../src/platform/runtime/host", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/platform/runtime/host")>();
  return {
    ...actual,
    detectHostKind: () => "wails",
    EventsOn: () => () => {},
    Generate: generateMock,
    Edit: generateMock,
    GetStoredAPIKey: async () => "offline-native-submit-test-key",
  };
});

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
