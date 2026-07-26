import type {
  HistoryItem,
  PanoramaPastebackAlignment,
  PanoramaProjectRef,
  PanoramaProjectRole,
  PanoramaRoundtripRef,
  PanoramaRoundtripState,
  PanoramaShot,
  SourceImage,
} from "../types/domain";

export const PANORAMA_ASPECT_PRESETS = [
  { value: "1:1", label: "1:1" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "2:1", label: "2:1" },
] as const;

export type PanoramaAspectPresetValue = typeof PANORAMA_ASPECT_PRESETS[number]["value"];

type Vec3 = { x: number; y: number; z: number };
type RGBAImage = { width: number; height: number; data: Uint8ClampedArray };
type DrawCacheOwner = { __panoWrappedErpCache?: { src: string; w: number; h: number; canvas: HTMLCanvasElement | null } };
type PanoramaOverlayPoint = { x: number; y: number };
export type PanoramaPreviewQuality = "draft" | "balanced" | "high";
export type PanoramaPastebackMaskInput = {
  image: CanvasImageSource;
  featherPx?: number | null;
};

export type PanoramaPanoOverlayEdgeMidpoint = {
  edge: "top" | "right" | "bottom" | "left";
  x: number;
  y: number;
  a: PanoramaOverlayPoint;
  b: PanoramaOverlayPoint;
};

export type PanoramaPanoOverlayGeometry = {
  visible: boolean;
  center: PanoramaOverlayPoint | null;
  corners: PanoramaOverlayPoint[];
  edgeMidpoints: PanoramaPanoOverlayEdgeMidpoint[];
  rotateStemBase: PanoramaOverlayPoint | null;
  rotateHandle: PanoramaOverlayPoint | null;
};

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const DEFAULT_OUT_SIZE = 1024;
export const DEFAULT_PANORAMA_OUTPUT_LONG_EDGE = 2048;
const DEFAULT_TOLERANCE = 0.03;

const ASPECT_PAIRS: Record<PanoramaAspectPresetValue, [number, number]> = {
  "1:1": [1, 1],
  "4:3": [4, 3],
  "3:4": [3, 4],
  "16:9": [16, 9],
  "9:16": [9, 16],
  "2:1": [2, 1],
};

export function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function wrapYaw(yaw: number) {
  return ((yaw + 180) % 360 + 360) % 360 - 180;
}

function roundToMultiple(value: number, multiple = 8, min = 8) {
  return Math.max(min, Math.round(value / multiple) * multiple);
}

function fovDegreesToHalfTan(fovDeg: number) {
  return Math.tan(clamp(Number(fovDeg || 0), 1, 179) * 0.5 * DEG2RAD);
}

function halfTanToFovDegrees(halfTan: number) {
  return clamp(2 * Math.atan(Math.max(1e-4, Number(halfTan || 0))) * RAD2DEG, 1, 179);
}

function applyAspectRatioToShotFov(shot: PanoramaShot, aspectRatio: number) {
  const safeRatio = Math.max(1e-4, Number(aspectRatio || 1));
  const tanH = fovDegreesToHalfTan(Number(shot.hFOV_deg || 64));
  const tanV = fovDegreesToHalfTan(Number(shot.vFOV_deg || 40));
  const span = Math.sqrt(Math.max(1e-6, tanH * tanV));
  return {
    hFOV_deg: halfTanToFovDegrees(span * Math.sqrt(safeRatio)),
    vFOV_deg: halfTanToFovDegrees(span / Math.sqrt(safeRatio)),
  };
}

function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x + b.x, a.y + b.y, a.z + b.z);
}

function mul(a: Vec3, scalar: number): Vec3 {
  return vec3(a.x * scalar, a.y * scalar, a.z * scalar);
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function norm(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z) || 1e-8;
  return vec3(v.x / length, v.y / length, v.z / length);
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return vec3(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x,
  );
}

function yawPitchToDir(yawDeg: number, pitchDeg: number): Vec3 {
  const yaw = yawDeg * DEG2RAD;
  const pitch = pitchDeg * DEG2RAD;
  const cp = Math.cos(pitch);
  return vec3(cp * Math.sin(yaw), Math.sin(pitch), cp * Math.cos(yaw));
}

function orthonormalBasisFromForward(forward: Vec3): { right: Vec3; up: Vec3; fwd: Vec3 } {
  const fwd = norm(forward);
  let worldUp = vec3(0, 1, 0);
  if (Math.abs(dot(fwd, worldUp)) > 0.999) worldUp = vec3(0, 0, 1);
  let right = norm(cross(worldUp, fwd));
  if (Math.hypot(right.x, right.y, right.z) < 1e-6) right = vec3(1, 0, 0);
  const up = norm(cross(fwd, right));
  return { right, up, fwd };
}

function cameraBasis(yawDeg: number, pitchDeg: number, rollDeg = 0) {
  const forward = yawPitchToDir(yawDeg, pitchDeg);
  const { right, up, fwd } = orthonormalBasisFromForward(forward);
  const roll = rollDeg * DEG2RAD;
  const cos = Math.cos(roll);
  const sin = Math.sin(roll);
  const rotatedRight = add(mul(right, cos), mul(up, sin));
  const rotatedUp = add(mul(right, -sin), mul(up, cos));
  return { fwd, right: norm(rotatedRight), up: norm(rotatedUp) };
}

function directionFromShot(shot: PanoramaShot, normalizedX: number, normalizedY: number): Vec3 {
  const basis = cameraBasis(shot.yaw_deg, shot.pitch_deg, shot.roll_deg);
  const tanX = Math.tan(clamp(shot.hFOV_deg, 1, 179) * 0.5 * DEG2RAD);
  const tanY = Math.tan(clamp(shot.vFOV_deg, 1, 179) * 0.5 * DEG2RAD);
  return norm(add(add(basis.fwd, mul(basis.right, normalizedX * tanX)), mul(basis.up, normalizedY * tanY)));
}

function projectDirectionToPanoViewport(
  direction: Vec3,
  viewBasis: { right: Vec3; up: Vec3; fwd: Vec3 },
  viewportWidth: number,
  viewportHeight: number,
  viewFovDeg: number,
  clampToGuard = false,
): PanoramaOverlayPoint | null {
  const width = Math.max(1, Number(viewportWidth || 0));
  const height = Math.max(1, Number(viewportHeight || 0));
  if (width <= 0 || height <= 0) return null;
  const cx = dot(direction, viewBasis.right);
  const cy = dot(direction, viewBasis.up);
  const cz = dot(direction, viewBasis.fwd);
  if (!clampToGuard && cz <= 1e-5) return null;
  const hfov = clamp(Number(viewFovDeg || 90), 1, 179) * DEG2RAD;
  const vfov = 2 * Math.atan(Math.tan(hfov * 0.5) * (height / width));
  const sx = (width * 0.5) / Math.tan(hfov * 0.5);
  const sy = (height * 0.5) / Math.tan(vfov * 0.5);
  const z = clampToGuard ? Math.max(cz, 1e-4) : cz;
  const x = width * 0.5 + (cx / z) * sx;
  const y = height * 0.5 - (cy / z) * sy;
  if (!clampToGuard) return { x, y };
  const guard = Math.max(width, height) * 2;
  return {
    x: clamp(x, -guard, width + guard),
    y: clamp(y, -guard, height + guard),
  };
}

function emptyPanoramaPanoOverlayGeometry(): PanoramaPanoOverlayGeometry {
  return {
    visible: false,
    center: null,
    corners: [],
    edgeMidpoints: [],
    rotateStemBase: null,
    rotateHandle: null,
  };
}

function stripDataURLPrefix(dataURL: string) {
  const index = dataURL.indexOf(",");
  return index >= 0 ? dataURL.slice(index + 1) : dataURL;
}

function imageToPixels(source: CanvasImageSource, blurPx = 0): RGBAImage {
  const width = Number((source as HTMLImageElement).naturalWidth || (source as HTMLCanvasElement).width || 0);
  const height = Number((source as HTMLImageElement).naturalHeight || (source as HTMLCanvasElement).height || 0);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || width <= 0 || height <= 0) throw new Error("Unable to read image pixels");
  const safeBlur = Math.max(0, Number(blurPx || 0));
  if (safeBlur > 0) {
    const rawCanvas = document.createElement("canvas");
    rawCanvas.width = width;
    rawCanvas.height = height;
    const rawCtx = rawCanvas.getContext("2d");
    if (!rawCtx) throw new Error("Unable to prepare blurred image pixels");
    rawCtx.drawImage(source, 0, 0, width, height);
    ctx.filter = `blur(${safeBlur}px)`;
    ctx.drawImage(rawCanvas, 0, 0, width, height);
    ctx.filter = "none";
  } else {
    ctx.drawImage(source, 0, 0, width, height);
  }
  const imageData = ctx.getImageData(0, 0, width, height);
  return { width, height, data: imageData.data };
}

function writePixelsToBase64(image: RGBAImage): string {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to create output canvas");
  const next = ctx.createImageData(image.width, image.height);
  next.data.set(image.data);
  ctx.putImageData(next, 0, 0);
  return stripDataURLPrefix(canvas.toDataURL("image/png"));
}

function sampleRgbaBilinear(image: RGBAImage, x: number, y: number): [number, number, number, number] {
  const width = image.width;
  const height = image.height;
  const px = clamp(x, 0, width - 1);
  const py = clamp(y, 0, height - 1);
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = px - x0;
  const fy = py - y0;

  const offset = (ix: number, iy: number) => (iy * width + ix) * 4;
  const o00 = offset(x0, y0);
  const o10 = offset(x1, y0);
  const o01 = offset(x0, y1);
  const o11 = offset(x1, y1);

  const out: number[] = [0, 0, 0, 0];
  for (let channel = 0; channel < 4; channel += 1) {
    const c00 = image.data[o00 + channel];
    const c10 = image.data[o10 + channel];
    const c01 = image.data[o01 + channel];
    const c11 = image.data[o11 + channel];
    const c0 = c00 * (1 - fx) + c10 * fx;
    const c1 = c01 * (1 - fx) + c11 * fx;
    out[channel] = c0 * (1 - fy) + c1 * fy;
  }
  return out as [number, number, number, number];
}

function applyPastebackColorAdjustments(
  rgba: [number, number, number, number],
  alignment?: PanoramaPastebackAlignment | null,
): [number, number, number] {
  const brightness = alignment?.brightness ?? 1;
  const contrast = alignment?.contrast ?? 1;
  const hueRotationDeg = alignment?.hueRotationDeg ?? 0;
  let r = clamp((rgba[0] * brightness - 128) * contrast + 128, 0, 255);
  let g = clamp((rgba[1] * brightness - 128) * contrast + 128, 0, 255);
  let b = clamp((rgba[2] * brightness - 128) * contrast + 128, 0, 255);

  if (Math.abs(hueRotationDeg) > 1e-6) {
    const angle = hueRotationDeg * DEG2RAD;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const nextR = (0.213 + cos * 0.787 - sin * 0.213) * r
      + (0.715 - cos * 0.715 - sin * 0.715) * g
      + (0.072 - cos * 0.072 + sin * 0.928) * b;
    const nextG = (0.213 - cos * 0.213 + sin * 0.143) * r
      + (0.715 + cos * 0.285 + sin * 0.140) * g
      + (0.072 - cos * 0.072 - sin * 0.283) * b;
    const nextB = (0.213 - cos * 0.213 - sin * 0.787) * r
      + (0.715 - cos * 0.715 + sin * 0.715) * g
      + (0.072 + cos * 0.928 + sin * 0.072) * b;
    r = clamp(nextR, 0, 255);
    g = clamp(nextG, 0, 255);
    b = clamp(nextB, 0, 255);
  }

  return [r, g, b];
}

function setPixel(target: Uint8ClampedArray, width: number, x: number, y: number, rgba: [number, number, number, number]) {
  const offset = (y * width + x) * 4;
  target[offset] = rgba[0];
  target[offset + 1] = rgba[1];
  target[offset + 2] = rgba[2];
  target[offset + 3] = rgba[3];
}

function getWrappedErpCanvas(owner: DrawCacheOwner, img: HTMLImageElement): HTMLCanvasElement | null {
  if (!img.complete || !(img.naturalWidth || img.width)) return null;
  const width = Number(img.naturalWidth || img.width || 0);
  const height = Number(img.naturalHeight || img.height || 0);
  if (width <= 1 || height <= 1) return null;
  const src = String(img.src || "");
  const cached = owner.__panoWrappedErpCache;
  if (cached?.canvas && cached.src === src && cached.w === width && cached.h === height) return cached.canvas;
  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, width, height);
  ctx.drawImage(img, width, 0, width, height);
  owner.__panoWrappedErpCache = { src, w: width, h: height, canvas };
  return canvas;
}

function expandTriangle(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  pixels = 0.45,
) {
  const cx = (p0.x + p1.x + p2.x) / 3;
  const cy = (p0.y + p1.y + p2.y) / 3;
  const grow = (p: { x: number; y: number }) => {
    const vx = p.x - cx;
    const vy = p.y - cy;
    const length = Math.hypot(vx, vy) || 1;
    return { x: p.x + (vx / length) * pixels, y: p.y + (vy / length) * pixels };
  };
  return [grow(p0), grow(p1), grow(p2)] as const;
}

function drawImageTriangle(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  s0: { x: number; y: number },
  s1: { x: number; y: number },
  s2: { x: number; y: number },
  d0: { x: number; y: number },
  d1: { x: number; y: number },
  d2: { x: number; y: number },
) {
  const denominator = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(denominator) < 1e-6) return false;
  const [e0, e1, e2] = expandTriangle(d0, d1, d2);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(e0.x, e0.y);
  ctx.lineTo(e1.x, e1.y);
  ctx.lineTo(e2.x, e2.y);
  ctx.closePath();
  ctx.clip();
  const m11 = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denominator;
  const m12 = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denominator;
  const m13 = (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) / denominator;
  const m21 = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denominator;
  const m22 = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denominator;
  const m23 = (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) / denominator;
  ctx.transform(m11, m21, m12, m22, m13, m23);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
  return true;
}

export function panoramaPreviewGridSizeFor(
  rect: { w: number; h: number },
  shot: Pick<PanoramaShot, "hFOV_deg" | "vFOV_deg">,
  quality: PanoramaPreviewQuality,
) {
  const base = quality === "high"
    ? { Nu: 30, Nv: 20, capNu: 72, capNv: 48 }
    : quality === "draft"
      ? { Nu: 12, Nv: 8, capNu: 28, capNv: 18 }
      : { Nu: 20, Nv: 14, capNu: 52, capNv: 36 };
  const area = Math.max(1, Number(rect.w || 1) * Number(rect.h || 1));
  const sizeFactor = clamp(Math.sqrt(area) / 900, 1, 1.75);
  const fov = Math.max(Number(shot.hFOV_deg || 0), Number(shot.vFOV_deg || 0), 1);
  const fovFactor = clamp(1 + ((fov - 90) / 70), 1, 2.25);
  return {
    Nu: Math.min(base.capNu, Math.max(base.Nu, Math.round(base.Nu * sizeFactor * fovFactor))),
    Nv: Math.min(base.capNv, Math.max(base.Nv, Math.round(base.Nv * sizeFactor * fovFactor))),
  };
}

function createPreviewGrid(
  rect: { x: number; y: number; w: number; h: number },
  shot: PanoramaShot,
  imageWidth: number,
  imageHeight: number,
  quality: PanoramaPreviewQuality,
) {
  const basis = cameraBasis(shot.yaw_deg, shot.pitch_deg, shot.roll_deg);
  const tanX = Math.tan(clamp(shot.hFOV_deg, 1, 179) * 0.5 * DEG2RAD);
  const tanY = Math.tan(clamp(shot.vFOV_deg, 1, 179) * 0.5 * DEG2RAD);
  const { Nu, Nv } = panoramaPreviewGridSizeFor(rect, shot, quality);
  const verts: Array<Array<{ x: number; y: number }>> = Array.from({ length: Nv + 1 }, () => Array(Nu + 1));
  const sample: Array<Array<{ x: number; y: number }>> = Array.from({ length: Nv + 1 }, () => Array(Nu + 1));
  for (let j = 0; j <= Nv; j += 1) {
    for (let i = 0; i <= Nu; i += 1) {
      const u = i / Nu;
      const v = j / Nv;
      const nx = (u * 2 - 1) * tanX;
      const ny = (1 - v * 2) * tanY;
      const direction = norm(add(add(basis.fwd, mul(basis.right, nx)), mul(basis.up, ny)));
      const lon = Math.atan2(direction.x, direction.z);
      const lat = Math.asin(clamp(direction.y, -1, 1));
      let su = (lon / (2 * Math.PI) + 0.5) * imageWidth;
      while (su < 0) su += imageWidth;
      while (su >= imageWidth) su -= imageWidth;
      const sv = (0.5 - lat / Math.PI) * imageHeight;
      verts[j][i] = { x: rect.x + u * rect.w, y: rect.y + v * rect.h };
      sample[j][i] = { x: su, y: sv };
    }
  }
  return { Nu, Nv, verts, sample };
}

export function isLikelyPanoramaRatio(
  width: number | null | undefined,
  height: number | null | undefined,
  tolerance = DEFAULT_TOLERANCE,
) {
  const w = Number(width || 0);
  const h = Number(height || 0);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return false;
  return Math.abs(w / h - 2) <= tolerance;
}

function ratioFromSizeValue(raw: string | null | undefined) {
  const value = String(raw || "").trim();
  if (!value) return null;
  const aspectMatch = value.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)(?:\s*@\s*[a-z0-9._-]+)?$/i);
  if (aspectMatch) {
    const width = Number(aspectMatch[1]);
    const height = Number(aspectMatch[2]);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return width / height;
    }
  }
  const pixelMatch = value.match(/^(\d+)\s*x\s*(\d+)$/i);
  if (pixelMatch) {
    const width = Number(pixelMatch[1]);
    const height = Number(pixelMatch[2]);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return width / height;
    }
  }
  return null;
}

export function isLikelyPanoramaSizeValue(raw: string | null | undefined, tolerance = DEFAULT_TOLERANCE) {
  const ratio = ratioFromSizeValue(raw);
  return ratio != null && Math.abs(ratio - 2) <= tolerance;
}

export function isLikelyPanoramaItem(item: Pick<HistoryItem, "width" | "height" | "previewWidth" | "previewHeight" | "size"> | null | undefined) {
  if (!item) return false;
  return isLikelyPanoramaRatio(item.width, item.height)
    || isLikelyPanoramaRatio(item.previewWidth, item.previewHeight)
    || isLikelyPanoramaSizeValue(item.size);
}

export function findPanoramaRoundtripRef(
  sources: Array<Pick<SourceImage, "panoramaRoundtrip">> | undefined,
): PanoramaRoundtripRef | null {
  for (const source of sources ?? []) {
    if (source?.panoramaRoundtrip) return source.panoramaRoundtrip;
  }
  return null;
}

export function resolvePanoramaRoundtripRef(
  item: Pick<HistoryItem, "panoramaProject" | "panoramaRoundtrip" | "sourceImages"> | null | undefined,
): PanoramaRoundtripRef | null {
  if (!item) return null;
  if (item.panoramaProject?.role === "pasted-panorama") return null;
  return item.panoramaRoundtrip ?? findPanoramaRoundtripRef(item.sourceImages);
}

export function hasPanoramaRoundtripRef(
  item: Pick<HistoryItem, "panoramaProject" | "panoramaRoundtrip" | "sourceImages"> | null | undefined,
): boolean {
  return !!resolvePanoramaRoundtripRef(item);
}

export function findPanoramaProjectRef(
  sources: Array<Pick<SourceImage, "panoramaProject">> | undefined,
): PanoramaProjectRef | null {
  for (const source of sources ?? []) {
    if (source?.panoramaProject) return source.panoramaProject;
  }
  return null;
}

export function resolvePanoramaProjectRef(
  item: Pick<HistoryItem, "id" | "savedPath" | "width" | "height" | "previewWidth" | "previewHeight" | "size" | "panoramaProject" | "panoramaRoundtrip" | "sourceImages"> | null | undefined,
): PanoramaProjectRef | null {
  if (!item) return null;
  if (item.panoramaProject?.sourceHistoryId) return item.panoramaProject;
  const fromSource = findPanoramaProjectRef(item.sourceImages);
  if (fromSource?.sourceHistoryId) return fromSource;
  const roundtrip = resolvePanoramaRoundtripRef(item);
  if (roundtrip?.sourceHistoryId) {
    return {
      sourceHistoryId: roundtrip.sourceHistoryId,
      sourcePath: roundtrip.sourcePath,
      role: "edited-shot",
    };
  }
  if (isLikelyPanoramaItem(item)) {
    return {
      sourceHistoryId: item.id,
      sourcePath: item.savedPath,
      role: "source",
    };
  }
  return null;
}

export function buildPanoramaProjectRef(
  source: Pick<HistoryItem, "id" | "savedPath" | "panoramaProject">,
  role: PanoramaProjectRole,
  links: Pick<PanoramaProjectRef, "shotHistoryId" | "editedShotHistoryId"> = {},
): PanoramaProjectRef {
  const sourceProject = source.panoramaProject;
  const sourceHistoryId = role === "source"
    ? source.id
    : (sourceProject?.sourceHistoryId || source.id);
  const sourcePath = role === "source"
    ? source.savedPath
    : (sourceProject?.sourcePath || source.savedPath);
  return {
    sourceHistoryId,
    sourcePath,
    role,
    shotHistoryId: links.shotHistoryId ?? sourceProject?.shotHistoryId,
    editedShotHistoryId: links.editedShotHistoryId,
  };
}

export function buildPanoramaProjectRefFromRoundtrip(
  roundtrip: PanoramaRoundtripRef | null | undefined,
  role: PanoramaProjectRole,
  links: Pick<PanoramaProjectRef, "shotHistoryId" | "editedShotHistoryId"> = {},
): PanoramaProjectRef | undefined {
  if (!roundtrip?.sourceHistoryId) return undefined;
  return {
    sourceHistoryId: roundtrip.sourceHistoryId,
    sourcePath: roundtrip.sourcePath,
    role,
    ...links,
  };
}

export function panoramaProjectOutputsForSource(
  history: HistoryItem[],
  source: HistoryItem,
): HistoryItem[] {
  const sourceRef = resolvePanoramaProjectRef(source);
  const sourceHistoryId = sourceRef?.sourceHistoryId || source.id;
  return history.filter((entry) => {
    if (entry.id === source.id) return false;
    const ref = resolvePanoramaProjectRef(entry);
    return ref?.sourceHistoryId === sourceHistoryId;
  });
}

export function clonePanoramaShot(shot: PanoramaShot): PanoramaShot {
  return { ...shot };
}

export function createDefaultPanoramaShot(item?: Pick<HistoryItem, "width" | "height" | "previewWidth" | "previewHeight"> | null): PanoramaShot {
  const width = Number(item?.width || item?.previewWidth || 0);
  const height = Number(item?.height || item?.previewHeight || 0);
  const useSquare = !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0;
  return {
    id: "panorama-shot-1",
    yaw_deg: 0,
    pitch_deg: 0,
    roll_deg: 0,
    hFOV_deg: useSquare ? 90 : 64,
    vFOV_deg: useSquare ? 90 : 40,
    out_w: useSquare ? DEFAULT_OUT_SIZE : 1024,
    out_h: useSquare ? DEFAULT_OUT_SIZE : 1024,
    aspect_id: "1:1",
  };
}

export function applyPanoramaAspectPreset(shot: PanoramaShot, aspectId: PanoramaAspectPresetValue): PanoramaShot {
  const next = clonePanoramaShot(shot);
  const [aw, ah] = ASPECT_PAIRS[aspectId];
  const nextFov = applyAspectRatioToShotFov(next, aw / ah);
  next.hFOV_deg = nextFov.hFOV_deg;
  next.vFOV_deg = nextFov.vFOV_deg;
  const base = Math.max(512, Number(next.out_w || DEFAULT_OUT_SIZE), Number(next.out_h || DEFAULT_OUT_SIZE));
  const scale = base / Math.max(aw, ah);
  next.out_w = Math.max(256, roundToMultiple(aw * scale));
  next.out_h = Math.max(256, roundToMultiple(ah * scale));
  next.aspect_id = aspectId;
  return next;
}

export function applyPanoramaCustomAspect(shot: PanoramaShot, width: number, height: number): PanoramaShot {
  const rw = Math.max(1, Number(width));
  const rh = Math.max(1, Number(height));
  if (!Number.isFinite(rw) || !Number.isFinite(rh)) return clonePanoramaShot(shot);
  const next = clonePanoramaShot(shot);
  const nextFov = applyAspectRatioToShotFov(next, rw / rh);
  next.hFOV_deg = nextFov.hFOV_deg;
  next.vFOV_deg = nextFov.vFOV_deg;
  const base = Math.max(512, Number(next.out_w || DEFAULT_OUT_SIZE), Number(next.out_h || DEFAULT_OUT_SIZE));
  const scale = base / Math.max(rw, rh);
  next.out_w = Math.max(256, roundToMultiple(rw * scale));
  next.out_h = Math.max(256, roundToMultiple(rh * scale));
  next.aspect_id = `${Math.round(rw)}:${Math.round(rh)}`;
  return next;
}

export function scalePanoramaShotFieldOfView(shot: PanoramaShot, scaleFactor: number): PanoramaShot {
  const next = clonePanoramaShot(shot);
  const scale = Math.max(1e-4, Number(scaleFactor || 1));
  next.hFOV_deg = halfTanToFovDegrees(fovDegreesToHalfTan(Number(next.hFOV_deg || 64)) * scale);
  next.vFOV_deg = halfTanToFovDegrees(fovDegreesToHalfTan(Number(next.vFOV_deg || 40)) * scale);
  return next;
}

export function setPanoramaShotOutputSize(shot: PanoramaShot, width: number, height: number): PanoramaShot {
  const next = clonePanoramaShot(shot);
  next.out_w = Math.max(256, roundToMultiple(Number(width || next.out_w)));
  next.out_h = Math.max(256, roundToMultiple(Number(height || next.out_h)));
  next.aspect_id = `${next.out_w}:${next.out_h}`;
  return next;
}

export function setPanoramaShotOutputLongEdge(
  shot: PanoramaShot,
  longEdge = DEFAULT_PANORAMA_OUTPUT_LONG_EDGE,
): PanoramaShot {
  const next = clonePanoramaShot(shot);
  const currentW = Math.max(1, Number(next.out_w || DEFAULT_OUT_SIZE));
  const currentH = Math.max(1, Number(next.out_h || DEFAULT_OUT_SIZE));
  const safeLongEdge = Math.max(256, roundToMultiple(Number(longEdge || DEFAULT_PANORAMA_OUTPUT_LONG_EDGE)));
  if (currentW >= currentH) {
    next.out_w = safeLongEdge;
    next.out_h = Math.max(256, roundToMultiple(safeLongEdge * (currentH / currentW)));
  } else {
    next.out_h = safeLongEdge;
    next.out_w = Math.max(256, roundToMultiple(safeLongEdge * (currentW / currentH)));
  }
  return next;
}

export function buildPanoramaRoundtripRef(source: HistoryItem, shot: PanoramaShot): PanoramaRoundtripRef {
  const sourceWidth = Math.max(1, Number(source.width || source.previewWidth || 0));
  const sourceHeight = Math.max(1, Number(source.height || source.previewHeight || 0));
  return {
    sourceHistoryId: source.id,
    sourcePath: source.savedPath,
    roundtripState: {
      kind: "ty360_roundtrip_state",
      version: 1,
      projection_model: "pinhole_rectilinear",
      source_erp: {
        width: sourceWidth,
        height: sourceHeight,
        path: source.savedPath,
        history_id: source.id,
      },
      rect: {
        width: Math.max(8, Number(shot.out_w || DEFAULT_OUT_SIZE)),
        height: Math.max(8, Number(shot.out_h || DEFAULT_OUT_SIZE)),
      },
      pose: {
        yaw_deg: Number(shot.yaw_deg || 0),
        pitch_deg: Number(shot.pitch_deg || 0),
        roll_deg: Number(shot.roll_deg || 0),
        hFOV_deg: clamp(Number(shot.hFOV_deg || 90), 0.1, 179),
        vFOV_deg: clamp(Number(shot.vFOV_deg || 60), 0.1, 179),
      },
      source_aspect: Math.max(1, Number(shot.out_w || DEFAULT_OUT_SIZE)) / Math.max(1, Number(shot.out_h || DEFAULT_OUT_SIZE)),
    },
  };
}

export function panoramaShotFromRoundtripState(roundtripState: PanoramaRoundtripState): PanoramaShot {
  const rectWidth = Math.max(8, Number(roundtripState.rect?.width || DEFAULT_OUT_SIZE));
  const rectHeight = Math.max(8, Number(roundtripState.rect?.height || DEFAULT_OUT_SIZE));
  return {
    id: "roundtrip-shot",
    yaw_deg: Number(roundtripState.pose?.yaw_deg || 0),
    pitch_deg: Number(roundtripState.pose?.pitch_deg || 0),
    roll_deg: Number(roundtripState.pose?.roll_deg || 0),
    hFOV_deg: clamp(Number(roundtripState.pose?.hFOV_deg || 90), 0.1, 179),
    vFOV_deg: clamp(Number(roundtripState.pose?.vFOV_deg || 60), 0.1, 179),
    out_w: rectWidth,
    out_h: rectHeight,
    aspect_id: `${rectWidth}:${rectHeight}`,
  };
}

export function panoramaRoundtripFeatherMaskAt(
  normalizedU: number,
  normalizedV: number,
  featherFraction = 0.1,
): number {
  const feather = clamp(Number(featherFraction || 0), 0, 0.5);
  if (feather <= 1e-6) return 1;
  const u = clamp(Number(normalizedU || 0), 0, 1);
  const v = clamp(Number(normalizedV || 0), 0, 1);
  const edgeDistance = Math.min(u, 1 - u, v, 1 - v);
  return smoothstep(0, feather, edgeDistance);
}

export function panoramaPastebackMaskAlphaAt(
  mask: { width: number; height: number; data: ArrayLike<number> } | null | undefined,
  normalizedU: number,
  normalizedV: number,
): number {
  if (!mask) return 1;
  const width = Math.max(1, Number(mask.width || 0));
  const height = Math.max(1, Number(mask.height || 0));
  const data = mask.data;
  if (!width || !height || !data?.length) return 1;
  const rgba = sampleRgbaBilinear(
    { width, height, data: data as Uint8ClampedArray },
    clamp(Number(normalizedU || 0), 0, 1) * (width - 1),
    clamp(Number(normalizedV || 0), 0, 1) * (height - 1),
  );
  return clamp(rgba[3] / 255, 0, 1);
}

function imageToPastebackMask(mask: PanoramaPastebackMaskInput | null | undefined): RGBAImage | null {
  if (!mask?.image) return null;
  const featherPx = clamp(Number(mask.featherPx || 0), 0, 256);
  return imageToPixels(mask.image, featherPx);
}

function normalizePastebackAlignment(alignment: PanoramaPastebackAlignment | null | undefined): PanoramaPastebackAlignment | null {
  if (!alignment) return null;
  const featherFraction = Number(alignment.featherFraction);
  const brightness = Number(alignment.brightness);
  const contrast = Number(alignment.contrast);
  const hueRotationDeg = Number(alignment.hueRotationDeg);
  return {
    offsetXRatio: clamp(Number(alignment.offsetXRatio || 0), -2, 2),
    offsetYRatio: clamp(Number(alignment.offsetYRatio || 0), -2, 2),
    scale: clamp(Number(alignment.scale || 1), 0.05, 8),
    rotationDeg: Number.isFinite(Number(alignment.rotationDeg)) ? Number(alignment.rotationDeg) : 0,
    featherFraction: Number.isFinite(featherFraction) ? clamp(featherFraction, 0, 0.5) : undefined,
    brightness: Number.isFinite(brightness) ? clamp(brightness, 0.5, 1.5) : undefined,
    contrast: Number.isFinite(contrast) ? clamp(contrast, 0.5, 1.5) : undefined,
    hueRotationDeg: Number.isFinite(hueRotationDeg) ? clamp(hueRotationDeg, -180, 180) : undefined,
  };
}

export function mapPanoramaPastebackSample(
  normalizedU: number,
  normalizedV: number,
  rectWidth: number,
  rectHeight: number,
  expectedWidth: number,
  expectedHeight: number,
  alignment?: PanoramaPastebackAlignment | null,
): { x: number; y: number; inside: boolean } {
  const rectW = Math.max(1, Number(rectWidth || 0));
  const rectH = Math.max(1, Number(rectHeight || 0));
  const expectedW = Math.max(1, Number(expectedWidth || rectW));
  const expectedH = Math.max(1, Number(expectedHeight || rectH));
  const u = clamp(Number(normalizedU || 0), 0, 1);
  const v = clamp(Number(normalizedV || 0), 0, 1);
  const normalized = normalizePastebackAlignment(alignment);
  if (!normalized) {
    const x = u * (rectW - 1);
    const y = v * (rectH - 1);
    return { x, y, inside: x >= 0 && x <= rectW - 1 && y >= 0 && y <= rectH - 1 };
  }

  const expectedX = u * (expectedW - 1);
  const expectedY = v * (expectedH - 1);
  const expectedCx = (expectedW - 1) * 0.5;
  const expectedCy = (expectedH - 1) * 0.5;
  const translateX = normalized.offsetXRatio * expectedW;
  const translateY = normalized.offsetYRatio * expectedH;
  const baseScale = Math.min(expectedW / rectW, expectedH / rectH) || 1;
  const totalScale = Math.max(1e-4, baseScale * normalized.scale);
  const angle = -normalized.rotationDeg * DEG2RAD;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const tx = expectedX - expectedCx - translateX;
  const ty = expectedY - expectedCy - translateY;
  const rx = tx * cos - ty * sin;
  const ry = tx * sin + ty * cos;
  const x = rx / totalScale + (rectW - 1) * 0.5;
  const y = ry / totalScale + (rectH - 1) * 0.5;
  return {
    x,
    y,
    inside: x >= 0 && x <= rectW - 1 && y >= 0 && y <= rectH - 1,
  };
}

export function drawPanoramaCutoutPreview(
  ctx: CanvasRenderingContext2D,
  owner: DrawCacheOwner,
  image: HTMLImageElement,
  rect: { x: number; y: number; w: number; h: number },
  shot: PanoramaShot,
  quality: PanoramaPreviewQuality = "balanced",
) {
  if (!ctx || !image || !rect || rect.w <= 1 || rect.h <= 1) return false;
  if (!image.complete || !(image.naturalWidth || image.width)) return false;
  const imageWidth = Number(image.naturalWidth || image.width || 0);
  const imageHeight = Number(image.naturalHeight || image.height || 0);
  if (imageWidth <= 1 || imageHeight <= 1) return false;
  const source = getWrappedErpCanvas(owner, image) || image;
  const { Nu, Nv, verts, sample } = createPreviewGrid(rect, shot, imageWidth, imageHeight, quality);
  let drawn = 0;
  for (let j = 0; j < Nv; j += 1) {
    for (let i = 0; i < Nu; i += 1) {
      const p00 = verts[j][i];
      const p10 = verts[j][i + 1];
      const p01 = verts[j + 1][i];
      const p11 = verts[j + 1][i + 1];
      const s00 = { ...sample[j][i] };
      const s10 = { ...sample[j][i + 1] };
      const s01 = { ...sample[j + 1][i] };
      const s11 = { ...sample[j + 1][i + 1] };
      const umin = Math.min(s00.x, s10.x, s01.x, s11.x);
      const umax = Math.max(s00.x, s10.x, s01.x, s11.x);
      if (umax - umin > imageWidth * 0.5) {
        [s00, s10, s01, s11].forEach((point) => {
          if (point.x < imageWidth * 0.5) point.x += imageWidth;
        });
      }
      if (drawImageTriangle(ctx, source, s00, s10, s11, p00, p10, p11)) drawn += 1;
      if (drawImageTriangle(ctx, source, s00, s11, s01, p00, p11, p01)) drawn += 1;
    }
  }
  return drawn > 0;
}

export function buildPanoramaPanoOverlayGeometry(
  shot: PanoramaShot,
  viewYawDeg: number,
  viewPitchDeg: number,
  viewFovDeg: number,
  viewportWidth: number,
  viewportHeight: number,
): PanoramaPanoOverlayGeometry {
  const width = Number(viewportWidth || 0);
  const height = Number(viewportHeight || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return emptyPanoramaPanoOverlayGeometry();
  }

  const viewBasis = cameraBasis(viewYawDeg, viewPitchDeg, 0);
  const center = projectDirectionToPanoViewport(
    yawPitchToDir(shot.yaw_deg, shot.pitch_deg),
    viewBasis,
    width,
    height,
    viewFovDeg,
    false,
  );
  if (!center) return emptyPanoramaPanoOverlayGeometry();

  const cornerDirections = [
    directionFromShot(shot, -1, 1),
    directionFromShot(shot, 1, 1),
    directionFromShot(shot, 1, -1),
    directionFromShot(shot, -1, -1),
  ];
  const corners = cornerDirections.map((direction) => projectDirectionToPanoViewport(
    direction,
    viewBasis,
    width,
    height,
    viewFovDeg,
    true,
  ));
  if (corners.some((point) => !point)) return emptyPanoramaPanoOverlayGeometry();

  const midpointDefs = [
    { edge: "top" as const, direction: directionFromShot(shot, 0, 1), a: 0, b: 1 },
    { edge: "right" as const, direction: directionFromShot(shot, 1, 0), a: 1, b: 2 },
    { edge: "bottom" as const, direction: directionFromShot(shot, 0, -1), a: 2, b: 3 },
    { edge: "left" as const, direction: directionFromShot(shot, -1, 0), a: 3, b: 0 },
  ];
  const edgeMidpoints = midpointDefs.map((midpoint) => {
    const point = projectDirectionToPanoViewport(
      midpoint.direction,
      viewBasis,
      width,
      height,
      viewFovDeg,
      true,
    );
    if (!point) return null;
    return {
      edge: midpoint.edge,
      x: point.x,
      y: point.y,
      a: corners[midpoint.a] as PanoramaOverlayPoint,
      b: corners[midpoint.b] as PanoramaOverlayPoint,
    };
  });
  if (edgeMidpoints.some((point) => !point)) return emptyPanoramaPanoOverlayGeometry();

  const tanY = Math.tan(clamp(shot.vFOV_deg, 1, 179) * 0.5 * DEG2RAD);
  const rotateStemBase = projectDirectionToPanoViewport(
    directionFromShot(shot, 0, 1),
    viewBasis,
    width,
    height,
    viewFovDeg,
    true,
  );
  const rotateHandleHint = projectDirectionToPanoViewport(
    directionFromShot(shot, 0, 1 + (Math.max(tanY * 0.43, 0.053) / Math.max(tanY, 1e-4))),
    viewBasis,
    width,
    height,
    viewFovDeg,
    true,
  );
  if (!rotateStemBase || !rotateHandleHint) return emptyPanoramaPanoOverlayGeometry();
  const handleDx = rotateHandleHint.x - rotateStemBase.x;
  const handleDy = rotateHandleHint.y - rotateStemBase.y;
  const handleLength = Math.hypot(handleDx, handleDy) || 1;
  const rotateHandle = {
    x: rotateStemBase.x + (handleDx / handleLength) * 30,
    y: rotateStemBase.y + (handleDy / handleLength) * 30,
  };

  return {
    visible: true,
    center,
    corners: corners as PanoramaOverlayPoint[],
    edgeMidpoints: edgeMidpoints as PanoramaPanoOverlayEdgeMidpoint[],
    rotateStemBase,
    rotateHandle,
  };
}

export function exportPanoramaCutoutBase64(
  sourceImage: CanvasImageSource,
  shot: PanoramaShot,
): { imageB64: string; width: number; height: number } {
  const source = imageToPixels(sourceImage);
  const outW = Math.max(8, roundToMultiple(Number(shot.out_w || DEFAULT_OUT_SIZE)));
  const outH = Math.max(8, roundToMultiple(Number(shot.out_h || DEFAULT_OUT_SIZE)));
  const output = new Uint8ClampedArray(outW * outH * 4);
  const tanX = Math.tan(Math.max(1e-3, Number(shot.hFOV_deg || 90)) * 0.5 * DEG2RAD);
  const tanY = Math.tan(Math.max(1e-3, Number(shot.vFOV_deg || 60)) * 0.5 * DEG2RAD);
  const { right, up, fwd } = orthonormalBasisFromForward(yawPitchToDir(Number(shot.yaw_deg || 0), Number(shot.pitch_deg || 0)));
  const roll = Number(shot.roll_deg || 0);
  const cos = Math.cos(roll * DEG2RAD);
  const sin = Math.sin(roll * DEG2RAD);

  for (let y = 0; y < outH; y += 1) {
    const yNorm = 1 - ((y + 0.5) / outH) * 2;
    for (let x = 0; x < outW; x += 1) {
      const xNorm = ((x + 0.5) / outW) * 2 - 1;
      let localX = xNorm * tanX;
      let localY = yNorm * tanY;
      if (Math.abs(roll) > 1e-6) {
        const nextX = localX * cos - localY * sin;
        const nextY = localX * sin + localY * cos;
        localX = nextX;
        localY = nextY;
      }
      const direction = norm(add(add(fwd, mul(right, localX)), mul(up, localY)));
      const lon = Math.atan2(direction.x, direction.z);
      const lat = Math.asin(clamp(direction.y, -1, 1));
      let u = ((lon / (2 * Math.PI)) + 0.5) * source.width;
      while (u < 0) u += source.width;
      while (u >= source.width) u -= source.width;
      const v = clamp((0.5 - lat / Math.PI) * source.height, 0, source.height - 1);
      setPixel(output, outW, x, y, sampleRgbaBilinear(source, u, v));
    }
  }

  return {
    imageB64: writePixelsToBase64({ width: outW, height: outH, data: output }),
    width: outW,
    height: outH,
  };
}

function iterWrappedURanges(centerU: number, halfU: number, width: number) {
  const start = Math.floor(centerU - halfU);
  const end = Math.ceil(centerU + halfU);
  if (start < 0) {
    return [[start + width, width], [0, end]] as const;
  }
  if (end >= width) {
    return [[start, width], [0, end - width]] as const;
  }
  return [[start, end]] as const;
}

export function pastePanoramaRoundtripBase64(
  sourceImage: CanvasImageSource,
  rectImage: CanvasImageSource,
  roundtripState: PanoramaRoundtripState,
  alignment?: PanoramaPastebackAlignment | null,
  pasteMask?: PanoramaPastebackMaskInput | null,
): { imageB64: string; width: number; height: number } {
  const source = imageToPixels(sourceImage);
  const rect = imageToPixels(rectImage);
  const mask = imageToPastebackMask(pasteMask);
  const expectedWidth = Math.max(1, Number(roundtripState.source_erp.width || 0));
  const expectedHeight = Math.max(1, Number(roundtripState.source_erp.height || 0));
  if (source.width !== expectedWidth || source.height !== expectedHeight) {
    throw new Error(`ERP size ${source.width}x${source.height} does not match ${expectedWidth}x${expectedHeight}`);
  }
  const actualAspect = rect.width / Math.max(1, rect.height);
  const normalizedAlignment = normalizePastebackAlignment(alignment);
  if (!normalizedAlignment && Math.abs(actualAspect - Number(roundtripState.source_aspect || 1)) > 1e-3) {
    throw new Error(`Edited rect aspect ${actualAspect.toFixed(6)} does not match ${Number(roundtripState.source_aspect || 1).toFixed(6)}`);
  }

  const output = new Uint8ClampedArray(source.data);
  const pose = roundtripState.pose;
  const forward = yawPitchToDir(Number(pose.yaw_deg || 0), Number(pose.pitch_deg || 0));
  const { right, up, fwd } = orthonormalBasisFromForward(forward);
  const hFov = Math.max(0.1, Number(pose.hFOV_deg || 90));
  const vFov = Math.max(0.1, Number(pose.vFOV_deg || 60));
  const roll = Number(pose.roll_deg || 0);
  const maxFov = Math.max(hFov, vFov);
  const halfU = Math.ceil(source.width * (maxFov / 360) * 1.2);
  const halfV = Math.ceil(source.height * (maxFov / 180) * 1.2);
  const centerU = ((Number(pose.yaw_deg || 0) / 360) + 0.5) * source.width;
  const centerV = (0.5 - Number(pose.pitch_deg || 0) / 180) * source.height;
  const tanH = Math.tan(hFov * 0.5 * DEG2RAD);
  const tanV = Math.tan(vFov * 0.5 * DEG2RAD);
  const rot = -roll * DEG2RAD;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const yMin = Math.max(0, Math.floor(centerV - halfV));
  const yMax = Math.min(source.height, Math.ceil(centerV + halfV));

  for (const [start, end] of iterWrappedURanges(centerU, halfU, source.width)) {
    const x0 = Math.max(0, start);
    const x1 = Math.min(source.width, end);
    if (x1 <= x0) continue;
    for (let y = yMin; y < yMax; y += 1) {
      const lat = (0.5 - (y + 0.5) / source.height) * Math.PI;
      const cosLat = Math.cos(lat);
      const sinLat = Math.sin(lat);
      for (let x = x0; x < x1; x += 1) {
        const lon = (((x + 0.5) / source.width) - 0.5) * (2 * Math.PI);
        const direction = vec3(cosLat * Math.sin(lon), sinLat, cosLat * Math.cos(lon));
        const z = dot(direction, fwd);
        if (z <= 1e-6) continue;
        const localX = dot(direction, right) / z;
        const localY = dot(direction, up) / z;
        const xr = localX * cos - localY * sin;
        const yr = localX * sin + localY * cos;
        const xn = xr / tanH;
        const yn = yr / tanV;
        if (Math.abs(xn) > 1 || Math.abs(yn) > 1) continue;
        const normalizedU = xn * 0.5 + 0.5;
        const normalizedV = 0.5 - yn * 0.5;
        const sample = mapPanoramaPastebackSample(
          normalizedU,
          normalizedV,
          rect.width,
          rect.height,
          Math.max(1, Number(roundtripState.rect?.width || rect.width)),
          Math.max(1, Number(roundtripState.rect?.height || rect.height)),
          normalizedAlignment,
        );
        if (!sample.inside) continue;
        const maskAlpha = panoramaPastebackMaskAlphaAt(mask, normalizedU, normalizedV);
        if (maskAlpha <= 1e-6) continue;
        const rgba = sampleRgbaBilinear(rect, sample.x, sample.y);
        const alpha = (rgba[3] / 255) * panoramaRoundtripFeatherMaskAt(
          normalizedU,
          normalizedV,
          normalizedAlignment?.featherFraction ?? 0.1,
        ) * maskAlpha;
        const [r, g, b] = applyPastebackColorAdjustments(rgba, normalizedAlignment);
        const offset = (y * source.width + x) * 4;
        output[offset] = r * alpha + output[offset] * (1 - alpha);
        output[offset + 1] = g * alpha + output[offset + 1] * (1 - alpha);
        output[offset + 2] = b * alpha + output[offset + 2] * (1 - alpha);
        output[offset + 3] = 255;
      }
    }
  }

  return {
    imageB64: writePixelsToBase64({ width: source.width, height: source.height, data: output }),
    width: source.width,
    height: source.height,
  };
}
