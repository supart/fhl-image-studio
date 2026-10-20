import type { SizeValue } from "../../types/domain";

/**
 * Annotation is a reference-image operation, not a full-resolution archive.
 * Keep the source's natural aspect while bounding the temporary workbench
 * image to the desktop 4K ceiling. Smaller sources are never upscaled.
 */
export const ANNOTATION_SOURCE_MAX_EDGE = 3840;
export const ANNOTATION_SOURCE_TARGET_RESOLUTION = "4k" as const;

export interface AnnotationSourceTarget {
  width: number;
  height: number;
  resolution: typeof ANNOTATION_SOURCE_TARGET_RESOLUTION;
  size: SizeValue;
  scaled: boolean;
}

export interface AnnotationSourceSession {
  sourceHistoryId: string;
  blob: Blob;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  targetResolution: typeof ANNOTATION_SOURCE_TARGET_RESOLUTION;
  targetSize: SizeValue;
}

function positiveDimension(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function annotationSourceTargetDimensions(
  width: number,
  height: number,
  maxEdge = ANNOTATION_SOURCE_MAX_EDGE,
): AnnotationSourceTarget {
  const sourceWidth = positiveDimension(width);
  const sourceHeight = positiveDimension(height);
  const edge = Math.max(1, positiveDimension(maxEdge) || ANNOTATION_SOURCE_MAX_EDGE);
  if (!sourceWidth || !sourceHeight) {
    throw new Error("无法确认标注源图像尺寸");
  }
  const scale = Math.min(1, edge / Math.max(sourceWidth, sourceHeight));
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
  return {
    width: targetWidth,
    height: targetHeight,
    resolution: ANNOTATION_SOURCE_TARGET_RESOLUTION,
    size: `${targetWidth}x${targetHeight}` as SizeValue,
    scaled: targetWidth !== sourceWidth || targetHeight !== sourceHeight,
  };
}

type DecodedSource = {
  image: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

async function decodeSource(blob: Blob): Promise<DecodedSource> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      return {
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Fall through to an HTMLImageElement for SVG/data-url fixtures and
      // browsers without ImageBitmap support for the source format.
    }
  }
  if (typeof document === "undefined" || typeof URL === "undefined") {
    throw new Error("当前环境无法解码标注源图像");
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.decoding = "async";
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("无法解码标注源图像"));
      element.src = url;
    });
    return {
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function canvasBlob(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Blob> {
  if ("convertToBlob" in canvas && typeof canvas.convertToBlob === "function") {
    return canvas.convertToBlob({ type: "image/png" });
  }
  const blob = await new Promise<Blob | null>((resolve) => {
    (canvas as HTMLCanvasElement).toBlob(resolve, "image/png");
  });
  if (!blob) throw new Error("标注源压缩失败，无法读取 PNG 数据");
  return blob;
}

export async function prepareAnnotationSourceBlob(blob: Blob): Promise<{
  blob: Blob;
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
  targetSize: SizeValue;
}> {
  if (!blob || blob.size <= 0) throw new Error("标注源图像为空");
  const decoded = await decodeSource(blob);
  const target = annotationSourceTargetDimensions(decoded.width, decoded.height);
  if (!target.scaled) {
    decoded.close();
    return {
      blob,
      originalWidth: decoded.width,
      originalHeight: decoded.height,
      width: decoded.width,
      height: decoded.height,
      targetSize: target.size,
    };
  }

  let canvas: OffscreenCanvas | HTMLCanvasElement;
  if (typeof OffscreenCanvas === "function") {
    canvas = new OffscreenCanvas(target.width, target.height);
  } else if (typeof document !== "undefined") {
    const element = document.createElement("canvas");
    element.width = target.width;
    element.height = target.height;
    canvas = element;
  } else {
    decoded.close();
    throw new Error("当前环境无法创建标注压缩画布");
  }
  const context = canvas.getContext("2d");
  if (!context) {
    decoded.close();
    throw new Error("当前环境无法创建标注压缩上下文");
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(decoded.image, 0, 0, target.width, target.height);
  const result = await canvasBlob(canvas);
  const originalWidth = decoded.width;
  const originalHeight = decoded.height;
  decoded.close();
  return {
    blob: result,
    originalWidth,
    originalHeight,
    width: target.width,
    height: target.height,
    targetSize: target.size,
  };
}
