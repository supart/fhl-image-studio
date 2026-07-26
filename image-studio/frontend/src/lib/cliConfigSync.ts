import type { APIMode, OutputFormatValue, QualityValue, RequestPolicy, SizeValue } from "../types/domain";
import {
  FHL_BASE_URL,
  FHL_IMAGE_MODEL_ID,
  FHL_TEXT_MODEL_ID,
} from "./profiles.ts";
import { ProviderPolicy } from "./providerPolicy.ts";
import { STORAGE_NAMESPACE } from "./storageNamespace.ts";
import { hasServiceMethod, invokeService } from "../platform/runtime/hostBindings.ts";

const CLI_CONFIG_ENDPOINT = "/__image-studio-local-config/cli-env";
const RUNNINGHUB_DEFAULT_BASE_URL = ProviderPolicy.runningHub.baseURL;

export type CLIConfigSyncInput = {
  apiKey?: string;
  clearAPIKey?: boolean;
  baseURL?: string;
  apiMode?: APIMode;
  requestPolicy?: RequestPolicy;
  imagesNewAPICompat?: boolean;
  textModelID?: string;
  imageModelID?: string;
  outputFormat?: OutputFormatValue;
  quality?: QualityValue | string;
  size?: SizeValue | string;
  partialImages?: number;
};

function isLocalPreviewHost(): boolean {
  if (typeof window === "undefined" || typeof window.location === "undefined") return false;
  const hostname = String(window.location.hostname || "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export async function syncCLIConfig(input: CLIConfigSyncInput = {}): Promise<boolean> {
  const apiMode = input.apiMode || "images";
  const payload = {
    storageNamespace: STORAGE_NAMESPACE,
    apiKey: apiMode === "runninghub" ? "" : input.apiKey,
    clearAPIKey: input.clearAPIKey === true,
    baseURL: input.baseURL || (apiMode === "runninghub" ? RUNNINGHUB_DEFAULT_BASE_URL : FHL_BASE_URL),
    apiMode,
    requestPolicy: input.requestPolicy || "openai",
    imagesNewAPICompat: apiMode === "images" && input.imagesNewAPICompat !== false,
    textModelID: input.textModelID || FHL_TEXT_MODEL_ID,
    imageModelID: input.imageModelID || FHL_IMAGE_MODEL_ID,
    outputFormat: input.outputFormat || "png",
    quality: input.quality || "medium",
    size: input.size || "1024x1024",
    partialImages: input.partialImages ?? 1,
  };
  if (hasServiceMethod("SyncCLIConfig")) {
    await invokeService(
      (method) => `宿主未暴露 ${method} 能力`,
      "SyncCLIConfig",
      payload,
    );
    return true;
  }
  if (!isLocalPreviewHost() || typeof fetch === "undefined") return false;
  const response = await fetch(CLI_CONFIG_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return response.ok;
}

export function syncCLIConfigQuietly(input: CLIConfigSyncInput = {}) {
  void syncCLIConfig(input).catch(() => undefined);
}


