import { create } from "zustand";
import {
  BuildBatchOutputPath,
  EventsOn,
  Generate as wailsGenerate,
  Edit as wailsEdit,
  OptimizePrompt as wailsOptimizePrompt,
  ReversePrompt as wailsReversePrompt,
  Cancel as wailsCancel,
  ImportImageFromB64,
  ReadImageAsBase64,
  GetOutputDir,
  DeleteStoredAPIKey,
  GetStoredAPIKey,
  SetStoredAPIKey,
  RegisterImportedImageAsset,
  RegisterMediaAsset,
  ReadTextFile,
  SaveImagePathToDir,
  SyncMaterialGroupToOutput,
  detectHostKind,
  OpenMaterialSyncDir,
  probeCurrentUpstream,
  setKernelRuntimeMode,
} from "../platform/runtime/host";
import { createDesktopJobEventGate } from "../platform/runtime/desktopJobEvents";
import {
  cancelBrowserJobs,
  listBrowserJobGroups,
  submitBrowserJobGroup,
  submitBrowserJobGroups,
  subscribeToBrowserJob,
  subscribeToBrowserWorkspace,
} from "../platform/runtime/browserJobClient";
import type {
  BrowserJobEvent,
  BrowserJobSubmitManyCredential,
  BrowserJobSubmitManyRequest,
  BrowserJobSubmitManyResponse,
} from "../platform/runtime/browserJobContracts.ts";
import { isTransientGenerationFailureText } from "../platform/runtime/remote-kernel/common.ts";
import {
  canUseAndroidJobs,
  listAndroidJobGroups,
  submitAndroidJobGroup,
  subscribeToAndroidJob,
} from "../platform/runtime/androidJobClient";
import type { backend } from "../../wailsjs/go/models";
import {
  APIMode,
  BatchProcessSourceImage,
  BatchProcessAutoAspectResolution,
  BatchTaskRecord,
  type EditSourceMode,
  HistoryItem,
  JobGroupSnapshot,
  KernelRuntimeMode,
  MaterialGroup,
  MaterialGroupKind,
  MaterialRef,
  Mode,
  OutputFormatValue,
  PanoramaPastebackAlignment,
  PanoramaProjectRef,
  Preset,
  ProgressInfo,
  QualityValue,
  RequestPolicy,
  SizeValue,
  SourceImage,
  StreamPreviewMap,
  ThemeMode,
  Toast,
  UpstreamProfile,
  Workspace,
} from "../types/domain";
import {
  clearLegacyAPIKeys,
  loadLegacyModeAPIKey,
  loadLegacySharedAPIKey,
  persistHistoryItem,
  persistHistoryItems,
  loadAllHistory,
  loadHistoryPage,
  loadHistoryItemsByIds,
  loadHistoryItemsBySavedPaths,
} from "../lib/storage";
import { purgeForeignAPIKeyStorageKeys, storageKey } from "../lib/storageNamespace.ts";
import { migrateStableNamespaceData } from "../lib/storageMigration.ts";
import {
  cleanBaseURL,
} from "../lib/security";
import { normalizeAPIKeyInput, validateAPIKeyForHeader } from "../lib/apiKey";
import { loadProxyConfig, normalizeProxyMode, persistProxyConfig } from "../lib/proxy";
import { syncCLIConfigQuietly, type CLIConfigSyncInput } from "../lib/cliConfigSync";
import {
  fetchRunningHubResultImage,
  recoverRunningHubTask,
  runningHubSizeSelection,
  type RunningHubBridgeTask,
} from "../lib/runninghubAPI";
import {
  extractAPIMartTaskIdFromText,
  fetchAPIMartResultImage,
  recoverAPIMartTask,
  type APIMartRecoveredTask,
} from "../lib/apimartAPI";
import {
  apiModeRequiresDirectAPIKey,
  DEFAULT_CONCURRENCY_LIMIT,
  duplicateProfile as cloneProfile,
  FHL_BASE_URL,
  FHL_IMAGE_MODEL_ID,
  FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT,
  FHL_PROFILE_ID,
  FHL_TEXT_MODEL_ID,
  genProfileId,
  hasUpstreamProfileCapacity,
  isOfficialFHLImagesProfile,
  keyringUserFor,
  mapFHLImagesProfilesToPoolSlots,
  makeFHLImagesProfile,
  makeFHLResponsesProfile,
  normalizeFHLPoolPerAPIConcurrencyLimit,
  pickActiveProfile,
  resolveFHLPoolPerAPIConcurrencyLimit,
} from "../lib/profiles";
import { effectiveProviderMode, isOfficialFHLProfile, ProviderPolicy } from "../lib/providerPolicy";
import { resolvePromptTextSelection } from "../lib/promptTextProfiles";
import {
  deleteFHLTextAPIKey,
  fhlTextAPIKeyHint,
  FHL_TEXT_API_KEYRING_USER,
  formatFHLTextAPIError,
  loadFHLTextAPIKey,
  saveFHLTextAPIKey,
  testFHLTextAPIKey,
  validateFHLTextAPIKey,
} from "../lib/fhlTextAPI";
import { loadLocalFHLConfig } from "../lib/localFHLConfig";
import { readRuntimePlatformState, usesWindowsDesktopUI } from "../platform";
import { dispatchFullscreenResize, setNativeFullscreen } from "../platform/nativeFullscreen";
import {
  activeRuntimePatch,
  apiModeLabel,
  defaultBatchProcessConfig,
  normalizeAPIMode,
  normalizeBatchCount,
  normalizeBatchProcessConfig,
  normalizeConcurrencyLimit,
  normalizeEditSourceMode,
  patchWorkspaceRuntime,
  resetWorkspaceSourcesAfterServiceRestart,
  workspaceRuntimeFromState,
  workspaceRunningCount,
  type APIModeValue,
  type RunningJobMeta,
  type WorkspacePatch,
} from "./workspaceRuntime";
import {
  normalizeSizeSelection,
} from "../components/panel/sizeCapabilities";
import { DEFAULT_FHL_SIZE } from "../lib/generationDefaults";
import { buildMacWorkspacePreview, readPreviewScenario } from "../app/dev/previewData";
import {
  buildAutoAspectSizeFromDimensions,
  autoAspectSizeInputFromState,
  normalizedReferenceSlotIndex,
  sourceDimensionsFromMetadata,
  syncSharedEditAutoAspect,
  type SourceDimensions,
} from "./sharedEditAutoAspect";
import { base64ToBlob, getImageDimensions, getImageDimensionsFromBase64 } from "../lib/images";
import {
  applyTheme,
  augmentPromptWithAnnotations,
  buildMaskPNGDataURL,
  clearLegacyModeLocalStorage,
  genId,
  imageDims,
  loadModeConfig,
  loadLegacyFHLPoolSharedConcurrencyLimit,
  loadStoredFHLPoolPerAPIConcurrencyLimit,
  loadStoredFHLTransportMode,
  loadStoredActiveProfileId,
  loadStoredProfiles,
  persistActiveProfileId,
  persistFHLPoolPerAPIConcurrencyLimit,
  persistFHLTransportMode,
  persistProfiles,
  persistWorkspaceSession,
  persistTrimmedHistory,
  loadWorkspaceSession,
  currentWorkspaceServiceInstanceId,
  stripDataURLPrefix,
  tempDataURLFromB64,
  trimHistory,
} from "./studioStore.shared";
import type { ModeConfig, PromptOptimizeRequest, PromptReverseRequest, Stroke, StudioState, UndoEntry } from "./studioStore.types";
import type { MaterialOutputSyncItemLike } from "../platform/runtime/hostTypes";
import {
  historyItemsByIds,
  cryptoIDFallback,
  ensureFullHistoryItem as ensureFullHistoryItemRuntime,
  fileToBase64,
  materializeMediaRefForHistoryItem,
  materializeHistoryItem as materializeHistoryItemRuntime,
  saveActiveWorkspaceSnapshot,
  STYLE_SUFFIXES,
  tryNotify,
  withMediaAssetRef,
} from "./studioStore.runtime";
import { createMediaActions } from "./studioStore.media";
import { activeProfileRuntimePatch, createProfileActions } from "./studioStore.profiles";
import { createWorkspaceActions } from "./studioStore.workspaces";
import { createImageActions } from "./studioStore.images";
import { buildEffectivePrompt } from "./promptComposition";
import {
  continuousSlotIndex,
  continuousRuntimeStateFromJobGroups,
  filterVisibleJobGroupsForWorkspace,
  isJobGroupVisibleForWorkspace,
  mergeWorkspaceJobGroup,
  replaceWorkspaceJobGroups,
  runningJobIdsFromGroup,
  runtimeStateFromJobGroups,
} from "./browserJobs";
import {
  createBatchTaskRecord,
  batchTaskHasResult,
  findTaskForJobSlot,
  findTaskForSlot,
  isRetryableBatchTask,
  localQueuedTasksForWorkspace,
  minimalHistoryItemFromBatchTask,
  markMissingJobTasksInterrupted,
  nextSlotIndexFromTasks,
  runningOrSubmittedTaskCountForWorkspace,
  slotIndexForGroupSlot,
  sortedBatchTasksForCurrentView,
  sortedBatchTasksForWorkspace,
  updateTaskForSlot,
  updateTaskFromHistoryItem,
  updateTasksFromJobGroup,
  upsertBatchTasks,
} from "./batchTaskRecords";
import {
  planContinuousPoolWave,
  selectNextContinuousPoolProfile,
  selectNextFailoverPoolProfile,
} from "./continuousPoolScheduler";
import {
  findPanoramaRoundtripRef,
  buildPanoramaProjectRef,
  buildPanoramaProjectRefFromRoundtrip,
  pastePanoramaRoundtripBase64,
  type PanoramaPastebackMaskInput,
  resolvePanoramaRoundtripRef,
  resolvePanoramaProjectRef,
} from "../panorama/core";
import {
  createMaterialGroupInput,
  loadMaterialGroups,
  materialRefKey,
  mergeSources,
  persistMaterialGroups,
  refsFromSources,
  uniqueMaterialGroupName,
  uniqueMaterialRefs,
} from "./materialLibrary";
import { sourceImagesForHistory, sourceImagesFromPaths } from "./historySourceImages";
import {
  panoramaHistoryIdsForMetadataRecovery,
  panoramaSourcePathsForMetadataRecovery,
  recoverPanoramaHistoryMetadata,
  recoverPanoramaItemMetadata,
  recoverPanoramaItemMetadataFromTask,
  recoverPanoramaSourceMetadata,
} from "./panoramaRoundtripRecovery";
import { sourceContextPatchFromBatchTask } from "./sourceContextSelection";
import {
  currentImageIdForWorkspaceSnapshot,
  removeStreamPreview,
  restoreCurrentImageAfterPreviewError,
  streamPreviewItemFromWorkspace,
  streamPreviewStatePatch,
  type StreamPreviewPayload,
} from "./studioStore.streamPreview";

type RuntimeGenerateOptions = backend.GenerateOptions & {
  sourceImages?: SourceImage[];
};

type BrowserSourceIdentity = {
  batchSourcePath?: string | null;
  size?: SizeValue;
  sourceImages?: SourceImage[];
  panoramaRoundtrip?: HistoryItem["panoramaRoundtrip"];
};

const browserJobSubscriptions = new Map<string, () => void>();
const browserWorkspaceSubscriptions = new Map<string, () => void>();
const browserJobRefreshes = new Map<string, Promise<void>>();
const ENABLE_LEGACY_PROFILE_MIGRATION = false;
const STAR_PROMPTED_KEY = storageKey("gptcodex.starPrompted");
const KERNEL_RUNTIME_MODE_KEY = storageKey("gptcodex.kernelRuntimeMode");
const OUTPUT_FORMAT_KEY = storageKey("gptcodex.outputFormat");
const PROMPT_HISTORY_KEY = storageKey("gptcodex.promptHistory");
const PRESETS_KEY = storageKey("gptcodex.presets");
const CONCURRENCY_DEFAULT_V4_MIGRATION_KEY = storageKey("gptcodex.profileConcurrencyDefaultV4Migrated");
const THEME_KEY = storageKey("gptcodex.theme");
const FONT_SCALE_KEY = storageKey("gptcodex.fontScale");
const INITIAL_HISTORY_LOAD = 48;
const HISTORY_MEDIA_HYDRATE_CONCURRENCY = 4;
const PRESSURE_PROMPT_FRUITS = [
  "mango", "dragon fruit", "citrus", "apple", "pear", "peach", "lychee", "pineapple",
  "watermelon", "kiwi", "pomegranate", "grape", "fig", "plum", "strawberry", "papaya",
];
const PRESSURE_PROMPT_SCENES = [
  "rainy night market stall", "sunlit street vendor portrait", "neon fruit shop window",
  "cinematic old town alley", "editorial fashion market scene", "documentary closeup",
  "lantern-lit tea counter", "busy tropical grocery stand", "misty morning bazaar",
  "high-end product display", "handheld street photo", "soft studio marketplace setup",
];
const PRESSURE_PROMPT_STYLES = [
  "realistic 85mm lens", "cinematic shallow depth of field", "crisp commercial detail",
  "natural skin texture", "warm film color", "blue-orange contrast lighting",
  "premium editorial composition", "soft volumetric light", "high dynamic range realism",
];

function pressurePrompt(index: number) {
  const fruit = PRESSURE_PROMPT_FRUITS[index % PRESSURE_PROMPT_FRUITS.length];
  const scene = PRESSURE_PROMPT_SCENES[Math.floor(index / PRESSURE_PROMPT_FRUITS.length) % PRESSURE_PROMPT_SCENES.length];
  const style = PRESSURE_PROMPT_STYLES[index % PRESSURE_PROMPT_STYLES.length];
  const serial = String(index + 1).padStart(3, "0");
  return `pressure ${serial} 钓鱼的小动物, tiny ${fruit}-colored animal fishing near a ${scene}, vertical 9:16, ${style}, detailed realistic image, clean composition`;
}

async function sourceFromHistoryForMaterial(item: HistoryItem): Promise<SourceImage | null> {
  const full = await materializeHistoryItem(item).catch(() => null);
  if (!full?.savedPath) return null;
  let previewItem = full;
  if (!previewItem.previewUrl && !previewItem.previewBlob && !previewItem.imageB64) {
    const ref = await materializeMediaRefForHistoryItem(full).catch(() => null);
    if (ref) previewItem = withMediaAssetRef(previewItem, ref);
  }
  return {
    path: full.savedPath,
    name: full.savedPath.split(/[\\/]/).pop() ?? "source.png",
    size: 0,
    imageBlob: previewItem.previewUrl ? null : (previewItem.previewBlob ?? previewItem.imageBlob ?? null),
    imageB64: previewItem.previewUrl ? undefined : previewItem.imageB64,
    previewUrl: previewItem.previewUrl,
  };
}

let deferredHistoryLoadPromise: Promise<void> | null = null;
const startingContinuousTaskIds = new Set<string>();
const unavailableContinuousPoolProfileIds = new Set<string>();
let continuousPoolRoundRobinCursor = 0;
let continuousPoolPumpPromise: Promise<void> | null = null;
let continuousPoolPumpRequested = false;
const autoRetryTimersByTaskId = new Map<string, ReturnType<typeof setTimeout>>();
const recordedTransientFailureSignatures = new Set<string>();
const transientFailureWindowsByProfile = new Map<string, number[]>();
const temporaryConcurrencyCapsByProfile = new Map<string, { limit: number; expiresAt: number; timer?: ReturnType<typeof setTimeout> }>();
const temporaryConcurrencyDowngradeCountsByProfile = new Map<string, number>();
const AUTO_RETRY_DELAY_MS = 15_000;
const AUTO_RETRY_MAX_COUNT = 1;
const TRANSIENT_FAILURE_WINDOW_MS = 2 * 60_000;
const TEMPORARY_CONCURRENCY_CAP_MS = 10 * 60_000;

function persistWorkspaceSessionFromState(state: StudioState) {
  const workspaces = saveActiveWorkspaceSnapshot(state).map((workspace) => ({
    ...workspace,
    lastPayload: null,
  }));
  persistWorkspaceSession(state.activeWorkspaceId, workspaces, state.batchTasksById);
}

let pendingWorkspaceSessionState: StudioState | null = null;
let workspaceSessionPersistTimer: ReturnType<typeof setTimeout> | null = null;

function flushWorkspaceSessionPersistence(state?: StudioState) {
  const snapshot = state ?? pendingWorkspaceSessionState;
  if (workspaceSessionPersistTimer) {
    clearTimeout(workspaceSessionPersistTimer);
    workspaceSessionPersistTimer = null;
  }
  pendingWorkspaceSessionState = null;
  if (snapshot) persistWorkspaceSessionFromState(snapshot);
}

function scheduleWorkspaceSessionPersistence(state: StudioState, immediate = false) {
  pendingWorkspaceSessionState = state;
  if (immediate) {
    flushWorkspaceSessionPersistence();
    return;
  }
  if (workspaceSessionPersistTimer) clearTimeout(workspaceSessionPersistTimer);
  workspaceSessionPersistTimer = setTimeout(flushWorkspaceSessionPersistence, 500);
}

function needsHistoryPreviewHydration(item: HistoryItem): boolean {
  return !!item.savedPath
    && !item.savedPath.startsWith("memory://")
    && !item.previewBlob
    && !item.imageB64
    && !item.previewUrl;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  };
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function mergeHistoryMediaRef(current: HistoryItem | null, nextById: Map<string, HistoryItem>): HistoryItem | null {
  if (!current) return current;
  const next = nextById.get(current.id);
  return next ? withMediaAssetRef(current, next) : current;
}

async function hydrateHistoryPreviewRefs(items: HistoryItem[]): Promise<HistoryItem[]> {
  return mapWithConcurrency(items, HISTORY_MEDIA_HYDRATE_CONCURRENCY, async (item) => {
    if (!needsHistoryPreviewHydration(item)) return item;
    try {
      const ref = await materializeMediaRefForHistoryItem(item);
      return withMediaAssetRef(item, ref);
    } catch {
      return item;
    }
  });
}

async function backfillHistoryPreviewRefs(items: HistoryItem[]): Promise<void> {
  const hydrated = await hydrateHistoryPreviewRefs(items);
  const changed = hydrated.filter((item, index) => item !== items[index]);
  if (changed.length === 0) return;
  const changedById = new Map(changed.map((item) => [item.id, item]));
  useStudioStore.setState((state) => ({
    history: state.history.map((item) => changedById.get(item.id) ?? item),
    batchResults: state.batchResults.map((item) => changedById.get(item.id) ?? item),
    currentImage: mergeHistoryMediaRef(state.currentImage, changedById),
    compareB: mergeHistoryMediaRef(state.compareB, changedById),
    resultDetail: mergeHistoryMediaRef(state.resultDetail, changedById),
  }));
  await persistHistoryItems(changed).catch(() => undefined);
}

async function writeBase64ToTempFile(b64: string, _name: string): Promise<string> {
  // Backend doesn't currently expose a "write temp file from b64" binding,
  // but reuseAsSource needs a path for edit mode. Workaround: use SaveImageAs
  // with a fixed name into the user config dir would prompt the user. Instead,
  // we re-purpose the savedPath field that comes back with every result; it's
  // already on disk under UserConfigDir/image-studio/images. So callers should
  // use item.savedPath; this helper exists for parity and is currently unused.
  void b64;
  return "";
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = src;
  });
}

async function loadHistoryItemAsHtmlImage(item: HistoryItem): Promise<HTMLImageElement> {
  const full = await ensureFullHistoryItem(item) ?? item;
  const source = String(full?.imageB64 || "").trim()
    ? tempDataURLFromB64(String(full.imageB64))
    : String(full?.fullUrl || full?.previewUrl || "").trim();
  if (!source && full?.savedPath) {
    const imageB64 = await ReadImageAsBase64(full.savedPath).catch(() => "");
    if (imageB64) return loadHtmlImage(tempDataURLFromB64(imageB64));
  }
  if (!source) throw new Error("No renderable image source available");
  return loadHtmlImage(source);
}

async function loadSavedPathAsHtmlImage(path: string): Promise<HTMLImageElement> {
  const imageB64 = await ReadImageAsBase64(path).catch(() => "");
  if (!imageB64) throw new Error(`Cannot read image bytes from ${path}`);
  return loadHtmlImage(tempDataURLFromB64(imageB64));
}

function panoramaProjectFromEditSources(
  sourceImages: SourceImage[] | undefined,
  roundtrip: HistoryItem["panoramaRoundtrip"],
): PanoramaProjectRef | undefined {
  const sourceProject = (sourceImages ?? []).find((source) => source.panoramaProject)?.panoramaProject;
  if (sourceProject?.sourceHistoryId) {
    return {
      ...sourceProject,
      role: "edited-shot",
    };
  }
  return buildPanoramaProjectRefFromRoundtrip(roundtrip, "edited-shot");
}

function syntheticPanoramaResultItem(
  imported: Awaited<ReturnType<typeof ImportImageFromB64>>,
  imageB64: string,
  source: HistoryItem,
  panoramaSource: Pick<HistoryItem, "id" | "savedPath" | "width" | "height" | "previewWidth" | "previewHeight" | "panoramaProject"> | null,
): HistoryItem {
  const previewBacked = !!(imported.previewUrl || imported.imageId);
  const width = Number.isFinite(Number(imported.width)) ? Number(imported.width) : source.width;
  const height = Number.isFinite(Number(imported.height)) ? Number(imported.height) : source.height;
  const panoramaSourcePath = String(panoramaSource?.savedPath || "").trim();
  const sourceProject = resolvePanoramaProjectRef(source);
  const pastedProject = sourceProject?.sourceHistoryId
    ? {
        sourceHistoryId: sourceProject.sourceHistoryId,
        sourcePath: sourceProject.sourcePath,
        role: "pasted-panorama" as const,
        shotHistoryId: sourceProject.shotHistoryId,
        editedShotHistoryId: source.id,
      }
    : buildPanoramaProjectRefFromRoundtrip(resolvePanoramaRoundtripRef(source), "pasted-panorama", {
        editedShotHistoryId: source.id,
      });
  const panoramaSourceImage = panoramaSourcePath
    ? {
        path: panoramaSourcePath,
        name: panoramaSourcePath.split(/[\\/]/).pop() || "source.png",
        size: 0,
        width: Number.isFinite(Number(panoramaSource?.width))
          ? Number(panoramaSource?.width)
          : (Number.isFinite(Number(panoramaSource?.previewWidth)) ? Number(panoramaSource?.previewWidth) : undefined),
        height: Number.isFinite(Number(panoramaSource?.height))
          ? Number(panoramaSource?.height)
          : (Number.isFinite(Number(panoramaSource?.previewHeight)) ? Number(panoramaSource?.previewHeight) : undefined),
        panoramaProject: panoramaSource?.panoramaProject || (panoramaSource?.id
          ? buildPanoramaProjectRef(panoramaSource, "source")
          : undefined),
      } satisfies SourceImage
    : null;
  return {
    id: cryptoIDFallback(),
    imageId: imported.imageId || undefined,
    previewUrl: imported.previewUrl || undefined,
    fullUrl: imported.imageId ? `/media/full/${imported.imageId}` : undefined,
    imageB64: previewBacked ? undefined : imageB64,
    imageBlob: null,
    previewBlob: null,
    previewOnly: true,
    prompt: source.prompt,
    revisedPrompt: source.revisedPrompt,
    mode: source.mode,
    apiMode: source.apiMode,
    apiProfileId: source.apiProfileId,
    apiProfileName: source.apiProfileName,
    size: `${Math.max(1, Number(width || 0))}x${Math.max(1, Number(height || 0))}` as SizeValue,
    quality: source.quality,
    outputFormat: "png",
    parentId: source.savedPath || source.parentId,
    createdAt: Date.now(),
    seed: source.seed,
    negativePrompt: source.negativePrompt,
    styleTag: source.styleTag,
    elapsedSec: source.elapsedSec,
    savedPath: imported.path,
    sourceImages: panoramaSourceImage ? [panoramaSourceImage] : undefined,
    panoramaProject: pastedProject,
    width,
    height,
    previewWidth: Number.isFinite(Number(imported.previewWidth)) ? Number(imported.previewWidth) : undefined,
    previewHeight: Number.isFinite(Number(imported.previewHeight)) ? Number(imported.previewHeight) : undefined,
  };
}

function externalPanoramaPastebackItem(
  imported: Awaited<ReturnType<typeof ImportImageFromB64>>,
  file: File,
  imageB64: string,
  anchor: HistoryItem,
  roundtrip: NonNullable<HistoryItem["panoramaRoundtrip"]>,
  dimensions: { w: number; h: number },
): HistoryItem {
  const itemId = cryptoIDFallback();
  const previewBacked = !!(imported.previewUrl || imported.imageId);
  const legacyB64 = previewBacked ? "" : (imported.imageB64 || imageB64);
  const legacyBlob = legacyB64 ? base64ToBlob(legacyB64, file.type || "image/png") : null;
  const width = Number.isFinite(Number(imported.width))
    ? Number(imported.width)
    : (Number.isFinite(Number(imported.previewWidth)) ? Number(imported.previewWidth) : dimensions.w);
  const height = Number.isFinite(Number(imported.height))
    ? Number(imported.height)
    : (Number.isFinite(Number(imported.previewHeight)) ? Number(imported.previewHeight) : dimensions.h);
  const anchorProject = resolvePanoramaProjectRef(anchor);
  const shotHistoryId = anchorProject?.shotHistoryId || anchor.id;
  const panoramaProject = anchorProject?.sourceHistoryId
    ? {
        sourceHistoryId: anchorProject.sourceHistoryId,
        sourcePath: anchorProject.sourcePath,
        role: "edited-shot" as const,
        shotHistoryId,
        editedShotHistoryId: itemId,
      }
    : buildPanoramaProjectRefFromRoundtrip(roundtrip, "edited-shot", {
        shotHistoryId,
        editedShotHistoryId: itemId,
      });
  const sourceImage: SourceImage = {
    path: imported.path,
    name: file.name,
    size: file.size,
    width,
    height,
    previewUrl: imported.previewUrl || undefined,
    imageBlob: legacyBlob,
    imageB64: legacyB64 || undefined,
    panoramaRoundtrip: roundtrip,
    panoramaProject,
  };
  return {
    id: itemId,
    imageId: imported.imageId || undefined,
    previewUrl: imported.previewUrl || undefined,
    fullUrl: imported.imageId ? `/media/full/${imported.imageId}` : undefined,
    imageB64: legacyB64 || undefined,
    imageBlob: null,
    previewBlob: legacyBlob,
    previewOnly: previewBacked,
    prompt: `(外部贴回)${file.name}`,
    mode: "edit",
    apiMode: anchor.apiMode,
    apiProfileId: anchor.apiProfileId,
    apiProfileName: anchor.apiProfileName,
    size: `${Math.max(1, Number(width || dimensions.w))}x${Math.max(1, Number(height || dimensions.h))}` as SizeValue,
    quality: anchor.quality || "medium",
    outputFormat: "png",
    parentId: anchor.savedPath || anchor.parentId,
    createdAt: Date.now(),
    savedPath: imported.path,
    sourceImages: [sourceImage],
    panoramaRoundtrip: roundtrip,
    panoramaProject,
    width,
    height,
    previewWidth: Number.isFinite(Number(imported.previewWidth)) ? Number(imported.previewWidth) : width,
    previewHeight: Number.isFinite(Number(imported.previewHeight)) ? Number(imported.previewHeight) : height,
  };
}

function runningHubRecoveryHistoryId(taskId: string): string {
  return `runninghub-recovered:${taskId}`;
}

function apimartRecoveryHistoryId(taskId: string): string {
  return `apimart-recovered:${taskId}`;
}

function parseRunningHubTimestamp(value: string | null | undefined): number | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const millis = Date.parse(normalized);
  return Number.isFinite(millis) ? millis : null;
}

function runningHubElapsedSec(task: RunningHubBridgeTask): number | undefined {
  const startedAt = parseRunningHubTimestamp(task.startedAt);
  const completedAt = parseRunningHubTimestamp(task.completedAt || task.updatedAt);
  if (startedAt === null || completedAt === null || completedAt < startedAt) return undefined;
  return Math.max(0, Math.round((completedAt - startedAt) / 100) / 10);
}

function sourceImagesForRecoveredTask(task: Pick<BatchTaskRecord, "mode" | "sourceImages" | "sourceImagePaths">): SourceImage[] | undefined {
  const sourceImages = sourceImagesForTask(task);
  return sourceImages.length > 0 ? sourceImages : undefined;
}

function recoveredRunningHubHistoryItem(
  task: BatchTaskRecord,
  recoveredTask: RunningHubBridgeTask,
  imported: Awaited<ReturnType<typeof ImportImageFromB64>>,
  imageB64: string,
): HistoryItem {
  const previewBacked = !!(imported.previewUrl || imported.imageId);
  const width = Number.isFinite(Number(imported.width)) ? Number(imported.width) : undefined;
  const height = Number.isFinite(Number(imported.height)) ? Number(imported.height) : undefined;
  const sourceImages = sourceImagesForRecoveredTask(task);
  const panoramaRoundtrip = task.panoramaRoundtrip ?? panoramaRoundtripFromSources(sourceImages);
  const createdAt = parseRunningHubTimestamp(recoveredTask.completedAt || recoveredTask.updatedAt || recoveredTask.startedAt) || Date.now();
  const parentId = String(task.batchSourcePath || task.sourceImagePaths?.[0] || "").trim() || undefined;
  return {
    id: runningHubRecoveryHistoryId(task.id),
    imageId: imported.imageId || undefined,
    previewUrl: imported.previewUrl || undefined,
    fullUrl: imported.imageId ? `/media/full/${imported.imageId}` : undefined,
    imageB64: previewBacked ? undefined : imageB64,
    imageBlob: null,
    previewBlob: null,
    previewOnly: true,
    prompt: task.prompt,
    revisedPrompt: "",
    mode: task.mode,
    apiMode: task.apiMode,
    apiProfileId: task.apiProfileId,
    apiProfileName: task.apiProfileName,
    size: task.size,
    quality: task.quality,
    outputFormat: task.outputFormat,
    parentId,
    createdAt,
    seed: task.seed,
    negativePrompt: task.negativePrompt,
    styleTag: task.styleTag,
    elapsedSec: runningHubElapsedSec(recoveredTask) ?? task.elapsedSec,
    batchIndex: task.slotIndex,
    savedPath: imported.path,
    sourceImages,
    panoramaRoundtrip,
    panoramaProject: panoramaProjectFromEditSources(sourceImages, panoramaRoundtrip),
    width,
    height,
    previewWidth: Number.isFinite(Number(imported.previewWidth)) ? Number(imported.previewWidth) : undefined,
    previewHeight: Number.isFinite(Number(imported.previewHeight)) ? Number(imported.previewHeight) : undefined,
    rawPath: task.rawPath,
  };
}

function recoveredAPIMartHistoryItem(
  task: BatchTaskRecord,
  recoveredTask: APIMartRecoveredTask,
  imported: Awaited<ReturnType<typeof ImportImageFromB64>>,
  imageB64: string,
): HistoryItem {
  const previewBacked = !!(imported.previewUrl || imported.imageId);
  const width = Number.isFinite(Number(imported.width)) ? Number(imported.width) : undefined;
  const height = Number.isFinite(Number(imported.height)) ? Number(imported.height) : undefined;
  const sourceImages = sourceImagesForRecoveredTask(task);
  const panoramaRoundtrip = task.panoramaRoundtrip ?? panoramaRoundtripFromSources(sourceImages);
  const parentId = String(task.batchSourcePath || task.sourceImagePaths?.[0] || "").trim() || undefined;
  return {
    id: apimartRecoveryHistoryId(recoveredTask.taskId || task.id),
    imageId: imported.imageId || undefined,
    previewUrl: imported.previewUrl || undefined,
    fullUrl: imported.imageId ? `/media/full/${imported.imageId}` : undefined,
    imageB64: previewBacked ? undefined : imageB64,
    imageBlob: null,
    previewBlob: null,
    previewOnly: true,
    prompt: task.prompt,
    revisedPrompt: "",
    mode: task.mode,
    apiMode: task.apiMode,
    apiProfileId: task.apiProfileId,
    apiProfileName: task.apiProfileName,
    size: task.size,
    quality: task.quality,
    outputFormat: task.outputFormat,
    parentId,
    createdAt: Date.now(),
    seed: task.seed,
    negativePrompt: task.negativePrompt,
    styleTag: task.styleTag,
    elapsedSec: task.elapsedSec,
    batchIndex: task.slotIndex,
    savedPath: imported.path,
    sourceImages,
    panoramaRoundtrip,
    panoramaProject: panoramaProjectFromEditSources(sourceImages, panoramaRoundtrip),
    width,
    height,
    previewWidth: Number.isFinite(Number(imported.previewWidth)) ? Number(imported.previewWidth) : undefined,
    previewHeight: Number.isFinite(Number(imported.previewHeight)) ? Number(imported.previewHeight) : undefined,
    rawPath: task.rawPath,
  };
}

async function recoverableAPIMartTaskId(task: BatchTaskRecord): Promise<string> {
  const direct = extractAPIMartTaskIdFromText(task.apimartTaskId);
  if (direct) return direct;
  const fromMessage = extractAPIMartTaskIdFromText(`${task.errorMessage || ""}\n${task.lastLogLine || ""}\n${task.rawPath || ""}`);
  if (fromMessage) return fromMessage;
  const rawPath = String(task.rawPath || "").trim();
  if (!rawPath) return "";
  const raw = await ReadTextFile(rawPath).catch(() => "");
  return extractAPIMartTaskIdFromText(raw);
}

async function autoPastePanoramaRoundtripResult(
  item: HistoryItem,
  options: {
    workspaceId: string;
    selectAsCurrent?: boolean;
    alignment?: PanoramaPastebackAlignment | null;
    pasteMask?: PanoramaPastebackMaskInput | null;
  },
): Promise<HistoryItem | null> {
  item = recoverPanoramaItemMetadata(item, useStudioStore.getState().history);
  const roundtrip = resolvePanoramaRoundtripRef(item);
  if (!roundtrip) return null;
  let sourceItem = roundtrip.sourceHistoryId
    ? useStudioStore.getState().history.find((entry) => entry.id === roundtrip.sourceHistoryId) ?? null
    : null;
  if (!sourceItem && roundtrip.sourcePath) {
    sourceItem = {
      id: `panorama-source:${roundtrip.sourceHistoryId || roundtrip.sourcePath}`,
      prompt: item.prompt,
      revisedPrompt: item.revisedPrompt,
      mode: "edit",
      apiMode: item.apiMode,
      apiProfileId: item.apiProfileId,
      apiProfileName: item.apiProfileName,
      size: `${roundtrip.roundtripState.source_erp.width}x${roundtrip.roundtripState.source_erp.height}`,
      quality: item.quality,
      outputFormat: "png",
      createdAt: item.createdAt,
      savedPath: roundtrip.sourcePath,
      width: roundtrip.roundtripState.source_erp.width,
      height: roundtrip.roundtripState.source_erp.height,
    };
  }
  if (!sourceItem) throw new Error("Panorama source image is missing");
  const [erpImage, rectImage] = await Promise.all([
    sourceItem.savedPath
      ? loadSavedPathAsHtmlImage(sourceItem.savedPath)
      : loadHistoryItemAsHtmlImage(sourceItem),
    loadHistoryItemAsHtmlImage(item),
  ]);
  const pasted = pastePanoramaRoundtripBase64(erpImage, rectImage, roundtrip.roundtripState, options.alignment, options.pasteMask ?? null);
  const imported = await ImportImageFromB64(pasted.imageB64, `panorama-roundtrip-${Date.now()}.png`);
  const ref = await RegisterImportedImageAsset(imported.path).catch(() => null);
  const nextItem = ref
    ? withMediaAssetRef(syntheticPanoramaResultItem(imported, pasted.imageB64, item, sourceItem), ref)
    : syntheticPanoramaResultItem(imported, pasted.imageB64, item, sourceItem);
  useStudioStore.setState((state) => {
    const history = trimHistory([nextItem, ...state.history.filter((entry) => entry.id !== nextItem.id)]);
    const workspacePatch: WorkspacePatch = options.selectAsCurrent
      ? {
          currentImageId: nextItem.id,
          resultGridOpen: false,
          historyGalleryOpen: false,
        }
      : {};
    return {
      history,
      workspaces: patchWorkspaceRuntime(state.workspaces, options.workspaceId, workspacePatch),
      ...(options.selectAsCurrent && state.activeWorkspaceId === options.workspaceId
        ? {
            currentImage: nextItem,
            resultGridOpen: false,
            historyGalleryOpen: false,
            historyGallerySinglePreviewId: null,
            compareB: null,
            maskDataURL: null,
            annotations: [],
            tool: "pan",
          }
        : {}),
    } as Partial<StudioState>;
  });
  await persistHistoryItem(nextItem).catch(() => undefined);
  persistTrimmedHistory(useStudioStore.getState().history);
  return nextItem;
}

function isBrowserTaskProxyMode(): boolean {
  return detectHostKind() === "browser";
}

function isAndroidTaskProxyMode(): boolean {
  return false;
}

function isBackgroundTaskProxyMode(): boolean {
  return isBrowserTaskProxyMode() || isAndroidTaskProxyMode();
}

function shouldUseBackgroundTaskProxyForSubmit(apiMode: APIMode): boolean {
  if (apiMode === "runninghub") return false;
  if (isBrowserTaskProxyMode()) return true;
  return isAndroidTaskProxyMode() && apiMode !== "images";
}

function fhlTransportModeForState(state: StudioState): "images" | "responses" {
  return state.fhlTransportMode === "responses" ? "responses" : "images";
}

function isOfficialFHLTransportProfile(
  profile: Pick<UpstreamProfile, "apiMode" | "baseURL"> | null | undefined,
  fallbackBaseURL = "",
  fallbackAPIMode?: APIMode,
): boolean {
  return isOfficialFHLProfile(profile, {
    apiMode: fallbackAPIMode,
    baseURL: fallbackBaseURL,
  });
}

function effectiveAPIModeForSubmit(
  state: StudioState,
  profile: UpstreamProfile | null | undefined,
  fallbackAPIMode: APIMode,
): APIMode {
  return effectiveProviderMode(
    profile,
    fallbackAPIMode,
    fhlTransportModeForState(state),
    state.baseURL,
  );
}

function fhlImagesPoolProfiles(state: StudioState): UpstreamProfile[] {
  return mapFHLImagesProfilesToPoolSlots(state.profiles)
    .filter((profile): profile is UpstreamProfile => !!profile && isOfficialFHLImagesProfile(profile));
}

function isFHLImagesPoolProfileId(state: StudioState, profileId?: string): boolean {
  const cleanId = String(profileId || "").trim();
  return !!cleanId && fhlImagesPoolProfiles(state).some((profile) => profile.id === cleanId);
}

function shouldRetainFHLPoolCapacityOnCancel(state: StudioState, jobId: string): boolean {
  return isFHLImagesPoolProfileId(state, state.runningJobMeta[jobId]?.apiProfileId);
}

function apiProfileSnapshotForSubmit(profile: UpstreamProfile | undefined, activeProfileId: string) {
  const apiProfileId = String(profile?.id || activeProfileId || "").trim();
  const apiProfileName = String(profile?.name || "").trim();
  return {
    apiProfileId: apiProfileId || undefined,
    apiProfileName: apiProfileName || undefined,
  };
}

function transientProfileKey(apiMode: APIModeValue, apiProfileId?: string) {
  const profileId = String(apiProfileId || "").trim();
  // Profile-scoped limits must survive an Images/Responses switch. Old calls
  // without a profile ID retain the API-mode fallback key for compatibility.
  return profileId ? `profile:${profileId}` : `mode:${apiMode}`;
}

function clearContinuousPoolProfileRuntimeLimit(profileId: string) {
  const cleanId = String(profileId || "").trim();
  if (!cleanId) return;
  unavailableContinuousPoolProfileIds.delete(cleanId);
  const key = transientProfileKey("images", cleanId);
  const cap = temporaryConcurrencyCapsByProfile.get(key);
  if (cap?.timer) clearTimeout(cap.timer);
  temporaryConcurrencyCapsByProfile.delete(key);
  temporaryConcurrencyDowngradeCountsByProfile.delete(key);
  useStudioStore.setState((current) => {
    const next = { ...current.fhlPoolEffectiveConcurrencyByProfileId };
    delete next[cleanId];
    return { fhlPoolEffectiveConcurrencyByProfileId: next };
  });
}

function clearAutoRetryTimer(taskId: string) {
  const timer = autoRetryTimersByTaskId.get(taskId);
  if (!timer) return;
  clearTimeout(timer);
  autoRetryTimersByTaskId.delete(taskId);
}

function activeProfileForConcurrency(state: StudioState, apiProfileId?: string) {
  const cleanId = String(apiProfileId || "").trim();
  if (cleanId) {
    const matched = state.profiles.find((profile) => profile.id === cleanId);
    if (matched) return matched;
  }
  return state.profiles.find((profile) => profile.id === state.activeProfileId);
}

function effectiveConcurrencyLimitForProfile(
  state: StudioState,
  apiMode: APIModeValue,
  apiProfileId?: string,
) {
  const profile = activeProfileForConcurrency(state, apiProfileId);
  const baseLimit = normalizeConcurrencyLimit(profile?.concurrencyLimit ?? 0);
  return effectiveConcurrencyLimitFromBase(state, apiMode, apiProfileId || profile?.id, baseLimit);
}

function effectiveConcurrencyLimitFromBase(
  state: StudioState,
  apiMode: APIModeValue,
  apiProfileId: string | undefined,
  baseLimit: number,
) {
  const profileId = apiProfileId || state.activeProfileId;
  const key = transientProfileKey(apiMode, profileId);
  const cap = temporaryConcurrencyCapsByProfile.get(key);
  if (!cap) return baseLimit;
  const now = Date.now();
  if (cap.expiresAt <= now) {
    if (cap.timer) clearTimeout(cap.timer);
    temporaryConcurrencyCapsByProfile.delete(key);
    return baseLimit;
  }
  return baseLimit > 0 ? Math.min(baseLimit, cap.limit) : cap.limit;
}

function enabledFHLPoolProfiles(state: StudioState): UpstreamProfile[] {
  return fhlImagesPoolProfiles(state).filter((profile) => profile.continuousPoolEnabled === true);
}

function fhlPoolSlotConcurrencyLimit(
  state: StudioState,
  apiMode: APIModeValue,
  apiProfileId: string,
): number {
  if (unavailableContinuousPoolProfileIds.has(apiProfileId)) return 0;
  return effectiveConcurrencyLimitFromBase(
    state,
    apiMode,
    apiProfileId,
    Math.min(
      FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT,
      normalizeFHLPoolPerAPIConcurrencyLimit(state.fhlPoolPerAPIConcurrencyLimit),
    ),
  );
}

function fhlPoolProfileCapacityProjection(state: StudioState, apiMode: APIModeValue): UpstreamProfile[] {
  return enabledFHLPoolProfiles(state).map((profile) => {
    const concurrencyLimit = fhlPoolSlotConcurrencyLimit(state, apiMode, profile.id);
    return {
      ...profile,
      continuousPoolEnabled: concurrencyLimit > 0,
      concurrencyLimit,
    };
  });
}

function fhlPoolTotalCapacity(state: StudioState, apiMode: APIModeValue = fhlTransportModeForState(state)): number {
  return fhlPoolProfileCapacityProjection(state, apiMode)
    .reduce((sum, profile) => sum + Math.max(0, normalizeConcurrencyLimit(profile.concurrencyLimit)), 0);
}

function nextFHLPoolProfileForMultiReferenceRetry(
  state: StudioState,
  task: BatchTaskRecord,
): UpstreamProfile | null {
  if (
    task.continuousPoolTask !== true
    || task.mode !== "edit"
    || (task.sourceImagePaths?.length ?? 0) < 2
    || normalizeAPIMode(task.apiMode) !== "images"
    || !isFHLImagesPoolProfileId(state, task.apiProfileId)
  ) {
    return null;
  }
  const projected = fhlPoolProfileCapacityProjection(state, "images");
  const selected = selectNextFailoverPoolProfile(projected, String(task.apiProfileId || ""));
  if (!selected) return null;
  return enabledFHLPoolProfiles(state).find((profile) => profile.id === selected.id) ?? null;
}

function recordTransientFailureForTask(task: BatchTaskRecord, reason: string): number | null {
  if (!isTransientGenerationFailureText(reason, task.errorMessage, task.lastLogLine)) return null;
  const signature = `${task.id}:${task.status}:${task.updatedAt}:${reason}`;
  if (recordedTransientFailureSignatures.has(signature)) return null;
  recordedTransientFailureSignatures.add(signature);
  const now = Date.now();
  const key = transientProfileKey(normalizeAPIMode(task.apiMode), task.apiProfileId);
  const recent = (transientFailureWindowsByProfile.get(key) ?? [])
    .filter((time) => now - time <= TRANSIENT_FAILURE_WINDOW_MS);
  recent.push(now);
  transientFailureWindowsByProfile.set(key, recent);
  const lastDowngradeCount = temporaryConcurrencyDowngradeCountsByProfile.get(key) ?? 0;
  if (recent.length - lastDowngradeCount < 2) return null;

  const state = useStudioStore.getState();
  const profile = activeProfileForConcurrency(state, task.apiProfileId);
  const baseLimit = profile && isFHLImagesPoolProfileId(state, profile.id)
    ? Math.min(
        FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT,
        normalizeFHLPoolPerAPIConcurrencyLimit(state.fhlPoolPerAPIConcurrencyLimit),
      )
    : normalizeConcurrencyLimit(profile?.concurrencyLimit ?? 0);
  const existing = temporaryConcurrencyCapsByProfile.get(key);
  const currentEffective = existing && existing.expiresAt > now
    ? existing.limit
    : (baseLimit > 0 ? baseLimit : 0);
  const nextLimit = currentEffective > 0
    ? Math.max(1, Math.floor(currentEffective / 2))
    : 4;
  if (existing && existing.expiresAt > now && nextLimit >= existing.limit) return null;
  if (existing?.timer) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    temporaryConcurrencyCapsByProfile.delete(key);
    temporaryConcurrencyDowngradeCountsByProfile.delete(key);
    const profileId = String(task.apiProfileId || "").trim();
    if (profileId) {
      useStudioStore.setState((current) => {
        const next = { ...current.fhlPoolEffectiveConcurrencyByProfileId };
        delete next[profileId];
        return { fhlPoolEffectiveConcurrencyByProfileId: next };
      });
      void requestContinuousPoolPump();
    }
  }, TEMPORARY_CONCURRENCY_CAP_MS);
  temporaryConcurrencyCapsByProfile.set(key, {
    limit: nextLimit,
    expiresAt: now + TEMPORARY_CONCURRENCY_CAP_MS,
    timer,
  });
  const profileId = String(task.apiProfileId || "").trim();
  if (profileId) {
    useStudioStore.setState((current) => ({
      fhlPoolEffectiveConcurrencyByProfileId: {
        ...current.fhlPoolEffectiveConcurrencyByProfileId,
        [profileId]: nextLimit,
      },
    }));
  }
  temporaryConcurrencyDowngradeCountsByProfile.set(key, recent.length);
  return nextLimit;
}

function retryContextFromOriginalTask(state: StudioState, task: BatchTaskRecord) {
  const profile = task.apiProfileId
    ? state.profiles.find((entry) => entry.id === task.apiProfileId)
    : undefined;
  const apiMode = normalizeAPIMode(task.apiMode);
  const requestPolicy = task.requestPolicy ?? profile?.requestPolicy ?? state.requestPolicy;
  const textModelID = task.textModelID || profile?.textModelID || state.textModelID;
  const imageModelID = task.imageModelID || profile?.imageModelID || state.imageModelID;
  return {
    activeProfile: profile,
    apiMode,
    apiProfileSnapshot: {
      apiProfileId: task.apiProfileId || profile?.id || state.activeProfileId || undefined,
      apiProfileName: task.apiProfileName || profile?.name || undefined,
    },
    baseURL: task.apiBaseURL ?? profile?.baseURL ?? state.baseURL,
    requestPolicy,
    textModelID,
    imageModelID,
    imagesNewAPICompat: apiMode === "images" && (task.imagesNewAPICompat ?? profile?.imagesNewAPICompat ?? state.imagesNewAPICompat) === true,
    concurrencyLimit: effectiveConcurrencyLimitForProfile(state, apiMode, task.apiProfileId || profile?.id),
  };
}

async function apiKeyForProfileOrState(state: StudioState, apiProfileId?: string): Promise<string> {
  const cleanProfileId = String(apiProfileId || "").trim();
  if (!cleanProfileId) return state.apiKey;
  const stored = await GetStoredAPIKey(keyringUserFor(cleanProfileId)).catch(() => "");
  if (stored.trim()) return stored;
  return cleanProfileId === String(state.activeProfileId || "").trim() ? state.apiKey : "";
}

function retrySubmitContextFromState(state: StudioState, mode: Mode) {
  const activeProfile = state.profiles.find((profile) => profile.id === state.activeProfileId);
  const apiMode = effectiveAPIModeForSubmit(state, activeProfile, activeProfile?.apiMode ?? state.apiMode);
  const activeProfileUsesFHLTransport = isOfficialFHLTransportProfile(
    activeProfile,
    state.baseURL,
    activeProfile?.apiMode ?? state.apiMode,
  );
  const requestPolicy = activeProfile?.requestPolicy ?? state.requestPolicy;
  const textModelID = activeProfileUsesFHLTransport && apiMode === "responses"
    ? FHL_TEXT_MODEL_ID
    : activeProfile?.textModelID ?? state.textModelID;
  const imageModelID = activeProfile?.imageModelID ?? state.imageModelID;
  return {
    activeProfile,
    apiMode,
    apiProfileSnapshot: apiProfileSnapshotForSubmit(activeProfile, state.activeProfileId),
    baseURL: activeProfile?.baseURL ?? state.baseURL,
    requestPolicy,
    textModelID,
    imageModelID,
    imagesNewAPICompat: apiMode === "images" && (activeProfile?.imagesNewAPICompat ?? state.imagesNewAPICompat) === true,
    concurrencyLimit: effectiveConcurrencyLimitForProfile(state, apiMode, activeProfile?.id || state.activeProfileId),
  };
}

function browserHistoryId(jobId: string): string {
  return `job:${jobId}`;
}

function pathLeaf(filePath: string): string {
  const normalized = String(filePath || "").trim().replace(/[\\/]+$/, "");
  if (!normalized) return "image.png";
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || "image.png";
}

function directoryFromPath(filePath: string): string {
  const normalized = String(filePath || "").trim().replace(/[\\/]+$/, "");
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return index >= 0 ? normalized.slice(0, index) : "";
}

function buildBatchAutoAspectSize(
  resolution: "1k" | "2k" | "4k",
  dimensions: SourceDimensions,
  input: {
    apiMode: APIMode;
    requestPolicy: RequestPolicy;
    imageModelID?: string;
  },
): SizeValue | null {
  return buildAutoAspectSizeFromDimensions(
    resolution,
    dimensions.width,
    dimensions.height,
    input,
  );
}

async function resolveAutoAspectDimensions(source: {
  path?: string;
  width?: number;
  height?: number;
  previewWidth?: number;
  previewHeight?: number;
  imageBlob?: Blob | null;
  imageB64?: string | null;
}): Promise<SourceDimensions | null> {
  const cached = sourceDimensionsFromMetadata(source);
  if (cached) return cached;
  const direct = await getImageDimensions(source);
  if (direct?.w && direct?.h) {
    return { width: direct.w, height: direct.h };
  }
  const path = String(source.path || "").trim();
  if (!path) return null;
  const imageB64 = await ReadImageAsBase64(path).catch(() => "");
  const fromPath = imageB64 ? getImageDimensionsFromBase64(imageB64) : null;
  if (!fromPath?.w || !fromPath?.h) return null;
  return { width: fromPath.w, height: fromPath.h };
}

async function buildAutoAspectSizeForSource(
  resolution: "1k" | "2k" | "4k",
  source: {
    path?: string;
    width?: number;
    height?: number;
    previewWidth?: number;
    previewHeight?: number;
    imageBlob?: Blob | null;
    imageB64?: string | null;
  },
  input: {
    apiMode: APIMode;
    requestPolicy: RequestPolicy;
    imageModelID?: string;
  },
): Promise<SizeValue | null> {
  const dimensions = await resolveAutoAspectDimensions(source);
  return dimensions ? buildBatchAutoAspectSize(resolution, dimensions, input) : null;
}

function implicitEditAutoAspectSource(
  currentImage: Pick<HistoryItem, "savedPath" | "width" | "height" | "previewWidth" | "previewHeight" | "imageBlob" | "imageB64"> | null | undefined,
): RetryAutoAspectSource | null {
  if (!currentImage) return null;
  return {
    path: currentImage.savedPath || undefined,
    width: currentImage.width,
    height: currentImage.height,
    previewWidth: currentImage.previewWidth,
    previewHeight: currentImage.previewHeight,
    imageBlob: currentImage.imageBlob ?? null,
    imageB64: currentImage.imageB64 ?? null,
  };
}

type AutoAspectResolutionValue = Exclude<BatchProcessAutoAspectResolution, "">;
type RetryAutoAspectContext = Pick<BatchTaskRecord, "mode" | "autoAspectResolution" | "batchSourcePath" | "sourceImagePaths">;
type RetryAutoAspectSource = {
  path?: string;
  width?: number;
  height?: number;
  previewWidth?: number;
  previewHeight?: number;
  imageBlob?: Blob | null;
  imageB64?: string | null;
};

function normalizeAutoAspectResolutionValue(value: unknown): AutoAspectResolutionValue | undefined {
  return value === "1k" || value === "2k" || value === "4k" ? value : undefined;
}

function autoAspectPathKey(value: unknown): string {
  return String(value || "").trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function findWorkspaceSourceForAutoAspect(workspace: Workspace | undefined, sourcePath: string): RetryAutoAspectSource | null {
  const key = autoAspectPathKey(sourcePath);
  if (!key || !workspace) return null;
  const sources: RetryAutoAspectSource[] = [
    ...(workspace.batchProcess.discoveredSources ?? []),
    ...(workspace.sources ?? []),
  ];
  return sources.find((source) => autoAspectPathKey(source.path) === key) ?? null;
}

function sourceForRetryAutoAspect(context: RetryAutoAspectContext, workspace: Workspace | undefined): RetryAutoAspectSource | null {
  const firstReferencePath = context.sourceImagePaths?.map((item) => String(item || "").trim()).find(Boolean) ?? "";
  if (firstReferencePath) {
    return findWorkspaceSourceForAutoAspect(workspace, firstReferencePath) ?? { path: firstReferencePath };
  }
  const batchPath = String(context.batchSourcePath || "").trim();
  if (batchPath) {
    return findWorkspaceSourceForAutoAspect(workspace, batchPath) ?? { path: batchPath };
  }
  return workspace?.sources?.[0] ?? null;
}

function retryAutoAspectResolutionForContext(
  context: RetryAutoAspectContext,
  workspace: Workspace | undefined,
): AutoAspectResolutionValue | undefined {
  const stored = normalizeAutoAspectResolutionValue(context.autoAspectResolution);
  if (stored) return stored;
  const current = normalizeAutoAspectResolutionValue(workspace?.batchProcess.autoAspectResolution);
  if (context.mode === "edit" && context.batchSourcePath && workspace?.editSourceMode === "batch") return current;
  return undefined;
}

async function buildRetryAutoAspectSizeForContext(
  context: RetryAutoAspectContext,
  workspace: Workspace | undefined,
  resolution: AutoAspectResolutionValue,
  input: {
    apiMode: APIMode;
    requestPolicy: RequestPolicy;
    imageModelID?: string;
  },
): Promise<SizeValue | null> {
  const source = sourceForRetryAutoAspect(context, workspace);
  return source ? buildAutoAspectSizeForSource(resolution, source, input) : null;
}

function batchReferenceOrderAutoAspectSource(
  fixedSources: SourceImage[],
  batchSource: {
    path?: string;
    width?: number;
    height?: number;
    previewWidth?: number;
    previewHeight?: number;
    imageBlob?: Blob | null;
    imageB64?: string | null;
  },
  batchSourceSlotIndex: number,
): {
  source: {
    path?: string;
    width?: number;
    height?: number;
    previewWidth?: number;
    previewHeight?: number;
    imageBlob?: Blob | null;
    imageB64?: string | null;
  };
  label: string;
} {
  const firstSlotIsBatchSource = normalizedReferenceSlotIndex(batchSourceSlotIndex, fixedSources.length) === 0;
  const firstFixedSource = fixedSources[0] ?? null;
  if (firstSlotIsBatchSource || !firstFixedSource) {
    return { source: batchSource, label: "\u7b2c1\u683c\u6279\u91cf\u6e90\u56fe" };
  }
  return { source: firstFixedSource, label: "\u7b2c1\u683c\u53c2\u8003\u56fe" };
}

function materialSyncItemsForGroup(
  group: MaterialGroup,
  historyById: Map<string, HistoryItem>,
): MaterialOutputSyncItemLike[] {
  return group.items.map((ref, index) => {
    if (ref.kind === "source") {
      const savedPath = ref.source.path?.trim() ?? "";
      const suggestedName = ref.source.name?.trim() || pathLeaf(savedPath);
      return {
        historyId: savedPath ? `source:${savedPath}` : `source:${group.id}:${index}`,
        savedPath,
        suggestedName,
        missingReason: savedPath ? undefined : "Missing source path",
      };
    }
    const item = historyById.get(ref.historyId);
    if (!item) {
      return {
        historyId: ref.historyId,
        savedPath: "",
        suggestedName: `${ref.historyId}.png`,
        missingReason: "History item not found",
      };
    }
    const savedPath = item.savedPath?.trim() ?? "";
    return {
      historyId: item.id,
      savedPath,
      suggestedName: savedPath ? pathLeaf(savedPath) : `${item.imageId || item.id}.png`,
      missingReason: savedPath ? undefined : "History item has no saved path",
    };
  });
}

function imageMimeFromName(name: string): string {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/png";
}

function shouldNormalizeSourceForCLIFallback(name: string, imageB64: string): boolean {
  const trimmed = imageB64.trimStart();
  return /\.webp$/i.test(name) || trimmed.startsWith("data:image/webp");
}

function pngNameForCLIInput(name: string): string {
  const safe = String(name || "image.png").replace(/\.[^.\\/]+$/, "");
  return `${safe || "image"}.png`;
}

async function transcodeSourceToPNGBase64(imageB64: string, name: string): Promise<string> {
  if (typeof document === "undefined" || typeof Image === "undefined") return imageB64;
  const trimmed = imageB64.trim();
  const src = trimmed.startsWith("data:")
    ? trimmed
    : `data:${imageMimeFromName(name)};base64,${trimmed}`;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const next = new Image();
    next.onload = () => resolve(next);
    next.onerror = () => reject(new Error("source image decode failed"));
    next.src = src;
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, img.naturalWidth || img.width || 1);
  canvas.height = Math.max(1, img.naturalHeight || img.height || 1);
  const ctx = canvas.getContext("2d");
  if (!ctx) return imageB64;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
}

function batchProcessLinkFromTask(task: Pick<BatchTaskRecord, "batchOutputMode" | "batchOutputDir" | "batchOutputPrefix" | "sourceImagePaths" | "batchSourcePath"> | undefined): {
  sourcePath: string;
  outputDir: string;
  outputNamePrefix: string;
} | undefined {
  if (!task) return undefined;
  if (!task.batchOutputMode) return undefined;
  const sourcePath = String(task.batchSourcePath || task.sourceImagePaths?.[0] || "").trim();
  if (!sourcePath) return undefined;
  return {
    sourcePath,
    outputDir: task.batchOutputMode === "custom_dir" ? (task.batchOutputDir || "") : "",
    outputNamePrefix: task.batchOutputPrefix || "processed-",
  };
}

function syncBatchOutputAfterSuccess(
  link: {
    sourcePath: string;
    outputDir: string;
    outputNamePrefix: string;
  } | undefined,
  savedPath: string | null | undefined,
) {
  if (!link?.sourcePath) return;
  const sourceSavedPath = String(savedPath || "").trim();
  if (isVirtualImagePath(link.sourcePath) && !link.outputDir.trim()) return;
  if (isVirtualImagePath(link.sourcePath) && link.outputDir.trim()) {
    if (!sourceSavedPath) return;
    const suggestedName = `${link.outputNamePrefix || "processed-"}${pathLeaf(link.sourcePath) || "image.png"}`;
    void SaveImagePathToDir(sourceSavedPath, link.outputDir.trim(), suggestedName).catch((error: any) => {
      useStudioStore.getState().pushToast(`鎵瑰鐞嗚緭鍑哄悓姝ュけ璐ワ細${error?.message ?? error}`, "warn", 6000);
    });
    return;
  }
  const targetDirectory = link.outputDir.trim() || directoryFromPath(link.sourcePath);
  if (!sourceSavedPath || !targetDirectory) return;
  void BuildBatchOutputPath(
    link.sourcePath,
    targetDirectory,
    link.outputNamePrefix,
  ).then((targetPath) => {
    const suggestedName = pathLeaf(targetPath) || `${link.outputNamePrefix || "processed-"}image.png`;
    return SaveImagePathToDir(sourceSavedPath, targetDirectory, suggestedName);
  }).catch((error: any) => {
    useStudioStore.getState().pushToast(`批处理输出同步失败：${error?.message ?? error}`, "warn", 6000);
  });
}

function isVirtualImagePath(filePath: string | null | undefined): boolean {
  return String(filePath || "").trim().startsWith("memory://image/");
}

type BrowserProxyMaterializableSource = SourceImage | BatchProcessSourceImage;

async function materializeVirtualSourceForBrowserProxy<T extends BrowserProxyMaterializableSource>(source: T): Promise<T | null> {
  const rawPath = String(source.path || "").trim();
  if (!isVirtualImagePath(rawPath)) return source;
  const inlineB64 = "imageB64" in source ? String(source.imageB64 || "").trim() : "";
  const imageB64 = inlineB64 || await ReadImageAsBase64(rawPath).catch(() => "");
  if (!imageB64) return null;
  const sourceName = source.name || pathLeaf(rawPath);
  const needsPNG = shouldNormalizeSourceForCLIFallback(sourceName, imageB64);
  const cliB64 = needsPNG
    ? await transcodeSourceToPNGBase64(imageB64, sourceName).catch(() => imageB64)
    : imageB64;
  const imported = await ImportImageFromB64(cliB64, needsPNG ? pngNameForCLIInput(sourceName) : sourceName).catch(() => null);
  const nextPath = String(imported?.path || "").trim();
  if (!nextPath || isVirtualImagePath(nextPath)) return null;
  const previewMeta = source as Partial<BatchProcessSourceImage>;
  const nextSource = {
    ...source,
    name: pathLeaf(nextPath) || sourceName,
    path: nextPath,
    width: imported?.width ?? source.width,
    height: imported?.height ?? source.height,
    previewUrl: imported?.previewUrl || source.previewUrl,
    previewWidth: imported?.previewWidth ?? previewMeta.previewWidth,
    previewHeight: imported?.previewHeight ?? previewMeta.previewHeight,
  } as T;
  if ("imageB64" in nextSource) {
    nextSource.imageB64 = imported?.previewUrl ? undefined : (needsPNG ? cliB64 : (inlineB64 || imageB64));
  }
  return nextSource;
}

async function materializeEditSourcesForBrowserProxy(sources: SourceImage[]): Promise<SourceImage[]> {
  let changed = false;
  const nextSources = await Promise.all(sources.map(async (source) => {
    const materialized = await materializeVirtualSourceForBrowserProxy(source);
    if (!materialized || materialized === source) return source;
    changed = true;
    return materialized;
  }));
  return changed ? nextSources : sources;
}

type MaterializeBatchSourcesResult =
  | {
    ok: true;
    changed: boolean;
    selectedSources: BatchProcessSourceImage[];
    fixedSources: SourceImage[];
  }
  | {
    ok: false;
    failedLabel: string;
  };

async function materializeBatchSourcesForBrowserProxy(
  selectedSources: BatchProcessSourceImage[],
  fixedSources: SourceImage[],
): Promise<MaterializeBatchSourcesResult> {
  let changed = false;
  const nextSelectedSources: BatchProcessSourceImage[] = [];
  for (const source of selectedSources) {
    const materialized = await materializeVirtualSourceForBrowserProxy(source);
    if (!materialized) {
      return { ok: false, failedLabel: source.name || pathLeaf(source.path) };
    }
    changed ||= materialized !== source;
    nextSelectedSources.push(materialized);
  }

  const nextFixedSources: SourceImage[] = [];
  for (const source of fixedSources) {
    const materialized = await materializeVirtualSourceForBrowserProxy(source);
    if (!materialized) {
      return { ok: false, failedLabel: source.name || pathLeaf(source.path) };
    }
    changed ||= materialized !== source;
    nextFixedSources.push(materialized);
  }

  return {
    ok: true,
    changed,
    selectedSources: nextSelectedSources,
    fixedSources: nextFixedSources,
  };
}

async function resolvePromptTextProfile(s: StudioState): Promise<{
  apiKey: string;
  baseURL: string;
  textModelID: string;
}> {
  const selection = resolvePromptTextSelection({
    apiMode: s.apiMode,
    apiKey: s.apiKey,
    baseURL: s.baseURL,
    textModelID: s.textModelID,
    profiles: s.profiles,
    fhlTextAPIConfigured: !readRuntimePlatformState().isAndroid && s.fhlTextAPIConfigured,
  });
  if (!selection) return { apiKey: "", baseURL: "", textModelID: "" };

  const apiKey = selection.source === "current"
    ? s.apiKey
    : selection.source === "fhl-text"
      ? await GetStoredAPIKey(FHL_TEXT_API_KEYRING_USER).catch(() => "")
      : await GetStoredAPIKey(keyringUserFor(selection.profile?.id || "")).catch(() => "");
  return {
    apiKey: apiKey.trim(),
    baseURL: cleanBaseURL(selection.baseURL),
    textModelID: selection.textModelID.trim(),
  };
}

function promptOptimizeFailureMessage(error: unknown, profile: {
  baseURL: string;
  textModelID: string;
}): string {
  const detail = String((error as any)?.message ?? error ?? "").trim();
  const isFHLTextRequest = isOfficialFHLProfile({
    apiMode: "responses",
    baseURL: profile.baseURL,
  });
  if (isFHLTextRequest) return `Prompt 优化失败：${formatFHLTextAPIError(error)}`;
  return `Prompt 优化失败：${detail || "未知错误"}`;
}

function providerRequiresDirectAPIKey(apiMode: APIMode | string): boolean {
  return apiMode !== "runninghub" && apiModeRequiresDirectAPIKey(apiMode as APIMode);
}

function currentProviderHasRequiredKey(state: Pick<StudioState, "apiMode" | "apiKey">): boolean {
  return !providerRequiresDirectAPIKey(state.apiMode) || !!state.apiKey.trim();
}

function browserRuntimePatchFromGroups(groups: JobGroupSnapshot[], continuousGenerateTest = false): WorkspacePatch {
  const hasContinuousGroups = groups.some((group) => group.continuousGenerateTest === true && group.batchCount === 1);
  const runtime = continuousGenerateTest || hasContinuousGroups
    ? continuousRuntimeStateFromJobGroups(groups)
    : runtimeStateFromJobGroups(groups);
  return {
    runningJobs: runtime.runningJobs,
    jobsTotal: runtime.jobsTotal,
    jobsCompleted: runtime.jobsCompleted,
    jobsFailed: runtime.jobsFailed,
    progress: runtime.progress,
    streamPreview: null,
    streamPreviews: {},
    lastLogLine: runtime.lastLogLine,
    errorMessage: runtime.errorMessage,
    errorRawPath: runtime.errorRawPath,
  };
}

function cliConfigFromState(state: StudioState, overrides: Partial<CLIConfigSyncInput> = {}): CLIConfigSyncInput {
  return {
    baseURL: state.baseURL,
    apiMode: state.apiMode,
    requestPolicy: state.requestPolicy,
    imagesNewAPICompat: state.apiMode === "images" && state.imagesNewAPICompat === true,
    textModelID: state.textModelID,
    imageModelID: state.imageModelID,
    outputFormat: state.outputFormat,
    quality: state.quality,
    size: state.size,
    partialImages: 1,
    ...overrides,
  };
}

function buildRunningJobMetaFromBrowserGroups(
  groupsByWorkspace: Record<string, JobGroupSnapshot[]>,
): Record<string, RunningJobMeta> {
  const out: Record<string, RunningJobMeta> = {};
  for (const groups of Object.values(groupsByWorkspace)) {
    for (const group of groups) {
      for (const jobId of runningJobIdsFromGroup(group)) {
        out[jobId] = {
          workspaceId: group.workspaceId,
          apiMode: normalizeAPIMode(group.apiMode),
          apiProfileId: group.apiProfileId || undefined,
        };
      }
    }
  }
  return out;
}

function nextBatchSlotStartForWorkspace(state: StudioState, workspaceId: string) {
  const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
  const tasks = sortedBatchTasksForWorkspace(workspaceId, workspace?.batchTaskIds ?? [], state.batchTasksById);
  const taskStart = nextSlotIndexFromTasks(tasks);
  const workspaceBatchResults = completeWorkspaceBatchResults(state, workspaceId);
  const resultMax = workspaceBatchResults.reduce((max, item) => (
    Math.max(max, Number.isFinite(Number(item.batchIndex)) ? Number(item.batchIndex) : -1)
  ), -1);
  return Math.max(
    taskStart,
    resultMax + 1,
    workspace?.jobsTotal ?? 0,
    workspace?.batchTaskIds?.length ?? 0,
    workspace?.batchResultIds?.length ?? 0,
    state.activeWorkspaceId === workspaceId ? state.batchResults.length : 0,
  );
}

function latestWorkspaceTaskIds(state: StudioState, workspaceId: string) {
  return state.workspaces.find((entry) => entry.id === workspaceId)?.batchTaskIds ?? [];
}

function mergeHistoryItemData(current: HistoryItem | undefined, incoming: HistoryItem): HistoryItem {
  if (!current) return incoming;
  const merged: HistoryItem = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || value === null) continue;
    const mergedRecord = merged as unknown as Record<string, unknown>;
    const currentValue = mergedRecord[key];
    if (key === "previewOnly" && currentValue === false && value === true) continue;
    if (typeof value === "string" && !value.trim() && typeof currentValue === "string" && currentValue.trim()) {
      continue;
    }
    mergedRecord[key] = value;
  }
  return merged;
}

function sortBatchResultItems(items: HistoryItem[]): HistoryItem[] {
  return [...items].sort((a, b) => {
    const aIndex = Number.isFinite(Number(a.batchIndex)) ? Number(a.batchIndex) : Number.MAX_SAFE_INTEGER;
    const bIndex = Number.isFinite(Number(b.batchIndex)) ? Number(b.batchIndex) : Number.MAX_SAFE_INTEGER;
    return aIndex - bIndex || (a.createdAt ?? 0) - (b.createdAt ?? 0);
  });
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = String(value || "").trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function mergeHistoryItemsById(items: HistoryItem[]): HistoryItem[] {
  const order: string[] = [];
  const byId = new Map<string, HistoryItem>();
  for (const item of items) {
    const id = String(item.id || "").trim();
    if (!id) continue;
    if (!byId.has(id)) order.push(id);
    byId.set(id, mergeHistoryItemData(byId.get(id), item));
  }
  return order.map((id) => byId.get(id)).filter((item): item is HistoryItem => !!item);
}

function completeWorkspaceBatchResults(
  state: StudioState,
  workspaceId: string,
  options: {
    history?: HistoryItem[];
    batchResults?: HistoryItem[];
    include?: HistoryItem[];
  } = {},
): HistoryItem[] {
  const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
  const history = options.history ?? state.history;
  const activeBatchResults = options.batchResults ?? state.batchResults;
  const candidates: HistoryItem[] = [
    ...historyItemsByIds(history, workspace?.batchResultIds ?? []),
  ];
  if (state.activeWorkspaceId === workspaceId) {
    candidates.push(...activeBatchResults);
  }
  if (options.include?.length) candidates.push(...options.include);
  return sortBatchResultItems(mergeHistoryItemsById(candidates));
}

function completeWorkspaceBatchResultIds(
  state: StudioState,
  workspaceId: string,
  batchResults: HistoryItem[],
): string[] {
  const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
  return uniqueStrings([...(workspace?.batchResultIds ?? []), ...batchResults.map((item) => item.id)]);
}

function mergeWorkspaceBatchResult(
  state: StudioState,
  workspaceId: string,
  historyItem: HistoryItem,
  history: HistoryItem[] = state.history,
) {
  const batchResults = completeWorkspaceBatchResults(state, workspaceId, {
    history,
    include: [historyItem],
  });
  return {
    batchResults,
    batchResultIds: uniqueStrings([
      ...completeWorkspaceBatchResultIds(state, workspaceId, batchResults),
      historyItem.id,
    ]),
  };
}

function activeBatchTaskIdsForReset(
  workspaceId: string,
  taskIds: string[],
  tasksById: Record<string, BatchTaskRecord>,
): string[] {
  return sortedBatchTasksForWorkspace(workspaceId, taskIds, tasksById)
    .filter((task) => task.status === "queued" || task.status === "running")
    .map((task) => task.id);
}

function preserveStreamPreviewsForJobs(streamPreviews: StreamPreviewMap, jobIds: string[]) {
  const keep = new Set(jobIds);
  const out: Record<string, any> = {};
  for (const [jobId, preview] of Object.entries(streamPreviews ?? {})) {
    if (keep.has(jobId)) out[jobId] = preview;
  }
  return out;
}

function shouldPreserveBatchSessionForSubmit(
  state: StudioState,
  workspaceId: string,
) {
  const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
  const taskIds = workspace?.batchTaskIds ?? [];
  const resultIds = workspace?.batchResultIds ?? [];
  const hasSession = taskIds.length > 0 || resultIds.length > 0 || (state.activeWorkspaceId === workspaceId && state.batchResults.length > 0);
  return hasSession;
}

function hasActiveGenerationForWorkspace(state: StudioState, workspaceId: string): boolean {
  const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
  const taskIds = workspace?.batchTaskIds ?? [];
  const hasActiveTask = sortedBatchTasksForWorkspace(workspaceId, taskIds, state.batchTasksById)
    .some((task) => (
      task.status === "queued"
      || task.status === "running"
      || task.launchState === "submitting"
      || startingContinuousTaskIds.has(task.id)
    ));
  if (hasActiveTask) return true;
  if (state.activeWorkspaceId === workspaceId && state.runningJobs.length > 0) return true;
  if (Object.values(state.runningJobMeta).some((meta) => meta.workspaceId === workspaceId)) return true;
  return (state.jobGroupsByWorkspace[workspaceId] ?? [])
    .some((group) => group.slots.some((slot) => slot.status === "queued" || slot.status === "running"));
}

function clampBatchSourceSlotIndex(value: unknown, fixedSourceCount: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(Math.max(0, fixedSourceCount), Math.floor(n)));
}

function buildBatchCombinedSourcePaths(
  fixedSourcePaths: string[],
  batchSourcePath: string,
  slotIndex: number,
): string[] {
  const cleanFixed = fixedSourcePaths.map((item) => String(item || "").trim()).filter(Boolean);
  const cleanBatch = String(batchSourcePath || "").trim();
  if (!cleanBatch) return cleanFixed;
  const insertAt = clampBatchSourceSlotIndex(slotIndex, cleanFixed.length);
  return [
    ...cleanFixed.slice(0, insertAt),
    cleanBatch,
    ...cleanFixed.slice(insertAt),
  ];
}

function taskRuntimePatchForWorkspace(
  workspaceId: string,
  taskIds: string[],
  tasksById: Record<string, BatchTaskRecord>,
): WorkspacePatch {
  const tasks = sortedBatchTasksForWorkspace(workspaceId, taskIds, tasksById);
  const runningJobs = tasks
    .filter((task) => task.status === "running" || (task.status === "queued" && !!task.jobId))
    .map((task) => task.jobId)
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return {
    batchTaskIds: taskIds,
    jobsTotal: tasks.length,
    jobsCompleted: tasks.filter((task) => (
      task.status === "succeeded"
      || task.status === "failed"
      || task.status === "cancelled"
      || task.status === "interrupted"
    )).length,
    jobsFailed: tasks.filter((task) => task.status === "failed" || task.status === "interrupted").length,
    runningJobs,
    resultGridOpen: tasks.length > 0 || runningJobs.length > 0,
  };
}

function continuousQueueLimitForState(state: StudioState, apiMode: APIModeValue, apiProfileId?: string): number {
  return effectiveConcurrencyLimitForProfile(state, apiMode, apiProfileId);
}

function isContinuousPoolTask(task: BatchTaskRecord): boolean {
  return task.continuousPoolTask === true;
}

function continuousPoolQueuedTasks(state: StudioState): BatchTaskRecord[] {
  return Object.values(state.batchTasksById)
    .filter((task) => (
      isContinuousPoolTask(task)
      && task.status === "queued"
      && !task.jobId
      && task.launchState !== "submitting"
      && !startingContinuousTaskIds.has(task.id)
    ))
    .sort((a, b) => (
      a.createdAt - b.createdAt
      || a.workspaceId.localeCompare(b.workspaceId)
      || a.slotIndex - b.slotIndex
      || a.id.localeCompare(b.id)
    ));
}

function continuousPoolInFlightByProfile(state: StudioState): Record<string, number> {
  const counts: Record<string, number> = {};
  const taskJobIds = new Set<string>();

  for (const task of Object.values(state.batchTasksById)) {
    const profileId = String(task.apiProfileId || "").trim();
    if (!profileId) continue;
    const inFlight = task.launchState === "submitting"
      || startingContinuousTaskIds.has(task.id)
      || task.status === "running"
      || (task.status === "queued" && !!task.jobId);
    if (!inFlight) continue;
    counts[profileId] = (counts[profileId] ?? 0) + 1;
    if (task.jobId) taskJobIds.add(task.jobId);
  }

  // A cancelled Wails task remains here until backend emits settled:<jobId>.
  // Its BatchTaskRecord is terminal already, so the retained job metadata must
  // still count against the assigned profile's capacity.
  for (const [jobId, meta] of Object.entries(state.runningJobMeta)) {
    const profileId = String(meta.apiProfileId || "").trim();
    if (!profileId || taskJobIds.has(jobId)) continue;
    counts[profileId] = (counts[profileId] ?? 0) + 1;
  }
  return counts;
}

function fhlPoolInFlightTotal(state: StudioState, counts = continuousPoolInFlightByProfile(state)): number {
  const poolProfileIds = new Set(enabledFHLPoolProfiles(state).map((profile) => profile.id));
  let total = 0;
  for (const profileId of poolProfileIds) total += Math.max(0, normalizeConcurrencyLimit(counts[profileId] ?? 0));
  return total;
}

function assignContinuousPoolProfile(
  taskId: string,
  profile: UpstreamProfile,
  taskAPIMode: "images" | "responses",
): boolean {
  const store = useStudioStore;
  const state = store.getState();
  const task = state.batchTasksById[taskId];
  if (!task || !isContinuousPoolTask(task) || task.status !== "queued" || task.jobId || startingContinuousTaskIds.has(task.id)) {
    return false;
  }
  const workspace = state.workspaces.find((entry) => entry.id === task.workspaceId);
  const taskIds = workspace?.batchTaskIds ?? [];
  const assignedTask: BatchTaskRecord = {
    ...task,
    // A queued task owns the transport selected when it was submitted. Do not
    // read the current global mode here: users may switch it while waiting.
    apiMode: taskAPIMode,
    apiProfileId: profile.id,
    apiProfileName: profile.name,
    apiBaseURL: cleanBaseURL(profile.baseURL),
    requestPolicy: profile.requestPolicy,
    imagesNewAPICompat: taskAPIMode === "images" && profile.imagesNewAPICompat === true,
    textModelID: taskAPIMode === "responses" ? FHL_TEXT_MODEL_ID : profile.textModelID,
    imageModelID: profile.imageModelID,
    queuedReason: "continuous_pool",
    updatedAt: Date.now(),
  };
  const batchTasksById = { ...state.batchTasksById, [task.id]: assignedTask };
  const patch = taskRuntimePatchForWorkspace(task.workspaceId, taskIds, batchTasksById);
  store.setState((current) => ({
    batchTasksById,
    workspaces: patchWorkspaceRuntime(current.workspaces, task.workspaceId, patch),
    ...(current.activeWorkspaceId === task.workspaceId ? activeRuntimePatch(patch) : {}),
  } as Partial<StudioState>));
  return true;
}

type ReservedContinuousPoolWave = {
  waveId: string;
  tasks: BatchTaskRecord[];
};

function patchContinuousPoolTasks(
  taskIds: readonly string[],
  update: (task: BatchTaskRecord) => BatchTaskRecord,
) {
  const store = useStudioStore;
  const taskIdSet = new Set(taskIds);
  store.setState((state) => {
    const batchTasksById = { ...state.batchTasksById };
    const affectedWorkspaceIds = new Set<string>();
    for (const taskId of taskIdSet) {
      const task = batchTasksById[taskId];
      if (!task) continue;
      batchTasksById[taskId] = update(task);
      affectedWorkspaceIds.add(task.workspaceId);
    }
    if (affectedWorkspaceIds.size === 0) return {};
    let workspaces = state.workspaces;
    let activePatch: WorkspacePatch = {};
    for (const workspaceId of affectedWorkspaceIds) {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      const patch = taskRuntimePatchForWorkspace(workspaceId, workspace?.batchTaskIds ?? [], batchTasksById);
      workspaces = patchWorkspaceRuntime(workspaces, workspaceId, patch);
      if (state.activeWorkspaceId === workspaceId) activePatch = { ...activePatch, ...activeRuntimePatch(patch) };
    }
    return {
      batchTasksById,
      workspaces,
      ...activePatch,
    } as Partial<StudioState>;
  });
}

function reserveContinuousPoolWave(): ReservedContinuousPoolWave | null {
  const store = useStudioStore;
  const state = store.getState();
  const queue = continuousPoolQueuedTasks(state);
  if (queue.length === 0) return null;
  const capacityMode = fhlTransportModeForState(state);
  const profiles = fhlPoolProfileCapacityProjection(state, capacityMode);
  const totalLimit = fhlPoolTotalCapacity(state, capacityMode);
  if (totalLimit <= 0) return null;
  const plan = planContinuousPoolWave(
    queue,
    profiles,
    continuousPoolInFlightByProfile(state),
    continuousPoolRoundRobinCursor,
    totalLimit,
  );
  if (plan.assignments.length === 0) return null;

  const now = Date.now();
  const waveId = `wave-${cryptoIDFallback()}`;
  const actualProfiles = new Map(enabledFHLPoolProfiles(state).map((profile) => [profile.id, profile]));
  const reservedTasks: BatchTaskRecord[] = [];
  const nextTasksById = { ...state.batchTasksById };
  const affectedWorkspaceIds = new Set<string>();
  for (const assignment of plan.assignments) {
    const task = nextTasksById[assignment.task.id];
    const profile = actualProfiles.get(assignment.profile.id);
    if (!task || !profile || task.status !== "queued" || task.jobId || task.launchState === "submitting") continue;
    const apiMode = task.apiMode === "responses" ? "responses" : "images";
    const reservedTask: BatchTaskRecord = {
      ...task,
      runId: task.runId || waveId,
      apiMode,
      apiProfileId: profile.id,
      apiProfileName: profile.name,
      apiBaseURL: cleanBaseURL(profile.baseURL),
      requestPolicy: profile.requestPolicy,
      imagesNewAPICompat: apiMode === "images" && profile.imagesNewAPICompat === true,
      textModelID: apiMode === "responses" ? FHL_TEXT_MODEL_ID : profile.textModelID,
      imageModelID: profile.imageModelID,
      launchState: "submitting",
      launchAttempt: (task.launchAttempt ?? 0) + 1,
      launchStartedAt: now,
      queuedReason: "continuous_pool",
      errorMessage: undefined,
      updatedAt: now,
    };
    nextTasksById[task.id] = reservedTask;
    reservedTasks.push(reservedTask);
    affectedWorkspaceIds.add(task.workspaceId);
  }
  if (reservedTasks.length === 0) return null;

  continuousPoolRoundRobinCursor = plan.nextCursor;
  store.setState((current) => {
    let workspaces = current.workspaces;
    let activePatch: WorkspacePatch = {};
    for (const workspaceId of affectedWorkspaceIds) {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      const patch = taskRuntimePatchForWorkspace(workspaceId, workspace?.batchTaskIds ?? [], nextTasksById);
      workspaces = patchWorkspaceRuntime(workspaces, workspaceId, patch);
      if (current.activeWorkspaceId === workspaceId) activePatch = { ...activePatch, ...activeRuntimePatch(patch) };
    }
    return {
      batchTasksById: nextTasksById,
      workspaces,
      ...activePatch,
    } as Partial<StudioState>;
  });
  return { waveId, tasks: reservedTasks };
}

function releaseUnavailableContinuousPoolProfiles(profileErrors: ReadonlyMap<string, string>) {
  if (profileErrors.size === 0) return;
  for (const profileId of profileErrors.keys()) unavailableContinuousPoolProfileIds.add(profileId);
  useStudioStore.setState((current) => ({
    fhlPoolEffectiveConcurrencyByProfileId: {
      ...current.fhlPoolEffectiveConcurrencyByProfileId,
      ...Object.fromEntries([...profileErrors.keys()].map((profileId) => [profileId, 0])),
    },
  }));
  const state = useStudioStore.getState();
  const affected = Object.values(state.batchTasksById)
    .filter((task) => (
      task.status === "queued"
      && !task.jobId
      && !!task.apiProfileId
      && profileErrors.has(task.apiProfileId)
    ));
  patchContinuousPoolTasks(affected.map((task) => task.id), (task) => ({
    ...task,
    apiProfileId: undefined,
    apiProfileName: undefined,
    apiBaseURL: undefined,
    launchState: undefined,
    launchStartedAt: undefined,
    queuedReason: "continuous_pool",
    errorMessage: profileErrors.get(String(task.apiProfileId || "")) || "API is unavailable",
    updatedAt: Date.now(),
  }));
  const labels = enabledFHLPoolProfiles(state)
    .filter((profile) => profileErrors.has(profile.id))
    .map((profile) => profile.name)
    .join(", ");
  state.pushToast(`${labels || "FHL API"} is unavailable; queued tasks will use the remaining APIs`, "warn", 5200);
}

function permanentCredentialFailureText(...parts: unknown[]) {
  const text = parts.map((part) => String(part || "")).join("\n");
  if (/content[_ -]?policy|unsafe|safety system/i.test(text)) return false;
  return /\b(?:401|403)\b|unauthorized|forbidden|invalid api key|api key.*invalid|authentication/i.test(text)
    && !/rate[_ -]?limit|too many requests|concurrency limit/i.test(text);
}

function markContinuousPoolProfileUnavailableForTask(task: BatchTaskRecord, reason: string) {
  const profileId = String(task.apiProfileId || "").trim();
  if (!profileId || !task.continuousPoolTask || !permanentCredentialFailureText(reason, task.errorMessage, task.lastLogLine)) return false;
  releaseUnavailableContinuousPoolProfiles(new Map([[profileId, reason || "API credential rejected"]]));
  void requestContinuousPoolPump();
  return true;
}

function browserCredentialForContinuousTask(
  state: StudioState,
  task: BatchTaskRecord,
  apiKey: string,
): BrowserJobSubmitManyCredential | null {
  const profileId = String(task.apiProfileId || "").trim();
  const context = retryContextFromOriginalTask(state, task);
  if (!profileId || !context.activeProfile) return null;
  const baseURL = cleanBaseURL(context.baseURL);
  if (!baseURL) return null;
  return {
    apiProfileId: profileId,
    apiProfileName: task.apiProfileName || context.activeProfile.name,
    apiKey,
    baseURL,
    apiMode: task.apiMode,
    requestPolicy: context.requestPolicy,
    imagesNewAPICompat: context.imagesNewAPICompat,
    textModelID: context.textModelID,
    imageModelID: context.imageModelID,
  };
}

async function submitContinuousPoolWave(wave: ReservedContinuousPoolWave) {
  const store = useStudioStore;
  const keyReadStartedAt = Date.now();
  const profileIds = [...new Set(wave.tasks.map((task) => String(task.apiProfileId || "").trim()).filter(Boolean))];
  const keyResults = await Promise.all(profileIds.map(async (profileId) => {
    const snapshot = store.getState();
    try {
      const apiKey = validateAPIKeyForHeader(await apiKeyForProfileOrState(snapshot, profileId));
      return { profileId, apiKey, error: "" };
    } catch (error: any) {
      return { profileId, apiKey: "", error: error?.message || "API key is unavailable" };
    }
  }));
  const profileErrors = new Map(keyResults.filter((result) => !result.apiKey).map((result) => [result.profileId, result.error]));
  releaseUnavailableContinuousPoolProfiles(profileErrors);

  const latestState = store.getState();
  const cancelledBeforeSubmitIds = wave.tasks
    .filter((reserved) => latestState.batchTasksById[reserved.id]?.status === "cancelled")
    .map((reserved) => reserved.id);
  patchContinuousPoolTasks(cancelledBeforeSubmitIds, (task) => ({
    ...task,
    launchState: undefined,
    launchStartedAt: undefined,
    updatedAt: Date.now(),
  }));
  const keyByProfileId = new Map(keyResults.filter((result) => !!result.apiKey).map((result) => [result.profileId, result.apiKey]));
  const currentTasks = wave.tasks
    .map((reserved) => latestState.batchTasksById[reserved.id])
    .filter((task): task is BatchTaskRecord => (
      !!task
      && task.status === "queued"
      && task.launchState === "submitting"
      && task.launchAttempt === reservedLaunchAttempt(wave.tasks, task.id)
      && !!task.apiProfileId
      && keyByProfileId.has(task.apiProfileId)
    ));
  const credentialByProfileId = new Map<string, BrowserJobSubmitManyCredential>();
  for (const task of currentTasks) {
    const profileId = String(task.apiProfileId || "");
    if (credentialByProfileId.has(profileId)) continue;
    const credential = browserCredentialForContinuousTask(latestState, task, keyByProfileId.get(profileId) || "");
    if (credential) credentialByProfileId.set(profileId, credential);
  }
  const missingContexts = new Map<string, string>();
  for (const task of currentTasks) {
    const profileId = String(task.apiProfileId || "");
    if (!credentialByProfileId.has(profileId)) missingContexts.set(profileId, "API profile context is unavailable");
  }
  releaseUnavailableContinuousPoolProfiles(missingContexts);

  const readyState = store.getState();
  const readyTasks = currentTasks.filter((task) => {
    const current = readyState.batchTasksById[task.id];
    return current?.launchState === "submitting" && !!current.apiProfileId && credentialByProfileId.has(current.apiProfileId);
  }).map((task) => readyState.batchTasksById[task.id]);
  if (readyTasks.length === 0) {
    void requestContinuousPoolPump();
    return;
  }

  const request: BrowserJobSubmitManyRequest = {
    runId: wave.waveId,
    credentials: [...credentialByProfileId.values()],
    tasks: readyTasks.map((task) => ({
      clientTaskId: task.id,
      runId: task.runId,
      workspaceId: task.workspaceId,
      mode: task.mode,
      prompt: task.prompt,
      size: task.size,
      quality: task.quality,
      outputFormat: task.outputFormat,
      seed: Number.isFinite(Number(task.seed)) ? Number(task.seed) : 0,
      negativePrompt: task.negativePrompt || "",
      styleTag: task.styleTag || "",
      sourceImagePaths: task.sourceImagePaths ?? [],
      batchSourcePath: task.batchSourcePath || "",
      batchSourceSlotIndex: task.batchSourceSlotIndex,
      maskB64: task.maskB64 || "",
      apiProfileId: String(task.apiProfileId || ""),
      continuousGenerateTest: true,
      continuousBatchIndex: task.slotIndex,
    })),
  };

  const submitStartedAt = Date.now();
  let response: BrowserJobSubmitManyResponse;
  try {
    response = await submitBrowserJobGroups(request);
  } catch {
    try {
      response = await submitBrowserJobGroups(request);
    } catch (error: any) {
      const message = `Batch proxy submission failed: ${error?.message ?? error}`;
      patchContinuousPoolTasks(readyTasks.map((task) => task.id), (task) => (
        task.status === "cancelled" ? {
          ...task,
          launchState: undefined,
          launchStartedAt: undefined,
          updatedAt: Date.now(),
        } : {
          ...task,
          status: "queued",
          launchState: undefined,
          launchStartedAt: undefined,
          queuedReason: "continuous_pool",
          errorMessage: message,
          updatedAt: Date.now(),
        }
      ));
      store.getState().pushToast("Batch task proxy is unavailable; tasks remain queued", "error", 5200);
      return;
    }
  }

  const resultByTaskId = new Map(response.results.map((result) => [result.clientTaskId, result]));
  const successfulGroups: JobGroupSnapshot[] = [];
  const cancelledJobIds: string[] = [];
  const cancelledTaskIds: string[] = [];
  const failedTaskMessages = new Map<string, string>();
  const missingTaskIds: string[] = [];
  for (const task of readyTasks) {
    const result = resultByTaskId.get(task.id);
    if (!result) {
      missingTaskIds.push(task.id);
      continue;
    }
    if (!result.ok || !result.group) {
      failedTaskMessages.set(task.id, result.error || "Task registration failed");
      continue;
    }
    const currentTask = store.getState().batchTasksById[task.id];
    if (currentTask?.status === "cancelled") {
      cancelledTaskIds.push(task.id);
      cancelledJobIds.push(...result.group.slots.map((slot) => slot.jobId));
    }
    successfulGroups.push(result.group);
  }

  for (const group of successfulGroups) applyBrowserJobGroupToStore(group);
  patchContinuousPoolTasks(cancelledTaskIds, (task) => ({
    ...task,
    launchState: undefined,
    launchStartedAt: undefined,
    updatedAt: Date.now(),
  }));
  patchContinuousPoolTasks([...failedTaskMessages.keys()], (task) => (
    task.status === "cancelled" ? {
      ...task,
      launchState: undefined,
      launchStartedAt: undefined,
      updatedAt: Date.now(),
    } : {
      ...task,
      status: "failed",
      launchState: undefined,
      launchStartedAt: undefined,
      queuedReason: undefined,
      errorMessage: failedTaskMessages.get(task.id) || "Task registration failed",
      lastLogLine: failedTaskMessages.get(task.id) || "Task registration failed",
      updatedAt: Date.now(),
    }
  ));
  patchContinuousPoolTasks(missingTaskIds, (task) => (
    task.status === "cancelled" ? {
      ...task,
      launchState: undefined,
      launchStartedAt: undefined,
      updatedAt: Date.now(),
    } : {
      ...task,
      status: "queued",
      launchState: undefined,
      launchStartedAt: undefined,
      queuedReason: "continuous_pool",
      errorMessage: "Batch proxy returned no result for this task",
      updatedAt: Date.now(),
    }
  ));
  syncBrowserJobSubscriptions(store.getState().jobGroupsByWorkspace);
  if (cancelledJobIds.length > 0) void cancelBrowserJobs(cancelledJobIds);
  for (const group of successfulGroups) {
    scheduleAutoRetriesForBrowserGroup(group);
    for (const slot of group.slots) {
      if (slot.status === "succeeded") {
        void syncHistoryItemFromBrowserJobSlot(group, slot, { updateWorkspaceSelection: true });
      }
    }
  }
  if (import.meta.env.DEV) {
    console.info("[continuous-pool] wave submitted", {
      taskCount: readyTasks.length,
      profileCount: credentialByProfileId.size,
      keyReadMs: submitStartedAt - keyReadStartedAt,
      submitMs: Date.now() - submitStartedAt,
    });
  }
  void requestContinuousPoolPump();
}

function reservedLaunchAttempt(tasks: readonly BatchTaskRecord[], taskId: string) {
  return tasks.find((task) => task.id === taskId)?.launchAttempt;
}

async function pumpContinuousPoolQueuePass(): Promise<void> {
  const store = useStudioStore;
  const initialState = store.getState();
  const initialQueue = continuousPoolQueuedTasks(initialState);
  if (initialQueue.length === 0) return;
  if (!isAndroidTaskProxyMode() && shouldUseBackgroundTaskProxyForSubmit(initialQueue[0].apiMode)) {
    const wave = reserveContinuousPoolWave();
    if (wave) await submitContinuousPoolWave(wave);
    return;
  }

  while (true) {
      const state = store.getState();
      const queue = continuousPoolQueuedTasks(state);
      if (queue.length === 0) return;

      const inFlightByProfileId = continuousPoolInFlightByProfile(state);
      const taskAPIModeForCapacity = fhlTransportModeForState(state);
      const totalLimit = fhlPoolTotalCapacity(state, taskAPIModeForCapacity);
      if (totalLimit <= 0 || fhlPoolInFlightTotal(state, inFlightByProfileId) >= totalLimit) return;
      const poolProfiles = enabledFHLPoolProfiles(state);
      const profilesWithEffectiveCapacity = fhlPoolProfileCapacityProjection(state, taskAPIModeForCapacity);

      let taskToStart: BatchTaskRecord | null = null;
      let profileToUse: UpstreamProfile | null = null;
      let nextCursor = continuousPoolRoundRobinCursor;
      let needsAssignment = false;

      for (const task of queue) {
        const assignedProfileId = String(task.apiProfileId || "").trim();
        if (assignedProfileId) {
          const profile = poolProfiles.find((entry) => entry.id === assignedProfileId) ?? null;
          if (!profile) continue;
          const limit = fhlPoolSlotConcurrencyLimit(state, task.apiMode, profile.id);
          if (limit <= 0 || (inFlightByProfileId[profile.id] ?? 0) >= limit) continue;
          taskToStart = task;
          profileToUse = profile;
          break;
        }

        const selection = selectNextContinuousPoolProfile(
          profilesWithEffectiveCapacity,
          inFlightByProfileId,
          continuousPoolRoundRobinCursor,
        );
        if (!selection.profile) continue;
        taskToStart = task;
        profileToUse = poolProfiles.find((entry) => entry.id === selection.profile?.id) ?? null;
        nextCursor = selection.nextCursor;
        needsAssignment = true;
        break;
      }

      if (!taskToStart || !profileToUse) return;
      if (needsAssignment) {
        continuousPoolRoundRobinCursor = nextCursor;
        const taskAPIMode = taskToStart.apiMode === "responses" ? "responses" : "images";
        if (!assignContinuousPoolProfile(taskToStart.id, profileToUse, taskAPIMode)) continue;
      }
      await startContinuousQueuedTask(taskToStart.id);
  }
}

function requestContinuousPoolPump(): Promise<void> {
  continuousPoolPumpRequested = true;
  if (!continuousPoolPumpPromise) {
    continuousPoolPumpPromise = (async () => {
      try {
        while (continuousPoolPumpRequested) {
          continuousPoolPumpRequested = false;
          await pumpContinuousPoolQueuePass();
        }
      } finally {
        continuousPoolPumpPromise = null;
      }
    })();
  }
  return continuousPoolPumpPromise;
}

function markWorkspaceTasks(
  workspaceId: string,
  taskIds: string[],
  tasksById: Record<string, BatchTaskRecord>,
  predicate: (task: BatchTaskRecord) => boolean,
  patch: Partial<BatchTaskRecord>,
) {
  let changed = false;
  const now = Date.now();
  const next = { ...tasksById };
  for (const task of sortedBatchTasksForWorkspace(workspaceId, taskIds, tasksById)) {
    if (!predicate(task)) continue;
    next[task.id] = {
      ...task,
      ...patch,
      updatedAt: patch.updatedAt ?? now,
    };
    changed = true;
  }
  return changed ? next : tasksById;
}

function retryHistoryByIdForState(state: StudioState) {
  return new Map([...state.batchResults, ...state.history].map((item) => [item.id, item]));
}

function autoRetryReasonForTask(
  task: BatchTaskRecord,
  historyById: ReturnType<typeof retryHistoryByIdForState>,
): string {
  if (task.status === "succeeded" && !batchTaskHasResult(task, historyById)) return "Missing final image";
  if (task.status === "failed" || task.status === "interrupted") {
    return String(task.errorMessage || task.lastLogLine || "Generation failed");
  }
  return "";
}

function scheduleAutoRetryForTask(task: BatchTaskRecord, reasonOverride?: string) {
  const state = useStudioStore.getState();
  const workspace = state.workspaces.find((entry) => entry.id === task.workspaceId);
  const taskIds = workspace?.batchTaskIds ?? [];
  if (!taskIds.includes(task.id)) return;
  const historyById = retryHistoryByIdForState(state);
  if (!isRetryableBatchTask(task, historyById)) return;
  const reason = String(reasonOverride || autoRetryReasonForTask(task, historyById) || "").trim();
  if (markContinuousPoolProfileUnavailableForTask(task, reason)) return;
  if (!isTransientGenerationFailureText(reason, task.errorMessage, task.lastLogLine)) return;

  const reducedLimit = recordTransientFailureForTask(task, reason);
  if (reducedLimit !== null) {
    state.pushToast(`Upstream repeated temporary failures; current API concurrency temporarily reduced to ${reducedLimit} for 10 minutes`, "warn", 5200);
  }
  if ((task.autoRetryCount ?? 0) >= AUTO_RETRY_MAX_COUNT) return;
  if (autoRetryTimersByTaskId.has(task.id)) return;

  const scheduledAt = Date.now() + AUTO_RETRY_DELAY_MS;
  const scheduledTasksById: Record<string, BatchTaskRecord> = {
    ...state.batchTasksById,
    [task.id]: {
      ...task,
      autoRetryScheduledAt: scheduledAt,
      autoRetryReason: reason,
      updatedAt: Date.now(),
    },
  };
  const patch = taskRuntimePatchForWorkspace(task.workspaceId, taskIds, scheduledTasksById);
  useStudioStore.setState((current) => ({
    batchTasksById: scheduledTasksById,
    workspaces: patchWorkspaceRuntime(current.workspaces, task.workspaceId, patch),
    ...(current.activeWorkspaceId === task.workspaceId ? activeRuntimePatch(patch) : {}),
  } as Partial<StudioState>));
  state.pushToast("Upstream timeout or busy; auto retry will run once after 15 seconds", "info", 3200);

  const timer = setTimeout(() => {
    autoRetryTimersByTaskId.delete(task.id);
    const latestState = useStudioStore.getState();
    const latestTask = latestState.batchTasksById[task.id];
    if (!latestTask || latestTask.autoRetryScheduledAt !== scheduledAt) return;
    const latestWorkspace = latestState.workspaces.find((entry) => entry.id === latestTask.workspaceId);
    const latestTaskIds = latestWorkspace?.batchTaskIds ?? [];
    const latestHistoryById = retryHistoryByIdForState(latestState);
    if (!latestTaskIds.includes(latestTask.id) || !isRetryableBatchTask(latestTask, latestHistoryById)) return;
    const failoverProfile = nextFHLPoolProfileForMultiReferenceRetry(latestState, latestTask);
    const retryTask = failoverProfile
      ? {
          ...latestTask,
          apiProfileId: failoverProfile.id,
          apiProfileName: failoverProfile.name,
          apiBaseURL: cleanBaseURL(failoverProfile.baseURL),
          requestPolicy: failoverProfile.requestPolicy,
          imagesNewAPICompat: failoverProfile.imagesNewAPICompat === true,
          textModelID: failoverProfile.textModelID,
          imageModelID: failoverProfile.imageModelID,
        }
      : latestTask;
    const retryTasksById: Record<string, BatchTaskRecord> = {
      ...latestState.batchTasksById,
      [latestTask.id]: {
        ...retryTask,
        autoRetryCount: (latestTask.autoRetryCount ?? 0) + 1,
        autoRetryScheduledAt: undefined,
        updatedAt: Date.now(),
      },
    };
    const retryPatch = taskRuntimePatchForWorkspace(latestTask.workspaceId, latestTaskIds, retryTasksById);
    useStudioStore.setState((current) => ({
      batchTasksById: retryTasksById,
      workspaces: patchWorkspaceRuntime(current.workspaces, latestTask.workspaceId, retryPatch),
      ...(current.activeWorkspaceId === latestTask.workspaceId ? activeRuntimePatch(retryPatch) : {}),
    } as Partial<StudioState>));
    if (failoverProfile) {
      useStudioStore.getState().pushToast(
        `原 FHL API 暂时不可用，正在改用 ${failoverProfile.name} 重试这次多参考图任务`,
        "info",
        3600,
      );
    }
    void useStudioStore.getState().retryBatchTask(latestTask.id, { automatic: true, useTaskProfile: true });
  }, AUTO_RETRY_DELAY_MS);
  autoRetryTimersByTaskId.set(task.id, timer);
}

function scheduleAutoRetriesForBrowserGroup(group: JobGroupSnapshot) {
  for (const slot of group.slots) {
    const missingFinalImage = slot.status === "succeeded" && !String(slot.savedPath || "").trim();
    if (slot.status !== "failed" && slot.status !== "interrupted" && !missingFinalImage) continue;
    const state = useStudioStore.getState();
    const task = Object.values(state.batchTasksById).find((entry) => (
      entry.workspaceId === group.workspaceId
      && (
        entry.id === group.clientTaskId
        || entry.jobId === slot.jobId
        || entry.slotIndex === slotIndexForGroupSlot(group, slot)
      )
    ));
    if (task) scheduleAutoRetryForTask(task, missingFinalImage ? "Missing final image" : (slot.errorMessage || task.errorMessage || slot.stage || "Generation failed"));
  }
}

async function startContinuousQueuedTask(taskId: string): Promise<boolean> {
  const store = useStudioStore;
  if (startingContinuousTaskIds.has(taskId)) return false;
  const s = store.getState();
  const task = s.batchTasksById[taskId];
  if (!task || task.status !== "queued" || task.jobId) return false;
  startingContinuousTaskIds.add(taskId);
  const workspaceId = task.workspaceId;
  const failQueuedStart = (message: string) => {
    const current = store.getState();
    const currentTask = current.batchTasksById[task.id] ?? task;
    if (currentTask.status === "cancelled") {
      startingContinuousTaskIds.delete(taskId);
      return false;
    }
    const workspace = current.workspaces.find((entry) => entry.id === workspaceId);
    const taskIds = workspace?.batchTaskIds ?? [];
    const failedTasksById = {
      ...current.batchTasksById,
      [task.id]: {
        ...currentTask,
        status: "failed" as const,
        queuedReason: undefined,
        queuePriority: undefined,
        updatedAt: Date.now(),
        errorMessage: message,
        lastLogLine: message,
      },
    };
    const failedPatch: WorkspacePatch = {
      ...taskRuntimePatchForWorkspace(workspaceId, taskIds, failedTasksById),
      errorMessage: message,
      errorRawPath: null,
      progress: null,
      streamPreview: null,
      streamPreviews: {},
      resultGridOpen: true,
      historyGalleryOpen: false,
    };
    store.setState((state) => ({
      batchTasksById: failedTasksById,
      workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, failedPatch),
      ...(state.activeWorkspaceId === workspaceId ? { ...activeRuntimePatch(failedPatch), resultGridOpen: true, historyGalleryOpen: false } : {}),
    } as Partial<StudioState>));
    store.getState().pushToast(message, "error", 4600);
    scheduleAutoRetryForTask(failedTasksById[task.id], message);
    startingContinuousTaskIds.delete(taskId);
    return false;
  };
  const taskContext = retryContextFromOriginalTask(s, task);
  if (task.apiProfileId && !taskContext.activeProfile) {
    return failQueuedStart("Missing API profile for the queued task");
  }
  const taskAPIKey = await apiKeyForProfileOrState(s, task.apiProfileId);
  let cleanedAPIKey = "";
  if (providerRequiresDirectAPIKey(task.apiMode)) {
    try {
      cleanedAPIKey = validateAPIKeyForHeader(taskAPIKey);
    } catch (error: any) {
      const message = error?.message ?? "API key format invalid";
      return failQueuedStart(message);
    }
  }
  const cleanedBaseURL = cleanBaseURL(taskContext.baseURL);
  if (!cleanedBaseURL) {
    return failQueuedStart("Base URL is required for the queued task");
  }
  if (!shouldUseBackgroundTaskProxyForSubmit(task.apiMode)) {
    const latestTask = store.getState().batchTasksById[taskId];
    if (!latestTask || latestTask.status !== "queued" || latestTask.jobId) {
      startingContinuousTaskIds.delete(taskId);
      return false;
    }
    const batchProcessLink = batchProcessLinkFromTask(task);
    if (task.batchOutputMode && !batchProcessLink) {
      return failQueuedStart("Missing batch process context for queued retry task");
    }
    const sources = task.mode === "edit" ? sourceImagesFromPaths(task.sourceImagePaths) : [];
    const directPayload: RuntimeGenerateOptions = {
      apiKey: cleanedAPIKey,
      mode: task.mode,
      requestedJobId: "",
      prompt: task.prompt,
      size: task.size,
      quality: task.quality,
      outputFormat: task.outputFormat,
      imagePaths: task.sourceImagePaths ?? [],
      imagePath: "",
      maskB64: task.maskB64 || "",
      seed: Number.isFinite(Number(task.seed)) ? Number(task.seed) : 0,
      negativePrompt: task.negativePrompt || "",
      baseURL: cleanedBaseURL,
      textModelID: taskContext.textModelID,
      imageModelID: taskContext.imageModelID,
      proxyMode: s.proxyMode,
      proxyURL: s.proxyURL,
      requestPolicy: taskContext.requestPolicy,
      apiMode: task.apiMode,
      apiProfileId: task.apiProfileId || "",
      imagesNewAPICompat: taskContext.imagesNewAPICompat,
      noPromptRevision: true,
      concurrencyLimit: taskContext.concurrencyLimit,
      partialImages: 1,
      sourceImages: task.mode === "edit" ? sources : undefined,
    };
    void launchOneJob(task.mode, directPayload, {
      workspaceId,
      apiMode: task.apiMode,
      apiProfileId: task.apiProfileId,
      apiProfileName: task.apiProfileName,
      batchIndex: task.slotIndex,
      size: task.size,
      quality: task.quality,
      outputFormat: task.outputFormat,
      sources,
      currentImage: null,
      styleTag: task.styleTag || "",
      continuousGenerateTest: true,
      batchProcessLink,
    }, {
      onSettled: () => {
        if (task.continuousPoolTask) {
          void requestContinuousPoolPump();
          return;
        }
        void pumpContinuousQueue(workspaceId, task.apiMode);
      },
    });
    startingContinuousTaskIds.delete(taskId);
    return true;
  }
  const submitJobGroup = isAndroidTaskProxyMode() ? submitAndroidJobGroup : submitBrowserJobGroup;
  const optimisticState = store.getState();
  const optimisticTask = optimisticState.batchTasksById[taskId];
  const optimisticWorkspace = optimisticState.workspaces.find((entry) => entry.id === workspaceId);
  const optimisticTaskIds = optimisticWorkspace?.batchTaskIds ?? [];
  if (!optimisticTask || optimisticTask.status !== "queued" || optimisticTask.jobId) {
    startingContinuousTaskIds.delete(taskId);
    return false;
  }
  const optimisticTasksById: Record<string, BatchTaskRecord> = {
    ...optimisticState.batchTasksById,
    [taskId]: {
      ...optimisticTask,
      status: "running",
      queuedReason: undefined,
      queuePriority: undefined,
      updatedAt: Date.now(),
    },
  };
  const optimisticPatch: WorkspacePatch = {
    ...taskRuntimePatchForWorkspace(workspaceId, optimisticTaskIds, optimisticTasksById),
    resultGridOpen: true,
    historyGalleryOpen: false,
  };
  store.setState((state) => ({
    batchTasksById: optimisticTasksById,
    workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, optimisticPatch),
    ...(state.activeWorkspaceId === workspaceId ? {
      ...activeRuntimePatch(optimisticPatch),
      resultGridOpen: true,
      historyGalleryOpen: false,
    } : {}),
  } as Partial<StudioState>));
  try {
    const response = await submitJobGroup({
      workspaceId,
      mode: task.mode,
      prompt: task.prompt,
      size: task.size,
      quality: task.quality,
      outputFormat: task.outputFormat,
      batchCount: 1,
      seed: Number.isFinite(Number(task.seed)) ? Number(task.seed) : 0,
      negativePrompt: task.negativePrompt || "",
      styleTag: task.styleTag || "",
      sourceImagePaths: task.sourceImagePaths ?? [],
      batchSourcePath: task.batchSourcePath || "",
      batchSourceSlotIndex: task.batchSourceSlotIndex,
      maskB64: task.maskB64 || "",
      apiKey: cleanedAPIKey,
      baseURL: cleanedBaseURL,
      apiMode: task.apiMode,
      apiProfileId: task.apiProfileId,
      apiProfileName: task.apiProfileName,
      requestPolicy: taskContext.requestPolicy,
      imagesNewAPICompat: taskContext.imagesNewAPICompat,
      textModelID: taskContext.textModelID,
      imageModelID: taskContext.imageModelID,
      continuousGenerateTest: true,
      continuousBatchIndex: task.slotIndex,
    });
    const nextJobGroupsByWorkspace = mergeWorkspaceJobGroup(store.getState().jobGroupsByWorkspace, response.group);
    const nextWorkspace = store.getState().workspaces.find((entry) => entry.id === workspaceId);
    const batchTasksById = updateTasksFromJobGroup(
      store.getState().batchTasksById,
      nextWorkspace?.batchTaskIds ?? [],
      response.group,
    );
    const browserPatch = browserRuntimePatchFromGroups(nextJobGroupsByWorkspace[workspaceId] ?? [], true);
    const taskPatch = taskRuntimePatchForWorkspace(workspaceId, nextWorkspace?.batchTaskIds ?? [], batchTasksById);
    const runtimePatch = { ...browserPatch, ...taskPatch, resultGridOpen: true, historyGalleryOpen: false };
    const runningJobMeta = buildRunningJobMetaFromBrowserGroups(nextJobGroupsByWorkspace);
    store.setState((state) => ({
      jobGroupsByWorkspace: nextJobGroupsByWorkspace,
      batchTasksById,
      runningJobMeta,
      workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, runtimePatch),
      ...(state.activeWorkspaceId === workspaceId ? { ...activeRuntimePatch(runtimePatch), resultGridOpen: true, historyGalleryOpen: false } : {}),
    } as Partial<StudioState>));
    syncBrowserJobSubscriptions(nextJobGroupsByWorkspace);
    scheduleAutoRetriesForBrowserGroup(response.group);
    startingContinuousTaskIds.delete(taskId);
    return true;
  } catch (error: any) {
    return failQueuedStart(`提交失败:${error?.message ?? error}`);
  }
}

async function pumpContinuousQueue(workspaceId: string, apiMode: APIModeValue) {
  const store = useStudioStore;
  let started = 0;
  while (true) {
    const state = store.getState();
    const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
    if (!workspace) break;
    const taskIds = workspace.batchTaskIds ?? [];
    const queue = localQueuedTasksForWorkspace(workspaceId, taskIds, state.batchTasksById)
      .filter((task) => task.apiMode === apiMode);
    if (queue.length === 0) break;
    const next = queue.find((task) => {
      const limit = continuousQueueLimitForState(state, apiMode, task.apiProfileId);
      if (limit <= 0) return false;
      const profileId = String(task.apiProfileId || "").trim();
      const active = profileId
        ? (continuousPoolInFlightByProfile(state)[profileId] ?? 0)
        : runningOrSubmittedTaskCountForWorkspace(
          workspaceId,
          taskIds,
          state.batchTasksById,
          apiMode,
          undefined,
          startingContinuousTaskIds,
        );
      return limit - active > 0;
    });
    if (!next) break;
    const ok = await startContinuousQueuedTask(next.id);
    if (ok) started += 1;
    if (!ok) break;
  }
  if (started > 0) {
    const state = store.getState();
    const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
    if (workspace && state.activeWorkspaceId === workspaceId) {
      const patch = taskRuntimePatchForWorkspace(workspaceId, workspace.batchTaskIds ?? [], state.batchTasksById);
      store.setState({
        ...activeRuntimePatch(patch),
        workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, patch),
      });
    }
  }
}

async function submitCurrentRequest(
  get: () => StudioState,
  set: (patch: Partial<StudioState> | ((state: StudioState) => Partial<StudioState>)) => void,
): Promise<void> {
  const s = get();
  const batchProcess = normalizeBatchProcessConfig(s.batchProcess);
  const requestedBatchProcessMode = s.mode === "edit" && s.editSourceMode === "batch";
  const hasBatchQueueSources = batchProcess.discoveredSources.length > 0;
  const hasManualEditFallbackSource = s.sources.length > 0 || !!s.currentImage;
  const batchProcessMode = requestedBatchProcessMode && (hasBatchQueueSources || !hasManualEditFallbackSource);
  const fallbackToManualEditFromEmptyBatch = requestedBatchProcessMode && !hasBatchQueueSources && hasManualEditFallbackSource;
  const continuousGenerateTest = s.continuousGenerateTest === true && !batchProcessMode;
  const activeProfile = s.profiles.find((profile) => profile.id === s.activeProfileId);
  const activeProfileUsesFHLTransport = isOfficialFHLTransportProfile(
    activeProfile,
    s.baseURL,
    activeProfile?.apiMode ?? s.apiMode,
  );
  const enabledFHLPool = enabledFHLPoolProfiles(s);
  const hasEnabledFHLPool = enabledFHLPool.length > 0;
  const firstContinuousFHLPoolProfile = continuousGenerateTest ? enabledFHLPool[0] : undefined;
  const batchUsesFHLPool = batchProcessMode && activeProfileUsesFHLTransport && hasEnabledFHLPool;
  const fhlPoolSubmit = continuousGenerateTest || batchUsesFHLPool;
  const fhlPoolTaskCount = fhlPoolTotalCapacity(s, fhlTransportModeForState(s));
  if (!continuousGenerateTest && !batchProcessMode && hasActiveGenerationForWorkspace(s, s.activeWorkspaceId)) {
    const message = "当前已有任务正在生成。连续生成模式关闭时不会并发提交，避免误点后重复扣费。";
    set({ errorMessage: message, errorRawPath: null });
    s.pushToast(message, "warn", 4200);
    return;
  }
  if (!fhlPoolSubmit && !currentProviderHasRequiredKey(s)) {
    set({ errorMessage: "请填写 API Key", errorRawPath: null });
    return;
  }

  let cleanedAPIKey = "";
  if (!fhlPoolSubmit && providerRequiresDirectAPIKey(s.apiMode)) {
    try {
    cleanedAPIKey = validateAPIKeyForHeader(s.apiKey);
  } catch (error: any) {
    set({ errorMessage: error?.message ?? "API Key 格式不正确", errorRawPath: null });
    return;
  }
  if (cleanedAPIKey !== s.apiKey) {
    const activeId = s.activeProfileId;
    set({ apiKey: cleanedAPIKey });
      if (activeId) {
        try { await SetStoredAPIKey(keyringUserFor(activeId), cleanedAPIKey); } catch {}
      }
    }
  }

  if (!s.prompt.trim()) {
    set({ errorMessage: "Prompt is required", errorRawPath: null });
    get().pushToast("Prompt is required", "warn", 2600);
    return;
  }

  const effectivePrompt = buildEffectivePrompt(s.promptPrefix, s.prompt);
  if (!effectivePrompt) {
    set({ errorMessage: "Prompt is required after prompt prefix merge", errorRawPath: null });
    return;
  }
  if (!fhlPoolSubmit && !s.baseURL.trim()) {
    set({ errorMessage: "请填写 Base URL", errorRawPath: null });
    return;
  }

  const cleanedBaseURL = fhlPoolSubmit ? "" : cleanBaseURL(s.baseURL);
  let batchSelectedSources = batchProcessMode
    ? batchProcess.discoveredSources.filter((source) => source.selected !== false)
    : [];
  let batchFixedSources = batchProcessMode ? s.sources : [];
  const batchSourceSlotIndex = batchProcessMode
    ? clampBatchSourceSlotIndex(batchProcess.batchSourceSlotIndex, batchFixedSources.length)
    : 0;
  const batchCount = batchProcessMode
    ? batchSelectedSources.length
    : (continuousGenerateTest ? 1 : normalizeBatchCount(s.batchCount));
  const effectiveAPIMode = fhlPoolSubmit
    ? fhlTransportModeForState(s)
    : effectiveAPIModeForSubmit(s, activeProfile, activeProfile?.apiMode ?? s.apiMode);
  const effectiveTextModelID = activeProfileUsesFHLTransport && effectiveAPIMode === "responses"
    ? FHL_TEXT_MODEL_ID
    : s.textModelID;
  const effectiveImagesNewAPICompat = effectiveAPIMode === "images" && s.imagesNewAPICompat === true;
  const concurrencyLimit = continuousGenerateTest && firstContinuousFHLPoolProfile
    ? fhlPoolSlotConcurrencyLimit(s, effectiveAPIMode, firstContinuousFHLPoolProfile.id)
    : fhlPoolSubmit
      ? fhlPoolTaskCount
      : effectiveConcurrencyLimitForProfile(s, effectiveAPIMode, activeProfile?.id || s.activeProfileId);
  const apiProfileSnapshot: { apiProfileId?: string; apiProfileName?: string } = continuousGenerateTest
    ? apiProfileSnapshotForSubmit(firstContinuousFHLPoolProfile, firstContinuousFHLPoolProfile?.id ?? "")
    : batchUsesFHLPool
      ? {}
      : apiProfileSnapshotForSubmit(activeProfile, s.activeProfileId);
  const autoAspectInput = autoAspectSizeInputFromState(s);
  const activeCount = fhlPoolSubmit
    ? fhlPoolInFlightTotal(s)
    : workspaceRunningCount(s, effectiveAPIMode, apiProfileSnapshot.apiProfileId);

  if (continuousGenerateTest && !hasEnabledFHLPool) {
    const message = "Continuous generation requires at least one enabled FHL API slot in the pool";
    set({ errorMessage: message, errorRawPath: null });
    get().pushToast(message, "warn", 4200);
    return;
  }
  if (continuousGenerateTest && concurrencyLimit <= 0) {
    const message = "API 1 has no available FHL concurrency capacity";
    set({ errorMessage: message, errorRawPath: null });
    get().pushToast(message, "warn", 4200);
    return;
  }

  if (batchProcessMode) {
    if (batchProcess.discoveredSources.length === 0) {
      const message = "批量图生图队列为空。请点击参考图栏右侧的批量图片按钮加入图片，或关闭批量图生图开关后按普通图生图生成。";
      set({
        errorMessage: message,
        errorRawPath: null,
      });
      get().pushToast(message, "warn", 4200);
      return;
    }
    if (batchSelectedSources.length === 0) {
      const message = "请至少选择一张批量图生图源图。";
      set({ errorMessage: message, errorRawPath: null });
      get().pushToast(message, "warn", 3200);
      return;
    }
    if (batchProcess.outputMode === "custom_dir" && !batchProcess.outputDir.trim()) {
      set({ errorMessage: "Please choose a batch output folder", errorRawPath: null });
      return;
    }
    if (concurrencyLimit <= 0) {
      set({
        errorMessage: "Current API concurrency is temporarily limited to 0; please wait and retry",
        errorRawPath: null,
      });
      return;
    }
  } else if (concurrencyLimit > 0 && !continuousGenerateTest) {
    const available = concurrencyLimit - activeCount;
    if (available < batchCount) {
      const apiLabel = apiModeLabel(effectiveAPIMode);
      set({
        errorMessage: `${apiLabel} concurrency limit is ${concurrencyLimit}; only ${Math.max(0, available)} slots are available, but ${batchCount} tasks were requested`,
        errorRawPath: null,
      });
      return;
    }
  }

  if (batchProcessMode && shouldUseBackgroundTaskProxyForSubmit(effectiveAPIMode)) {
    const materializedBatch = await materializeBatchSourcesForBrowserProxy(batchSelectedSources, batchFixedSources);
    if (!materializedBatch.ok) {
      const message = `批量图源 ${materializedBatch.failedLabel} 无法写入本地输入目录，请重新选择图片或重启测试模式后再试`;
      set({ errorMessage: message, errorRawPath: null });
      get().pushToast(message, "error", 5200);
      return;
    }
    if (materializedBatch.changed) {
      const materializedSelectedByPath = new Map(
        batchSelectedSources.map((source, index) => [source.path, materializedBatch.selectedSources[index]]),
      );
      batchSelectedSources = materializedBatch.selectedSources;
      batchFixedSources = materializedBatch.fixedSources;
      set({
        sources: batchFixedSources,
        batchProcess: {
          ...batchProcess,
          discoveredSources: batchProcess.discoveredSources.map((source) => {
            const nextSource = materializedSelectedByPath.get(source.path);
            return nextSource ? { ...nextSource, selected: source.selected } : source;
          }),
        },
      });
    }
    if (
      batchSelectedSources.some((source) => isVirtualImagePath(source.path))
      || batchFixedSources.some((source) => isVirtualImagePath(source.path))
    ) {
      const message = "批量图源仍包含无法给后台任务读取的内存图片，请重新选择图片后再试";
      set({ errorMessage: message, errorRawPath: null });
      get().pushToast(message, "error", 5200);
      return;
    }
  }

  let editSourcePaths: string[] = [];
  let preparedSources = recoverPanoramaSourceMetadata(s.sources, s.history);
  if (preparedSources !== s.sources) {
    set((state) => ({
      sources: preparedSources,
      workspaces: patchWorkspaceRuntime(state.workspaces, state.activeWorkspaceId, {
        sources: preparedSources,
      }),
    }));
  }
  let materializedImplicitCurrentImage: RetryAutoAspectSource | null = null;
  if (fallbackToManualEditFromEmptyBatch) {
    get().pushToast("批量队列为空，已按普通图生图使用当前参考图提交。", "info", 2600);
  }
  if (s.mode === "edit" && !batchProcessMode) {
    if (shouldUseBackgroundTaskProxyForSubmit(effectiveAPIMode)) {
      const materializedSources = await materializeEditSourcesForBrowserProxy(preparedSources);
      if (materializedSources !== preparedSources) {
        preparedSources = materializedSources;
        set({ sources: materializedSources });
      }
    }
    editSourcePaths = preparedSources.map((src) => src.path).filter(Boolean);
    if (editSourcePaths.length === 0 && s.currentImage) {
      const materialized = await materializeHistoryItem(s.currentImage).catch(() => null);
      if (materialized?.savedPath) {
        editSourcePaths = [materialized.savedPath];
        materializedImplicitCurrentImage = implicitEditAutoAspectSource(materialized);
      }
    }
    if (shouldUseBackgroundTaskProxyForSubmit(effectiveAPIMode) && editSourcePaths.some((filePath) => isVirtualImagePath(filePath))) {
      set({
        errorMessage: "Edit sources still contain virtual images that cannot be sent as input files",
        errorRawPath: null,
      });
      return;
    }
    if (editSourcePaths.length === 0) {
      const platform = readRuntimePlatformState();
      set({
        errorMessage: platform.isAndroid
          ? "Select or paste a source image before running edit mode on Android"
          : "Select, paste, or drag a source image before running edit mode",
        errorRawPath: null,
      });
      return;
    }
  }

  let resolvedSize = normalizeSizeSelection(s.size, {
    apiMode: effectiveAPIMode,
    requestPolicy: autoAspectInput.requestPolicy,
    imageModelID: autoAspectInput.imageModelID,
    mode: s.mode,
  });
  const batchAutoSizes: Array<SizeValue | null> = [];
  const editAutoAspectResolution = normalizeAutoAspectResolutionValue(batchProcess.autoAspectResolution);
  const editAutoAspectEnabled = s.mode === "edit" && !!editAutoAspectResolution && (batchProcessMode || !s.editAutoAspectUserLocked);
  if (editAutoAspectEnabled && !batchProcessMode) {
    const primarySource = preparedSources[0]
      ?? materializedImplicitCurrentImage
      ?? implicitEditAutoAspectSource(s.currentImage);
    const autoSize = primarySource
      ? await buildAutoAspectSizeForSource(editAutoAspectResolution, primarySource, autoAspectInput)
      : null;
    if (!autoSize) {
      set({ errorMessage: "Auto-aspect could not read the selected source image ratio", errorRawPath: null });
      get().pushToast("Auto-aspect could not rebuild the selected size from the current source image", "error", 4200);
      return;
    }
    resolvedSize = autoSize;
  }
  if (editAutoAspectEnabled && batchProcessMode) {
    for (let index = 0; index < batchSelectedSources.length; index += 1) {
      const autoAspectSource = batchReferenceOrderAutoAspectSource(
        batchFixedSources,
        batchSelectedSources[index],
        batchSourceSlotIndex,
      );
      const autoSize = await buildAutoAspectSizeForSource(editAutoAspectResolution, autoAspectSource.source, autoAspectInput);
      if (!autoSize) {
        const message = `无法读取 ${autoAspectSource.label} 的尺寸，无法按参考图比例生成，请确认图片可访问后重试`;
        set({ errorMessage: message, errorRawPath: null });
        get().pushToast(message, "error", 5200);
        return;
      }
      batchAutoSizes[index] = autoSize;
    }
  }
  const workspaceId = s.activeWorkspaceId;
  const clearCurrentForNewRun = s.mode === "generate";
  const previousRuntime = workspaceRuntimeFromState(s, workspaceId);
  const previousBatchResults = completeWorkspaceBatchResults(s, workspaceId);
  const previousBatchResultIds = completeWorkspaceBatchResultIds(s, workspaceId, previousBatchResults);
  const previousBatchTaskIds = latestWorkspaceTaskIds(s, workspaceId);
  const hasPreviousBatchSession = batchProcessMode
    || continuousGenerateTest
    || previousBatchTaskIds.length > 0
    || previousBatchResultIds.length > 0
    || previousBatchResults.length > 0;
  const preserveCurrentBatchSession = hasPreviousBatchSession
    && shouldPreserveBatchSessionForSubmit(s, workspaceId);
  const batchSlotStart = preserveCurrentBatchSession ? nextBatchSlotStartForWorkspace(s, workspaceId) : 0;
  const shouldOpenBatchView = batchProcessMode || preserveCurrentBatchSession || batchCount > 1;
  const runPatch = {
    errorMessage: null,
    errorRawPath: null,
    progress: null,
    streamPreview: null,
    streamPreviews: {},
    lastLogLine: "",
    isRunning: true,
    jobsTotal: preserveCurrentBatchSession
      ? Math.max(previousRuntime.jobsTotal, previousBatchTaskIds.length, previousBatchResultIds.length, previousBatchResults.length) + batchCount
      : batchCount,
    jobsCompleted: preserveCurrentBatchSession ? previousRuntime.jobsCompleted : 0,
    jobsFailed: preserveCurrentBatchSession ? previousRuntime.jobsFailed : 0,
    runningJobs: preserveCurrentBatchSession ? previousRuntime.runningJobs : [],
  };
  set({
    ...runPatch,
    batchCount: s.batchCount,
    batchResults: preserveCurrentBatchSession ? previousBatchResults : [],
    resultGridOpen: shouldOpenBatchView,
    historyGalleryOpen: false,
    compareB: null,
    compareMode: "curtain",
    currentImage: continuousGenerateTest ? s.currentImage : (clearCurrentForNewRun ? null : s.currentImage),
    maskDataURL: null,
    annotations: [],
    strokes: [],
    workspaces: patchWorkspaceRuntime(s.workspaces, workspaceId, {
      ...runPatch,
      currentImageId: continuousGenerateTest ? (s.currentImage?.id ?? null) : (clearCurrentForNewRun ? null : s.currentImage?.id ?? null),
      batchResultIds: preserveCurrentBatchSession ? previousBatchResultIds : [],
      batchTaskIds: preserveCurrentBatchSession ? previousBatchTaskIds : [],
      resultGridOpen: shouldOpenBatchView,
      historyGalleryOpen: false,
    }),
  });

  const maskDataURL = s.mode === "edit"
    ? buildMaskPNGDataURL(s.strokes, s.currentImage?.imageB64 ? imageDims(s.currentImage.imageB64) : null)
    : null;
  const maskB64 = maskDataURL ? stripDataURLPrefix(maskDataURL) : "";
  let augmentedPrompt = augmentPromptWithAnnotations(effectivePrompt, s.annotations, s.currentImage?.imageB64 ? imageDims(s.currentImage.imageB64) : null);
  const styleSuffix = STYLE_SUFFIXES[s.styleTag];
  if (styleSuffix) {
    augmentedPrompt = `${augmentedPrompt}, ${styleSuffix}`;
  }

  const basePayload: backend.GenerateOptions = {
    apiKey: cleanedAPIKey,
    mode: s.mode,
    requestedJobId: "",
    prompt: augmentedPrompt,
    size: resolvedSize,
    quality: s.quality,
    outputFormat: s.outputFormat,
    imagePaths: editSourcePaths,
    imagePath: "",
    maskB64: maskB64,
    seed: s.seed,
    negativePrompt: s.negativePrompt,
    baseURL: cleanedBaseURL,
    textModelID: effectiveTextModelID,
    imageModelID: s.imageModelID,
    proxyMode: s.proxyMode,
    proxyURL: s.proxyURL,
    requestPolicy: s.requestPolicy,
    apiMode: effectiveAPIMode,
    apiProfileId: apiProfileSnapshot.apiProfileId || "",
    imagesNewAPICompat: effectiveImagesNewAPICompat,
    noPromptRevision: true,
    concurrencyLimit,
    partialImages: 1,
  };
  const remotePayload: RuntimeGenerateOptions = {
    ...basePayload,
    sourceImages: s.mode === "edit" && !batchProcessMode ? preparedSources : undefined,
  };
  const persistedPayload = batchProcessMode ? null : basePayload;

  if (s.prompt.trim()) {
    const ph = [s.prompt, ...get().promptHistory.filter((p) => p !== s.prompt)].slice(0, 50);
    set({ promptHistory: ph });
    try { localStorage.setItem(PROMPT_HISTORY_KEY, JSON.stringify(ph)); } catch {}
  }
  set({
    lastPayload: persistedPayload ?? null,
    workspaces: patchWorkspaceRuntime(get().workspaces, workspaceId, { lastPayload: persistedPayload ?? null }),
  });

  const batchFixedSourcePaths = batchProcessMode
    ? batchFixedSources.map((src) => src.path).filter(Boolean)
    : [];
  const preparedPanoramaRoundtrip = panoramaRoundtripFromSources(preparedSources);
  const submissionRunId = `run-${cryptoIDFallback()}`;

  const submittedTasks = batchProcessMode
    ? batchSelectedSources.map((source, index) => {
        const slotIndex = batchSlotStart + index;
        const combinedSourcePaths = buildBatchCombinedSourcePaths(batchFixedSourcePaths, source.path, batchSourceSlotIndex);
        const sourceImages = s.mode === "edit"
          ? [...batchFixedSources, source]
          : [];
        return createBatchTaskRecord({
          runId: submissionRunId,
          workspaceId,
          slotIndex,
          mode: s.mode,
          apiMode: effectiveAPIMode,
          ...apiProfileSnapshot,
          prompt: augmentedPrompt,
          size: batchAutoSizes[index] ?? resolvedSize,
          autoAspectResolution: editAutoAspectEnabled ? batchProcess.autoAspectResolution || undefined : undefined,
          quality: s.quality,
          outputFormat: s.outputFormat,
          requestPolicy: batchUsesFHLPool ? undefined : s.requestPolicy,
          imagesNewAPICompat: batchUsesFHLPool ? undefined : effectiveImagesNewAPICompat,
          textModelID: batchUsesFHLPool ? undefined : effectiveTextModelID,
          imageModelID: batchUsesFHLPool ? undefined : s.imageModelID,
          seed: s.seed ? s.seed + index : 0,
          negativePrompt: s.negativePrompt,
          styleTag: s.styleTag,
          sourceImagePaths: combinedSourcePaths,
          sourceImages: sourceImages.length > 0 ? sourceImages : undefined,
          panoramaRoundtrip: panoramaRoundtripFromSources(sourceImages),
          batchSourcePath: source.path,
          batchSourceSlotIndex,
          maskB64,
          continuousPoolTask: batchUsesFHLPool,
          queuedReason: batchUsesFHLPool ? "continuous_pool" : "batch_shared_concurrency",
          batchOutputMode: batchProcess.outputMode,
          batchOutputDir: batchProcess.outputMode === "custom_dir" ? batchProcess.outputDir : "",
          batchOutputPrefix: "processed-",
        });
      })
    : Array.from({ length: batchCount }, (_, index) => {
        const slotIndex = batchSlotStart + index;
        return createBatchTaskRecord({
          runId: submissionRunId,
          workspaceId,
          slotIndex,
          mode: s.mode,
          apiMode: effectiveAPIMode,
          ...apiProfileSnapshot,
          prompt: augmentedPrompt,
          size: resolvedSize,
          autoAspectResolution: editAutoAspectEnabled ? batchProcess.autoAspectResolution : undefined,
          quality: s.quality,
          outputFormat: s.outputFormat,
          requestPolicy: fhlPoolSubmit ? undefined : s.requestPolicy,
          imagesNewAPICompat: fhlPoolSubmit ? undefined : effectiveImagesNewAPICompat,
          textModelID: fhlPoolSubmit ? undefined : effectiveTextModelID,
          imageModelID: fhlPoolSubmit ? undefined : s.imageModelID,
          seed: s.seed ? s.seed + index : 0,
          negativePrompt: s.negativePrompt,
          styleTag: s.styleTag,
          sourceImagePaths: editSourcePaths,
          sourceImages: s.mode === "edit" ? preparedSources : undefined,
          panoramaRoundtrip: preparedPanoramaRoundtrip,
          maskB64,
          continuousPoolTask: fhlPoolSubmit,
          queuedReason: fhlPoolSubmit ? "continuous_pool" : undefined,
        });
      });
  const submittedTaskIds = submittedTasks.map((task) => task.id);
  const nextBatchTaskIds = preserveCurrentBatchSession
    ? [...previousBatchTaskIds, ...submittedTaskIds]
    : submittedTaskIds;
  const nextBatchTasksById = upsertBatchTasks(get().batchTasksById, submittedTasks);
  set((state) => ({
    batchTasksById: nextBatchTasksById,
    selectedBatchTaskId: null,
    jobsTotal: nextBatchTaskIds.length,
    workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, {
      batchTaskIds: nextBatchTaskIds,
      selectedBatchTaskId: null,
      jobsTotal: nextBatchTaskIds.length,
      resultGridOpen: shouldOpenBatchView,
    }),
  } as Partial<StudioState>));

  if (batchProcessMode) {
    if (batchUsesFHLPool) {
      void requestContinuousPoolPump();
      get().pushToast(
        `已提交 ${submittedTasks.length} 个 FHL 池批量任务，当前总上限 ${concurrencyLimit}`,
        "info",
        2600,
      );
      return;
    }
    void pumpContinuousQueue(workspaceId, effectiveAPIMode);
    get().pushToast(
      `已提交 ${submittedTasks.length} 个批量任务，最大并发 ${concurrencyLimit}`,
      "info",
      2600,
    );
    return;
  }

  if (continuousGenerateTest) {
    void requestContinuousPoolPump();
    get().pushToast(`已向 ${firstContinuousFHLPoolProfile?.name ?? "API 1"} 加入 1 个单图任务`, "info", 2200);
    return;
  }

  if (shouldUseBackgroundTaskProxyForSubmit(effectiveAPIMode)) {
    try {
      const submitJobGroup = isAndroidTaskProxyMode() ? submitAndroidJobGroup : submitBrowserJobGroup;
      const response = await submitJobGroup({
        workspaceId,
        mode: s.mode,
        prompt: augmentedPrompt,
        size: resolvedSize,
        quality: s.quality,
        outputFormat: s.outputFormat,
        batchCount,
        seed: s.seed,
        negativePrompt: s.negativePrompt,
        styleTag: s.styleTag,
        sourceImagePaths: editSourcePaths,
        maskB64,
        apiKey: cleanedAPIKey,
        baseURL: cleanedBaseURL,
        apiMode: effectiveAPIMode,
        ...apiProfileSnapshot,
        requestPolicy: s.requestPolicy,
        imagesNewAPICompat: effectiveImagesNewAPICompat,
        textModelID: effectiveTextModelID,
        imageModelID: s.imageModelID,
        continuousGenerateTest,
        continuousBatchIndex: batchSlotStart,
      });
      const nextJobGroupsByWorkspace = mergeWorkspaceJobGroup(get().jobGroupsByWorkspace, response.group);
      const workspace = get().workspaces.find((entry) => entry.id === workspaceId);
      const batchTasksById = updateTasksFromJobGroup(
        get().batchTasksById,
        workspace?.batchTaskIds ?? [],
        response.group,
      );
      const browserPatch = browserRuntimePatchFromGroups(nextJobGroupsByWorkspace[workspaceId] ?? [], s.continuousGenerateTest === true);
      const taskPatch = (workspace?.batchTaskIds?.length ?? 0) > 0
        ? taskRuntimePatchForWorkspace(workspaceId, workspace?.batchTaskIds ?? [], batchTasksById)
        : {};
      const runtimePatch = { ...browserPatch, ...taskPatch };
      const runningJobMeta = buildRunningJobMetaFromBrowserGroups(nextJobGroupsByWorkspace);
      set((state) => ({
        jobGroupsByWorkspace: nextJobGroupsByWorkspace,
        batchTasksById,
        runningJobMeta,
        workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, runtimePatch),
        ...(state.activeWorkspaceId === workspaceId ? activeRuntimePatch(runtimePatch) : {}),
      } as Partial<StudioState>));
      syncBrowserJobSubscriptions(nextJobGroupsByWorkspace);
      scheduleAutoRetriesForBrowserGroup(response.group);
    } catch (error: any) {
      const failedTaskIds = latestWorkspaceTaskIds(get(), workspaceId);
      const failedTasksById = { ...get().batchTasksById };
      const now = Date.now();
      for (const taskId of submittedTaskIds) {
        const task = failedTasksById[taskId];
        if (!task) continue;
        failedTasksById[taskId] = {
          ...task,
          status: "failed",
          updatedAt: now,
          errorMessage: `提交失败:${error?.message ?? error}`,
          lastLogLine: `提交失败:${error?.message ?? error}`,
        };
      }
      const taskPatch = taskRuntimePatchForWorkspace(workspaceId, failedTaskIds, failedTasksById);
      const failedPatch: WorkspacePatch = {
        ...taskPatch,
        progress: null,
        streamPreview: null,
        streamPreviews: {},
        lastLogLine: "",
        errorMessage: `提交失败:${error?.message ?? error}`,
        errorRawPath: null,
      };
      set((state) => ({
        ...activeRuntimePatch(failedPatch),
        errorMessage: failedPatch.errorMessage ?? null,
        errorRawPath: null,
        batchTasksById: failedTasksById,
        runningJobMeta: buildRunningJobMetaFromBrowserGroups(state.jobGroupsByWorkspace),
        workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, failedPatch),
      } as Partial<StudioState>));
      for (const taskId of submittedTaskIds) {
        const failedTask = failedTasksById[taskId];
        if (failedTask) scheduleAutoRetryForTask(failedTask, failedTask.errorMessage);
      }
    }
    return;
  }

  for (let i = 0; i < batchCount; i++) {
    const jobSeed = s.seed ? s.seed + i : 0;
    const p: RuntimeGenerateOptions = { ...remotePayload, seed: jobSeed };
    void launchOneJob(s.mode, p, {
      workspaceId,
      apiMode: effectiveAPIMode,
      ...apiProfileSnapshot,
      batchIndex: batchSlotStart + i,
      size: s.size,
      quality: s.quality,
      outputFormat: s.outputFormat,
      sources: preparedSources,
      currentImage: s.currentImage,
      styleTag: s.styleTag,
      continuousGenerateTest,
    });
  }
}

async function buildHistoryItemFromBrowserSlot(
  group: JobGroupSnapshot,
  slot: JobGroupSnapshot["slots"][number],
  existing: HistoryItem | null,
  sourceIdentity?: BrowserSourceIdentity,
): Promise<HistoryItem | null> {
  const savedPath = String(slot.savedPath || existing?.savedPath || "").trim();
  if (slot.status !== "succeeded" || !savedPath) return null;
  const mediaRef = await RegisterMediaAsset(savedPath, existing?.thumbPath || "").catch(() => null);
  const seedBase = Number.isFinite(Number(group.seed)) ? Number(group.seed) : 0;
  const batchIndex = slotIndexForGroupSlot(group, slot);
  const parentSourcePath = group.mode === "edit"
    ? String(sourceIdentity?.batchSourcePath || group.batchSourcePath || group.sourceImagePaths?.[0] || "").trim()
    : "";
  const sourceImages = group.mode === "edit"
    ? ((sourceIdentity?.sourceImages?.length ?? 0) > 0
      ? sourceIdentity?.sourceImages
      : sourceImagesFromPaths(group.sourceImagePaths))
    : undefined;
  const panoramaRoundtrip = sourceIdentity?.panoramaRoundtrip ?? panoramaRoundtripFromSources(sourceImages);
  return {
    ...existing,
    id: browserHistoryId(slot.jobId),
    prompt: group.prompt,
    revisedPrompt: slot.revisedPrompt || existing?.revisedPrompt,
    mode: group.mode,
    apiMode: group.apiMode,
    apiProfileId: group.apiProfileId || existing?.apiProfileId,
    apiProfileName: group.apiProfileName || existing?.apiProfileName,
    size: sourceIdentity?.size ?? group.size,
    quality: group.quality,
    outputFormat: group.outputFormat,
    createdAt: slot.finishedAt ?? slot.updatedAt ?? group.createdAt,
    seed: seedBase > 0 ? seedBase + slot.batchIndex : undefined,
    negativePrompt: group.negativePrompt || undefined,
    styleTag: group.styleTag || undefined,
    batchIndex: batchIndex >= 0 ? batchIndex : slot.batchIndex,
    elapsedSec: Number.isFinite(Number(slot.elapsedSec)) ? Number(slot.elapsedSec) : existing?.elapsedSec,
    imageId: mediaRef?.imageId || existing?.imageId,
    thumbPath: mediaRef?.thumbPath || existing?.thumbPath,
    previewUrl: mediaRef?.previewUrl || existing?.previewUrl,
    fullUrl: mediaRef?.fullUrl || existing?.fullUrl,
    width: mediaRef?.width || existing?.width,
    height: mediaRef?.height || existing?.height,
    previewWidth: mediaRef?.previewWidth || existing?.previewWidth,
    previewHeight: mediaRef?.previewHeight || existing?.previewHeight,
    sourceImages,
    panoramaRoundtrip,
    panoramaProject: panoramaProjectFromEditSources(sourceImages, panoramaRoundtrip),
    parentId: parentSourcePath || undefined,
    savedPath,
    rawPath: String(slot.rawPath || existing?.rawPath || ""),
    imageB64: undefined,
    imageBlob: null,
    previewBlob: null,
    previewOnly: true,
  };
}

async function hydrateHistoryFromBrowserGroups(
  history: HistoryItem[],
  groupsByWorkspace: Record<string, JobGroupSnapshot[]>,
) {
  const byId = new Map(history.map((item) => [item.id, item]));
  let dirty = false;
  const groups = Object.values(groupsByWorkspace)
    .flat()
    .sort((a, b) => b.createdAt - a.createdAt);
  for (const group of groups) {
    for (const slot of [...group.slots].sort((a, b) => a.batchIndex - b.batchIndex)) {
      if (slot.status !== "succeeded") continue;
      const nextItem = await buildHistoryItemFromBrowserSlot(
        group,
        slot,
        byId.get(browserHistoryId(slot.jobId)) ?? null,
        sourceIdentityForBrowserGroupSlot(group, slot),
      );
      if (!nextItem) continue;
      const previous = byId.get(nextItem.id);
      if (
        previous
        && previous.savedPath === nextItem.savedPath
        && previous.rawPath === nextItem.rawPath
        && previous.revisedPrompt === nextItem.revisedPrompt
        && previous.imageB64 === nextItem.imageB64
        && previous.apiMode === nextItem.apiMode
        && previous.apiProfileId === nextItem.apiProfileId
        && previous.apiProfileName === nextItem.apiProfileName
        && previous.width === nextItem.width
        && previous.height === nextItem.height
      ) {
        continue;
      }
      byId.set(nextItem.id, nextItem);
      dirty = true;
      await persistHistoryItem(nextItem).catch(() => undefined);
    }
  }
  const nextHistory = trimHistory(
    Array.from(byId.values()).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
  );
  if (dirty) persistTrimmedHistory(nextHistory);
  return { history: nextHistory, dirty };
}

function applyBrowserJobGroupToStore(group: JobGroupSnapshot) {
  let accepted = false;
  useStudioStore.setState((state) => {
    const workspace = state.workspaces.find((entry) => entry.id === group.workspaceId);
    if (!isJobGroupVisibleForWorkspace(workspace, group)) return {};
    accepted = true;
    const jobGroupsByWorkspace = mergeWorkspaceJobGroup(state.jobGroupsByWorkspace, group);
    const batchTasksById = updateTasksFromJobGroup(
      state.batchTasksById,
      workspace?.batchTaskIds ?? [],
      group,
    );
    const browserPatch = browserRuntimePatchFromGroups(jobGroupsByWorkspace[group.workspaceId] ?? [], workspace?.continuousGenerateTest === true);
    const taskPatch = (workspace?.batchTaskIds?.length ?? 0) > 0
      ? taskRuntimePatchForWorkspace(group.workspaceId, workspace?.batchTaskIds ?? [], batchTasksById)
      : {};
    const runtimePatch = { ...browserPatch, ...taskPatch };
    const runningJobMeta = buildRunningJobMetaFromBrowserGroups(jobGroupsByWorkspace);
    return {
      jobGroupsByWorkspace,
      batchTasksById,
      runningJobMeta,
      workspaces: patchWorkspaceRuntime(state.workspaces, group.workspaceId, runtimePatch),
      ...(state.activeWorkspaceId === group.workspaceId ? activeRuntimePatch(runtimePatch) : {}),
    } as Partial<StudioState>;
  });
  if (accepted) scheduleAutoRetriesForBrowserGroup(group);
}

function sourceImagesForTask(task: Pick<BatchTaskRecord, "mode" | "sourceImages" | "sourceImagePaths">): SourceImage[] {
  if (task.mode !== "edit") return [];
  return (task.sourceImages?.length ?? 0) > 0
    ? task.sourceImages ?? []
    : sourceImagesFromPaths(task.sourceImagePaths);
}

function panoramaRoundtripFromSources(sources: SourceImage[] | undefined): HistoryItem["panoramaRoundtrip"] {
  return findPanoramaRoundtripRef(sources) ?? undefined;
}

function sourceIdentityForBrowserGroupSlot(group: JobGroupSnapshot, slot: JobGroupSnapshot["slots"][number]): BrowserSourceIdentity {
  const state = useStudioStore.getState();
  const workspace = state.workspaces.find((entry) => entry.id === group.workspaceId);
  const slotIndex = slotIndexForGroupSlot(group, slot);
  const task = findTaskForJobSlot(
    workspace?.batchTaskIds ?? [],
    state.batchTasksById,
    group.workspaceId,
    slotIndex,
    slot.jobId,
    group.clientTaskId,
  );
  const sourceImages = task ? sourceImagesForTask(task) : sourceImagesFromPaths(group.sourceImagePaths);
  return {
    batchSourcePath: task?.batchSourcePath,
    size: task?.size,
    sourceImages: sourceImages.length > 0 ? sourceImages : undefined,
    panoramaRoundtrip: task?.panoramaRoundtrip ?? panoramaRoundtripFromSources(sourceImages),
  };
}

function applyBrowserJobGroupsForWorkspaceToStore(
  workspaceId: string,
  groups: JobGroupSnapshot[],
) {
  useStudioStore.setState((state) => {
    const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
    const visibleGroups = filterVisibleJobGroupsForWorkspace(workspace, groups);
    const jobGroupsByWorkspace = replaceWorkspaceJobGroups(state.jobGroupsByWorkspace, workspaceId, visibleGroups);
    let batchTasksById = state.batchTasksById;
    for (const group of visibleGroups) {
      batchTasksById = updateTasksFromJobGroup(
        batchTasksById,
        workspace?.batchTaskIds ?? [],
        group,
      );
    }
    const knownJobIds = new Set(visibleGroups.flatMap((group) => group.slots.map((slot) => slot.jobId)));
    batchTasksById = markMissingJobTasksInterrupted(
      batchTasksById,
      workspace?.batchTaskIds ?? [],
      knownJobIds,
    );
    const browserPatch = browserRuntimePatchFromGroups(
      jobGroupsByWorkspace[workspaceId] ?? [],
      workspace?.continuousGenerateTest === true,
    );
    const taskPatch = (workspace?.batchTaskIds?.length ?? 0) > 0
      ? taskRuntimePatchForWorkspace(workspaceId, workspace?.batchTaskIds ?? [], batchTasksById)
      : {};
    const runtimePatch = { ...browserPatch, ...taskPatch };
    const runningJobMeta = buildRunningJobMetaFromBrowserGroups(jobGroupsByWorkspace);
    return {
      jobGroupsByWorkspace,
      batchTasksById,
      runningJobMeta,
      workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, runtimePatch),
      ...(state.activeWorkspaceId === workspaceId ? activeRuntimePatch(runtimePatch) : {}),
    } as Partial<StudioState>;
  });
  const workspace = useStudioStore.getState().workspaces.find((entry) => entry.id === workspaceId);
  for (const group of filterVisibleJobGroupsForWorkspace(workspace, groups)) scheduleAutoRetriesForBrowserGroup(group);
  syncBrowserJobSubscriptions(useStudioStore.getState().jobGroupsByWorkspace);
}

function resolveWorkspaceIdForBrowserJob(jobId: string): string {
  const state = useStudioStore.getState();
  const fromMeta = state.runningJobMeta[jobId]?.workspaceId;
  if (fromMeta) return fromMeta;
  for (const task of Object.values(state.batchTasksById)) {
    if (task.jobId === jobId) return task.workspaceId;
  }
  return "";
}

function browserJobStillLooksActive(jobId: string): boolean {
  const state = useStudioStore.getState();
  if (state.runningJobMeta[jobId]) return true;
  return Object.values(state.batchTasksById).some((task) => (
    task.jobId === jobId && (task.status === "running" || task.status === "queued")
  ));
}

function findBrowserJobGroupSlot(
  groups: JobGroupSnapshot[],
  jobId: string,
): { group: JobGroupSnapshot; slot: JobGroupSnapshot["slots"][number] } | null {
  for (const group of groups) {
    const slot = group.slots.find((entry) => entry.jobId === jobId);
    if (slot) return { group, slot };
  }
  return null;
}

async function refreshBrowserJobGroupsForWorkspace(workspaceId: string, jobId?: string): Promise<void> {
  if (!workspaceId || !isBackgroundTaskProxyMode()) return;
  const existing = browserJobRefreshes.get(workspaceId);
  if (existing) {
    await existing;
    return;
  }
  const listJobGroups = isAndroidTaskProxyMode() ? listAndroidJobGroups : listBrowserJobGroups;
  const task = (async () => {
    try {
      const response = await listJobGroups(workspaceId);
      const workspace = useStudioStore.getState().workspaces.find((entry) => entry.id === workspaceId);
      const visibleGroups = filterVisibleJobGroupsForWorkspace(workspace, response.groups);
      applyBrowserJobGroupsForWorkspaceToStore(workspaceId, visibleGroups);
      if (!jobId) return;
      const match = findBrowserJobGroupSlot(visibleGroups, jobId);
      if (!match || match.slot.status !== "succeeded") return;
      await syncHistoryItemFromBrowserJobSlot(match.group, match.slot, {
        updateWorkspaceSelection: true,
      });
    } catch {
      // Ignore refresh failures; the next job update or reload will reconcile state.
    } finally {
      browserJobRefreshes.delete(workspaceId);
    }
  })();
  browserJobRefreshes.set(workspaceId, task);
  await task;
}

function clearBrowserJobSubscription(jobId: string) {
  const off = browserJobSubscriptions.get(jobId);
  if (!off) return;
  try { off(); } catch {}
  browserJobSubscriptions.delete(jobId);
}

function clearBrowserWorkspaceSubscription(workspaceId: string) {
  const off = browserWorkspaceSubscriptions.get(workspaceId);
  if (!off) return;
  try { off(); } catch {}
  browserWorkspaceSubscriptions.delete(workspaceId);
}

async function syncHistoryItemFromBrowserJobSlot(
  group: JobGroupSnapshot,
  slot: JobGroupSnapshot["slots"][number],
  options: {
    updateWorkspaceSelection: boolean;
  },
) {
  const store = useStudioStore;
  const taskForOutputSync = Object.values(store.getState().batchTasksById).find((task) => (
    task.workspaceId === group.workspaceId && task.jobId === slot.jobId
  ));
  const shouldSyncBatchOutput = !!taskForOutputSync && taskForOutputSync.historyItemId !== browserHistoryId(slot.jobId);
  const existing = store.getState().history.find((item) => item.id === browserHistoryId(slot.jobId)) ?? null;
  const historyItem = await buildHistoryItemFromBrowserSlot(group, slot, existing, {
    batchSourcePath: taskForOutputSync?.batchSourcePath,
    size: taskForOutputSync?.size,
    sourceImages: taskForOutputSync ? sourceImagesForTask(taskForOutputSync) : undefined,
    panoramaRoundtrip: taskForOutputSync?.panoramaRoundtrip,
  });
  if (!historyItem) return;
  const activeItem: HistoryItem = {
    ...historyItem,
    previewOnly: false,
  };
  store.setState((state) => {
    const nextHistory = trimHistory([
      historyItem,
      ...state.history.filter((item) => item.id !== historyItem.id),
    ]);
    const workspace = state.workspaces.find((entry) => entry.id === group.workspaceId);
    const mergedBatch = mergeWorkspaceBatchResult(state, group.workspaceId, historyItem, nextHistory);
    const batchResults = state.activeWorkspaceId === group.workspaceId
      ? mergedBatch.batchResults
      : state.batchResults;
    const continuousGroup = group.continuousGenerateTest === true;
    const batchTasksById = updateTaskFromHistoryItem(
      state.batchTasksById,
      workspace?.batchTaskIds ?? [],
      group.workspaceId,
      historyItem,
    );
    const workspacePatch: WorkspacePatch = {
      batchResultIds: mergedBatch.batchResultIds,
      ...(options.updateWorkspaceSelection
        ? {
          currentImageId: historyItem.id,
          resultGridOpen: continuousGroup || group.batchCount > 1,
        }
        : {}),
    };
    return {
      history: nextHistory,
      batchTasksById,
      batchResults,
      workspaces: patchWorkspaceRuntime(state.workspaces, group.workspaceId, workspacePatch),
      ...(options.updateWorkspaceSelection && state.activeWorkspaceId === group.workspaceId
        ? {
            currentImage: continuousGroup || group.batchCount > 1 ? historyItem : activeItem,
            resultGridOpen: continuousGroup || group.batchCount > 1,
            maskDataURL: null,
            annotations: [],
            tool: "pan",
          }
        : {}),
    } as Partial<StudioState>;
  });
  await persistHistoryItem(historyItem).catch(() => undefined);
  persistTrimmedHistory(useStudioStore.getState().history);
  const autoPastedPanorama = await autoPastePanoramaRoundtripResult(historyItem, {
    workspaceId: group.workspaceId,
    selectAsCurrent: options.updateWorkspaceSelection && group.continuousGenerateTest !== true && group.batchCount <= 1,
  }).catch((error: any) => {
    store.getState().pushToast(`全景贴回失败: ${error?.message ?? error}`, "warn", 4200);
    return null;
  });
  if (shouldSyncBatchOutput) {
    syncBatchOutputAfterSuccess(batchProcessLinkFromTask(taskForOutputSync), historyItem.savedPath);
  }
  if (taskForOutputSync) clearAutoRetryTimer(taskForOutputSync.id);
  const state = useStudioStore.getState();
  if (autoPastedPanorama) {
    state.pushToast("已自动贴回全景图", "success", 3200);
  }
  if (state.apiKey.trim() && providerRequiresDirectAPIKey(state.apiMode)) {
    syncCLIConfigQuietly(cliConfigFromState(state, { apiKey: state.apiKey.trim() }));
  }
}

function browserJobEventIsTerminal(event: BrowserJobEvent) {
  return event.type === "cancelled" || event.type === "error" || event.type === "terminal";
}

function applyBrowserJobEvent(event: BrowserJobEvent) {
  const terminal = browserJobEventIsTerminal(event);
  const workspace = useStudioStore.getState().workspaces.find((entry) => entry.id === event.group.workspaceId);
  if (!isJobGroupVisibleForWorkspace(workspace, event.group)) return terminal;
  applyBrowserJobGroupToStore(event.group);
  if (event.type === "terminal" && event.slot.status === "succeeded") {
    void syncHistoryItemFromBrowserJobSlot(event.group, event.slot, {
      updateWorkspaceSelection: true,
    });
  }
  if (terminal) {
    void pumpContinuousQueue(event.group.workspaceId, normalizeAPIMode(event.group.apiMode));
    void requestContinuousPoolPump();
  }
  return terminal;
}

function ensureBrowserJobSubscription(jobId: string) {
  if (!jobId || browserJobSubscriptions.has(jobId)) return;
  const reconcileIfStreamEndedEarly = () => {
    const workspaceId = resolveWorkspaceIdForBrowserJob(jobId);
    const shouldRefresh = browserJobStillLooksActive(jobId);
    clearBrowserJobSubscription(jobId);
    if (!shouldRefresh || !workspaceId) return;
    void refreshBrowserJobGroupsForWorkspace(workspaceId, jobId);
  };
  const off = subscribeToBrowserJob(jobId, (event) => {
    if (applyBrowserJobEvent(event)) {
      clearBrowserJobSubscription(jobId);
    }
  }, () => {
    reconcileIfStreamEndedEarly();
  }, () => {
    reconcileIfStreamEndedEarly();
  });
  browserJobSubscriptions.set(jobId, off);
}

function browserWorkspaceHasActiveJobs(
  groupsByWorkspace: Record<string, JobGroupSnapshot[]>,
  workspaceId: string,
) {
  return (groupsByWorkspace[workspaceId] ?? []).some((group) => runningJobIdsFromGroup(group).length > 0);
}

function ensureBrowserWorkspaceSubscription(workspaceId: string) {
  if (!workspaceId || browserWorkspaceSubscriptions.has(workspaceId)) return;
  const reconcileIfStreamEndedEarly = () => {
    const shouldRefresh = browserWorkspaceHasActiveJobs(useStudioStore.getState().jobGroupsByWorkspace, workspaceId);
    clearBrowserWorkspaceSubscription(workspaceId);
    if (!shouldRefresh) return;
    void refreshBrowserJobGroupsForWorkspace(workspaceId).finally(() => {
      syncBrowserJobSubscriptions(useStudioStore.getState().jobGroupsByWorkspace);
    });
  };
  const off = subscribeToBrowserWorkspace(workspaceId, (event) => {
    if (applyBrowserJobEvent(event)) {
      syncBrowserJobSubscriptions(useStudioStore.getState().jobGroupsByWorkspace);
    }
  }, () => {
    reconcileIfStreamEndedEarly();
  }, () => {
    reconcileIfStreamEndedEarly();
  });
  browserWorkspaceSubscriptions.set(workspaceId, off);
}

function syncBrowserJobSubscriptions(groupsByWorkspace: Record<string, JobGroupSnapshot[]>) {
  if (!isAndroidTaskProxyMode()) {
    for (const jobId of Array.from(browserJobSubscriptions.keys())) clearBrowserJobSubscription(jobId);
    const liveWorkspaceIds = new Set<string>();
    for (const [workspaceId, groups] of Object.entries(groupsByWorkspace)) {
      if (!groups.some((group) => runningJobIdsFromGroup(group).length > 0)) continue;
      liveWorkspaceIds.add(workspaceId);
      ensureBrowserWorkspaceSubscription(workspaceId);
    }
    for (const workspaceId of Array.from(browserWorkspaceSubscriptions.keys())) {
      if (!liveWorkspaceIds.has(workspaceId)) clearBrowserWorkspaceSubscription(workspaceId);
    }
    return;
  }

  for (const workspaceId of Array.from(browserWorkspaceSubscriptions.keys())) {
    clearBrowserWorkspaceSubscription(workspaceId);
  }
  const liveIds = new Set<string>();
  for (const groups of Object.values(groupsByWorkspace)) {
    for (const group of groups) {
      for (const jobId of runningJobIdsFromGroup(group)) {
        liveIds.add(jobId);
        ensureBrowserJobSubscription(jobId);
      }
    }
  }
  for (const jobId of Array.from(browserJobSubscriptions.keys())) {
    if (!liveIds.has(jobId)) clearBrowserJobSubscription(jobId);
  }
}

const mediaActions = createMediaActions({
  getState: () => useStudioStore.getState(),
  setState: (patch) => {
    if (typeof patch === "function") {
      useStudioStore.setState((state) => patch(state));
      return;
    }
    useStudioStore.setState(patch);
  },
});

const profileActions = createProfileActions({
  getState: () => useStudioStore.getState(),
  setState: (patch) => {
    if (typeof patch === "function") {
      useStudioStore.setState((state) => patch(state));
      return;
    }
    useStudioStore.setState(patch);
  },
});

const workspaceActions = createWorkspaceActions({
  getState: () => useStudioStore.getState(),
  setState: (patch) => {
    if (typeof patch === "function") {
      useStudioStore.setState((state) => patch(state));
      return;
    }
    useStudioStore.setState(patch);
  },
});

const imageActions = createImageActions({
  getState: () => useStudioStore.getState(),
  setState: (patch) => {
    if (typeof patch === "function") {
      useStudioStore.setState((state) => patch(state));
      return;
    }
    useStudioStore.setState(patch);
  },
});

function initialWorkspaceForBootstrap(id: string, outputFormat: OutputFormatValue): Workspace {
  return {
    id,
    name: "图片 1",
    promptPrefix: "",
    prompt: "",
    optimizationGuidance: "",
    negativePrompt: "",
    mode: "generate",
    size: DEFAULT_FHL_SIZE,
    quality: "medium",
    outputFormat,
    seed: 0,
    batchCount: 1,
    continuousGenerateTest: false,
    editSourceMode: "manual",
    editAutoAspectUserLocked: false,
    batchProcess: defaultBatchProcessConfig(),
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

function isE2EOnlyBootstrap(): boolean {
  if (typeof window === "undefined") return false;
  return (window as Window & {
    __IMAGE_STUDIO_E2E_BOOTSTRAP?: { e2eOnly?: boolean };
  }).__IMAGE_STUDIO_E2E_BOOTSTRAP?.e2eOnly === true;
}

export const useStudioStore = create<StudioState>((set, get) => ({
  apiKey: "",
  mode: "generate",
  promptPrefix: "",
  prompt: "",
  optimizationGuidance: "",
  negativePrompt: "",
  size: DEFAULT_FHL_SIZE,
  quality: "medium",
  outputFormat: "png",
  seed: 0,
  kernelRuntimeMode: "auto",
  baseURL: "",
  textModelID: "",
  imageModelID: "",
  proxyMode: "system",
  proxyURL: "",
  apiMode: "responses",
  fhlTransportMode: "images",
  fhlTextAPIConfigured: false,
  fhlTextAPIKeyHint: "",
  fhlTextAPITestStatus: "unconfigured",
  fhlTextAPITestMessage: "",
  requestPolicy: "openai",
  imagesNewAPICompat: false,
  noPromptRevision: true,
  editAutoAspectUserLocked: false,
  profiles: [],
  activeProfileId: "",
  sources: [],
  reversePromptImage: null,

  runningJobs: [],
  jobsTotal: 0,
  jobsCompleted: 0,
  jobsFailed: 0,
  progress: null,
  streamPreview: null,
  streamPreviews: {},
  lastLogLine: "",
  errorMessage: null,
  errorRawPath: null,
  isRunning: false,
  lastPayload: null,
  runningJobMeta: {},
  jobGroupsByWorkspace: {},
  batchTasksById: {},

  currentImage: null,
  sourcePreviewReturnImage: null,
  panoramaViewerItem: null,
  panoramaAlignTarget: null,
  history: [],
  historyHasMore: false,
  historyLoading: false,
  historyCursor: null,
  batchResults: [],
  selectedBatchTaskId: null,
  resultGridOpen: false,
  historyGalleryOpen: false,
  historyGallerySinglePreviewId: null,
  historyGallerySort: "newest",
  materialManagerOpen: false,
  materialGroups: [],
  historyRailCollapsed: false,
  historyTimelineOpen: false,

  tool: "pan",
  brushSize: 30,
  brushMode: "paint",
  annotationKind: "rect",
  annotationColor: "#ff4d4d",
  selectedAnnotationId: null,
  maskDataURL: null,
  strokes: [],
  annotations: [],
  undoStack: [],
  redoStack: [],

  compareB: null,
  compareMode: "curtain",
  compareSplit: 0.5,

  toasts: [],
  recentDurations: [],
  viewZoom: 1,
  canvasViewResetTick: 0,
  fullscreen: false,
  starPromptOpen: false,
  starPromptSource: "auto",
  promptHistory: [],
  batchCount: 1,
  continuousGenerateTest: false,
  fhlPoolPerAPIConcurrencyLimit: DEFAULT_CONCURRENCY_LIMIT,
  fhlPoolEffectiveConcurrencyByProfileId: {},
  editSourceMode: "manual",
  batchProcess: defaultBatchProcessConfig(),
  presets: [],
  theme: "system",
  fontScale: 1,
  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true, upstreamModalOpen: false }),
  closeSettings: () => set({ settingsOpen: false }),
  isTestingKey: false,
  isOptimizingPrompt: false,
  isReversingPrompt: false,
  upstreamModalOpen: false,
  upstreamReturnTarget: "app",
  openUpstreamConfig: (returnTarget = "app") => set({
    upstreamModalOpen: true,
    upstreamReturnTarget: returnTarget,
    settingsOpen: false,
  }),
  closeUpstreamConfig: () => {
    const { upstreamReturnTarget } = get();
    set({
      upstreamModalOpen: false,
      settingsOpen: upstreamReturnTarget === "settings",
      upstreamReturnTarget: "app",
    });
  },
  setFHLTransportMode: (mode) => {
    const fhlTransportMode = mode === "responses" ? "responses" : "images";
    persistFHLTransportMode(fhlTransportMode);
    const state = get();
    const activeProfile = state.profiles.find((profile) => profile.id === state.activeProfileId);
    set({
      fhlTransportMode,
      ...(activeProfile ? activeProfileRuntimePatch(activeProfile, fhlTransportMode) : {}),
    });
  },
  openStarPrompt: () => {
    if (!usesWindowsDesktopUI) return;
    set({ starPromptOpen: true, starPromptSource: "manual" });
  },
  dismissStarPrompt: () => {
    set({ starPromptOpen: false });
    try { localStorage.setItem(STAR_PROMPTED_KEY, "1"); } catch {}
  },
  resetCurrentWorkspaceDraft: () => {
    const state = get();
    if (state.isOptimizingPrompt || state.isReversingPrompt) {
      state.pushToast("Cannot reset the current workspace while prompt tasks are running", "warn", 2600);
      return;
    }
    const workspaceId = state.activeWorkspaceId;
    const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
    const preservedTaskIds = activeBatchTaskIdsForReset(workspaceId, workspace?.batchTaskIds ?? [], state.batchTasksById);
    const taskPatch = taskRuntimePatchForWorkspace(workspaceId, preservedTaskIds, state.batchTasksById);
    const runtime = workspaceRuntimeFromState(state, workspaceId);
    const preservedRunningJobs = taskPatch.runningJobs ?? [];
    const preservedStreamPreviews = preserveStreamPreviewsForJobs(runtime.streamPreviews ?? {}, preservedRunningJobs);
    const preservedStreamPreview = preservedRunningJobs.length > 0
      ? (runtime.streamPreview && preservedStreamPreviews[runtime.streamPreview.jobId]
        ? runtime.streamPreview
        : Object.values(preservedStreamPreviews)[0] ?? null)
      : null;
    const hasPreservedTasks = preservedTaskIds.length > 0;
    const resetPatch: WorkspacePatch = {
      promptPrefix: "",
      prompt: "",
      optimizationGuidance: "",
      negativePrompt: "",
      mode: "generate",
      size: DEFAULT_FHL_SIZE,
      quality: "medium",
      outputFormat: "png",
      seed: 0,
      batchCount: 1,
      continuousGenerateTest: false,
      editSourceMode: "manual",
      batchProcess: defaultBatchProcessConfig(),
      editAutoAspectUserLocked: false,
      styleTag: "",
      sources: [],
      currentImageId: null,
      batchResultIds: [],
      batchTaskIds: preservedTaskIds,
      selectedBatchTaskId: null,
      batchSinglePreviewOpen: false,
      resultGridOpen: hasPreservedTasks,
      historyGalleryOpen: false,
      historyGallerySinglePreviewId: null,
      historyGallerySort: "newest",
      ...taskPatch,
      progress: preservedRunningJobs.length > 0 ? runtime.progress : null,
      streamPreview: preservedStreamPreview,
      streamPreviews: preservedRunningJobs.length > 0 ? preservedStreamPreviews : {},
      lastLogLine: preservedRunningJobs.length > 0 ? runtime.lastLogLine : "",
      errorMessage: null,
      errorRawPath: null,
      lastPayload: null,
    };
    set((current) => ({
      promptPrefix: "",
      prompt: "",
      optimizationGuidance: "",
      negativePrompt: "",
      mode: "generate",
      size: DEFAULT_FHL_SIZE,
      quality: "medium",
      outputFormat: "png",
      seed: 0,
      batchCount: 1,
      continuousGenerateTest: false,
      editSourceMode: "manual",
      batchProcess: defaultBatchProcessConfig(),
      editAutoAspectUserLocked: false,
      styleTag: "",
      sources: [],
      reversePromptImage: null,
      currentImage: null,
      sourcePreviewReturnImage: null,
      batchResults: [],
      selectedBatchTaskId: null,
      resultGridOpen: hasPreservedTasks,
      historyGalleryOpen: false,
      historyGallerySort: "newest",
      compareB: null,
      compareMode: "curtain",
      maskDataURL: null,
      strokes: [],
      annotations: [],
      selectedAnnotationId: null,
      undoStack: [],
      redoStack: [],
      runningJobs: preservedRunningJobs,
      jobsTotal: taskPatch.jobsTotal ?? 0,
      jobsCompleted: taskPatch.jobsCompleted ?? 0,
      jobsFailed: taskPatch.jobsFailed ?? 0,
      progress: resetPatch.progress ?? null,
      streamPreview: preservedStreamPreview,
      streamPreviews: resetPatch.streamPreviews ?? {},
      lastLogLine: resetPatch.lastLogLine ?? "",
      errorMessage: null,
      errorRawPath: null,
      isRunning: preservedRunningJobs.length > 0,
      lastPayload: null,
      workspaces: patchWorkspaceRuntime(current.workspaces, workspaceId, resetPatch),
    }));
    get().pushToast("Current workspace draft has been reset", "success", 2200);
  },
  setFHLPoolPerAPIConcurrencyLimit: async (limit) => {
    const normalized = normalizeFHLPoolPerAPIConcurrencyLimit(limit);
    persistFHLPoolPerAPIConcurrencyLimit(normalized);
    set({ fhlPoolPerAPIConcurrencyLimit: normalized });
    const enabledCount = enabledFHLPoolProfiles(get()).length;
    get().pushToast(
      `FHL 每 API 并发已设为 ${normalized}，当前总上限 ${enabledCount * normalized}`,
      "success",
      2600,
    );
    void requestContinuousPoolPump();
  },
  runContinuousPressureTest: async (count) => {
    const total = Math.max(1, Math.min(500, Math.floor(Number(count) || 1)));
    const state = get();
    if (!state.continuousGenerateTest) {
      get().pushToast("Enable continuous generation before starting this test", "warn", 2600);
      return;
    }
    const effectiveAPIMode: APIModeValue = fhlTransportModeForState(state);
    if (!shouldUseBackgroundTaskProxyForSubmit(effectiveAPIMode)) {
      get().pushToast("Continuous pressure test is only available in browser task proxy mode", "warn", 3000);
      return;
    }
    if (enabledFHLPoolProfiles(state).length === 0) {
      get().pushToast("Enable at least one FHL API slot in the continuous pool before starting this test", "warn", 3200);
      return;
    }
    if (state.mode !== "generate") {
      set({ mode: "generate" });
      set({ workspaces: patchWorkspaceRuntime(get().workspaces, get().activeWorkspaceId, { mode: "generate" }) });
    }
    const latest = get();
    const workspaceId = latest.activeWorkspaceId;
    const startIndex = nextBatchSlotStartForWorkspace(latest, workspaceId);
    const resolvedSize = normalizeSizeSelection(latest.size, {
      apiMode: effectiveAPIMode,
      requestPolicy: latest.requestPolicy,
      imageModelID: latest.imageModelID,
      mode: latest.mode,
    });
    const createdAt = Date.now();
    const pressureRunId = `run-${cryptoIDFallback()}`;
    const submittedTasks = Array.from({ length: total }, (_, index) => {
      const slotIndex = startIndex + index;
      return createBatchTaskRecord({
        runId: pressureRunId,
        workspaceId,
        slotIndex,
        mode: "generate",
        apiMode: effectiveAPIMode,
        prompt: pressurePrompt(slotIndex),
        size: resolvedSize,
        quality: latest.quality,
        outputFormat: latest.outputFormat,
        seed: latest.seed ? latest.seed + index : 0,
        negativePrompt: latest.negativePrompt,
        styleTag: latest.styleTag,
        sourceImagePaths: [],
        maskB64: "",
        continuousPoolTask: true,
        queuedReason: "continuous_pool",
        createdAt: createdAt + index,
      });
    });
    const submittedTaskIds = submittedTasks.map((task) => task.id);
    const previousBatchTaskIds = latestWorkspaceTaskIds(latest, workspaceId);
    const nextBatchTaskIds = [...previousBatchTaskIds, ...submittedTaskIds];
    const nextBatchTasksById = upsertBatchTasks(latest.batchTasksById, submittedTasks);
    const runtimePatch = taskRuntimePatchForWorkspace(workspaceId, nextBatchTaskIds, nextBatchTasksById);
    const lastPrompt = submittedTasks[submittedTasks.length - 1]?.prompt ?? latest.prompt;
    set((current) => ({
      mode: "generate",
      prompt: lastPrompt,
      promptPrefix: "",
      batchCount: 1,
      batchTasksById: nextBatchTasksById,
      selectedBatchTaskId: null,
      resultGridOpen: true,
      historyGalleryOpen: false,
      errorMessage: null,
      errorRawPath: null,
      ...activeRuntimePatch(runtimePatch),
      workspaces: patchWorkspaceRuntime(current.workspaces, workspaceId, {
        mode: "generate",
        prompt: lastPrompt,
        promptPrefix: "",
        batchCount: 1,
        batchTaskIds: nextBatchTaskIds,
        selectedBatchTaskId: null,
        batchResultIds: current.workspaces.find((workspace) => workspace.id === workspaceId)?.batchResultIds ?? [],
        resultGridOpen: true,
        historyGalleryOpen: false,
        ...runtimePatch,
      }),
    } as Partial<StudioState>));
    void requestContinuousPoolPump();
    get().pushToast(`Queued ${total} continuous generation tasks`, "success", 2600);
  },
  workspaces: [],
  activeWorkspaceId: "",
  styleTag: "",

  setField: (key, value) => {
    // Guard provider config fields from accidental undefined writes.
    // Active profile changes own these mirrored runtime fields.
    if (key === "apiMode" || key === "baseURL" || key === "apiKey" ||
        key === "textModelID" || key === "imageModelID") {
      if (typeof console !== "undefined") {
        console.warn(`setField("${String(key)}", ...) 收到 undefined，已忽略，请检查调用方是否漏传字段值`);
      }
      set({ [key]: value } as any);
      return;
    }
    // Keep workspace runtime in sync with mirrored root fields.
    const stateBefore = get();
    const workspaceId = stateBefore.activeWorkspaceId;
    const previousWorkspace = stateBefore.workspaces.find((workspace) => workspace.id === workspaceId);
    const normalizedValue = key === "batchCount"
      ? normalizeBatchCount(value)
      : key === "editSourceMode"
        ? normalizeEditSourceMode(value)
        : key === "batchProcess"
          ? normalizeBatchProcessConfig(value)
          : value;
    set({ [key]: normalizedValue } as any);
    if (key === "currentImage") {
      const item = normalizedValue as HistoryItem | null;
      const workspace = get().workspaces.find((w) => w.id === get().activeWorkspaceId);
      const isSourcePreview = item?.id?.startsWith("source-preview-") === true;
      const currentPreviewReturnImage = get().sourcePreviewReturnImage;
      set({
        compareB: null,
        compareMode: "curtain",
        sourcePreviewReturnImage: isSourcePreview && currentPreviewReturnImage ? currentPreviewReturnImage : null,
        resultGridOpen: false,
        workspaces: patchWorkspaceRuntime(get().workspaces, get().activeWorkspaceId, {
          currentImageId: currentImageIdForWorkspaceSnapshot(item, get().streamPreview, get().streamPreviews, workspace?.currentImageId ?? null),
          resultGridOpen: false,
        }),
      });
    } else if (key === "batchCount") {
      const value = normalizedValue as number;
      set({
        workspaces: get().workspaces.map((w) => (
          w.id === get().activeWorkspaceId ? { ...w, batchCount: value } : w
        )),
      });
    } else if (key === "size") {
      const workspacePatch: WorkspacePatch = { size: normalizedValue as SizeValue };
      if (
        stateBefore.mode === "edit"
        && stateBefore.editSourceMode === "manual"
        && stateBefore.batchProcess.autoAspectResolution !== ""
      ) {
        workspacePatch.editAutoAspectUserLocked = true;
      }
      set({
        workspaces: patchWorkspaceRuntime(get().workspaces, workspaceId, workspacePatch),
      });
    } else if (key === "continuousGenerateTest") {
      set({ workspaces: patchWorkspaceRuntime(get().workspaces, get().activeWorkspaceId, { continuousGenerateTest: normalizedValue as boolean }) });
    } else if (key === "editSourceMode") {
      set({ workspaces: patchWorkspaceRuntime(get().workspaces, get().activeWorkspaceId, { editSourceMode: normalizedValue as EditSourceMode }) });
      if ((normalizedValue as EditSourceMode) === "manual" || (normalizedValue as EditSourceMode) === "batch") {
        void syncSharedEditAutoAspect({ getState: get, setState: set });
      }
    } else if (key === "batchProcess") {
      set({ workspaces: patchWorkspaceRuntime(get().workspaces, get().activeWorkspaceId, { batchProcess: normalizedValue as StudioState["batchProcess"] }) });
      const previousResolution = previousWorkspace?.batchProcess.autoAspectResolution ?? stateBefore.batchProcess.autoAspectResolution;
      const nextResolution = (normalizedValue as StudioState["batchProcess"]).autoAspectResolution;
      if (previousResolution !== nextResolution) {
        void syncSharedEditAutoAspect(
          { getState: get, setState: set },
          { resetUserLock: true },
        );
      } else if (stateBefore.mode === "edit" && stateBefore.editSourceMode === "batch") {
        void syncSharedEditAutoAspect({ getState: get, setState: set });
      }
    } else if (key === "promptPrefix") {
      set({ workspaces: patchWorkspaceRuntime(get().workspaces, get().activeWorkspaceId, { promptPrefix: normalizedValue as string }) });
    } else if (key === "optimizationGuidance") {
      set({ workspaces: patchWorkspaceRuntime(get().workspaces, get().activeWorkspaceId, { optimizationGuidance: normalizedValue as string }) });
    } else if (key === "errorMessage") {
      set({ workspaces: patchWorkspaceRuntime(get().workspaces, get().activeWorkspaceId, { errorMessage: value as string | null }) });
    } else if (key === "errorRawPath") {
      set({ workspaces: patchWorkspaceRuntime(get().workspaces, get().activeWorkspaceId, { errorRawPath: value as string | null }) });
    } else if (key === "lastPayload") {
      set({ workspaces: patchWorkspaceRuntime(get().workspaces, get().activeWorkspaceId, { lastPayload: value as backend.GenerateOptions | null }) });
    }
    if (key === "kernelRuntimeMode") {
      try { localStorage.setItem(KERNEL_RUNTIME_MODE_KEY, String(value)); } catch {}
      setKernelRuntimeMode(value as KernelRuntimeMode);
    } else if (key === "outputFormat") {
      try { localStorage.setItem(OUTPUT_FORMAT_KEY, String(value)); } catch {}
    } else if (key === "mode" && normalizedValue === "edit") {
      void syncSharedEditAutoAspect({ getState: get, setState: set });
    }
  },
  setFullscreen: async (value) => {
    const next = !!value;
    set({ fullscreen: next });
    dispatchFullscreenResize();
    try {
      await setNativeFullscreen(next);
    } catch (error: any) {
      const platform = readRuntimePlatformState();
      const message = platform.isAndroid
        ? `Android 全屏切换失败：${error?.message ?? error}`
        : `全屏切换失败：${error?.message ?? error}`;
      get().pushToast(message, "error", 6000);
    } finally {
      dispatchFullscreenResize();
      set((state) => ({ canvasViewResetTick: state.canvasViewResetTick + 1 }));
    }
  },
  toggleFullscreen: async () => {
    await get().setFullscreen(!get().fullscreen);
  },

  setAPIKey: async (v) => {
    const trimmed = normalizeAPIKeyInput(v);
    const activeId = get().activeProfileId;
    if (!activeId) {
      // Without an active profile there is nowhere safe to persist the key.
      if (typeof console !== "undefined") console.warn("setAPIKey: no active profile; ignoring save request");
      return;
    }
    // Persist the key into keyring, then sync the CLI config.
    set({ apiKey: trimmed });
    await SetStoredAPIKey(keyringUserFor(activeId), trimmed);
    clearContinuousPoolProfileRuntimeLimit(activeId);
    if (trimmed) {
      syncCLIConfigQuietly(cliConfigFromState(get(), { apiKey: trimmed }));
    } else {
      syncCLIConfigQuietly(cliConfigFromState(get(), { clearAPIKey: true }));
    }
  },

  createProfile: async (input) => {
    const id = await profileActions.createProfile(input);
    unavailableContinuousPoolProfileIds.delete(id);
    void requestContinuousPoolPump();
    return id;
  },
  updateProfile: async (id, patch) => {
    const updated = await profileActions.updateProfile(id, patch);
    if (updated) {
      clearContinuousPoolProfileRuntimeLimit(id);
      void requestContinuousPoolPump();
    }
    return updated;
  },
  deleteProfile: async (id) => {
    clearContinuousPoolProfileRuntimeLimit(id);
    return profileActions.deleteProfile(id);
  },
  duplicateProfile: async (id) => {
    const duplicated = await profileActions.duplicateProfile(id);
    if (duplicated) void requestContinuousPoolPump();
    return duplicated;
  },
  setActiveProfile: async (id) => profileActions.setActiveProfile(id),

  clearError: () => {
    const wsId = get().activeWorkspaceId;
    set({
      errorMessage: null,
      errorRawPath: null,
      workspaces: patchWorkspaceRuntime(get().workspaces, wsId, {
        errorMessage: null,
        errorRawPath: null,
      }),
    });
  },

  selectSourceImage: async () => imageActions.selectSourceImage(),
  selectBatchInputDir: async () => imageActions.selectBatchInputDir(),
  selectBatchInputFiles: async () => imageActions.selectBatchInputFiles(),
  refreshBatchInputDir: async () => imageActions.refreshBatchInputDir(),
  chooseBatchOutputDir: async () => imageActions.chooseBatchOutputDir(),
  importSourceImageFile: async (file) => imageActions.importSourceImageFile(file),
  selectReversePromptImage: async () => imageActions.selectReversePromptImage(),
  importReversePromptImageFile: async (file) => imageActions.importReversePromptImageFile(file),
  clearReversePromptImage: () => imageActions.clearReversePromptImage(),
  removeSource: (index) => imageActions.removeSource(index),
  clearSources: () => imageActions.clearSources(),
  reorderSources: (from, to) => imageActions.reorderSources(from, to),

  submit: async () => {
    return await submitCurrentRequest(get, set);
  },

  cancel: async () => {
    const s = get();
    const workspaceId = s.activeWorkspaceId;
    const ids = [...s.runningJobs];
    const workspace = s.workspaces.find((entry) => entry.id === workspaceId);
    const taskIds = workspace?.batchTaskIds ?? [];
    const cancelledTaskIds = sortedBatchTasksForWorkspace(workspaceId, taskIds, s.batchTasksById)
      .filter((task) => task.status === "queued" || task.status === "running")
      .map((task) => task.id);
    const retainedFHLPoolJobIds = new Set(
      Object.entries(s.runningJobMeta)
        .filter(([jobId]) => shouldRetainFHLPoolCapacityOnCancel(s, jobId))
        .map(([jobId]) => jobId),
    );
    if (isBackgroundTaskProxyMode()) {
      const nextMeta = { ...get().runningJobMeta };
      for (const id of ids) {
        if (!retainedFHLPoolJobIds.has(id)) delete nextMeta[id];
      }
      const batchTasksById = markWorkspaceTasks(
        workspaceId,
        taskIds,
        get().batchTasksById,
        (task) => task.status === "queued" || task.status === "running",
        { status: "cancelled" },
      );
      const taskPatch = taskRuntimePatchForWorkspace(workspaceId, taskIds, batchTasksById);
      const cancelledPatch: WorkspacePatch = {
        ...taskPatch,
        runningJobs: [],
        progress: null,
        streamPreview: null,
        streamPreviews: {},
        lastLogLine: "",
      };
      set({
        runningJobs: [],
        isRunning: false,
        progress: null,
        streamPreview: null,
        streamPreviews: {},
        lastLogLine: "",
        batchTasksById,
        runningJobMeta: nextMeta,
        workspaces: patchWorkspaceRuntime(get().workspaces, workspaceId, cancelledPatch),
      });
      for (const id of ids) {
        try { await wailsCancel(id); } catch { /* ignore */ }
      }
      if (cancelledTaskIds.some((id) => get().batchTasksById[id]?.continuousPoolTask)) {
        void requestContinuousPoolPump();
      }
      return;
    }
    const nextMeta = { ...get().runningJobMeta };
    for (const id of ids) {
      if (!retainedFHLPoolJobIds.has(id)) delete nextMeta[id];
    }
    const batchTasksById = markWorkspaceTasks(
      workspaceId,
      taskIds,
      get().batchTasksById,
      (task) => task.status === "queued" || task.status === "running",
      { status: "cancelled" },
    );
    const taskPatch = taskRuntimePatchForWorkspace(workspaceId, taskIds, batchTasksById);
    const runPatch = {
      ...taskPatch,
      isRunning: false,
      runningJobs: [],
      progress: null,
      streamPreview: null,
      streamPreviews: {},
    };
    set({
      ...runPatch,
      batchTasksById,
      runningJobMeta: nextMeta,
      workspaces: patchWorkspaceRuntime(get().workspaces, workspaceId, runPatch),
    });
    // Mark the task terminal before the backend can deliver a late event.
    for (const id of ids) {
      try { await wailsCancel(id); } catch { /* ignore */ }
    }
    if (cancelledTaskIds.some((id) => get().batchTasksById[id]?.continuousPoolTask)) {
      void requestContinuousPoolPump();
    }
  },

  selectBatchTask: (taskId) => {
    const trimmed = typeof taskId === "string" ? taskId.trim() : "";
    const selectedBatchTaskId = trimmed ? trimmed : null;
    const state = get();
    const workspaceId = state.activeWorkspaceId;
    const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
    const task = selectedBatchTaskId ? state.batchTasksById[selectedBatchTaskId] : null;
    if (!task || task.workspaceId !== workspaceId || !(workspace?.batchTaskIds ?? []).includes(task.id)) {
      set({
        selectedBatchTaskId,
        workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, { selectedBatchTaskId }),
      });
      return;
    }
    set(sourceContextPatchFromBatchTask(state, task, selectedBatchTaskId));
    if (task.mode === "edit" && (task.sourceImagePaths?.length ?? 0) > 0) {
      void syncSharedEditAutoAspect({ getState: get, setState: set });
    }
  },

  selectBatchTaskForCancel: (taskId) => {
    get().selectBatchTask(taskId);
  },

  cancelBatchTask: async (taskId) => {
    const s = get();
    const workspaceId = s.activeWorkspaceId;
    const selectedId = typeof taskId === "string" ? taskId.trim() : "";
    const workspace = s.workspaces.find((entry) => entry.id === workspaceId);
    const taskIds = workspace?.batchTaskIds ?? [];
    const task = selectedId ? s.batchTasksById[selectedId] : null;
    if (!task || task.workspaceId !== workspaceId || !taskIds.includes(task.id)) {
      s.pushToast("No matching batch task was found", "warn", 2400);
      return;
    }
    const retryableTerminalTask = isRetryableBatchTask(task, retryHistoryByIdForState(s));
    if (task.status !== "queued" && task.status !== "running" && !retryableTerminalTask) {
      s.pushToast("This task is not queued, running, failed, or missing its final image", "warn", 2400);
      return;
    }

    clearAutoRetryTimer(task.id);
    const jobId = typeof task.jobId === "string" && task.jobId.trim() ? task.jobId.trim() : "";

    const current = get();
    const currentTask = current.batchTasksById[task.id] ?? task;
    const currentRetryableTerminalTask = isRetryableBatchTask(currentTask, retryHistoryByIdForState(current));
    if (currentTask.status !== "queued" && currentTask.status !== "running" && !currentRetryableTerminalTask) {
      return;
    }
    const now = Date.now();
    const batchTasksById: Record<string, BatchTaskRecord> = {
      ...current.batchTasksById,
      [task.id]: {
        ...currentTask,
        status: "cancelled",
        queuedReason: undefined,
        queuePriority: undefined,
        updatedAt: now,
      },
    };
    const runtime = workspaceRuntimeFromState(current, workspaceId);
    const prunedPreview = jobId ? removeStreamPreview(runtime.streamPreviews, jobId) : {
      streamPreview: runtime.streamPreview,
      streamPreviews: runtime.streamPreviews,
    };
    const taskPatch = taskRuntimePatchForWorkspace(workspaceId, taskIds, batchTasksById);
    const nextMeta = { ...current.runningJobMeta };
    if (jobId && !shouldRetainFHLPoolCapacityOnCancel(current, jobId)) delete nextMeta[jobId];
    const cancelPatch: WorkspacePatch = {
      ...taskPatch,
      selectedBatchTaskId: null,
      progress: taskPatch.runningJobs?.length ? runtime.progress : null,
      streamPreview: taskPatch.runningJobs?.length ? prunedPreview.streamPreview : null,
      streamPreviews: taskPatch.runningJobs?.length ? prunedPreview.streamPreviews : {},
      lastLogLine: taskPatch.runningJobs?.length ? runtime.lastLogLine : "",
      resultGridOpen: true,
      historyGalleryOpen: false,
    };
    set((state) => ({
      batchTasksById,
      selectedBatchTaskId: null,
      runningJobMeta: nextMeta,
      workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, cancelPatch),
      ...(state.activeWorkspaceId === workspaceId ? {
        ...activeRuntimePatch(cancelPatch),
        resultGridOpen: true,
        historyGalleryOpen: false,
      } : {}),
    } as Partial<StudioState>));
    if (jobId) {
      try { await wailsCancel(jobId); } catch { /* best effort */ }
    }
    get().pushToast(jobId
      ? "Cancelled running task; upstream work may already be billed"
      : "Cancelled queued task",
      "info",
      3600,
    );
    if (task.continuousPoolTask) {
      void requestContinuousPoolPump();
    } else {
      void pumpContinuousQueue(workspaceId, task.apiMode);
    }
  },

  cancelQueuedBatchTasks: async () => {
    const s = get();
    const workspaceId = s.activeWorkspaceId;
    const workspace = s.workspaces.find((entry) => entry.id === workspaceId);
    const taskIds = workspace?.batchTaskIds ?? [];
    const queuedTasks = sortedBatchTasksForWorkspace(workspaceId, taskIds, s.batchTasksById)
      .filter((task) => task.status === "queued");
    if (queuedTasks.length === 0) {
      s.pushToast("No queued tasks in the current batch", "info", 2200);
      return;
    }

    const queuedTaskIds = new Set(queuedTasks.map((task) => task.id));
    const current = get();
    const currentWorkspace = current.workspaces.find((entry) => entry.id === workspaceId);
    const currentTaskIds = currentWorkspace?.batchTaskIds ?? taskIds;
    const now = Date.now();
    let cancelledCount = 0;
    const cancelledJobIds = new Set<string>();
    const batchTasksById: Record<string, BatchTaskRecord> = { ...current.batchTasksById };
    for (const id of currentTaskIds) {
      const task = batchTasksById[id];
      if (!task || task.workspaceId !== workspaceId || !queuedTaskIds.has(task.id) || task.status !== "queued") continue;
      const jobId = typeof task.jobId === "string" && task.jobId.trim() ? task.jobId.trim() : "";
      if (jobId) cancelledJobIds.add(jobId);
      startingContinuousTaskIds.delete(task.id);
      clearAutoRetryTimer(task.id);
      batchTasksById[task.id] = {
        ...task,
        status: "cancelled",
        queuedReason: undefined,
        queuePriority: undefined,
        updatedAt: now,
      };
      cancelledCount += 1;
    }
    if (cancelledCount === 0) {
      get().pushToast("No cancellable queued tasks were found after refresh", "info", 2200);
      return;
    }

    const runtime = workspaceRuntimeFromState(current, workspaceId);
    let prunedPreview = {
      streamPreview: runtime.streamPreview,
      streamPreviews: runtime.streamPreviews,
    };
    for (const jobId of cancelledJobIds) {
      prunedPreview = removeStreamPreview(prunedPreview.streamPreviews, jobId);
    }
    const taskPatch = taskRuntimePatchForWorkspace(workspaceId, currentTaskIds, batchTasksById);
    const nextMeta = { ...current.runningJobMeta };
    for (const jobId of cancelledJobIds) {
      if (!shouldRetainFHLPoolCapacityOnCancel(current, jobId)) delete nextMeta[jobId];
    }
    const cancelPatch: WorkspacePatch = {
      ...taskPatch,
      selectedBatchTaskId: null,
      progress: taskPatch.runningJobs?.length ? runtime.progress : null,
      streamPreview: taskPatch.runningJobs?.length ? prunedPreview.streamPreview : null,
      streamPreviews: taskPatch.runningJobs?.length ? prunedPreview.streamPreviews : {},
      lastLogLine: taskPatch.runningJobs?.length ? runtime.lastLogLine : "",
      resultGridOpen: true,
      historyGalleryOpen: false,
    };
    set((state) => ({
      batchTasksById,
      selectedBatchTaskId: null,
      runningJobMeta: nextMeta,
      workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, cancelPatch),
      ...(state.activeWorkspaceId === workspaceId ? {
        ...activeRuntimePatch(cancelPatch),
        resultGridOpen: true,
        historyGalleryOpen: false,
      } : {}),
    } as Partial<StudioState>));
    get().pushToast(`已取消当前批次 ${cancelledCount} 个排队任务`, "info", 3200);
    for (const jobId of cancelledJobIds) {
      try { await wailsCancel(jobId); } catch { /* best effort */ }
    }
    if (queuedTasks.some((task) => task.continuousPoolTask)) void requestContinuousPoolPump();
  },

  clearFailedBatchTasks: async () => {
    const s = get();
    const workspaceId = s.activeWorkspaceId;
    const workspace = s.workspaces.find((entry) => entry.id === workspaceId);
    const taskIds = workspace?.batchTaskIds ?? [];
    const retryHistoryById = retryHistoryByIdForState(s);
    const retryableTasks = sortedBatchTasksForCurrentView(workspaceId, taskIds, s.batchTasksById)
      .filter((task) => isRetryableBatchTask(task, retryHistoryById));
    if (retryableTasks.length === 0) {
      s.pushToast("当前批次没有可清空的生成失败/终图缺失任务", "info", 2200);
      return;
    }

    const current = get();
    const currentWorkspace = current.workspaces.find((entry) => entry.id === workspaceId);
    const currentTaskIds = currentWorkspace?.batchTaskIds ?? taskIds;
    const currentRetryHistoryById = retryHistoryByIdForState(current);
    const now = Date.now();
    const clearedTaskIds = new Set(retryableTasks.map((task) => task.id));
    const clearedJobIds = new Set<string>();
    let clearedCount = 0;
    const batchTasksById: Record<string, BatchTaskRecord> = { ...current.batchTasksById };
    for (const id of currentTaskIds) {
      const task = batchTasksById[id];
      if (!task || task.workspaceId !== workspaceId || !clearedTaskIds.has(task.id) || !isRetryableBatchTask(task, currentRetryHistoryById)) continue;
      clearAutoRetryTimer(task.id);
      const jobId = typeof task.jobId === "string" && task.jobId.trim() ? task.jobId.trim() : "";
      if (jobId) clearedJobIds.add(jobId);
      batchTasksById[task.id] = {
        ...task,
        status: "cancelled",
        queuedReason: undefined,
        queuePriority: undefined,
        groupId: undefined,
        jobId: undefined,
        autoRetryScheduledAt: undefined,
        autoRetryReason: undefined,
        autoRetryCount: 0,
        updatedAt: now,
      };
      clearedCount += 1;
    }
    if (clearedCount === 0) {
      get().pushToast("刷新后没有剩余的生成失败/终图缺失任务", "info", 2200);
      return;
    }

    const runtime = workspaceRuntimeFromState(current, workspaceId);
    let prunedPreview = {
      streamPreview: runtime.streamPreview,
      streamPreviews: runtime.streamPreviews,
    };
    for (const jobId of clearedJobIds) {
      prunedPreview = removeStreamPreview(prunedPreview.streamPreviews, jobId);
    }
    const taskPatch = taskRuntimePatchForWorkspace(workspaceId, currentTaskIds, batchTasksById);
    const nextMeta = { ...current.runningJobMeta };
    for (const jobId of clearedJobIds) delete nextMeta[jobId];
    const clearPatch: WorkspacePatch = {
      ...taskPatch,
      selectedBatchTaskId: null,
      progress: taskPatch.runningJobs?.length ? runtime.progress : null,
      streamPreview: taskPatch.runningJobs?.length ? prunedPreview.streamPreview : null,
      streamPreviews: taskPatch.runningJobs?.length ? prunedPreview.streamPreviews : {},
      lastLogLine: taskPatch.runningJobs?.length ? runtime.lastLogLine : "",
      resultGridOpen: true,
      historyGalleryOpen: false,
    };
    set((state) => ({
      batchTasksById,
      selectedBatchTaskId: null,
      runningJobMeta: nextMeta,
      workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, clearPatch),
      ...(state.activeWorkspaceId === workspaceId ? {
        ...activeRuntimePatch(clearPatch),
        resultGridOpen: true,
        historyGalleryOpen: false,
      } : {}),
    } as Partial<StudioState>));
    get().pushToast(`已清空 ${clearedCount} 个生成失败/终图缺失任务`, "info", 3200);
  },

  promoteBatchTask: async (taskId) => {
    const s = get();
    const workspaceId = s.activeWorkspaceId;
    const selectedId = typeof taskId === "string" ? taskId.trim() : "";
    const workspace = s.workspaces.find((entry) => entry.id === workspaceId);
    const taskIds = workspace?.batchTaskIds ?? [];
    const task = selectedId ? s.batchTasksById[selectedId] : null;
    if (!task || task.workspaceId !== workspaceId || !taskIds.includes(task.id)) {
      s.pushToast("没有找到对应的排队任务", "warn", 2400);
      return;
    }
    if (task.status !== "queued" || task.jobId || task.queuedReason !== "local_concurrency") {
      s.pushToast("这个排队任务当前不能立即插队", "warn", 3000);
      return;
    }

    const current = get();
    const currentTask = current.batchTasksById[task.id] ?? task;
    if (currentTask.status !== "queued" || currentTask.jobId || currentTask.queuedReason !== "local_concurrency") {
      current.pushToast("这个排队任务状态已经变化，请刷新后重试", "warn", 2600);
      return;
    }
    if (startingContinuousTaskIds.has(currentTask.id)) {
      current.pushToast("这个排队任务已经在启动中", "info", 2400);
      return;
    }
    const batchTasksById: Record<string, BatchTaskRecord> = {
      ...current.batchTasksById,
      [currentTask.id]: {
        ...currentTask,
        updatedAt: Date.now(),
      },
    };
    const taskPatch = taskRuntimePatchForWorkspace(workspaceId, taskIds, batchTasksById);
    const promotePatch: WorkspacePatch = {
      ...taskPatch,
      resultGridOpen: true,
      historyGalleryOpen: false,
    };
    set((state) => ({
      batchTasksById,
      workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, promotePatch),
      ...(state.activeWorkspaceId === workspaceId ? {
        ...activeRuntimePatch(promotePatch),
        resultGridOpen: true,
        historyGalleryOpen: false,
      } : {}),
    } as Partial<StudioState>));
    const started = await startContinuousQueuedTask(currentTask.id);
    if (started) {
      get().pushToast("已立即插队，新增一个并发任务", "success", 2800);
      return;
    }
    get().pushToast("排队任务暂时无法立即启动，请稍后再试", "warn", 3200);
  },

  cancelSelectedTask: async () => {
    const selectedId = get().selectedBatchTaskId;
    if (!selectedId) {
      get().pushToast("没有选中的批次任务可取消", "warn", 2400);
      return;
    }
    await get().cancelBatchTask(selectedId);
  },

  recoverRunningHubResult: async (taskId) => {
    const state = get();
    const task = state.batchTasksById[taskId];
    if (!task) {
      state.pushToast("No matching RunningHub task was found", "warn", 2800);
      return null;
    }
    if (task.apiMode !== "runninghub") {
      state.pushToast("This task was not generated through the RunningHub bridge", "warn", 3200);
      return null;
    }
    const historyById = new Map(state.history.map((item) => [item.id, item]));
    if (task.status === "succeeded" && batchTaskHasResult(task, historyById)) {
      state.pushToast("This RunningHub result is already synced locally", "info", 2600);
      return task.historyItemId ? (historyById.get(task.historyItemId) ?? null) : null;
    }
    if (task.status === "queued" || task.status === "running" || task.status === "cancelled") {
      state.pushToast("This task is still queued, running, or cancelled; it cannot be recovered yet", "warn", 3400);
      return null;
    }
    const workspace = state.workspaces.find((entry) => entry.id === task.workspaceId);
    const profile = state.profiles.find((entry) => entry.id === task.apiProfileId)
      ?? state.profiles.find((entry) => entry.apiMode === "runninghub" && entry.imageModelID === task.imageModelID)
      ?? state.profiles.find((entry) => entry.apiMode === "runninghub")
      ?? null;
    const baseURL = cleanBaseURL(String(profile?.baseURL || state.baseURL || "").trim());
    if (!baseURL) {
      state.pushToast("RunningHub bridge base URL is missing", "error", 3600);
      return null;
    }
    const modelKey = String(task.imageModelID || profile?.imageModelID || "banana2").trim() || "banana2";
    const sizeSelection = runningHubSizeSelection(task.size, task.mode);
    try {
      state.pushToast(
        `Re-syncing RunningHub result: ${modelKey} ${sizeSelection.aspectRatio} ${sizeSelection.resolution}`,
        "info",
        2600,
      );
      const recoveredTask = await recoverRunningHubTask(baseURL, {
        prompt: task.prompt,
        mode: task.mode,
        model: modelKey,
        size: task.size,
      });
      const firstImage = Array.isArray(recoveredTask.images) ? recoveredTask.images[0] : null;
      if (!firstImage) {
        throw new Error("RunningHub bridge returned no recoverable image");
      }
      const imageB64 = await fetchRunningHubResultImage(baseURL, firstImage);
      const imported = await ImportImageFromB64(imageB64, `runninghub-recovered-${task.slotIndex + 1}.png`);
      const ref = await RegisterImportedImageAsset(imported.path).catch(() => null);
      const historyItem = ref
        ? withMediaAssetRef(recoveredRunningHubHistoryItem(task, recoveredTask, imported, imageB64), ref)
        : recoveredRunningHubHistoryItem(task, recoveredTask, imported, imageB64);
      const activeItem: HistoryItem = { ...historyItem, previewOnly: false };
      set((current) => {
        const nextHistory = trimHistory([
          historyItem,
          ...current.history.filter((item) => item.id !== historyItem.id),
        ]);
        const mergedBatch = mergeWorkspaceBatchResult(current, task.workspaceId, historyItem, nextHistory);
        let nextTasksById = updateTaskFromHistoryItem(
          current.batchTasksById,
          workspace?.batchTaskIds ?? [],
          task.workspaceId,
          historyItem,
        );
        const recoveredRecord = nextTasksById[task.id];
        if (recoveredRecord) {
          nextTasksById = {
            ...nextTasksById,
            [task.id]: {
              ...recoveredRecord,
              errorMessage: undefined,
              lastLogLine: "Recovered from RunningHub bridge",
            },
          };
        }
        const keepGridOpen = (workspace?.resultGridOpen ?? false) || ((workspace?.batchTaskIds?.length ?? 0) > 1);
        const previousCurrentImageId = current.activeWorkspaceId === task.workspaceId
          ? current.currentImage?.id ?? workspace?.currentImageId ?? null
          : workspace?.currentImageId ?? null;
        const workspacePatch: WorkspacePatch = {
          batchResultIds: mergedBatch.batchResultIds,
          currentImageId: keepGridOpen ? previousCurrentImageId : historyItem.id,
          resultGridOpen: keepGridOpen,
        };
        return {
          history: nextHistory,
          batchTasksById: nextTasksById,
          batchResults: current.activeWorkspaceId === task.workspaceId ? mergedBatch.batchResults : current.batchResults,
          workspaces: patchWorkspaceRuntime(current.workspaces, task.workspaceId, workspacePatch),
          ...(current.activeWorkspaceId === task.workspaceId
            ? {
                currentImage: keepGridOpen ? current.currentImage : activeItem,
                resultGridOpen: keepGridOpen,
                maskDataURL: null,
                annotations: [],
                tool: "pan",
              }
            : {}),
        } as Partial<StudioState>;
      });
      await persistHistoryItem(historyItem).catch(() => undefined);
      persistTrimmedHistory(useStudioStore.getState().history);
      clearAutoRetryTimer(task.id);
      syncBatchOutputAfterSuccess(batchProcessLinkFromTask(task), historyItem.savedPath);
      const autoPastedPanorama = await autoPastePanoramaRoundtripResult(historyItem, {
        workspaceId: task.workspaceId,
        selectAsCurrent: !(workspace?.resultGridOpen ?? false) && (workspace?.batchTaskIds?.length ?? 0) <= 1,
      }).catch((error: any) => {
        useStudioStore.getState().pushToast(`Panorama paste-back failed: ${error?.message ?? error}`, "warn", 4200);
        return null;
      });
      get().pushToast(autoPastedPanorama ? "RunningHub result re-synced and pasted back" : "RunningHub result re-synced", "success", 3400);
      return historyItem;
    } catch (error: any) {
      state.pushToast(`RunningHub re-sync failed: ${error?.message ?? error}`, "error", 5200);
      return null;
    }
  },

  recoverAPIMartResult: async (taskId) => {
    const state = get();
    const task = state.batchTasksById[taskId];
    if (!task) {
      state.pushToast("没有找到对应的 APIMart 任务", "warn", 2800);
      return null;
    }
    if (task.apiMode !== "apimart") {
      state.pushToast("这个任务不是通过 APIMart 生成的", "warn", 3200);
      return null;
    }
    const historyById = new Map(state.history.map((item) => [item.id, item]));
    if (task.status === "succeeded" && batchTaskHasResult(task, historyById)) {
      state.pushToast("这个 APIMart 结果已经同步到本地", "info", 2600);
      return task.historyItemId ? (historyById.get(task.historyItemId) ?? null) : null;
    }
    if (task.status === "queued" || task.status === "running") {
      state.pushToast("这个任务仍在排队或运行中，暂时不能重新同步", "warn", 3400);
      return null;
    }
    const apimartTaskId = await recoverableAPIMartTaskId(task);
    if (!apimartTaskId) {
      state.pushToast("这个 APIMart 任务没有保存 task_id，无法重新同步结果", "warn", 4200);
      return null;
    }
    const workspace = state.workspaces.find((entry) => entry.id === task.workspaceId);
    const profile = state.profiles.find((entry) => entry.id === task.apiProfileId)
      ?? state.profiles.find((entry) => entry.apiMode === "apimart" && entry.imageModelID === task.imageModelID)
      ?? state.profiles.find((entry) => entry.apiMode === "apimart")
      ?? null;
    const baseURL = cleanBaseURL(String(profile?.baseURL || state.baseURL || "").trim());
    if (!baseURL) {
      state.pushToast("缺少 APIMart baseURL，无法重新同步", "error", 3600);
      return null;
    }
    const apiKey = await apiKeyForProfileOrState(state, task.apiProfileId || profile?.id);
    if (!apiKey.trim()) {
      state.pushToast("缺少 APIMart API Key，无法查询任务结果", "error", 3600);
      return null;
    }
    try {
      state.pushToast(`正在重新同步 APIMart 结果：${apimartTaskId}`, "info", 2600);
      const recoveredTask = await recoverAPIMartTask(baseURL, apiKey, apimartTaskId);
      const firstImage = Array.isArray(recoveredTask.images) ? recoveredTask.images[0] : null;
      if (!firstImage) {
        throw new Error("APIMart 任务没有可同步的图片结果");
      }
      const imageB64 = await fetchAPIMartResultImage(firstImage);
      const imported = await ImportImageFromB64(imageB64, `apimart-recovered-${task.slotIndex + 1}.png`);
      const ref = await RegisterImportedImageAsset(imported.path).catch(() => null);
      const historyItem = ref
        ? withMediaAssetRef(recoveredAPIMartHistoryItem(task, recoveredTask, imported, imageB64), ref)
        : recoveredAPIMartHistoryItem(task, recoveredTask, imported, imageB64);
      const activeItem: HistoryItem = { ...historyItem, previewOnly: false };
      set((current) => {
        const nextHistory = trimHistory([
          historyItem,
          ...current.history.filter((item) => item.id !== historyItem.id),
        ]);
        const mergedBatch = mergeWorkspaceBatchResult(current, task.workspaceId, historyItem, nextHistory);
        let nextTasksById = updateTaskFromHistoryItem(
          current.batchTasksById,
          workspace?.batchTaskIds ?? [],
          task.workspaceId,
          historyItem,
        );
        const recoveredRecord = nextTasksById[task.id];
        if (recoveredRecord) {
          nextTasksById = {
            ...nextTasksById,
            [task.id]: {
              ...recoveredRecord,
              apimartTaskId,
              apimartTaskExpiresAt: recoveredTask.expiresAt,
              errorMessage: undefined,
              lastLogLine: "已重新同步 APIMart 结果",
            },
          };
        }
        const keepGridOpen = (workspace?.resultGridOpen ?? false) || ((workspace?.batchTaskIds?.length ?? 0) > 1);
        const previousCurrentImageId = current.activeWorkspaceId === task.workspaceId
          ? current.currentImage?.id ?? workspace?.currentImageId ?? null
          : workspace?.currentImageId ?? null;
        const workspacePatch: WorkspacePatch = {
          batchResultIds: mergedBatch.batchResultIds,
          currentImageId: keepGridOpen ? previousCurrentImageId : historyItem.id,
          resultGridOpen: keepGridOpen,
        };
        return {
          history: nextHistory,
          batchTasksById: nextTasksById,
          batchResults: current.activeWorkspaceId === task.workspaceId ? mergedBatch.batchResults : current.batchResults,
          workspaces: patchWorkspaceRuntime(current.workspaces, task.workspaceId, workspacePatch),
          ...(current.activeWorkspaceId === task.workspaceId
            ? {
                currentImage: keepGridOpen ? current.currentImage : activeItem,
                resultGridOpen: keepGridOpen,
                maskDataURL: null,
                annotations: [],
                tool: "pan",
              }
            : {}),
        } as Partial<StudioState>;
      });
      await persistHistoryItem(historyItem).catch(() => undefined);
      persistTrimmedHistory(useStudioStore.getState().history);
      clearAutoRetryTimer(task.id);
      syncBatchOutputAfterSuccess(batchProcessLinkFromTask(task), historyItem.savedPath);
      const autoPastedPanorama = await autoPastePanoramaRoundtripResult(historyItem, {
        workspaceId: task.workspaceId,
        selectAsCurrent: !(workspace?.resultGridOpen ?? false) && (workspace?.batchTaskIds?.length ?? 0) <= 1,
      }).catch((error: any) => {
        useStudioStore.getState().pushToast(`全景贴回失败: ${error?.message ?? error}`, "warn", 4200);
        return null;
      });
      get().pushToast(autoPastedPanorama ? "APIMart 结果已重新同步并贴回全景图" : "APIMart 结果已重新同步", "success", 3400);
      return historyItem;
    } catch (error: any) {
      state.pushToast(`APIMart 重新同步失败: ${error?.message ?? error}`, "error", 5200);
      return null;
    }
  },

  recoverAPIMartTaskResult: async (apimartTaskId, options) => {
    const state = get();
    const cleanTaskId = extractAPIMartTaskIdFromText(apimartTaskId);
    if (!cleanTaskId) {
      state.pushToast("没有找到有效的 APIMart task_id", "warn", 3000);
      return null;
    }
    const activeProfile = state.profiles.find((entry) => entry.id === state.activeProfileId && entry.apiMode === "apimart") ?? null;
    const profile = activeProfile
      ?? state.profiles.find((entry) => entry.apiMode === "apimart")
      ?? null;
    const baseURL = cleanBaseURL(String(profile?.baseURL || (state.apiMode === "apimart" ? state.baseURL : "") || "").trim());
    if (!baseURL) {
      state.pushToast("缺少 APIMart baseURL，无法重新同步", "error", 3600);
      return null;
    }
    let apiKey = profile ? await apiKeyForProfileOrState(state, profile.id) : "";
    if (!apiKey.trim() && state.apiMode === "apimart") apiKey = state.apiKey;
    if (!apiKey.trim()) {
      state.pushToast("缺少 APIMart API Key，无法查询任务结果", "error", 3600);
      return null;
    }
    const workspaceId = state.activeWorkspaceId || state.workspaces[0]?.id || genId();
    const now = Date.now();
    const task: BatchTaskRecord = {
      id: `apimart-direct:${cleanTaskId}`,
      workspaceId,
      slotIndex: 0,
      status: "succeeded",
      createdAt: now,
      updatedAt: now,
      mode: state.mode || "generate",
      apiMode: "apimart",
      apiProfileId: profile?.id,
      apiProfileName: profile?.name,
      prompt: "APIMart 重新同步结果",
      size: state.size || "auto",
      quality: state.quality || "auto",
      outputFormat: state.outputFormat || "png",
      requestPolicy: profile?.requestPolicy ?? state.requestPolicy,
      imagesNewAPICompat: profile?.imagesNewAPICompat ?? state.imagesNewAPICompat,
      textModelID: profile?.textModelID || state.textModelID,
      imageModelID: profile?.imageModelID || state.imageModelID,
      rawPath: options?.rawPath,
      apimartTaskId: cleanTaskId,
    };
    try {
      state.pushToast(`正在重新同步 APIMart 结果：${cleanTaskId}`, "info", 2600);
      const recoveredTask = await recoverAPIMartTask(baseURL, apiKey, cleanTaskId);
      const firstImage = Array.isArray(recoveredTask.images) ? recoveredTask.images[0] : null;
      if (!firstImage) {
        throw new Error("APIMart 任务没有可同步的图片结果");
      }
      const imageB64 = await fetchAPIMartResultImage(firstImage);
      const imported = await ImportImageFromB64(imageB64, `apimart-recovered-${cleanTaskId}.png`);
      const ref = await RegisterImportedImageAsset(imported.path).catch(() => null);
      const historyItem = ref
        ? withMediaAssetRef(recoveredAPIMartHistoryItem(task, recoveredTask, imported, imageB64), ref)
        : recoveredAPIMartHistoryItem(task, recoveredTask, imported, imageB64);
      const activeItem: HistoryItem = { ...historyItem, previewOnly: false };
      set((current) => {
        const workspace = current.workspaces.find((entry) => entry.id === workspaceId);
        const keepGridOpen = current.activeWorkspaceId === workspaceId
          ? current.resultGridOpen
          : (workspace?.resultGridOpen ?? false);
        const nextHistory = trimHistory([
          historyItem,
          ...current.history.filter((item) => item.id !== historyItem.id),
        ]);
        const previousCurrentImageId = current.activeWorkspaceId === workspaceId
          ? current.currentImage?.id ?? workspace?.currentImageId ?? null
          : workspace?.currentImageId ?? null;
        const workspacePatch: WorkspacePatch = {
          currentImageId: keepGridOpen ? previousCurrentImageId : historyItem.id,
          resultGridOpen: keepGridOpen,
        };
        return {
          history: nextHistory,
          workspaces: patchWorkspaceRuntime(current.workspaces, workspaceId, workspacePatch),
          ...(current.activeWorkspaceId === workspaceId
            ? {
                currentImage: keepGridOpen ? current.currentImage : activeItem,
                resultGridOpen: keepGridOpen,
                maskDataURL: null,
                annotations: [],
                tool: "pan",
              }
            : {}),
        } as Partial<StudioState>;
      });
      await persistHistoryItem(historyItem).catch(() => undefined);
      persistTrimmedHistory(useStudioStore.getState().history);
      get().pushToast("APIMart 结果已重新同步", "success", 3400);
      return historyItem;
    } catch (error: any) {
      state.pushToast(`APIMart 重新同步失败: ${error?.message ?? error}`, "error", 5200);
      return null;
    }
  },

  applyHistoryParams: (item) => imageActions.applyHistoryParams(item),
  regenerateFromHistory: async (item) => imageActions.regenerateFromHistory(item),
  reuseAsSource: async (item) => imageActions.reuseAsSource(item),
  repastePanoramaRoundtrip: async (item, options) => {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) {
      get().pushToast("当前没有可用工作区", "warn", 2600);
      return null;
    }
    try {
      const repasted = await autoPastePanoramaRoundtripResult(item, {
        workspaceId,
        selectAsCurrent: options?.selectAsCurrent ?? true,
        alignment: options?.alignment ?? null,
        pasteMask: options?.pasteMask ?? null,
      });
      if (!repasted) {
        get().pushToast("这张图没有可用的全景贴回信息", "warn", 3200);
        return null;
      }
      get().pushToast("已重新贴回全景图", "success", 3200);
      return repasted;
    } catch (error: any) {
      get().pushToast(`全景贴回失败: ${error?.message ?? error}`, "warn", 4200);
      return null;
    }
  },
  importExternalPanoramaPastebackImage: async (anchorItem, file) => {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) {
      get().pushToast("当前没有可用工作区", "warn", 2600);
      return null;
    }
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      get().pushToast(`不支持的图片类型: ${file.type || "(未知)"}，请用 PNG/JPG/WebP`, "warn", 3600);
      return null;
    }
    anchorItem = recoverPanoramaItemMetadata(anchorItem, get().history);
    const roundtrip = resolvePanoramaRoundtripRef(anchorItem);
    if (!roundtrip) {
      get().pushToast("当前图片没有可贴回的 360 镜头信息", "warn", 3200);
      return null;
    }
    try {
      const imageB64 = await fileToBase64(file);
      const dimensions = getImageDimensionsFromBase64(imageB64);
      if (!dimensions) {
        get().pushToast("无法读取导入图片尺寸", "warn", 3200);
        return null;
      }
      const expectedAspect = Number(roundtrip.roundtripState.source_aspect || 0);
      const actualAspect = dimensions.w / Math.max(1, dimensions.h);
      const relativeDelta = expectedAspect > 0
        ? Math.abs(actualAspect - expectedAspect) / Math.max(1e-6, expectedAspect)
        : 0;
      if (expectedAspect > 0 && relativeDelta > 0.01) {
        get().pushToast(
          `导入图比例不匹配: ${dimensions.w}x${dimensions.h}，需要接近 ${expectedAspect.toFixed(3)}:1`,
          "warn",
          5200,
        );
        return null;
      }
      const imported = await ImportImageFromB64(imageB64, file.name);
      const ref = await RegisterImportedImageAsset(imported.path).catch(() => null);
      const item = ref
        ? withMediaAssetRef(externalPanoramaPastebackItem(imported, file, imageB64, anchorItem, roundtrip, dimensions), ref)
        : externalPanoramaPastebackItem(imported, file, imageB64, anchorItem, roundtrip, dimensions);
      set((state) => ({
        history: trimHistory([item, ...state.history.filter((entry) => entry.id !== item.id)]),
        currentImage: item,
        resultGridOpen: false,
        historyGalleryOpen: false,
        historyGallerySinglePreviewId: null,
        panoramaAlignTarget: item,
        errorMessage: null,
        errorRawPath: null,
        workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, {
          currentImageId: item.id,
          resultGridOpen: false,
          historyGalleryOpen: false,
        }),
      } as Partial<StudioState>));
      await persistHistoryItem(item).catch(() => undefined);
      persistTrimmedHistory(get().history);
      get().pushToast("已导入外部贴回图，进入手动对齐", "success", 3200);
      return item;
    } catch (error: any) {
      get().pushToast(`导入贴回图失败: ${error?.message ?? error}`, "error", 4200);
      return null;
    }
  },
  deleteHistoryItem: async (id) => imageActions.deleteHistoryItem(id),
  saveCurrentImageAs: async () => imageActions.saveCurrentImageAs(),
  saveHistoryItemAs: async (item) => imageActions.saveHistoryItemAs(item),
  shareCurrentImage: async () => imageActions.shareCurrentImage(),
  shareHistoryItem: async (item) => imageActions.shareHistoryItem(item),

  bootstrap: async () => {
    if (isE2EOnlyBootstrap()) {
      const workspaceId = genId();
      const workspace = initialWorkspaceForBootstrap(workspaceId, "png");
      applyTheme("system");
      document.documentElement.style.setProperty("--font-scale", "1");
      setKernelRuntimeMode("auto");
      set({
        apiKey: "",
        profiles: [],
        activeProfileId: "",
        baseURL: "",
        textModelID: "",
        imageModelID: "",
        mode: "generate",
        promptPrefix: "",
        prompt: "",
        optimizationGuidance: "",
        negativePrompt: "",
        size: DEFAULT_FHL_SIZE,
        quality: "medium",
        outputFormat: "png",
        seed: 0,
        apiMode: "responses",
        fhlTransportMode: "images",
        fhlTextAPIConfigured: false,
        fhlTextAPIKeyHint: "",
        fhlTextAPITestStatus: "unconfigured",
        fhlTextAPITestMessage: "",
        requestPolicy: "openai",
        imagesNewAPICompat: false,
        sources: [],
        currentImage: null,
        sourcePreviewReturnImage: null,
        history: [],
        historyHasMore: false,
        historyLoading: false,
        historyCursor: null,
        batchResults: [],
        selectedBatchTaskId: null,
        resultGridOpen: false,
        historyGalleryOpen: false,
        historyGallerySinglePreviewId: null,
        materialGroups: [],
        promptHistory: [],
        presets: [],
        runningJobs: [],
        jobsTotal: 0,
        jobsCompleted: 0,
        jobsFailed: 0,
        progress: null,
        streamPreview: null,
        streamPreviews: {},
        runningJobMeta: {},
        jobGroupsByWorkspace: {},
        batchTasksById: {},
        continuousGenerateTest: false,
        fhlPoolPerAPIConcurrencyLimit: DEFAULT_CONCURRENCY_LIMIT,
        fhlPoolEffectiveConcurrencyByProfileId: {},
        editSourceMode: "manual",
        batchProcess: defaultBatchProcessConfig(),
        workspaces: [workspace],
        activeWorkspaceId: workspaceId,
        theme: "system",
        fontScale: 1,
        settingsOpen: false,
        upstreamModalOpen: false,
        errorMessage: null,
        errorRawPath: null,
        isRunning: false,
        lastPayload: null,
      });
      document.documentElement.dataset.e2eStoreReady = "true";
      return;
    }
    await migrateStableNamespaceData({
      getKey: GetStoredAPIKey,
      setKey: SetStoredAPIKey,
    }).catch((error) => {
      if (typeof console !== "undefined") console.warn("storage namespace migration failed", error);
    });
    purgeForeignAPIKeyStorageKeys();
    const previewScenario = readPreviewScenario();
    if (previewScenario === "mac-workspace") {
      const workspaceId = genId();
      const preview = buildMacWorkspacePreview(workspaceId);
      applyTheme("dark");
      document.documentElement.style.setProperty("--font-scale", "1");
      setKernelRuntimeMode("auto");
      set({
        apiKey: "sk-preview",
        mode: "edit",
        promptPrefix: preview.workspace.promptPrefix,
        prompt: preview.currentImage.prompt,
        optimizationGuidance: preview.workspace.optimizationGuidance,
        negativePrompt: preview.currentImage.negativePrompt ?? "",
        size: preview.currentImage.size,
        quality: preview.currentImage.quality,
        outputFormat: "png",
        seed: preview.currentImage.seed ?? 3200,
        kernelRuntimeMode: "auto",
        baseURL: preview.profile.baseURL,
        textModelID: preview.profile.textModelID,
        imageModelID: preview.profile.imageModelID,
        proxyMode: "system",
        proxyURL: "",
        apiMode: preview.profile.apiMode,
        requestPolicy: preview.profile.requestPolicy,
        imagesNewAPICompat: preview.profile.imagesNewAPICompat ?? false,
        noPromptRevision: true,
  editAutoAspectUserLocked: false,
        profiles: [preview.profile],
        activeProfileId: preview.profile.id,
        sources: preview.sources,
        reversePromptImage: null,
        runningJobs: [],
        jobsTotal: 0,
        jobsCompleted: 0,
        jobsFailed: 0,
        progress: null,
        streamPreview: null,
        streamPreviews: {},
        lastLogLine: "",
        errorMessage: null,
        errorRawPath: null,
        isRunning: false,
        lastPayload: null,
        runningJobMeta: {},
        jobGroupsByWorkspace: {},
        currentImage: preview.currentImage,
        history: preview.history,
        historyHasMore: false,
        historyLoading: false,
        historyCursor: null,
        batchResults: [],
        resultGridOpen: false,
        historyGalleryOpen: false,
        materialManagerOpen: false,
        materialGroups: [],
        historyRailCollapsed: false,
        historyTimelineOpen: false,
        tool: "pan",
        brushSize: 24,
        brushMode: "paint",
        annotationKind: "rect",
        annotationColor: "#ff4d4d",
        selectedAnnotationId: null,
        maskDataURL: null,
        strokes: [],
        annotations: [],
        compareB: null,
        compareMode: "curtain",
        compareSplit: 0.5,
        toasts: [],
        recentDurations: preview.history.map((item) => item.elapsedSec ?? 0).filter((value) => value > 0),
        viewZoom: 1,
        canvasViewResetTick: 0,
        fullscreen: false,
        promptHistory: [],
        batchCount: 1,
        editSourceMode: preview.workspace.editSourceMode ?? "manual",
        batchProcess: normalizeBatchProcessConfig(preview.workspace.batchProcess),
        presets: [],
        theme: "dark",
        fontScale: 1,
        workspaces: [preview.workspace],
        activeWorkspaceId: workspaceId,
        styleTag: preview.currentImage.styleTag ?? "",
        undoStack: [],
        redoStack: [],
        resultDetail: null,
        settingsOpen: false,
        isTestingKey: false,
        isOptimizingPrompt: false,
        isReversingPrompt: false,
        upstreamModalOpen: false,
        upstreamReturnTarget: "app",
        starPromptOpen: false,
        starPromptSource: "auto",
      });
      return;
    }

    const initialHistoryPage = await loadHistoryPage({ limit: INITIAL_HISTORY_LOAD });
    let items = trimHistory(initialHistoryPage.items);
    const materialGroups = loadMaterialGroups();
    let promptHistory: string[] = [];
    let presets: Preset[] = [];
    let theme: ThemeMode = "system";
    let fontScale = 1;
    try {
      const raw = localStorage.getItem(PROMPT_HISTORY_KEY);
      if (raw) promptHistory = JSON.parse(raw);
    } catch {}
    try {
      const raw = localStorage.getItem(PRESETS_KEY);
      if (raw) presets = JSON.parse(raw);
    } catch {}
    try {
      const raw = localStorage.getItem(THEME_KEY);
      if (raw === "system" || raw === "light" || raw === "dark") theme = raw;
    } catch {}
    try {
      const raw = localStorage.getItem(FONT_SCALE_KEY);
      const n = Number(raw);
      if (!Number.isNaN(n) && n > 0.5 && n < 2) fontScale = n;
    } catch {}
    let kernelRuntimeMode: KernelRuntimeMode = "auto";
    try {
      const v = localStorage.getItem(KERNEL_RUNTIME_MODE_KEY);
      if (v === "auto" || v === "local" || v === "remote") kernelRuntimeMode = v;
    } catch {}
    const noPromptRevision = true;
    const proxyConfig = loadProxyConfig();
    let outputFormat: OutputFormatValue = "png";
    try {
      const v = localStorage.getItem(OUTPUT_FORMAT_KEY);
      if (v === "png" || v === "jpeg" || v === "webp") outputFormat = v;
    } catch {}
    // ---- v0.1.6 profile migration / keyring sync ----
    // 1) Keep profile ids in gptcodex.profiles.
    // 2) Move legacy shared responses/images config into profiles and keyring.
    //    Existing localStorage values remain as fallback only.
    let profiles = loadStoredProfiles();
    const fhlTransportMode = loadStoredFHLTransportMode();
    let activeProfileId = loadStoredActiveProfileId();
    if (profiles.length === 0 && ENABLE_LEGACY_PROFILE_MIGRATION) {
      // Build profiles from legacy shared config when no profiles exist.
      let legacyApiMode: APIMode = "responses";
      try {
        const v = localStorage.getItem(storageKey("gptcodex.apiMode"));
        if (v === "images" || v === "responses") legacyApiMode = v;
      } catch {}
      const legacyResponses = loadModeConfig("responses");
      const legacyImages = loadModeConfig("images");
      // Migrate v0.1.5 legacy shared baseURL into the active legacy mode.
      const legacyBaseURL  = (() => { try { return localStorage.getItem(storageKey("gptcodex.baseURL")) ?? ""; } catch { return ""; } })();
      const legacyTextID   = (() => { try { return localStorage.getItem(storageKey("gptcodex.textModelID")) ?? ""; } catch { return ""; } })();
      const legacyImageID  = (() => { try { return localStorage.getItem(storageKey("gptcodex.imageModelID")) ?? ""; } catch { return ""; } })();
      if (legacyApiMode === "responses" && legacyBaseURL && !legacyResponses.baseURL) {
        legacyResponses.baseURL = cleanBaseURL(legacyBaseURL);
        legacyResponses.textModelID = legacyTextID;
        legacyResponses.imageModelID = legacyImageID;
      } else if (legacyApiMode === "images" && legacyBaseURL && !legacyImages.baseURL) {
        legacyImages.baseURL = cleanBaseURL(legacyBaseURL);
        legacyImages.imageModelID = legacyImageID;
      }
      const legacySharedKey = loadLegacySharedAPIKey();
      const legacyResponsesKey = await GetStoredAPIKey("responses").catch(() => "")
        || loadLegacyModeAPIKey("responses")
        || (legacyApiMode === "responses" ? legacySharedKey : "");
      const legacyImagesKey = await GetStoredAPIKey("images").catch(() => "")
        || loadLegacyModeAPIKey("images")
        || (legacyApiMode === "images" ? legacySharedKey : "");
      const synth: UpstreamProfile[] = [];
      if (legacyResponses.baseURL || legacyResponsesKey) {
        const id = genProfileId();
        synth.push({
          id,
          name: "Responses (Legacy)",
          apiMode: "responses",
          requestPolicy: "openai",
          baseURL: legacyResponses.baseURL,
          textModelID: legacyResponses.textModelID,
          imageModelID: legacyResponses.imageModelID,
          concurrencyLimit: normalizeConcurrencyLimit(legacyResponses.concurrencyLimit),
          imagesNewAPICompat: false,
          createdAt: Date.now(),
          lastUsedAt: legacyApiMode === "responses" ? Date.now() : undefined,
        });
        if (legacyResponsesKey) {
          try { await SetStoredAPIKey(keyringUserFor(id), legacyResponsesKey); } catch {}
        }
      }
      if (legacyImages.baseURL || legacyImagesKey) {
        const id = genProfileId();
        synth.push({
          id,
          name: "Images (Legacy)",
          apiMode: "images",
          requestPolicy: "openai",
          baseURL: legacyImages.baseURL,
          textModelID: legacyImages.textModelID,
          imageModelID: legacyImages.imageModelID,
          concurrencyLimit: normalizeConcurrencyLimit(legacyImages.concurrencyLimit),
          imagesNewAPICompat: false,
          createdAt: Date.now(),
          lastUsedAt: legacyApiMode === "images" ? Date.now() : undefined,
        });
        if (legacyImagesKey) {
          try { await SetStoredAPIKey(keyringUserFor(id), legacyImagesKey); } catch {}
        }
      }
      if (synth.length > 0) {
        profiles = synth;
        // Prefer the profile matching the previous API mode.
        const matching = synth.find((p) => p.apiMode === legacyApiMode);
        activeProfileId = (matching ?? synth[0]).id;
        persistProfiles(profiles);
        persistActiveProfileId(activeProfileId);
        // Remove legacy keyring/localStorage entries after migration.
        try { await DeleteStoredAPIKey("responses"); } catch {}
        try { await DeleteStoredAPIKey("images"); } catch {}
        clearLegacyAPIKeys();
        clearLegacyModeLocalStorage();
      }
    }

    // Load backend-provided FHL defaults and reconcile them into profiles.
    const localFHLConfig = await loadLocalFHLConfig();
    const localFHLBaseURL = cleanBaseURL(localFHLConfig?.baseURL || FHL_BASE_URL);
    const localFHLAPIMode: APIMode = localFHLConfig?.apiMode || "images";
    const localFHLRequestPolicy: RequestPolicy = localFHLConfig?.requestPolicy || "openai";
    const localFHLTextModelID = (localFHLConfig?.textModelID || FHL_TEXT_MODEL_ID).trim();
    const localFHLImageModelID = (localFHLConfig?.imageModelID || FHL_IMAGE_MODEL_ID).trim();
    let profilesChangedForFHL = false;
    let fhlProfileId = profiles.find((profile) => (
      profile.id === FHL_PROFILE_ID
      || (
        isOfficialFHLProfile(profile)
        && profile.imageModelID === ProviderPolicy.fhl.imageModelID
      )
    ))?.id;

    if (
      !fhlProfileId
      && (profiles.length === 0 || localFHLConfig)
      && hasUpstreamProfileCapacity(profiles)
    ) {
      const profile = localFHLAPIMode === "responses"
        ? makeFHLResponsesProfile()
        : makeFHLImagesProfile();
      profiles = [...profiles, profile];
      fhlProfileId = profile.id;
      profilesChangedForFHL = true;
    }

    // An explicit local FHL config remains the source of truth. Without one,
    // preserve saved profiles so changing the fresh-install default is not a
    // silent migration for existing users.
    if (fhlProfileId && localFHLConfig) {
      profiles = profiles.map((profile) => {
        if (profile.id !== fhlProfileId) return profile;
        const next: UpstreamProfile = {
          ...profile,
          name: profile.name || "FHL Responses",
          apiMode: localFHLAPIMode,
          requestPolicy: localFHLRequestPolicy,
          baseURL: localFHLBaseURL,
          textModelID: localFHLTextModelID,
          imageModelID: localFHLImageModelID,
          imagesNewAPICompat: localFHLAPIMode === "images",
        };
        if (JSON.stringify(next) !== JSON.stringify(profile)) profilesChangedForFHL = true;
        return next;
      });
      if (localFHLConfig) {
        activeProfileId = fhlProfileId;
        persistActiveProfileId(activeProfileId);
        if (localFHLConfig.apiKey.trim()) {
          try { await SetStoredAPIKey(keyringUserFor(fhlProfileId), localFHLConfig.apiKey.trim()); } catch {}
        }
      }
    }

    if (profiles.length === 0) {
      const profile = makeFHLImagesProfile();
      profiles = [profile];
      activeProfileId = profile.id;
      profilesChangedForFHL = true;
      persistActiveProfileId(activeProfileId);
    }

    const concurrencyDefaultMigrated = (() => {
      try { return localStorage.getItem(CONCURRENCY_DEFAULT_V4_MIGRATION_KEY) === "1"; } catch { return true; }
    })();
    if (!concurrencyDefaultMigrated) {
      let changed = false;
      profiles = profiles.map((profile) => {
        if (normalizeConcurrencyLimit(profile.concurrencyLimit) !== 0) return profile;
        changed = true;
        return { ...profile, concurrencyLimit: DEFAULT_CONCURRENCY_LIMIT };
      });
      if (changed) profilesChangedForFHL = true;
      try { localStorage.setItem(CONCURRENCY_DEFAULT_V4_MIGRATION_KEY, "1"); } catch {}
    }

    const storedFHLPoolPerAPILimit = loadStoredFHLPoolPerAPIConcurrencyLimit();
    const legacyFHLPoolSharedLimit = storedFHLPoolPerAPILimit === null
      ? loadLegacyFHLPoolSharedConcurrencyLimit()
      : null;
    const fhlPoolPerAPIConcurrencyLimit = resolveFHLPoolPerAPIConcurrencyLimit(
      storedFHLPoolPerAPILimit,
      legacyFHLPoolSharedLimit,
    );
    if (storedFHLPoolPerAPILimit === null) {
      persistFHLPoolPerAPIConcurrencyLimit(fhlPoolPerAPIConcurrencyLimit);
    }

    profiles = profiles.map((profile) => {
      if (!isOfficialFHLImagesProfile(profile) || profile.fhlImagesPoolSlot === undefined) return profile;
      if (normalizeConcurrencyLimit(profile.concurrencyLimit) === FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT) return profile;
      profilesChangedForFHL = true;
      return { ...profile, concurrencyLimit: FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT };
    });

    if (profilesChangedForFHL) {
      persistProfiles(profiles);
    }

    const activeProfile = pickActiveProfile(profiles, activeProfileId);
    if (activeProfile && activeProfile.id !== activeProfileId) {
      activeProfileId = activeProfile.id;
      persistActiveProfileId(activeProfileId);
    }
    const activeRuntimeProfile = activeProfile
      ? activeProfileRuntimePatch(activeProfile, fhlTransportMode)
      : null;
    const apiMode: APIMode = activeRuntimeProfile?.apiMode ?? "responses";
    const requestPolicy: RequestPolicy = activeRuntimeProfile?.requestPolicy ?? "openai";
    const imagesNewAPICompat = activeRuntimeProfile?.imagesNewAPICompat ?? false;
    const baseURL = activeRuntimeProfile?.baseURL ?? "";
    const textModelID = activeRuntimeProfile?.textModelID ?? "";
    const imageModelID = activeRuntimeProfile?.imageModelID ?? "";
    const activeKey = activeProfile
      ? await GetStoredAPIKey(keyringUserFor(activeProfile.id)).catch(() => "")
      : "";
    const fhlTextAPIKey = await loadFHLTextAPIKey().catch(() => "");
    // Apply theme + font scale to root immediately.
    applyTheme(theme);
    document.documentElement.style.setProperty("--font-scale", String(fontScale));
    setKernelRuntimeMode(kernelRuntimeMode);
    await GetOutputDir().catch(() => "");
    items = await hydrateHistoryPreviewRefs(items);
    // Make sure there's always at least one workspace.
    const wsId = genId();
    const initialWorkspace = initialWorkspaceForBootstrap(wsId, outputFormat);
    const restoredSession = loadWorkspaceSession(outputFormat);
    let restoredBatchTasksById = restoredSession?.batchTasksById ?? {};
    const serviceRestarted = isBrowserTaskProxyMode()
      && !!restoredSession
      && restoredSession.serviceInstanceId !== currentWorkspaceServiceInstanceId();
    let restoredWorkspaces = restoredSession?.workspaces ?? [initialWorkspace];
    if (serviceRestarted) {
      restoredWorkspaces = resetWorkspaceSourcesAfterServiceRestart(restoredWorkspaces);
    }
    const restoreHistoryIds = restoredWorkspaces.flatMap((workspace) => [
      ...(workspace.batchResultIds ?? []),
      ...(workspace.currentImageId ? [workspace.currentImageId] : []),
    ]);
    const restoredHistoryItems = await loadHistoryItemsByIds(restoreHistoryIds).catch(() => []);
    if (restoredHistoryItems.length > 0) {
      const byId = new Map(items.map((item) => [item.id, item]));
      for (const item of restoredHistoryItems) byId.set(item.id, item);
      items = Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
    }
    let jobGroupsByWorkspace: Record<string, JobGroupSnapshot[]> = {};
    if (isBackgroundTaskProxyMode()) {
      const listJobGroups = isAndroidTaskProxyMode() ? listAndroidJobGroups : listBrowserJobGroups;
      const loadedGroups = await Promise.all(restoredWorkspaces.map(async (workspace) => {
        try {
          const response = await listJobGroups(workspace.id);
          return [workspace.id, response.groups] as const;
        } catch {
          return [workspace.id, []] as const;
        }
      }));
      for (const [workspaceId, groups] of loadedGroups) {
        const workspace = restoredWorkspaces.find((entry) => entry.id === workspaceId);
        const visibleGroups = filterVisibleJobGroupsForWorkspace(workspace, groups);
        jobGroupsByWorkspace = replaceWorkspaceJobGroups(jobGroupsByWorkspace, workspaceId, [...visibleGroups]);
      }
      const hydrated = await hydrateHistoryFromBrowserGroups(items, jobGroupsByWorkspace);
      items = hydrated.history;
      const knownJobIds = new Set(
        Object.values(jobGroupsByWorkspace)
          .flatMap((groups) => groups)
          .flatMap((group) => group.slots.map((slot) => slot.jobId)),
      );
      for (const workspace of restoredWorkspaces) {
        for (const group of jobGroupsByWorkspace[workspace.id] ?? []) {
          restoredBatchTasksById = updateTasksFromJobGroup(
            restoredBatchTasksById,
            workspace.batchTaskIds ?? [],
            group,
          );
        }
        restoredBatchTasksById = markMissingJobTasksInterrupted(
          restoredBatchTasksById,
          workspace.batchTaskIds ?? [],
          knownJobIds,
        );
      }
      for (const workspace of restoredWorkspaces) {
        const browserPatch = browserRuntimePatchFromGroups(
          jobGroupsByWorkspace[workspace.id] ?? [],
          workspace.continuousGenerateTest === true,
        );
        const taskPatch = (workspace.batchTaskIds?.length ?? 0) > 0
          ? taskRuntimePatchForWorkspace(workspace.id, workspace.batchTaskIds ?? [], restoredBatchTasksById)
          : {};
        restoredWorkspaces = patchWorkspaceRuntime(
          restoredWorkspaces,
          workspace.id,
          { ...browserPatch, ...taskPatch },
        );
      }
    }
    const restoredById = new Map(items.map((item) => [item.id, item]));
    const rebuiltHistoryItems: HistoryItem[] = [];
    for (const task of Object.values(restoredBatchTasksById)) {
      const rebuilt = minimalHistoryItemFromBatchTask(task);
      if (!rebuilt || restoredById.has(rebuilt.id)) continue;
      restoredById.set(rebuilt.id, rebuilt);
      rebuiltHistoryItems.push(rebuilt);
    }
    if (rebuiltHistoryItems.length > 0) {
      items = Array.from(restoredById.values()).sort((a, b) => b.createdAt - a.createdAt);
      await persistHistoryItems(rebuiltHistoryItems).catch(() => undefined);
    }
    const panoramaHistoryIds = panoramaHistoryIdsForMetadataRecovery(items);
    const panoramaHistoryItems = await loadHistoryItemsByIds(panoramaHistoryIds).catch(() => []);
    const panoramaSourcePaths = panoramaSourcePathsForMetadataRecovery(
      items,
      restoredBatchTasksById,
      restoredWorkspaces.flatMap((workspace) => workspace.sources),
    );
    const panoramaSourceItems = await loadHistoryItemsBySavedPaths(panoramaSourcePaths).catch(() => []);
    if (panoramaHistoryItems.length > 0 || panoramaSourceItems.length > 0) {
      const byId = new Map(items.map((item) => [item.id, item]));
      for (const item of panoramaHistoryItems) byId.set(item.id, item);
      for (const item of panoramaSourceItems) byId.set(item.id, item);
      items = Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
    }
    const recoveredPanoramaHistory = recoverPanoramaHistoryMetadata(items, restoredBatchTasksById);
    items = recoveredPanoramaHistory.items;
    const repairedPanoramaById = new Map(
      recoveredPanoramaHistory.repaired.map((item) => [item.id, item]),
    );
    const recoveredItemsById = new Map(items.map((item) => [item.id, item]));
    for (const workspace of restoredWorkspaces) {
      if (!workspace.currentImageId || workspace.mode !== "edit" || workspace.sources.length === 0) continue;
      const item = recoveredItemsById.get(workspace.currentImageId);
      if (!item || item.panoramaRoundtrip) continue;
      const recovered = recoverPanoramaItemMetadataFromTask(item, {
        sourceImages: workspace.sources,
        sourceImagePaths: workspace.sources.map((source) => source.path),
      }, items);
      if (recovered === item) continue;
      recoveredItemsById.set(recovered.id, recovered);
      repairedPanoramaById.set(recovered.id, recovered);
    }
    items = Array.from(recoveredItemsById.values()).sort((a, b) => b.createdAt - a.createdAt);
    if (repairedPanoramaById.size > 0) {
      await persistHistoryItems(Array.from(repairedPanoramaById.values())).catch(() => undefined);
    }
    restoredWorkspaces = restoredWorkspaces.map((workspace) => {
      const sources = recoverPanoramaSourceMetadata(workspace.sources, items);
      return sources === workspace.sources ? workspace : { ...workspace, sources };
    });
    const restoredActiveWorkspace = restoredWorkspaces.find(
      (workspace) => workspace.id === restoredSession?.activeWorkspaceId,
    ) ?? restoredWorkspaces[0];
    const restoredCurrentHistory = restoredActiveWorkspace.currentImageId
      ? items.find((item) => item.id === restoredActiveWorkspace.currentImageId) ?? null
      : null;
    const restoredCurrentImage = streamPreviewItemFromWorkspace(
      restoredActiveWorkspace,
      restoredCurrentHistory,
    ) ?? restoredCurrentHistory;
    const restoredBatchResults = historyItemsByIds(items, restoredActiveWorkspace.batchResultIds ?? []);
    const browserRuntime = browserRuntimePatchFromGroups(
      jobGroupsByWorkspace[restoredActiveWorkspace.id] ?? [],
      restoredActiveWorkspace.continuousGenerateTest === true,
    );
    const restoredRunningJobs = isBackgroundTaskProxyMode()
      ? browserRuntime.runningJobs ?? []
      : restoredActiveWorkspace.runningJobIds ?? [];
    const runtimePlatform = readRuntimePlatformState();
    const shouldAutoOpenSettings = runtimePlatform.isAndroid
      ? false
      : !activeProfile || !activeKey.trim() || !baseURL.trim();
    set({
      apiKey: activeKey,
      mode: restoredActiveWorkspace.mode,
      promptPrefix: restoredActiveWorkspace.promptPrefix ?? "",
      prompt: restoredActiveWorkspace.prompt,
      optimizationGuidance: restoredActiveWorkspace.optimizationGuidance,
      negativePrompt: restoredActiveWorkspace.negativePrompt,
      size: restoredActiveWorkspace.size,
      quality: restoredActiveWorkspace.quality,
      outputFormat: restoredActiveWorkspace.outputFormat ?? outputFormat,
      seed: restoredActiveWorkspace.seed,
      continuousGenerateTest: restoredActiveWorkspace.continuousGenerateTest === true,
      fhlPoolPerAPIConcurrencyLimit,
      fhlTextAPIConfigured: !!fhlTextAPIKey,
      fhlTextAPIKeyHint: fhlTextAPIKeyHint(fhlTextAPIKey),
      fhlTextAPITestStatus: fhlTextAPIKey ? "saved" : "unconfigured",
      fhlTextAPITestMessage: "",
      history: items,
      historyHasMore: !!initialHistoryPage.nextCursor,
      historyLoading: false,
      historyCursor: initialHistoryPage.nextCursor,
      batchResults: restoredBatchResults,
      resultGridOpen: !!restoredActiveWorkspace.resultGridOpen,
      historyGalleryOpen: restoredActiveWorkspace.historyGalleryOpen === true,
      historyGallerySinglePreviewId: restoredActiveWorkspace.historyGallerySinglePreviewId ?? null,
      historyGallerySort: restoredActiveWorkspace.historyGallerySort ?? "newest",
      materialManagerOpen: false,
      materialGroups,
      currentImage: restoredCurrentImage,
      compareB: null,
      compareMode: "curtain",
      annotations: [],
      strokes: [],
      maskDataURL: null,
      runningJobMeta: isBackgroundTaskProxyMode() ? buildRunningJobMetaFromBrowserGroups(jobGroupsByWorkspace) : {},
      jobGroupsByWorkspace,
      batchTasksById: restoredBatchTasksById,
      apiMode,
      fhlTransportMode,
      requestPolicy,
      imagesNewAPICompat,
      baseURL,
      textModelID,
      imageModelID,
      kernelRuntimeMode,
      noPromptRevision,
      proxyMode: proxyConfig.mode,
      proxyURL: proxyConfig.url,
      sources: restoredActiveWorkspace.sources,
      runningJobs: restoredRunningJobs,
      jobsTotal: isBackgroundTaskProxyMode()
        ? browserRuntime.jobsTotal ?? 0
        : restoredActiveWorkspace.jobsTotal ?? 0,
      jobsCompleted: isBackgroundTaskProxyMode()
        ? browserRuntime.jobsCompleted ?? 0
        : restoredActiveWorkspace.jobsCompleted ?? 0,
      jobsFailed: isBackgroundTaskProxyMode()
        ? browserRuntime.jobsFailed ?? 0
        : restoredActiveWorkspace.jobsFailed ?? 0,
      progress: isBackgroundTaskProxyMode()
        ? browserRuntime.progress ?? null
        : restoredActiveWorkspace.progress ?? null,
      streamPreview: restoredActiveWorkspace.streamPreview ?? null,
      streamPreviews: restoredActiveWorkspace.streamPreviews ?? {},
      lastLogLine: isBackgroundTaskProxyMode()
        ? browserRuntime.lastLogLine ?? ""
        : restoredActiveWorkspace.lastLogLine ?? "",
      errorMessage: isBackgroundTaskProxyMode()
        ? browserRuntime.errorMessage ?? null
        : restoredActiveWorkspace.errorMessage ?? null,
      errorRawPath: isBackgroundTaskProxyMode()
        ? browserRuntime.errorRawPath ?? null
        : restoredActiveWorkspace.errorRawPath ?? null,
      isRunning: restoredRunningJobs.length > 0,
      lastPayload: restoredActiveWorkspace.lastPayload ?? null,
      promptHistory,
      presets,
      theme,
      fontScale,
      batchCount: restoredActiveWorkspace.batchCount,
      editSourceMode: restoredActiveWorkspace.editSourceMode ?? "manual",
      batchProcess: normalizeBatchProcessConfig(restoredActiveWorkspace.batchProcess),
      styleTag: restoredActiveWorkspace.styleTag ?? "",
      profiles,
      activeProfileId,
      workspaces: restoredWorkspaces,
      activeWorkspaceId: restoredActiveWorkspace.id,
      // Android WebView restores with a compact hero state to avoid layout jumps.
      settingsOpen: shouldAutoOpenSettings,
      upstreamModalOpen: false,
      upstreamReturnTarget: shouldAutoOpenSettings ? "settings" : "app",
    });
    if (isBackgroundTaskProxyMode()) {
      syncBrowserJobSubscriptions(jobGroupsByWorkspace);
    }
    if (
      restoredActiveWorkspace.mode === "edit"
      && (restoredActiveWorkspace.editSourceMode === "manual" || restoredActiveWorkspace.editSourceMode === "batch")
      && normalizeBatchProcessConfig(restoredActiveWorkspace.batchProcess).autoAspectResolution
    ) {
      void syncSharedEditAutoAspect({ getState: get, setState: set });
    }
  },

  setMaskDataURL: (v) => set({ maskDataURL: v }),

  pushStroke: (stroke) => {
    const before = get().strokes;
    const after = [...before, stroke];
    const entry: UndoEntry = {
      label: "stroke",
      undo: (s) => ({ strokes: s.strokes.slice(0, -1) }),
      redo: () => ({ strokes: [...get().strokes, stroke] }),
    };
    set({
      strokes: after,
      undoStack: [...get().undoStack, entry],
      redoStack: [],
    });
  },

  resetMask: () => {
    const before = get().strokes;
    if (before.length === 0) return;
    const entry: UndoEntry = {
      label: "clear-mask",
      undo: () => ({ strokes: before, maskDataURL: get().maskDataURL }),
      redo: () => ({ strokes: [], maskDataURL: null }),
    };
    set({
      strokes: [],
      maskDataURL: null,
      undoStack: [...get().undoStack, entry],
      redoStack: [],
    });
  },

  addAnnotation: (a) => {
    const entry: UndoEntry = {
      label: "annotation",
      undo: (s) => ({ annotations: s.annotations.filter((x) => x.id !== a.id) }),
      redo: () => ({ annotations: [...get().annotations, a] }),
    };
    set({
      annotations: [...get().annotations, a],
      undoStack: [...get().undoStack, entry],
      redoStack: [],
    });
  },

  removeAnnotation: (id) => {
    const target = get().annotations.find((a) => a.id === id);
    if (!target) return;
    const entry: UndoEntry = {
      label: "remove-annotation",
      undo: (s) => ({ annotations: [...s.annotations, target] }),
      redo: () => ({ annotations: get().annotations.filter((x) => x.id !== id) }),
    };
    set({
      annotations: get().annotations.filter((a) => a.id !== id),
      selectedAnnotationId: get().selectedAnnotationId === id ? null : get().selectedAnnotationId,
      undoStack: [...get().undoStack, entry],
      redoStack: [],
    });
  },

  updateAnnotation: (id, patch) => {
    set({
      annotations: get().annotations.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    });
  },

  clearAnnotations: () => {
    const before = get().annotations;
    if (before.length === 0) return;
    const entry: UndoEntry = {
      label: "clear-annotations",
      undo: () => ({ annotations: before }),
      redo: () => ({ annotations: [] }),
    };
    set({
      annotations: [],
      undoStack: [...get().undoStack, entry],
      redoStack: [],
    });
  },

  undo: () => {
    const stack = get().undoStack;
    if (stack.length === 0) return;
    const entry = stack[stack.length - 1];
    const patch = entry.undo(get());
    set({
      ...(patch as any),
      undoStack: stack.slice(0, -1),
      redoStack: [...get().redoStack, entry],
    });
  },

  redo: () => {
    const stack = get().redoStack;
    if (stack.length === 0) return;
    const entry = stack[stack.length - 1];
    const patch = entry.redo(get());
    set({
      ...(patch as any),
      redoStack: stack.slice(0, -1),
      undoStack: [...get().undoStack, entry],
    });
  },

  setCompareB: (item, mode) => mediaActions.setCompareB(item, mode),
  setCompareSplit: (v) => mediaActions.setCompareSplit(v),
  openCompareWithPrimarySource: async (mode) => mediaActions.openCompareWithPrimarySource(mode),
  openSourcePreview: (item) => mediaActions.openSourcePreview(item),
  closeSourcePreview: () => mediaActions.closeSourcePreview(),
  openResultGrid: () => mediaActions.openResultGrid(),
  closeResultGrid: () => mediaActions.closeResultGrid(),
  selectBatchGridItem: (item) => mediaActions.selectBatchGridItem(item),
  selectBatchResult: async (item) => mediaActions.selectBatchResult(item),
  openHistoryGallery: async () => mediaActions.openHistoryGallery(),
  closeHistoryGallery: () => mediaActions.closeHistoryGallery(),
  closeHistoryGalleryToEmpty: () => mediaActions.closeHistoryGalleryToEmpty(),
  setHistoryGallerySort: (value) => mediaActions.setHistoryGallerySort(value),
  selectHistoryGalleryGridItem: (item) => mediaActions.selectHistoryGalleryGridItem(item),
  selectHistoryGalleryResult: async (item) => mediaActions.selectHistoryGalleryResult(item),
  openMaterialManager: () => set({ materialManagerOpen: true }),
  closeMaterialManager: () => set({ materialManagerOpen: false }),
  createMaterialGroup: (kind: MaterialGroupKind, name: string, items: MaterialRef[] = [], description = "") => {
    const resolvedName = uniqueMaterialGroupName(get().materialGroups, kind, name)
      || (kind === "referenceSet" ? "Reference Set" : "Folder");
    const nextGroup = createMaterialGroupInput(kind, resolvedName, items, Date.now(), description);
    set((state) => {
      const next = [...state.materialGroups, nextGroup];
      persistMaterialGroups(next);
      return { materialGroups: next };
    });
    return nextGroup.id;
  },
  renameMaterialGroup: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set((state) => {
      const next = state.materialGroups.map((group) => (
        group.id === id ? { ...group, name: trimmed, updatedAt: Date.now() } : group
      ));
      persistMaterialGroups(next);
      return { materialGroups: next };
    });
  },
  deleteMaterialGroup: (id) => {
    set((state) => {
      const next = state.materialGroups.filter((group) => group.id !== id);
      persistMaterialGroups(next);
      return { materialGroups: next };
    });
  },
  moveHistoryItemsToMaterialGroup: (groupId, historyIds) => {
    const refs = historyIds
      .filter((historyId) => get().history.some((item) => item.id === historyId))
      .map((historyId) => ({ kind: "history", historyId }) satisfies MaterialRef);
    if (refs.length === 0) return;
    set((state) => {
      const next = state.materialGroups.map((group) => (
        group.id === groupId
          ? { ...group, items: uniqueMaterialRefs([...group.items, ...refs]), updatedAt: Date.now() }
          : group
      ));
      persistMaterialGroups(next);
      return { materialGroups: next };
    });
  },
  removeMaterialItem: (groupId, itemRef) => {
    const targetKey = materialRefKey(itemRef);
    set((state) => {
      const next = state.materialGroups.map((group) => (
        group.id === groupId
          ? { ...group, items: group.items.filter((item) => materialRefKey(item) !== targetKey), updatedAt: Date.now() }
          : group
      ));
      persistMaterialGroups(next);
      return { materialGroups: next };
    });
  },
  createReferenceSetFromCurrentSources: (name) => {
    const refs = refsFromSources(get().sources);
    if (refs.length === 0) {
      get().pushToast("Current sources are empty; nothing to save as a reference set", "warn", 2400);
      return null;
    }
    const groupId = get().createMaterialGroup("referenceSet", name || "Reference Set", refs);
    get().pushToast(`Created a reference set with ${refs.length} items`, "success", 2200);
    return groupId;
  },
  applyMaterialReferenceSet: async (groupId, mode) => {
    const group = get().materialGroups.find((item) => item.id === groupId && item.kind === "referenceSet");
    if (!group) return;
    const historyById = new Map(get().history.map((item) => [item.id, item]));
    const sources: SourceImage[] = [];
    for (const ref of group.items) {
      if (ref.kind === "source") {
        sources.push(ref.source);
        continue;
      }
      const item = historyById.get(ref.historyId);
      if (!item) continue;
      const source = await sourceFromHistoryForMaterial(item);
      if (source) sources.push(source);
    }
    if (sources.length === 0) {
      get().pushToast("Reference set does not contain any usable source images", "warn", 2400);
      return;
    }
    const nextSources = mergeSources(get().sources, sources, mode);
    set((state) => ({
      sources: nextSources,
      mode: "edit",
      materialManagerOpen: false,
      workspaces: patchWorkspaceRuntime(state.workspaces, state.activeWorkspaceId, {
        sources: nextSources,
        mode: "edit",
      }),
    }));
    get().pushToast(mode === "replace" ? `Replaced sources with ${nextSources.length} reference images` : `Added ${sources.length} reference images`, "success", 2200);
  },
  syncMaterialGroupToOutput: async (groupId) => {
    const group = get().materialGroups.find((item) => item.id === groupId);
    if (!group) {
      get().pushToast("Material group was not found for output sync", "warn", 2600);
      return null;
    }
    const historyById = new Map(get().history.map((item) => [item.id, item]));
    const items = materialSyncItemsForGroup(group, historyById);
    try {
      const result = await SyncMaterialGroupToOutput(group.kind, group.name, items);
      if (result.synced > 0 && result.missing > 0) {
        get().pushToast(`Synced ${result.synced} items to output; ${result.missing} were missing`, "warn", 3600);
      } else if (result.synced > 0) {
        get().pushToast(`已同步 ${result.synced} 项到 output`, "success", 2600);
      } else if (result.missing > 0) {
        get().pushToast(`Skipped ${result.missing} missing items during output sync`, "warn", 3600);
      } else {
        get().pushToast("Material group synced to output", "success", 2200);
      }
      return result;
    } catch (error: any) {
      get().pushToast(`同步到 output 失败：${error?.message ?? error}`, "error", 4200);
      return null;
    }
  },
  syncAllMaterialGroupsToOutput: async () => {
    const groups = get().materialGroups.filter((group) => group.kind === "folder" || group.kind === "referenceSet");
    if (groups.length === 0) {
      get().pushToast("No folders or reference sets are available for output sync", "warn", 2600);
      return;
    }
    const historyById = new Map(get().history.map((item) => [item.id, item]));
    let synced = 0;
    let missing = 0;
    let failed = 0;
    for (const group of groups) {
      try {
        const result = await SyncMaterialGroupToOutput(group.kind, group.name, materialSyncItemsForGroup(group, historyById));
        synced += result.synced;
        missing += result.missing;
      } catch {
        failed += 1;
      }
    }
    if (failed > 0) {
      get().pushToast(`Synced ${synced} items; ${missing} missing; ${failed} groups failed`, "warn", 4600);
    } else if (missing > 0) {
      get().pushToast(`Synced ${synced} items to output; ${missing} were missing`, "warn", 4200);
    } else {
      get().pushToast(`Synced ${synced} items to output`, "success", 3200);
    }
  },
  openMaterialSyncDir: async (path) => {
    try {
      await OpenMaterialSyncDir(path ?? "");
    } catch (error: any) {
      get().pushToast(`打开同步目录失败：${error?.message ?? error}`, "error", 3600);
    }
  },
  pushToast: (text, kind = "info", ttl = 3500, action) => mediaActions.pushToast(text, kind, ttl, action),
  dismissToast: (id) => mediaActions.dismissToast(id),
  resultDetail: null,
  openResultDetail: async (item) => mediaActions.openResultDetail(item),
  closeResultDetail: () => mediaActions.closeResultDetail(),
  openPanoramaViewer: async (item) => mediaActions.openPanoramaViewer(item),
  closePanoramaViewer: () => mediaActions.closePanoramaViewer(),
  openPanoramaPastebackAligner: (item) => set({
    panoramaAlignTarget: recoverPanoramaItemMetadata(item, get().history),
  }),
  closePanoramaPastebackAligner: () => set({ panoramaAlignTarget: null }),
  materializeCurrentImage: async (item) => mediaActions.materializeCurrentImage(item),
  loadMoreHistory: async () => {
    if (deferredHistoryLoadPromise) return deferredHistoryLoadPromise;
    if (!get().historyHasMore || get().historyLoading) return;
    set({ historyLoading: true });
    deferredHistoryLoadPromise = (async () => {
      try {
        const currentHistory = get().history;
        const state = get();
        const direction = state.historyGalleryOpen && state.historyGallerySort === "oldest"
          ? "oldest"
          : "newest";
        const cursor = state.historyCursor?.direction === direction ? state.historyCursor : null;
        const nextPage = await loadHistoryPage({
          cursor,
          limit: INITIAL_HISTORY_LOAD,
          direction,
        });
        const existing = new Set(currentHistory.map((item) => item.id));
        const incoming = nextPage.items.filter((item) => !existing.has(item.id));
        const recoveredPanoramaHistory = recoverPanoramaHistoryMetadata(
          trimHistory([...currentHistory, ...incoming].sort((a, b) => b.createdAt - a.createdAt)),
          state.batchTasksById,
        );
        const merged = recoveredPanoramaHistory.items;
        set({
          history: merged,
          historyHasMore: !!nextPage.nextCursor,
          historyCursor: nextPage.nextCursor,
        });
        if (recoveredPanoramaHistory.repaired.length > 0) {
          void persistHistoryItems(recoveredPanoramaHistory.repaired);
        }
        void backfillHistoryPreviewRefs(incoming);
      } catch (error) {
        if (typeof console !== "undefined") console.warn("load more history failed", error);
      } finally {
        deferredHistoryLoadPromise = null;
        set({ historyLoading: false });
      }
    })();
    return deferredHistoryLoadPromise;
  },
  setHistoryRailCollapsed: (collapsed) => mediaActions.setHistoryRailCollapsed(collapsed),
  openHistoryTimeline: () => mediaActions.openHistoryTimeline(),
  closeHistoryTimeline: () => mediaActions.closeHistoryTimeline(),
  pruneHistoryOlderThanDays: async (days) => mediaActions.pruneHistoryOlderThanDays(days),
  rotateCurrent: async (degrees) => mediaActions.rotateCurrent(degrees),
  flipCurrent: async (horizontal) => mediaActions.flipCurrent(horizontal),
  cropToRect: async (x, y, w, h) => mediaActions.cropToRect(x, y, w, h),
  savePreset: (name) => mediaActions.savePreset(name),
  applyPreset: (id) => mediaActions.applyPreset(id),
  deletePreset: (id) => mediaActions.deletePreset(id),
  exportHistory: async () => mediaActions.exportHistory(),

  setTheme: (t) => {
    set({ theme: t });
    try { localStorage.setItem(THEME_KEY, t); } catch {}
    applyTheme(t);
  },

  setFontScale: (v) => {
    set({ fontScale: v });
    try { localStorage.setItem(FONT_SCALE_KEY, String(v)); } catch {}
    document.documentElement.style.setProperty("--font-scale", String(v));
  },

  setProxyConfig: (mode, url) => {
    const normalizedMode = normalizeProxyMode(mode);
    const nextURL = (url ?? get().proxyURL).trim();
    set({ proxyMode: normalizedMode, proxyURL: nextURL });
    persistProxyConfig(normalizedMode, nextURL);
  },

  testProfileConnection: async (profileId) => {
    const s = get();
    const cleanProfileId = String(profileId || "").trim();
    const profile = s.profiles.find((item) => item.id === cleanProfileId);
    if (!profile) {
      s.pushToast("要测试的 API 配置已不存在", "warn", 4200);
      return false;
    }
    if (s.isTestingKey) return false;

    const effectiveAPIMode = effectiveAPIModeForSubmit(s, profile, profile.apiMode);
    const profileAPIKey = await apiKeyForProfileOrState(s, profile.id);
    if (providerRequiresDirectAPIKey(effectiveAPIMode) && !profileAPIKey.trim()) {
      s.pushToast(`${profile.name} 尚未保存 API Key`, "warn", 4200);
      return false;
    }
    if (!profile.baseURL.trim()) {
      s.pushToast(`${profile.name} 缺少 Base URL`, "warn", 4200);
      return false;
    }

    let cleanedAPIKey = "";
    if (providerRequiresDirectAPIKey(effectiveAPIMode)) {
      try {
        cleanedAPIKey = validateAPIKeyForHeader(profileAPIKey);
      } catch (error: any) {
        s.pushToast(error?.message ?? `${profile.name} 的 API Key 无效`, "error", 6000);
        return false;
      }
    }
    const cleanedBaseURL = cleanBaseURL(profile.baseURL);
    if (!cleanedBaseURL) {
      s.pushToast(`${profile.name} 的 Base URL 无效`, "warn", 4200);
      return false;
    }

    set({ isTestingKey: true });
    s.pushToast(`正在测试 ${profile.name}...`, "info", 3200);
    try {
      await probeCurrentUpstream(cleanedBaseURL, cleanedAPIKey, s.proxyMode, s.proxyURL, effectiveAPIMode);
      s.pushToast(`${profile.name} 连接测试成功`, "success");
      return true;
    } catch (error: any) {
      s.pushToast(`${profile.name} 测试连接失败：${error?.message ?? error}`, "error", 6000);
      return false;
    } finally {
      set({ isTestingKey: false });
    }
  },

  refreshFHLTextAPIConfig: async () => {
    const apiKey = await loadFHLTextAPIKey().catch(() => "");
    const configured = !!apiKey;
    const keyHint = configured ? fhlTextAPIKeyHint(apiKey) : "";
    set((state) => {
      const preserveResult = configured
        && state.fhlTextAPIConfigured
        && state.fhlTextAPIKeyHint === keyHint
        && state.fhlTextAPITestStatus !== "unconfigured";
      return {
        fhlTextAPIConfigured: configured,
        fhlTextAPIKeyHint: keyHint,
        fhlTextAPITestStatus: configured
          ? preserveResult ? state.fhlTextAPITestStatus : "saved"
          : "unconfigured",
        fhlTextAPITestMessage: preserveResult ? state.fhlTextAPITestMessage : "",
      };
    });
  },

  saveAndTestFHLTextAPI: async (apiKeyInput = "") => {
    const input = apiKeyInput.trim();
    let apiKey = "";
    if (input) {
      apiKey = validateFHLTextAPIKey(input);
      await saveFHLTextAPIKey(apiKey);
    } else {
      apiKey = await loadFHLTextAPIKey();
      if (!apiKey) throw new Error("请先输入 FHL 文本 API Key。");
    }

    const keyHint = fhlTextAPIKeyHint(apiKey);
    set({
      fhlTextAPIConfigured: true,
      fhlTextAPIKeyHint: keyHint,
      fhlTextAPITestStatus: "saved",
      fhlTextAPITestMessage: "FHL 文本 API 已保存，等待响应测试。",
    });
    set({
      fhlTextAPITestStatus: "testing",
      fhlTextAPITestMessage: `正在测试 FHL Responses 文本响应（${FHL_TEXT_MODEL_ID}）...`,
    });

    try {
      await testFHLTextAPIKey(apiKey, {
        proxyMode: get().proxyMode,
        proxyURL: get().proxyURL,
      });
      set({
        fhlTextAPITestStatus: "success",
        fhlTextAPITestMessage: `配置成功：FHL Responses 已返回 ${FHL_TEXT_MODEL_ID} 文本响应。`,
      });
      get().pushToast("FHL 文本 API 配置成功。", "success", 3600);
      return true;
    } catch (error) {
      const detail = formatFHLTextAPIError(error);
      set({
        fhlTextAPITestStatus: "error",
        fhlTextAPITestMessage: `已保存，文本测试失败：${detail}`,
      });
      get().pushToast(`FHL 文本 API 已保存，但测试失败：${detail}`, "warn", 6000);
      return false;
    }
  },

  deleteFHLTextAPIConfig: async () => {
    await deleteFHLTextAPIKey();
    set({
      fhlTextAPIConfigured: false,
      fhlTextAPIKeyHint: "",
      fhlTextAPITestStatus: "unconfigured",
      fhlTextAPITestMessage: "",
    });
    get().pushToast("FHL 文本 API 已删除。", "success", 3200);
  },

  testAPIKey: async () => {
    const s = get();
    if (!currentProviderHasRequiredKey(s)) {
      s.pushToast("请先填写 API Key", "warn");
      return;
    }
    if (!s.baseURL.trim()) {
      s.pushToast("请先填写 Base URL，再测试 API 连接", "warn", 5000);
      return;
    }
    let cleanedAPIKey = "";
    if (providerRequiresDirectAPIKey(s.apiMode)) {
      try {
      cleanedAPIKey = validateAPIKeyForHeader(s.apiKey);
    } catch (error: any) {
      s.pushToast(error?.message ?? "API Key 格式无效", "error", 6000);
      return;
    }
    if (cleanedAPIKey !== s.apiKey) {
      const activeId = s.activeProfileId;
      set({ apiKey: cleanedAPIKey });
        if (activeId) {
          try { await SetStoredAPIKey(keyringUserFor(activeId), cleanedAPIKey); } catch {}
        }
      }
    }
    const cleanedBaseURL = cleanBaseURL(s.baseURL);
    if (s.isTestingKey) return;
    set({ isTestingKey: true });
    s.pushToast("正在测试 API 连接，请稍候...", "info", 3200);
    try {
      await probeCurrentUpstream(cleanedBaseURL, cleanedAPIKey, s.proxyMode, s.proxyURL, s.apiMode);
      set({ isTestingKey: false });
      {
        syncCLIConfigQuietly(cliConfigFromState(get(), {
          apiKey: cleanedAPIKey,
          baseURL: cleanedBaseURL,
        }));
      }
      s.pushToast(s.apiMode === "apimart" ? "APIMart 连接测试成功" : "连接测试成功，已确认上游模型可用", "success");
    } catch (e: any) {
      set({ isTestingKey: false });
      s.pushToast(`测试连接失败：${e?.message ?? e}`, "error", 6000);
    }
  },
  optimizePrompt: async (options: { useGuidance?: boolean } = {}) => {
    const s = get();
    if (s.isOptimizingPrompt || s.isReversingPrompt) return;
    const optimizeProfile = await resolvePromptTextProfile(s);
    if (!optimizeProfile.apiKey) {
      s.pushToast("请先配置用于 Prompt 优化的 API Key", "warn");
      return;
    }
    if (!optimizeProfile.baseURL) {
      s.pushToast("Prompt optimization requires a Responses API profile", "warn", 5000);
      return;
    }
    if (!s.prompt.trim()) {
      s.pushToast("请先输入 prompt", "warn");
      return;
    }
    const sourcePaths = s.mode === "edit"
      ? s.sources.map((src) => src.path).filter(Boolean)
      : [];
    if (s.mode === "edit" && sourcePaths.length === 0 && s.currentImage?.savedPath) {
      sourcePaths.push(s.currentImage.savedPath);
    }
    set({ isOptimizingPrompt: true, errorMessage: null, errorRawPath: null });
    try {
      const optimized = await wailsOptimizePrompt({
        apiKey: optimizeProfile.apiKey,
        prompt: s.prompt,
        optimizationGuidance: options.useGuidance === false ? "" : s.optimizationGuidance,
        mode: s.mode,
        baseURL: optimizeProfile.baseURL,
        textModelID: optimizeProfile.textModelID,
        proxyMode: s.proxyMode,
        proxyURL: s.proxyURL,
        imagePaths: sourcePaths,
        imagePath: "",
      } satisfies PromptOptimizeRequest);
      const trimmed = optimized.trim();
      if (!trimmed) {
        throw new Error("Prompt optimization returned empty text");
      }
      set({ prompt: trimmed });
      s.pushToast("Prompt optimization imported into the editor", "success");
    } catch (e: any) {
      const msg = promptOptimizeFailureMessage(e, optimizeProfile);
      set({ errorMessage: msg, errorRawPath: null });
      s.pushToast(msg, "error", 6000);
    } finally {
      set({ isOptimizingPrompt: false });
    }
  },

  reversePromptFromImage: async () => {
    const s = get();
    if (s.isOptimizingPrompt || s.isReversingPrompt) return;
    const reverseProfile = await resolvePromptTextProfile(s);
    if (!reverseProfile.apiKey) {
      s.pushToast("请先配置用于反推提示词的 API Key", "warn");
      return;
    }
    if (!reverseProfile.baseURL) {
      s.pushToast("Reverse prompt requires a Responses API profile", "warn", 5000);
      return;
    }

    const sourcePaths: string[] = [];
    const sourceImages: PromptReverseRequest["sourceImages"] = [];
    let current = s.currentImage;
    if (current?.previewOnly) {
      const materialized = await materializeHistoryItem(current).catch(() => null);
      if (materialized) {
        if (useStudioStore.getState().currentImage?.id === current.id) {
          set({ currentImage: materialized });
        }
        current = materialized;
      }
    }
    if (s.reversePromptImage?.path) {
      sourcePaths.push(s.reversePromptImage.path);
    } else if (current?.savedPath) {
      sourcePaths.push(current.savedPath);
    } else if (s.sources[0]?.path) {
      sourcePaths.push(s.sources[0].path);
    }
    if (sourcePaths.length === 0) {
      if (s.reversePromptImage?.imageB64 || s.reversePromptImage?.imageBlob) {
        sourceImages.push({
          path: s.reversePromptImage.path,
          name: s.reversePromptImage.name,
          imageB64: s.reversePromptImage.imageB64 || null,
          imageBlob: s.reversePromptImage.imageBlob || null,
        });
      } else if (current?.imageB64 || current?.imageBlob) {
        sourceImages.push({
          path: current.savedPath || "",
          name: "current-image.png",
          imageB64: current.imageB64 || null,
          imageBlob: current.imageBlob || null,
        });
      } else if (s.sources[0]?.imageB64 || s.sources[0]?.imageBlob) {
        const first = s.sources[0];
        sourceImages.push({
          path: first.path,
          name: first.name,
          imageB64: first.imageB64 || null,
          imageBlob: first.imageBlob || null,
        });
      }
    }
    if (sourcePaths.length === 0 && sourceImages.length === 0) {
      s.pushToast("Select an image before applying history params", "warn", 3600);
      return;
    }

    set({ isReversingPrompt: true, errorMessage: null, errorRawPath: null });
    try {
      const reversed = await wailsReversePrompt({
        apiKey: reverseProfile.apiKey,
        baseURL: reverseProfile.baseURL,
        textModelID: reverseProfile.textModelID,
        proxyMode: s.proxyMode,
        proxyURL: s.proxyURL,
        imagePaths: sourcePaths,
        imagePath: "",
        sourceImages,
      } satisfies PromptReverseRequest);
      const trimmed = reversed.trim();
      if (!trimmed) {
        throw new Error("Reverse prompt returned empty text");
      }
      set({ prompt: trimmed });
      s.pushToast("Reverse prompt imported into the editor", "success");
    } catch (e: any) {
      const detail = isOfficialFHLProfile({ apiMode: "responses", baseURL: reverseProfile.baseURL })
        ? formatFHLTextAPIError(e)
        : String(e?.message ?? e);
      const msg = `反推提示词失败：${detail}`;
      set({ errorMessage: msg, errorRawPath: typeof e?.rawPath === "string" && e.rawPath ? e.rawPath : null });
      s.pushToast(msg, "error", 6000);
    } finally {
      set({ isReversingPrompt: false });
    }
  },

  newWorkspace: (name) => workspaceActions.newWorkspace(name),
  switchWorkspace: (id) => workspaceActions.switchWorkspace(id),
  closeWorkspace: (id) => workspaceActions.closeWorkspace(id),
  renameWorkspace: (id, name) => workspaceActions.renameWorkspace(id, name),

  importHistory: async () => mediaActions.importHistory(),

  retryLast: async () => {
    const s = get();
    if (!s.lastPayload || s.isRunning) return;
    set({ errorMessage: null, errorRawPath: null });
    // Re-invoke submit, which will rebuild the payload from current state.
    // (We don't reuse lastPayload verbatim so any tweaks the user made
    // after the failure, such as different seed or prompt, take effect.)
    await get().submit();
  },

  retryFailedJob: async (groupId, jobId) => {
    const s = get();
    const groups = s.jobGroupsByWorkspace[s.activeWorkspaceId] ?? [];
    const group = groups.find((entry) => entry.groupId === groupId);
    const slot = group?.slots.find((entry) => entry.jobId === jobId);
    if (!group || !slot) {
      get().pushToast("No matching job group was found", "error", 3600);
      return;
    }
    if (slot.status !== "failed" && slot.status !== "interrupted") {
      get().pushToast("This slot is already queued or running", "warn", 3000);
      return;
    }
    const retryContext = retrySubmitContextFromState(s, group.mode);
    if (!currentProviderHasRequiredKey(s)) {
      set({ errorMessage: "请填写 API Key", errorRawPath: null });
      return;
    }
    let cleanedAPIKey = "";
    if (providerRequiresDirectAPIKey(s.apiMode)) {
      try {
      cleanedAPIKey = validateAPIKeyForHeader(s.apiKey);
    } catch (error: any) {
      set({ errorMessage: error?.message ?? "API Key 格式不正确", errorRawPath: null });
      return;
    }
    }
    const cleanedBaseURL = cleanBaseURL(retryContext.baseURL);
    if (!cleanedBaseURL) {
      set({ errorMessage: "Base URL is required for this retry task", errorRawPath: null });
      return;
    }
    const workspaceId = group.workspaceId;
    const workspace = s.workspaces.find((entry) => entry.id === workspaceId);
    const retryAutoAspectResolution = retryAutoAspectResolutionForContext(group, workspace);
    const shouldRebuildRetryAutoAspectSize = !!retryAutoAspectResolution && !group.batchSourcePath;
    const retryAutoAspectSize = shouldRebuildRetryAutoAspectSize
      ? await buildRetryAutoAspectSizeForContext(group, workspace, retryAutoAspectResolution, {
        apiMode: retryContext.apiMode,
        requestPolicy: retryContext.requestPolicy,
        imageModelID: retryContext.imageModelID,
      })
      : null;
    if (shouldRebuildRetryAutoAspectSize && !retryAutoAspectSize) {
      const message = "Retry auto-aspect could not read the saved source image ratio";
      set({ errorMessage: message, errorRawPath: null });
      get().pushToast("Retry auto-aspect could not rebuild the saved size", "error", 4200);
      return;
    }
    const retrySize = normalizeSizeSelection(retryAutoAspectSize ?? group.size, {
      apiMode: retryContext.apiMode,
      requestPolicy: retryContext.requestPolicy,
      imageModelID: retryContext.imageModelID,
      mode: group.mode,
    });
    const retryBatchIndex = continuousSlotIndex(group, slot);
    if (!Number.isFinite(retryBatchIndex) || retryBatchIndex < 0) {
      get().pushToast("This slot cannot be retried because its index is invalid", "error", 3600);
      return;
    }
    const existingRunningForSlot = groups.some((entry) => {
      if (entry.continuousGenerateTest !== true || entry.batchCount !== 1) return false;
      return entry.slots.some((entrySlot) => (
        continuousSlotIndex(entry, entrySlot) === retryBatchIndex
        && (entrySlot.status === "queued" || entrySlot.status === "running")
      ));
    });
    if (existingRunningForSlot) {
      get().pushToast("This slot is already queued or running in continuous mode", "warn", 3000);
      return;
    }
    const seedBase = Number.isFinite(Number(group.seed)) && Number(group.seed) > 0
      ? Math.max(0, Number(group.seed) + Number(slot.batchIndex || 0))
      : 0;
    const optimisticPatch: WorkspacePatch = {
      errorMessage: null,
      errorRawPath: null,
      progress: null,
      streamPreview: null,
      streamPreviews: {},
      lastLogLine: "",
      jobsTotal: Math.max(workspaceRuntimeFromState(s, workspaceId).jobsTotal, retryBatchIndex + 1),
      resultGridOpen: true,
      historyGalleryOpen: false,
    };
    set((state) => ({
      workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, optimisticPatch),
      ...(state.activeWorkspaceId === workspaceId ? { ...activeRuntimePatch(optimisticPatch), resultGridOpen: true, historyGalleryOpen: false } : {}),
    } as Partial<StudioState>));
    try {
      if (!shouldUseBackgroundTaskProxyForSubmit(retryContext.apiMode)) {
        const sourceIdentity = sourceIdentityForBrowserGroupSlot(group, slot);
        const sourceImages = group.mode === "edit" ? (sourceIdentity.sourceImages ?? []) : [];
        const payload: RuntimeGenerateOptions = {
          apiKey: cleanedAPIKey,
          mode: group.mode,
          requestedJobId: "",
          prompt: group.prompt,
          size: retrySize,
          quality: group.quality,
          outputFormat: group.outputFormat,
          imagePaths: group.sourceImagePaths ?? [],
          imagePath: "",
          maskB64: "",
          seed: seedBase,
          negativePrompt: group.negativePrompt || "",
          baseURL: cleanedBaseURL,
          textModelID: retryContext.textModelID,
          imageModelID: retryContext.imageModelID,
          proxyMode: s.proxyMode,
          proxyURL: s.proxyURL,
          requestPolicy: retryContext.requestPolicy,
          apiMode: retryContext.apiMode,
          apiProfileId: retryContext.apiProfileSnapshot.apiProfileId || "",
          imagesNewAPICompat: retryContext.imagesNewAPICompat,
          noPromptRevision: true,
          concurrencyLimit: retryContext.concurrencyLimit,
          partialImages: 1,
          sourceImages: group.mode === "edit" ? sourceImages : undefined,
        };
        void launchOneJob(group.mode, payload, {
          workspaceId,
          apiMode: retryContext.apiMode,
          ...retryContext.apiProfileSnapshot,
          batchIndex: retryBatchIndex,
          size: retrySize,
          quality: group.quality,
          outputFormat: group.outputFormat,
          sources: sourceImages,
          currentImage: null,
          styleTag: group.styleTag || "",
          continuousGenerateTest: true,
        });
        get().pushToast("Queued task was submitted through the API backend", "success", 2600);
        return;
      }
      const submitJobGroup = isAndroidTaskProxyMode() ? submitAndroidJobGroup : submitBrowserJobGroup;
      const response = await submitJobGroup({
        workspaceId,
        mode: group.mode,
        prompt: group.prompt,
        size: retrySize,
        quality: group.quality,
        outputFormat: group.outputFormat,
        batchCount: 1,
        seed: seedBase,
        negativePrompt: group.negativePrompt || "",
        styleTag: group.styleTag || "",
        sourceImagePaths: group.sourceImagePaths ?? [],
        batchSourcePath: group.batchSourcePath || "",
        batchSourceSlotIndex: group.batchSourceSlotIndex,
        maskB64: "",
        apiKey: cleanedAPIKey,
        baseURL: cleanedBaseURL,
        apiMode: retryContext.apiMode,
        ...retryContext.apiProfileSnapshot,
        requestPolicy: retryContext.requestPolicy,
        imagesNewAPICompat: retryContext.imagesNewAPICompat,
        textModelID: retryContext.textModelID,
        imageModelID: retryContext.imageModelID,
        continuousGenerateTest: true,
        continuousBatchIndex: retryBatchIndex,
      });
      const nextJobGroupsByWorkspace = mergeWorkspaceJobGroup(get().jobGroupsByWorkspace, response.group);
      const runtimePatch = browserRuntimePatchFromGroups(nextJobGroupsByWorkspace[workspaceId] ?? [], true);
      const runningJobMeta = buildRunningJobMetaFromBrowserGroups(nextJobGroupsByWorkspace);
      const gridPatch = { ...runtimePatch, resultGridOpen: true, historyGalleryOpen: false };
      set((state) => ({
        jobGroupsByWorkspace: nextJobGroupsByWorkspace,
        runningJobMeta,
        workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, gridPatch),
        ...(state.activeWorkspaceId === workspaceId ? { ...activeRuntimePatch(gridPatch), resultGridOpen: true, historyGalleryOpen: false } : {}),
      } as Partial<StudioState>));
      syncBrowserJobSubscriptions(nextJobGroupsByWorkspace);
      scheduleAutoRetriesForBrowserGroup(response.group);
      get().pushToast("Background task query completed", "success", 2600);
    } catch (error: any) {
      const message = `重新生成提交失败:${error?.message ?? error}`;
      const failedPatch: WorkspacePatch = {
        errorMessage: message,
        lastLogLine: message,
        errorRawPath: null,
        progress: null,
        streamPreview: null,
        streamPreviews: {},
        historyGalleryOpen: false,
      };
      set((state) => ({
        workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, failedPatch),
        ...(state.activeWorkspaceId === workspaceId ? activeRuntimePatch(failedPatch) : {}),
      } as Partial<StudioState>));
    }
  },

  retryBatchTask: async (taskId, options) => {
    const s = get();
    const task = s.batchTasksById[taskId];
    if (!task) {
      get().pushToast("Failed to resolve the queued task after refresh", "error", 3600);
      return;
    }
    const automaticRetry = options?.automatic === true;
    const useTaskProfile = options?.useTaskProfile === true || task.continuousPoolTask === true;
    if (!automaticRetry) clearAutoRetryTimer(task.id);
    if (task.status === "queued" || task.status === "running") {
      get().pushToast("This queued task is no longer eligible to start", "warn", 3000);
      return;
    }
    const retryContext = useTaskProfile ? retryContextFromOriginalTask(s, task) : retrySubmitContextFromState(s, task.mode);
    if (useTaskProfile && task.apiProfileId && !retryContext.activeProfile) {
      get().pushToast("Missing API profile for the queued task", "warn", 4200);
      return;
    }
    const retryAPIKey = useTaskProfile ? await apiKeyForProfileOrState(s, task.apiProfileId) : s.apiKey;
    if (providerRequiresDirectAPIKey(retryContext.apiMode) && !retryAPIKey.trim()) {
      set({ errorMessage: "请填写 API Key", errorRawPath: null });
      get().pushToast("请先配置 API Key 后再重新生成", "error", 4200);
      return;
    }
    let cleanedAPIKey = "";
    if (providerRequiresDirectAPIKey(retryContext.apiMode)) {
      try {
        cleanedAPIKey = validateAPIKeyForHeader(retryAPIKey);
      } catch (error: any) {
        const message = error?.message ?? "API Key 格式不正确";
        set({ errorMessage: message, errorRawPath: null });
        get().pushToast(message, "error", 4200);
        return;
      }
    }
    const cleanedBaseURL = cleanBaseURL(retryContext.baseURL);
    if (!cleanedBaseURL) {
      set({ errorMessage: "Base URL is required for this retry task", errorRawPath: null });
      get().pushToast("Missing API key for this retry task", "error", 4200);
      return;
    }
    const independentRetry = options?.independent === true;
    const batchSharedTask = !independentRetry && !!task.batchOutputMode;
    if (batchSharedTask && retryContext.concurrencyLimit <= 0) {
      get().pushToast("Batch-shared retry is blocked because the effective concurrency limit is 0", "warn", 3600);
      return;
    }
    if (batchSharedTask && !batchProcessLinkFromTask(task)) {
      get().pushToast("Batch-shared retry is blocked because the original batch context is missing", "error", 3600);
      return;
    }
    const workspaceId = task.workspaceId;
    const workspace = s.workspaces.find((entry) => entry.id === workspaceId);
    const taskIds = workspace?.batchTaskIds ?? [];
    const existingRunningForSlotTasks = sortedBatchTasksForWorkspace(workspaceId, taskIds, s.batchTasksById)
      .filter((entry) => (
        entry.slotIndex === task.slotIndex
        && entry.id !== task.id
        && (entry.status === "queued" || entry.status === "running")
      ))
      .sort((a, b) => (
        (a.status === "running" ? 0 : 1) - (b.status === "running" ? 0 : 1)
        || (a.jobId ? 0 : 1) - (b.jobId ? 0 : 1)
        || b.updatedAt - a.updatedAt
        || b.createdAt - a.createdAt
      ));
    if (existingRunningForSlotTasks.length > 0) {
      const activeRetry = existingRunningForSlotTasks[0];
      const now = Date.now();
      const current = get();
      const currentWorkspace = current.workspaces.find((entry) => entry.id === workspaceId);
      const currentTaskIds = currentWorkspace?.batchTaskIds ?? taskIds;
      const mergedTasksById: Record<string, BatchTaskRecord> = { ...current.batchTasksById };
      for (const staleRetry of existingRunningForSlotTasks) {
        const latestStale = mergedTasksById[staleRetry.id] ?? staleRetry;
        clearAutoRetryTimer(latestStale.id);
        mergedTasksById[latestStale.id] = {
          ...latestStale,
          status: "cancelled",
          updatedAt: now,
          queuedReason: undefined,
          queuePriority: undefined,
          groupId: undefined,
          jobId: undefined,
          errorMessage: latestStale.errorMessage || "已有新的重试任务接管此位置",
        };
      }
      const latestTask = mergedTasksById[task.id] ?? task;
      mergedTasksById[task.id] = {
        ...latestTask,
        apiMode: activeRetry.apiMode,
        apiProfileId: activeRetry.apiProfileId,
        apiProfileName: activeRetry.apiProfileName,
        size: activeRetry.size,
        autoAspectResolution: activeRetry.autoAspectResolution,
        quality: activeRetry.quality,
        outputFormat: activeRetry.outputFormat,
        requestPolicy: activeRetry.requestPolicy,
        imagesNewAPICompat: activeRetry.imagesNewAPICompat,
        textModelID: activeRetry.textModelID,
        imageModelID: activeRetry.imageModelID,
        status: activeRetry.status,
        updatedAt: now,
        queuedReason: activeRetry.queuedReason,
        queuePriority: activeRetry.queuePriority,
        groupId: activeRetry.groupId,
        jobId: activeRetry.jobId,
        historyItemId: undefined,
        savedPath: undefined,
        rawPath: undefined,
        errorMessage: undefined,
        lastLogLine: activeRetry.lastLogLine,
        elapsedSec: undefined,
      };
      const retryPatch: WorkspacePatch = {
        ...taskRuntimePatchForWorkspace(workspaceId, currentTaskIds, mergedTasksById),
        resultGridOpen: true,
        historyGalleryOpen: false,
      };
      set((state) => ({
        batchTasksById: mergedTasksById,
        workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, retryPatch),
        ...(state.activeWorkspaceId === workspaceId ? { ...activeRuntimePatch(retryPatch), resultGridOpen: true, historyGalleryOpen: false } : {}),
      } as Partial<StudioState>));
      get().pushToast(
        activeRetry.status === "running"
          ? "\u8fd9\u4e2a\u4f4d\u7f6e\u5df2\u7ecf\u5728\u91cd\u65b0\u751f\u6210\uff0c\u5df2\u540c\u6b65\u4e3a\u6b63\u5728\u751f\u6210"
          : "\u8fd9\u4e2a\u4f4d\u7f6e\u5df2\u7ecf\u5728\u961f\u5217\u91cc\uff0c\u5df2\u540c\u6b65\u4e3a\u6392\u961f\u4e2d",
        "info",
        2600,
      );
      if (activeRetry.status === "queued") {
        if (activeRetry.continuousPoolTask) void requestContinuousPoolPump();
        else void pumpContinuousQueue(workspaceId, activeRetry.apiMode);
      }
      return;
    }
    const continuousPoolTask = task.continuousPoolTask === true;
    const retryQueueLimit = batchSharedTask
      ? retryContext.concurrencyLimit
      : continuousQueueLimitForState(s, retryContext.apiMode, retryContext.apiProfileSnapshot.apiProfileId);
    const retryAutoAspectResolution = retryAutoAspectResolutionForContext(task, workspace);
    const shouldRebuildRetryAutoAspectSize = !!retryAutoAspectResolution && !task.batchSourcePath;
    const retryAutoAspectSize = shouldRebuildRetryAutoAspectSize
      ? await buildRetryAutoAspectSizeForContext(task, workspace, retryAutoAspectResolution, {
        apiMode: retryContext.apiMode,
        requestPolicy: retryContext.requestPolicy,
        imageModelID: retryContext.imageModelID,
      })
      : null;
    if (shouldRebuildRetryAutoAspectSize && !retryAutoAspectSize) {
      const message = "Retry auto-aspect could not read the saved source image ratio";
      set({ errorMessage: message, errorRawPath: null });
      get().pushToast("Retry auto-aspect could not rebuild the saved size", "error", 4200);
      return;
    }
    const retrySize = normalizeSizeSelection(retryAutoAspectSize ?? task.size, {
      apiMode: retryContext.apiMode,
      requestPolicy: retryContext.requestPolicy,
      imageModelID: retryContext.imageModelID,
      mode: task.mode,
    });
    const queuedTask: BatchTaskRecord = {
      ...task,
      apiMode: retryContext.apiMode,
      ...retryContext.apiProfileSnapshot,
      apiBaseURL: retryContext.baseURL,
      size: retrySize,
      autoAspectResolution: retryAutoAspectResolution,
      requestPolicy: retryContext.requestPolicy,
      imagesNewAPICompat: retryContext.imagesNewAPICompat,
      textModelID: retryContext.textModelID,
      imageModelID: retryContext.imageModelID,
      status: "queued",
      updatedAt: Date.now(),
      queuedReason: continuousPoolTask
        ? "continuous_pool"
        : batchSharedTask ? "batch_shared_concurrency" : retryQueueLimit > 0 ? "local_concurrency" : undefined,
      queuePriority: undefined,
      groupId: undefined,
      jobId: undefined,
      historyItemId: undefined,
      savedPath: undefined,
      rawPath: undefined,
      errorMessage: undefined,
      lastLogLine: undefined,
      elapsedSec: undefined,
      autoRetryScheduledAt: undefined,
      autoRetryReason: undefined,
    };
    const queuedTasksById = { ...s.batchTasksById, [task.id]: queuedTask };
    const optimisticPatch: WorkspacePatch = {
      ...taskRuntimePatchForWorkspace(workspaceId, taskIds, queuedTasksById),
      errorMessage: null,
      errorRawPath: null,
      progress: null,
      streamPreview: null,
      streamPreviews: {},
      lastLogLine: "",
      resultGridOpen: true,
      historyGalleryOpen: false,
    };
    set((state) => ({
      batchTasksById: queuedTasksById,
      workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, optimisticPatch),
      ...(state.activeWorkspaceId === workspaceId ? { ...activeRuntimePatch(optimisticPatch), resultGridOpen: true, historyGalleryOpen: false } : {}),
    } as Partial<StudioState>));
    if (queuedTask.continuousPoolTask) {
      void requestContinuousPoolPump();
      get().pushToast("Retry queued on its original FHL API slot", "info", 2200);
      return;
    }
    if (batchSharedTask) {
      void pumpContinuousQueue(workspaceId, queuedTask.apiMode);
      get().pushToast("Queued task already uses batch-shared concurrency; waiting for the queue pump", "info", 2200);
      return;
    }
    const limit = continuousQueueLimitForState(get(), queuedTask.apiMode, queuedTask.apiProfileId);
    if (limit > 0) {
      void pumpContinuousQueue(workspaceId, queuedTask.apiMode);
      get().pushToast("Queued task submitted to continue in the background", "info", 2200);
      return;
    }
    try {
      if (!shouldUseBackgroundTaskProxyForSubmit(queuedTask.apiMode)) {
        const sourceImages = sourceImagesForTask(queuedTask);
        const payload: RuntimeGenerateOptions = {
          apiKey: cleanedAPIKey,
          mode: queuedTask.mode,
          requestedJobId: "",
          prompt: queuedTask.prompt,
          size: queuedTask.size,
          quality: queuedTask.quality,
          outputFormat: queuedTask.outputFormat,
          imagePaths: queuedTask.sourceImagePaths ?? [],
          imagePath: "",
          maskB64: queuedTask.maskB64 || "",
          seed: Number.isFinite(Number(queuedTask.seed)) ? Number(queuedTask.seed) : 0,
          negativePrompt: queuedTask.negativePrompt || "",
          baseURL: cleanedBaseURL,
          textModelID: queuedTask.textModelID || retryContext.textModelID,
          imageModelID: queuedTask.imageModelID || retryContext.imageModelID,
          proxyMode: s.proxyMode,
          proxyURL: s.proxyURL,
          requestPolicy: queuedTask.requestPolicy ?? retryContext.requestPolicy,
          apiMode: queuedTask.apiMode,
          apiProfileId: queuedTask.apiProfileId || "",
          imagesNewAPICompat: queuedTask.apiMode === "images" && queuedTask.imagesNewAPICompat === true,
          noPromptRevision: true,
          concurrencyLimit: retryContext.concurrencyLimit,
          partialImages: 1,
          sourceImages: queuedTask.mode === "edit" ? sourceImages : undefined,
        };
        void launchOneJob(queuedTask.mode, payload, {
          workspaceId,
          apiMode: queuedTask.apiMode,
          apiProfileId: queuedTask.apiProfileId,
          apiProfileName: queuedTask.apiProfileName,
          batchIndex: queuedTask.slotIndex,
          size: queuedTask.size,
          quality: queuedTask.quality,
          outputFormat: queuedTask.outputFormat,
          sources: sourceImages,
          currentImage: null,
          styleTag: queuedTask.styleTag || "",
          continuousGenerateTest: true,
          batchProcessLink: batchProcessLinkFromTask(queuedTask),
        });
        get().pushToast("Queued task was submitted through the API backend", "success", 2600);
        return;
      }
      const submitJobGroup = isAndroidTaskProxyMode() ? submitAndroidJobGroup : submitBrowserJobGroup;
      const response = await submitJobGroup({
        workspaceId,
        mode: queuedTask.mode,
        prompt: queuedTask.prompt,
        size: queuedTask.size,
        quality: queuedTask.quality,
        outputFormat: queuedTask.outputFormat,
        batchCount: 1,
        seed: Number.isFinite(Number(queuedTask.seed)) ? Number(queuedTask.seed) : 0,
        negativePrompt: queuedTask.negativePrompt || "",
        styleTag: queuedTask.styleTag || "",
        sourceImagePaths: queuedTask.sourceImagePaths ?? [],
        batchSourcePath: queuedTask.batchSourcePath || "",
        batchSourceSlotIndex: queuedTask.batchSourceSlotIndex,
        maskB64: queuedTask.maskB64 || "",
        apiKey: cleanedAPIKey,
        baseURL: cleanedBaseURL,
        apiMode: queuedTask.apiMode,
        apiProfileId: queuedTask.apiProfileId,
        apiProfileName: queuedTask.apiProfileName,
        requestPolicy: queuedTask.requestPolicy ?? retryContext.requestPolicy,
        imagesNewAPICompat: queuedTask.apiMode === "images"
          ? queuedTask.imagesNewAPICompat === true
          : false,
        textModelID: queuedTask.textModelID || retryContext.textModelID,
        imageModelID: queuedTask.imageModelID || retryContext.imageModelID,
        continuousGenerateTest: true,
        continuousBatchIndex: queuedTask.slotIndex,
      });
      const nextJobGroupsByWorkspace = mergeWorkspaceJobGroup(get().jobGroupsByWorkspace, response.group);
      const nextWorkspace = get().workspaces.find((entry) => entry.id === workspaceId);
      const batchTasksById = updateTasksFromJobGroup(
        get().batchTasksById,
        nextWorkspace?.batchTaskIds ?? [],
        response.group,
      );
      const browserPatch = browserRuntimePatchFromGroups(nextJobGroupsByWorkspace[workspaceId] ?? [], true);
      const taskPatch = taskRuntimePatchForWorkspace(workspaceId, nextWorkspace?.batchTaskIds ?? [], batchTasksById);
      const runtimePatch = { ...browserPatch, ...taskPatch, resultGridOpen: true, historyGalleryOpen: false };
      const runningJobMeta = buildRunningJobMetaFromBrowserGroups(nextJobGroupsByWorkspace);
      set((state) => ({
        jobGroupsByWorkspace: nextJobGroupsByWorkspace,
        batchTasksById,
        runningJobMeta,
        workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, runtimePatch),
        ...(state.activeWorkspaceId === workspaceId ? { ...activeRuntimePatch(runtimePatch), resultGridOpen: true, historyGalleryOpen: false } : {}),
      } as Partial<StudioState>));
      syncBrowserJobSubscriptions(nextJobGroupsByWorkspace);
      scheduleAutoRetriesForBrowserGroup(response.group);
      get().pushToast("Background queue submission completed", "success", 2600);
    } catch (error: any) {
      const message = `重新生成提交失败:${error?.message ?? error}`;
      const failedTasksById = {
        ...get().batchTasksById,
        [task.id]: {
          ...queuedTask,
          status: "failed" as const,
          updatedAt: Date.now(),
          errorMessage: message,
          lastLogLine: message,
        },
      };
      const failedPatch: WorkspacePatch = {
        ...taskRuntimePatchForWorkspace(workspaceId, taskIds, failedTasksById),
        errorMessage: message,
        errorRawPath: null,
        progress: null,
        streamPreview: null,
        streamPreviews: {},
        resultGridOpen: true,
        historyGalleryOpen: false,
      };
      set((state) => ({
        batchTasksById: failedTasksById,
        workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, failedPatch),
        ...(state.activeWorkspaceId === workspaceId ? { ...activeRuntimePatch(failedPatch), resultGridOpen: true, historyGalleryOpen: false } : {}),
      } as Partial<StudioState>));
      get().pushToast(message, "error", 4600);
      scheduleAutoRetryForTask(failedTasksById[task.id], message);
    }
  },

  retryFailedBatchTasks: async () => {
    const s = get();
    const workspaceId = s.activeWorkspaceId;
    const workspace = s.workspaces.find((entry) => entry.id === workspaceId);
    const retryHistoryById = new Map([...s.batchResults, ...s.history].map((item) => [item.id, item]));
    const failedTasks = sortedBatchTasksForCurrentView(workspaceId, workspace?.batchTaskIds ?? [], s.batchTasksById)
      .filter((task) => isRetryableBatchTask(task, retryHistoryById));
    if (failedTasks.length === 0) {
      s.pushToast("当前批次没有可重试的生成失败/终图缺失任务", "info", 2200);
      return;
    }
    s.pushToast(`正在重试当前批次 ${failedTasks.length} 个生成失败/终图缺失任务`, "info", 2600);
    for (const task of failedTasks) {
      const currentTask = get().batchTasksById[task.id];
      if (!currentTask || !isRetryableBatchTask(currentTask, retryHistoryById)) continue;
      await get().retryBatchTask(task.id);
    }
  },

  importImageFile: async (file, options) => (
    imageActions.importImageFile as (input: File, opts?: { forcePanorama?: boolean }) => Promise<void>
  )(file, options),
}));

// Fire one job (concurrent member of a batch). Registers its own EventsOn
// callbacks; updates store.runningJobs / jobsCompleted as the run progresses.
// `snapshot` is the store state at submit time; it captures size/quality/sources
// so per-job result writes still see the originating context.
async function launchOneJob(
  mode: string,
  payload: RuntimeGenerateOptions,
  snapshot: {
    workspaceId: string;
    apiMode: APIModeValue;
    apiProfileId?: string;
    apiProfileName?: string;
    batchIndex: number;
    size: SizeValue;
    quality: QualityValue;
    outputFormat: OutputFormatValue;
    sources: SourceImage[];
    currentImage: HistoryItem | null;
    styleTag: string;
    continuousGenerateTest?: boolean;
    batchProcessLink?: {
      sourcePath: string;
      outputDir: string;
      outputNamePrefix: string;
    };
  },
  hooks?: {
    onSettled?: (status: "success" | "error" | "cancelled") => void;
  },
): Promise<void> {
  const store = useStudioStore;
  const jobId = cryptoIDFallback();
  let offProgress = () => {};
  let offLog = () => {};
  let offPreview = () => {};
  let offResult = () => {};
  let offError = () => {};
  let offSettled = () => {};
  let terminalStatus: "success" | "error" | "cancelled" = "error";
  let terminalHandled = false;
  let settled = false;
  const cleanupTerminalEventHandlers = () => { offProgress(); offLog(); offPreview(); offResult(); offError(); };
  const cleanup = () => { cleanupTerminalEventHandlers(); offSettled(); };
  const isCancelledTaskForJob = () => {
    const task = Object.values(store.getState().batchTasksById).find((entry) => entry.jobId === jobId);
    return task?.status === "cancelled";
  };
  const notifySettled = (status: "success" | "error" | "cancelled") => {
    if (isFHLImagesPoolProfileId(store.getState(), snapshot.apiProfileId)) void requestContinuousPoolPump();
    hooks?.onSettled?.(status);
  };
  try {
    store.setState((state) => {
      const runtime = workspaceRuntimeFromState(state, snapshot.workspaceId);
      const runningJobs = runtime.runningJobs.includes(jobId)
        ? runtime.runningJobs
        : [...runtime.runningJobs, jobId];
      const workspace = state.workspaces.find((entry) => entry.id === snapshot.workspaceId);
      const nextTasksById = updateTaskForSlot(
        state.batchTasksById,
        workspace?.batchTaskIds ?? [],
        snapshot.workspaceId,
        snapshot.batchIndex,
        {
          status: "running",
          apiMode: snapshot.apiMode,
          apiProfileId: snapshot.apiProfileId,
          apiProfileName: snapshot.apiProfileName,
          size: snapshot.size,
          quality: snapshot.quality,
          outputFormat: snapshot.outputFormat,
          jobId,
          queuedReason: undefined,
          queuePriority: undefined,
          errorMessage: undefined,
        },
      );
      const patch: WorkspacePatch = {
        ...taskRuntimePatchForWorkspace(snapshot.workspaceId, workspace?.batchTaskIds ?? [], nextTasksById),
        runningJobs,
      };
      return {
        batchTasksById: nextTasksById,
        runningJobMeta: {
          ...state.runningJobMeta,
          [jobId]: { workspaceId: snapshot.workspaceId, apiMode: snapshot.apiMode, apiProfileId: snapshot.apiProfileId },
        },
        workspaces: patchWorkspaceRuntime(state.workspaces, snapshot.workspaceId, patch),
        ...(state.activeWorkspaceId === snapshot.workspaceId ? activeRuntimePatch(patch) : {}),
      } as Partial<StudioState>;
    });

    const removeFromRunning = (failed = false, releaseProfileCapacity = false) => {
      let completed = 0;
      let total = 0;
      store.setState((state) => {
        const runtime = workspaceRuntimeFromState(state, snapshot.workspaceId);
        const remaining = runtime.runningJobs.filter((id) => id !== jobId);
        const prunedPreview = removeStreamPreview(runtime.streamPreviews, jobId);
        completed = runtime.jobsCompleted + 1;
        total = runtime.jobsTotal;
        const patch: WorkspacePatch = {
          runningJobs: remaining,
          jobsCompleted: completed,
          jobsTotal: runtime.jobsTotal,
          jobsFailed: failed ? runtime.jobsFailed + 1 : runtime.jobsFailed,
          progress: remaining.length === 0 ? null : runtime.progress,
          streamPreview: remaining.length === 0 ? null : prunedPreview.streamPreview,
          streamPreviews: remaining.length === 0 ? {} : prunedPreview.streamPreviews,
          lastLogLine: remaining.length === 0 ? "" : runtime.lastLogLine,
        };
        const nextMeta = { ...state.runningJobMeta };
        if (releaseProfileCapacity) delete nextMeta[jobId];
        return {
          runningJobMeta: nextMeta,
          workspaces: patchWorkspaceRuntime(state.workspaces, snapshot.workspaceId, patch),
          ...(state.activeWorkspaceId === snapshot.workspaceId ? activeRuntimePatch(patch) : {}),
        } as Partial<StudioState>;
      });
      return { completed, total };
    };
    const releaseReservedJob = () => {
      store.setState((state) => {
        if (!state.runningJobMeta[jobId]) return {};
        const runningJobMeta = { ...state.runningJobMeta };
        delete runningJobMeta[jobId];
        return { runningJobMeta } as Partial<StudioState>;
      });
    };

    const desktopEventGate = createDesktopJobEventGate();
    offProgress = EventsOn(`progress:${jobId}`, (p: ProgressInfo, meta?: unknown) => {
      if (!desktopEventGate.accept(meta)) return;
      if (isCancelledTaskForJob()) return;
      const patch: WorkspacePatch = { progress: p };
      store.setState((state) => ({
        workspaces: patchWorkspaceRuntime(state.workspaces, snapshot.workspaceId, patch),
        ...(state.activeWorkspaceId === snapshot.workspaceId ? activeRuntimePatch(patch) : {}),
      } as Partial<StudioState>));
    });
    offLog = EventsOn(`log:${jobId}`, (line: string, meta?: unknown) => {
      if (!desktopEventGate.accept(meta)) return;
      if (isCancelledTaskForJob()) return;
      const patch: WorkspacePatch = { lastLogLine: line };
      store.setState((state) => ({
        workspaces: patchWorkspaceRuntime(state.workspaces, snapshot.workspaceId, patch),
        ...(state.activeWorkspaceId === snapshot.workspaceId ? activeRuntimePatch(patch) : {}),
      } as Partial<StudioState>));
    });
    offPreview = EventsOn(`preview:${jobId}`, (preview: StreamPreviewPayload, meta?: unknown) => {
      if (!desktopEventGate.accept(meta)) return;
      if (isCancelledTaskForJob()) return;
      store.setState((state) => (
        streamPreviewStatePatch(state, jobId, preview, {
          workspaceId: snapshot.workspaceId,
          mode: mode === "edit" ? "edit" : "generate",
          prompt: payload.prompt,
          size: snapshot.size,
          quality: snapshot.quality,
          outputFormat: snapshot.outputFormat,
          currentImage: snapshot.currentImage,
          batchIndex: snapshot.batchIndex,
        }) ?? {}
      ));
    });

    const startedAt = Date.now();
    offResult = EventsOn(`result:${jobId}`, (r: any, meta?: unknown) => {
      if (!desktopEventGate.accept(meta)) return;
      if (terminalHandled || isCancelledTaskForJob()) {
        terminalHandled = true;
        terminalStatus = "cancelled";
        cleanupTerminalEventHandlers();
        return;
      }
      terminalHandled = true;
      terminalStatus = "success";
      cleanupTerminalEventHandlers();
      void (async () => {
        try {
          const elapsedSec = (Date.now() - startedAt) / 1000;
          const rd = [elapsedSec, ...store.getState().recentDurations].slice(0, 5);
          const willNotify = typeof document !== "undefined" && document.visibilityState !== "visible";
          const parentId = mode === "edit"
            ? (snapshot.batchProcessLink?.sourcePath || snapshot.sources[0]?.path || snapshot.currentImage?.savedPath)
            : undefined;
          const sourceImages = sourceImagesForHistory(mode, snapshot.sources);
          const panoramaRoundtrip = findPanoramaRoundtripRef(sourceImages) ?? undefined;
          const panoramaProject = panoramaProjectFromEditSources(sourceImages, panoramaRoundtrip);
          const itemID = cryptoIDFallback();
          const fallbackB64 = typeof r.imageB64 === "string" ? r.imageB64 : "";
          const fallbackDims = fallbackB64 ? getImageDimensionsFromBase64(fallbackB64) : null;
          const previewItem: HistoryItem = {
            id: itemID,
            imageId: r.imageId || undefined,
            previewUrl: r.previewUrl || undefined,
            thumbPath: r.thumbPath || undefined,
            width: typeof r.width === "number" ? r.width : fallbackDims?.w,
            height: typeof r.height === "number" ? r.height : fallbackDims?.h,
            previewWidth: typeof r.previewWidth === "number" ? r.previewWidth : undefined,
            previewHeight: typeof r.previewHeight === "number" ? r.previewHeight : undefined,
            imageB64: fallbackB64 || undefined,
            imageBlob: null,
            previewBlob: null,
            previewOnly: true,
            prompt: r.prompt,
            revisedPrompt: r.revisedPrompt,
            mode: r.mode as Mode,
            apiMode: snapshot.apiMode,
            apiProfileId: snapshot.apiProfileId,
            apiProfileName: snapshot.apiProfileName,
            size: snapshot.size,
            quality: snapshot.quality,
            outputFormat: snapshot.outputFormat,
            parentId,
            createdAt: Date.now(),
            seed: payload.seed || undefined,
            negativePrompt: payload.negativePrompt || undefined,
            styleTag: snapshot.styleTag || undefined,
            batchIndex: snapshot.batchIndex,
            elapsedSec: Number(elapsedSec.toFixed(1)),
            sourceImages,
            panoramaRoundtrip,
            panoramaProject,
            savedPath: r.savedPath,
            rawPath: r.rawPath,
          };
          const activeItem: HistoryItem = {
            ...previewItem,
            fullUrl: r.fullUrl || (r.imageId ? `/media/full/${r.imageId}` : undefined),
            previewOnly: false,
          };
          const historyItem: HistoryItem = {
            ...previewItem,
            previewOnly: true,
          };
          const { completed: completedNow, total: totalNow } = removeFromRunning();
          const currentItem = totalNow > 1 || snapshot.continuousGenerateTest ? historyItem : activeItem;
          const trimmed = trimHistory([historyItem, ...store.getState().history]);
          store.setState((state) => {
            const workspace = state.workspaces.find((w) => w.id === snapshot.workspaceId);
            const gridWasOpen = state.activeWorkspaceId === snapshot.workspaceId
              ? state.resultGridOpen
              : workspace?.resultGridOpen ?? false;
            const mergedBatch = mergeWorkspaceBatchResult(state, snapshot.workspaceId, historyItem, trimmed);
            const nextGridOpen = snapshot.continuousGenerateTest ? true : gridWasOpen;
            const batchResults = state.activeWorkspaceId === snapshot.workspaceId
              ? mergedBatch.batchResults
              : state.batchResults;
            let batchTasksById = updateTaskFromHistoryItem(
              state.batchTasksById,
              workspace?.batchTaskIds ?? [],
              snapshot.workspaceId,
              historyItem,
            );
            const completedRecord = Object.values(batchTasksById).find((task) => (
              task.workspaceId === snapshot.workspaceId
              && (task.jobId === jobId || task.historyItemId === historyItem.id || task.slotIndex === snapshot.batchIndex)
            ));
            if (completedRecord && snapshot.apiMode === "apimart" && typeof r.apimartTaskId === "string" && r.apimartTaskId.trim()) {
              batchTasksById = {
                ...batchTasksById,
                [completedRecord.id]: {
                  ...completedRecord,
                  apimartTaskId: r.apimartTaskId.trim(),
                },
              };
            }
            return {
              history: trimmed,
              recentDurations: rd,
              batchTasksById,
              workspaces: patchWorkspaceRuntime(state.workspaces, snapshot.workspaceId, {
                currentImageId: historyItem.id,
                historyGallerySinglePreviewId: null,
                batchResultIds: mergedBatch.batchResultIds,
                resultGridOpen: nextGridOpen,
              }),
              ...(state.activeWorkspaceId === snapshot.workspaceId
                ? {
                    currentImage: snapshot.continuousGenerateTest
                      ? currentItem
                      : (nextGridOpen || totalNow <= 1 ? currentItem : state.currentImage),
                    batchResults,
                    historyGallerySinglePreviewId: null,
                    resultGridOpen: nextGridOpen,
                    maskDataURL: null,
                    annotations: [],
                    tool: "pan",
                  }
                : {}),
            } as Partial<StudioState>;
          });
          persistTrimmedHistory(trimmed);
          persistHistoryItem(historyItem).catch(() => undefined);
          const autoPastedPanorama = await autoPastePanoramaRoundtripResult(historyItem, {
            workspaceId: snapshot.workspaceId,
            selectAsCurrent: !snapshot.continuousGenerateTest && totalNow <= 1,
          }).catch((error: any) => {
            store.getState().pushToast(`全景贴回失败: ${error?.message ?? error}`, "warn", 4200);
            return null;
          });
          const completedTask = Object.values(store.getState().batchTasksById).find((task) => (
            task.workspaceId === snapshot.workspaceId
            && (task.jobId === jobId || task.historyItemId === historyItem.id || task.slotIndex === snapshot.batchIndex)
          ));
          if (completedTask) clearAutoRetryTimer(completedTask.id);
          syncBatchOutputAfterSuccess(snapshot.batchProcessLink, historyItem.savedPath);
          if (autoPastedPanorama) {
            store.getState().pushToast("已自动贴回全景图", "success", 3200);
          }
          // Notify and open the result detail after a successful save.
          if (willNotify) {
            tryNotify("FHL Studio", r.prompt ?? "", () => {
              store.getState().openResultDetail(historyItem);
            });
          }
          store.getState().pushToast(
            totalNow > 1
              ? `已完成 (${completedNow}/${totalNow})，耗时 ${elapsedSec.toFixed(0)}s`
              : `${historyItem.mode === "edit" ? "编辑完成" : "生成完成"}，耗时 ${elapsedSec.toFixed(0)}s`,
            "success",
            6000,
            { label: "打开", onClick: () => store.getState().openResultDetail(historyItem) },
          );
          // Delay the star prompt until transient result overlays are closed.
          try {
            if (usesWindowsDesktopUI
                && localStorage.getItem(STAR_PROMPTED_KEY) !== "1"
                && !store.getState().starPromptOpen) {
              setTimeout(() => {
                const snapshot = store.getState();
                const overlayBusy =
                  snapshot.upstreamModalOpen ||
                  snapshot.resultDetail !== null ||
                  document.querySelector('[role="dialog"]') !== null;
                if (!overlayBusy && localStorage.getItem(STAR_PROMPTED_KEY) !== "1") {
                  store.setState({ starPromptOpen: true, starPromptSource: "auto" });
                }
              }, 3500);
            }
          } catch { /* localStorage cleanup is best-effort. */ }
        } catch (err: any) {
          const patch: WorkspacePatch = {
            errorMessage: `保存生成结果失败：${err?.message ?? err}`,
            errorRawPath: null,
          };
          store.setState((state) => ({
            workspaces: patchWorkspaceRuntime(state.workspaces, snapshot.workspaceId, patch),
            ...(state.activeWorkspaceId === snapshot.workspaceId ? activeRuntimePatch(patch) : {}),
          } as Partial<StudioState>));
          removeFromRunning();
          terminalStatus = "error";
        }
      })();
    });
    offError = EventsOn(`error:${jobId}`, (e: { message: string; rawPath?: string; apimartTaskId?: string }, meta?: unknown) => {
      if (!desktopEventGate.accept(meta)) return;
      if (terminalHandled || isCancelledTaskForJob()) {
        terminalHandled = true;
        terminalStatus = "cancelled";
        cleanupTerminalEventHandlers();
        return;
      }
      terminalHandled = true;
      terminalStatus = "error";
      cleanupTerminalEventHandlers();
      store.setState((state) => {
        const runtime = workspaceRuntimeFromState(state, snapshot.workspaceId);
        const prunedPreview = removeStreamPreview(runtime.streamPreviews, jobId);
        const workspace = state.workspaces.find((w) => w.id === snapshot.workspaceId);
        const slotTask = findTaskForSlot(workspace?.batchTaskIds ?? [], state.batchTasksById, snapshot.workspaceId, snapshot.batchIndex);
        const batchTasksById = slotTask?.status === "cancelled"
          ? state.batchTasksById
          : updateTaskForSlot(
              state.batchTasksById,
              workspace?.batchTaskIds ?? [],
              snapshot.workspaceId,
              snapshot.batchIndex,
              {
                status: "failed",
                jobId,
                errorMessage: e?.message ?? "Failed to save history item",
                lastLogLine: runtime.lastLogLine || undefined,
                rawPath: (typeof e?.rawPath === "string" && e.rawPath) ? e.rawPath : undefined,
                apimartTaskId: typeof e?.apimartTaskId === "string" && e.apimartTaskId.trim() ? e.apimartTaskId.trim() : undefined,
              },
            );
        const patch: WorkspacePatch = {
          errorMessage: e?.message ?? "Failed to save history item",
          errorRawPath: (typeof e?.rawPath === "string" && e.rawPath) ? e.rawPath : null,
          streamPreview: prunedPreview.streamPreview,
          streamPreviews: prunedPreview.streamPreviews,
        };
        return {
          batchTasksById,
          workspaces: patchWorkspaceRuntime(state.workspaces, snapshot.workspaceId, patch),
          ...(state.activeWorkspaceId === snapshot.workspaceId
            ? {
                ...activeRuntimePatch(patch),
                currentImage: restoreCurrentImageAfterPreviewError(state, jobId, {
                  workspaceId: snapshot.workspaceId,
                  mode: mode === "edit" ? "edit" : "generate",
                  prompt: payload.prompt,
                  size: snapshot.size,
                  quality: snapshot.quality,
                  outputFormat: snapshot.outputFormat,
                  currentImage: snapshot.currentImage,
                }),
              }
            : {}),
        } as Partial<StudioState>;
      });
      removeFromRunning(true);
      const failedTask = Object.values(store.getState().batchTasksById).find((task) => (
        task.workspaceId === snapshot.workspaceId
        && (task.jobId === jobId || task.slotIndex === snapshot.batchIndex)
      ));
      if (failedTask) scheduleAutoRetryForTask(failedTask, e?.message ?? failedTask.errorMessage);
    });
    offSettled = EventsOn(`settled:${jobId}`, (_payload?: unknown, meta?: unknown) => {
      desktopEventGate.observe(meta);
      if (settled) return;
      settled = true;
      cleanup();
      const cancelled = isCancelledTaskForJob();
      store.setState((state) => {
        if (!state.runningJobMeta[jobId]) return {};
        const runningJobMeta = { ...state.runningJobMeta };
        delete runningJobMeta[jobId];
        return { runningJobMeta } as Partial<StudioState>;
      });
      notifySettled(cancelled ? "cancelled" : terminalStatus);
    });
    if (isCancelledTaskForJob()) {
      cleanup();
      releaseReservedJob();
      notifySettled("cancelled");
      return;
    }
    const started = mode === "edit"
      ? await wailsEdit({ ...payload, requestedJobId: jobId } as backend.GenerateOptions)
      : await wailsGenerate({ ...payload, requestedJobId: jobId } as backend.GenerateOptions);
    if (started.jobId && started.jobId !== jobId) {
      cleanup();
      throw new Error(`job id 不一致: expected ${jobId}, got ${started.jobId}`);
    }
  } catch (e: any) {
    cleanup();
    const message = `提交失败:${e?.message ?? e}`;
    const patch: WorkspacePatch = {
      errorMessage: message,
      errorRawPath: null,
    };
    store.setState((state) => {
      const runtime = workspaceRuntimeFromState(state, snapshot.workspaceId);
      const nextMeta = { ...state.runningJobMeta };
      delete nextMeta[jobId];
      const remaining = runtime.runningJobs.filter((id) => id !== jobId);
      const prunedPreview = removeStreamPreview(runtime.streamPreviews, jobId);
      const workspace = state.workspaces.find((w) => w.id === snapshot.workspaceId);
      const batchTasksById = updateTaskForSlot(
        state.batchTasksById,
        workspace?.batchTaskIds ?? [],
        snapshot.workspaceId,
        snapshot.batchIndex,
        {
          status: "failed",
          jobId,
          errorMessage: message,
          lastLogLine: runtime.lastLogLine || message,
        },
      );
      const nextPatch: WorkspacePatch = {
        ...patch,
        runningJobs: remaining,
        jobsTotal: runtime.jobsTotal,
        jobsCompleted: runtime.jobsCompleted + 1,
        jobsFailed: runtime.jobsFailed + 1,
        progress: remaining.length === 0 ? null : runtime.progress,
        streamPreview: remaining.length === 0 ? null : prunedPreview.streamPreview,
        streamPreviews: remaining.length === 0 ? {} : prunedPreview.streamPreviews,
        lastLogLine: remaining.length === 0 ? "" : runtime.lastLogLine,
      };
      return {
        runningJobMeta: nextMeta,
        batchTasksById,
        workspaces: patchWorkspaceRuntime(state.workspaces, snapshot.workspaceId, nextPatch),
        ...(state.activeWorkspaceId === snapshot.workspaceId ? activeRuntimePatch(nextPatch) : {}),
      } as Partial<StudioState>;
    });
    const failedTask = Object.values(store.getState().batchTasksById).find((task) => (
      task.workspaceId === snapshot.workspaceId
      && (task.jobId === jobId || task.slotIndex === snapshot.batchIndex)
    ));
    if (failedTask) scheduleAutoRetryForTask(failedTask, message);
    notifySettled("error");
  }
}

export { tempDataURLFromB64, writeBase64ToTempFile };

async function materializeHistoryItem(item: HistoryItem): Promise<HistoryItem> {
  return materializeHistoryItemRuntime(item, {
    setState: (fn) => useStudioStore.setState((state) => fn(state)),
  });
}

async function ensureFullHistoryItem(item: HistoryItem | null): Promise<HistoryItem | null> {
  return ensureFullHistoryItemRuntime(item, {
    setState: (fn) => useStudioStore.setState((state) => fn(state)),
  });
}

useStudioStore.subscribe((state, prevState) => {
  const workspaceSessionChanged =
    state.activeWorkspaceId !== prevState.activeWorkspaceId
    || state.workspaces !== prevState.workspaces
    || state.promptPrefix !== prevState.promptPrefix
    || state.prompt !== prevState.prompt
    || state.optimizationGuidance !== prevState.optimizationGuidance
    || state.negativePrompt !== prevState.negativePrompt
    || state.mode !== prevState.mode
    || state.size !== prevState.size
    || state.quality !== prevState.quality
    || state.outputFormat !== prevState.outputFormat
    || state.seed !== prevState.seed
    || state.batchCount !== prevState.batchCount
    || state.continuousGenerateTest !== prevState.continuousGenerateTest
    || state.editSourceMode !== prevState.editSourceMode
    || state.batchProcess !== prevState.batchProcess
    || state.styleTag !== prevState.styleTag
    || state.sources !== prevState.sources
    || state.currentImage !== prevState.currentImage
    || state.batchResults !== prevState.batchResults
    || state.batchTasksById !== prevState.batchTasksById
    || state.resultGridOpen !== prevState.resultGridOpen
    || state.historyGallerySinglePreviewId !== prevState.historyGallerySinglePreviewId
    || state.runningJobs !== prevState.runningJobs
    || state.jobsTotal !== prevState.jobsTotal
    || state.jobsCompleted !== prevState.jobsCompleted
    || state.jobsFailed !== prevState.jobsFailed
    || state.progress !== prevState.progress
    || state.streamPreview !== prevState.streamPreview
    || state.streamPreviews !== prevState.streamPreviews
    || state.lastLogLine !== prevState.lastLogLine
    || state.errorMessage !== prevState.errorMessage
    || state.errorRawPath !== prevState.errorRawPath;
  if (!workspaceSessionChanged) return;
  const terminalChanged = state.jobsCompleted !== prevState.jobsCompleted
    || state.jobsFailed !== prevState.jobsFailed
    || (prevState.isRunning && !state.isRunning);
  scheduleWorkspaceSessionPersistence(state, terminalChanged);
});

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => flushWorkspaceSessionPersistence(useStudioStore.getState()));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushWorkspaceSessionPersistence(useStudioStore.getState());
    }
  });
}
