import {
  detectImageMimeTypeFromBase64,
  imageExtensionForMimeType,
} from "../../../lib/images.ts";
import {
  buildResponsesPayload as buildSharedResponsesPayload,
  normalizePartialImages,
  repairSizeForOpenAI,
  shouldSendExtendedImageParameters,
  shouldUseImagesNewAPICompat,
  supportsImagesResponseFormat,
} from "../../../../../../shared/kernel/requestModel.js";
import { normalizeBaseURL, normalizeImageModel } from "./common.ts";
import { RemoteKernelError, type RemoteGeneratePayload, type RemoteJobRequest } from "./types.ts";

export function buildResponsesPayload(
  payload: RemoteGeneratePayload,
  sourceDataURLs: string[],
): Record<string, unknown> {
  const maskMimeType = payload.maskB64
    ? (detectImageMimeTypeFromBase64(payload.maskB64) || "image/png")
    : "image/png";
  return buildSharedResponsesPayload(payload, sourceDataURLs, { maskMimeType });
}

export function buildImagesGenerationPayload(
  payload: RemoteGeneratePayload,
): Record<string, unknown> {
  const imageModel = normalizeImageModel(payload.imageModelID);
  const rawSize = payload.size || "1024x1024";
  const repairedPayload = repairSizeForOpenAI({ size: rawSize });
  const body: Record<string, unknown> = {
    model: imageModel,
    prompt: payload.prompt,
    n: 1,
    size: repairedPayload?.size || rawSize,
    quality: payload.quality || "auto",
    output_format: payload.outputFormat || "png",
  };
  const useNewAPICompat = shouldUseImagesNewAPICompat(payload);
  if (useNewAPICompat || supportsImagesResponseFormat(imageModel, "generate")) {
    body.response_format = "b64_json";
  }
  if (!useNewAPICompat) {
    body.stream = true;
    body.partial_images = normalizePartialImages(payload.partialImages);
  }
  if (shouldSendExtendedImageParameters(payload.requestPolicy) && payload.seed) body.seed = payload.seed;
  if (shouldSendExtendedImageParameters(payload.requestPolicy) && payload.negativePrompt.trim()) {
    body.negative_prompt = payload.negativePrompt.trim();
  }
  return body;
}

export async function buildImagesRequestBody(
  request: RemoteJobRequest,
  sourceDataURLs: string[],
): Promise<{ url: string; headers?: Record<string, string>; body: BodyInit }> {
  const baseURL = normalizeBaseURL(request.payload.baseURL);
  const mode = request.payload.mode === "edit" ? "edit" : "generate";
  const imageModel = normalizeImageModel(request.payload.imageModelID);
  const rawSize = request.payload.size || "1024x1024";
  const repairedPayload = repairSizeForOpenAI({ size: rawSize });
  const size = repairedPayload?.size || rawSize;
  const quality = request.payload.quality || "auto";
  const outputFormat = request.payload.outputFormat || "png";
  const includeExtended = shouldSendExtendedImageParameters(request.payload.requestPolicy);
  const useNewAPICompat = shouldUseImagesNewAPICompat(request.payload);
  const partialImages = normalizePartialImages(request.payload.partialImages);

  if (mode === "edit") {
    if (sourceDataURLs.length === 0) {
      throw new RemoteKernelError("图生图模式需要至少一张源图，请先添加参考图");
    }
    const form = new FormData();
    for (let i = 0; i < sourceDataURLs.length; i++) {
      const dataURL = sourceDataURLs[i];
      const payload = dataURL.slice(dataURL.indexOf(",") + 1);
      const mimeType = dataURL.slice(5, dataURL.indexOf(";")) || "image/png";
      const ext = imageExtensionForMimeType(mimeType);
      form.append("image", new Blob([Uint8Array.from(atob(payload), (ch) => ch.charCodeAt(0))], { type: mimeType }), `source-${i + 1}.${ext}`);
    }
    if (request.payload.maskB64) {
      const maskMime = detectImageMimeTypeFromBase64(request.payload.maskB64) || "image/png";
      const ext = imageExtensionForMimeType(maskMime);
      form.append("mask", new Blob([Uint8Array.from(atob(request.payload.maskB64), (ch) => ch.charCodeAt(0))], { type: maskMime }), `mask.${ext}`);
    }
    form.append("prompt", request.payload.prompt);
    form.append("model", imageModel);
    form.append("n", "1");
    form.append("size", size);
    form.append("quality", quality);
    form.append("output_format", outputFormat);
    if (useNewAPICompat || supportsImagesResponseFormat(imageModel, mode)) {
      form.append("response_format", "b64_json");
    }
    if (!useNewAPICompat) {
      form.append("stream", "true");
      form.append("partial_images", String(partialImages));
    }
    if (includeExtended && request.payload.seed) form.append("seed", String(request.payload.seed));
    if (includeExtended && request.payload.negativePrompt.trim()) form.append("negative_prompt", request.payload.negativePrompt.trim());
    return { url: `${baseURL}/v1/images/edits`, body: form };
  }

  const payload = buildImagesGenerationPayload(request.payload);
  return {
    url: `${baseURL}/v1/images/generations`,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}
