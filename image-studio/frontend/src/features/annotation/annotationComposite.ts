import type { Annotation } from "./annotationTypes.ts";
import {
  annotationArrowHeadSize,
  annotationFontSize,
  annotationLabelPosition,
  annotationStrokeWidth,
} from "./annotationTypes.ts";

export type AnnotationOverflowMode = "strict" | "expand-white";

export type AnnotationRasterSource = {
  blob: Blob;
};

export type AnnotationRect = { x: number; y: number; width: number; height: number };

export type AnnotationCompositePlan = {
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
  offsetX: number;
  offsetY: number;
  bounds: AnnotationRect;
  overflow: boolean;
  estimatedMemoryBytes: number;
};

export type AnnotationCompositeResult = AnnotationCompositePlan & {
  blob: Blob;
  expanded: boolean;
};

export const ANNOTATION_COMPOSITE_MAX_PIXELS = 100_000_000;
export const ANNOTATION_COMPOSITE_MAX_SIDE = 16_384;
export const ANNOTATION_COMPOSITE_MEMORY_LIMIT = 768 * 1024 * 1024;
export const ANNOTATION_COMPOSITE_SAFETY_MARGIN = 24;

export class AnnotationCompositeOverflowError extends Error {
  readonly plan: AnnotationCompositePlan;

  constructor(plan: AnnotationCompositePlan) {
    super("标注超出原图边缘");
    this.name = "AnnotationCompositeOverflowError";
    this.plan = plan;
  }
}

function finite(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizedRect(annotation: Annotation): AnnotationRect {
  const width = finite(annotation.width);
  const height = finite(annotation.height);
  return {
    x: Math.min(finite(annotation.x), finite(annotation.x) + width),
    y: Math.min(finite(annotation.y), finite(annotation.y) + height),
    width: Math.abs(width),
    height: Math.abs(height),
  };
}

function rectFromPoints(points: number[]): AnnotationRect {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let index = 0; index + 1 < points.length; index += 2) {
    xs.push(finite(points[index]));
    ys.push(finite(points[index + 1]));
  }
  if (xs.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function unionRect(a: AnnotationRect, b: AnnotationRect): AnnotationRect {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function padRect(rect: AnnotationRect, padding: number): AnnotationRect {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

function arrowControlPoint(annotation: Annotation): { x: number; y: number } {
  const start = { x: finite(annotation.x), y: finite(annotation.y) };
  const end = { x: start.x + finite(annotation.width), y: start.y + finite(annotation.height) };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const bend = finite(annotation.bend);
  return {
    x: (start.x + end.x) / 2 + (-dy / length) * bend,
    y: (start.y + end.y) / 2 + (dx / length) * bend,
  };
}

function quadraticPoint(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, t: number) {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * a.x + 2 * inverse * t * b.x + t * t * c.x,
    y: inverse * inverse * a.y + 2 * inverse * t * b.y + t * t * c.y,
  };
}

function arrowBounds(annotation: Annotation): AnnotationRect {
  const start = { x: finite(annotation.x), y: finite(annotation.y) };
  const end = { x: start.x + finite(annotation.width), y: start.y + finite(annotation.height) };
  const control = arrowControlPoint(annotation);
  let bounds: AnnotationRect = { x: start.x, y: start.y, width: 0, height: 0 };
  for (let index = 1; index <= 24; index += 1) {
    const point = quadraticPoint(start, control, end, index / 24);
    bounds = unionRect(bounds, { x: point.x, y: point.y, width: 0, height: 0 });
  }
  const stroke = annotationStrokeWidth(annotation, 3);
  bounds = padRect(bounds, Math.max(stroke / 2, annotationArrowHeadSize(stroke) / 2) + 1);
  const text = String(annotation.text || "").trim();
  if (text) {
    const fontSize = annotationFontSize(annotation);
    const label = annotationLabelPosition(annotation);
    bounds = unionRect(bounds, textBounds(label.x, label.y, text, fontSize));
  }
  return bounds;
}

function textBounds(x: number, y: number, text: string, fontSize: number): AnnotationRect {
  const lines = text.split(/\r?\n/);
  const width = Math.max(1, ...lines.map((line) => line.length * fontSize * 0.62)) + 4;
  const height = Math.max(1, lines.length * fontSize * 1.2) + 4;
  return { x, y, width, height };
}

export function annotationVisualBounds(annotation: Annotation): AnnotationRect {
  if (annotation.kind === "freehand" || annotation.kind === "highlight") {
    const points = rectFromPoints(annotation.points ?? []);
    const stroke = annotationStrokeWidth(annotation, annotation.kind === "highlight" ? 18 : 3);
    return padRect(points, Math.max(1, stroke / 2));
  }
  if (annotation.kind === "arrow") return arrowBounds(annotation);
  if (annotation.kind === "line") {
    const rect = normalizedRect(annotation);
    const stroke = annotationStrokeWidth(annotation, 3);
    return padRect(rect, Math.max(1, stroke / 2));
  }
  if (annotation.kind === "text") {
    return textBounds(finite(annotation.x), finite(annotation.y), String(annotation.text || ""), annotationFontSize(annotation));
  }
  const rect = normalizedRect(annotation);
  const stroke = annotationStrokeWidth(annotation, 3);
  return padRect(rect, Math.max(1, stroke / 2));
}

export function buildAnnotationCompositePlan(
  sourceWidth: number,
  sourceHeight: number,
  annotations: Annotation[],
  mode: AnnotationOverflowMode,
  sourceBytes = 0,
): AnnotationCompositePlan {
  const width = Math.floor(finite(sourceWidth));
  const height = Math.floor(finite(sourceHeight));
  if (width <= 0 || height <= 0) throw new Error("无法确认原图自然像素尺寸");
  const bounds = annotations.reduce<AnnotationRect | null>((current, annotation) => {
    const next = annotationVisualBounds(annotation);
    return current ? unionRect(current, next) : next;
  }, null) ?? { x: 0, y: 0, width: width, height: height };
  const overflow = bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > width || bounds.y + bounds.height > height;
  const offsetX = mode === "expand-white" ? Math.max(0, Math.ceil(-bounds.x + ANNOTATION_COMPOSITE_SAFETY_MARGIN)) : 0;
  const offsetY = mode === "expand-white" ? Math.max(0, Math.ceil(-bounds.y + ANNOTATION_COMPOSITE_SAFETY_MARGIN)) : 0;
  const right = mode === "expand-white" ? Math.max(0, Math.ceil(bounds.x + bounds.width - width + ANNOTATION_COMPOSITE_SAFETY_MARGIN)) : 0;
  const bottom = mode === "expand-white" ? Math.max(0, Math.ceil(bounds.y + bounds.height - height + ANNOTATION_COMPOSITE_SAFETY_MARGIN)) : 0;
  const outputWidth = width + offsetX + right;
  const outputHeight = height + offsetY + bottom;
  const estimatedMemoryBytes = (width * height + outputWidth * outputHeight) * 4 + Math.max(0, sourceBytes) * 2 + 32 * 1024 * 1024;
  if (width > ANNOTATION_COMPOSITE_MAX_SIDE || height > ANNOTATION_COMPOSITE_MAX_SIDE
    || outputWidth > ANNOTATION_COMPOSITE_MAX_SIDE || outputHeight > ANNOTATION_COMPOSITE_MAX_SIDE) {
    throw new Error(`标注合成尺寸超过 ${ANNOTATION_COMPOSITE_MAX_SIDE}px 单边上限`);
  }
  if (width * height > ANNOTATION_COMPOSITE_MAX_PIXELS || outputWidth * outputHeight > ANNOTATION_COMPOSITE_MAX_PIXELS) {
    throw new Error("标注合成像素数超过 100MP 上限");
  }
  if (estimatedMemoryBytes > ANNOTATION_COMPOSITE_MEMORY_LIMIT) {
    throw new Error("标注合成预计工作内存超过 768MiB，已阻止分配");
  }
  return {
    sourceWidth: width,
    sourceHeight: height,
    outputWidth,
    outputHeight,
    offsetX,
    offsetY,
    bounds,
    overflow,
    estimatedMemoryBytes,
  };
}

type CanvasLike = HTMLCanvasElement | OffscreenCanvas;
type ContextLike = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function createCanvas(width: number, height: number): CanvasLike {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error("当前环境不支持标注图像合成");
}

function getContext(canvas: CanvasLike): ContextLike {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建标注合成画布");
  return context as ContextLike;
}

function drawText(context: ContextLike, x: number, y: number, text: string, color: string, fontSize: number, opacity: number) {
  context.save();
  context.globalAlpha = opacity;
  context.fillStyle = color;
  context.font = `${fontSize}px Arial, sans-serif`;
  context.textBaseline = "top";
  context.textAlign = "left";
  text.split(/\r?\n/).forEach((line, index) => context.fillText(line, x, y + index * fontSize * 1.2));
  context.restore();
}

function drawArrow(context: ContextLike, annotation: Annotation, offsetX: number, offsetY: number) {
  const start = { x: annotation.x + offsetX, y: annotation.y + offsetY };
  const end = { x: annotation.x + finite(annotation.width) + offsetX, y: annotation.y + finite(annotation.height) + offsetY };
  const control = arrowControlPoint(annotation);
  control.x += offsetX;
  control.y += offsetY;
  const stroke = annotationStrokeWidth(annotation, 3);
  const opacity = finite(annotation.opacity, 1);
  context.save();
  context.globalAlpha = opacity;
  context.strokeStyle = annotation.color;
  context.fillStyle = annotation.color;
  context.lineWidth = stroke;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.quadraticCurveTo(control.x, control.y, end.x, end.y);
  context.stroke();
  const angle = Math.atan2(end.y - control.y, end.x - control.x);
  const length = annotationArrowHeadSize(stroke);
  const halfWidth = length / 2;
  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(end.x - length * Math.cos(angle) + halfWidth * Math.sin(angle), end.y - length * Math.sin(angle) - halfWidth * Math.cos(angle));
  context.lineTo(end.x - length * Math.cos(angle) - halfWidth * Math.sin(angle), end.y - length * Math.sin(angle) + halfWidth * Math.cos(angle));
  context.closePath();
  context.fill();
  context.restore();
  if (annotation.text?.trim()) {
    const fontSize = annotationFontSize(annotation);
    const label = annotationLabelPosition(annotation);
    drawText(context, label.x + offsetX, label.y + offsetY, annotation.text.trim(), annotation.color, fontSize, opacity);
  }
}

function drawAnnotation(context: ContextLike, annotation: Annotation, offsetX: number, offsetY: number) {
  const opacity = finite(annotation.opacity, annotation.kind === "highlight" ? 0.32 : 1);
  const stroke = annotationStrokeWidth(annotation, annotation.kind === "highlight" ? 18 : 3);
  context.save();
  context.globalAlpha = opacity;
  context.strokeStyle = annotation.color;
  context.fillStyle = annotation.color;
  context.lineWidth = stroke;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (annotation.kind === "arrow") {
    context.restore();
    drawArrow(context, annotation, offsetX, offsetY);
    return;
  }
  if (annotation.kind === "line") {
    context.beginPath();
    context.moveTo(annotation.x + offsetX, annotation.y + offsetY);
    context.lineTo(annotation.x + finite(annotation.width) + offsetX, annotation.y + finite(annotation.height) + offsetY);
    context.stroke();
  } else if (annotation.kind === "rect") {
    const rect = normalizedRect(annotation);
    context.strokeRect(rect.x + offsetX, rect.y + offsetY, rect.width, rect.height);
  } else if (annotation.kind === "ellipse") {
    const rect = normalizedRect(annotation);
    context.beginPath();
    context.ellipse(rect.x + offsetX + rect.width / 2, rect.y + offsetY + rect.height / 2, Math.max(0.5, rect.width / 2), Math.max(0.5, rect.height / 2), 0, 0, Math.PI * 2);
    context.stroke();
  } else if (annotation.kind === "freehand" || annotation.kind === "highlight") {
    const points = annotation.points ?? [];
    if (points.length >= 2) {
      context.beginPath();
      context.moveTo(points[0] + offsetX, points[1] + offsetY);
      for (let index = 2; index + 1 < points.length; index += 2) {
        context.lineTo(points[index] + offsetX, points[index + 1] + offsetY);
      }
      context.stroke();
    }
  } else if (annotation.kind === "text" && annotation.text?.trim()) {
    context.restore();
    drawText(context, annotation.x + offsetX, annotation.y + offsetY, annotation.text.trim(), annotation.color, annotationFontSize(annotation), opacity);
    return;
  }
  context.restore();
}

async function decodeSource(blob: Blob): Promise<{ image: ImageBitmap | HTMLImageElement; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Fall back to an HTML image below when the browser cannot create a bitmap.
    }
  }
  if (typeof document === "undefined") throw new Error("当前环境无法解码原图");
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("无法解码原图"));
      element.src = url;
    });
    return { image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function canvasBlob(canvas: CanvasLike): Promise<Blob> {
  if ("convertToBlob" in canvas && typeof canvas.convertToBlob === "function") {
    return canvas.convertToBlob({ type: "image/png" });
  }
  return new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法编码标注合成图")), "image/png");
  });
}

export async function composeAnnotationImage(
  source: AnnotationRasterSource,
  annotations: Annotation[],
  mode: AnnotationOverflowMode,
): Promise<AnnotationCompositeResult> {
  if (!source?.blob) throw new Error("缺少原图数据，已阻止标注合成");
  const decoded = await decodeSource(source.blob);
  let plan: AnnotationCompositePlan;
  try {
    plan = buildAnnotationCompositePlan(decoded.width, decoded.height, annotations, mode, source.blob.size);
    if (mode === "strict" && plan.overflow) throw new AnnotationCompositeOverflowError(plan);
    const canvas = createCanvas(plan.outputWidth, plan.outputHeight);
    const context = getContext(canvas);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, plan.outputWidth, plan.outputHeight);
    context.drawImage(decoded.image as CanvasImageSource, plan.offsetX, plan.offsetY, plan.sourceWidth, plan.sourceHeight);
    annotations.forEach((annotation) => drawAnnotation(context, annotation, plan.offsetX, plan.offsetY));
    const blob = await canvasBlob(canvas);
    return { ...plan, blob, expanded: mode === "expand-white" && (plan.offsetX > 0 || plan.offsetY > 0 || plan.outputWidth !== plan.sourceWidth || plan.outputHeight !== plan.sourceHeight) };
  } finally {
    decoded.close();
  }
}
