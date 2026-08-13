import { validateAPIKeyForHeader } from "./apiKey.ts";

export const BULK_API_KEY_MAX_CLIPBOARD_BYTES = 64 * 1024;

const API_KEY_TOKEN_RE = /(^|[^A-Za-z0-9._-])(sk-[A-Za-z0-9._-]{8,})(?=$|[^A-Za-z0-9._-])/g;

export type BulkAPIKeyParseResult = {
  keys: string[];
  validUniqueCount: number;
  invalidLineNumbers: number[];
  emptyLineCount: number;
  duplicateCount: number;
  overflowCount: number;
  inputTooLarge: boolean;
  inputBytes: number;
};

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function tokensFromLine(line: string): string[] {
  const tokens: string[] = [];
  API_KEY_TOKEN_RE.lastIndex = 0;
  while (true) {
    const match = API_KEY_TOKEN_RE.exec(line);
    if (!match) break;
    if (match[2]) tokens.push(match[2]);
  }
  return tokens;
}

export function parseBulkAPIKeyLines(rawText: string, limit = 10): BulkAPIKeyParseResult {
  const raw = String(rawText ?? "");
  const inputBytes = utf8ByteLength(raw);
  const normalizedLimit = Math.max(0, Math.floor(Number.isFinite(limit) ? limit : 10));
  const emptyResult: BulkAPIKeyParseResult = {
    keys: [],
    validUniqueCount: 0,
    invalidLineNumbers: [],
    emptyLineCount: 0,
    duplicateCount: 0,
    overflowCount: 0,
    inputTooLarge: inputBytes > BULK_API_KEY_MAX_CLIPBOARD_BYTES,
    inputBytes,
  };
  if (emptyResult.inputTooLarge) return emptyResult;

  const uniqueKeys: string[] = [];
  const seen = new Set<string>();
  const invalidLineNumbers: number[] = [];
  let emptyLineCount = 0;
  let duplicateCount = 0;
  const lines = raw.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);

  lines.forEach((line, index) => {
    if (!line.trim()) {
      emptyLineCount += 1;
      return;
    }
    const tokens = tokensFromLine(line);
    if (tokens.length !== 1) {
      invalidLineNumbers.push(index + 1);
      return;
    }
    let key = "";
    try {
      key = validateAPIKeyForHeader(tokens[0]);
    } catch {
      invalidLineNumbers.push(index + 1);
      return;
    }
    if (seen.has(key)) {
      duplicateCount += 1;
      return;
    }
    seen.add(key);
    uniqueKeys.push(key);
  });

  return {
    keys: uniqueKeys.slice(0, normalizedLimit),
    validUniqueCount: uniqueKeys.length,
    invalidLineNumbers,
    emptyLineCount,
    duplicateCount,
    overflowCount: Math.max(0, uniqueKeys.length - normalizedLimit),
    inputTooLarge: false,
    inputBytes,
  };
}
