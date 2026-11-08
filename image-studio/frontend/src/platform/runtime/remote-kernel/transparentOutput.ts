import { RemoteKernelError } from "./types.ts";

export const INVALID_TRANSPARENT_OUTPUT = "invalid_transparent_output";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const PIXEL_SCAN_ROWS = 256;

function invalidTransparentOutput(reason: string, rawPath: string | null): RemoteKernelError {
  return new RemoteKernelError(
    `${INVALID_TRANSPARENT_OUTPUT}: 透明输出校验失败：${reason}`,
    rawPath,
    { errorCode: INVALID_TRANSPARENT_OUTPUT },
  );
}

function decodeImageBase64(imageB64: string, rawPath: string | null): Uint8Array {
  const input = String(imageB64 || "").trim();
  const comma = input.startsWith("data:") ? input.indexOf(",") : -1;
  const payload = (comma >= 0 ? input.slice(comma + 1) : input).replace(/\s+/g, "");
  if (!payload) throw invalidTransparentOutput("结果图片数据为空。", rawPath);
  try {
    const binary = globalThis.atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    throw invalidTransparentOutput("结果图片不是有效的 Base64 数据。", rawPath);
  }
}

function hasPNGSignature(bytes: Uint8Array): boolean {
  return bytes.length >= PNG_SIGNATURE.length
    && PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

type PixelCanvas = OffscreenCanvas | HTMLCanvasElement;
type PixelContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function createPixelCanvas(width: number, height: number, rawPath: string | null): PixelCanvas {
  if (typeof globalThis.OffscreenCanvas === "function") return new globalThis.OffscreenCanvas(width, height);
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw invalidTransparentOutput("当前浏览器无法读取 PNG 像素。", rawPath);
}

/** Validate only the final transparent result, never a streaming preview. */
export async function validateTransparentPNGBase64(
  imageB64: string,
  rawPath: string | null = null,
): Promise<void> {
  const bytes = decodeImageBase64(imageB64, rawPath);
  if (!hasPNGSignature(bytes)) throw invalidTransparentOutput("结果不是 PNG 文件。", rawPath);
  if (typeof globalThis.createImageBitmap !== "function") {
    throw invalidTransparentOutput("当前浏览器无法解码 PNG。", rawPath);
  }
  let bitmap: ImageBitmap;
  try {
    const pngBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    bitmap = await globalThis.createImageBitmap(new Blob([pngBuffer], { type: "image/png" }));
  } catch {
    throw invalidTransparentOutput("PNG 解码失败或文件已损坏。", rawPath);
  }
  try {
    const width = Number(bitmap.width);
    const height = Number(bitmap.height);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
      throw invalidTransparentOutput("PNG 像素尺寸无效。", rawPath);
    }
    const canvas = createPixelCanvas(width, height, rawPath);
    const context = canvas.getContext("2d", { willReadFrequently: true }) as PixelContext | null;
    if (!context) throw invalidTransparentOutput("当前浏览器无法读取 PNG 像素。", rawPath);
    context.clearRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0);
    let hasVisiblePixel = false;
    let hasTransparentPixel = false;
    for (let y = 0; y < height && !(hasVisiblePixel && hasTransparentPixel); y += PIXEL_SCAN_ROWS) {
      const rows = Math.min(PIXEL_SCAN_ROWS, height - y);
      const pixels = context.getImageData(0, y, width, rows).data;
      for (let i = 3; i < pixels.length; i += 4) {
        const alpha = pixels[i];
        if (alpha > 0) hasVisiblePixel = true;
        if (alpha < 255) hasTransparentPixel = true;
        if (hasVisiblePixel && hasTransparentPixel) break;
      }
    }
    if (!hasVisiblePixel) throw invalidTransparentOutput("PNG 所有像素均为全透明，缺少可见内容。", rawPath);
    if (!hasTransparentPixel) throw invalidTransparentOutput("PNG 不包含真实透明像素。", rawPath);
  } finally {
    bitmap.close?.();
  }
}
