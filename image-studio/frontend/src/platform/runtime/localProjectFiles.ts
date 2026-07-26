import type { MaterialOutputSyncItemLike, MaterialOutputSyncResultLike, MediaAssetRefLike } from "./hostTypes";

export type ProjectImageKind = "input" | "output";
type SaveProjectImageOptions = {
  subdir?: string;
  preserveName?: boolean;
  directory?: string;
};

type SavedProjectImage = {
  path: string;
  name: string;
  size: number;
};

type ProjectBatchInputImage = {
  path: string;
  name: string;
  size: number;
  width?: number;
  height?: number;
  previewUrl?: string;
  previewWidth?: number;
  previewHeight?: number;
};

type ProjectBatchInputDirectory = {
  directory: string;
  images: ProjectBatchInputImage[];
};

const PROJECT_FILES_PREFIX = "/__image-studio-files";
let lastProjectImageSaveError = "";

export function takeLastProjectImageSaveError(): string {
  const value = lastProjectImageSaveError;
  lastProjectImageSaveError = "";
  return value;
}

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
  options: SaveProjectImageOptions = {},
): Promise<SavedProjectImage | null> {
  if (!isLocalPreviewHost()) return null;
  lastProjectImageSaveError = "";
  try {
    const response = await fetch(`${PROJECT_FILES_PREFIX}/save-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        imageB64,
        suggestedName,
        mimeType: mimeType ?? "",
        subdir: options.subdir ?? "",
        preserveName: options.preserveName === true,
        directory: options.directory ?? "",
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      lastProjectImageSaveError = body
        ? `本地图片保存接口返回 ${response.status}: ${body.slice(0, 500)}`
        : `本地图片保存接口返回 ${response.status}`;
      if (typeof console !== "undefined") console.warn(lastProjectImageSaveError);
      return null;
    }
    return await response.json() as SavedProjectImage;
  } catch (error) {
    lastProjectImageSaveError = `本地图片保存接口请求失败: ${error instanceof Error ? error.message : String(error)}`;
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

export async function registerProjectMedia(
  savedPath: string,
  thumbPath = "",
): Promise<MediaAssetRefLike | null> {
  if (!isLocalPreviewHost() || !savedPath.trim()) return null;
  try {
    const response = await fetch(`${PROJECT_FILES_PREFIX}/register-media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ savedPath, thumbPath }),
    });
    if (!response.ok) return null;
    return await response.json() as MediaAssetRefLike;
  } catch (error) {
    if (typeof console !== "undefined") console.warn("register project media failed", error);
    return null;
  }
}

export async function readProjectText(path: string): Promise<string | null> {
  if (!isLocalPreviewHost() || !path.trim()) return null;
  try {
    const response = await fetch(`${PROJECT_FILES_PREFIX}/read-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!response.ok) return null;
    const data = await response.json() as { text?: string };
    return data.text ?? null;
  } catch {
    return null;
  }
}

export async function chooseProjectDirectory(title: string): Promise<string | null> {
  if (!isLocalPreviewHost()) return null;
  try {
    const response = await fetch(`${PROJECT_FILES_PREFIX}/choose-directory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) return null;
    const data = await response.json() as { path?: string };
    return typeof data.path === "string" ? data.path : "";
  } catch (error) {
    if (typeof console !== "undefined") console.warn("choose project directory failed", error);
    return null;
  }
}

export async function listProjectBatchInputImages(directory: string): Promise<ProjectBatchInputDirectory | null> {
  if (!isLocalPreviewHost() || !directory.trim()) return null;
  try {
    const response = await fetch(`${PROJECT_FILES_PREFIX}/list-batch-input-images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directory }),
    });
    if (!response.ok) return null;
    return await response.json() as ProjectBatchInputDirectory;
  } catch (error) {
    if (typeof console !== "undefined") console.warn("list project batch input images failed", error);
    return null;
  }
}

export async function buildProjectBatchOutputPath(
  sourcePath: string,
  outputDir: string,
  prefix: string,
): Promise<string | null> {
  if (!isLocalPreviewHost() || !sourcePath.trim()) return null;
  try {
    const response = await fetch(`${PROJECT_FILES_PREFIX}/build-batch-output-path`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourcePath, outputDir, prefix }),
    });
    if (!response.ok) return null;
    const data = await response.json() as { path?: string };
    return data.path ?? null;
  } catch (error) {
    if (typeof console !== "undefined") console.warn("build project batch output path failed", error);
    return null;
  }
}

export async function syncProjectMaterialGroup(
  groupKind: string,
  groupName: string,
  items: MaterialOutputSyncItemLike[],
): Promise<MaterialOutputSyncResultLike | null> {
  if (!isLocalPreviewHost()) return null;
  const response = await fetch(`${PROJECT_FILES_PREFIX}/sync-material-group`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupKind, groupName, items }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(data?.error || "sync material group failed");
  }
  return await response.json() as MaterialOutputSyncResultLike;
}

export async function openProjectMaterialSyncDir(path: string): Promise<boolean> {
  if (!isLocalPreviewHost()) return false;
  const response = await fetch(`${PROJECT_FILES_PREFIX}/open-material-sync-dir`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(data?.error || "open material sync dir failed");
  }
  return true;
}
