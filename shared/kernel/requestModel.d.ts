export const DEFAULT_TEXT_MODEL: string;
export const DEFAULT_IMAGE_MODEL: string;
export const DEFAULT_SIZE: string;
export const DEFAULT_QUALITY: string;
export const DEFAULT_OUTPUT_FORMAT: string;
export const DEFAULT_REQUEST_POLICY: string;
export const DEFAULT_PARTIAL_IMAGES: number;
export const MAX_ATTEMPTS: number;
export const RETRY_BACKOFF_MS: number;
export const STATUS_INTERVAL_MS: number;
export const OPENAI_IMAGE_MIN_PIXELS: number;
export const OPENAI_IMAGE_MAX_PIXELS: number;
export const OPENAI_IMAGE_MAX_SIDE: number;
export const OPENAI_IMAGE_ALIGNMENT: number;
export const OPENAI_IMAGE_MAX_ASPECT: number;
export const FHL_BASE_URL: string;

export type RequestPolicy = "openai" | "compat";

export type SharedImageRequestPayload = {
  size?: string;
  quality?: string;
  outputFormat?: string;
  prompt?: string;
  imageModelID?: string;
  textModelID?: string;
  negativePrompt?: string;
  maskB64?: string;
  seed?: number;
  requestPolicy?: RequestPolicy;
  apiMode?: string;
  baseURL?: string;
  imagesNewAPICompat?: boolean;
  noPromptRevision?: boolean;
  mode?: string;
  partialImages?: number;
  requestRunId?: string;
  batchVariationKey?: string;
  batchIndex?: number;
  batchCount?: number;
};

export function normalizeBaseURL(raw: string): string;
export function normalizeAPIMode(apiMode: string): "responses" | "images" | "apimart";
export function normalizeRequestPolicy(requestPolicy: string): RequestPolicy;
export function normalizeTextModel(modelID: string): string;
export function normalizeImageModel(modelID: string): string;
export function normalizePromptText(prompt: string): string;
export function normalizeNegativePrompt(negativePrompt: string): string;
export function normalizePartialImages(value: unknown): number;
export function parseSizeValue(size: string): { width: number; height: number } | null;
export function formatSizeValue(width: number, height: number): string;
export function normalizeOpenAIImageSize(size: string | { width: number; height: number }): { width: number; height: number } | null;
export function repairSizeForOpenAI<T extends { size?: string }>(payload: T): (T & { size: string }) | null;
export function extractInvalidSize(raw: string): { original: string; reason: string } | null;
export function isCompatRequestPolicy(requestPolicy: string): boolean;
export function classifyImageModel(modelID: string): "gpt-image" | "dalle2" | "dalle3" | "other";
export function supportsImagesResponseFormat(imageModelID: string, mode?: string): boolean;
export function shouldSendExtendedImageParameters(requestPolicy: string): boolean;
export function shouldUseImagesNewAPICompat(payload?: SharedImageRequestPayload | null): boolean;
export function fileNameFromPath(path?: string): string;
export function dataURLFromBase64Image(b64: string, mimeType?: string): string;
export function buildResponsesInputContent(prompt: string, sourceDataURLs: string[]): Array<Record<string, unknown>>;
export function buildBatchVariationInstruction(payload?: SharedImageRequestPayload | null): string;
export function promptWithBatchVariation(payload?: SharedImageRequestPayload | null): string;
export function buildResponsesImageTool(
  payload: SharedImageRequestPayload,
  sourceDataURLs: string[],
  options?: { maskMimeType?: string },
): Record<string, unknown>;
export function shouldDisablePartialImagesForFHLExactResponses(payload: SharedImageRequestPayload, size?: string): boolean;
export function fhlExactResponsesAspectInstruction(payload: SharedImageRequestPayload, size?: string): string;
export function fhlExactResponsesAspectPromptSuffix(payload: SharedImageRequestPayload, size?: string): string;
export function buildResponsesPayload(
  payload: SharedImageRequestPayload,
  sourceDataURLs: string[],
  options?: { maskMimeType?: string },
): Record<string, unknown>;
export function buildPromptOptimizePayload(
  input: {
    prompt?: string;
    optimizationGuidance?: string;
    mode?: string;
    textModelID?: string;
  },
  sourceDataURLs: string[],
): Record<string, unknown>;
export function buildPromptReversePayload(
  input: {
    textModelID?: string;
  },
  sourceDataURLs: string[],
): Record<string, unknown>;
export function retryableMarkers(): string[];
export function isRetryableRaw(raw: string): boolean;
export function describeAPIError(error: Record<string, unknown>): string;
export function describeProblem(raw: string): string;
