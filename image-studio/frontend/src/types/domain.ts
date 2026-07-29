// Domain types shared across components. Backend-emitted shapes live in
// wailsjs/go/models.ts; this file owns the frontend-only state.

export type Mode = "generate" | "edit";

// 上游 API 形态 —— Responses (`/v1/responses` + SSE) 或标准 Images API。
// 老代码里以前是顶层全局二选一,v0.1.6 起降级成 profile 的字段。
export type APIMode = "responses" | "images" | "apimart" | "runninghub";
export type RequestPolicy = "openai" | "compat";

// UpstreamProfile 是一组完整可用于生成的上游配置。用户可以保存多个,例如
// 「gptcodex 主号 / gptcodex 备号 / OpenAI 直连」,在 UI 里下拉切换 active。
//
// 注意 apiKey 不在这里 —— 它走系统凭据存储(Keychain / Credential Manager /
// Secret Service),用 profile.id 作为 keyring "user" 寻址。JSON 导出 /
// localStorage 里都不会出现明文 key。
export interface UpstreamProfile {
  id: string;
  name: string;
  apiMode: APIMode;
  requestPolicy: RequestPolicy;
  baseURL: string;
  textModelID: string;
  imageModelID: string;
  // 0 = 不限。同一 profile 跨所有 workspace 共享并发计数。
  concurrencyLimit: number;
  // 仅 Images profile 可加入桌面连续生成的自动分配池。
  continuousPoolEnabled?: boolean;
  // Stable 1..10 slot for the official FHL Images continuous-pool setup.
  fhlImagesPoolSlot?: number;
  // Sanitized last four characters of a pool key. This is display metadata,
  // never a credential, and is only retained for an official Images pool slot.
  fhlImagesPoolKeyHint?: string;
  imagesNewAPICompat?: boolean;
  createdAt: number;
  // 最近一次被 setActive / 提交生成 时更新;用于把最近使用过的 profile 在
  // 下拉里排到前面,以及下次启动默认 active。
  lastUsedAt?: number;
}

export type SizeValue =
  | "auto"
  | `${number}x${number}`
  | `${number}:${number}`
  | `${number}:${number}@${"1k" | "2k" | "4k"}`;
export type QualityValue = "auto" | "high" | "medium" | "low";
export type KernelRuntimeMode = "auto" | "local" | "remote";
export type ProxyMode = "none" | "system" | "custom";
// 让上游做编码;落盘扩展名 jpeg → .jpg,其他原样。
export type OutputFormatValue = "png" | "jpeg" | "webp";
export type ThemeMode = "system" | "light" | "dark";
export type HistoryGallerySort = "newest" | "oldest";
export type EditSourceMode = "manual" | "batch";
export type BatchProcessOutputMode = "source_dir" | "custom_dir";
export type BatchProcessAutoAspectResolution = "" | "1k" | "2k" | "4k";

export interface SizeOption { value: SizeValue; label: string; }
export interface QualityOption { value: QualityValue; label: string; }
export interface OutputFormatOption { value: OutputFormatValue; label: string; }

export interface PanoramaShot {
  id: string;
  yaw_deg: number;
  pitch_deg: number;
  roll_deg: number;
  hFOV_deg: number;
  vFOV_deg: number;
  out_w: number;
  out_h: number;
  aspect_id: string;
}

export interface PanoramaRoundtripState {
  kind: "ty360_roundtrip_state";
  version: 1;
  projection_model: "pinhole_rectilinear";
  source_erp: {
    width: number;
    height: number;
    path?: string;
    history_id?: string;
  };
  rect: {
    width: number;
    height: number;
  };
  pose: {
    yaw_deg: number;
    pitch_deg: number;
    roll_deg: number;
    hFOV_deg: number;
    vFOV_deg: number;
  };
  source_aspect: number;
}

export interface PanoramaRoundtripRef {
  sourceHistoryId?: string;
  sourcePath?: string;
  roundtripState: PanoramaRoundtripState;
}

export type PanoramaProjectRole = "source" | "shot" | "edited-shot" | "pasted-panorama";

export interface PanoramaProjectRef {
  sourceHistoryId: string;
  sourcePath?: string;
  role: PanoramaProjectRole;
  shotHistoryId?: string;
  editedShotHistoryId?: string;
}

export interface PanoramaPastebackAlignment {
  offsetXRatio: number;
  offsetYRatio: number;
  scale: number;
  rotationDeg: number;
  featherFraction?: number;
  brightness?: number;
  contrast?: number;
  hueRotationDeg?: number;
}

export const SIZE_OPTIONS: SizeOption[] = [
  { value: "auto",      label: "自适应 auto" },
  { value: "1024x1024", label: "1K 方形 1024×1024" },
  { value: "1536x1024",  label: "1K 横版 1248×832" },
  { value: "1024x1536",  label: "1K 竖版 832×1248" },
  { value: "1536x864",  label: "1K 横版 1280×720" },
  { value: "864x1536",  label: "1K 竖版 720×1280" },
  { value: "2048x2048", label: "2K 方形 2048×2048" },
  { value: "2048x1360", label: "2K 横版 2048×1360" },
  { value: "1360x2048", label: "2K 竖版 1360×2048" },
  { value: "2048x1152", label: "2K 横版 2048×1152" },
  { value: "1152x2048", label: "2K 竖版 1152×2048" },
  { value: "2880x2880", label: "4K 方形 2880×2880" },
  { value: "3456x2304", label: "4K 横版 3456×2304" },
  { value: "2304x3456", label: "4K 竖版 2304×3456" },
  { value: "3840x2160", label: "4K 横版 3840×2160" },
  { value: "2160x3840", label: "4K 竖版 2160×3840" },
];

export const QUALITY_OPTIONS: QualityOption[] = [
  { value: "auto",   label: "自适应 auto" },
  { value: "high",   label: "高质量 high" },
  { value: "medium", label: "中等 medium" },
  { value: "low",    label: "快速草稿 low" },
];

export const OUTPUT_FORMAT_OPTIONS: OutputFormatOption[] = [
  { value: "png",  label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WebP" },
];

export interface SourceImage {
  // Local path on disk (path is what the Go backend ultimately reads).
  path: string;
  name: string;
  size: number;       // bytes; 0 when unknown (e.g. reused-from-history)
  width?: number;
  height?: number;
  previewUrl?: string;
  imageBlob?: Blob | null;
  // Legacy/browser fallback for canvas preview. Wails source previews should
  // prefer previewUrl so selected files do not cross the bridge as base64.
  imageB64?: string;
  panoramaRoundtrip?: PanoramaRoundtripRef;
  panoramaProject?: PanoramaProjectRef;
}

export interface BatchProcessSourceImage {
  path: string;
  name: string;
  size: number;
  width?: number;
  height?: number;
  previewUrl?: string;
  previewWidth?: number;
  previewHeight?: number;
  selected?: boolean;
}

export interface BatchProcessConfig {
  inputDir: string;
  outputMode: BatchProcessOutputMode;
  outputDir: string;
  concurrency: number;
  retryOnFailure: boolean;
  autoAspectResolution: BatchProcessAutoAspectResolution;
  batchSourceSlotIndex?: number;
  discoveredSources: BatchProcessSourceImage[];
}

export type MaterialGroupKind = "folder" | "referenceSet";

export type MaterialRef =
  | { kind: "history"; historyId: string }
  | { kind: "source"; source: SourceImage };

export interface MaterialGroup {
  id: string;
  name: string;
  description?: string;
  kind: MaterialGroupKind;
  items: MaterialRef[];
  createdAt: number;
  updatedAt: number;
}

export interface PSBridgeSourceMetadata {
  order: number;
  sourceKind: string;
  displayName: string;
  documentId?: string;
  layerId?: string;
  layerPath?: string;
  trimMode?: string;
  originalWidth?: number;
  originalHeight?: number;
  uploadWidth?: number;
  uploadHeight?: number;
}

export interface PSBridgeHistoryMetadata {
  jobId: string;
  clientTaskId: string;
  sources: PSBridgeSourceMetadata[];
}

export interface HistoryItem {
  id: string;
  imageId?: string;
  previewUrl?: string;
  fullUrl?: string;
  thumbPath?: string;
  previewWidth?: number;
  previewHeight?: number;
  width?: number;
  height?: number;
  // Legacy/import/browser fallback. New Wails result records keep this empty so
  // full images do not live in persistent Zustand/history/batch state.
  imageB64?: string;
  imageBlob?: Blob | null;
  previewBlob?: Blob | null;
  previewOnly?: boolean;
  prompt: string;
  revisedPrompt?: string;
  mode: Mode;
  apiMode?: APIMode;
  apiProfileId?: string;
  apiProfileName?: string;
  fhlImagesPoolSlot?: number;
  size: SizeValue;
  quality: QualityValue;
  outputFormat?: OutputFormatValue;
  parentId?: string;       // id of the source image (when mode === "edit")
  createdAt: number;       // unix ms

  // Extended params — captured at submit time so the item can be exactly
  // reproduced via "重新生成" or "应用参数" from the right-click menu.
  seed?: number;
  negativePrompt?: string;
  styleTag?: string;
  batchIndex?: number;
  elapsedSec?: number;     // generation duration in seconds
  sourceImages?: SourceImage[]; // edit-mode input images captured for apply/regenerate

  savedPath?: string;
  rawPath?: string;
  psBridge?: PSBridgeHistoryMetadata;
  panoramaRoundtrip?: PanoramaRoundtripRef;
  panoramaProject?: PanoramaProjectRef;
}

export interface ProgressInfo {
  stage: string;
  elapsed: number;
  bytes: number;
}

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface JobStatusSummary {
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  interrupted: number;
}

export interface JobSlotSnapshot {
  jobId: string;
  groupId: string;
  workspaceId: string;
  batchIndex: number;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  startedAt?: number | null;
  finishedAt?: number | null;
  stage?: string;
  elapsedSec?: number;
  bytes?: number;
  savedPath?: string;
  rawPath?: string;
  errorMessage?: string;
  revisedPrompt?: string;
  sourceEvent?: string;
  apimartTaskId?: string;
  fallbackMode?: string;
  fallbackInputPath?: string;
  fallbackReason?: string;
  attemptSummary?: string[];
}

export interface JobGroupSnapshot {
  groupId: string;
  runId?: string;
  clientTaskId?: string;
  workspaceId: string;
  createdAt: number;
  mode: Mode;
  apiMode: APIMode;
  apiProfileId?: string;
  apiProfileName?: string;
  fhlImagesPoolSlot?: number;
  prompt: string;
  batchCount: number;
  size: SizeValue;
  quality: QualityValue;
  outputFormat: OutputFormatValue;
  negativePrompt?: string;
  styleTag?: string;
  seed?: number;
  sourceImagePaths?: string[];
  batchSourcePath?: string;
  batchSourceSlotIndex?: number;
  continuousGenerateTest?: boolean;
  continuousBatchIndex?: number;
  slotIds: string[];
  slots: JobSlotSnapshot[];
  statusSummary: JobStatusSummary;
}

export interface BatchTaskRecord {
  id: string;
  runId?: string;
  workspaceId: string;
  slotIndex: number;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  mode: Mode;
  apiMode: APIMode;
  apiProfileId?: string;
  apiProfileName?: string;
  fhlImagesPoolSlot?: number;
  // Captured when a continuous-pool task receives a profile. This is
  // intentionally non-sensitive; credentials remain in the OS keyring.
  apiBaseURL?: string;
  continuousPoolTask?: boolean;
  prompt: string;
  size: SizeValue;
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
  autoAspectResolution?: Exclude<BatchProcessAutoAspectResolution, "">;
  maskB64?: string;
  launchState?: "submitting";
  launchAttempt?: number;
  launchStartedAt?: number;
  jobId?: string;
  groupId?: string;
  historyItemId?: string;
  savedPath?: string;
  rawPath?: string;
  apimartTaskId?: string;
  apimartTaskExpiresAt?: number;
  errorMessage?: string;
  lastLogLine?: string;
  elapsedSec?: number;
  autoRetryCount?: number;
  autoRetryScheduledAt?: number;
  autoRetryReason?: string;
  queuedReason?: "local_concurrency" | "batch_shared_concurrency" | "continuous_pool";
  queuePriority?: number;
  batchOutputMode?: BatchProcessOutputMode;
  batchOutputDir?: string;
  batchOutputPrefix?: string;
}

export interface StreamPreview {
  jobId: string;
  imageId?: string;
  previewUrl?: string;
  previewWidth?: number;
  previewHeight?: number;
  width?: number;
  height?: number;
  imageB64?: string;
  revisedPrompt?: string;
  partialImageIndex?: number;
  batchIndex?: number;
  updatedAt: number;
}

export type StreamPreviewMap = Record<string, StreamPreview>;

export interface Workspace {
  id: string;
  name: string;
  // Fields whose value is workspace-scoped (different per tab).
  promptPrefix: string;
  prompt: string;
  optimizationGuidance: string;
  negativePrompt: string;
  mode: Mode;
  size: SizeValue;
  quality: QualityValue;
  outputFormat: OutputFormatValue;
  seed: number;
  batchCount: number;
  continuousGenerateTest: boolean;
  editSourceMode: EditSourceMode;
  batchProcess: BatchProcessConfig;
  editAutoAspectUserLocked: boolean;
  styleTag: string;
  sources: SourceImage[];
  // We store currentImageId rather than the full HistoryItem so we don't
  // duplicate large base64 blobs. The history list is shared across tabs.
  currentImageId: string | null;
  // IDs from the latest multi-request run for this workspace. These are history
  // IDs so the tab state stays light while the canvas can reopen the batch grid.
  batchResultIds: string[];
  // IDs from the latest batch/continuous run for this workspace. These point to
  // task records so failed/cancelled/in-flight slots do not disappear.
  batchTaskIds: string[];
  clearedJobGroupsBefore?: number;
  selectedBatchTaskId: string | null;
  batchSinglePreviewOpen: boolean;
  resultGridOpen: boolean;
  historyGalleryOpen: boolean;
  historyGallerySinglePreviewId?: string | null;
  historyGallerySort: HistoryGallerySort;
  runningJobIds: string[];
  jobsTotal: number;
  jobsCompleted: number;
  jobsFailed: number;
  progress: ProgressInfo | null;
  streamPreview: StreamPreview | null;
  streamPreviews?: StreamPreviewMap;
  lastLogLine: string;
  errorMessage: string | null;
  // 最近一次失败时上游原始响应文件的绝对路径(SSE / Images API JSON)。前端
  // 「查看日志」按钮调 OpenFile 直接打开。请求前期校验失败 / 早期 IO 错误时
  // 此字段为 null。跟 errorMessage 一对,workspace 隔离,切 tab 各自保持。
  errorRawPath?: string | null;
  lastPayload?: import("../../wailsjs/go/models").backend.GenerateOptions | null;
}

export interface Preset {
  id: string;
  name: string;
  size: SizeValue;
  quality: QualityValue;
  outputFormat?: OutputFormatValue;
  negativePrompt: string;
  kernelRuntimeMode?: KernelRuntimeMode;
  batchCount: number;
}

export interface Toast {
  id: string;
  text: string;
  kind: "info" | "success" | "error" | "warn";
  // Unix ms when the toast was created — used for ordering and auto-dismiss.
  createdAt: number;
  // Auto-dismiss timeout in ms; 0 = sticky (manual close only).
  ttl: number;
  // 可选 CTA。点击触发 onClick 后 toast 自动关闭。
  action?: { label: string; onClick: () => void };
}

export type AnnotationKind = "rect" | "arrow" | "text" | "freehand";

export interface Annotation {
  id: string;
  kind: AnnotationKind;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  color: string;
  // For freehand: flat number[] of x,y,x,y,... in image-local coords.
  points?: number[];
}

export const ANNOTATION_COLORS = [
  "#ff4d4d", "#ff9c00", "#ffd400", "#7bd400",
  "#00c8ff", "#4d7cff", "#a060ff", "#ff60c8",
];
