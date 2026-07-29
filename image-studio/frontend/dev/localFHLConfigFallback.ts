export type LocalFHLConfigFallback = {
  apiKey: string;
  baseURL: string;
  apiMode: "images" | "responses";
  requestPolicy: "openai" | "compat";
  textModelID: string;
  imageModelID: string;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function localFHLConfigFromCLIEnv(
  env: Record<string, string>,
): LocalFHLConfigFallback | null {
  const apiKey = clean(env.IMAGE_STUDIO_API_KEY);
  const apiMode = clean(env.IMAGE_STUDIO_API_MODE).toLowerCase();
  if (!apiKey || (apiMode !== "images" && apiMode !== "responses")) return null;

  return {
    apiKey,
    baseURL: clean(env.IMAGE_STUDIO_UPSTREAM_BASE_URL) || "https://www.fhl.mom",
    apiMode,
    requestPolicy: clean(env.IMAGE_STUDIO_REQUEST_POLICY).toLowerCase() === "compat" ? "compat" : "openai",
    textModelID: clean(env.IMAGE_STUDIO_TEXT_MODEL) || "gpt-5.5",
    imageModelID: clean(env.IMAGE_STUDIO_IMAGE_MODEL) || "gpt-image-2",
  };
}
