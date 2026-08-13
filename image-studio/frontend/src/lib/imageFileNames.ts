import type { OutputFormatValue } from "../types/domain";

const INVALID_FILE_CHARS = /[\\/:*?"<>|\u0000-\u001F]+/g;
const INVALID_FILE_CHAR = /[\\/:*?"<>|\u0000-\u001F]/;
const SEPARATORS = /[\s._-]+/g;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function imageTimestampForFile(date = new Date()): string {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
  ].join("") + "-" + [
    pad2(date.getHours()),
    pad2(date.getMinutes()),
    pad2(date.getSeconds()),
  ].join("");
}

export function imageExtensionForFormat(format?: string | null): string {
  const normalized = String(format || "png").trim().toLowerCase();
  if (normalized === "jpeg") return "jpg";
  if (normalized === "jpg") return "jpg";
  if (normalized === "webp") return "webp";
  return "png";
}

export function promptSnippetForFileName(prompt?: string | null, limit = 10): string {
  const compact = Array.from(String(prompt || "").trim())
    .filter((ch) => !INVALID_FILE_CHAR.test(ch))
    .join("")
    .replace(INVALID_FILE_CHARS, "")
    .replace(/[，,。.!！?？；;：:'"“”‘’`~()[\]{}]+/g, "")
    .replace(SEPARATORS, "-")
    .replace(/^-+|-+$/g, "");
  return Array.from(compact).slice(0, limit).join("") || "未命名";
}

export function suggestImageFileName(input: {
  prompt?: string | null;
  createdAt?: number | Date | null;
  outputFormat?: OutputFormatValue | string | null;
} = {}): string {
  const date = input.createdAt instanceof Date
    ? input.createdAt
    : typeof input.createdAt === "number"
      ? new Date(input.createdAt)
      : new Date();
  return `${imageTimestampForFile(date)}-${promptSnippetForFileName(input.prompt)}.${imageExtensionForFormat(input.outputFormat)}`;
}

export function suggestManualSaveImageFileName(input: {
  prompt?: string | null;
  outputFormat?: OutputFormatValue | string | null;
} = {}): string {
  const now = new Date();
  const millis = String(now.getMilliseconds()).padStart(3, "0");
  const nonce = Math.random().toString(36).slice(2, 6);
  return `${imageTimestampForFile(now)}-${millis}-${nonce}-${promptSnippetForFileName(input.prompt)}.${imageExtensionForFormat(input.outputFormat)}`;
}
