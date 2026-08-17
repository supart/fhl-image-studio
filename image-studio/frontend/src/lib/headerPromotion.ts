export const HEADER_PROMOTION_ENDPOINT = "/__image-studio-files/header-promotion";
export const HEADER_PROMOTION_MAX_BYTES = 16 * 1024;

export const HEADER_PROMOTION_FIELD_LIMITS = {
  announcement: 240,
  groupNumber: 64,
  registrationText: 160,
  registrationURL: 2048,
} as const;

export type HeaderPromotionConfig = {
  announcement: string;
  groupNumber: string;
  registrationText: string;
  registrationURL: string;
};

export const EMPTY_HEADER_PROMOTION_CONFIG: HeaderPromotionConfig = Object.freeze({
  announcement: "",
  groupNumber: "",
  registrationText: "",
  registrationURL: "",
});

const FIELD_BY_KEY = {
  "群公告": "announcement",
  "群号": "groupNumber",
  "注册文案": "registrationText",
  "注册链接": "registrationURL",
} as const;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function withinCharacterLimit(value: string, limit: number): string {
  return Array.from(value).length <= limit ? value : "";
}

function validHTTPURL(value: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseHeaderPromotionConfig(source: string): HeaderPromotionConfig {
  if (utf8ByteLength(source) > HEADER_PROMOTION_MAX_BYTES) {
    return { ...EMPTY_HEADER_PROMOTION_CONFIG };
  }

  const values: HeaderPromotionConfig = { ...EMPTY_HEADER_PROMOTION_CONFIG };
  const normalized = source.startsWith("\uFEFF") ? source.slice(1) : source;

  for (const rawLine of normalized.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim() as keyof typeof FIELD_BY_KEY;
    const field = FIELD_BY_KEY[key];
    if (!field) continue;
    values[field] = line.slice(separator + 1).trim();
  }

  values.announcement = withinCharacterLimit(
    values.announcement,
    HEADER_PROMOTION_FIELD_LIMITS.announcement,
  );
  values.groupNumber = withinCharacterLimit(
    values.groupNumber,
    HEADER_PROMOTION_FIELD_LIMITS.groupNumber,
  );
  values.registrationText = withinCharacterLimit(
    values.registrationText,
    HEADER_PROMOTION_FIELD_LIMITS.registrationText,
  );
  values.registrationURL = withinCharacterLimit(
    values.registrationURL,
    HEADER_PROMOTION_FIELD_LIMITS.registrationURL,
  );
  if (!validHTTPURL(values.registrationURL)) values.registrationURL = "";
  return values;
}

type HeaderPromotionFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "text">>;

export async function loadHeaderPromotionConfig(
  fetcher: HeaderPromotionFetch = fetch,
): Promise<HeaderPromotionConfig> {
  try {
    const response = await fetcher(HEADER_PROMOTION_ENDPOINT, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "text/plain" },
    });
    if (!response.ok) return { ...EMPTY_HEADER_PROMOTION_CONFIG };
    return parseHeaderPromotionConfig(await response.text());
  } catch {
    return { ...EMPTY_HEADER_PROMOTION_CONFIG };
  }
}
