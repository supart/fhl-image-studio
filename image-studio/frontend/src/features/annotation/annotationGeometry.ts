import {
  annotationFontSize,
  annotationLabelPosition,
  annotationStrokeWidth,
  clampAnnotationFontSize,
  type Annotation,
  type AnnotationPointer,
} from "./annotationTypes.ts";

export type AnnotationTransformHandle = "nw" | "ne" | "se" | "sw" | "start" | "end";
export type AnnotationTransformHandlePoint = {
  handle: AnnotationTransformHandle;
  x: number;
  y: number;
};

export type AnnotationRect = { x: number; y: number; width: number; height: number };

export const ANNOTATION_MIN_LENGTH = 8;
export const ANNOTATION_BEND_RATIO = 0.12;
export const ANNOTATION_MIN_BEND = 16;
export const ANNOTATION_MAX_BEND = 48;

export function distance(a: AnnotationPointer, b: AnnotationPointer): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function getDefaultAnnotationArrowBend(dx: number, dy: number, scale = 1): number {
  const length = Math.hypot(dx, dy);
  if (!length) return 0;
  const bend = Math.min(
    Math.max(length * ANNOTATION_BEND_RATIO, ANNOTATION_MIN_BEND * scale),
    ANNOTATION_MAX_BEND * scale,
  );
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? -bend : bend;
  return bend;
}

export function annotationBounds(annotation: Annotation) {
  if (annotation.kind === "freehand" || annotation.kind === "highlight") {
    const points = annotation.points ?? [];
    const xs = points.filter((_, index) => index % 2 === 0);
    const ys = points.filter((_, index) => index % 2 === 1);
    if (!xs.length || !ys.length) return { x: annotation.x, y: annotation.y, width: 0, height: 0 };
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
  if (annotation.kind === "arrow" || annotation.kind === "line") {
    const x2 = annotation.x + (annotation.width ?? 0);
    const y2 = annotation.y + (annotation.height ?? 0);
    return {
      x: Math.min(annotation.x, x2),
      y: Math.min(annotation.y, y2),
      width: Math.abs(x2 - annotation.x),
      height: Math.abs(y2 - annotation.y),
    };
  }
  const width = annotation.width ?? 0;
  const height = annotation.height ?? 0;
  return {
    x: width < 0 ? annotation.x + width : annotation.x,
    y: height < 0 ? annotation.y + height : annotation.y,
    width: Math.abs(width),
    height: Math.abs(height),
  };
}

/**
 * Returns the visual box used by pointer transform handles. Text has no
 * persisted width/height, so use a bounded estimate based on its pixel font.
 */
export function annotationTransformBounds(annotation: Annotation): AnnotationRect {
  const bounds = annotationBounds(annotation);
  if (annotation.kind === "text") {
    const fontSize = annotationFontSize(annotation);
    const text = annotation.text?.trim() ?? "";
    return {
      x: annotation.x,
      y: annotation.y,
      width: Math.max(32, text.length * fontSize * 0.62),
      height: Math.max(24, fontSize * 1.3),
    };
  }
  return {
    ...bounds,
    width: Math.max(8, bounds.width),
    height: Math.max(8, bounds.height),
  };
}

export function annotationTransformHandles(annotation: Annotation): AnnotationTransformHandlePoint[] {
  if (annotation.kind === "line" || annotation.kind === "arrow") {
    return [
      { handle: "start", x: annotation.x, y: annotation.y },
      { handle: "end", x: annotation.x + (annotation.width ?? 0), y: annotation.y + (annotation.height ?? 0) },
    ];
  }
  const bounds = annotationTransformBounds(annotation);
  return [
    { handle: "nw", x: bounds.x, y: bounds.y },
    { handle: "ne", x: bounds.x + bounds.width, y: bounds.y },
    { handle: "se", x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { handle: "sw", x: bounds.x, y: bounds.y + bounds.height },
  ];
}

export function annotationLabelBounds(annotation: Annotation): AnnotationRect | null {
  if (annotation.kind !== "arrow" || !annotation.text?.trim()) return null;
  const label = annotationLabelPosition(annotation);
  const fontSize = annotationFontSize(annotation);
  const lines = annotation.text.trim().split(/\r?\n/);
  return {
    x: label.x,
    y: label.y,
    width: Math.max(32, ...lines.map((line) => line.length * fontSize * 0.62)) + 4,
    height: Math.max(24, lines.length * fontSize * 1.2) + 4,
  };
}

function resizeRectFromHandle(
  bounds: AnnotationRect,
  handle: Exclude<AnnotationTransformHandle, "start" | "end">,
  point: AnnotationPointer,
  minSize: number,
): AnnotationRect {
  const min = Math.max(1, minSize);
  const anchorX = handle.includes("w") ? bounds.x + bounds.width : bounds.x;
  const anchorY = handle.includes("n") ? bounds.y + bounds.height : bounds.y;
  const left = handle.includes("w") ? Math.min(point.x, anchorX - min) : anchorX;
  const right = handle.includes("w") ? anchorX : Math.max(point.x, anchorX + min);
  const top = handle.includes("n") ? Math.min(point.y, anchorY - min) : anchorY;
  const bottom = handle.includes("n") ? anchorY : Math.max(point.y, anchorY + min);
  return {
    x: left,
    y: top,
    width: Math.max(min, right - left),
    height: Math.max(min, bottom - top),
  };
}

function scalePoints(points: number[], from: AnnotationRect, to: AnnotationRect): number[] {
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  return points.map((value, index) => {
    if (index % 2 === 0) return to.x + (value - from.x) * sx;
    return to.y + (value - from.y) * sy;
  });
}

/**
 * Calculates a geometry patch from a transform handle drag. All values stay
 * in natural image pixels; the canvas zoom is intentionally not involved.
 */
export function resizeAnnotationFromHandle(
  annotation: Annotation,
  handle: AnnotationTransformHandle,
  point: AnnotationPointer,
  minSize = ANNOTATION_MIN_LENGTH,
): Partial<Annotation> {
  if (handle === "start" || handle === "end") {
    const originalStart = { x: annotation.x, y: annotation.y };
    const originalEnd = {
      x: annotation.x + (annotation.width ?? 0),
      y: annotation.y + (annotation.height ?? 0),
    };
    const start = handle === "start"
      ? point
      : originalStart;
    const end = handle === "end"
      ? point
      : originalEnd;
    const originalLength = Math.hypot(originalEnd.x - originalStart.x, originalEnd.y - originalStart.y);
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < minSize) {
      const scale = minSize / Math.max(1, length);
      dx *= scale;
      dy *= scale;
    }
    const patch: Partial<Annotation> = {
      x: start.x,
      y: start.y,
      width: dx,
      height: dy,
    };
    if (annotation.kind === "arrow" && Number.isFinite(annotation.bend) && originalLength > 0) {
      patch.bend = Number(annotation.bend) * (Math.hypot(dx, dy) / originalLength);
    }
    return patch;
  }

  const from = annotationTransformBounds(annotation);
  const to = resizeRectFromHandle(from, handle, point, minSize);
  if (annotation.kind === "rect" || annotation.kind === "ellipse") {
    return to;
  }
  if (annotation.kind === "freehand" || annotation.kind === "highlight") {
    return {
      points: scalePoints(annotation.points ?? [], from, to),
      x: to.x,
      y: to.y,
    };
  }
  if (annotation.kind === "text") {
    const ratio = Math.max(to.width / Math.max(1, from.width), to.height / Math.max(1, from.height));
    return {
      x: to.x,
      y: to.y,
      fontSize: clampAnnotationFontSize(annotationFontSize(annotation) * ratio),
    };
  }
  return {};
}

export function arrowControlPoint(annotation: Annotation): AnnotationPointer {
  const start = { x: annotation.x, y: annotation.y };
  const end = { x: annotation.x + (annotation.width ?? 0), y: annotation.y + (annotation.height ?? 0) };
  const bend = Number(annotation.bend || 0);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x: (start.x + end.x) / 2 + (-dy / length) * bend,
    y: (start.y + end.y) / 2 + (dx / length) * bend,
  };
}

function pointToSegmentDistance(point: AnnotationPointer, a: AnnotationPointer, b: AnnotationPointer): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (!lengthSq) return distance(point, a);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  return distance(point, { x: a.x + t * dx, y: a.y + t * dy });
}

export function annotationHitTest(annotation: Annotation, point: AnnotationPointer, tolerance = 10): boolean {
  const bounds = annotationBounds(annotation);
  if (annotation.kind === "rect") {
    const inside = point.x >= bounds.x - tolerance
      && point.x <= bounds.x + bounds.width + tolerance
      && point.y >= bounds.y - tolerance
      && point.y <= bounds.y + bounds.height + tolerance;
    if (!inside) return false;
    const distanceToEdge = Math.min(
      Math.abs(point.x - bounds.x),
      Math.abs(point.x - (bounds.x + bounds.width)),
      Math.abs(point.y - bounds.y),
      Math.abs(point.y - (bounds.y + bounds.height)),
    );
    return distanceToEdge <= tolerance;
  }
  if (annotation.kind === "ellipse") {
    const rx = Math.max(0.001, bounds.width / 2);
    const ry = Math.max(0.001, bounds.height / 2);
    const cx = bounds.x + rx;
    const cy = bounds.y + ry;
    const normalized = Math.hypot((point.x - cx) / rx, (point.y - cy) / ry);
    const toleranceRatio = tolerance / Math.max(1, Math.min(rx, ry));
    return Math.abs(normalized - 1) <= toleranceRatio;
  }
  if (annotation.kind === "text") {
    return point.x >= annotation.x - tolerance
      && point.x <= annotation.x + Math.max(80, (annotation.text?.length ?? 1) * 12) + tolerance
      && point.y >= annotation.y - 24 - tolerance
      && point.y <= annotation.y + tolerance;
  }
  if (annotation.kind === "arrow") {
    const labelBounds = annotationLabelBounds(annotation);
    if (labelBounds
      && point.x >= labelBounds.x - tolerance
      && point.x <= labelBounds.x + labelBounds.width + tolerance
      && point.y >= labelBounds.y - tolerance
      && point.y <= labelBounds.y + labelBounds.height + tolerance) return true;
    const start = { x: annotation.x, y: annotation.y };
    const end = { x: annotation.x + (annotation.width ?? 0), y: annotation.y + (annotation.height ?? 0) };
    const control = arrowControlPoint(annotation);
    const samples = Array.from({ length: 16 }, (_, index) => index / 15);
    let previous = start;
    for (const t of samples.slice(1)) {
      const next = {
        x: (1 - t) ** 2 * start.x + 2 * (1 - t) * t * control.x + t ** 2 * end.x,
        y: (1 - t) ** 2 * start.y + 2 * (1 - t) * t * control.y + t ** 2 * end.y,
      };
      if (pointToSegmentDistance(point, previous, next) <= tolerance) return true;
      previous = next;
    }
    return false;
  }
  if (annotation.kind === "line") {
    return pointToSegmentDistance(
      point,
      { x: annotation.x, y: annotation.y },
      { x: annotation.x + (annotation.width ?? 0), y: annotation.y + (annotation.height ?? 0) },
    ) <= tolerance;
  }
  const points = annotation.points ?? [];
  for (let index = 2; index < points.length; index += 2) {
    if (pointToSegmentDistance(point, { x: points[index - 2], y: points[index - 1] }, { x: points[index], y: points[index + 1] }) <= tolerance) return true;
  }
  return false;
}

/**
 * Selection uses a modest screen-space halo so thin marks remain selectable
 * after zooming without turning the whole nearby canvas into a hit target.
 */
export function annotationSelectionTolerance(annotation: Annotation, viewScale = 1): number {
  const scale = Math.max(0.05, Number(viewScale) || 1);
  const stroke = annotationStrokeWidth(annotation, annotation.kind === "highlight" ? 18 : 3);
  const styleHalo = annotation.kind === "text" || annotation.kind === "arrow"
    ? annotationFontSize(annotation) * 0.75
    : stroke * 2;
  return Math.max(6, styleHalo, 10 / scale);
}
