import { probeCurrentUpstream } from "../platform/runtime/host";
import { ProviderPolicy } from "./providerPolicy.ts";

export async function fetchFHLImageAPIModels(
  apiKey: string,
  options: { proxyMode?: string; proxyURL?: string; signal?: AbortSignal } = {},
): Promise<string[]> {
  const result = await probeCurrentUpstream(
    ProviderPolicy.fhl.baseURL,
    apiKey,
    options.proxyMode || "system",
    options.proxyURL || "",
    "images",
    options.signal,
  );
  return result.models;
}
