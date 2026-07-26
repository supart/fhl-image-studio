import { validateAPIKeyForHeader } from "./apiKey";
import {
  DeleteStoredAPIKey,
  GetStoredAPIKey,
  OptimizePrompt,
  SetStoredAPIKey,
} from "../platform/runtime/host";
import { FHL_BASE_URL, FHL_TEXT_MODEL_ID, keyringUserFor } from "./profiles";

export const FHL_TEXT_API_CREDENTIAL_ID = "fhl-text-assistant";
export const FHL_TEXT_API_KEYRING_USER = keyringUserFor(FHL_TEXT_API_CREDENTIAL_ID);
export const FHL_TEXT_API_BASE_URL = FHL_BASE_URL;
export const FHL_TEXT_API_MODEL_ID = FHL_TEXT_MODEL_ID;

const FHL_TEXT_API_KEY_RE = /^(?:sk|msk)-[A-Za-z0-9._-]{8,}$/i;
const FHL_TEXT_API_TEST_PROMPT = "A white ceramic cup on a plain background";

export function validateFHLTextAPIKey(value: string): string {
  const apiKey = validateAPIKeyForHeader(value);
  if (!FHL_TEXT_API_KEY_RE.test(apiKey)) {
    throw new Error("API Key 格式不正确，请粘贴 sk-... 或 msk-... 密钥本身。");
  }
  return apiKey;
}

export function fhlTextAPIKeyHint(value: string): string {
  const apiKey = value.trim();
  if (!apiKey) return "";
  const prefix = apiKey.toLowerCase().startsWith("msk-") ? "msk-" : "sk-";
  return `${prefix}...${apiKey.slice(-4)}`;
}

export async function loadFHLTextAPIKey(): Promise<string> {
  const apiKey = await GetStoredAPIKey(FHL_TEXT_API_KEYRING_USER);
  return apiKey.trim();
}

export async function saveFHLTextAPIKey(apiKey: string): Promise<void> {
  await SetStoredAPIKey(FHL_TEXT_API_KEYRING_USER, apiKey);
}

export async function deleteFHLTextAPIKey(): Promise<void> {
  await DeleteStoredAPIKey(FHL_TEXT_API_KEYRING_USER);
}

export async function testFHLTextAPIKey(
  apiKey: string,
  options: { proxyMode?: string; proxyURL?: string } = {},
): Promise<string> {
  const response = await OptimizePrompt({
    apiKey,
    prompt: FHL_TEXT_API_TEST_PROMPT,
    optimizationGuidance: "",
    mode: "generate",
    baseURL: FHL_TEXT_API_BASE_URL,
    textModelID: FHL_TEXT_API_MODEL_ID,
    proxyMode: options.proxyMode,
    proxyURL: options.proxyURL,
    imagePaths: [],
    imagePath: "",
  });
  const text = response.trim();
  if (!text) throw new Error("FHL 文本 API 未返回可用文本。");
  return text;
}

export function formatFHLTextAPIError(error: unknown): string {
  const detail = String((error as { message?: unknown } | null)?.message ?? error ?? "").trim();
  if (/\u65e0\u53ef\u7528\u6e20\u9053/u.test(detail) || /\bdistributor\b/i.test(detail)) {
    return `请求已到达 FHL，但当前文本 API Key 所属分组不支持文本模型 ${FHL_TEXT_API_MODEL_ID}。请在 FHL 后台为该 Key 选择文本模型分组。`;
  }
  return detail || "FHL 文本响应测试失败。";
}
