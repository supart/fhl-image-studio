export type ProjectImageKind = "input" | "output";

type SavedProjectImage = {
  path: string;
  name: string;
  size: number;
};

const PROJECT_FILES_PREFIX = "/__image-studio-files";

function isLocalPreviewHost(): boolean {
  if (typeof window === "undefined" || typeof window.location === "undefined") return false;
  if (typeof fetch !== "function") return false;
  const hostname = String(window.location.hostname || "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export async function saveProjectImage(
  kind: ProjectImageKind,
  imageB64: string,
  suggestedName: string,
  mimeType?: string | null,
): Promise<SavedProjectImage | null> {
  if (!isLocalPreviewHost()) return null;
  try {
    const response = await fetch(`${PROJECT_FILES_PREFIX}/save-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, imageB64, suggestedName, mimeType: mimeType ?? "" }),
    });
    if (!response.ok) return null;
    return await response.json() as SavedProjectImage;
  } catch (error) {
    if (typeof console !== "undefined") console.warn("save project image failed", error);
    return null;
  }
}

export async function readProjectImage(path: string): Promise<string | null> {
  if (!isLocalPreviewHost() || !path.trim()) return null;
  try {
    const response = await fetch(`${PROJECT_FILES_PREFIX}/read-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!response.ok) return null;
    const data = await response.json() as { imageB64?: string };
    return data.imageB64 ?? null;
  } catch {
    return null;
  }
}
