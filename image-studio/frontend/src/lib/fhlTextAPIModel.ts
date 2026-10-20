import { storageKey } from "./storageNamespace.ts";

export const FHL_TEXT_API_DEFAULT_MODEL_ID = "gpt-5.6-sol";
export const FHL_TEXT_API_LEGACY_MODEL_ID = "gpt-5.5";
export const FHL_TEXT_API_MODEL_STORAGE_KEY = storageKey("gptcodex.fhlTextAPI.modelID.v1");

export type FHLTextAPIModelValidation = {
  value: string;
  valid: boolean;
  message: string;
};

export function validateFHLTextAPIModelID(value: string): string {
  const modelID = String(value ?? "").trim();
  if (!modelID) throw new Error("文本模型 ID 不能为空。");
  if (modelID.length > 128) throw new Error("文本模型 ID 不能超过 128 个字符。");
  if (/\p{Cc}/u.test(modelID)) throw new Error("文本模型 ID 不能包含控制字符。");
  return modelID;
}

export function normalizeFHLTextAPIModelID(value: unknown, fallback = FHL_TEXT_API_DEFAULT_MODEL_ID): string {
  try {
    return validateFHLTextAPIModelID(String(value ?? ""));
  } catch {
    return fallback;
  }
}

export function validateFHLTextAPIModelInput(value: string): FHLTextAPIModelValidation {
  const trimmed = String(value ?? "").trim();
  try {
    return { value: validateFHLTextAPIModelID(trimmed), valid: true, message: "" };
  } catch (error: any) {
    return {
      value: trimmed,
      valid: false,
      message: error?.message ?? "文本模型 ID 无效。",
    };
  }
}

type ModelStorageLike = Pick<Storage, "getItem" | "setItem">;

function modelStorage(storage?: ModelStorageLike): ModelStorageLike | null {
  if (storage) return storage;
  return typeof localStorage === "undefined" ? null : localStorage;
}

export function loadStoredFHLTextAPIModelID(storage?: ModelStorageLike): string | null {
  const target = modelStorage(storage);
  if (!target) return null;
  try {
    const raw = target.getItem(FHL_TEXT_API_MODEL_STORAGE_KEY);
    if (raw === null) return null;
    return validateFHLTextAPIModelID(raw);
  } catch {
    return null;
  }
}

export function persistFHLTextAPIModelID(modelID: string, storage?: ModelStorageLike): string {
  const normalized = validateFHLTextAPIModelID(modelID);
  const target = modelStorage(storage);
  try { target?.setItem(FHL_TEXT_API_MODEL_STORAGE_KEY, normalized); } catch {}
  return normalized;
}

export function loadFHLTextAPIModelID(_hasExistingKey: boolean, storage?: ModelStorageLike): string {
  const stored = loadStoredFHLTextAPIModelID(storage);
  if (stored) return stored;
  return persistFHLTextAPIModelID(FHL_TEXT_API_DEFAULT_MODEL_ID, storage);
}

export function resetFHLTextAPIModelID(storage?: ModelStorageLike): string {
  return persistFHLTextAPIModelID(FHL_TEXT_API_DEFAULT_MODEL_ID, storage);
}
