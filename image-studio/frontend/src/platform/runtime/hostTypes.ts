export type GenerationRequest = {
  apiKey: string;
  apiProfileId?: string;
  mode: string;
  prompt: string;
  size: string;
  quality: string;
  outputFormat: string;
  imagePaths: string[];
  imagePath: string;
  maskB64: string;
  seed: number;
  negativePrompt: string;
  baseURL: string;
  textModelID: string;
  imageModelID: string;
  proxyMode?: string;
  proxyURL?: string;
  apiMode: string;
  requestPolicy: string;
  imagesNewAPICompat?: boolean;
  noPromptRevision: boolean;
  concurrencyLimit?: number;
  partialImages?: number;
  requestedJobId?: string;
  sourceImages?: Array<{
    path?: string;
    name?: string;
    mimeType?: string | null;
    imageB64?: string | null;
    imageBlob?: Blob | null;
  }>;
};

export type GenerateOptionsLike = GenerationRequest;

export type PromptOptimizeOptionsLike = {
  apiKey: string;
  prompt: string;
  optimizationGuidance?: string;
  mode: string;
  baseURL: string;
  textModelID: string;
  proxyMode?: string;
  proxyURL?: string;
  imagePaths: string[];
  imagePath: string;
};

export type PromptReverseOptionsLike = {
  apiKey: string;
  baseURL: string;
  textModelID: string;
  proxyMode?: string;
  proxyURL?: string;
  imagePaths: string[];
  imagePath: string;
  sourceImages?: Array<{
    path?: string;
    name?: string;
    mimeType?: string | null;
    imageB64?: string | null;
    imageBlob?: Blob | null;
  }>;
};

export type ProbeUpstreamOptionsLike = {
  apiKey: string;
  baseURL: string;
  proxyMode?: string;
  proxyURL?: string;
};

export type ProbeUpstreamResultLike = {
  modelCount: number;
};

export type JobStartedLike = { jobId: string };
export type ImportedImageLike = {
  path: string;
  imageB64?: string;
  imageId?: string;
  previewUrl?: string;
  width?: number;
  height?: number;
  previewWidth?: number;
  previewHeight?: number;
};
export type ImageTransformResultLike = { path: string; acceleration?: string };
export type SelectFileResponseLike = {
  path: string;
  name?: string;
  size: number;
  imageB64?: string;
  imageId?: string;
  previewUrl?: string;
  width?: number;
  height?: number;
  previewWidth?: number;
  previewHeight?: number;
};
export type BatchInputImageLike = {
  path: string;
  name: string;
  size: number;
  width?: number;
  height?: number;
  previewUrl?: string;
  previewWidth?: number;
  previewHeight?: number;
};
export type BatchInputDirectoryLike = {
  directory: string;
  images: BatchInputImageLike[];
};
export type SelectFilesResponseLike = {
  files: BatchInputImageLike[];
};
export type MediaAssetRefLike = {
  imageId?: string;
  savedPath?: string;
  thumbPath?: string;
  previewUrl?: string;
  fullUrl?: string;
  width?: number;
  height?: number;
  previewWidth?: number;
  previewHeight?: number;
};

export type AutomationStatusLike = {
  enabled: boolean;
  mode?: string;
  serverUrl?: string;
  port?: number;
  e2eOnly?: boolean;
  packageVersion?: string;
  pid?: number;
  executable?: string;
  startedAt?: number;
  bridgeMethods?: string[];
};

export type MaterialOutputSyncItemLike = {
  historyId: string;
  savedPath: string;
  suggestedName?: string;
  missingReason?: string;
};

export type MaterialOutputSyncedFileLike = {
  historyId: string;
  source: string;
  path: string;
};

export type MaterialOutputSyncMissingLike = {
  historyId: string;
  path?: string;
  reason: string;
};

export type MaterialOutputSyncResultLike = {
  targetDir: string;
  synced: number;
  missing: number;
  files: MaterialOutputSyncedFileLike[];
  missingItems: MaterialOutputSyncMissingLike[];
};
export type HostKind = "wails-desktop" | "android-shell" | "browser";

export type HostCapabilities = {
  localGeneration: boolean;
  promptOptimization: boolean;
  nativeFileDialogs: boolean;
  nativeImageTransforms: boolean;
  imageTransformAcceleration: "gpu-metal" | "gpu-webgl" | "cpu-canvas" | "native" | "none";
  nativeHistoryFileIO: boolean;
  nativeOutputDirectoryPicker: boolean;
  secureCredentialStore: boolean;
};

export type KernelRuntimeMode = "auto" | "local" | "remote";
