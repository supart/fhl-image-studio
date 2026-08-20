import {
  cropVirtualImage,
  flipVirtualImage,
  isVirtualPath,
  readVirtualImageAsBase64,
  registerVirtualImage,
  releaseVirtualPath,
  rotateVirtualImage,
} from "../../lib/virtualHostStore.ts";
import { fileNameFromPath, saveByDownload } from "./hostBrowser.ts";
import {
  cropProjectImage,
  readProjectImage,
  pasteProjectLocalEdit,
  registerProjectMedia,
  saveProjectImage,
  syncProjectMaterialGroup,
} from "./localProjectFiles.ts";
import {
  canInvokeAndroidMethod,
  hasServiceMethod,
  invokeAndroid,
  invokeService,
} from "./hostBindings.ts";
import {
  isLocalPreviewHost,
  supportsDesktopNativeGPUTransforms,
  unsupportedMessage,
} from "./hostContext.ts";
import type {
  ImageTransformResultLike,
  ImportedImageLike,
  MaterialOutputSyncItemLike,
  MaterialOutputSyncResultLike,
  MediaAssetRefLike,
  PlanarPastebackOptionsLike,
  PhotoMetadataLike,
} from "./hostTypes.ts";

export type LocalInputImageLike = ImportedImageLike & { name?: string };

function mimeTypeForImageName(name: string): string {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

function blobFromBase64(imageB64: string, mimeType: string): Blob {
  return new Blob([Uint8Array.from(atob(imageB64), (ch) => ch.charCodeAt(0))], { type: mimeType });
}

async function persistVirtualTransformResult(
  result: { path: string; imageB64?: string; mimeType?: string; name?: string; acceleration?: string },
  fallbackName: string,
): Promise<ImageTransformResultLike> {
  const imageB64 = result.imageB64 || readVirtualImageAsBase64(result.path);
  const suggested = result.name || fallbackName;
  const imported = await ImportImageFromB64(imageB64, suggested);
  return {
    path: imported.path,
    acceleration: result.acceleration,
  };
}

async function materializeReadablePathAsVirtual(path: string): Promise<ImportedImageLike> {
  const imageB64 = await ReadImageAsBase64(path);
  return registerVirtualImage({
    imageB64,
    suggestedName: fileNameFromPath(path),
  });
}

async function runPersistedVirtualTransform(
  path: string,
  transform: (virtualPath: string) => Promise<{ path: string; imageB64?: string; mimeType?: string; name?: string; acceleration?: string }>,
): Promise<ImageTransformResultLike> {
  const imported = await materializeReadablePathAsVirtual(path);
  let resultPath: string | null = null;
  try {
    const result = await transform(imported.path);
    resultPath = result.path;
    return await persistVirtualTransformResult(result, fileNameFromPath(path));
  } finally {
    releaseVirtualPath(imported.path);
    if (resultPath && resultPath !== imported.path) releaseVirtualPath(resultPath);
  }
}

export async function persistBrowserImageToLocalInput(
  imageB64: string,
  suggestedName: string,
  mimeType?: string | null,
  options: { subdir?: string; preserveName?: boolean } = {},
): Promise<LocalInputImageLike | null> {
  const saved = await saveProjectImage("input", imageB64, suggestedName, mimeType, options);
  if (saved?.path) {
    return {
      path: saved.path,
      name: saved.name,
    };
  }
  if (!hasServiceMethod("ImportImageFromB64")) return null;
  return invokeService<ImportedImageLike>(unsupportedMessage, "ImportImageFromB64", imageB64, suggestedName)
    .then((imported) => {
      const importedPath = String(imported?.path || "").trim();
      return importedPath && !isVirtualPath(importedPath) ? imported : null;
    })
    .catch((error) => {
      if (typeof console !== "undefined") console.warn("native import fallback failed", error);
      return null;
    });
}

export function SaveImageAs(imageB64: string, suggestedName: string): Promise<string> {
  if (hasServiceMethod("SaveImageAs")) {
    return invokeService<string>(unsupportedMessage, "SaveImageAs", imageB64, suggestedName);
  }
  if (canInvokeAndroidMethod("SaveImageAs")) {
    return invokeAndroid<string>(unsupportedMessage, "SaveImageAs", imageB64, suggestedName);
  }
  const mimeType = mimeTypeForImageName(suggestedName);
  return saveProjectImage("output", imageB64, suggestedName, mimeType).then((projectSaved) => {
    if (projectSaved?.path) return projectSaved.path;
    return saveByDownload(blobFromBase64(imageB64, mimeType), suggestedName);
  });
}

export function SaveImagePathAs(path: string, suggestedName: string): Promise<string> {
  if (hasServiceMethod("SaveImagePathAs")) {
    return invokeService<string>(unsupportedMessage, "SaveImagePathAs", path, suggestedName);
  }
  if (isVirtualPath(path)) {
    return ReadImageAsBase64(path).then((b64) => SaveImageAs(b64, suggestedName));
  }
  if (canInvokeAndroidMethod("SaveImagePathAs")) {
    return invokeAndroid<string>(unsupportedMessage, "SaveImagePathAs", path, suggestedName)
      .catch(() => ReadImageAsBase64(path).then((b64) => SaveImageAs(b64, suggestedName)));
  }
  return ReadImageAsBase64(path).then((b64) => SaveImageAs(b64, suggestedName));
}

export function SaveImageToDir(imageB64: string, directory: string, suggestedName: string): Promise<string> {
  if (hasServiceMethod("SaveImageToDir")) {
    return invokeService<string>(unsupportedMessage, "SaveImageToDir", imageB64, directory, suggestedName);
  }
  if (canInvokeAndroidMethod("SaveImageToDir")) {
    return invokeAndroid<string>(unsupportedMessage, "SaveImageToDir", imageB64, directory, suggestedName);
  }
  const mimeType = mimeTypeForImageName(suggestedName);
  return saveProjectImage("output", imageB64, suggestedName, mimeType, { directory }).then((projectSaved) => {
    if (projectSaved?.path) return projectSaved.path;
    throw new Error(unsupportedMessage("SaveImageToDir"));
  });
}

export function SaveImagePathToDir(path: string, directory: string, suggestedName: string): Promise<string> {
  if (hasServiceMethod("SaveImagePathToDir")) {
    return invokeService<string>(unsupportedMessage, "SaveImagePathToDir", path, directory, suggestedName);
  }
  if (isVirtualPath(path)) {
    return ReadImageAsBase64(path).then((b64) => SaveImageToDir(b64, directory, suggestedName));
  }
  if (canInvokeAndroidMethod("SaveImagePathToDir")) {
    return invokeAndroid<string>(unsupportedMessage, "SaveImagePathToDir", path, directory, suggestedName)
      .catch(() => ReadImageAsBase64(path).then((b64) => SaveImageToDir(b64, directory, suggestedName)));
  }
  return ReadImageAsBase64(path).then((b64) => SaveImageToDir(b64, directory, suggestedName));
}

/**
 * Copy a managed image into the active desktop Output/images directory.
 * Browser preview keeps this as a short-lived read/copy fallback; image data
 * is never retained in the runtime state or returned from this capability.
 */
export function SaveImagePathToOutput(path: string, suggestedName: string): Promise<string> {
  if (hasServiceMethod("SaveImagePathToOutput")) {
    return invokeService<string>(unsupportedMessage, "SaveImagePathToOutput", path, suggestedName);
  }
  if (isLocalPreviewHost()) {
    const name = suggestedName || fileNameFromPath(path) || "image.png";
    return ReadImageAsBase64(path).then(async (imageB64) => {
      const projectSaved = await saveProjectImage(
        "output",
        imageB64,
        name,
        mimeTypeForImageName(name),
        { subdir: "images", preserveName: true },
      );
      if (projectSaved?.path) return projectSaved.path;
      throw new Error(unsupportedMessage("SaveImagePathToOutput"));
    });
  }
  return Promise.reject(new Error(unsupportedMessage("SaveImagePathToOutput")));
}

export function SyncMaterialGroupToOutput(
  groupKind: string,
  groupName: string,
  items: MaterialOutputSyncItemLike[],
): Promise<MaterialOutputSyncResultLike> {
  if (hasServiceMethod("SyncMaterialGroupToOutput")) {
    return invokeService<MaterialOutputSyncResultLike>(
      unsupportedMessage,
      "SyncMaterialGroupToOutput",
      groupKind,
      groupName,
      items,
    );
  }
  return syncProjectMaterialGroup(groupKind, groupName, items).then((result) => {
    if (result) return result;
    throw new Error(unsupportedMessage("SyncMaterialGroupToOutput"));
  });
}

export async function ShareImageAs(imageB64: string, suggestedName: string): Promise<string> {
  if (!imageB64.trim()) throw new Error("没有可分享的图片");
  if (canInvokeAndroidMethod("ShareImageAs")) {
    return invokeAndroid<string>(unsupportedMessage, "ShareImageAs", imageB64, suggestedName);
  }
  const mimeType = mimeTypeForImageName(suggestedName);
  if (typeof navigator !== "undefined" && navigator.share && typeof File !== "undefined") {
    const file = new File([blobFromBase64(imageB64, mimeType)], suggestedName, { type: mimeType });
    const canShare = !navigator.canShare || navigator.canShare({ files: [file] });
    if (canShare) {
      await navigator.share({ files: [file], title: suggestedName });
      return suggestedName;
    }
  }
  return SaveImageAs(imageB64, suggestedName);
}

export function ShareImagePathAs(path: string, suggestedName: string): Promise<string> {
  if (!path.trim()) return Promise.reject(new Error("没有可分享的图片"));
  if (canInvokeAndroidMethod("ShareImagePathAs")) {
    return invokeAndroid<string>(unsupportedMessage, "ShareImagePathAs", path, suggestedName)
      .catch(() => ReadImageAsBase64(path).then((b64) => ShareImageAs(b64, suggestedName)));
  }
  return ReadImageAsBase64(path).then((b64) => ShareImageAs(b64, suggestedName));
}

export function RegisterMediaAsset(savedPath: string, thumbPath: string): Promise<MediaAssetRefLike> {
  if (hasServiceMethod("RegisterMediaAsset")) {
    return invokeService<MediaAssetRefLike>(unsupportedMessage, "RegisterMediaAsset", savedPath, thumbPath);
  }
  return registerProjectMedia(savedPath, thumbPath)
    .then((ref) => ref ?? { savedPath, thumbPath });
}

export function RegisterImportedImageAsset(path: string): Promise<MediaAssetRefLike> {
  if (hasServiceMethod("RegisterImportedImageAsset")) {
    return invokeService<MediaAssetRefLike>(unsupportedMessage, "RegisterImportedImageAsset", path);
  }
  return registerProjectMedia(path)
    .then((ref) => ref ?? { savedPath: path });
}

export function ImportImageFromB64(imageB64: string, suggestedName: string): Promise<ImportedImageLike> {
  if (hasServiceMethod("ImportImageFromB64")) {
    return invokeService<ImportedImageLike>(unsupportedMessage, "ImportImageFromB64", imageB64, suggestedName)
      .catch(() => registerVirtualImage({ imageB64, suggestedName }));
  }
  if (canInvokeAndroidMethod("ImportImageFromB64")) {
    return invokeAndroid<ImportedImageLike>(unsupportedMessage, "ImportImageFromB64", imageB64, suggestedName)
      .catch(() => registerVirtualImage({ imageB64, suggestedName }));
  }
  return saveProjectImage("input", imageB64, suggestedName)
    .then((saved) => saved
      ? { path: saved.path, imageB64 }
      : registerVirtualImage({ imageB64, suggestedName }));
}

export function ImportImagePath(path: string): Promise<ImportedImageLike> {
  const suggestedName = fileNameFromPath(path);
  if (hasServiceMethod("ImportImagePath")) {
    return invokeService<ImportedImageLike>(unsupportedMessage, "ImportImagePath", path);
  }
  return ReadImageAsBase64(path)
    .then((imageB64) => ImportImageFromB64(imageB64, suggestedName));
}

export function RotateImage(path: string, degrees: number): Promise<ImageTransformResultLike> {
  if (isVirtualPath(path)) {
    return rotateVirtualImage(path, degrees).then((result) => ({ path: result.path, acceleration: result.acceleration || "cpu-canvas" }));
  }
  if (supportsDesktopNativeGPUTransforms()) {
    return invokeService<ImageTransformResultLike>(unsupportedMessage, "RotateImage", path, degrees);
  }
  return runPersistedVirtualTransform(path, (virtualPath) => rotateVirtualImage(virtualPath, degrees));
}

export function FlipImage(path: string, horizontal: boolean): Promise<ImageTransformResultLike> {
  if (isVirtualPath(path)) {
    return flipVirtualImage(path, horizontal).then((result) => ({ path: result.path, acceleration: result.acceleration || "cpu-canvas" }));
  }
  if (supportsDesktopNativeGPUTransforms()) {
    return invokeService<ImageTransformResultLike>(unsupportedMessage, "FlipImage", path, horizontal);
  }
  return runPersistedVirtualTransform(path, (virtualPath) => flipVirtualImage(virtualPath, horizontal));
}

export function CropImage(path: string, x: number, y: number, width: number, height: number): Promise<ImageTransformResultLike> {
  if (isVirtualPath(path)) {
    return cropVirtualImage(path, x, y, width, height).then((result) => ({ path: result.path, acceleration: result.acceleration || "cpu-canvas" }));
  }
  if (hasServiceMethod("CropImage")) {
    return invokeService<ImageTransformResultLike>(unsupportedMessage, "CropImage", path, x, y, width, height);
  }
  if (isLocalPreviewHost()) {
    return cropProjectImage(path, x, y, width, height);
  }
  return runPersistedVirtualTransform(path, (virtualPath) => cropVirtualImage(virtualPath, x, y, width, height));
}

export function PasteLocalEdit(sourcePath: string, editedPath: string, options: PlanarPastebackOptionsLike): Promise<ImageTransformResultLike> {
  if (hasServiceMethod("PasteLocalEdit")) {
    return invokeService<ImageTransformResultLike>(unsupportedMessage, "PasteLocalEdit", sourcePath, editedPath, options);
  }
  if (isLocalPreviewHost()) {
    return pasteProjectLocalEdit(sourcePath, editedPath, options);
  }
  return Promise.reject(new Error(unsupportedMessage("PasteLocalEdit")));
}

export function ReadImageAsBase64(path: string): Promise<string> {
  if (isVirtualPath(path)) {
    return Promise.resolve(readVirtualImageAsBase64(path));
  }
  if (!hasServiceMethod("ReadImageAsBase64") && !canInvokeAndroidMethod("ReadImageAsBase64")) {
    return readProjectImage(path).then((imageB64) => {
      if (imageB64) return imageB64;
      throw new Error(unsupportedMessage("ReadImageAsBase64"));
    });
  }
  if (canInvokeAndroidMethod("ReadImageAsBase64")) {
    return invokeAndroid<string>(unsupportedMessage, "ReadImageAsBase64", path);
  }
  return invokeService<string>(unsupportedMessage, "ReadImageAsBase64", path);
}

export function ReadImageMetadata(path: string): Promise<PhotoMetadataLike> {
  if (isVirtualPath(path)) return Promise.resolve({});
  if (hasServiceMethod("ReadImageMetadata")) {
    return invokeService<PhotoMetadataLike>(unsupportedMessage, "ReadImageMetadata", path);
  }
  return Promise.resolve({});
}
