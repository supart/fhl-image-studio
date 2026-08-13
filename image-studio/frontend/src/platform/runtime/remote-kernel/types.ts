import type { RequestPolicy } from "../../../types/domain";

export type KernelImageSource = {
  path?: string;
  name?: string;
  mimeType?: string | null;
  imageB64?: string | null;
  imageBlob?: Blob | null;
  previewUrl?: string | null;
};

export type RemoteGeneratePayload = {
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
  requestPolicy: RequestPolicy;
  imagesNewAPICompat?: boolean;
  noPromptRevision: boolean;
  concurrencyLimit?: number;
  partialImages?: number;
  requestRunId?: string;
  batchVariationKey?: string;
  batchIndex?: number;
  batchCount?: number;
};

export type ProgressCallback = (stage: string, elapsedSeconds: number, bytesReceived: number) => void;
export type PartialImageCallback = (partial: {
  imageB64: string;
  revisedPrompt?: string;
  partialImageIndex?: number;
  sourceEvent?: "responses_partial" | "images_partial";
}) => void;

export type APIMartTaskSubmittedCallback = (task: {
  taskId: string;
  status?: string;
  rawPath?: string | null;
}) => void;

export type RemoteJobRequest = {
  payload: RemoteGeneratePayload;
  sourceImages?: KernelImageSource[];
};

export type RemoteJobCallbacks = {
  signal: AbortSignal;
  onLog?: (line: string) => void;
  onProgress?: ProgressCallback;
  onPartialImage?: PartialImageCallback;
  onAPIMartTaskSubmitted?: APIMartTaskSubmittedCallback;
};

export type RemoteJobResult = {
  imageB64: string;
  revisedPrompt: string;
  sourceEvent: string;
  rawPath: string | null;
  prompt: string;
  mode: string;
  apimartTaskId?: string;
  apimartTaskStatus?: string;
};

export type RemoteAPIMartTaskQueryInput = {
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

export type RemoteAPIMartTaskQueryResult = {
  taskId: string;
  status: string;
  imageB64?: string;
  rawPath: string | null;
  errorMessage?: string;
};

export type RemotePromptOptimizeInput = {
  apiKey: string;
  prompt: string;
  optimizationGuidance?: string;
  mode: string;
  baseURL: string;
  textModelID: string;
  proxyMode?: string;
  proxyURL?: string;
  imagePaths?: string[];
  imagePath?: string;
  sourceImages?: KernelImageSource[];
};

export type RemotePromptReverseInput = {
  apiKey: string;
  baseURL: string;
  textModelID: string;
  proxyMode?: string;
  proxyURL?: string;
  imagePaths?: string[];
  imagePath?: string;
  sourceImages?: KernelImageSource[];
};

export const MAX_ATTEMPTS = 3;
export const RETRY_BACKOFF_MS = 15_000;
export const STATUS_INTERVAL_MS = 10_000;

export class RemoteKernelError extends Error {
  rawPath: string | null;
  apimartTaskId?: string;
  apimartTaskStatus?: string;

  constructor(
    message: string,
    rawPath: string | null = null,
    options: { apimartTaskId?: string; apimartTaskStatus?: string } = {},
  ) {
    super(message);
    this.name = "RemoteKernelError";
    this.rawPath = rawPath;
    this.apimartTaskId = options.apimartTaskId;
    this.apimartTaskStatus = options.apimartTaskStatus;
  }
}

export type NativeTextResponse = {
  status: number;
  body: string;
  bodyBase64?: string;
  contentType?: string;
};

export type ExtractedImageResult = {
  imageB64: string;
  revisedPrompt: string;
  sourceEvent: string;
};
