import { dataURLFromBase64, guessImageMimeTypeFromName, imageExtensionForMimeType } from "../../lib/images";
import { sourceToDataURL } from "../../lib/virtualHostStore";
import { ReadImageAsBase64 } from "../../platform/runtime/host";
import type { SourceImage } from "../../types/domain";

export const WINDOWS_SOURCE_TILE_HEIGHT = 56;
export const WINDOWS_SOURCE_TILE_MIN_WIDTH = 36;
export const WINDOWS_SOURCE_TILE_MAX_WIDTH = 112;

const CLIPBOARD_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export type ClipboardImageReadError = "unavailable" | "empty" | "unsupported" | "denied";
export type CopySourceImageResult = "success" | "unavailable" | "missing" | "failed";

export class ClipboardImageError extends Error {
  constructor(readonly code: ClipboardImageReadError) {
    super(code);
    this.name = "ClipboardImageError";
  }
}

export function calculateWindowsSourceTileWidth(
  width?: number,
  height?: number,
  fallbackWidth?: number,
  fallbackHeight?: number,
): number {
  const hasPrimarySize = Number.isFinite(Number(width)) && Number(width) > 0
    && Number.isFinite(Number(height)) && Number(height) > 0;
  const safeWidth = hasPrimarySize ? Number(width) : Number(fallbackWidth);
  const safeHeight = hasPrimarySize ? Number(height) : Number(fallbackHeight);
  if (!Number.isFinite(safeWidth) || safeWidth <= 0 || !Number.isFinite(safeHeight) || safeHeight <= 0) {
    return WINDOWS_SOURCE_TILE_HEIGHT;
  }
  return Math.round(Math.max(
    WINDOWS_SOURCE_TILE_MIN_WIDTH,
    Math.min(WINDOWS_SOURCE_TILE_MAX_WIDTH, WINDOWS_SOURCE_TILE_HEIGHT * (safeWidth / safeHeight)),
  ));
}

export async function readClipboardImageFile(): Promise<File> {
  if (!navigator.clipboard?.read) throw new ClipboardImageError("unavailable");

  let items: ClipboardItems;
  try {
    items = await navigator.clipboard.read();
  } catch {
    throw new ClipboardImageError("denied");
  }

  let hasUnsupportedImage = false;
  for (const item of items) {
    const supportedType = CLIPBOARD_IMAGE_TYPES.find((type) => item.types.includes(type));
    if (supportedType) {
      const blob = await item.getType(supportedType);
      return new File(
        [blob],
        `clipboard-image.${imageExtensionForMimeType(supportedType)}`,
        { type: supportedType },
      );
    }
    if (item.types.some((type) => type.startsWith("image/"))) hasUnsupportedImage = true;
  }

  throw new ClipboardImageError(hasUnsupportedImage ? "unsupported" : "empty");
}

export function clipboardImageReadMessage(error: unknown): string {
  if (!(error instanceof ClipboardImageError)) return "无法读取剪贴板图片，请重试";
  switch (error.code) {
    case "unavailable":
      return "当前环境无法读取剪贴板图片，请使用 Ctrl+V 或拖入图片";
    case "unsupported":
      return "剪贴板图片格式不支持，请使用 PNG、JPG 或 WebP";
    case "empty":
      return "剪贴板里没有可用图片";
    default:
      return "没有获得剪贴板图片读取权限，请重试";
  }
}

async function sourceOriginalDataURL(source: SourceImage): Promise<string> {
  const direct = await sourceToDataURL(source).catch(() => "");
  if (direct || !source.path) return direct;
  const imageB64 = await ReadImageAsBase64(source.path).catch(() => "");
  return imageB64
    ? dataURLFromBase64(imageB64, guessImageMimeTypeFromName(source.name || source.path))
    : "";
}

async function blobAsPNG(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;

  const objectURL = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("image decode failed"));
      element.src = objectURL;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas unavailable");
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((png) => {
        if (png) resolve(png);
        else reject(new Error("png encode failed"));
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(objectURL);
  }
}

export async function copySourceImageToClipboard(source: SourceImage): Promise<CopySourceImageResult> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return "unavailable";

  try {
    const dataURL = await sourceOriginalDataURL(source);
    if (!dataURL) return "missing";
    const originalBlob = await (await fetch(dataURL)).blob();
    const png = await blobAsPNG(originalBlob);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return "success";
  } catch {
    return "failed";
  }
}
