import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export type BrowserPastebackOptions = {
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  offsetXRatio?: number;
  offsetYRatio?: number;
  scale?: number;
  rotationDeg?: number;
  featherFraction?: number;
  brightness?: number;
  contrast?: number;
  hueRotationDeg?: number;
  maskB64?: string;
  maskFeatherPx?: number;
};

const MAX_SOURCE_PIXELS = 100_000_000;
const MAX_EDITED_PIXELS = 64_000_000;
const MAX_DIMENSION = 16_384;
const MAX_WORKING_BYTES = 768 * 1024 * 1024;
const MAX_MASK_BYTES = 50 * 1024 * 1024;

type RawImage = {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
};

function finiteOrZero(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function checkedMultiply(a: number, b: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b < 0) {
    throw new Error("贴回尺寸计算溢出，请缩小裁切区域后重试");
  }
  const value = a * b;
  if (!Number.isSafeInteger(value)) throw new Error("贴回尺寸计算溢出，请缩小裁切区域后重试");
  return value;
}

function estimateWorkingBytes(
  sourceWidth: number,
  sourceHeight: number,
  editedWidth: number,
  editedHeight: number,
  maskWidth: number,
  maskHeight: number,
  cropWidth: number,
  cropHeight: number,
): number {
  const source = checkedMultiply(checkedMultiply(sourceWidth, sourceHeight), 6);
  const edited = checkedMultiply(checkedMultiply(editedWidth, editedHeight), 6);
  const mask = checkedMultiply(checkedMultiply(maskWidth, maskHeight), 4);
  // The crop buffer is mutated in place and then passed directly to sharp.
  // Counting it once reflects the actual allocation; the previous estimate
  // counted both the source crop and a second copy that is no longer made.
  const crop = checkedMultiply(checkedMultiply(cropWidth, cropHeight), 4);
  const estimate = 32 * 1024 * 1024 + source + edited + mask + crop;
  if (!Number.isSafeInteger(estimate)) throw new Error("贴回尺寸计算溢出，请缩小裁切区域后重试");
  return estimate;
}

function formatBytes(value: number): string {
  return value >= 1024 * 1024 * 1024
    ? `${(value / (1024 * 1024 * 1024)).toFixed(1)}GiB`
    : `${Math.round(value / (1024 * 1024))}MiB`;
}

function cleanBase64(value: string): string {
  const raw = String(value || "").trim();
  const comma = raw.indexOf(",");
  return (comma >= 0 ? raw.slice(comma + 1) : raw).replace(/\s+/g, "");
}

function finiteInteger(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isSafeInteger(number)) {
    throw new Error(`贴回参数 ${field} 无效`);
  }
  return number;
}

function validateConfig(sourceWidth: number, sourceHeight: number, editedWidth: number, editedHeight: number, options: BrowserPastebackOptions) {
  if (!Number.isSafeInteger(sourceWidth) || !Number.isSafeInteger(sourceHeight)
    || !Number.isSafeInteger(editedWidth) || !Number.isSafeInteger(editedHeight)
    || sourceWidth <= 0 || sourceHeight <= 0 || editedWidth <= 0 || editedHeight <= 0) {
    throw new Error("贴回图像尺寸无效");
  }
  const sourcePixels = checkedMultiply(sourceWidth, sourceHeight);
  const editedPixels = checkedMultiply(editedWidth, editedHeight);
  if (sourceWidth > MAX_DIMENSION || sourceHeight > MAX_DIMENSION || sourcePixels > MAX_SOURCE_PIXELS) {
    throw new Error(`原图尺寸 ${sourceWidth}x${sourceHeight} 超过桌面贴回上限`);
  }
  if (editedWidth > MAX_DIMENSION || editedHeight > MAX_DIMENSION || editedPixels > MAX_EDITED_PIXELS) {
    throw new Error(`编辑图尺寸 ${editedWidth}x${editedHeight} 超过局部贴回上限`);
  }
  const cropX = finiteInteger(options?.cropX, "cropX");
  const cropY = finiteInteger(options?.cropY, "cropY");
  const cropWidth = finiteInteger(options?.cropWidth, "cropWidth");
  const cropHeight = finiteInteger(options?.cropHeight, "cropHeight");
  if (cropWidth <= 0 || cropHeight <= 0) throw new Error("贴回裁切范围必须大于 0");
  if (cropX < 0 || cropY < 0 || cropX > sourceWidth || cropY > sourceHeight
    || cropWidth > sourceWidth - cropX || cropHeight > sourceHeight - cropY) {
    throw new Error(`贴回裁切范围超出原图边界 (${sourceWidth}×${sourceHeight})`);
  }
  return { cropX, cropY, cropWidth, cropHeight };
}

async function readRaw(input: string | Buffer): Promise<RawImage> {
  const result = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    data: result.data,
    width: result.info.width,
    height: result.info.height,
    channels: result.info.channels,
  };
}

function channelAt(image: RawImage, x: number, y: number, channel: number): number {
  const safeX = clamp(Math.round(x), 0, image.width - 1);
  const safeY = clamp(Math.round(y), 0, image.height - 1);
  return image.data[(safeY * image.width + safeX) * image.channels + channel] ?? 0;
}

function sample(image: RawImage, u: number, v: number): [number, number, number, number] {
  const x = clamp(u, 0, 1) * Math.max(1, image.width - 1);
  const y = clamp(v, 0, 1) * Math.max(1, image.height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const interpolate = (channel: number) => {
    const top = channelAt(image, x0, y0, channel) * (1 - fx) + channelAt(image, x1, y0, channel) * fx;
    const bottom = channelAt(image, x0, y1, channel) * (1 - fx) + channelAt(image, x1, y1, channel) * fx;
    return top * (1 - fy) + bottom * fy;
  };
  return [interpolate(0), interpolate(1), interpolate(2), interpolate(3)];
}

function smoothstep(value: number): number {
  const clamped = clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function maskAlphaAt(mask: RawImage, u: number, v: number, featherPx: number): number {
  if (featherPx <= 0) return sample(mask, u, v)[3] / 255;
  const radiusX = featherPx / Math.max(1, mask.width);
  const radiusY = featherPx / Math.max(1, mask.height);
  const offsets = [
    [-radiusX, -radiusY], [0, -radiusY], [radiusX, -radiusY],
    [-radiusX, 0], [0, 0], [radiusX, 0],
    [-radiusX, radiusY], [0, radiusY], [radiusX, radiusY],
  ];
  const total = offsets.reduce((sum, [x, y]) => sum + sample(mask, u + x, v + y)[3] / 255, 0);
  return smoothstep(total / offsets.length);
}

function adjustColor(r: number, g: number, b: number, options: BrowserPastebackOptions): [number, number, number] {
  const brightness = finiteOrZero(options.brightness) || 1;
  const contrast = finiteOrZero(options.contrast) || 1;
  const adjust = (value: number) => clamp((value * brightness - 128) * contrast + 128, 0, 255);
  let rf = adjust(r);
  let gf = adjust(g);
  let bf = adjust(b);
  const hue = finiteOrZero(options.hueRotationDeg) * Math.PI / 180;
  if (Math.abs(hue) > 1e-6) {
    const cosine = Math.cos(hue);
    const sine = Math.sin(hue);
    [rf, gf, bf] = [
      (0.213 + cosine * 0.787 - sine * 0.213) * rf + (0.715 - cosine * 0.715 - sine * 0.715) * gf + (0.072 - cosine * 0.072 + sine * 0.928) * bf,
      (0.213 - cosine * 0.213 + sine * 0.143) * rf + (0.715 + cosine * 0.285 + sine * 0.140) * gf + (0.072 - cosine * 0.072 - sine * 0.283) * bf,
      (0.213 - cosine * 0.213 - sine * 0.787) * rf + (0.715 - cosine * 0.715 + sine * 0.715) * gf + (0.072 + cosine * 0.928 + sine * 0.072) * bf,
    ];
  }
  return [clamp(rf, 0, 255), clamp(gf, 0, 255), clamp(bf, 0, 255)];
}

/**
 * Browser-development equivalent of the Wails PasteLocalEdit call. It only
 * materializes the selected crop in memory; sharp streams the full source
 * into the final PNG without putting the original image in browser state.
 */
export async function pasteLocalEditFile(
  sourcePath: string,
  editedPath: string,
  outputPath: string,
  options: BrowserPastebackOptions,
): Promise<{ path: string; acceleration: string }> {
  const sourceMeta = await sharp(sourcePath).metadata();
  const editedMeta = await sharp(editedPath).metadata();
  const crop = validateConfig(
    Number(sourceMeta.width || 0),
    Number(sourceMeta.height || 0),
    Number(editedMeta.width || 0),
    Number(editedMeta.height || 0),
    options,
  );

  const sourceWidth = Number(sourceMeta.width || 0);
  const sourceHeight = Number(sourceMeta.height || 0);
  const editedWidth = Number(editedMeta.width || 0);
  const editedHeight = Number(editedMeta.height || 0);
  let maskBytes: Buffer | null = null;
  let maskWidth = 0;
  let maskHeight = 0;
  const rawMask = cleanBase64(options.maskB64 || "");
  if (rawMask) {
    maskBytes = Buffer.from(rawMask, "base64");
    if (maskBytes.length > MAX_MASK_BYTES) throw new Error("蒙版数据过大，请缩小贴回区域后重试");
    const maskMeta = await sharp(maskBytes).metadata();
    maskWidth = Number(maskMeta.width || 0);
    maskHeight = Number(maskMeta.height || 0);
    const maskPixels = checkedMultiply(maskWidth, maskHeight);
    if (!Number.isSafeInteger(maskWidth) || !Number.isSafeInteger(maskHeight)
      || maskWidth <= 0 || maskHeight <= 0 || maskWidth > MAX_DIMENSION || maskHeight > MAX_DIMENSION || maskPixels > MAX_EDITED_PIXELS) {
      throw new Error(`蒙版尺寸 ${maskWidth}x${maskHeight} 超过局部贴回上限`);
    }
  }

  // Read only metadata and complete every hard/memory check before decoding
  // the optional mask or allocating the high-resolution crop buffers.
  const estimate = estimateWorkingBytes(
    sourceWidth,
    sourceHeight,
    editedWidth,
    editedHeight,
    maskWidth,
    maskHeight,
    crop.cropWidth,
    crop.cropHeight,
  );
  if (estimate > MAX_WORKING_BYTES) {
    throw new Error(`贴回所需工作内存过大（估算 ${formatBytes(estimate)}，上限 768MiB），请缩小裁切区域后重试`);
  }

  const mask = maskBytes ? await readRaw(maskBytes) : null;

  const [sourceCrop, edited] = await Promise.all([
    sharp(sourcePath)
      .extract({ left: crop.cropX, top: crop.cropY, width: crop.cropWidth, height: crop.cropHeight })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
    readRaw(editedPath),
  ]);
  // Mutate the single extracted crop buffer in place. Keeping a second full
  // crop copy was enough to reject otherwise valid 85MP source images.
  const outputCrop = sourceCrop.data;
  const editedImage = edited;
  const width = crop.cropWidth;
  const height = crop.cropHeight;
  const scale = Number.isFinite(Number(options.scale)) && Number(options.scale) >= 0.05 ? Number(options.scale) : 1;
  const centerX = crop.cropX + width * (0.5 + finiteOrZero(options.offsetXRatio));
  const centerY = crop.cropY + height * (0.5 + finiteOrZero(options.offsetYRatio));
  const angle = -finiteOrZero(options.rotationDeg) * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const feather = clamp(finiteOrZero(options.featherFraction), 0, 0.5);
  const maskFeather = Math.max(0, finiteOrZero(options.maskFeatherPx));

  for (let localY = 0; localY < height; localY += 1) {
    for (let localX = 0; localX < width; localX += 1) {
      const x = crop.cropX + localX;
      const y = crop.cropY + localY;
      const dx = x + 0.5 - centerX;
      const dy = y + 0.5 - centerY;
      const rx = dx * cosine - dy * sine;
      const ry = dx * sine + dy * cosine;
      const u = rx / (width * scale) + 0.5;
      const v = ry / (height * scale) + 0.5;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      const [r0, g0, b0, a0] = sample(editedImage, u, v);
      let alpha = a0 / 255;
      if (mask) alpha *= maskAlphaAt(mask, u, v, maskFeather);
      const edge = Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v));
      if (feather > 0) alpha *= smoothstep(clamp(edge / feather, 0, 1));
      if (alpha <= 0.000001) continue;
      const [r, g, b] = adjustColor(r0, g0, b0, options);
      const index = (localY * width + localX) * 4;
      outputCrop[index] = Math.trunc(r * alpha + outputCrop[index] * (1 - alpha));
      outputCrop[index + 1] = Math.trunc(g * alpha + outputCrop[index + 1] * (1 - alpha));
      outputCrop[index + 2] = Math.trunc(b * alpha + outputCrop[index + 2] * (1 - alpha));
      outputCrop[index + 3] = 255;
    }
  }

  const temporaryOutputPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.${process.pid}-${Date.now()}-${randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    await fs.rm(temporaryOutputPath, { force: true });
    await sharp(sourcePath)
      .composite([{ input: outputCrop, raw: { width, height, channels: 4 }, left: crop.cropX, top: crop.cropY }])
      .png()
      .toFile(temporaryOutputPath);
    const outputMeta = await sharp(temporaryOutputPath).metadata();
    if (Number(outputMeta.width || 0) !== sourceWidth || Number(outputMeta.height || 0) !== sourceHeight) {
      throw new Error("贴回输出尺寸与原图不一致");
    }
    await fs.rename(temporaryOutputPath, outputPath);
  } catch (error) {
    await fs.rm(temporaryOutputPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return { path: outputPath, acceleration: "node-sharp" };
}
