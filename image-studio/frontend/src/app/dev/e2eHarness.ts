import {
  GetAutomationStatus,
  ImportImagePath,
  ListBatchInputImages,
  ReadImageAsBase64,
  RegisterImportedImageAsset,
} from "../../platform/runtime/host";
import type { AutomationStatusLike } from "../../platform/runtime/hostTypes";
import { useStudioStore } from "../../state/studioStore";
import { selectNextContinuousPoolProfile } from "../../state/continuousPoolScheduler";
import type { BatchTaskRecord, HistoryItem, SourceImage, Toast } from "../../types/domain";

type E2EWindow = Window & {
  __IMAGE_STUDIO_E2E_BOOTSTRAP?: AutomationStatusLike;
  __imageStudioE2E?: ImageStudioE2EHarness;
};

const e2eMessageSource = "image-studio-e2e";
const e2eStatusMarkerId = "image-studio-e2e-status";
const e2eBatchControlId = "image-studio-e2e-batch-control";
const e2eThumbnailDataURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
let activeHarness: ImageStudioE2EHarness | null = null;
let commandBridgeInstalled = false;

type ImageSummary = {
  id?: string;
  mode?: string;
  prompt?: string;
  size?: string;
  savedPath?: string;
  imageId?: string;
  previewUrl?: string;
  fullUrl?: string;
  width?: number;
  height?: number;
  sourceImages?: SourceSummary[];
  panoramaRoundtrip?: boolean;
};

type SourceSummary = {
  path?: string;
  name?: string;
  previewUrl?: string;
  width?: number;
  height?: number;
  panoramaRoundtrip?: boolean;
};

type StateSummary = {
  version: string;
  mode: string;
  editSourceMode: string;
  size: string;
  quality: string;
  outputFormat: string;
  apiMode: string;
  requestPolicy: string;
  activeProfileId: string;
  activeWorkspaceId: string;
  resultGridOpen: boolean;
  historyGalleryOpen: boolean;
  settingsOpen: boolean;
  upstreamModalOpen: boolean;
  resultDetailOpen: boolean;
  resultDetail: ImageSummary | null;
  panoramaViewerOpen: boolean;
  panoramaAlignOpen: boolean;
  continuousGenerateTest: boolean;
  batchProcess: {
    inputDir: string;
    discoveredCount: number;
    selectedCount: number;
    outputMode: string;
    outputDir: string;
  };
  runningJobs: string[];
  jobsTotal: number;
  jobsCompleted: number;
  jobsFailed: number;
  errorMessage: string | null;
  currentImage: ImageSummary | null;
  sourcePreviewReturnImage: ImageSummary | null;
  batchResults: ImageSummary[];
  sources: SourceSummary[];
  historyCount: number;
  toasts: Array<Pick<Toast, "text" | "kind">>;
};

type ImageStudioE2EHarness = {
  version: string;
  status: AutomationStatusLike;
  getStateSummary: () => StateSummary;
  waitForIdle: (timeoutMs?: number) => Promise<StateSummary>;
  setPrompt: (value: string) => void;
  setSize: (value: string) => void;
  openSettings: () => void;
  closeSettings: () => void;
  openResultGrid: () => void;
  closeResultGrid: () => void;
  loadBatchInputDir: (directory: string) => Promise<StateSummary>;
  openBatchPreviewGridFromDir: (directory: string, limit?: number) => Promise<StateSummary>;
  // Only exposed by --e2e-only. Builds task metadata in memory and never
  // accesses user files, persistence, credentials, or upstream APIs.
  openSyntheticBatchPreviewGrid?: (count?: number) => StateSummary;
  openSourcePreviewFromPath: (path: string, staleMediaUrl?: boolean) => Promise<StateSummary>;
  // Only exposed by --e2e-only. The input must already be a Wails-managed path.
  openManagedResultDetailFromPath?: (path: string, staleMediaUrl?: boolean) => Promise<StateSummary>;
  runPortablePathSmoke: (pathOrDirectory: string, limit?: number) => Promise<{
    target: string;
    batchLoaded: boolean;
    selectedCount: number;
    firstPath: string;
    normal: StateSummary;
    stale: StateSummary;
  }>;
  // This is deliberately absent outside of --e2e-only. It never touches the
  // store, backend bridge, network, keyring, or CLI configuration.
  runContinuousPoolSimulation?: (options?: unknown) => E2EContinuousPoolSimulationResult;
  // This is deliberately absent outside of --e2e-only. It models only safe
  // slot metadata; credential values are never accepted or returned.
  runImagesPoolSlotSimulation?: (options?: unknown) => E2EImagesPoolSlotSimulationResult;
};

const packageVersion = String(import.meta.env.PACKAGE_VERSION || "");

type E2ECommandRequest = {
  source?: string;
  direction?: "request";
  id?: string;
  command?: string;
  args?: unknown[];
};

type E2ECommandResponse = {
  source: string;
  direction: "response";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

type E2EContinuousPoolTaskStatus = "queued" | "running" | "cancelling" | "succeeded" | "cancelled";

type E2EContinuousPoolProfile = {
  id: string;
  name: string;
  apiMode: string;
  continuousPoolEnabled: boolean;
  concurrencyLimit: number;
};

type E2EContinuousPoolProfileSnapshot = {
  id: string;
  name: string;
  apiMode: string;
  concurrencyLimit: number;
};

type E2EContinuousPoolTask = {
  id: string;
  workspaceId: string;
  status: E2EContinuousPoolTaskStatus;
  apiMode?: "images" | "responses";
  apiProfileId?: string;
  apiProfileSnapshot?: E2EContinuousPoolProfileSnapshot;
};

type E2EContinuousPoolSimulationEvent = {
  sequence: number;
  type: "assigned" | "cancel_requested" | "cancelled_while_queued" | "settled";
  taskId: string;
  workspaceId: string;
  profileId?: string;
  status: E2EContinuousPoolTaskStatus;
  inFlightByProfileId: Record<string, number>;
  inFlightTotal: number;
};

type E2EContinuousPoolSimulationResult = {
  memoryOnly: true;
  fhlTransportMode: "images" | "responses";
  perAPIConcurrencyLimit: number;
  enabledAPICount: number;
  totalConcurrencyLimit: number;
  profiles: E2EContinuousPoolProfile[];
  tasks: E2EContinuousPoolTask[];
  events: E2EContinuousPoolSimulationEvent[];
  checks: {
    profileAssignment: boolean;
    queueDrained: boolean;
    cancellation: boolean;
    profileIsolation: boolean;
    totalCapacity: boolean;
  };
  summary: {
    queued: number;
    running: number;
    cancelling: number;
    succeeded: number;
    cancelled: number;
    initialRunning: number;
    initialQueued: number;
    maxTotalInFlight: number;
    inFlightByProfileId: Record<string, number>;
    maxInFlightByProfileId: Record<string, number>;
  };
  passed: boolean;
};

type E2EImagesPoolSlotProfile = {
  id: string;
  name: string;
  apiMode: string;
  officialImages: boolean;
  fhlImagesPoolSlot?: number;
  keyHint?: string;
  createdAt: number;
  running: boolean;
};

type E2EImagesPoolSlotEdit = {
  slot: number;
  newValuePresent: boolean;
  keyHint?: string;
};

type E2EImagesPoolSlotRow = {
  slot: number;
  profileId?: string;
  profileName?: string;
  origin: "saved" | "created" | "empty";
  newValuePresent: boolean;
  keyHint?: string;
};

type E2EImagesPoolSlotDeleteResult = {
  slot?: number;
  profileId?: string;
  status: "not_requested" | "empty" | "blocked_running" | "deleted";
};

type E2EImagesPoolSlotSimulationResult = {
  memoryOnly: true;
  initialProfileCount: number;
  initialImagesPoolProfileCount: number;
  profiles: E2EImagesPoolSlotProfile[];
  initialRows: E2EImagesPoolSlotRow[];
  rows: E2EImagesPoolSlotRow[];
  createdProfileIds: string[];
  updatedProfileIds: string[];
  blockedCreateSlots: number[];
  persistedSlotAssignments: Record<string, number>;
  delete: E2EImagesPoolSlotDeleteResult;
  checks: {
    tenRows: boolean;
    blankNewSlotsDoNotCreate: boolean;
    savedBlankKeepsProfile: boolean;
    legacyMapping: boolean;
    capRespected: boolean;
    deleteGuard: boolean;
  };
  passed: boolean;
};

const commandHandlers: Record<string, (harness: ImageStudioE2EHarness, args: unknown[]) => unknown> = {
  getStateSummary: (harness) => harness.getStateSummary(),
  waitForIdle: (harness, args) => harness.waitForIdle(Number(args[0]) || undefined),
  setPrompt: (harness, args) => harness.setPrompt(String(args[0] ?? "")),
  setSize: (harness, args) => harness.setSize(String(args[0] ?? "")),
  openSettings: (harness) => harness.openSettings(),
  closeSettings: (harness) => harness.closeSettings(),
  openResultGrid: (harness) => harness.openResultGrid(),
  closeResultGrid: (harness) => harness.closeResultGrid(),
  loadBatchInputDir: (harness, args) => harness.loadBatchInputDir(String(args[0] ?? "")),
  openBatchPreviewGridFromDir: (harness, args) => harness.openBatchPreviewGridFromDir(String(args[0] ?? ""), Number(args[1] ?? 10)),
  openSyntheticBatchPreviewGrid: (harness, args) => {
    if (!harness.openSyntheticBatchPreviewGrid) {
      throw new Error("Synthetic batch preview is only available in --e2e-only mode");
    }
    return harness.openSyntheticBatchPreviewGrid(Number(args[0] ?? 397));
  },
  openSourcePreviewFromPath: (harness, args) => harness.openSourcePreviewFromPath(String(args[0] ?? ""), args[1] === true),
  openManagedResultDetailFromPath: (harness, args) => {
    if (!harness.openManagedResultDetailFromPath) {
      throw new Error("Managed result-detail fixture is only available in --e2e-only mode");
    }
    return harness.openManagedResultDetailFromPath(String(args[0] ?? ""), args[1] === true);
  },
  runPortablePathSmoke: (harness, args) => harness.runPortablePathSmoke(String(args[0] ?? ""), Number(args[1] ?? 10)),
  runContinuousPoolSimulation: (harness, args) => {
    if (!harness.runContinuousPoolSimulation) {
      throw new Error("Continuous pool simulation is only available in --e2e-only mode");
    }
    return harness.runContinuousPoolSimulation(args[0]);
  },
  runImagesPoolSlotSimulation: (harness, args) => {
    if (!harness.runImagesPoolSlotSimulation) {
      throw new Error("Images pool slot simulation is only available in --e2e-only mode");
    }
    return harness.runImagesPoolSlotSimulation(args[0]);
  },
};

function asE2ERecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function e2eText(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function e2eNonNegativeInteger(value: unknown, fallback: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(0, Math.floor(numberValue));
}

function e2ePerAPIConcurrencyLimit(value: unknown): number {
  const normalized = e2eNonNegativeInteger(value, 4);
  if (normalized <= 0) return 5;
  return Math.max(1, Math.min(5, normalized));
}

function hasE2EOwnProperty(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function defaultE2EContinuousPoolProfiles(): unknown[] {
  return [
    {
      id: "e2e-images-alpha",
      name: "Images Alpha",
      apiMode: "images",
      continuousPoolEnabled: true,
      concurrencyLimit: 1,
    },
    {
      id: "e2e-images-bravo",
      name: "Images Bravo",
      apiMode: "images",
      continuousPoolEnabled: true,
      concurrencyLimit: 1,
    },
    {
      id: "e2e-responses-excluded",
      name: "Responses Excluded",
      apiMode: "responses",
      continuousPoolEnabled: true,
      concurrencyLimit: 1,
    },
    {
      id: "e2e-images-disabled",
      name: "Images Disabled",
      apiMode: "images",
      continuousPoolEnabled: false,
      concurrencyLimit: 1,
    },
  ];
}

function defaultE2EContinuousPoolTasks(): unknown[] {
  return [
    { id: "e2e-task-a", workspaceId: "e2e-workspace-a" },
    { id: "e2e-task-b", workspaceId: "e2e-workspace-b" },
    { id: "e2e-task-c", workspaceId: "e2e-workspace-a" },
    { id: "e2e-task-d", workspaceId: "e2e-workspace-b" },
  ];
}

function normalizeE2EContinuousPoolProfiles(value: unknown): E2EContinuousPoolProfile[] {
  const source = Array.isArray(value) ? value : defaultE2EContinuousPoolProfiles();
  const profiles: E2EContinuousPoolProfile[] = [];
  const seenIds = new Set<string>();

  for (const [index, valueAtIndex] of source.slice(0, 10).entries()) {
    const record = asE2ERecord(valueAtIndex);
    const id = e2eText(record?.id, `e2e-profile-${index + 1}`);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    profiles.push({
      id,
      name: e2eText(record?.name, id),
      apiMode: e2eText(record?.apiMode, "images").toLowerCase(),
      continuousPoolEnabled: record?.continuousPoolEnabled === true,
      concurrencyLimit: e2eNonNegativeInteger(record?.concurrencyLimit, 1),
    });
  }

  return profiles;
}

function normalizeE2EContinuousPoolTasks(value: unknown): E2EContinuousPoolTask[] {
  let source: unknown[];
  if (Array.isArray(value)) {
    source = value;
  } else if (typeof value === "number" && Number.isFinite(value)) {
    const count = Math.min(500, e2eNonNegativeInteger(value, 0));
    source = Array.from({ length: count }, (_, index) => ({
      id: `e2e-task-${index + 1}`,
      workspaceId: `e2e-workspace-${(index % 2) + 1}`,
    }));
  } else {
    source = defaultE2EContinuousPoolTasks();
  }

  const tasks: E2EContinuousPoolTask[] = [];
  const seenIds = new Set<string>();
  for (const [index, valueAtIndex] of source.slice(0, 500).entries()) {
    const record = asE2ERecord(valueAtIndex);
    const id = e2eText(record?.id, `e2e-task-${index + 1}`);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    tasks.push({
      id,
      workspaceId: e2eText(record?.workspaceId, `e2e-workspace-${(index % 2) + 1}`),
      status: "queued",
    });
  }

  return tasks;
}

function normalizeE2ECancelTaskIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    const id = e2eText(item, "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function normalizeE2EFHLTransportMode(value: unknown): "images" | "responses" {
  return value === "responses" ? "responses" : "images";
}

function e2eContinuousPoolCapacity(profiles: readonly E2EContinuousPoolProfile[]): number {
  return profiles
    .filter((profile) => profile.apiMode === "images" && profile.continuousPoolEnabled === true)
    .reduce((sum, profile) => sum + e2eNonNegativeInteger(profile.concurrencyLimit, 0), 0);
}

function applyE2EPerAPIConcurrencyLimit(
  profiles: readonly E2EContinuousPoolProfile[],
  perAPIConcurrencyLimit: number,
): E2EContinuousPoolProfile[] {
  return profiles.map((profile) => {
    if (profile.apiMode !== "images" || profile.continuousPoolEnabled !== true) return { ...profile };
    const slotMaximum = profile.concurrencyLimit > 0 ? Math.min(5, profile.concurrencyLimit) : 5;
    return {
      ...profile,
      concurrencyLimit: Math.min(perAPIConcurrencyLimit, slotMaximum),
    };
  });
}

function makeE2EContinuousPoolProfileSnapshot(
  profile: E2EContinuousPoolProfile,
  transportMode: "images" | "responses",
): E2EContinuousPoolProfileSnapshot {
  return {
    id: profile.id,
    name: profile.name,
    apiMode: transportMode,
    concurrencyLimit: profile.concurrencyLimit,
  };
}

function copyE2EInFlightCounts(
  profiles: readonly E2EContinuousPoolProfile[],
  inFlightByProfileId: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(profiles.map((profile) => [profile.id, inFlightByProfileId[profile.id] || 0]));
}

/**
 * A deterministic, memory-only model used by packaged --e2e-only tests. It
 * deliberately receives only non-sensitive profile fields and never calls the
 * store, Wails bridge, network, keyring, or CLI configuration.
 */
export function runE2EContinuousPoolSimulation(options: unknown = undefined): E2EContinuousPoolSimulationResult {
  const input = asE2ERecord(options);
  const perAPIConcurrencyLimit = e2ePerAPIConcurrencyLimit(input?.perAPIConcurrencyLimit);
  const profiles = applyE2EPerAPIConcurrencyLimit(
    normalizeE2EContinuousPoolProfiles(input?.profiles),
    perAPIConcurrencyLimit,
  );
  const tasks = normalizeE2EContinuousPoolTasks(input?.tasks);
  const fhlTransportMode = normalizeE2EFHLTransportMode(input?.fhlTransportMode);
  const cancelTaskIds = input
    ? normalizeE2ECancelTaskIds(hasE2EOwnProperty(input, "cancelTaskIds") ? input.cancelTaskIds : [])
    : ["e2e-task-b"];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const inFlightByProfileId: Record<string, number> = Object.fromEntries(profiles.map((profile) => [profile.id, 0]));
  const maxInFlightByProfileId: Record<string, number> = Object.fromEntries(profiles.map((profile) => [profile.id, 0]));
  const assignmentByTaskId = new Map<string, string>();
  const events: E2EContinuousPoolSimulationEvent[] = [];
  const enabledAPICount = profiles.filter((profile) => (
    profile.apiMode === "images" && profile.continuousPoolEnabled === true
  )).length;
  const totalConcurrencyLimit = e2eContinuousPoolCapacity(profiles);
  let inFlightTotal = 0;
  let maxTotalInFlight = 0;
  let cursor = 0;

  const recordEvent = (type: E2EContinuousPoolSimulationEvent["type"], task: E2EContinuousPoolTask) => {
    events.push({
      sequence: events.length + 1,
      type,
      taskId: task.id,
      workspaceId: task.workspaceId,
      profileId: task.apiProfileId,
      status: task.status,
      inFlightByProfileId: copyE2EInFlightCounts(profiles, inFlightByProfileId),
      inFlightTotal,
    });
  };

  const drain = () => {
    for (;;) {
      const task = tasks.find((candidate) => candidate.status === "queued");
      if (!task) return;
      if (inFlightTotal >= totalConcurrencyLimit) return;
      // Profile metadata remains Images because it represents an FHL slot. The
      // task snapshot owns the effective Images/Responses transport.
      const selection = selectNextContinuousPoolProfile(
        profiles.filter((profile) => profile.apiMode === "images"),
        inFlightByProfileId,
        cursor,
      );
      cursor = selection.nextCursor;
      if (!selection.profile) return;

      const profile = selection.profile;
      task.status = "running";
      task.apiMode = fhlTransportMode;
      task.apiProfileId = profile.id;
      task.apiProfileSnapshot = makeE2EContinuousPoolProfileSnapshot(profile, fhlTransportMode);
      assignmentByTaskId.set(task.id, profile.id);
      inFlightByProfileId[profile.id] = (inFlightByProfileId[profile.id] || 0) + 1;
      inFlightTotal++;
      maxTotalInFlight = Math.max(maxTotalInFlight, inFlightTotal);
      maxInFlightByProfileId[profile.id] = Math.max(
        maxInFlightByProfileId[profile.id] || 0,
        inFlightByProfileId[profile.id],
      );
      recordEvent("assigned", task);
    }
  };

  const requestCancellation = (taskId: string) => {
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task) return;
    if (task.status === "queued") {
      task.status = "cancelled";
      recordEvent("cancelled_while_queued", task);
      return;
    }
    if (task.status === "running") {
      // Capacity remains held until the simulated backend settles the job.
      task.status = "cancelling";
      recordEvent("cancel_requested", task);
    }
  };

  const settle = (task: E2EContinuousPoolTask) => {
    if (task.status !== "running" && task.status !== "cancelling") return;
    const profileId = task.apiProfileId;
    if (profileId) {
      inFlightByProfileId[profileId] = Math.max(0, (inFlightByProfileId[profileId] || 0) - 1);
      inFlightTotal = Math.max(0, inFlightTotal - 1);
    }
    task.status = task.status === "cancelling" ? "cancelled" : "succeeded";
    recordEvent("settled", task);
    drain();
  };

  drain();
  const initialRunning = tasks.filter((task) => task.status === "running").length;
  const initialQueued = tasks.filter((task) => task.status === "queued").length;
  for (const taskId of cancelTaskIds) requestCancellation(taskId);
  drain();

  for (;;) {
    const active = tasks.find((task) => task.status === "cancelling")
      ?? tasks.find((task) => task.status === "running");
    if (!active) break;
    settle(active);
  }

  const assignedTasks = tasks.filter((task) => !!task.apiProfileId);
  const profileAssignment = tasks.every((task) => {
    if (!task.apiProfileId) return task.status === "cancelled";
    const profile = profileById.get(task.apiProfileId);
    const snapshot = task.apiProfileSnapshot;
    return !!profile
      && profile.apiMode === "images"
      && profile.continuousPoolEnabled === true
      && !!snapshot
      && snapshot.id === task.apiProfileId
      && snapshot.name === profile.name
      && task.apiMode === fhlTransportMode
      && snapshot.apiMode === fhlTransportMode
      && snapshot.concurrencyLimit === profile.concurrencyLimit;
  });
  const queueDrained = tasks.every((task) => task.status === "succeeded" || task.status === "cancelled")
    && Object.values(inFlightByProfileId).every((count) => count === 0);
  const cancellation = cancelTaskIds.every((taskId) => {
    const task = tasks.find((candidate) => candidate.id === taskId);
    return task?.status === "cancelled" && events.some((event) => event.taskId === taskId && (
      event.type === "cancel_requested" || event.type === "cancelled_while_queued"
    ));
  });
  const snapshots = assignedTasks
    .map((task) => task.apiProfileSnapshot)
    .filter((snapshot): snapshot is E2EContinuousPoolProfileSnapshot => !!snapshot);
  const finiteCapacityRespected = profiles.every((profile) => (
    profile.concurrencyLimit === 0 || (maxInFlightByProfileId[profile.id] || 0) <= profile.concurrencyLimit
  ));
  const profileIsolation = snapshots.length === assignedTasks.length
    && new Set(snapshots).size === snapshots.length
    && assignedTasks.every((task) => assignmentByTaskId.get(task.id) === task.apiProfileId)
    && finiteCapacityRespected;
  const totalCapacity = maxTotalInFlight <= totalConcurrencyLimit;

  const summary = {
    queued: tasks.filter((task) => task.status === "queued").length,
    running: tasks.filter((task) => task.status === "running").length,
    cancelling: tasks.filter((task) => task.status === "cancelling").length,
    succeeded: tasks.filter((task) => task.status === "succeeded").length,
    cancelled: tasks.filter((task) => task.status === "cancelled").length,
    initialRunning,
    initialQueued,
    maxTotalInFlight,
    inFlightByProfileId: copyE2EInFlightCounts(profiles, inFlightByProfileId),
    maxInFlightByProfileId: copyE2EInFlightCounts(profiles, maxInFlightByProfileId),
  };
  const checks = { profileAssignment, queueDrained, cancellation, profileIsolation, totalCapacity };

  return {
    memoryOnly: true,
    fhlTransportMode,
    perAPIConcurrencyLimit,
    enabledAPICount,
    totalConcurrencyLimit,
    profiles,
    tasks,
    events,
    checks,
    summary,
    passed: Object.values(checks).every(Boolean),
  };
}

const E2E_IMAGES_POOL_SLOT_COUNT = 10;
const E2E_IMAGES_POOL_PROFILE_CAP = 10;
const E2E_IMAGES_POOL_PROFILE_FIELDS = new Set([
  "id",
  "name",
  "apiMode",
  "officialImages",
  "fhlImagesPoolSlot",
  "keyHint",
  "createdAt",
  "running",
]);
const E2E_IMAGES_POOL_EDIT_FIELDS = new Set(["slot", "newValuePresent", "keyHint"]);
const E2E_IMAGES_POOL_KEY_HINT_PATTERN = /^last4:[A-Za-z0-9_-]{4}$/;

function normalizeE2EImagesPoolSlot(value: unknown): number | undefined {
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue)) return undefined;
  return numberValue >= 1 && numberValue <= E2E_IMAGES_POOL_SLOT_COUNT ? numberValue : undefined;
}

function assertE2EImagesPoolFields(record: Record<string, unknown>, allowed: ReadonlySet<string>) {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      // Do not inspect or echo unknown values. This keeps accidental credential
      // fields out of the in-memory fixture and its command responses.
      throw new Error("Unsupported E2E Images pool simulation field.");
    }
  }
}

function normalizeE2EImagesPoolKeyHint(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !E2E_IMAGES_POOL_KEY_HINT_PATTERN.test(value)) {
    throw new Error("E2E Images pool keyHint must use the redacted last4:XXXX form.");
  }
  return value;
}

function defaultE2EImagesPoolSlotProfiles(): unknown[] {
  return [
    {
      id: "e2e-slot-legacy-alpha",
      name: "Legacy Alpha",
      apiMode: "images",
      officialImages: true,
      createdAt: 10,
      running: false,
    },
    {
      id: "e2e-slot-legacy-running",
      name: "Legacy Running",
      apiMode: "images",
      officialImages: true,
      createdAt: 20,
      running: true,
    },
    {
      id: "e2e-slot-pinned",
      name: "Pinned Images",
      apiMode: "images",
      officialImages: true,
      fhlImagesPoolSlot: 3,
      createdAt: 30,
      running: false,
    },
    {
      id: "e2e-slot-legacy-responses",
      name: "Legacy Responses",
      apiMode: "responses",
      officialImages: false,
      createdAt: 40,
      running: false,
    },
  ];
}

function defaultE2EImagesPoolSlotEdits(): unknown[] {
  // This is an opaque boolean only. No credential text is accepted by the fixture.
  return [{ slot: 4, newValuePresent: true, keyHint: "last4:0004" }];
}

function normalizeE2EImagesPoolSlotProfiles(value: unknown): E2EImagesPoolSlotProfile[] {
  const source = value === undefined ? defaultE2EImagesPoolSlotProfiles() : value;
  if (!Array.isArray(source)) {
    throw new Error("E2E Images pool profiles must be an array.");
  }
  const profiles: E2EImagesPoolSlotProfile[] = [];
  const seenIds = new Set<string>();

  // Preserve enough over-limit legacy metadata to verify that the fixture never
  // truncates it, while still bounding an untrusted E2E command payload.
  for (const [index, valueAtIndex] of source.slice(0, 30).entries()) {
    const record = asE2ERecord(valueAtIndex);
    if (!record) throw new Error("E2E Images pool profiles must contain objects.");
    assertE2EImagesPoolFields(record, E2E_IMAGES_POOL_PROFILE_FIELDS);
    const id = e2eText(record?.id, `e2e-slot-profile-${index + 1}`);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    profiles.push({
      id,
      name: e2eText(record?.name, id),
      apiMode: e2eText(record?.apiMode, "images").toLowerCase(),
      officialImages: record?.officialImages === true,
      fhlImagesPoolSlot: normalizeE2EImagesPoolSlot(record?.fhlImagesPoolSlot),
      keyHint: normalizeE2EImagesPoolKeyHint(record?.keyHint),
      createdAt: e2eNonNegativeInteger(record?.createdAt, index + 1),
      running: record?.running === true,
    });
  }

  return profiles;
}

function normalizeE2EImagesPoolSlotEdits(value: unknown): E2EImagesPoolSlotEdit[] {
  const source = value === undefined ? defaultE2EImagesPoolSlotEdits() : value;
  if (!Array.isArray(source)) {
    throw new Error("E2E Images pool edits must be an array.");
  }
  const bySlot = new Map<number, E2EImagesPoolSlotEdit>();

  for (const valueAtIndex of source.slice(0, E2E_IMAGES_POOL_SLOT_COUNT)) {
    const record = asE2ERecord(valueAtIndex);
    if (!record) throw new Error("E2E Images pool edits must contain objects.");
    assertE2EImagesPoolFields(record, E2E_IMAGES_POOL_EDIT_FIELDS);
    const slot = normalizeE2EImagesPoolSlot(record?.slot);
    if (slot === undefined) continue;
    bySlot.set(slot, {
      slot,
      newValuePresent: record?.newValuePresent === true,
      keyHint: normalizeE2EImagesPoolKeyHint(record?.keyHint),
    });
  }

  return [...bySlot.values()].sort((a, b) => a.slot - b.slot);
}

function isE2EOfficialImagesPoolProfile(profile: E2EImagesPoolSlotProfile): boolean {
  return profile.apiMode === "images" && profile.officialImages === true;
}

function compareE2EImagesPoolProfiles(a: E2EImagesPoolSlotProfile, b: E2EImagesPoolSlotProfile): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function mapE2EImagesPoolSlotProfiles(
  profiles: readonly E2EImagesPoolSlotProfile[],
): Array<E2EImagesPoolSlotProfile | null> {
  const slots: Array<E2EImagesPoolSlotProfile | null> = Array.from(
    { length: E2E_IMAGES_POOL_SLOT_COUNT },
    () => null,
  );
  const unassigned: E2EImagesPoolSlotProfile[] = [];
  const eligible = profiles
    .filter(isE2EOfficialImagesPoolProfile)
    .sort(compareE2EImagesPoolProfiles);

  for (const profile of eligible) {
    const slot = profile.fhlImagesPoolSlot;
    if (slot !== undefined && slots[slot - 1] === null) {
      slots[slot - 1] = profile;
    } else {
      unassigned.push(profile);
    }
  }

  for (const profile of unassigned) {
    const emptyIndex = slots.findIndex((slot) => slot === null);
    if (emptyIndex < 0) break;
    slots[emptyIndex] = profile;
  }

  return slots;
}

function makeE2EImagesPoolSlotRows(
  slots: readonly (E2EImagesPoolSlotProfile | null)[],
  editsBySlot: ReadonlyMap<number, E2EImagesPoolSlotEdit>,
  createdProfileIds: ReadonlySet<string>,
): E2EImagesPoolSlotRow[] {
  return slots.map((profile, index) => ({
    slot: index + 1,
    profileId: profile?.id,
    profileName: profile?.name,
    origin: profile ? (createdProfileIds.has(profile.id) ? "created" : "saved") : "empty",
    newValuePresent: editsBySlot.get(index + 1)?.newValuePresent === true,
    keyHint: profile?.keyHint,
  }));
}

function nextE2EImagesPoolSlotProfileId(profiles: readonly E2EImagesPoolSlotProfile[], slot: number): string {
  const base = `e2e-created-slot-${slot}`;
  const existingIds = new Set(profiles.map((profile) => profile.id));
  if (!existingIds.has(base)) return base;
  let suffix = 2;
  while (existingIds.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

/**
 * Deterministic, memory-only coverage for the ten-slot Images setup. The
 * fixture accepts only non-sensitive profile metadata and opaque booleans;
 * it never receives, stores, or returns credential text.
 */
export function runE2EImagesPoolSlotSimulation(options: unknown = undefined): E2EImagesPoolSlotSimulationResult {
  const input = asE2ERecord(options);
  const profiles = normalizeE2EImagesPoolSlotProfiles(input?.profiles);
  const edits = input
    ? normalizeE2EImagesPoolSlotEdits(hasE2EOwnProperty(input, "slotEdits") ? input.slotEdits : [])
    : normalizeE2EImagesPoolSlotEdits(undefined);
  const deleteSlot = input
    ? (hasE2EOwnProperty(input, "deleteSlot") ? normalizeE2EImagesPoolSlot(input.deleteSlot) : undefined)
    : 2;
  const editsBySlot = new Map(edits.map((edit) => [edit.slot, edit]));
  const initialProfileCount = profiles.length;
  const initialImagesPoolProfileCount = profiles.filter(isE2EOfficialImagesPoolProfile).length;
  const initialSlots = mapE2EImagesPoolSlotProfiles(profiles);
  const initialRows = makeE2EImagesPoolSlotRows(initialSlots, editsBySlot, new Set());
  const workingProfiles = profiles.map((profile) => ({ ...profile }));
  const createdProfileIds: string[] = [];
  const updatedProfileIds: string[] = [];
  const blockedCreateSlots: number[] = [];

  for (const edit of edits) {
    const existing = initialSlots[edit.slot - 1];
    if (existing) {
      if (edit.newValuePresent) {
        updatedProfileIds.push(existing.id);
        const target = workingProfiles.find((profile) => profile.id === existing.id);
        if (target) {
          target.fhlImagesPoolSlot = edit.slot;
          target.keyHint = edit.keyHint ?? target.keyHint;
        }
      }
      continue;
    }
    if (!edit.newValuePresent) continue;
    const activeImagesPoolProfileCount = workingProfiles.filter(isE2EOfficialImagesPoolProfile).length;
    if (activeImagesPoolProfileCount >= E2E_IMAGES_POOL_PROFILE_CAP) {
      blockedCreateSlots.push(edit.slot);
      continue;
    }
    const id = nextE2EImagesPoolSlotProfileId(workingProfiles, edit.slot);
    workingProfiles.push({
      id,
      name: `Images slot ${edit.slot}`,
      apiMode: "images",
      officialImages: true,
      fhlImagesPoolSlot: edit.slot,
      keyHint: edit.keyHint,
      createdAt: 10_000 + edit.slot,
      running: false,
    });
    createdProfileIds.push(id);
  }

  const slotsAfterSave = mapE2EImagesPoolSlotProfiles(workingProfiles);
  let finalProfiles = workingProfiles;
  let deleteResult: E2EImagesPoolSlotDeleteResult = { status: "not_requested" };
  if (deleteSlot !== undefined) {
    const target = slotsAfterSave[deleteSlot - 1];
    if (!target) {
      deleteResult = { slot: deleteSlot, status: "empty" };
    } else if (target.running) {
      deleteResult = { slot: deleteSlot, profileId: target.id, status: "blocked_running" };
    } else {
      finalProfiles = workingProfiles.filter((profile) => profile.id !== target.id);
      deleteResult = { slot: deleteSlot, profileId: target.id, status: "deleted" };
    }
  }

  const finalSlots = mapE2EImagesPoolSlotProfiles(finalProfiles);
  const createdIdSet = new Set(createdProfileIds);
  const rows = makeE2EImagesPoolSlotRows(finalSlots, editsBySlot, createdIdSet);
  const persistedSlotAssignments: Record<string, number> = {};
  for (const [index, profile] of finalSlots.entries()) {
    if (profile) persistedSlotAssignments[profile.id] = index + 1;
  }

  const legacyProfileIds = profiles
    .filter((profile) => isE2EOfficialImagesPoolProfile(profile) && profile.fhlImagesPoolSlot === undefined)
    .sort(compareE2EImagesPoolProfiles)
    .map((profile) => profile.id);
  const legacyIdSet = new Set(legacyProfileIds);
  const mappedLegacyIds = initialSlots
    .filter((profile): profile is E2EImagesPoolSlotProfile => !!profile && legacyIdSet.has(profile.id))
    .map((profile) => profile.id);
  const checks = {
    tenRows: initialRows.length === E2E_IMAGES_POOL_SLOT_COUNT && rows.length === E2E_IMAGES_POOL_SLOT_COUNT,
    blankNewSlotsDoNotCreate: initialSlots.every((profile, index) => (
      !!profile
      || editsBySlot.get(index + 1)?.newValuePresent === true
      || finalSlots[index] === null
    )),
    savedBlankKeepsProfile: initialSlots.every((profile, index) => {
      if (!profile || editsBySlot.get(index + 1)?.newValuePresent === true) return true;
      if (deleteResult.status === "deleted" && deleteResult.profileId === profile.id) return true;
      return finalProfiles.some((candidate) => candidate.id === profile.id);
    }),
    legacyMapping: mappedLegacyIds.every((profileId, index) => profileId === legacyProfileIds[index]),
    capRespected: initialImagesPoolProfileCount > E2E_IMAGES_POOL_PROFILE_CAP
      ? finalProfiles.filter(isE2EOfficialImagesPoolProfile).length === initialImagesPoolProfileCount
      : finalProfiles.filter(isE2EOfficialImagesPoolProfile).length <= E2E_IMAGES_POOL_PROFILE_CAP,
    deleteGuard: deleteResult.status !== "blocked_running"
      || finalProfiles.some((profile) => profile.id === deleteResult.profileId),
  };

  return {
    memoryOnly: true,
    initialProfileCount,
    initialImagesPoolProfileCount,
    profiles: finalProfiles.map((profile) => ({ ...profile })),
    initialRows,
    rows,
    createdProfileIds,
    updatedProfileIds,
    blockedCreateSlots,
    persistedSlotAssignments,
    delete: deleteResult,
    checks,
    passed: Object.values(checks).every(Boolean),
  };
}

function summarizeSource(source: SourceImage): SourceSummary {
  return {
    path: source.path,
    name: source.name,
    previewUrl: source.previewUrl,
    width: source.width,
    height: source.height,
    panoramaRoundtrip: !!source.panoramaRoundtrip,
  };
}

function summarizeImage(item: HistoryItem | null): ImageSummary | null {
  if (!item) return null;
  return {
    id: item.id,
    mode: item.mode,
    prompt: item.prompt,
    size: item.size,
    savedPath: item.savedPath,
    imageId: item.imageId,
    previewUrl: item.previewUrl,
    fullUrl: item.fullUrl,
    width: item.width,
    height: item.height,
    sourceImages: item.sourceImages?.map(summarizeSource),
    panoramaRoundtrip: !!item.panoramaRoundtrip,
  };
}

function getStateSummary(): StateSummary {
  const state = useStudioStore.getState();
  return {
    version: packageVersion,
    mode: state.mode,
    editSourceMode: state.editSourceMode,
    size: state.size,
    quality: state.quality,
    outputFormat: state.outputFormat,
    apiMode: state.apiMode,
    requestPolicy: state.requestPolicy,
    activeProfileId: state.activeProfileId,
    activeWorkspaceId: state.activeWorkspaceId,
    resultGridOpen: state.resultGridOpen,
    historyGalleryOpen: state.historyGalleryOpen,
    settingsOpen: state.settingsOpen,
    upstreamModalOpen: state.upstreamModalOpen,
    resultDetailOpen: !!state.resultDetail,
    resultDetail: summarizeImage(state.resultDetail),
    panoramaViewerOpen: !!state.panoramaViewerItem,
    panoramaAlignOpen: !!state.panoramaAlignTarget,
    continuousGenerateTest: state.continuousGenerateTest === true,
    batchProcess: {
      inputDir: state.batchProcess.inputDir,
      discoveredCount: state.batchProcess.discoveredSources.length,
      selectedCount: state.batchProcess.discoveredSources.filter((source) => source.selected !== false).length,
      outputMode: state.batchProcess.outputMode,
      outputDir: state.batchProcess.outputDir,
    },
    runningJobs: [...state.runningJobs],
    jobsTotal: state.jobsTotal,
    jobsCompleted: state.jobsCompleted,
    jobsFailed: state.jobsFailed,
    errorMessage: state.errorMessage,
    currentImage: summarizeImage(state.currentImage),
    sourcePreviewReturnImage: summarizeImage(state.sourcePreviewReturnImage),
    batchResults: state.batchResults.map((item) => summarizeImage(item)).filter(Boolean) as ImageSummary[],
    sources: state.sources.map(summarizeSource),
    historyCount: state.history.length,
    toasts: state.toasts.slice(-5).map((toast) => ({ text: toast.text, kind: toast.kind })),
  };
}

async function openSourcePreviewFromPathForE2E(path: string, staleMediaUrl = false): Promise<StateSummary> {
  const cleanPath = String(path || "").trim();
  if (!cleanPath) throw new Error("Image path is required");
  const baseName = cleanPath.split(/[\\/]/).pop() || "source.png";
  const imported = await ImportImagePath(cleanPath).catch(() => null);
  const readablePath = imported?.path || cleanPath;
  const ref = await RegisterImportedImageAsset(readablePath).catch(() => null);
  const fallbackB64 = staleMediaUrl ? "" : await ReadImageAsBase64(ref?.savedPath || readablePath).catch(() => "");
  const item: HistoryItem = {
    id: `source-preview-e2e-${Date.now().toString(36)}`,
    imageId: staleMediaUrl ? undefined : ref?.imageId,
    previewUrl: ref?.previewUrl,
    fullUrl: staleMediaUrl ? `/media/full/e2e-stale-${Date.now().toString(36)}` : ref?.fullUrl,
    imageB64: fallbackB64 || undefined,
    imageBlob: null,
    previewBlob: null,
    previewOnly: false,
    prompt: `(E2E source) ${baseName}`,
    mode: "edit",
    size: useStudioStore.getState().size,
    quality: useStudioStore.getState().quality,
    outputFormat: useStudioStore.getState().outputFormat,
    createdAt: Date.now(),
    savedPath: ref?.savedPath || imported?.path || cleanPath,
    width: ref?.width || imported?.width,
    height: ref?.height || imported?.height,
  };
  useStudioStore.getState().openSourcePreview(item);
  return getStateSummary();
}

async function openManagedResultDetailFromPathForE2E(path: string, staleMediaUrl = false): Promise<StateSummary> {
  const cleanPath = String(path || "").trim();
  if (!cleanPath) throw new Error("Managed result image path is required");

  const ref = await RegisterImportedImageAsset(cleanPath);
  if (!ref.savedPath || !ref.previewUrl) {
    throw new Error("E2E result fixture requires a Wails-managed image path");
  }

  const now = Date.now();
  const id = `result-detail-e2e-${now.toString(36)}`;
  const item: HistoryItem = {
    id,
    imageId: ref.imageId,
    previewUrl: ref.previewUrl,
    fullUrl: ref.fullUrl,
    imageBlob: null,
    previewBlob: null,
    previewOnly: false,
    prompt: `(E2E managed result) ${cleanPath.split(/[\\/]/).pop() || "result.png"}`,
    mode: "generate",
    apiMode: useStudioStore.getState().apiMode,
    apiProfileId: useStudioStore.getState().activeProfileId,
    size: useStudioStore.getState().size,
    quality: useStudioStore.getState().quality,
    outputFormat: useStudioStore.getState().outputFormat,
    createdAt: now,
    savedPath: ref.savedPath,
    thumbPath: ref.thumbPath,
    width: ref.width,
    height: ref.height,
    previewWidth: ref.previewWidth,
    previewHeight: ref.previewHeight,
  };

  await useStudioStore.getState().openResultDetail(item);
  if (staleMediaUrl) {
    const stalePreviewUrl = `/media/preview/e2e-stale-result-${now.toString(36)}`;
    useStudioStore.setState((state) => (
      state.resultDetail?.id === id
        ? {
            resultDetail: {
              ...state.resultDetail,
              previewUrl: stalePreviewUrl,
              imageBlob: null,
              previewBlob: null,
              imageB64: undefined,
              previewOnly: true,
            },
          }
        : {}
    ));
  }
  return getStateSummary();
}

async function openBatchPreviewGridFromDirForE2E(directory: string, limit = 10): Promise<StateSummary> {
  const cleanDir = String(directory || "").trim();
  if (!cleanDir) throw new Error("Batch input directory is required");
  const maxCount = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));
  const result = await ListBatchInputImages(cleanDir);
  const selected = (result.images ?? []).slice(0, maxCount);
  if (!selected.length) throw new Error("No batch input directory or files are available for batch edit");

  useStudioStore.setState((state) => {
    const workspaceId = state.activeWorkspaceId;
    const now = Date.now();
    const discoveredSources = selected.map((item) => ({
      path: item.path,
      name: item.name,
      size: item.size,
      width: item.width,
      height: item.height,
      previewUrl: item.previewUrl,
      previewWidth: item.previewWidth,
      previewHeight: item.previewHeight,
      selected: true,
    }));
    const taskRecords: BatchTaskRecord[] = selected.map((item, index) => {
      const sourceImage: SourceImage = {
        path: item.path,
        name: item.name,
        size: item.size,
        previewUrl: item.previewUrl,
        width: item.width,
        height: item.height,
      };
      return {
        id: `e2e-batch-preview-${now.toString(36)}-${index}`,
        workspaceId,
        slotIndex: index,
        status: "queued",
        createdAt: now + index,
        updatedAt: now + index,
        mode: "edit",
        apiMode: state.apiMode,
        apiProfileId: state.activeProfileId,
        prompt: state.prompt || "(E2E batch preview)",
        size: state.size,
        quality: state.quality,
        outputFormat: state.outputFormat,
        requestPolicy: state.requestPolicy,
        imagesNewAPICompat: state.imagesNewAPICompat,
        textModelID: state.textModelID,
        imageModelID: state.imageModelID,
        sourceImagePaths: [item.path],
        sourceImages: [sourceImage],
        batchSourcePath: item.path,
        batchSourceSlotIndex: index,
        autoAspectResolution: state.batchProcess.autoAspectResolution || undefined,
        queuedReason: "local_concurrency",
        batchOutputMode: state.batchProcess.outputMode,
        batchOutputDir: state.batchProcess.outputDir,
        batchOutputPrefix: "processed-",
      };
    });
    const taskIds = taskRecords.map((task) => task.id);
    const batchTasksById = { ...state.batchTasksById };
    for (const task of taskRecords) batchTasksById[task.id] = task;
    return {
      mode: "edit",
      editSourceMode: "batch",
      resultGridOpen: true,
      jobsTotal: taskRecords.length,
      jobsCompleted: 0,
      jobsFailed: 0,
      runningJobs: [],
      streamPreviews: {},
      batchResults: [],
      selectedBatchTaskId: taskIds[0] || null,
      batchTasksById,
      workspaces: state.workspaces.map((workspace) => (
        workspace.id === workspaceId
          ? {
              ...workspace,
              batchTaskIds: taskIds,
              batchResultIds: [],
              batchProcess: {
                ...workspace.batchProcess,
                inputDir: result.directory || cleanDir,
                discoveredSources,
              },
            }
          : workspace
      )),
      batchProcess: {
        ...state.batchProcess,
        inputDir: result.directory || cleanDir,
        discoveredSources,
      },
      errorMessage: null,
      errorRawPath: null,
    };
  });
  return getStateSummary();
}

function openSyntheticBatchPreviewGridForE2E(count = 397): StateSummary {
  const itemCount = Math.max(1, Math.min(500, Math.floor(Number(count) || 397)));
  useStudioStore.setState((state) => {
    const workspaceId = state.activeWorkspaceId;
    const now = Date.now();
    const discoveredSources = Array.from({ length: itemCount }, (_, index) => {
      const ordinal = String(index + 1).padStart(3, "0");
      return {
        path: `e2e://synthetic/source-${ordinal}.png`,
        name: `source-${ordinal}.png`,
        size: 68,
        width: 1,
        height: 1,
        previewUrl: e2eThumbnailDataURL,
        previewWidth: 1,
        previewHeight: 1,
        selected: true,
      };
    });
    const taskRecords: BatchTaskRecord[] = discoveredSources.map((item, index) => {
      const sourceImage: SourceImage = {
        path: item.path,
        name: item.name,
        size: item.size,
        previewUrl: item.previewUrl,
        width: item.width,
        height: item.height,
      };
      return {
        id: `e2e-synthetic-batch-${now.toString(36)}-${index}`,
        workspaceId,
        slotIndex: index,
        status: "queued",
        createdAt: now + index,
        updatedAt: now + index,
        mode: "edit",
        apiMode: state.apiMode,
        apiProfileId: state.activeProfileId,
        prompt: state.prompt || "(E2E synthetic batch preview)",
        size: state.size,
        quality: state.quality,
        outputFormat: state.outputFormat,
        requestPolicy: state.requestPolicy,
        imagesNewAPICompat: state.imagesNewAPICompat,
        textModelID: state.textModelID,
        imageModelID: state.imageModelID,
        sourceImagePaths: [item.path],
        sourceImages: [sourceImage],
        batchSourcePath: item.path,
        batchSourceSlotIndex: index,
        queuedReason: "local_concurrency",
        batchOutputMode: state.batchProcess.outputMode,
        batchOutputDir: state.batchProcess.outputDir,
        batchOutputPrefix: "processed-",
      };
    });
    const taskIds = taskRecords.map((task) => task.id);
    const batchTasksById = { ...state.batchTasksById };
    for (const task of taskRecords) batchTasksById[task.id] = task;
    return {
      mode: "edit",
      editSourceMode: "batch",
      resultGridOpen: true,
      jobsTotal: itemCount,
      jobsCompleted: 0,
      jobsFailed: 0,
      runningJobs: [],
      streamPreviews: {},
      batchResults: [],
      selectedBatchTaskId: taskIds[0] || null,
      batchTasksById,
      workspaces: state.workspaces.map((workspace) => (
        workspace.id === workspaceId
          ? {
              ...workspace,
              batchTaskIds: taskIds,
              batchResultIds: [],
              batchProcess: {
                ...workspace.batchProcess,
                inputDir: "e2e://synthetic-batch",
                discoveredSources,
              },
            }
          : workspace
      )),
      batchProcess: {
        ...state.batchProcess,
        inputDir: "e2e://synthetic-batch",
        discoveredSources,
      },
      errorMessage: null,
      errorRawPath: null,
    };
  });
  return getStateSummary();
}

function localFlagEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("e2e") === "1" || url.searchParams.has("codex-e2e")) return true;
    return localStorage.getItem("gptcodex.e2e") === "1";
  } catch {
    return false;
  }
}

function installHarness(status: AutomationStatusLike) {
  const harness: ImageStudioE2EHarness = {
    version: packageVersion,
    status,
    getStateSummary,
    waitForIdle: (timeoutMs = 30_000) => new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const summary = getStateSummary();
        if (summary.runningJobs.length === 0) {
          resolve(summary);
          return;
        }
        if (Date.now() - started > timeoutMs) {
          reject(new Error("Timed out waiting for Image Studio to become idle"));
          return;
        }
        window.setTimeout(tick, 200);
      };
      tick();
    }),
    setPrompt: (value: string) => {
      useStudioStore.getState().setField("prompt", String(value));
    },
    setSize: (value: string) => {
      useStudioStore.getState().setField("size", String(value) as any);
    },
    openSettings: () => useStudioStore.getState().openSettings(),
    closeSettings: () => useStudioStore.getState().closeSettings(),
    openResultGrid: () => useStudioStore.getState().openResultGrid(),
    closeResultGrid: () => useStudioStore.getState().closeResultGrid(),
    loadBatchInputDir: async (directory: string) => {
      const result = await ListBatchInputImages(directory);
      useStudioStore.setState((state) => ({
        mode: "edit",
        editSourceMode: "batch",
        batchProcess: {
          ...state.batchProcess,
          inputDir: result.directory || directory,
          discoveredSources: (result.images ?? []).map((item) => ({
            path: item.path,
            name: item.name,
            size: item.size,
            width: item.width,
            height: item.height,
            previewUrl: item.previewUrl,
            previewWidth: item.previewWidth,
            previewHeight: item.previewHeight,
            selected: true,
          })),
        },
        errorMessage: null,
        errorRawPath: null,
      }));
      return getStateSummary();
    },
    openBatchPreviewGridFromDir: openBatchPreviewGridFromDirForE2E,
    openSourcePreviewFromPath: openSourcePreviewFromPathForE2E,
    ...(status.e2eOnly === true
      ? { openManagedResultDetailFromPath: openManagedResultDetailFromPathForE2E }
      : {}),
    runPortablePathSmoke: async (pathOrDirectory: string, limit = 10) => {
      const target = String(pathOrDirectory || "").trim();
      if (!target) throw new Error("Smoke target path is required");
      const maxCount = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));
      const batch = await ListBatchInputImages(target).catch(() => null);
      let firstPath = target;
      let batchLoaded = false;
      let selectedCount = 0;
      if (batch?.images?.length) {
        const selected = batch.images.slice(0, maxCount);
        selectedCount = selected.length;
        firstPath = selected[0]?.path || target;
        batchLoaded = true;
        useStudioStore.setState((state) => ({
          mode: "edit",
          editSourceMode: "batch",
          batchProcess: {
            ...state.batchProcess,
            inputDir: batch.directory || target,
            discoveredSources: selected.map((item) => ({
              path: item.path,
              name: item.name,
              size: item.size,
              width: item.width,
              height: item.height,
              previewUrl: item.previewUrl,
              previewWidth: item.previewWidth,
              previewHeight: item.previewHeight,
              selected: true,
            })),
          },
          errorMessage: null,
          errorRawPath: null,
        }));
      }
      const normal = await openSourcePreviewFromPathForE2E(firstPath, false);
      const stale = await openSourcePreviewFromPathForE2E(firstPath, true);
      return { target, batchLoaded, selectedCount, firstPath, normal, stale };
    },
    ...(status.e2eOnly === true
      ? {
          openSyntheticBatchPreviewGrid: openSyntheticBatchPreviewGridForE2E,
          runContinuousPoolSimulation: (options?: unknown) => runE2EContinuousPoolSimulation(options),
          runImagesPoolSlotSimulation: (options?: unknown) => runE2EImagesPoolSlotSimulation(options),
        }
      : {}),
  };
  activeHarness = harness;
  (window as E2EWindow).__imageStudioE2E = harness;
  installCommandBridge();
  mountE2EBatchControls(harness);
  publishDOMReadyStatus(status);
  document.documentElement.dataset.e2e = "true";
  document.documentElement.dataset.e2eHarness = "ready";
  document.documentElement.dataset.e2eServer = status.serverUrl || "";
}

function mountE2EBatchControls(harness: ImageStudioE2EHarness) {
  if (typeof document === "undefined") return;
  if (document.getElementById(e2eBatchControlId)) return;
  const root = document.createElement("div");
  root.id = e2eBatchControlId;
  root.setAttribute("data-testid", "image-studio-e2e-batch-control");
  Object.assign(root.style, {
    position: "fixed",
    left: "12px",
    bottom: "12px",
    zIndex: "2147483647",
    display: "flex",
    gap: "6px",
    alignItems: "center",
    maxWidth: "min(760px, calc(100vw - 24px))",
    padding: "8px",
    border: "1px solid rgba(14, 165, 233, 0.45)",
    borderRadius: "8px",
    background: "rgba(255,255,255,0.96)",
    color: "#0f172a",
    boxShadow: "0 10px 30px rgba(15,23,42,0.18)",
    font: "12px system-ui, sans-serif",
  });

  const input = document.createElement("input");
  input.setAttribute("aria-label", "E2E batch input directory");
  input.placeholder = "Batch input directory";
  Object.assign(input.style, {
    width: "min(520px, 56vw)",
    height: "28px",
    border: "1px solid rgba(15,23,42,0.18)",
    borderRadius: "6px",
    padding: "0 8px",
    font: "12px system-ui, sans-serif",
  });

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Load batch dir";
  button.setAttribute("data-testid", "image-studio-e2e-load-batch-dir");
  Object.assign(button.style, {
    height: "28px",
    border: "1px solid rgba(14,165,233,0.55)",
    borderRadius: "6px",
    background: "#e0f2fe",
    color: "#0369a1",
    padding: "0 10px",
    font: "600 12px system-ui, sans-serif",
    cursor: "pointer",
  });

  const openPreviewButton = document.createElement("button");
  openPreviewButton.type = "button";
  openPreviewButton.textContent = "Open image";
  openPreviewButton.setAttribute("data-testid", "image-studio-e2e-open-source-preview");
  Object.assign(openPreviewButton.style, {
    height: "28px",
    border: "1px solid rgba(34,197,94,0.55)",
    borderRadius: "6px",
    background: "#dcfce7",
    color: "#166534",
    padding: "0 10px",
    font: "600 12px system-ui, sans-serif",
    cursor: "pointer",
  });

  const stalePreviewButton = document.createElement("button");
  stalePreviewButton.type = "button";
  stalePreviewButton.textContent = "Open stale image";
  stalePreviewButton.setAttribute("data-testid", "image-studio-e2e-open-stale-source-preview");
  Object.assign(stalePreviewButton.style, {
    height: "28px",
    border: "1px solid rgba(245,158,11,0.6)",
    borderRadius: "6px",
    background: "#fef3c7",
    color: "#92400e",
    padding: "0 10px",
    font: "600 12px system-ui, sans-serif",
    cursor: "pointer",
  });

  const smokeButton = document.createElement("button");
  smokeButton.type = "button";
  smokeButton.textContent = "Smoke 10";
  smokeButton.setAttribute("data-testid", "image-studio-e2e-portable-smoke");
  Object.assign(smokeButton.style, {
    height: "28px",
    border: "1px solid rgba(99,102,241,0.55)",
    borderRadius: "6px",
    background: "#e0e7ff",
    color: "#3730a3",
    padding: "0 10px",
    font: "600 12px system-ui, sans-serif",
    cursor: "pointer",
  });

  const previewGridButton = document.createElement("button");
  previewGridButton.type = "button";
  previewGridButton.textContent = "Preview grid";
  previewGridButton.setAttribute("data-testid", "image-studio-e2e-preview-grid");
  Object.assign(previewGridButton.style, {
    height: "28px",
    border: "1px solid rgba(168,85,247,0.55)",
    borderRadius: "6px",
    background: "#f3e8ff",
    color: "#6b21a8",
    padding: "0 10px",
    font: "600 12px system-ui, sans-serif",
    cursor: "pointer",
  });

  const syntheticGridButton = document.createElement("button");
  syntheticGridButton.type = "button";
  syntheticGridButton.textContent = "Grid 397";
  syntheticGridButton.setAttribute("data-testid", "image-studio-e2e-synthetic-grid");
  syntheticGridButton.disabled = !harness.openSyntheticBatchPreviewGrid;
  Object.assign(syntheticGridButton.style, {
    height: "28px",
    border: "1px solid rgba(14,116,144,0.55)",
    borderRadius: "6px",
    background: "#cffafe",
    color: "#155e75",
    padding: "0 10px",
    font: "600 12px system-ui, sans-serif",
    cursor: syntheticGridButton.disabled ? "not-allowed" : "pointer",
  });

  const status = document.createElement("span");
  status.setAttribute("data-testid", "image-studio-e2e-batch-status");
  status.textContent = "idle";
  Object.assign(status.style, {
    minWidth: "72px",
    color: "#475569",
    whiteSpace: "nowrap",
  });

  button.addEventListener("click", async () => {
    root.dataset.status = "loading";
    root.dataset.error = "";
    status.textContent = "loading";
    try {
      const summary = await harness.loadBatchInputDir(input.value);
      root.dataset.status = "ok";
      root.dataset.inputDir = summary.batchProcess.inputDir;
      root.dataset.discovered = String(summary.batchProcess.discoveredCount);
      root.dataset.selected = String(summary.batchProcess.selectedCount);
      status.textContent = `${summary.batchProcess.selectedCount}/${summary.batchProcess.discoveredCount}`;
    } catch (error) {
      root.dataset.status = "error";
      root.dataset.error = error instanceof Error ? error.message : String(error);
      status.textContent = "error";
    }
  });

  const openPreview = async (staleMediaUrl: boolean) => {
    root.dataset.status = staleMediaUrl ? "opening-stale-image" : "opening-image";
    root.dataset.error = "";
    status.textContent = staleMediaUrl ? "stale image" : "image";
    try {
      const summary = await harness.openSourcePreviewFromPath(input.value, staleMediaUrl);
      root.dataset.status = "ok";
      root.dataset.currentImageId = summary.currentImage?.id || "";
      root.dataset.currentImagePath = summary.currentImage?.savedPath || "";
      status.textContent = summary.currentImage?.width && summary.currentImage?.height
        ? `${summary.currentImage.width}x${summary.currentImage.height}`
        : "opened";
    } catch (error) {
      root.dataset.status = "error";
      root.dataset.error = error instanceof Error ? error.message : String(error);
      status.textContent = "error";
    }
  };

  openPreviewButton.addEventListener("click", () => {
    void openPreview(false);
  });
  stalePreviewButton.addEventListener("click", () => {
    void openPreview(true);
  });

  smokeButton.addEventListener("click", async () => {
    root.dataset.status = "smoke";
    root.dataset.error = "";
    status.textContent = "smoke";
    try {
      const result = await harness.runPortablePathSmoke(input.value, 10);
      root.dataset.status = "ok";
      root.dataset.smokeBatchLoaded = String(result.batchLoaded);
      root.dataset.smokeSelected = String(result.selectedCount);
      root.dataset.smokeFirstPath = result.firstPath;
      root.dataset.currentImagePath = result.stale.currentImage?.savedPath || result.normal.currentImage?.savedPath || "";
      status.textContent = `smoke ${result.selectedCount}`;
    } catch (error) {
      root.dataset.status = "error";
      root.dataset.error = error instanceof Error ? error.message : String(error);
      status.textContent = "error";
    }
  });

  previewGridButton.addEventListener("click", async () => {
    root.dataset.status = "preview-grid";
    root.dataset.error = "";
    status.textContent = "grid";
    try {
      const summary = await harness.openBatchPreviewGridFromDir(input.value, 10);
      root.dataset.status = "ok";
      root.dataset.gridSelected = String(summary.batchProcess.selectedCount);
      root.dataset.gridTaskCount = String(summary.runningJobs.length || summary.batchProcess.selectedCount);
      status.textContent = `grid ${summary.batchProcess.selectedCount}`;
    } catch (error) {
      root.dataset.status = "error";
      root.dataset.error = error instanceof Error ? error.message : String(error);
      status.textContent = "error";
    }
  });

  syntheticGridButton.addEventListener("click", () => {
    root.dataset.status = "synthetic-grid";
    root.dataset.error = "";
    try {
      const summary = harness.openSyntheticBatchPreviewGrid?.(397);
      if (!summary) throw new Error("Synthetic batch preview is unavailable");
      root.dataset.status = "ok";
      root.dataset.gridSelected = String(summary.batchProcess.selectedCount);
      root.dataset.gridTaskCount = String(summary.jobsTotal);
      status.textContent = `grid ${summary.jobsTotal}`;
    } catch (error) {
      root.dataset.status = "error";
      root.dataset.error = error instanceof Error ? error.message : String(error);
      status.textContent = "error";
    }
  });

  root.append(input, button, openPreviewButton, stalePreviewButton, smokeButton, previewGridButton, syntheticGridButton, status);
  document.body.appendChild(root);
}

function publishDOMReadyStatus(status: AutomationStatusLike) {
  if (typeof document === "undefined") return;
  const payload = {
    ready: true,
    version: packageVersion,
    packageVersion: status.packageVersion || packageVersion,
    serverUrl: status.serverUrl || "",
    commandBridge: "postMessage",
  };
  let marker = document.getElementById(e2eStatusMarkerId) as HTMLMetaElement | null;
  if (!marker) {
    marker = document.createElement("meta");
    marker.id = e2eStatusMarkerId;
    marker.name = "image-studio-e2e-status";
    document.head.appendChild(marker);
  }
  marker.content = JSON.stringify(payload);
}

function installCommandBridge() {
  if (commandBridgeInstalled || typeof window === "undefined") return;
  commandBridgeInstalled = true;
  window.addEventListener("message", async (event) => {
    const message = event.data as E2ECommandRequest | undefined;
    if (!message || message.source !== e2eMessageSource || message.direction !== "request") return;
    const id = String(message.id || "");
    const response: E2ECommandResponse = {
      source: e2eMessageSource,
      direction: "response",
      id,
      ok: false,
    };
    try {
      if (!activeHarness) throw new Error("Image Studio E2E harness is not ready");
      const handler = commandHandlers[String(message.command || "")];
      if (!handler) throw new Error(`Unsupported Image Studio E2E command: ${message.command || ""}`);
      response.result = await handler(activeHarness, Array.isArray(message.args) ? message.args : []);
      response.ok = true;
    } catch (error) {
      response.error = error instanceof Error ? error.message : String(error);
    }
    const targetOrigin = window.location.origin && window.location.origin !== "null" ? window.location.origin : "*";
    window.postMessage(response, targetOrigin);
  });
  document.documentElement.dataset.e2eCommandBridge = "ready";
}

export async function installE2EHarness() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const bootstrapStatus = (window as E2EWindow).__IMAGE_STUDIO_E2E_BOOTSTRAP;
  let status = bootstrapStatus ?? { enabled: false };
  if (!status.enabled) {
    status = await GetAutomationStatus().catch(() => ({ enabled: false }));
  }
  if (!status.enabled && !localFlagEnabled()) return;
  installHarness({
    ...status,
    enabled: true,
    packageVersion: status.packageVersion || packageVersion,
  });
}
