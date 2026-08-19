import type { LocalEditPlanarRoundtripRef, PanoramaPastebackAlignment } from "../types/domain";
import {
  panoramaPastebackMaskAlphaAt,
  panoramaRoundtripFeatherMaskAt,
} from "../panorama/core.ts";

export type LocalPastebackMaskInput = {
  image: CanvasImageSource;
  featherPx?: number | null;
};

export type RGBAImage = { width: number; height: number; data: Uint8ClampedArray };

export const LOCAL_EDIT_MAX_PIXELS = 64_000_000;
export const LOCAL_EDIT_MAX_SOURCE_PIXELS = 100_000_000;
export const LOCAL_EDIT_MAX_DIMENSION = 16_384;
export const LOCAL_EDIT_MAX_WORKING_BYTES = 768 * 1024 * 1024;

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function imageToPixels(source: CanvasImageSource): RGBAImage {
  const width = Number((source as HTMLImageElement).naturalWidth || (source as HTMLCanvasElement).width || 0);
  const height = Number((source as HTMLImageElement).naturalHeight || (source as HTMLCanvasElement).height || 0);
  if (width <= 0 || height <= 0) throw new Error("无法读取图片尺寸");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("无法读取图片像素");
  ctx.drawImage(source, 0, 0, width, height);
  return { width, height, data: ctx.getImageData(0, 0, width, height).data };
}

function writePixelsToBase64(image: RGBAImage): string {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建输出画布");
  const next = ctx.createImageData(image.width, image.height);
  next.data.set(image.data);
  ctx.putImageData(next, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function sample(image: RGBAImage, x: number, y: number): [number, number, number, number] {
  const px = clamp(x, 0, image.width - 1);
  const py = clamp(y, 0, image.height - 1);
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const fx = px - x0;
  const fy = py - y0;
  const offset = (ix: number, iy: number) => (iy * image.width + ix) * 4;
  const a = offset(x0, y0);
  const b = offset(x1, y0);
  const c = offset(x0, y1);
  const d = offset(x1, y1);
  return [0, 1, 2, 3].map((channel) => {
    const top = image.data[a + channel] * (1 - fx) + image.data[b + channel] * fx;
    const bottom = image.data[c + channel] * (1 - fx) + image.data[d + channel] * fx;
    return top * (1 - fy) + bottom * fy;
  }) as [number, number, number, number];
}

function colorAdjust(rgba: [number, number, number, number], alignment?: PanoramaPastebackAlignment | null) {
  const brightness = alignment?.brightness ?? 1;
  const contrast = alignment?.contrast ?? 1;
  const hue = (alignment?.hueRotationDeg ?? 0) * Math.PI / 180;
  let r = clamp((rgba[0] * brightness - 128) * contrast + 128, 0, 255);
  let g = clamp((rgba[1] * brightness - 128) * contrast + 128, 0, 255);
  let b = clamp((rgba[2] * brightness - 128) * contrast + 128, 0, 255);
  if (Math.abs(hue) > 1e-6) {
    const cos = Math.cos(hue);
    const sin = Math.sin(hue);
    const nextR = (0.213 + cos * 0.787 - sin * 0.213) * r + (0.715 - cos * 0.715 - sin * 0.715) * g + (0.072 - cos * 0.072 + sin * 0.928) * b;
    const nextG = (0.213 - cos * 0.213 + sin * 0.143) * r + (0.715 + cos * 0.285 + sin * 0.140) * g + (0.072 - cos * 0.072 - sin * 0.283) * b;
    const nextB = (0.213 - cos * 0.213 - sin * 0.787) * r + (0.715 - cos * 0.715 + sin * 0.715) * g + (0.072 + cos * 0.928 + sin * 0.072) * b;
    r = clamp(nextR, 0, 255);
    g = clamp(nextG, 0, 255);
    b = clamp(nextB, 0, 255);
  }
  return [r, g, b] as [number, number, number];
}

export function validateLocalEditDimensions(width: number, height: number) {
  const w = Math.floor(Number(width));
  const h = Math.floor(Number(height));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) {
    throw new Error("无法读取图片尺寸");
  }
  if (w > LOCAL_EDIT_MAX_DIMENSION || h > LOCAL_EDIT_MAX_DIMENSION || w * h > LOCAL_EDIT_MAX_PIXELS) {
    throw new Error(`图片尺寸 ${w}x${h} 超过裁切局部重绘上限（单边 ${LOCAL_EDIT_MAX_DIMENSION}px，${LOCAL_EDIT_MAX_PIXELS / 1_000_000}MP）`);
  }
  return { width: w, height: h };
}

export function validateLocalEditSourceDimensions(width: number, height: number) {
  const w = Math.floor(Number(width));
  const h = Math.floor(Number(height));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) {
    throw new Error("无法读取图片尺寸");
  }
  if (w > LOCAL_EDIT_MAX_DIMENSION || h > LOCAL_EDIT_MAX_DIMENSION || w * h > LOCAL_EDIT_MAX_SOURCE_PIXELS) {
    throw new Error(`原图尺寸 ${w}x${h} 超过裁切局部重绘上限（单边 ${LOCAL_EDIT_MAX_DIMENSION}px，${LOCAL_EDIT_MAX_SOURCE_PIXELS / 1_000_000}MP）`);
  }
  return { width: w, height: h };
}

export function mapPlanarPastebackSample(
  destinationX: number,
  destinationY: number,
  crop: LocalEditPlanarRoundtripRef["cropRect"],
  editedWidth: number,
  editedHeight: number,
  expectedWidth: number,
  expectedHeight: number,
  alignment?: PanoramaPastebackAlignment | null,
) {
  const normalized = alignment ?? { offsetXRatio: 0, offsetYRatio: 0, scale: 1, rotationDeg: 0 };
  // The crop rectangle defines the physical pasteback bounds.  Edited output
  // dimensions only affect which source pixels are sampled, just like the
  // panorama pasteback mapper; a high-resolution result must not enlarge the
  // selected region on the source image.
  const baseWidth = Math.max(1, Number(crop.width || expectedWidth || 1));
  const baseHeight = Math.max(1, Number(crop.height || expectedHeight || 1));
  const centerX = crop.x + crop.width * (0.5 + normalized.offsetXRatio);
  const centerY = crop.y + crop.height * (0.5 + normalized.offsetYRatio);
  const dx = destinationX - centerX;
  const dy = destinationY - centerY;
  const angle = -(Number(normalized.rotationDeg) || 0) * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  const scale = Math.max(0.05, Number(normalized.scale) || 1);
  const u = rx / (baseWidth * scale) + 0.5;
  const v = ry / (baseHeight * scale) + 0.5;
  return {
    x: u * (editedWidth - 1),
    y: v * (editedHeight - 1),
    u,
    v,
    inside: u >= 0 && u <= 1 && v >= 0 && v <= 1,
  };
}

export function composePlanarRoundtripPixels(
  source: RGBAImage,
  edited: RGBAImage,
  roundtrip: LocalEditPlanarRoundtripRef,
  alignment?: PanoramaPastebackAlignment | null,
  mask?: RGBAImage | null,
): RGBAImage {
  validateLocalEditDimensions(source.width, source.height);
  validateLocalEditDimensions(edited.width, edited.height);
  const estimatedBytes = (source.width * source.height + edited.width * edited.height) * 4 * 2;
  if (estimatedBytes > LOCAL_EDIT_MAX_WORKING_BYTES) throw new Error("裁切局部重绘需要的内存超过当前上限，请缩小选择区域后重试");
  const output = new Uint8ClampedArray(source.data);
  const crop = roundtrip.cropRect;
  const normalized = alignment ?? { offsetXRatio: 0, offsetYRatio: 0, scale: 1 };
  // Bound the work loop to the crop-sized overlay.  The edited bitmap may be
  // any resolution or aspect, but its default physical footprint is exactly
  // the original crop; explicit alignment scale/translation can expand it.
  const overlayWidth = Math.max(1, crop.width) * Math.max(0.05, Number(normalized.scale) || 1);
  const overlayHeight = Math.max(1, crop.height) * Math.max(0.05, Number(normalized.scale) || 1);
  const centerX = crop.x + crop.width * (0.5 + (Number(normalized.offsetXRatio) || 0));
  const centerY = crop.y + crop.height * (0.5 + (Number(normalized.offsetYRatio) || 0));
  const radius = Math.hypot(overlayWidth, overlayHeight) * 0.5 + 2;
  const minX = Math.max(0, Math.floor(centerX - radius));
  const maxX = Math.min(source.width, Math.ceil(centerX + radius));
  const minY = Math.max(0, Math.floor(centerY - radius));
  const maxY = Math.min(source.height, Math.ceil(centerY + radius));
  const feather = clamp(alignment?.featherFraction ?? 0.1, 0, 0.5);
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      const mapped = mapPlanarPastebackSample(x + 0.5, y + 0.5, crop, edited.width, edited.height, roundtrip.editWidth, roundtrip.editHeight, alignment);
      if (!mapped.inside) continue;
      const rgba = sample(edited, mapped.x, mapped.y);
      const maskAlpha = mask ? panoramaPastebackMaskAlphaAt(mask, mapped.u, mapped.v) : 1;
      const featherAlpha = panoramaRoundtripFeatherMaskAt(mapped.u, mapped.v, feather);
      const alpha = (rgba[3] / 255) * maskAlpha * featherAlpha;
      if (alpha <= 1e-6) continue;
      const [r, g, b] = colorAdjust(rgba, alignment);
      const offset = (y * source.width + x) * 4;
      output[offset] = r * alpha + output[offset] * (1 - alpha);
      output[offset + 1] = g * alpha + output[offset + 1] * (1 - alpha);
      output[offset + 2] = b * alpha + output[offset + 2] * (1 - alpha);
      output[offset + 3] = 255;
    }
  }
  return { width: source.width, height: source.height, data: output };
}

export function pastePlanarRoundtripBase64(
  sourceImage: CanvasImageSource,
  editedImage: CanvasImageSource,
  roundtrip: LocalEditPlanarRoundtripRef,
  alignment?: PanoramaPastebackAlignment | null,
  pasteMask?: LocalPastebackMaskInput | null,
) {
  const source = imageToPixels(sourceImage);
  const edited = imageToPixels(editedImage);
  const mask = pasteMask?.image ? imageToPixels(pasteMask.image) : null;
  const pasted = composePlanarRoundtripPixels(source, edited, roundtrip, alignment, mask);
  return { imageB64: writePixelsToBase64(pasted), width: pasted.width, height: pasted.height };
}

export function exportPlanarCutoutBase64(
  sourceImage: CanvasImageSource,
  roundtrip: LocalEditPlanarRoundtripRef,
) {
  const source = imageToPixels(sourceImage);
  const x = Math.max(0, Math.floor(roundtrip.cropRect.x));
  const y = Math.max(0, Math.floor(roundtrip.cropRect.y));
  const width = Math.max(1, Math.min(source.width - x, Math.floor(roundtrip.cropRect.width)));
  const height = Math.max(1, Math.min(source.height - y, Math.floor(roundtrip.cropRect.height)));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((y + row) * source.width + x) * 4;
    data.set(source.data.slice(sourceStart, sourceStart + width * 4), row * width * 4);
  }
  return { imageB64: writePixelsToBase64({ width, height, data }), width, height };
}
