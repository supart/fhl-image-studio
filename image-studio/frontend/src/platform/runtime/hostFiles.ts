import { targetPlatform } from "../index.ts";
import {
  isVirtualPath,
  openImageDialogFallback,
  openVirtualPath,
  readVirtualText,
  registerVirtualImage,
  registerVirtualText,
} from "../../lib/virtualHostStore.ts";
import { fileNameFromPath, saveByDownload } from "./hostBrowser.ts";
import {
  buildProjectBatchOutputPath,
  chooseProjectDirectory,
  listProjectBatchInputImages,
  openProjectMaterialSyncDir,
  readProjectText,
  takeLastProjectImageSaveError,
} from "./localProjectFiles.ts";
import {
  canInvokeAndroidMethod,
  hasServiceMethod,
  invokeAndroid,
  invokeService,
} from "./hostBindings.ts";
import {
  isLocalPreviewHost,
  shouldAvoidVolatileBrowserImages,
  shouldFallbackFromEmptyNativeDialog,
  unsupportedMessage,
} from "./hostContext.ts";
import { GetOutputDir } from "./hostCredentials.ts";
import { persistBrowserImageToLocalInput } from "./hostMedia.ts";
import type {
  BatchInputDirectoryLike,
  BatchInputImageLike,
  SelectFileResponseLike,
  SelectFilesResponseLike,
} from "./hostTypes.ts";

async function persistBrowserSelectedImage(res: SelectFileResponseLike): Promise<SelectFileResponseLike> {
  const selectedPath = String(res?.path || "").trim();
  const imageB64 = String(res?.imageB64 || "").trim();
  if (!selectedPath || !imageB64 || !isLocalPreviewHost() || !isVirtualPath(selectedPath)) return res;
  const imported = await persistBrowserImageToLocalInput(imageB64, fileNameFromPath(selectedPath));
  if (!imported?.path) return res;
  return {
    ...res,
    path: imported.path,
    width: imported.width ?? res.width,
    height: imported.height ?? res.height,
    previewUrl: imported.previewUrl || res.previewUrl,
    previewWidth: imported.previewWidth ?? res.previewWidth,
    previewHeight: imported.previewHeight ?? res.previewHeight,
  };
}

type BrowserDirectoryInput = HTMLInputElement & {
  webkitdirectory?: boolean;
  directory?: boolean;
};

type BrowserBatchDirectoryPick = {
  label: string;
  files: File[];
};

function batchInputMimeMatch(file: File): boolean {
  return /^image\/(png|jpe?g|webp)$/i.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
}

function safeBatchFolderSegment(value: string): string {
  return String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*]+/g, "-")
    .split("")
    .map((character) => character.charCodeAt(0) <= 0x1f ? "-" : character)
    .join("")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "batch";
}

function directoryFromFilePath(filePath: string): string {
  const normalized = String(filePath || "").trim();
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return index >= 0 ? normalized.slice(0, index) : "";
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error(`failed to read ${file.name}`));
    reader.onload = () => {
      const raw = String(reader.result || "");
      const comma = raw.indexOf(",");
      resolve((comma >= 0 ? raw.slice(comma + 1) : raw).trim());
    };
    reader.readAsDataURL(file);
  });
}

function readBrowserImageDimensions(file: File): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve) => {
    try {
      const objectURL = URL.createObjectURL(file);
      const img = new Image();
      const cleanup = () => URL.revokeObjectURL(objectURL);
      img.onload = () => {
        resolve({
          width: img.naturalWidth || img.width || undefined,
          height: img.naturalHeight || img.height || undefined,
        });
        cleanup();
      };
      img.onerror = () => {
        resolve({});
        cleanup();
      };
      img.src = objectURL;
    } catch {
      resolve({});
    }
  });
}

async function persistBrowserBatchFiles(
  files: File[],
  subdir: string,
): Promise<BatchInputImageLike[]> {
  const savedFiles: BatchInputImageLike[] = [];
  const failedFiles: string[] = [];
  for (const file of files) {
    if (!batchInputMimeMatch(file)) continue;
    try {
      const imageB64 = await readFileAsBase64(file);
      const imported = await persistBrowserImageToLocalInput(imageB64, file.name, file.type || null, {
        subdir,
        preserveName: true,
      });
      const fallbackVirtual = () => registerVirtualImage({
        imageB64,
        suggestedName: file.name,
        mimeType: file.type || null,
      });
      const localFile = imported?.path
        ? {
          path: imported.path,
          name: imported.name || file.name,
          size: file.size,
          width: imported.width,
          height: imported.height,
          previewUrl: imported.previewUrl,
          previewWidth: imported.previewWidth,
          previewHeight: imported.previewHeight,
        }
        : shouldAvoidVolatileBrowserImages()
          ? null
          : {
            ...fallbackVirtual(),
            size: file.size,
          };
      if (!localFile?.path) {
        throw new Error(takeLastProjectImageSaveError() || "unable to persist local input image");
      }
      const dims = await readBrowserImageDimensions(file);
      savedFiles.push({
        path: localFile.path,
        name: file.name,
        size: file.size,
        width: localFile.width ?? dims.width,
        height: localFile.height ?? dims.height,
        previewUrl: localFile.previewUrl,
        previewWidth: localFile.previewWidth,
        previewHeight: localFile.previewHeight,
      });
    } catch (error: any) {
      failedFiles.push(`${file.name}: ${error?.message ?? error}`);
      if (typeof console !== "undefined") console.warn("batch input image skipped", file.name, error);
    }
  }
  if (savedFiles.length === 0 && failedFiles.length > 0) {
    throw new Error(`无法写入本地输入图片: ${failedFiles.slice(0, 3).join("; ")}`);
  }
  return savedFiles;
}

async function chooseBrowserFiles(options: {
  multiple?: boolean;
  directory?: boolean;
} = {}): Promise<File[]> {
  if (typeof document === "undefined") return [];
  return new Promise((resolve, reject) => {
    const input = document.createElement("input") as BrowserDirectoryInput;
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    input.multiple = options.multiple !== false;
    if (options.directory) {
      input.setAttribute("webkitdirectory", "");
      input.setAttribute("directory", "");
      input.webkitdirectory = true;
      input.directory = true;
    }
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    const cleanup = () => input.remove();
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      cleanup();
      resolve(files);
    }, { once: true });
    input.addEventListener("error", () => {
      cleanup();
      reject(new Error("failed to open file picker"));
    }, { once: true });
    input.click();
  });
}

async function openImagesDialogFallback(): Promise<SelectFilesResponseLike> {
  const files = await chooseBrowserFiles({ multiple: true });
  if (files.length === 0) return { files: [] };
  const subdir = `batch-inputs/manual-${Date.now().toString(36)}`;
  return { files: await persistBrowserBatchFiles(files, subdir) };
}

async function chooseBrowserBatchDirectoryFiles(): Promise<BrowserBatchDirectoryPick> {
  const showDirectoryPicker = typeof window !== "undefined"
    ? (window as typeof window & { showDirectoryPicker?: () => Promise<{ name?: string; values?: () => AsyncIterable<any> }> }).showDirectoryPicker
    : undefined;
  if (typeof showDirectoryPicker === "function") {
    try {
      const handle = await showDirectoryPicker();
      const files: File[] = [];
      if (handle?.values) {
        for await (const entry of handle.values()) {
          if (!entry || entry.kind !== "file" || typeof entry.getFile !== "function") continue;
          const file = await entry.getFile();
          if (file) files.push(file);
        }
      }
      return {
        label: String(handle?.name || "").trim(),
        files,
      };
    } catch (error: any) {
      if (String(error?.name || "") === "AbortError") {
        return { label: "", files: [] };
      }
      throw error;
    }
  }

  // Embedded preview browsers can crash on `webkitdirectory`; use multi-select there.
  return {
    label: "",
    files: await chooseBrowserFiles({ multiple: true }),
  };
}

async function chooseBatchInputDirFallback(): Promise<BatchInputDirectoryLike> {
  const picked = await chooseBrowserBatchDirectoryFiles();
  if (picked.files.length === 0) return { directory: "", images: [] };
  const typedFiles = picked.files.filter((file) => batchInputMimeMatch(file));
  if (typedFiles.length === 0) return { directory: "", images: [] };
  const relativePaths = typedFiles.map((file) => String((file as any).webkitRelativePath || file.name));
  const rootName = picked.label || relativePaths[0]?.split(/[\\/]/).filter(Boolean)[0] || "batch-input";
  const topLevelFiles = typedFiles.filter((file) => {
    const rel = String((file as any).webkitRelativePath || file.name);
    const segments = rel.split(/[\\/]/).filter(Boolean);
    return segments.length <= 2;
  });
  const selectedFiles = topLevelFiles.length > 0 ? topLevelFiles : typedFiles;
  const subdir = `batch-inputs/${safeBatchFolderSegment(rootName)}-${Date.now().toString(36)}`;
  const savedFiles = await persistBrowserBatchFiles(selectedFiles, subdir);
  return {
    directory: directoryFromFilePath(savedFiles[0]?.path || ""),
    images: savedFiles,
  };
}

async function importHistoryFallback(): Promise<string> {
  if (typeof document === "undefined") return "";
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    const cleanup = () => input.remove();
    input.addEventListener("change", async () => {
      try {
        const file = input.files?.[0];
        if (!file) {
          cleanup();
          resolve("");
          return;
        }
        cleanup();
        resolve(await file.text());
      } catch (error) {
        cleanup();
        reject(error);
      }
    }, { once: true });
    input.click();
  });
}

export function OpenImageDialog(): Promise<SelectFileResponseLike> {
  if (hasServiceMethod("OpenImageDialog")) {
    return invokeService<SelectFileResponseLike>(unsupportedMessage, "OpenImageDialog")
      .catch(() => openImageDialogFallback())
      .then((res) => persistBrowserSelectedImage(res));
  }
  if (canInvokeAndroidMethod("OpenImageDialog")) {
    return invokeAndroid<SelectFileResponseLike>(unsupportedMessage, "OpenImageDialog")
      .catch(() => openImageDialogFallback())
      .then((res) => persistBrowserSelectedImage(res));
  }
  return openImageDialogFallback().then((res) => persistBrowserSelectedImage(res));
}

export function OpenImagesDialog(): Promise<SelectFilesResponseLike> {
  if (hasServiceMethod("OpenImagesDialog")) {
    return invokeService<SelectFilesResponseLike>(unsupportedMessage, "OpenImagesDialog")
      .then((res) => {
        if (shouldFallbackFromEmptyNativeDialog() && (!Array.isArray(res?.files) || res.files.length === 0)) {
          return openImagesDialogFallback();
        }
        return res;
      })
      .catch(() => openImagesDialogFallback());
  }
  return openImagesDialogFallback();
}

export function ChooseBatchInputDir(): Promise<BatchInputDirectoryLike> {
  if (hasServiceMethod("ChooseBatchInputDir")) {
    return invokeService<BatchInputDirectoryLike>(unsupportedMessage, "ChooseBatchInputDir")
      .then((res) => {
        const images = Array.isArray(res?.images) ? res.images : [];
        if (shouldFallbackFromEmptyNativeDialog() && !String(res?.directory || "").trim() && images.length === 0) {
          return chooseBatchInputDirFallback();
        }
        return res;
      })
      .catch(() => chooseBatchInputDirFallback());
  }
  return chooseBatchInputDirFallback();
}

export function ListBatchInputImages(directory: string): Promise<BatchInputDirectoryLike> {
  if (hasServiceMethod("ListBatchInputImages")) {
    return invokeService<BatchInputDirectoryLike>(unsupportedMessage, "ListBatchInputImages", directory);
  }
  return listProjectBatchInputImages(directory).then((result) => {
    if (result) return result;
    throw new Error(unsupportedMessage("ListBatchInputImages"));
  });
}

export function ExportHistoryToFile(jsonContent: string): Promise<string> {
  if (hasServiceMethod("ExportHistoryToFile")) {
    return invokeService<string>(unsupportedMessage, "ExportHistoryToFile", jsonContent);
  }
  return Promise.resolve(saveByDownload(new Blob([jsonContent], { type: "application/json" }), `fhl-studio-history-${Date.now()}.json`));
}

export function ImportHistoryFromFile(): Promise<string> {
  if (hasServiceMethod("ImportHistoryFromFile")) {
    return invokeService<string>(unsupportedMessage, "ImportHistoryFromFile");
  }
  if (canInvokeAndroidMethod("ImportHistoryFromFile")) {
    return invokeAndroid<string>(unsupportedMessage, "ImportHistoryFromFile");
  }
  return importHistoryFallback();
}

export function ChooseOutputDir(): Promise<string> {
  if (hasServiceMethod("ChooseOutputDir")) {
    return invokeService<string>(unsupportedMessage, "ChooseOutputDir");
  }
  if (canInvokeAndroidMethod("ChooseOutputDir")) {
    return invokeAndroid<string>(unsupportedMessage, "ChooseOutputDir");
  }
  return chooseProjectDirectory("选择输出目录").then((chosen) => {
    if (chosen !== null) return chosen;
    return GetOutputDir();
  });
}

export function ChooseBatchOutputDir(): Promise<string> {
  if (hasServiceMethod("ChooseBatchOutputDir")) {
    return invokeService<string>(unsupportedMessage, "ChooseBatchOutputDir");
  }
  if (canInvokeAndroidMethod("ChooseDirectory")) {
    return invokeAndroid<string>(unsupportedMessage, "ChooseDirectory", "选择批处理输出目录");
  }
  if (canInvokeAndroidMethod("ChooseOutputDir")) {
    return invokeAndroid<string>(unsupportedMessage, "ChooseOutputDir");
  }
  return chooseProjectDirectory("选择批处理输出目录").then((chosen) => {
    if (chosen !== null) return chosen;
    throw new Error(unsupportedMessage("ChooseBatchOutputDir"));
  });
}

export function OpenOutputDir(): Promise<void> {
  if (hasServiceMethod("OpenOutputDir")) {
    return invokeService<void>(unsupportedMessage, "OpenOutputDir");
  }
  if (canInvokeAndroidMethod("OpenOutputDir")) {
    return invokeAndroid<void>(unsupportedMessage, "OpenOutputDir");
  }
  return Promise.reject(new Error(unsupportedMessage("OpenOutputDir")));
}

export function OpenMaterialSyncDir(path: string): Promise<void> {
  if (hasServiceMethod("OpenMaterialSyncDir")) {
    return invokeService<void>(unsupportedMessage, "OpenMaterialSyncDir", path);
  }
  return openProjectMaterialSyncDir(path).then((opened) => {
    if (opened) return;
    return OpenOutputDir();
  });
}

export function BuildBatchOutputPath(sourcePath: string, outputDir: string, prefix: string): Promise<string> {
  if (hasServiceMethod("BuildBatchOutputPath")) {
    return invokeService<string>(unsupportedMessage, "BuildBatchOutputPath", sourcePath, outputDir, prefix);
  }
  return buildProjectBatchOutputPath(sourcePath, outputDir, prefix).then((result) => {
    if (result) return result;
    throw new Error(unsupportedMessage("BuildBatchOutputPath"));
  });
}

export function OpenExternalURL(url: string): Promise<void> {
  if (canInvokeAndroidMethod("OpenExternalURL")) {
    return invokeAndroid<void>(unsupportedMessage, "OpenExternalURL", url).catch((error) => {
      if (targetPlatform === "android" || targetPlatform === "android-pad") {
        return Promise.reject(error);
      }
      const opened = typeof window !== "undefined" ? window.open(url, "_blank", "noopener,noreferrer") : null;
      if (!opened && typeof window !== "undefined") window.location.href = url;
    });
  }
  if (!hasServiceMethod("OpenExternalURL")) {
    if (targetPlatform === "android" || targetPlatform === "android-pad") {
      return Promise.reject(new Error(unsupportedMessage("OpenExternalURL")));
    }
    if (typeof window !== "undefined") {
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) window.location.href = url;
      return Promise.resolve();
    }
    return Promise.reject(new Error(unsupportedMessage("OpenExternalURL")));
  }
  return invokeService<void>(unsupportedMessage, "OpenExternalURL", url);
}

export function OpenFile(path: string): Promise<void> {
  if (isVirtualPath(path)) {
    return openVirtualPath(path);
  }
  if (canInvokeAndroidMethod("OpenFile")) {
    return invokeAndroid<void>(unsupportedMessage, "OpenFile", path);
  }
  return invokeService<void>(unsupportedMessage, "OpenFile", path);
}

export function ReadTextFile(path: string): Promise<string> {
  if (isVirtualPath(path)) {
    return Promise.resolve(readVirtualText(path));
  }
  if (!hasServiceMethod("ReadTextFile") && !canInvokeAndroidMethod("ReadTextFile")) {
    return readProjectText(path).then((text) => {
      if (text !== null) return text;
      throw new Error(unsupportedMessage("ReadTextFile"));
    });
  }
  if (canInvokeAndroidMethod("ReadTextFile")) {
    return invokeAndroid<string>(unsupportedMessage, "ReadTextFile", path);
  }
  return invokeService<string>(unsupportedMessage, "ReadTextFile", path);
}

export function BeginNativeFileDrag(path: string): Promise<void> {
  if (hasServiceMethod("BeginNativeFileDrag")) {
    return invokeService<void>(unsupportedMessage, "BeginNativeFileDrag", path);
  }
  return Promise.reject(new Error(unsupportedMessage("BeginNativeFileDrag")));
}

export function registerEphemeralLog(text: string, suggestedName = "raw-response.txt"): string {
  return registerVirtualText(text, suggestedName);
}
