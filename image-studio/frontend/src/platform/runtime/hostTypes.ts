export type GenerateOptionsLike = {
  apiKey: string;
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
  requestRunId?: string;
  batchVariationKey?: string;
  batchIndex?: number;
  batchCount?: number;
  sourceImages?: Array<{
    path?: string;
    name?: string;
    mimeType?: string | null;
    imageB64?: string | null;
    imageBlob?: Blob | null;
  }>;
};

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

export type APIMartTaskQueryOptionsLike = {
  apiKey: string;
  baseURL: string;
  taskId: string;
  prompt?: string;
  mode?: string;
  size?: string;
  quality?: string;
  outputFormat?: string;
  imageModelID?: string;
  proxyMode?: string;
  proxyURL?: string;
};

export type APIMartTaskQueryResultLike = {
  taskId: string;
  status: string;
  imageB64?: string;
  rawPath?: string | null;
  errorMessage?: string;
};

export type ProbeUpstreamOptionsLike = {
  apiKey: string;
  baseURL: string;
  apiMode?: string;
  proxyMode?: string;
  proxyURL?: string;
};

export type ProbeUpstreamResultLike = {
  modelCount?: number;
  ok?: boolean;
};

export type JobStartedLike = { jobId: string };
export type ImportedImageLike = {
  path: string;
  imageB64?: string;
  imageId?: string;
  previewUrl?: string;
  previewWidth?: number;
  previewHeight?: number;
};
export type ImageTransformResultLike = { path: string; acceleration?: string };
export type SelectFileResponseLike = {
  path: string;
  size: number;
  imageB64?: string;
  imageId?: string;
  previewUrl?: string;
  previewWidth?: number;
  previewHeight?: number;
};
export type MediaAssetRefLike = {
  imageId?: string;
  savedPath?: string;
  thumbPath?: string;
  previewUrl?: string;
  fullUrl?: string;
  previewWidth?: number;
  previewHeight?: number;
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
