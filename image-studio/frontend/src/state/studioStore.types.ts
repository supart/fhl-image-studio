import type { backend } from "../../wailsjs/go/models";
import type { PanoramaPastebackMaskInput } from "../panorama/core";
import type {
  Annotation,
  APIMode,
  BatchProcessConfig,
  BatchTaskRecord,
  EditSourceMode,
  HistoryGallerySort,
  HistoryItem,
  JobGroupSnapshot,
  KernelRuntimeMode,
  MaterialGroup,
  MaterialGroupKind,
  MaterialRef,
  Mode,
  OutputFormatValue,
  PanoramaPastebackAlignment,
  Preset,
  ProgressInfo,
  ProxyMode,
  QualityValue,
  RequestPolicy,
  SizeValue,
  SourceImage,
  StreamPreview,
  StreamPreviewMap,
  ThemeMode,
  Toast,
  UpstreamProfile,
  Workspace,
} from "../types/domain";
import type { HistoryPageCursor } from "../lib/storage";
import type { MaterialOutputSyncResultLike } from "../platform/runtime/hostTypes";
import type { RunningJobMeta } from "./workspaceRuntime";

export interface ReversePromptImage {
  path: string;
  name: string;
  size: number;
  previewUrl?: string;
  imageB64?: string;
  imageBlob?: Blob | null;
}

export interface ModeConfig {
  baseURL: string;
  apiKey: string;
  textModelID: string;
  imageModelID: string;
  concurrencyLimit: number;
}

export type CompareMode = "curtain" | "sideBySide";

export type FHLTransportMode = "images" | "responses";

export interface PromptOptimizeRequest {
  apiKey: string;
  prompt: string;
  optimizationGuidance: string;
  mode: Mode;
  baseURL: string;
  textModelID: string;
  proxyMode: ProxyMode;
  proxyURL: string;
  imagePaths: string[];
  imagePath: string;
}

export interface PromptReverseRequest {
  apiKey: string;
  baseURL: string;
  textModelID: string;
  proxyMode: ProxyMode;
  proxyURL: string;
  imagePaths: string[];
  imagePath: string;
  sourceImages?: Array<{
    path?: string;
    name?: string;
    imageB64?: string | null;
    imageBlob?: Blob | null;
  }>;
}

export interface Stroke {
  points: number[];
  size: number;
  erase?: boolean;
}

export interface UndoEntry {
  label: string;
  undo: (s: StudioState) => Partial<StudioState>;
  redo: (s: StudioState) => Partial<StudioState>;
}

export type FHLTextAPITestStatus = "unconfigured" | "saved" | "testing" | "success" | "error";

export interface StudioState {
  apiKey: string;
  mode: Mode;
  promptPrefix: string;
  prompt: string;
  optimizationGuidance: string;
  negativePrompt: string;
  size: SizeValue;
  quality: QualityValue;
  outputFormat: OutputFormatValue;
  seed: number;
  kernelRuntimeMode: KernelRuntimeMode;
  baseURL: string;
  textModelID: string;
  proxyMode: ProxyMode;
  proxyURL: string;
  imageModelID: string;
  apiMode: APIMode;
  requestPolicy: RequestPolicy;
  imagesNewAPICompat: boolean;
  noPromptRevision: boolean;
  fhlTransportMode: FHLTransportMode;
  fhlTextAPIConfigured: boolean;
  fhlTextAPIKeyHint: string;
  fhlTextAPITestStatus: FHLTextAPITestStatus;
  fhlTextAPITestMessage: string;
  profiles: UpstreamProfile[];
  activeProfileId: string;
  sources: SourceImage[];
  reversePromptImage: ReversePromptImage | null;
  runningJobs: string[];
  jobsTotal: number;
  jobsCompleted: number;
  jobsFailed: number;
  progress: ProgressInfo | null;
  streamPreview: StreamPreview | null;
  streamPreviews: StreamPreviewMap;
  lastLogLine: string;
  errorMessage: string | null;
  errorRawPath: string | null;
  isRunning: boolean;
  lastPayload: backend.GenerateOptions | null;
  runningJobMeta: Record<string, RunningJobMeta>;
  jobGroupsByWorkspace: Record<string, JobGroupSnapshot[]>;
  batchTasksById: Record<string, BatchTaskRecord>;
  currentImage: HistoryItem | null;
  sourcePreviewReturnImage: HistoryItem | null;
  history: HistoryItem[];
  historyHasMore: boolean;
  historyLoading: boolean;
  historyCursor: HistoryPageCursor | null;
  batchResults: HistoryItem[];
  selectedBatchTaskId: string | null;
  resultGridOpen: boolean;
  historyGalleryOpen: boolean;
  historyGallerySinglePreviewId: string | null;
  historyGallerySort: HistoryGallerySort;
  materialManagerOpen: boolean;
  materialGroups: MaterialGroup[];
  historyRailCollapsed: boolean;
  historyTimelineOpen: boolean;
  tool: "pan" | "mask" | "annotate";
  brushSize: number;
  brushMode: "paint" | "erase";
  annotationKind: "rect" | "arrow" | "freehand" | "text";
  annotationColor: string;
  selectedAnnotationId: string | null;
  maskDataURL: string | null;
  strokes: Stroke[];
  annotations: Annotation[];
  compareB: HistoryItem | null;
  compareMode: CompareMode;
  compareSplit: number;
  toasts: Toast[];
  recentDurations: number[];
  viewZoom: number;
  canvasViewResetTick: number;
  fullscreen: boolean;
  promptHistory: string[];
  batchCount: number;
  continuousGenerateTest: boolean;
  fhlPoolPerAPIConcurrencyLimit: number;
  fhlPoolEffectiveConcurrencyByProfileId: Record<string, number>;
  editSourceMode: EditSourceMode;
  batchProcess: BatchProcessConfig;
  editAutoAspectUserLocked: boolean;
  presets: Preset[];
  theme: ThemeMode;
  fontScale: number;
  workspaces: Workspace[];
  activeWorkspaceId: string;
  styleTag: string;
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  setField: <K extends keyof StudioState>(key: K, value: StudioState[K]) => void;
  setFullscreen: (value: boolean) => Promise<void>;
  toggleFullscreen: () => Promise<void>;
  setAPIKey: (v: string) => Promise<void>;
  setFHLTransportMode: (mode: FHLTransportMode) => void;
  clearError: () => void;
  createProfile: (input: {
    name?: string;
    apiMode: APIMode;
    baseURL?: string;
    requestPolicy?: RequestPolicy;
    textModelID?: string;
    imageModelID?: string;
    concurrencyLimit?: number;
    continuousPoolEnabled?: boolean;
    fhlImagesPoolSlot?: number;
    fhlImagesPoolKeyHint?: string;
    imagesNewAPICompat?: boolean;
    apiKey?: string;
    setActive?: boolean;
  }) => Promise<string>;
  updateProfile: (id: string, patch: Partial<Omit<UpstreamProfile, "id" | "createdAt">> & { apiKey?: string }) => Promise<boolean>;
  deleteProfile: (id: string) => Promise<boolean>;
  duplicateProfile: (id: string) => Promise<string | null>;
  setActiveProfile: (id: string) => Promise<void>;
  selectSourceImage: () => Promise<void>;
  selectBatchInputDir: () => Promise<void>;
  selectBatchInputFiles: () => Promise<void>;
  refreshBatchInputDir: () => Promise<void>;
  chooseBatchOutputDir: () => Promise<void>;
  importSourceImageFile: (file: File) => Promise<void>;
  selectReversePromptImage: () => Promise<void>;
  importReversePromptImageFile: (file: File) => Promise<void>;
  clearReversePromptImage: () => void;
  removeSource: (index: number) => void;
  clearSources: () => void;
  reorderSources: (from: number, to: number) => void;
  submit: () => Promise<void>;
  cancel: () => Promise<void>;
  selectBatchTask: (taskId: string | null) => void;
  selectBatchTaskForCancel: (taskId: string | null) => void;
  cancelBatchTask: (taskId: string) => Promise<void>;
  cancelQueuedBatchTasks: () => Promise<void>;
  clearFailedBatchTasks: () => Promise<void>;
  promoteBatchTask: (taskId: string) => Promise<void>;
  cancelSelectedTask: () => Promise<void>;
  recoverRunningHubResult: (taskId: string) => Promise<HistoryItem | null>;
  recoverAPIMartResult: (taskId: string) => Promise<HistoryItem | null>;
  recoverAPIMartTaskResult: (apimartTaskId: string, options?: { rawPath?: string }) => Promise<HistoryItem | null>;
  reuseAsSource: (item: HistoryItem) => Promise<void>;
  repastePanoramaRoundtrip: (item: HistoryItem, options?: { selectAsCurrent?: boolean; alignment?: PanoramaPastebackAlignment | null; pasteMask?: PanoramaPastebackMaskInput | null }) => Promise<HistoryItem | null>;
  importExternalPanoramaPastebackImage: (anchorItem: HistoryItem, file: File) => Promise<HistoryItem | null>;
  applyHistoryParams: (item: HistoryItem) => void;
  regenerateFromHistory: (item: HistoryItem) => Promise<void>;
  deleteHistoryItem: (id: string) => Promise<void>;
  saveCurrentImageAs: () => Promise<void>;
  saveHistoryItemAs: (item: HistoryItem) => Promise<void>;
  shareCurrentImage: () => Promise<void>;
  shareHistoryItem: (item: HistoryItem) => Promise<void>;
  bootstrap: () => Promise<void>;
  setMaskDataURL: (v: string | null) => void;
  pushStroke: (s: Stroke) => void;
  resetMask: () => void;
  addAnnotation: (a: Annotation) => void;
  removeAnnotation: (id: string) => void;
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  clearAnnotations: () => void;
  undo: () => void;
  redo: () => void;
  setCompareB: (item: HistoryItem | null, mode?: CompareMode) => void;
  setCompareSplit: (v: number) => void;
  openCompareWithPrimarySource: (mode?: CompareMode) => Promise<void>;
  openSourcePreview: (item: HistoryItem) => void;
  closeSourcePreview: () => void;
  openResultGrid: () => void;
  closeResultGrid: () => void;
  selectBatchGridItem: (item: HistoryItem) => void;
  selectBatchResult: (item: HistoryItem) => Promise<void>;
  openHistoryGallery: () => Promise<void>;
  closeHistoryGallery: () => void;
  closeHistoryGalleryToEmpty: () => void;
  setHistoryGallerySort: (value: HistoryGallerySort) => void;
  selectHistoryGalleryGridItem: (item: HistoryItem) => void;
  selectHistoryGalleryResult: (item: HistoryItem) => Promise<void>;
  openMaterialManager: () => void;
  closeMaterialManager: () => void;
  createMaterialGroup: (kind: MaterialGroupKind, name: string, items?: MaterialRef[], description?: string) => string;
  renameMaterialGroup: (id: string, name: string) => void;
  deleteMaterialGroup: (id: string) => void;
  moveHistoryItemsToMaterialGroup: (groupId: string, historyIds: string[]) => void;
  removeMaterialItem: (groupId: string, itemRef: MaterialRef) => void;
  createReferenceSetFromCurrentSources: (name: string) => string | null;
  applyMaterialReferenceSet: (groupId: string, mode: "append" | "replace") => Promise<void>;
  syncMaterialGroupToOutput: (groupId: string) => Promise<MaterialOutputSyncResultLike | null>;
  syncAllMaterialGroupsToOutput: () => Promise<void>;
  openMaterialSyncDir: (path?: string) => Promise<void>;
  importImageFile: (file: File, options?: { forcePanorama?: boolean }) => Promise<void>;
  pushToast: (text: string, kind?: Toast["kind"], ttl?: number, action?: Toast["action"]) => void;
  dismissToast: (id: string) => void;
  resultDetail: HistoryItem | null;
  openResultDetail: (item: HistoryItem) => Promise<void>;
  closeResultDetail: () => void;
  panoramaViewerItem: HistoryItem | null;
  openPanoramaViewer: (item: HistoryItem) => Promise<void>;
  closePanoramaViewer: () => void;
  panoramaAlignTarget: HistoryItem | null;
  openPanoramaPastebackAligner: (item: HistoryItem) => void;
  closePanoramaPastebackAligner: () => void;
  materializeCurrentImage: (item: HistoryItem) => Promise<HistoryItem>;
  loadMoreHistory: () => Promise<void>;
  retryLast: () => Promise<void>;
  retryFailedJob: (groupId: string, jobId: string) => Promise<void>;
  retryBatchTask: (taskId: string, options?: { independent?: boolean; automatic?: boolean; useTaskProfile?: boolean }) => Promise<void>;
  retryFailedBatchTasks: () => Promise<void>;
  setHistoryRailCollapsed: (collapsed: boolean) => void;
  openHistoryTimeline: () => void;
  closeHistoryTimeline: () => void;
  pruneHistoryOlderThanDays: (days: number) => Promise<number>;
  savePreset: (name: string) => void;
  applyPreset: (id: string) => void;
  deletePreset: (id: string) => void;
  exportHistory: () => Promise<void>;
  importHistory: () => Promise<void>;
  setTheme: (t: ThemeMode) => void;
  setFontScale: (v: number) => void;
  setProxyConfig: (mode: ProxyMode, url?: string) => void;
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  testAPIKey: () => Promise<void>;
  testProfileConnection: (profileId: string) => Promise<boolean>;
  refreshFHLTextAPIConfig: () => Promise<void>;
  saveAndTestFHLTextAPI: (apiKeyInput?: string) => Promise<boolean>;
  deleteFHLTextAPIConfig: () => Promise<void>;
  isTestingKey: boolean;
  isOptimizingPrompt: boolean;
  isReversingPrompt: boolean;
  optimizePrompt: (options?: { useGuidance?: boolean }) => Promise<void>;
  reversePromptFromImage: () => Promise<void>;
  upstreamModalOpen: boolean;
  upstreamReturnTarget: "app" | "settings";
  openUpstreamConfig: (returnTarget?: "app" | "settings") => void;
  closeUpstreamConfig: () => void;
  starPromptOpen: boolean;
  starPromptSource: "auto" | "manual";
  openStarPrompt: () => void;
  dismissStarPrompt: () => void;
  resetCurrentWorkspaceDraft: () => void;
  setFHLPoolPerAPIConcurrencyLimit: (limit: number) => Promise<void>;
  runContinuousPressureTest: (count: number) => Promise<void>;
  newWorkspace: (name?: string) => void;
  switchWorkspace: (id: string) => void;
  closeWorkspace: (id: string) => void;
  renameWorkspace: (id: string, name: string) => void;
  rotateCurrent: (degrees: number) => Promise<void>;
  flipCurrent: (horizontal: boolean) => Promise<void>;
  cropToRect: (x: number, y: number, w: number, h: number) => Promise<void>;
}
