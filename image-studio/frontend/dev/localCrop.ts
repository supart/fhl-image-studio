import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/**
 * Limits used by the desktop high-resolution path.  The browser endpoint
 * receives only a managed file path and a crop rectangle; it never receives
 * the source image bytes.
 */
export const LOCAL_CROP_LIMITS = {
  maxSourcePixels: 100_000_000,
  maxDimension: 16_384,
  maxWorkingBytes: 768 * 1024 * 1024,
} as const;

export type LocalCropRequest = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ImageMetadata = {
  width: number;
  height: number;
};

function checkedMultiply(a: number, b: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b < 0) {
    throw new Error("裁切尺寸计算溢出，请缩小选择区域后重试");
  }
  const result = a * b;
  if (!Number.isSafeInteger(result)) throw new Error("裁切尺寸计算溢出，请缩小选择区域后重试");
  return result;
}

function finiteInteger(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isSafeInteger(number)) {
    throw new Error(`裁切参数 ${field} 无效`);
  }
  return number;
}

function formatBytes(value: number): string {
  return `${Math.round(value / (1024 * 1024))}MiB`;
}

function validateMetadata(metadata: ImageMetadata): ImageMetadata {
  const { width, height } = metadata;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error("无法读取原图自然像素尺寸");
  }
  if (width > LOCAL_CROP_LIMITS.maxDimension || height > LOCAL_CROP_LIMITS.maxDimension) {
    throw new Error(`原图单边 ${width}×${height} 超过桌面裁切上限 ${LOCAL_CROP_LIMITS.maxDimension}px`);
  }
  const pixels = checkedMultiply(width, height);
  if (pixels > LOCAL_CROP_LIMITS.maxSourcePixels) {
    throw new Error(`原图 ${width}×${height} 超过桌面裁切上限 100MP`);
  }
  return metadata;
}

export function validateLocalCropRequest(metadata: ImageMetadata, request: LocalCropRequest): LocalCropRequest {
  const source = validateMetadata(metadata);
  const x = finiteInteger(request?.x, "x");
  const y = finiteInteger(request?.y, "y");
  const width = finiteInteger(request?.width, "width");
  const height = finiteInteger(request?.height, "height");
  if (x < 0 || y < 0 || width <= 0 || height <= 0) {
    throw new Error("裁切坐标和尺寸必须为正整数");
  }
  if (width > LOCAL_CROP_LIMITS.maxDimension || height > LOCAL_CROP_LIMITS.maxDimension) {
    throw new Error(`裁切区域 ${width}×${height} 超过单边上限 ${LOCAL_CROP_LIMITS.maxDimension}px`);
  }
  if (x > source.width || y > source.height || x + width > source.width || y + height > source.height) {
    throw new Error(`裁切区域 ${x},${y},${width}×${height} 超出原图 ${source.width}×${source.height} 边界`);
  }
  const cropPixels = checkedMultiply(width, height);
  // sharp may decode the source and crop buffers concurrently. Keep the same
  // conservative estimate as the native high-resolution path before doing so.
  const estimate = 32 * 1024 * 1024
    + checkedMultiply(checkedMultiply(source.width, source.height), 6)
    + checkedMultiply(cropPixels, 8);
  if (estimate > LOCAL_CROP_LIMITS.maxWorkingBytes) {
    throw new Error(`裁切所需工作内存过大（估算 ${formatBytes(estimate)}，上限 768MiB），请缩小选择区域后重试`);
  }
  return { x, y, width, height };
}

async function readImageMetadata(filePath: string): Promise<ImageMetadata> {
  const metadata = await sharp(filePath).metadata();
  return validateMetadata({
    width: Number(metadata.width || 0),
    height: Number(metadata.height || 0),
  });
}

function temporaryPath(outputPath: string): string {
  const token = randomBytes(8).toString("hex");
  return path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.${token}.tmp`);
}

/**
 * Crop a managed image for the local Vite preview host. The output is written
 * atomically so callers never observe a partial image after a failed decode,
 * encode, cancellation, or disk write.
 */
export async function cropLocalImageFile(
  sourcePath: string,
  outputPath: string,
  request: LocalCropRequest,
): Promise<{ path: string; acceleration: string; width: number; height: number }> {
  const source = await readImageMetadata(sourcePath);
  const crop = validateLocalCropRequest(source, request);
  const tempPath = temporaryPath(outputPath);
  try {
    await fs.rm(tempPath, { force: true });
    await sharp(sourcePath)
      .extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height })
      .png()
      .toFile(tempPath);
    const output = await sharp(tempPath).metadata();
    if (Number(output.width || 0) !== crop.width || Number(output.height || 0) !== crop.height) {
      throw new Error("裁切输出尺寸与选择区域不一致");
    }
    await fs.rename(tempPath, outputPath);
    return {
      path: outputPath,
      acceleration: "node-sharp",
      width: crop.width,
      height: crop.height,
    };
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    await fs.rm(outputPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
