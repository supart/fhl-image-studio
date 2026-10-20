import type {
  MaterialOutputSyncItemLike,
  MaterialOutputSyncResultLike,
  MediaAssetRefLike,
  PlanarPastebackOptionsLike,
} from "./hostTypes";

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

/**
 * Copy an already managed image into the preview Output/images directory.
 * This keeps large composites on disk instead of re-encoding them as JSON
 * base64 in the browser request body.
 */
export async function copyProjectImageToOutput(
  sourcePath: string,
  suggestedName: string,
): Promise<SavedProjectImage | null> {
  if (!isLocalPreviewHost() || !sourcePath.trim()) return null;
  lastProjectImageSaveError = "";
  try {
    const response = await fetch(`${PROJECT_FILES_PREFIX}/copy-image-to-output`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: sourcePath, suggestedName }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      lastProjectImageSaveError = body
        ? `本地 Output 复制接口返回 ${response.status}: ${body.slice(0, 500)}`
        : `本地 Output 复制接口返回 ${response.status}`;
      if (typeof console !== "undefined") console.warn(lastProjectImageSaveError);
      return null;
    }
    return await response.json() as SavedProjectImage;
  } catch (error) {
    lastProjectImageSaveError = `本地 Output 复制接口请求失败: ${error instanceof Error ? error.message : String(error)}`;
    if (typeof console !== "undefined") console.warn("copy project image to output failed", error);
    return null;
  }
}

export async function saveProjectImageBlob(
  kind: ProjectImageKind,
  blob: Blob,
  suggestedName: string,
  options: SaveProjectImageOptions = {},
): Promise<SavedProjectImage | null> {
  if (!isLocalPreviewHost() || !blob || blob.size <= 0) return null;
  lastProjectImageSaveError = "";
  try {
    const params = new URLSearchParams({
      kind,
      suggestedName,
      subdir: options.subdir ?? "",
      preserveName: options.preserveName === true ? "1" : "0",
    });
    const response = await fetch(`${PROJECT_FILES_PREFIX}/save-image-binary?${params.toString()}`, {
      method: "POST",
      headers: { "Content-Type": blob.type || "application/octet-stream" },
      body: blob,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      lastProjectImageSaveError = body
        ? `本地二进制图片保存接口返回 ${response.status}: ${body.slice(0, 500)}`
        : `本地二进制图片保存接口返回 ${response.status}`;
      if (typeof console !== "undefined") console.warn(lastProjectImageSaveError);
      return null;
    }
    return await response.json() as SavedProjectImage;
  } catch (error) {
    lastProjectImageSaveError = `本地二进制图片保存请求失败: ${error instanceof Error ? error.message : String(error)}`;
    if (typeof console !== "undefined") console.warn("save project image blob failed", error);
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

export async function cropProjectImage(
  sourcePath: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<{ path: string; acceleration?: string; width?: number; height?: number }> {
  if (!isLocalPreviewHost()) throw new Error("当前浏览器预览环境未启动本地裁切服务");
  const response = await fetch(`${PROJECT_FILES_PREFIX}/crop-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: sourcePath, x, y, width, height }),
  });
  const data = await response.json().catch(() => ({})) as {
    path?: string;
    acceleration?: string;
    width?: number;
    height?: number;
    error?: string;
  };
  if (!response.ok) throw new Error(data.error || `本地裁切接口返回 ${response.status}`);
  if (!data.path) throw new Error("本地裁切接口未返回输出路径");
  return { ...data, path: data.path };
}

export async function pasteProjectLocalEdit(
  sourcePath: string,
  editedPath: string,
  options: PlanarPastebackOptionsLike,
): Promise<{ path: string; acceleration?: string }> {
  if (!isLocalPreviewHost()) throw new Error("当前浏览器预览环境未启动本地贴回服务");
  const response = await fetch(`${PROJECT_FILES_PREFIX}/paste-local-edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourcePath, editedPath, options }),
  });
  const data = await response.json().catch(() => ({})) as { path?: string; acceleration?: string; error?: string };
  if (!response.ok) {
    throw new Error(data.error || `本地贴回接口返回 ${response.status}`);
  }
  if (!data.path) throw new Error("本地贴回接口未返回输出路径");
  return { path: data.path, acceleration: data.acceleration };
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

export async function removeProjectImage(filePath: string): Promise<void> {
  if (!isLocalPreviewHost() || !filePath.trim()) return;
  const response = await fetch(`${PROJECT_FILES_PREFIX}/remove-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: filePath }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error || `本地临时图片清理接口返回 ${response.status}`);
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
