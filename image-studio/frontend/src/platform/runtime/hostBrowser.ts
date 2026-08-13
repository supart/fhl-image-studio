import { STORAGE_NAMESPACE, storageKey } from "../../lib/storageNamespace.ts";
import { runtimeSetTimeout } from "../../lib/runtimeCompat.ts";

const browserKeyPrefix = storageKey("image-studio.browser-key.");
const currentProfileUserPrefix = `profile:${STORAGE_NAMESPACE}:`;

function canUseBrowserKeyUser(user: string): boolean {
  if (user === "responses" || user === "images") return false;
  if (user.startsWith("profile:")) return user.startsWith(currentProfileUserPrefix);
  return true;
}

export function saveByDownload(blob: Blob, suggestedName: string): string {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = suggestedName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  runtimeSetTimeout(() => URL.revokeObjectURL(url), 15_000);
  return suggestedName;
}

export function browserStoredAPIKey(user: string): string {
  if (!canUseBrowserKeyUser(user)) return "";
  try {
    return localStorage.getItem(browserKeyPrefix + user) ?? "";
  } catch {
    return "";
  }
}

export function setBrowserStoredAPIKey(user: string, value: string) {
  if (!canUseBrowserKeyUser(user)) return;
  try {
    if (value.trim()) localStorage.setItem(browserKeyPrefix + user, value.trim());
    else localStorage.removeItem(browserKeyPrefix + user);
  } catch {
    // ignore
  }
}

export function fileNameFromPath(path: string | undefined): string {
  if (!path) return "image.png";
  return path.split(/[\\/]/).pop() || "image.png";
}
