import type { Annotation, AnnotationKind } from "../../types/domain";

export type { Annotation, AnnotationKind };

/** Tools that create or remove annotation objects.
 *
 * `plainArrow` intentionally maps to the persisted `arrow` kind with a zero
 * bend and no label. Keeping it a tool-only value preserves the legacy model
 * while allowing Cowart's labelled arrow and the ordinary arrow to coexist.
 */
export type AnnotationTool = AnnotationKind | "plainArrow" | "pointer" | "eraser";

export type AnnotationPointer = { x: number; y: number };

export const ANNOTATION_STROKE_WIDTH_MIN = 1;
export const ANNOTATION_STROKE_WIDTH_MAX = 96;
export const ANNOTATION_STROKE_WIDTH_DEFAULT = 4;
export const ANNOTATION_FONT_SIZE_MIN = 8;
export const ANNOTATION_FONT_SIZE_MAX = 128;
export const ANNOTATION_FONT_SIZE_DEFAULT = 20;

// Konva applies the canvas zoom to annotation text, while the inline editor
// is a DOM overlay. Keep shared dimensions in CSS pixels so the two stay
// aligned at every zoom and Windows DPI setting.
export const ANNOTATION_TEXT_FONT_SIZE = ANNOTATION_FONT_SIZE_DEFAULT;
export const ANNOTATION_TEXT_MIN_WIDTH = 180;
export const ANNOTATION_TEXT_MIN_HEIGHT = 42;
export const ANNOTATION_TEXT_PADDING_X = 6;
export const ANNOTATION_TEXT_PADDING_Y = 4;

export type AnnotationDraft = {
  tool: AnnotationTool;
  start: AnnotationPointer;
  current: AnnotationPointer;
  points?: number[];
};

export function clampAnnotationStrokeWidth(value: unknown, fallback = ANNOTATION_STROKE_WIDTH_DEFAULT): number {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : fallback;
  return Math.max(ANNOTATION_STROKE_WIDTH_MIN, Math.min(ANNOTATION_STROKE_WIDTH_MAX, Math.round(safe)));
}

export function clampAnnotationFontSize(value: unknown, fallback = ANNOTATION_FONT_SIZE_DEFAULT): number {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : fallback;
  return Math.max(ANNOTATION_FONT_SIZE_MIN, Math.min(ANNOTATION_FONT_SIZE_MAX, Math.round(safe)));
}

/**
 * Pick a readable image-pixel font size for a new annotation. The annotation
 * workbench uses a bounded natural-pixel source, so the longest edge gives a
 * stable scale across portrait, landscape, preview and 4K images.
 */
export function annotationFontSizeForImage(width: unknown, height: unknown): number {
  const w = Number(width);
  const h = Number(height);
  const longestEdge = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
    ? Math.max(w, h)
    : 0;
  if (!longestEdge) return ANNOTATION_FONT_SIZE_DEFAULT;
  return clampAnnotationFontSize(Math.max(16, Math.round(longestEdge / 64)));
}

export function annotationStrokeWidth(annotation: Annotation, fallback = ANNOTATION_STROKE_WIDTH_DEFAULT): number {
  return clampAnnotationStrokeWidth(annotation.strokeWidth, fallback);
}

export function annotationFontSize(annotation: Annotation, fallback = ANNOTATION_FONT_SIZE_DEFAULT): number {
  return clampAnnotationFontSize(annotation.fontSize, fallback);
}

export function annotationArrowHeadSize(strokeWidth: number): number {
  return Math.max(12, clampAnnotationStrokeWidth(strokeWidth) * 3);
}

export function annotationTextOffset(fontSize: number): number {
  return clampAnnotationFontSize(fontSize) * 1.3;
}

export function annotationLabelPosition(annotation: Annotation): { x: number; y: number } {
  const fontSize = annotationFontSize(annotation);
  return {
    x: Number.isFinite(annotation.labelX) ? Number(annotation.labelX) : annotation.x,
    y: Number.isFinite(annotation.labelY) ? Number(annotation.labelY) : annotation.y - annotationTextOffset(fontSize),
  };
}

/** Create a new annotation for the pointer context-menu copy action. */
export function cloneAnnotationForCopy(
  annotation: Annotation,
  id: string,
  offsetX = 16,
  offsetY = 16,
): Annotation {
  const copy: Annotation = {
    ...annotation,
    id,
    ...(annotation.points
      ? { points: annotation.points.map((value, index) => value + (index % 2 === 0 ? offsetX : offsetY)) }
      : { x: annotation.x + offsetX, y: annotation.y + offsetY }),
  };
  if (annotation.labelX !== undefined || annotation.labelY !== undefined) {
    copy.labelX = annotationLabelPosition(annotation).x + offsetX;
    copy.labelY = annotationLabelPosition(annotation).y + offsetY;
  }
  return copy;
}

export function annotationHasContent(annotation: Annotation): boolean {
  if (annotation.kind === "text" || annotation.kind === "arrow") {
    return !!annotation.text?.trim() || annotation.kind === "arrow";
  }
  if (annotation.kind === "freehand" || annotation.kind === "highlight") {
    return (annotation.points?.length ?? 0) >= 4;
  }
  return Math.abs(annotation.width ?? 0) > 1 || Math.abs(annotation.height ?? 0) > 1;
}

export function normalizeAnnotation(annotation: Annotation): Annotation {
  const strokeWidth = Number.isFinite(annotation.strokeWidth)
    ? clampAnnotationStrokeWidth(annotation.strokeWidth)
    : annotation.kind === "highlight" ? 18 : ANNOTATION_STROKE_WIDTH_DEFAULT;
  const opacity = Number.isFinite(annotation.opacity)
    ? Math.max(0.05, Math.min(1, Number(annotation.opacity)))
    : annotation.kind === "highlight" ? 0.32 : 1;
  const bend = annotation.kind === "arrow" && Number.isFinite(annotation.bend)
    ? Number(annotation.bend)
    : undefined;
  return {
    ...annotation,
    strokeWidth,
    ...(annotation.kind === "text" || annotation.kind === "arrow"
      ? { fontSize: clampAnnotationFontSize(annotation.fontSize) }
      : {}),
    opacity,
    ...(bend === undefined ? {} : { bend }),
  };
}
