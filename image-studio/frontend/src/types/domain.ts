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
  // Images profile 是否参与连续生成的自动分配池。
  continuousPoolEnabled?: boolean;
  // 官方 FHL Images 池中的稳定槽号，仅允许 1..10。
  fhlImagesPoolSlot?: number;
  // 仅用于辨认槽位的脱敏 Key 提示，绝不能保存完整凭据。
  fhlImagesPoolKeyHint?: string;
  imagesNewAPICompat?: boolean;
  createdAt: number;
  // 最近一次被 setActive / 提交生成 时更新;用于把最近使用过的 profile 在
  // 下拉里排到前面,以及下次启动默认 active。
  lastUsedAt?: number;
}

export type SizeValue = "auto" | `${number}x${number}` | `${number}:${number}` | `${number}:${number}@${"1k" | "2k" | "4k"}`;
export type QualityValue = "auto" | "high" | "medium" | "low";
export type KernelRuntimeMode = "auto" | "local" | "remote";
export type ProxyMode = "none" | "system" | "custom";
// 让上游做编码;落盘扩展名 jpeg → .jpg,其他原样。
export type OutputFormatValue = "png" | "jpeg" | "webp";
export type ThemeMode = "system" | "light" | "dark";

export interface SizeOption { value: SizeValue; label: string; }
export interface QualityOption { value: QualityValue; label: string; }
export interface OutputFormatOption { value: OutputFormatValue; label: string; }

export const SIZE_OPTIONS: SizeOption[] = [
  { value: "auto",      label: "自适应 auto" },
  { value: "1024x1024", label: "方形 1024×1024" },
  { value: "1536x1024", label: "横版 1536×1024" },
  { value: "1024x1536", label: "竖版 1024×1536" },
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
  previewUrl?: string;
  imageBlob?: Blob | null;
  // Legacy/browser fallback for canvas preview. Wails source previews should
  // prefer previewUrl so selected files do not cross the bridge as base64.
  imageB64?: string;
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
  size: SizeValue;
  quality: QualityValue;
  outputFormat?: OutputFormatValue;
  // Frozen request transport. Old records may omit this, in which case the
  // UI must keep the generic label instead of inferring from current settings.
  apiMode?: APIMode;
  apiLabel?: string;
  apiProfileId?: string;
  apiProfileName?: string;
  fhlImagesPoolSlot?: number;
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
  galleryUri?: string;
  rawPath?: string;
  taskId?: string;
  runningHubRecoverable?: boolean;
  apimartTaskId?: string;
  apimartTaskStatus?: string;
  apimartTaskLastCheckedAt?: number;
}

export interface APIMartRecoveryTask {
  taskId: string;
  workspaceId: string;
  baseURL: string;
  prompt: string;
  mode: Mode;
  size: SizeValue;
  quality: QualityValue;
  outputFormat: OutputFormatValue;
  batchIndex?: number;
  errorMessage?: string;
  rawPath?: string;
  status?: string;
  createdAt: number;
  lastCheckedAt?: number;
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
  apiLabel?: string;
  apiProfileId?: string;
  apiProfileName?: string;
  fhlImagesPoolSlot?: number;
  queueSequence?: number;
  reservationSlot?: number;
  reservationSessionId?: string;
  reservationKind?: "fhl_images_pool" | "direct";
  reservationLaneKey?: string;
  reservationActive?: boolean;
  cancelRequested?: boolean;
  settledAt?: number | null;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  startedAt?: number | null;
  finishedAt?: number | null;
  stage?: string;
  elapsedSec?: number;
  bytes?: number;
  savedPath?: string;
  galleryUri?: string;
  thumbPath?: string;
  previewUrl?: string;
  previewWidth?: number;
  previewHeight?: number;
  width?: number;
  height?: number;
  rawPath?: string;
  taskId?: string;
  runningHubRecoverable?: boolean;
  apimartTaskId?: string;
  apimartTaskStatus?: string;
  apimartTaskLastCheckedAt?: number;
  errorMessage?: string;
  revisedPrompt?: string;
  sourceEvent?: string;
  fallbackMode?: string;
  fallbackInputPath?: string;
  fallbackReason?: string;
  attemptSummary?: string[];
}

export interface JobGroupSnapshot {
  groupId: string;
  workspaceId: string;
  createdAt: number;
  mode: Mode;
  apiMode: APIMode;
  apiLabel?: string;
  clientSubmissionId?: string;
  apiProfileId?: string;
  apiProfileName?: string;
  fhlImagesPoolSlot?: number;
  prompt: string;
  batchCount: number;
  concurrencyLimit?: number;
  size: SizeValue;
  quality: QualityValue;
  outputFormat: OutputFormatValue;
  negativePrompt?: string;
  styleTag?: string;
  seed?: number;
  sourceImagePaths?: string[];
  continuousGenerateTest?: boolean;
  continuousBatchIndex?: number;
  requestRunId?: string;
  slotIds: string[];
  slots: JobSlotSnapshot[];
  statusSummary: JobStatusSummary;
}

export interface StreamPreview {
  jobId: string;
  imageId?: string;
  previewUrl?: string;
  previewWidth?: number;
  previewHeight?: number;
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
  optimizationGuidance?: string;
  negativePrompt: string;
  mode: Mode;
  size: SizeValue;
  quality: QualityValue;
  outputFormat: OutputFormatValue;
  seed: number;
  batchCount: number;
  continuousGenerateTest?: boolean;
  styleTag: string;
  sources: SourceImage[];
  // We store currentImageId rather than the full HistoryItem so we don't
  // duplicate large base64 blobs. The history list is shared across tabs.
  currentImageId: string | null;
  // IDs from the latest multi-request run for this workspace. These are history
  // IDs so the tab state stays light while the canvas can reopen the batch grid.
  batchResultIds: string[];
  resultGridOpen: boolean;
  runningJobIds: string[];
  jobsTotal: number;
  jobsCompleted: number;
  progress: ProgressInfo | null;
  streamPreview: StreamPreview | null;
  streamPreviews?: StreamPreviewMap;
  lastLogLine: string;
  errorMessage: string | null;
  // 最近一次失败时上游原始响应文件的绝对路径(SSE / Images API JSON)。前端
  // 「查看日志」按钮调 OpenFile 直接打开。请求前期校验失败 / 早期 IO 错误时
  // 此字段为 null。跟 errorMessage 一对,workspace 隔离,切 tab 各自保持。
  errorRawPath?: string | null;
  apimartRecoveryTask?: APIMartRecoveryTask | null;
  apimartRecoveryTasks?: APIMartRecoveryTask[];
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
