import type { GenerationRequest } from "./hostTypes";
import type { RemoteGeneratePayload } from "./remote-kernel/types";

export type GenerationMode = "generate" | "edit";

export function generationRequestForMode(
  request: GenerationRequest,
  mode: GenerationMode,
): GenerationRequest {
  return {
    apiKey: request.apiKey,
    apiProfileId: request.apiProfileId,
    mode,
    prompt: request.prompt,
    size: request.size,
    quality: request.quality,
    outputFormat: request.outputFormat,
    imagePaths: [...request.imagePaths],
    imagePath: request.imagePath,
    maskB64: request.maskB64,
    seed: request.seed,
    negativePrompt: request.negativePrompt,
    baseURL: request.baseURL,
    textModelID: request.textModelID,
    imageModelID: request.imageModelID,
    proxyMode: request.proxyMode,
    proxyURL: request.proxyURL,
    apiMode: request.apiMode,
    requestPolicy: request.requestPolicy,
    imagesNewAPICompat: request.imagesNewAPICompat,
    noPromptRevision: request.noPromptRevision,
    concurrencyLimit: request.concurrencyLimit,
    partialImages: request.partialImages,
    requestedJobId: request.requestedJobId,
    sourceImages: request.sourceImages?.map((source) => ({
      path: source.path,
      name: source.name,
      mimeType: source.mimeType,
      imageB64: source.imageB64,
      imageBlob: source.imageBlob,
    })),
  };
}

export function toWailsGenerationRequest(request: GenerationRequest): Omit<GenerationRequest, "sourceImages"> {
  return {
    apiKey: request.apiKey,
    apiProfileId: request.apiProfileId,
    mode: request.mode,
    prompt: request.prompt,
    size: request.size,
    quality: request.quality,
    outputFormat: request.outputFormat,
    imagePaths: [...request.imagePaths],
    imagePath: request.imagePath,
    maskB64: request.maskB64,
    seed: request.seed,
    negativePrompt: request.negativePrompt,
    baseURL: request.baseURL,
    textModelID: request.textModelID,
    imageModelID: request.imageModelID,
    proxyMode: request.proxyMode,
    proxyURL: request.proxyURL,
    apiMode: request.apiMode,
    requestPolicy: request.requestPolicy,
    imagesNewAPICompat: request.imagesNewAPICompat,
    noPromptRevision: request.noPromptRevision,
    concurrencyLimit: request.concurrencyLimit,
    partialImages: request.partialImages,
    requestedJobId: request.requestedJobId,
  };
}

export function toRemoteGenerationPayload(request: GenerationRequest): RemoteGeneratePayload {
  return {
    apiKey: request.apiKey,
    apiProfileId: request.apiProfileId,
    mode: request.mode,
    prompt: request.prompt,
    size: request.size,
    quality: request.quality,
    outputFormat: request.outputFormat,
    imagePaths: [...request.imagePaths],
    imagePath: request.imagePath,
    maskB64: request.maskB64,
    seed: request.seed,
    negativePrompt: request.negativePrompt,
    baseURL: request.baseURL,
    textModelID: request.textModelID,
    imageModelID: request.imageModelID,
    proxyMode: request.proxyMode,
    proxyURL: request.proxyURL,
    apiMode: request.apiMode,
    requestPolicy: request.requestPolicy === "compat" ? "compat" : "openai",
    imagesNewAPICompat: request.imagesNewAPICompat,
    noPromptRevision: request.noPromptRevision,
    concurrencyLimit: request.concurrencyLimit,
    partialImages: request.partialImages,
  };
}
