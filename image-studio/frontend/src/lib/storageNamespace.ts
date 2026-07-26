const DEFAULT_STORAGE_NAMESPACE = "default";
export const DESKTOP_STORAGE_NAMESPACE = "fhl-image-studio-desktop";
export const DESKTOP_DEV_STORAGE_NAMESPACE = "fhl-image-studio-desktop-dev";
export const LEGACY_DESKTOP_STORAGE_NAMESPACE = "fhl-image-studio-v2.0.2.1-release";
export const LEGACY_DESKTOP_DEV_STORAGE_NAMESPACE = "fhl-image-studio-v2.0.2-dev-stable-20260608";

export function legacyStorageNamespacesFor(namespace = STORAGE_NAMESPACE): string[] {
  if (namespace === DESKTOP_STORAGE_NAMESPACE) return [LEGACY_DESKTOP_STORAGE_NAMESPACE];
  if (namespace === DESKTOP_DEV_STORAGE_NAMESPACE) return [LEGACY_DESKTOP_DEV_STORAGE_NAMESPACE];
  return [];
}

function readStorageNamespace(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env;
  const raw = typeof env?.IMAGE_STUDIO_STORAGE_NAMESPACE === "string"
    ? env.IMAGE_STUDIO_STORAGE_NAMESPACE.trim()
    : "";
  const safe = raw.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || DEFAULT_STORAGE_NAMESPACE;
}

export const STORAGE_NAMESPACE = readStorageNamespace();

function e2eSessionStorageNamespace(): string {
  if (typeof window === "undefined") return "";
  const status = (window as Window & {
    __IMAGE_STUDIO_E2E_BOOTSTRAP?: {
      e2eOnly?: boolean;
      pid?: number;
      startedAt?: number;
    };
  }).__IMAGE_STUDIO_E2E_BOOTSTRAP;
  if (status?.e2eOnly !== true) return "";
  const pid = Number.isFinite(Number(status.pid)) ? Math.max(0, Math.floor(Number(status.pid))) : 0;
  const startedAt = Number.isFinite(Number(status.startedAt)) ? Math.max(0, Math.floor(Number(status.startedAt))) : 0;
  return `${STORAGE_NAMESPACE}-e2e-${pid}-${startedAt}`;
}

export function effectiveStorageNamespace(): string {
  return e2eSessionStorageNamespace() || STORAGE_NAMESPACE;
}

export function storageKey(key: string): string {
  return `image-studio.${effectiveStorageNamespace()}.${key}`;
}

export function storageDBName(name: string): string {
  return `${name}-${effectiveStorageNamespace()}`;
}

type StorageKeyReader = {
  readonly length: number;
  key: (index: number) => string | null;
};

export function hasMigratableNamespaceState(namespace: string, storage: StorageKeyReader): boolean {
  const sourcePrefix = `image-studio.${namespace}.`;
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(sourcePrefix) && !key.includes(".image-studio.browser-key.")) return true;
  }
  return false;
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
