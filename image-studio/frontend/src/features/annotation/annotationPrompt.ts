import type { Annotation } from "./annotationTypes.ts";
import { annotationBounds } from "./annotationGeometry.ts";
import { getImageDimensions, getImageDimensionsFromBlob } from "../../lib/images.ts";

type ImageDims = { w: number; h: number } | null | undefined;

export type AnnotationDimensionSource = {
  imageBlob?: Blob | null;
  imageB64?: string | null;
  fullUrl?: string | null;
  width?: number;
  height?: number;
  previewWidth?: number;
  previewHeight?: number;
};

function finiteDims(width: unknown, height: unknown): { w: number; h: number } | null {
  const w = Number(width);
  const h = Number(height);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w, h } : null;
}

/** Resolve the dimensions used by annotation coordinates without preferring a thumbnail. */
export async function resolveAnnotationImageDimensions(
  source: AnnotationDimensionSource | null | undefined,
): Promise<{ w: number; h: number } | null> {
  if (!source) return null;
  const mediaDims = await getImageDimensions(source);
  if (mediaDims) return mediaDims;
  const fullUrl = String(source.fullUrl || "").trim();
  if (fullUrl && typeof fetch === "function") {
    try {
      const response = await fetch(fullUrl, { headers: { Range: "bytes=0-262143" } });
      if (response.ok) {
        const fullMediaDims = await getImageDimensionsFromBlob(await response.blob());
        if (fullMediaDims) return fullMediaDims;
      }
    } catch {
      // A native-only media URL can be unreadable in the browser; use trusted metadata next.
    }
  }
  return finiteDims(source.width, source.height) ?? finiteDims(source.previewWidth, source.previewHeight);
}

function positionLabel(x: number, y: number): string {
  const horizontal = x < 0.34 ? "左" : x > 0.66 ? "右" : "中";
  const vertical = y < 0.34 ? "上" : y > 0.66 ? "下" : "中";
  return `${vertical}${horizontal}`;
}

function normalizedPoint(x: number, y: number, dims: ImageDims) {
  if (!dims || dims.w <= 0 || dims.h <= 0) return null;
  return { x: Math.max(0, Math.min(1, x / dims.w)), y: Math.max(0, Math.min(1, y / dims.h)) };
}

function describeAnnotation(annotation: Annotation, index: number, dims: ImageDims): string {
  const bounds = annotationBounds(annotation);
  const center = normalizedPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, dims);
  const location = center ? `${positionLabel(center.x, center.y)}部` : "图中对应位置";
  const text = annotation.text?.trim();
  if (annotation.kind === "arrow") {
    const tip = normalizedPoint(annotation.x + (annotation.width ?? 0), annotation.y + (annotation.height ?? 0), dims);
    const tipText = tip ? `箭头尖端坐标约为 (${tip.x.toFixed(3)}, ${tip.y.toFixed(3)})` : "箭头尖端指向对应区域";
    return `${index}. 批注箭头指向${location}；${tipText}${text ? `；批注内容：“${text}”` : ""}。`;
  }
  if (annotation.kind === "text") {
    return `${index}. 文字批注位于${location}${text ? `，内容为：“${text}”` : ""}。`;
  }
  if (annotation.kind === "rect" || annotation.kind === "ellipse") {
    return `${index}. ${annotation.kind === "rect" ? "矩形" : "椭圆"}标注区域位于${location}，请重点处理该区域${text ? `（说明：“${text}”）` : ""}。`;
  }
  if (annotation.kind === "highlight") {
    return `${index}. 高亮标注强调${location}，请重点检查该区域${text ? `（说明：“${text}”）` : ""}。`;
  }
  if (annotation.kind === "line") {
    return `${index}. 直线标注指向${location}${text ? `，说明：“${text}”` : ""}。`;
  }
  return `${index}. 自由笔迹标注覆盖${location}${text ? `，说明：“${text}”` : ""}。`;
}

export function serializeAnnotationsForPrompt(annotations: Annotation[], dims: ImageDims): string {
  const visible = annotations.filter((annotation) => annotation.kind !== "text" || annotation.text?.trim());
  if (!visible.length) return "";
  const details = visible.map((annotation, index) => describeAnnotation(annotation, index + 1, dims)).join("\n");
  return [
    "请严格按照下面的图像批注修改当前原图：",
    details,
    "保持主体、构图、视角、比例和所有未标注区域不变。",
    "输出干净的最终图片，移除所有箭头、文字、矩形、椭圆、自由笔迹、高亮、选择框和工具栏等批注痕迹。",
  ].join("\n");
}

export function augmentPromptWithAnnotationSemantics(prompt: string, annotations: Annotation[], dims: ImageDims): string {
  const suffix = serializeAnnotationsForPrompt(annotations, dims);
  return suffix ? `${prompt.trim()}\n${suffix}`.trim() : prompt;
}
