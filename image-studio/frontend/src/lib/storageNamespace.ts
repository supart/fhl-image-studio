const DEFAULT_STORAGE_NAMESPACE = "default";

function readStorageNamespace(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env;
  const raw = typeof env?.IMAGE_STUDIO_STORAGE_NAMESPACE === "string"
    ? env.IMAGE_STUDIO_STORAGE_NAMESPACE.trim()
    : "";
  const safe = raw.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || DEFAULT_STORAGE_NAMESPACE;
}

export const STORAGE_NAMESPACE = readStorageNamespace();

export function storageKey(key: string): string {
  return `image-studio.${STORAGE_NAMESPACE}.${key}`;
}

export function storageDBName(name: string): string {
  return `${name}-${STORAGE_NAMESPACE}`;
}

export function purgeForeignAPIKeyStorageKeys(): void {
  if (typeof localStorage === "undefined") return;
  const currentBrowserKeyPrefix = storageKey("image-studio.browser-key.");
  const legacyAPIKeys = new Set([
    "gptcodex.apiKey",
    "gptcodex.responses.apiKey",
    "gptcodex.images.apiKey",
  ]);

  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key) keys.push(key);
    }
    for (const key of keys) {
      const isBrowserKey = key.includes(".image-studio.browser-key.") || key.startsWith("image-studio.browser-key.");
      const isForeignBrowserKey = isBrowserKey && !key.startsWith(currentBrowserKeyPrefix);
      const isLegacyAPIKey = legacyAPIKeys.has(key) || /\.gptcodex\.(responses\.|images\.)?apiKey$/.test(key);
      if (isForeignBrowserKey || isLegacyAPIKey) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Best-effort cleanup only.
  }
}
