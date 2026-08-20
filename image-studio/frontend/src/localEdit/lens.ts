import type { LocalEditLens } from "../types/domain";

export type LocalEditRect = { x: number; y: number; width: number; height: number };
export type LocalEditCorner = "nw" | "ne" | "sw" | "se";

export const LOCAL_EDIT_LENS_MIN_SIZE = 8;

export function localEditAspectRatio(aspect: string): number | null {
  const [width, height] = String(aspect || "").split(":").map(Number);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? width / height
    : null;
}

function finite(value: unknown, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function boundedDimension(value: number, maximum: number) {
  const max = Math.max(1, Math.floor(maximum));
  const minimum = Math.min(LOCAL_EDIT_LENS_MIN_SIZE, max);
  return Math.max(minimum, Math.min(max, Math.round(finite(value, minimum))));
}

export function clampLocalEditRect(
  rect: LocalEditRect,
  sourceWidth: number,
  sourceHeight: number,
  aspect = "free",
): LocalEditRect {
  const maxWidth = Math.max(1, Math.floor(sourceWidth));
  const maxHeight = Math.max(1, Math.floor(sourceHeight));
  const ratio = localEditAspectRatio(aspect);
  let width = boundedDimension(rect.width, maxWidth);
  let height = boundedDimension(rect.height, maxHeight);

  if (ratio) {
    height = boundedDimension(width / ratio, maxHeight);
    width = boundedDimension(height * ratio, maxWidth);
    if (width > maxWidth || height > maxHeight) {
      const scale = Math.min(maxWidth / Math.max(1, width), maxHeight / Math.max(1, height));
      width = boundedDimension(width * scale, maxWidth);
      height = boundedDimension(width / ratio, maxHeight);
    }
  }

  const x = Math.max(0, Math.min(maxWidth - width, Math.round(finite(rect.x, 0))));
  const y = Math.max(0, Math.min(maxHeight - height, Math.round(finite(rect.y, 0))));
  return { x, y, width, height };
}

export function normalizeLocalEditLens(
  lens: LocalEditLens,
  sourceWidth: number,
  sourceHeight: number,
  aspect = lens.aspect,
): LocalEditLens {
  const rect = clampLocalEditRect(lens, sourceWidth, sourceHeight, aspect);
  return {
    ...lens,
    aspect,
    ...rect,
    outputWidth: rect.width,
    outputHeight: rect.height,
  };
}

export function resizeLocalEditLensToAspect(
  lens: LocalEditLens,
  aspect: string,
  sourceWidth: number,
  sourceHeight: number,
): LocalEditLens {
  const ratio = localEditAspectRatio(aspect);
  if (!ratio) return normalizeLocalEditLens({ ...lens, aspect }, sourceWidth, sourceHeight, aspect);

  const centerX = lens.x + lens.width / 2;
  const centerY = lens.y + lens.height / 2;
  let width = Math.min(lens.width, lens.height * ratio, sourceWidth);
  let height = width / ratio;
  if (height > sourceHeight) {
    height = sourceHeight;
    width = height * ratio;
  }
  const rect = clampLocalEditRect({
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  }, sourceWidth, sourceHeight, aspect);
  return { ...lens, aspect, ...rect, outputWidth: rect.width, outputHeight: rect.height };
}

/** Resize one corner in natural-pixel space while keeping the opposite corner anchored. */
export function resizeLocalEditRectFromCorner(
  rect: LocalEditRect,
  corner: LocalEditCorner,
  deltaX: number,
  deltaY: number,
  sourceWidth: number,
  sourceHeight: number,
  aspect = "free",
): LocalEditRect {
  const base = clampLocalEditRect(rect, sourceWidth, sourceHeight, "free");
  const movingRight = corner.includes("e");
  const movingBottom = corner.includes("s");
  const anchorX = movingRight ? base.x : base.x + base.width;
  const anchorY = movingBottom ? base.y : base.y + base.height;
  const pointerX = (movingRight ? base.x + base.width : base.x) + finite(deltaX, 0);
  const pointerY = (movingBottom ? base.y + base.height : base.y) + finite(deltaY, 0);
  const ratio = localEditAspectRatio(aspect);

  if (!ratio) {
    const nextX = movingRight ? base.x : pointerX;
    const nextY = movingBottom ? base.y : pointerY;
    const nextWidth = movingRight ? pointerX - anchorX : anchorX - pointerX;
    const nextHeight = movingBottom ? pointerY - anchorY : anchorY - pointerY;
    return clampLocalEditRect({ x: nextX, y: nextY, width: nextWidth, height: nextHeight }, sourceWidth, sourceHeight, "free");
  }

  const maxWidth = movingRight ? sourceWidth - anchorX : anchorX;
  const maxHeight = movingBottom ? sourceHeight - anchorY : anchorY;
  const rawWidth = Math.abs(pointerX - anchorX);
  const rawHeight = Math.abs(pointerY - anchorY);
  const requestedWidth = Math.max(rawWidth, rawHeight * ratio, LOCAL_EDIT_LENS_MIN_SIZE);
  const width = Math.min(
    Math.max(LOCAL_EDIT_LENS_MIN_SIZE, maxWidth),
    Math.max(LOCAL_EDIT_LENS_MIN_SIZE, maxHeight * ratio),
    requestedWidth,
  );
  const height = width / ratio;
  const nextX = movingRight ? anchorX : anchorX - width;
  const nextY = movingBottom ? anchorY : anchorY - height;
  return clampLocalEditRect({ x: nextX, y: nextY, width, height }, sourceWidth, sourceHeight, aspect);
}

export function createCenteredLocalEditLens(
  sourceWidth: number,
  sourceHeight: number,
  aspect = "1:1",
  initialRect?: LocalEditRect,
): LocalEditLens {
  const maxWidth = Math.max(1, Math.floor(sourceWidth));
  const maxHeight = Math.max(1, Math.floor(sourceHeight));
  const base = initialRect && initialRect.width > 3 && initialRect.height > 3
    ? initialRect
    : {
        x: 0,
        y: 0,
        width: Math.min(maxWidth, Math.max(LOCAL_EDIT_LENS_MIN_SIZE, Math.round(Math.min(maxWidth, maxHeight) * 0.6))),
        height: Math.min(maxHeight, Math.max(LOCAL_EDIT_LENS_MIN_SIZE, Math.round(Math.min(maxWidth, maxHeight) * 0.6))),
      };
  const rect = clampLocalEditRect(base, maxWidth, maxHeight, aspect || "free");
  const centered = initialRect && initialRect.width > 3 && initialRect.height > 3
    ? rect
    : clampLocalEditRect({
        ...rect,
        x: (maxWidth - rect.width) / 2,
        y: (maxHeight - rect.height) / 2,
      }, maxWidth, maxHeight, aspect || "free");
  return {
    id: "local-edit-lens-1",
    aspect,
    ...centered,
    outputWidth: centered.width,
    outputHeight: centered.height,
  };
}

export function localEditLensRect(lens: LocalEditLens): LocalEditRect {
  return { x: lens.x, y: lens.y, width: lens.width, height: lens.height };
}
