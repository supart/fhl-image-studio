import type { RequestPolicy } from "../../../types/domain";

export type KernelImageSource = {
  path?: string;
  name?: string;
  mimeType?: string | null;
  imageB64?: string | null;
  imageBlob?: Blob | null;
};

export type RemoteGeneratePayload = {
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
  requestPolicy: RequestPolicy;
  imagesNewAPICompat?: boolean;
  noPromptRevision: boolean;
  concurrencyLimit?: number;
  partialImages?: number;
};

export type ProgressCallback = (stage: string, elapsedSeconds: number, bytesReceived: number) => void;
export type PartialImageCallback = (partial: {
  imageB64: string;
  revisedPrompt?: string;
  partialImageIndex?: number;
  sourceEvent?: "responses_partial" | "images_partial";
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
};

export type RemoteJobResult = {
  imageB64: string;
  revisedPrompt: string;
  sourceEvent: string;
  rawPath: string | null;
  prompt: string;
  mode: string;
  apimartTaskId?: string;
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
export const PARTIAL_FINAL_MATCH_MESSAGE = "上游返回的最终图与中间预览帧一致，已拦截保存，请重新生成。";

export class RemoteKernelError extends Error {
  rawPath: string | null;
  apimartTaskId?: string;

  constructor(message: string, rawPath: string | null = null) {
    super(message);
    this.name = "RemoteKernelError";
    this.rawPath = rawPath;
  }
}

export type NativeTextResponse = {
  status: number;
  body: string;
  contentType?: string;
};

export type ExtractedImageResult = {
  imageB64: string;
  revisedPrompt: string;
  sourceEvent: string;
};

export function imagePayloadFingerprint(imageB64: string | null | undefined): string {
  return typeof imageB64 === "string" ? imageB64.replace(/\s+/g, "").trim() : "";
}

export function rejectIfFinalMatchesPartial(
  finalImageB64: string | null | undefined,
  partialFingerprints: Set<string>,
  rawPath: string | null = null,
) {
  const fingerprint = imagePayloadFingerprint(finalImageB64);
  if (!fingerprint || !partialFingerprints.has(fingerprint)) return;
  throw new RemoteKernelError(PARTIAL_FINAL_MATCH_MESSAGE, rawPath);
}
