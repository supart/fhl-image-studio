import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { historyFullSrc } from "../../lib/images";
import { persistHistoryItem } from "../../lib/storage";
import { ImportImageFromB64, RegisterImportedImageAsset } from "../../platform/runtime/host";
import {
  DEFAULT_PANORAMA_OUTPUT_LONG_EDGE,
  PANORAMA_ASPECT_PRESETS,
  applyPanoramaAspectPreset,
  applyPanoramaCustomAspect,
  buildPanoramaPanoOverlayGeometry,
  buildPanoramaProjectRef,
  buildPanoramaRoundtripRef,
  clamp,
  drawPanoramaCutoutPreview,
  exportPanoramaCutoutBase64,
  hasPanoramaRoundtripRef,
  isLikelyPanoramaItem,
  panoramaProjectOutputsForSource,
  scalePanoramaShotFieldOfView,
  setPanoramaShotOutputLongEdge,
  setPanoramaShotOutputSize,
  wrapYaw,
  type PanoramaPanoOverlayGeometry,
} from "../../panorama/core";
import { renderPanoramaViewToContext2D } from "../../panorama/glPreview";
import { useStudioStore } from "../../state/studioStore";
import { cryptoIDFallback, toPreviewOnlyHistoryItem, withMediaAssetRef } from "../../state/studioStore.runtime";
import { persistTrimmedHistory, tempDataURLFromB64, trimHistory } from "../../state/studioStore.shared";
import { patchWorkspaceRuntime } from "../../state/workspaceRuntime";
import type { HistoryItem, PanoramaShot, SizeValue, SourceImage } from "../../types/domain";
import { useImageFromSource } from "../canvas/canvasImage";
import {
  aspectPresetsForAPIMode,
  buildAspectSizeSelection,
  deriveResolutionPreset,
  type AspectPreset,
} from "../panel/sizeCapabilities";
import "./panoramaTy360.css";

type DrawOwner = {
  __panoWrappedErpCache?: {
    src: string;
    w: number;
    h: number;
    canvas: HTMLCanvasElement | null;
  };
};

type ViewMode = "pano" | "unwrap";
type PreviewQuality = "draft" | "balanced" | "high";
type OutputSizeMode = "dimensions" | "longest";
type EditorView = {
  yaw_deg: number;
  pitch_deg: number;
  fov_deg: number;
};
type Snapshot = {
  shot: PanoramaShot | null;
  view: EditorView;
};
type TooltipState = {
  text: string;
  left: number;
  top: number;
  visible: boolean;
};
type OutputPreviewAnchor = {
  visible: boolean;
  left: number;
  top: number;
};
type PanoOverlayHit =
  | { kind: "none"; cursor: string }
  | { kind: "move"; cursor: string }
  | { kind: "scale"; cursor: string; cornerIdx: number }
  | { kind: "scale_x" | "scale_y"; cursor: string; edge: "top" | "right" | "bottom" | "left" }
  | { kind: "rotate"; cursor: string };
type PanoShotDragState = {
  active: boolean;
  pointerId: number | null;
  kind: PanoOverlayHit["kind"];
  cursor: string;
  offsetX: number;
  offsetY: number;
  centerX: number;
  centerY: number;
  startDist: number;
  startHFOV: number;
  startVFOV: number;
  startRoll: number;
  startAngle: number;
};
type Vec3 = { x: number; y: number; z: number };

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const PANO_DRAG_SENSITIVITY = 0.12;
const PANO_WHEEL_STEP = 3;
const PANO_FOV_MIN = 35;
const PANO_FOV_MAX = 140;
const PANO_INITIAL_FOV = 100;
const PANO_INERTIA_BLEND_OLD = 0.4;
const PANO_INERTIA_BLEND_INST = 0.6;
const PANO_INERTIA_DAMPING = 5.5;
const PANO_INERTIA_START_SPEED = 20;
const PANO_INERTIA_STOP_SPEED = 0.8;
const MAX_HISTORY_DEPTH = 48;
const PANORAMA_SHOT_EDIT_PROMPT = "修改画面，保持构图不变，";

const ICON = {
  globe: "<svg viewBox='0 0 24 24' aria-hidden='true' fill='none' stroke='currentColor' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' shape-rendering='geometricPrecision'><circle cx='12' cy='12' r='10'/><path d='M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z'/></svg>",
  pano: "<svg viewBox='0 0 16 16' aria-hidden='true'><path d='M1.5 8.2c1.9-2.2 4.1-3.3 6.5-3.3s4.6 1.1 6.5 3.3'/><path d='M2.6 10.9c1.5-1.5 3.3-2.3 5.4-2.3s3.9.8 5.4 2.3'/><circle cx='8' cy='12.2' r='1' fill='currentColor' stroke='none'/></svg>",
  unwrap: "<svg viewBox='0 0 16 16' aria-hidden='true'><rect x='1.75' y='3' width='12.5' height='10' rx='2'/><path d='M5.9 3v10M10.1 3v10'/></svg>",
  undo: "<svg viewBox='0 0 16 16' aria-hidden='true'><path d='M5.5 4.3 2.8 7l2.7 2.7'/><path d='M3.1 7h5.3a3.7 3.7 0 1 1 0 7.4'/></svg>",
  redo: "<svg viewBox='0 0 16 16' aria-hidden='true'><path d='m10.5 4.3 2.7 2.7-2.7 2.7'/><path d='M12.9 7H7.6a3.7 3.7 0 1 0 0 7.4'/></svg>",
  add: "<svg viewBox='0 0 16 16' aria-hidden='true'><path d='M8 3.1v9.8M3.1 8h9.8'/></svg>",
  clear: "<svg viewBox='0 0 16 16' aria-hidden='true'><path d='M2.8 4.4h10.4'/><path d='m5.8 4.4.6-1.4h3.2l.6 1.4'/><path d='M4.5 4.4v8a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-8'/><path d='M6.7 6.5v4.7M9.3 6.5v4.7'/></svg>",
  aspect: "<svg viewBox='0 0 16 16' aria-hidden='true'><path fill-rule='evenodd' clip-rule='evenodd' d='M14.866 14.7041C13.9131 14.5727 12.9574 14.4687 12 14.3923V12.8876C12.8347 12.9523 13.6683 13.0373 14.4999 13.1426L14.5 9.00003H16L15.9999 14L15.9999 14.8605L15.1475 14.7429L14.866 14.7041ZM16 7.00003L16 2.49996L16 1.6394L15.1475 1.75699L14.866 1.79581C13.9131 1.92725 12.9574 2.03119 12 2.10765V3.61228C12.8347 3.54757 13.6683 3.46256 14.5 3.35727L14.5 7.00003H16ZM9.99998 2.22729V3.72844C8.66715 3.77999 7.33282 3.77999 5.99998 3.72844V2.22729C7.33279 2.28037 8.66718 2.28037 9.99998 2.22729ZM9.99998 14.2726V12.7715C8.66715 12.7199 7.33282 12.7199 5.99998 12.7715V14.2726C7.33279 14.2195 8.66718 14.2195 9.99998 14.2726ZM3.99998 14.3923C3.04258 14.4687 2.08683 14.5727 1.13391 14.7041L0.85242 14.7429L-0.0000610352 14.8605L-0.0000578761 14L-0.0000396322 9.00003H1.49996L1.49995 13.1426C2.33162 13.0373 3.16521 12.9523 3.99998 12.8876V14.3923ZM1.49997 7.00003L1.49998 3.35727C2.33164 3.46256 3.16522 3.54757 3.99998 3.61228V2.10765C3.0426 2.03119 2.08686 1.92725 1.13395 1.79581L0.852462 1.75699L-0.0000127554 1.6394L-0.0000159144 2.49995L-0.0000323345 7.00003H1.49997Z' fill='currentColor'/></svg>",
  rotate_90: "<svg viewBox='0 0 16 16' aria-hidden='true'><path fill-rule='evenodd' clip-rule='evenodd' d='M6.21967 4.71967L5.68934 5.25L6.75 6.31066L7.28033 5.78033L9.25 3.81066V13.5C9.25 13.6381 9.13807 13.75 9 13.75H2.75H2V15.25H2.75H9C9.9665 15.25 10.75 14.4665 10.75 13.5V3.81066L12.7197 5.78033L13.25 6.31066L14.3107 5.25L13.7803 4.71967L10.5303 1.46967C10.2374 1.17678 9.76256 1.17678 9.46967 1.46967L6.21967 4.71967Z' fill='currentColor'/></svg>",
  reset: "<svg viewBox='0 0 16 16' aria-hidden='true'><path d='M8 3.2a4.8 4.8 0 1 1-4.8 4.8'/><path d='M3.2 3.2v3.6h3.6'/></svg>",
  eye: "<svg viewBox='0 0 16 16' aria-hidden='true'><path fill-rule='evenodd' clip-rule='evenodd' d='M4.02168 4.76932C6.11619 2.33698 9.88374 2.33698 11.9783 4.76932L14.7602 7.99999L11.9783 11.2307C9.88374 13.663 6.1162 13.663 4.02168 11.2307L1.23971 7.99999L4.02168 4.76932ZM13.1149 3.79054C10.422 0.663244 5.57797 0.663247 2.88503 3.79054L-0.318359 7.5106V8.48938L2.88503 12.2094C5.57797 15.3367 10.422 15.3367 13.1149 12.2094L16.3183 8.48938V7.5106L13.1149 3.79054ZM6.49997 7.99999C6.49997 7.17157 7.17154 6.49999 7.99997 6.49999C8.82839 6.49999 9.49997 7.17157 9.49997 7.99999C9.49997 8.82842 8.82839 9.49999 7.99997 9.49999C7.17154 9.49999 6.49997 8.82842 6.49997 7.99999ZM7.99997 4.99999C6.34311 4.99999 4.99997 6.34314 4.99997 7.99999C4.99997 9.65685 6.34311 11 7.99997 11C9.65682 11 11 9.65685 11 7.99999C11 6.34314 9.65682 4.99999 7.99997 4.99999Z' fill='currentColor'/></svg>",
  eye_dashed: "<svg viewBox='0 0 16 16' aria-hidden='true'><path fill-rule='evenodd' clip-rule='evenodd' d='M6.51404 3.15793C7.48217 2.87411 8.51776 2.87411 9.48589 3.15793L9.90787 1.71851C8.66422 1.35392 7.33571 1.35392 6.09206 1.71851L6.51404 3.15793ZM10.848 3.78166C11.2578 4.04682 11.6393 4.37568 11.9783 4.76932L13.046 6.00934L14.1827 5.03056L13.1149 3.79054C12.6818 3.28761 12.1918 2.86449 11.6628 2.52224L10.848 3.78166ZM4.02168 4.76932C4.36065 4.37568 4.74209 4.04682 5.15195 3.78166L4.33717 2.52225C3.80815 2.86449 3.3181 3.28761 2.88503 3.79054L1.81723 5.03056L2.95389 6.00934L4.02168 4.76932ZM14.1138 7.24936L14.7602 7.99999L14.1138 8.75062L15.2505 9.72941L16.3183 8.48938V7.5106L15.2505 6.27058L14.1138 7.24936ZM1.88609 7.24936L1.23971 7.99999L1.88609 8.75062L0.749437 9.72941L-0.318359 8.48938V7.5106L0.749436 6.27058L1.88609 7.24936ZM13.0461 9.99064L11.9783 11.2307C11.6393 11.6243 11.2578 11.9532 10.848 12.2183L11.6628 13.4777C12.1918 13.1355 12.6818 12.7124 13.1149 12.2094L14.1827 10.9694L13.0461 9.99064ZM4.02168 11.2307L2.95389 9.99064L1.81723 10.9694L2.88503 12.2094C3.3181 12.7124 3.80815 13.1355 4.33717 13.4777L5.15195 12.2183C4.7421 11.9532 4.36065 11.6243 4.02168 11.2307ZM9.90787 14.2815L9.48589 12.8421C8.51776 13.1259 7.48217 13.1259 6.51405 12.8421L6.09206 14.2815C7.33572 14.6461 8.66422 14.6461 9.90787 14.2815ZM6.49997 7.99999C6.49997 7.17157 7.17154 6.49999 7.99997 6.49999C8.82839 6.49999 9.49997 7.17157 9.49997 7.99999C9.49997 8.82842 8.82839 9.49999 7.99997 9.49999C7.17154 9.49999 6.49997 8.82842 6.49997 7.99999ZM7.99997 4.99999C6.34311 4.99999 4.99997 6.34314 4.99997 7.99999C4.99997 9.65685 6.34311 11 7.99997 11C9.65682 11 11 9.65685 11 7.99999C11 6.34314 9.65682 4.99999 7.99997 4.99999Z' fill='currentColor'/></svg>",
  fullscreen: "<svg viewBox='0 0 16 16' aria-hidden='true'><path fill-rule='evenodd' clip-rule='evenodd' d='M1 5.25V6H2.5V5.25V2.5H5.25H6V1H5.25H2C1.44772 1 1 1.44772 1 2V5.25ZM5.25 14.9994H6V13.4994H5.25H2.5V10.7494V9.99939H1V10.7494V13.9994C1 14.5517 1.44772 14.9994 2 14.9994H5.25ZM15 10V10.75V14C15 14.5523 14.5523 15 14 15H10.75H10V13.5H10.75H13.5V10.75V10H15ZM10.75 1H10V2.5H10.75H13.5V5.25V6H15V5.25V2C15 1.44772 14.5523 1 14 1H10.75Z' fill='currentColor'/></svg>",
  fullscreen_close: "<svg viewBox='0 0 16 16' aria-hidden='true'><path fill-rule='evenodd' clip-rule='evenodd' d='M6 1V1.75V5C6 5.55229 5.55228 6 5 6H1.75H1V4.5H1.75H4.5V1.75V1H6ZM14.25 6H15V4.5H14.25H11.5V1.75V1H10V1.75V5C10 5.55228 10.4477 6 11 6H14.25ZM10 14.25V15H11.5V14.25V11.5H14.29H15.04V10H14.29H11C10.4477 10 10 10.4477 10 11V14.25ZM1.75 10H1V11.5H1.75H4.5V14.25V15H6V14.25V11C6 10.4477 5.55229 10 5 10H1.75Z' fill='currentColor'/></svg>",
  camera: "<svg viewBox='0 0 16 16' aria-hidden='true'><path fill-rule='evenodd' clip-rule='evenodd' d='M1.5 3.5H3.5L5 1H11L12.5 3.5H14.5H16V5V12.5C16 13.8807 14.8807 15 13.5 15H2.5C1.11929 15 0 13.8807 0 12.5V5V3.5H1.5ZM4.78624 4.27174L5.84929 2.5H10.1507L11.2138 4.27174L11.6507 5H12.5H14.5V12.5C14.5 13.0523 14.0523 13.5 13.5 13.5H2.5C1.94772 13.5 1.5 13.0523 1.5 12.5V5H3.5H4.34929L4.78624 4.27174ZM9.75 8.5C9.75 9.4665 8.9665 10.25 8 10.25C7.0335 10.25 6.25 9.4665 6.25 8.5C6.25 7.5335 7.0335 6.75 8 6.75C8.9665 6.75 9.75 7.5335 9.75 8.5ZM11.25 8.5C11.25 10.2949 9.79493 11.75 8 11.75C6.20507 11.75 4.75 10.2949 4.75 8.5C4.75 6.70507 6.20507 5.25 8 5.25C9.79493 5.25 11.25 6.70507 11.25 8.5Z' fill='currentColor'/></svg>",
  copy: "<svg viewBox='0 0 16 16' aria-hidden='true'><rect x='5.2' y='5.2' width='7.8' height='7.8' rx='1.4'/><rect x='3' y='3' width='7.8' height='7.8' rx='1.4'/></svg>",
  chevron: "<svg viewBox='0 0 16 16' aria-hidden='true'><path d='m4.5 6.5 3.5 3.5 3.5-3.5'/></svg>",
} as const;

function sizeValueFromDimensions(width: number, height: number): SizeValue {
  return `${Math.max(1, Math.round(width))}x${Math.max(1, Math.round(height))}` as SizeValue;
}

function normalizeOutputLongEdge(value: number) {
  return Math.max(256, Math.round(Number(value || DEFAULT_PANORAMA_OUTPUT_LONG_EDGE) / 8) * 8);
}

function fileNameFromPath(path: string | undefined, fallback: string) {
  return String(path || "").trim().split(/[\\/]/).pop() || fallback;
}

function cloneShot(shot: PanoramaShot | null): PanoramaShot | null {
  return shot ? { ...shot } : null;
}

function cloneView(view: EditorView): EditorView {
  return { ...view };
}

function createSnapshot(shot: PanoramaShot | null, view: EditorView): Snapshot {
  return { shot: cloneShot(shot), view: cloneView(view) };
}

function equalShots(a: PanoramaShot | null, b: PanoramaShot | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id
    && a.yaw_deg === b.yaw_deg
    && a.pitch_deg === b.pitch_deg
    && a.roll_deg === b.roll_deg
    && a.hFOV_deg === b.hFOV_deg
    && a.vFOV_deg === b.vFOV_deg
    && a.out_w === b.out_w
    && a.out_h === b.out_h
    && a.aspect_id === b.aspect_id;
}

function equalView(a: EditorView, b: EditorView) {
  return a.yaw_deg === b.yaw_deg && a.pitch_deg === b.pitch_deg && a.fov_deg === b.fov_deg;
}

function equalSnapshots(a: Snapshot | null, b: Snapshot | null) {
  if (!a || !b) return a === b;
  return equalShots(a.shot, b.shot) && equalView(a.view, b.view);
}

function createTy360DefaultShot(): PanoramaShot {
  return setPanoramaShotOutputLongEdge(applyPanoramaAspectPreset({
    id: "panorama-shot-1",
    yaw_deg: 0,
    pitch_deg: 0,
    roll_deg: 0,
    hFOV_deg: 90,
    vFOV_deg: 60,
    out_w: 1024,
    out_h: 1024,
    aspect_id: "1:1",
  }, "1:1"), DEFAULT_PANORAMA_OUTPUT_LONG_EDGE);
}

function createTy360ShotFromView(view: EditorView): PanoramaShot {
  return setPanoramaShotOutputLongEdge(applyPanoramaAspectPreset({
    id: "panorama-shot-1",
    yaw_deg: view.yaw_deg,
    pitch_deg: view.pitch_deg,
    roll_deg: 0,
    hFOV_deg: 64,
    vFOV_deg: 40,
    out_w: 1024,
    out_h: 1024,
    aspect_id: "1:1",
  }, "1:1"), DEFAULT_PANORAMA_OUTPUT_LONG_EDGE);
}

function createDefaultEditorView(): EditorView {
  return {
    yaw_deg: 0,
    pitch_deg: 0,
    fov_deg: PANO_INITIAL_FOV,
  };
}

function verticalFovFromHorizontal(hFovDeg: number, aspect: number) {
  const clampedAspect = Math.max(0.01, Number(aspect || 1));
  const radians = clamp(Number(hFovDeg || PANO_INITIAL_FOV), 1, 179) * DEG2RAD;
  return clamp(2 * Math.atan(Math.tan(radians / 2) / clampedAspect) * RAD2DEG, 1, 179);
}

function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x + b.x, a.y + b.y, a.z + b.z);
}

function mul(v: Vec3, scalar: number): Vec3 {
  return vec3(v.x * scalar, v.y * scalar, v.z * scalar);
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return vec3(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x,
  );
}

function norm(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z) || 1e-8;
  return vec3(v.x / length, v.y / length, v.z / length);
}

function yawPitchToDir(yawDeg: number, pitchDeg: number): Vec3 {
  const yaw = yawDeg * DEG2RAD;
  const pitch = pitchDeg * DEG2RAD;
  const cp = Math.cos(pitch);
  return vec3(cp * Math.sin(yaw), Math.sin(pitch), cp * Math.cos(yaw));
}

function orthonormalBasisFromForward(forward: Vec3) {
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

function getUnwrapRect(width: number, height: number) {
  const targetAspect = 2;
  const canvasAspect = width / Math.max(height, 1);
  if (canvasAspect >= targetAspect) {
    const rectHeight = height;
    const rectWidth = rectHeight * targetAspect;
    return { x: (width - rectWidth) * 0.5, y: 0, w: rectWidth, h: rectHeight };
  }
  const rectWidth = width;
  const rectHeight = rectWidth / targetAspect;
  return { x: 0, y: (height - rectHeight) * 0.5, w: rectWidth, h: rectHeight };
}

function directionFromShot(shot: PanoramaShot, normalizedX: number, normalizedY: number): Vec3 {
  const basis = cameraBasis(shot.yaw_deg, shot.pitch_deg, shot.roll_deg);
  const tanX = Math.tan(clamp(shot.hFOV_deg, 1, 179) * 0.5 * DEG2RAD);
  const tanY = Math.tan(clamp(shot.vFOV_deg, 1, 179) * 0.5 * DEG2RAD);
  return norm(add(add(basis.fwd, mul(basis.right, normalizedX * tanX)), mul(basis.up, normalizedY * tanY)));
}

function directionToUnwrapPoint(direction: Vec3, rect: { x: number; y: number; w: number; h: number }) {
  const lon = Math.atan2(direction.x, direction.z);
  const lat = Math.asin(clamp(direction.y, -1, 1));
  return {
    x: rect.x + ((lon / (2 * Math.PI)) + 0.5) * rect.w,
    y: rect.y + (0.5 - lat / Math.PI) * rect.h,
  };
}

function directionToYawPitch(direction: Vec3) {
  return {
    yaw_deg: wrapYaw(Math.atan2(direction.x, direction.z) * RAD2DEG),
    pitch_deg: clamp(Math.asin(clamp(direction.y, -1, 1)) * RAD2DEG, -89.9, 89.9),
  };
}

function buildShotBorder(directionBuilder: (x: number, y: number) => Vec3, samples = 16): Vec3[] {
  const points: Vec3[] = [];
  for (let i = 0; i <= samples; i += 1) points.push(directionBuilder(-1 + (i / samples) * 2, 1));
  for (let i = 1; i <= samples; i += 1) points.push(directionBuilder(1, 1 - (i / samples) * 2));
  for (let i = 1; i <= samples; i += 1) points.push(directionBuilder(1 - (i / samples) * 2, -1));
  for (let i = 1; i < samples; i += 1) points.push(directionBuilder(-1, -1 + (i / samples) * 2));
  return points;
}

function buildWrappedPolygons(shot: PanoramaShot, rect: { x: number; y: number; w: number; h: number }) {
  const border = buildShotBorder((x, y) => directionFromShot(shot, x, y), 18);
  const points = border.map((direction) => directionToUnwrapPoint(direction, rect));
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  if (maxX - minX <= rect.w * 0.5) return [points];
  const shifted = points.map((point) => (
    point.x < rect.x + rect.w * 0.5 ? { x: point.x + rect.w, y: point.y } : { ...point }
  ));
  return [shifted, shifted.map((point) => ({ x: point.x - rect.w, y: point.y }))];
}

function fitCanvasToDisplay(canvas: HTMLCanvasElement) {
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return { width, height };
}

function drawLoop(ctx: CanvasRenderingContext2D, points: Array<{ x: number; y: number }>) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y);
  }
  ctx.closePath();
}

function pointInPolygon(point: { x: number; y: number }, polygon: Array<{ x: number; y: number }>) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y))
      && (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-8) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function dist2(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function hitPanoOverlayHandle(overlay: PanoramaPanoOverlayGeometry, point: { x: number; y: number }): PanoOverlayHit {
  if (!overlay.visible || !overlay.center || overlay.corners.length !== 4) {
    return { kind: "none", cursor: "grab" };
  }
  const edgeMidpoint = overlay.edgeMidpoints.find((midpoint) => dist2(midpoint, point) <= 13 * 13);
  if (edgeMidpoint) {
    const horizontal = edgeMidpoint.edge === "left" || edgeMidpoint.edge === "right";
    return {
      kind: horizontal ? "scale_x" : "scale_y",
      cursor: horizontal ? "ew-resize" : "ns-resize",
      edge: edgeMidpoint.edge,
    };
  }
  const cornerIdx = overlay.corners.findIndex((corner) => dist2(corner, point) <= 11 * 11);
  if (cornerIdx >= 0) {
    const corner = overlay.corners[cornerIdx];
    const vx = corner.x - overlay.center.x;
    const vy = corner.y - overlay.center.y;
    return {
      kind: "scale",
      cornerIdx,
      cursor: (vx * vy) >= 0 ? "nwse-resize" : "nesw-resize",
    };
  }
  if (overlay.rotateHandle && dist2(overlay.rotateHandle, point) <= 12 * 12) {
    return { kind: "rotate", cursor: "grab" };
  }
  if (pointInPolygon(point, overlay.corners)) {
    return { kind: "move", cursor: "move" };
  }
  return { kind: "none", cursor: "grab" };
}

function defaultCanvasCursor(viewMode: ViewMode, shot: PanoramaShot | null) {
  return viewMode === "pano" ? "grab" : (shot ? "crosshair" : "default");
}

function drawPanoGuides(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
  ctx.lineWidth = 1;
  for (let index = 1; index < 3; index += 1) {
    const x = (width * index) / 3;
    const y = (height * index) / 3;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
  ctx.beginPath();
  ctx.moveTo(width * 0.5 - 14, height * 0.5);
  ctx.lineTo(width * 0.5 + 14, height * 0.5);
  ctx.moveTo(width * 0.5, height * 0.5 - 14);
  ctx.lineTo(width * 0.5, height * 0.5 + 14);
  ctx.stroke();
  ctx.restore();
}

function drawPanoShotOverlay(ctx: CanvasRenderingContext2D, overlay: PanoramaPanoOverlayGeometry) {
  if (!overlay.visible || overlay.corners.length !== 4) return;

  ctx.save();
  ctx.fillStyle = "rgba(0, 112, 243, 0.24)";
  ctx.strokeStyle = "rgba(255, 255, 255, 1)";
  ctx.lineWidth = 2.8;
  drawLoop(ctx, overlay.corners);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "#0070f3";
  ctx.lineCap = "round";
  ctx.lineWidth = 4;
  overlay.edgeMidpoints.forEach((midpoint) => {
    const dx = midpoint.b.x - midpoint.a.x;
    const dy = midpoint.b.y - midpoint.a.y;
    const length = Math.hypot(dx, dy) || 1;
    const tx = dx / length;
    const ty = dy / length;
    const half = 10;
    ctx.beginPath();
    ctx.moveTo(midpoint.x - tx * half, midpoint.y - ty * half);
    ctx.lineTo(midpoint.x + tx * half, midpoint.y + ty * half);
    ctx.stroke();
  });
  ctx.lineCap = "butt";

  ctx.fillStyle = "#0070f3";
  overlay.corners.forEach((point) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 6.5, 0, Math.PI * 2);
    ctx.fill();
  });
  if (overlay.rotateStemBase && overlay.rotateHandle) {
    ctx.strokeStyle = "rgba(250, 250, 250, 0.9)";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(overlay.rotateStemBase.x, overlay.rotateStemBase.y);
    ctx.lineTo(overlay.rotateHandle.x, overlay.rotateHandle.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(overlay.rotateHandle.x, overlay.rotateHandle.y, 10, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawUnwrapGrid(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }) {
  ctx.save();
  ctx.strokeStyle = "#3f3f46";
  ctx.lineWidth = 1;
  for (let index = 0; index <= 16; index += 1) {
    const x = rect.x + (rect.w * index) / 16;
    ctx.beginPath();
    ctx.moveTo(x, rect.y);
    ctx.lineTo(x, rect.y + rect.h);
    ctx.stroke();
  }
  for (let index = 0; index <= 8; index += 1) {
    const y = rect.y + (rect.h * index) / 8;
    ctx.beginPath();
    ctx.moveTo(rect.x, y);
    ctx.lineTo(rect.x + rect.w, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(250, 250, 250, 0.86)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(rect.x, rect.y + rect.h / 2);
  ctx.lineTo(rect.x + rect.w, rect.y + rect.h / 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(250, 250, 250, 0.42)";
  ctx.font = "500 11px Geist, sans-serif";
  ctx.textAlign = "center";
  const labelY = rect.y + rect.h * 0.57;
  ctx.fillText("左", rect.x + rect.w * 0.25, labelY);
  ctx.fillText("前", rect.x + rect.w * 0.5, labelY);
  ctx.fillText("右", rect.x + rect.w * 0.75, labelY);
  ctx.fillText("后", rect.x + 38, labelY);
  ctx.fillText("后", rect.x + rect.w - 38, labelY);
  ctx.restore();
}

function getQualityMode(quality: PreviewQuality): "draft" | "balanced" | "high" {
  return quality;
}

function panoramaOutputRoleLabel(item: HistoryItem) {
  switch (item.panoramaProject?.role) {
    case "shot":
      return "镜头导出";
    case "edited-shot":
      return "镜头编辑";
    case "pasted-panorama":
      return "贴回全景";
    default:
      return hasPanoramaRoundtripRef(item) ? "镜头图" : "输出";
  }
}

function panoramaOutputThumbSrc(item: HistoryItem) {
  if (item.imageB64) return tempDataURLFromB64(item.imageB64);
  return item.previewUrl || item.fullUrl || "";
}

function aspectRatioFromId(aspectId: string): number | null {
  const match = String(aspectId || "").trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return w / h;
}

function editAspectPresetForShot(
  shot: PanoramaShot,
  input: Parameters<typeof aspectPresetsForAPIMode>[0],
): AspectPreset {
  const options = aspectPresetsForAPIMode(input, "edit").filter((option) => !option.auto);
  const direct = options.find((option) => option.value === shot.aspect_id);
  if (direct) return direct.value;

  const shotRatio = Math.max(1, Number(shot.out_w || 1)) / Math.max(1, Number(shot.out_h || 1));
  const targetRatio = aspectRatioFromId(shot.aspect_id) ?? shotRatio;
  let best = options[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const option of options) {
    const optionRatio = Math.max(1, option.w) / Math.max(1, option.h);
    const score = Math.abs(Math.log(optionRatio) - Math.log(targetRatio));
    if (score < bestScore) {
      best = option;
      bestScore = score;
    }
  }
  return best?.value ?? "1:1";
}

function sourceImageFromPanoramaShotItem(item: HistoryItem): SourceImage | null {
  const path = String(item.savedPath || "").trim();
  if (!path) return null;
  return {
    path,
    name: path.split(/[\\/]/).pop() ?? "panorama-shot.png",
    size: 0,
    width: Number.isFinite(Number(item.width)) ? Number(item.width) : item.previewWidth,
    height: Number.isFinite(Number(item.height)) ? Number(item.height) : item.previewHeight,
    imageBlob: item.previewUrl ? null : (item.previewBlob ?? item.imageBlob ?? null),
    imageB64: item.previewUrl ? undefined : item.imageB64,
    previewUrl: item.previewUrl,
    panoramaRoundtrip: item.panoramaRoundtrip,
    panoramaProject: item.panoramaProject,
  };
}

function Icon({ name }: { name: keyof typeof ICON }) {
  return <span aria-hidden dangerouslySetInnerHTML={{ __html: ICON[name] }} />;
}

export function PanoramaViewerModal() {
  const item = useStudioStore((state) => state.panoramaViewerItem);
  const close = useStudioStore((state) => state.closePanoramaViewer);
  const materializeCurrentImage = useStudioStore((state) => state.materializeCurrentImage);
  const reuseAsSource = useStudioStore((state) => state.reuseAsSource);
  const openResultDetail = useStudioStore((state) => state.openResultDetail);
  const openPanoramaViewer = useStudioStore((state) => state.openPanoramaViewer);
  const openPanoramaPastebackAligner = useStudioStore((state) => state.openPanoramaPastebackAligner);
  const pushToast = useStudioStore((state) => state.pushToast);
  const activeWorkspaceId = useStudioStore((state) => state.activeWorkspaceId);
  const history = useStudioStore((state) => state.history);
  const [shot, setShot] = useState<PanoramaShot | null>(null);
  const [view, setView] = useState<EditorView>(createDefaultEditorView());
  const [viewMode, setViewMode] = useState<ViewMode>("pano");
  const [previewQuality, setPreviewQuality] = useState<PreviewQuality>("balanced");
  const [invertX, setInvertX] = useState(false);
  const [invertY, setInvertY] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [undoStack, setUndoStack] = useState<Snapshot[]>([]);
  const [redoStack, setRedoStack] = useState<Snapshot[]>([]);
  const [tooltip, setTooltip] = useState<TooltipState>({ text: "", left: 0, top: 0, visible: false });
  const [outputPreviewExpanded, setOutputPreviewExpanded] = useState(false);
  const [outputPreviewAnchor, setOutputPreviewAnchor] = useState<OutputPreviewAnchor>({ visible: false, left: 0, top: 0 });
  const [aspectMenuOpen, setAspectMenuOpen] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [copyStateLabel, setCopyStateLabel] = useState("复制状态");
  const [customAspectWidth, setCustomAspectWidth] = useState("1");
  const [customAspectHeight, setCustomAspectHeight] = useState("1");
  const [outputSizeMode, setOutputSizeMode] = useState<OutputSizeMode>("longest");
  const [outputLongEdge, setOutputLongEdge] = useState(DEFAULT_PANORAMA_OUTPUT_LONG_EDGE);
  const [canvasResizeTick, setCanvasResizeTick] = useState(0);
  const [stageCursor, setStageCursor] = useState(defaultCanvasCursor("pano", null));
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const drawOwnerRef = useRef<DrawOwner>({});
  const outputPreviewAnchorRef = useRef<OutputPreviewAnchor>({ visible: false, left: 0, top: 0 });
  const changeSessionRef = useRef<Snapshot | null>(null);
  const panoDragRef = useRef<{ active: boolean; pointerId: number | null; lastX: number; lastY: number; lastTs: number }>({
    active: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
    lastTs: 0,
  });
  const panoShotDragRef = useRef<PanoShotDragState>({
    active: false,
    pointerId: null,
    kind: "none",
    cursor: "grab",
    offsetX: 0,
    offsetY: 0,
    centerX: 0,
    centerY: 0,
    startDist: 1,
    startHFOV: 90,
    startVFOV: 60,
    startRoll: 0,
    startAngle: 0,
  });
  const unwrapDragRef = useRef<{ active: boolean; pointerId: number | null }>({ active: false, pointerId: null });
  const inertiaRef = useRef<{ vx: number; vy: number; active: boolean; lastTs: number; raf: number | null }>({
    vx: 0,
    vy: 0,
    active: false,
    lastTs: 0,
    raf: null,
  });

  useEffect(() => {
    if (!item) {
      setShot(null);
      setView(createDefaultEditorView());
      setUndoStack([]);
      setRedoStack([]);
      setViewMode("pano");
      return;
    }
    const nextShot = createTy360DefaultShot();
    setShot(nextShot);
    setView(createDefaultEditorView());
    setUndoStack([]);
    setRedoStack([]);
    setViewMode("pano");
    setShowGrid(true);
    setFullscreen(false);
    setAspectMenuOpen(false);
    setQualityMenuOpen(false);
    setOutputPreviewExpanded(false);
    setCopyStateLabel("复制状态");
    setCustomAspectWidth("1");
    setCustomAspectHeight("1");
    setOutputSizeMode("longest");
    setOutputLongEdge(DEFAULT_PANORAMA_OUTPUT_LONG_EDGE);
  }, [item?.id]);

  useEffect(() => {
    const next = defaultCanvasCursor(viewMode, shot);
    setStageCursor((current) => (current === next ? current : next));
  }, [shot, viewMode]);

  useEffect(() => {
    if (!item || !item.previewOnly) return;
    let cancelled = false;
    void materializeCurrentImage(item).then((full) => {
      if (cancelled || !full || full.id !== item.id) return;
      useStudioStore.setState({ panoramaViewerItem: full });
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [item, materializeCurrentImage]);

  useEffect(() => {
    if (!item) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (fullscreen) {
          setFullscreen(false);
          return;
        }
        close();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [close, fullscreen, item]);

  useEffect(() => () => {
    if (inertiaRef.current.raf != null) window.cancelAnimationFrame(inertiaRef.current.raf);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => setCanvasResizeTick((tick) => tick + 1));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const sourceUrl = useMemo(() => {
    if (!item) return null;
    if (item.imageB64) return tempDataURLFromB64(item.imageB64);
    return historyFullSrc(item, null);
  }, [item]);

  const erpImage = useImageFromSource(item?.imageBlob ?? null, item?.imageB64, sourceUrl);
  const panoramaOutputs = useMemo(() => (
    item ? panoramaProjectOutputsForSource(history, item) : []
  ), [history, item]);
  const titleText = item ? fileNameFromPath(item.savedPath, "全景") : "全景";
  const canOperate = !!shot && !!erpImage;

  function hideTooltip() {
    setTooltip((current) => (current.visible ? { ...current, visible: false } : current));
  }

  function showTooltipForTarget(text: string, target: HTMLElement) {
    const host = rootRef.current?.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    if (!host) return;
    setTooltip({
      text,
      left: rect.left - host.left + rect.width * 0.5,
      top: rect.top - host.top - 12,
      visible: true,
    });
  }

  function beginShotSession() {
    if (!changeSessionRef.current) changeSessionRef.current = createSnapshot(shot, view);
  }

  function commitShotSession() {
    const started = changeSessionRef.current;
    changeSessionRef.current = null;
    if (!started) return;
    const current = createSnapshot(shot, view);
    if (equalSnapshots(started, current)) return;
    setUndoStack((previous) => [...previous, started].slice(-MAX_HISTORY_DEPTH));
    setRedoStack([]);
  }

  function commitImmediate(nextShot: PanoramaShot | null, nextView: EditorView = view) {
    const previous = createSnapshot(shot, view);
    setUndoStack((stack) => [...stack, previous].slice(-MAX_HISTORY_DEPTH));
    setRedoStack([]);
    setShot(cloneShot(nextShot));
    setView(cloneView(nextView));
  }

  function applySnapshot(snapshot: Snapshot) {
    setShot(cloneShot(snapshot.shot));
    setView(cloneView(snapshot.view));
  }

  function handleUndo() {
    if (!undoStack.length) return;
    const previous = undoStack[undoStack.length - 1];
    const current = createSnapshot(shot, view);
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, current].slice(-MAX_HISTORY_DEPTH));
    applySnapshot(previous);
  }

  function handleRedo() {
    if (!redoStack.length) return;
    const next = redoStack[redoStack.length - 1];
    const current = createSnapshot(shot, view);
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, current].slice(-MAX_HISTORY_DEPTH));
    applySnapshot(next);
  }

  function stopInertia() {
    if (inertiaRef.current.raf != null) {
      window.cancelAnimationFrame(inertiaRef.current.raf);
      inertiaRef.current.raf = null;
    }
    inertiaRef.current.active = false;
  }

  function startInertia() {
    stopInertia();
    inertiaRef.current.active = true;
    inertiaRef.current.lastTs = performance.now();
    const step = (ts: number) => {
      if (!inertiaRef.current.active) return;
      const deltaSec = Math.max(0.001, (ts - inertiaRef.current.lastTs) / 1000);
      inertiaRef.current.lastTs = ts;
      const damping = Math.exp(-PANO_INERTIA_DAMPING * deltaSec);
      setView((current) => ({
        ...current,
        yaw_deg: wrapYaw(current.yaw_deg + inertiaRef.current.vx * deltaSec),
        pitch_deg: clamp(current.pitch_deg + inertiaRef.current.vy * deltaSec, -89.9, 89.9),
      }));
      inertiaRef.current.vx *= damping;
      inertiaRef.current.vy *= damping;
      if (Math.abs(inertiaRef.current.vx) < PANO_INERTIA_STOP_SPEED && Math.abs(inertiaRef.current.vy) < PANO_INERTIA_STOP_SPEED) {
        stopInertia();
        return;
      }
      inertiaRef.current.raf = window.requestAnimationFrame(step);
    };
    inertiaRef.current.raf = window.requestAnimationFrame(step);
  }

  function pointToShotPose(clientX: number, clientY: number, target: HTMLCanvasElement) {
    const bounds = target.getBoundingClientRect();
    const localX = clientX - bounds.left;
    const localY = clientY - bounds.top;
    const rect = getUnwrapRect(bounds.width, bounds.height);
    const normalizedX = clamp((localX - rect.x) / Math.max(1, rect.w), 0, 1);
    const normalizedY = clamp((localY - rect.y) / Math.max(1, rect.h), 0, 1);
    return {
      yaw_deg: wrapYaw(normalizedX * 360 - 180),
      pitch_deg: clamp((0.5 - normalizedY) * 180, -89, 89),
    };
  }

  function updateShotPose(clientX: number, clientY: number, target: HTMLCanvasElement) {
    setShot((current) => {
      if (!current) return current;
      const pose = pointToShotPose(clientX, clientY, target);
      return { ...current, ...pose };
    });
  }

  function canvasPointFromClientPoint(clientX: number, clientY: number, target: HTMLCanvasElement) {
    const bounds = target.getBoundingClientRect();
    const scaleX = target.width / Math.max(1, bounds.width);
    const scaleY = target.height / Math.max(1, bounds.height);
    return {
      x: (clientX - bounds.left) * scaleX,
      y: (clientY - bounds.top) * scaleY,
    };
  }

  function canvasPointToWorldDirection(x: number, y: number, target: HTMLCanvasElement) {
    const { right, up, fwd } = cameraBasis(view.yaw_deg, view.pitch_deg, 0);
    const width = Math.max(1, target.width);
    const height = Math.max(1, target.height);
    const horizontalFov = clamp(view.fov_deg, 1, 179) * DEG2RAD;
    const verticalFov = 2 * Math.atan(Math.tan(horizontalFov / 2) * (height / width));
    const normalizedX = ((x - width / 2) / (width / 2)) * Math.tan(horizontalFov / 2);
    const normalizedY = ((height / 2 - y) / (height / 2)) * Math.tan(verticalFov / 2);
    return norm(add(add(mul(right, normalizedX), mul(up, normalizedY)), fwd));
  }

  function updateStageCursor(next: string) {
    setStageCursor((current) => (current === next ? current : next));
  }

  function resetPanoShotDrag() {
    panoShotDragRef.current = {
      active: false,
      pointerId: null,
      kind: "none",
      cursor: "grab",
      offsetX: 0,
      offsetY: 0,
      centerX: 0,
      centerY: 0,
      startDist: 1,
      startHFOV: 90,
      startVFOV: 60,
      startRoll: 0,
      startAngle: 0,
    };
  }

  function hideOutputPreviewAnchor() {
    if (!outputPreviewAnchorRef.current.visible) return;
    outputPreviewAnchorRef.current = { visible: false, left: 0, top: 0 };
    setOutputPreviewAnchor(outputPreviewAnchorRef.current);
  }

  function drawOutputPreview(ctx: CanvasRenderingContext2D, width: number, height: number) {
    if (!erpImage || !shot) {
      hideOutputPreviewAnchor();
      return;
    }
    const margin = 14;
    const expansion = outputPreviewExpanded ? 1 : 0;
    const maxWidthCollapsed = Math.max(120, Math.min(250, width * 0.28));
    const maxWidthExpanded = Math.max(260, Math.min(560, width * 0.62));
    const maxHeightCollapsed = Math.max(76, Math.min(150, height * 0.22));
    const maxHeightExpanded = Math.max(160, Math.min(340, height * 0.48));
    const maxWidth = maxWidthCollapsed + (maxWidthExpanded - maxWidthCollapsed) * expansion;
    const maxHeight = maxHeightCollapsed + (maxHeightExpanded - maxHeightCollapsed) * expansion;
    const aspect = Math.max(0.1, shot.out_w / Math.max(1, shot.out_h));
    let previewWidth = maxWidth;
    let previewHeight = previewWidth / aspect;
    if (previewHeight > maxHeight) {
      previewHeight = maxHeight;
      previewWidth = previewHeight * aspect;
    }
    const previewX = width - margin - previewWidth;
    const previewY = margin;

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = "rgba(10, 10, 10, 0.72)";
    ctx.beginPath();
    ctx.roundRect(previewX, previewY, previewWidth, previewHeight, 12);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(previewX, previewY, previewWidth, previewHeight, 12);
    ctx.clip();
    const drawn = drawPanoramaCutoutPreview(
      ctx,
      drawOwnerRef.current,
      erpImage,
      { x: previewX, y: previewY, w: previewWidth, h: previewHeight },
      shot,
      outputPreviewExpanded ? "high" : getQualityMode(previewQuality),
    );
    if (!drawn) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
      ctx.fillRect(previewX, previewY, previewWidth, previewHeight);
    }
    ctx.restore();

    const nextAnchor = {
      visible: true,
      left: Math.round(previewX + previewWidth - 32),
      top: Math.round(previewY + 8),
    };
    if (
      nextAnchor.visible !== outputPreviewAnchorRef.current.visible
      || nextAnchor.left !== outputPreviewAnchorRef.current.left
      || nextAnchor.top !== outputPreviewAnchorRef.current.top
    ) {
      outputPreviewAnchorRef.current = nextAnchor;
      setOutputPreviewAnchor(nextAnchor);
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height } = fitCanvasToDisplay(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#070707";
    ctx.fillRect(0, 0, width, height);

    if (!erpImage) {
      hideOutputPreviewAnchor();
      return;
    }

    if (viewMode === "pano") {
      const previewShot: PanoramaShot = {
        id: "panorama-view-preview",
        yaw_deg: view.yaw_deg,
        pitch_deg: view.pitch_deg,
        roll_deg: 0,
        hFOV_deg: clamp(view.fov_deg, 1, 179),
        vFOV_deg: verticalFovFromHorizontal(view.fov_deg, width / Math.max(1, height)),
        out_w: width,
        out_h: height,
        aspect_id: `${width}:${height}`,
      };
      const drawn = renderPanoramaViewToContext2D({
        ctx,
        owner: drawOwnerRef.current,
        image: erpImage,
        rect: { x: 0, y: 0, w: width, h: height },
        yawDeg: view.yaw_deg,
        pitchDeg: view.pitch_deg,
        fovDeg: view.fov_deg,
      }) || drawPanoramaCutoutPreview(
        ctx,
        drawOwnerRef.current,
        erpImage,
        { x: 0, y: 0, w: width, h: height },
        previewShot,
        getQualityMode(previewQuality),
      );
      if (!drawn) {
        ctx.fillStyle = "rgba(250, 250, 250, 0.7)";
        ctx.font = "500 12px Geist, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("全景预览不可用", width / 2, height / 2);
      }
      if (showGrid) drawPanoGuides(ctx, width, height);
      if (shot) {
        drawPanoShotOverlay(
          ctx,
          buildPanoramaPanoOverlayGeometry(
            shot,
            view.yaw_deg,
            view.pitch_deg,
            view.fov_deg,
            width,
            height,
          ),
        );
      }
      drawOutputPreview(ctx, width, height);
      return;
    }

    const unwrapRect = getUnwrapRect(width, height);
    ctx.drawImage(erpImage, unwrapRect.x, unwrapRect.y, unwrapRect.w, unwrapRect.h);
    if (showGrid) drawUnwrapGrid(ctx, unwrapRect);

    if (shot) {
      const polygons = buildWrappedPolygons(shot, unwrapRect);
      ctx.save();
      ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      ctx.strokeStyle = "rgba(250, 250, 250, 0.9)";
      ctx.lineWidth = 2;
      polygons.forEach((polygon) => {
        drawLoop(ctx, polygon);
        ctx.fill();
        ctx.stroke();
      });
      ctx.restore();

      const center = directionToUnwrapPoint(yawPitchToDir(shot.yaw_deg, shot.pitch_deg), unwrapRect);
      ctx.save();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(center.x, center.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      drawOutputPreview(ctx, width, height);
      return;
    }

    hideOutputPreviewAnchor();
  }, [canvasResizeTick, erpImage, outputPreviewExpanded, previewQuality, shot, showGrid, view, viewMode]);

  async function createExportedHistoryItem(): Promise<HistoryItem> {
    if (!erpImage) throw new Error("全景图尚未就绪");
    if (!shot) throw new Error("当前没有镜头");
    const exported = exportPanoramaCutoutBase64(erpImage, shot);
    const imported = await ImportImageFromB64(exported.imageB64, `panorama-shot-${Date.now()}.png`);
    const ref = await RegisterImportedImageAsset(imported.path).catch(() => null);
    const roundtrip = buildPanoramaRoundtripRef(item!, shot);
    const itemId = cryptoIDFallback();
    const baseItem: HistoryItem = {
      id: itemId,
      imageId: imported.imageId || undefined,
      previewUrl: imported.previewUrl || undefined,
      fullUrl: imported.imageId ? `/media/full/${imported.imageId}` : undefined,
      imageB64: imported.previewUrl || imported.imageId ? undefined : exported.imageB64,
      imageBlob: null,
      previewBlob: null,
      previewOnly: true,
      prompt: item!.prompt,
      revisedPrompt: item!.revisedPrompt,
      mode: "edit",
      apiMode: item!.apiMode,
      apiProfileId: item!.apiProfileId,
      apiProfileName: item!.apiProfileName,
      fhlImagesPoolSlot: item!.fhlImagesPoolSlot,
      size: sizeValueFromDimensions(exported.width, exported.height),
      quality: item!.quality,
      outputFormat: "png",
      createdAt: Date.now(),
      parentId: item!.savedPath,
      width: exported.width,
      height: exported.height,
      previewWidth: Number.isFinite(Number(imported.previewWidth)) ? Number(imported.previewWidth) : undefined,
      previewHeight: Number.isFinite(Number(imported.previewHeight)) ? Number(imported.previewHeight) : undefined,
      savedPath: imported.path,
      panoramaRoundtrip: roundtrip,
      panoramaProject: buildPanoramaProjectRef(item!, "shot", { shotHistoryId: itemId }),
    };
    const nextItem = ref ? withMediaAssetRef(baseItem, ref) : baseItem;
    useStudioStore.setState((state) => {
      const history = trimHistory([nextItem, ...state.history.filter((entry) => entry.id !== nextItem.id)]);
      return {
        history,
        workspaces: patchWorkspaceRuntime(state.workspaces, activeWorkspaceId, {}),
      };
    });
    await persistHistoryItem(nextItem).catch(() => undefined);
    persistTrimmedHistory(useStudioStore.getState().history);
    return nextItem;
  }

  async function handleSave(closeAfter = true) {
    if (busy) return;
    setBusy(true);
    try {
      await createExportedHistoryItem();
      pushToast("镜头图已加入历史", "success", 2400);
      if (closeAfter) close();
    } catch (error: any) {
      pushToast(`镜头导出失败: ${error?.message ?? error}`, "error", 4200);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveAndEdit() {
    if (busy) return;
    setBusy(true);
    try {
      const exportedItem = await createExportedHistoryItem();
      const source = sourceImageFromPanoramaShotItem(exportedItem);
      if (!source || !shot) throw new Error("镜头图源文件准备失败");
      close();
      useStudioStore.setState((state) => {
        const editAspect = editAspectPresetForShot(shot, state.apiMode);
        const nextSize = buildAspectSizeSelection(
          editAspect,
          deriveResolutionPreset(state.size),
          {
            apiMode: state.apiMode,
            requestPolicy: state.requestPolicy,
            imageModelID: state.imageModelID,
            mode: "edit",
          },
        );
        const batchProcess = {
          ...state.batchProcess,
          autoAspectResolution: "" as const,
        };
        return {
          mode: "edit",
          editSourceMode: "manual",
          promptPrefix: "",
          prompt: PANORAMA_SHOT_EDIT_PROMPT,
          size: nextSize,
          sources: [source],
          currentImage: toPreviewOnlyHistoryItem(exportedItem),
          resultGridOpen: false,
          historyGalleryOpen: false,
          selectedBatchTaskId: null,
          batchSinglePreviewOpen: false,
          batchProcess,
          editAutoAspectUserLocked: true,
          errorMessage: null,
          errorRawPath: null,
          workspaces: patchWorkspaceRuntime(state.workspaces, state.activeWorkspaceId, {
            mode: "edit",
            editSourceMode: "manual",
            promptPrefix: "",
            prompt: PANORAMA_SHOT_EDIT_PROMPT,
            size: nextSize,
            sources: [source],
            currentImageId: exportedItem.id,
            resultGridOpen: false,
            historyGalleryOpen: false,
            selectedBatchTaskId: null,
            batchSinglePreviewOpen: false,
            batchProcess,
            editAutoAspectUserLocked: true,
          }),
        };
      });
      pushToast("镜头图已导出并加入编辑流", "success", 2600);
    } catch (error: any) {
      pushToast(`镜头导出失败: ${error?.message ?? error}`, "error", 4200);
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyState() {
    if (!shot || !item) return;
    const payload = JSON.stringify(buildPanoramaRoundtripRef(item, shot).roundtripState, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      setCopyStateLabel("已复制");
      window.setTimeout(() => setCopyStateLabel("复制状态"), 900);
    } catch {
      pushToast("无法复制状态到剪贴板", "warn", 2200);
    }
  }

  function handleAddFrame() {
    commitImmediate(createTy360ShotFromView(view), view);
  }

  function handleClearFrame() {
    if (!shot) return;
    commitImmediate(null, view);
  }

  function handleAspectPreset(nextAspect: string) {
    if (!shot) return;
    commitImmediate(applyPanoramaAspectPreset(shot, nextAspect as (typeof PANORAMA_ASPECT_PRESETS)[number]["value"]), view);
    setAspectMenuOpen(false);
  }

  function handleApplyCustomAspect() {
    if (!shot) return;
    const width = Math.max(1, Number(customAspectWidth || 1));
    const height = Math.max(1, Number(customAspectHeight || 1));
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    commitImmediate(applyPanoramaCustomAspect(shot, width, height), view);
    setAspectMenuOpen(false);
  }

  function handleRotateAspect() {
    if (!shot) return;
    const next = { ...shot };
    const width = Math.max(8, Number(next.out_w || 1024));
    const height = Math.max(8, Number(next.out_h || 1024));
    next.out_w = height;
    next.out_h = width;
    const hFov = Math.max(1, Number(next.hFOV_deg || 90));
    const vFov = Math.max(1, Number(next.vFOV_deg || 60));
    next.hFOV_deg = vFov;
    next.vFOV_deg = hFov;
    if (next.aspect_id.includes(":")) {
      const [left, right] = next.aspect_id.split(":");
      if (left && right) next.aspect_id = `${right}:${left}`;
    }
    commitImmediate(next, view);
  }

  function handleOutputSizeMode(nextMode: OutputSizeMode) {
    setOutputSizeMode(nextMode);
    if (nextMode !== "longest" || !shot) return;
    const nextLongEdge = normalizeOutputLongEdge(outputLongEdge);
    setOutputLongEdge(nextLongEdge);
    commitImmediate(setPanoramaShotOutputLongEdge(shot, nextLongEdge), view);
  }

  function handleLookAtFrame() {
    if (!shot) return;
    stopInertia();
    setView({
      yaw_deg: shot.yaw_deg,
      pitch_deg: shot.pitch_deg,
      fov_deg: clamp(Math.max(shot.hFOV_deg, shot.vFOV_deg, PANO_FOV_MIN), PANO_FOV_MIN, PANO_FOV_MAX),
    });
  }

  function handleResetView() {
    stopInertia();
    setView(createDefaultEditorView());
  }

  function renderTooltipHandlers(text: string) {
    return {
      onMouseEnter: (event: React.MouseEvent<HTMLElement>) => showTooltipForTarget(text, event.currentTarget),
      onMouseLeave: hideTooltip,
      onFocus: (event: React.FocusEvent<HTMLElement>) => showTooltipForTarget(text, event.currentTarget),
      onBlur: hideTooltip,
    };
  }

  if (!item) return null;

  const portal = (
    <div
      className="pano-modal-overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={rootRef}
        className={`pano-modal ${fullscreen ? "pano-modal-fullscreen" : ""}`}
        role="dialog"
        aria-modal="true"
        onPointerDown={(event) => {
          hideTooltip();
          if (!(event.target instanceof Element) || !event.target.closest(".pano-picker")) {
            setAspectMenuOpen(false);
            setQualityMenuOpen(false);
          }
        }}
      >
        <div className="pano-stage-wrap">
          <canvas
            ref={canvasRef}
            className="pano-stage"
            style={{ cursor: stageCursor }}
            onPointerDown={(event) => {
              hideTooltip();
              if (viewMode === "unwrap") {
                if (!shot) return;
                stopInertia();
                beginShotSession();
                updateStageCursor("crosshair");
                unwrapDragRef.current = { active: true, pointerId: event.pointerId };
                updateShotPose(event.clientX, event.clientY, event.currentTarget);
                event.currentTarget.setPointerCapture(event.pointerId);
                return;
              }
              if (shot) {
                const overlay = buildPanoramaPanoOverlayGeometry(
                  shot,
                  view.yaw_deg,
                  view.pitch_deg,
                  view.fov_deg,
                  event.currentTarget.width,
                  event.currentTarget.height,
                );
                const point = canvasPointFromClientPoint(event.clientX, event.clientY, event.currentTarget);
                const hit = hitPanoOverlayHandle(overlay, point);
                if (hit.kind !== "none" && overlay.center) {
                  const startDistance = hit.kind === "scale_x"
                    ? Math.max(1, Math.abs(point.x - overlay.center.x))
                    : hit.kind === "scale_y"
                      ? Math.max(1, Math.abs(point.y - overlay.center.y))
                      : Math.max(1, Math.hypot(point.x - overlay.center.x, point.y - overlay.center.y));
                  stopInertia();
                  beginShotSession();
                  panoShotDragRef.current = {
                    active: true,
                    pointerId: event.pointerId,
                    kind: hit.kind,
                    cursor: hit.kind === "rotate" ? "grabbing" : hit.cursor,
                    offsetX: point.x - overlay.center.x,
                    offsetY: point.y - overlay.center.y,
                    centerX: overlay.center.x,
                    centerY: overlay.center.y,
                    startDist: startDistance,
                    startHFOV: Number(shot.hFOV_deg || 90),
                    startVFOV: Number(shot.vFOV_deg || 60),
                    startRoll: Number(shot.roll_deg || 0),
                    startAngle: Math.atan2(point.y - overlay.center.y, point.x - overlay.center.x),
                  };
                  updateStageCursor(hit.kind === "rotate" ? "grabbing" : hit.cursor);
                  event.currentTarget.setPointerCapture(event.pointerId);
                  return;
                }
              }
              stopInertia();
              updateStageCursor("grabbing");
              panoDragRef.current = {
                active: true,
                pointerId: event.pointerId,
                lastX: event.clientX,
                lastY: event.clientY,
                lastTs: performance.now(),
              };
              inertiaRef.current.vx = 0;
              inertiaRef.current.vy = 0;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (viewMode === "unwrap") {
                if (!unwrapDragRef.current.active || unwrapDragRef.current.pointerId !== event.pointerId) return;
                updateShotPose(event.clientX, event.clientY, event.currentTarget);
                return;
              }
              const shotDrag = panoShotDragRef.current;
              if (shotDrag.active && shotDrag.pointerId === event.pointerId) {
                const point = canvasPointFromClientPoint(event.clientX, event.clientY, event.currentTarget);
                if (shotDrag.kind === "move") {
                  const targetX = point.x - shotDrag.offsetX;
                  const targetY = point.y - shotDrag.offsetY;
                  const pose = directionToYawPitch(canvasPointToWorldDirection(targetX, targetY, event.currentTarget));
                  setShot((current) => (current ? { ...current, ...pose } : current));
                } else if (shotDrag.kind === "scale" || shotDrag.kind === "scale_x" || shotDrag.kind === "scale_y") {
                  const distance = shotDrag.kind === "scale_x"
                    ? Math.max(1, Math.abs(point.x - shotDrag.centerX))
                    : shotDrag.kind === "scale_y"
                      ? Math.max(1, Math.abs(point.y - shotDrag.centerY))
                      : Math.max(1, Math.hypot(point.x - shotDrag.centerX, point.y - shotDrag.centerY));
                  const ratio = distance / Math.max(1, shotDrag.startDist);
                  setShot((current) => {
                    if (!current) return current;
                    return scalePanoramaShotFieldOfView({
                      ...current,
                      hFOV_deg: shotDrag.startHFOV,
                      vFOV_deg: shotDrag.startVFOV,
                    }, ratio);
                  });
                } else if (shotDrag.kind === "rotate") {
                  const angle = Math.atan2(point.y - shotDrag.centerY, point.x - shotDrag.centerX);
                  let nextRoll = shotDrag.startRoll - ((angle - shotDrag.startAngle) * RAD2DEG);
                  if (event.shiftKey) nextRoll = Math.round(nextRoll / 45) * 45;
                  setShot((current) => (current ? { ...current, roll_deg: nextRoll } : current));
                }
                return;
              }
              const drag = panoDragRef.current;
              if (drag.active && drag.pointerId === event.pointerId) {
                const now = performance.now();
                const deltaX = event.clientX - drag.lastX;
                const deltaY = event.clientY - drag.lastY;
                const deltaSec = Math.max(0.001, (now - drag.lastTs) / 1000);
                drag.lastX = event.clientX;
                drag.lastY = event.clientY;
                drag.lastTs = now;
                const signX = invertX ? -1 : 1;
                const signY = invertY ? -1 : 1;
                const dYaw = -deltaX * PANO_DRAG_SENSITIVITY * signX;
                const dPitch = deltaY * PANO_DRAG_SENSITIVITY * signY;
                setView((current) => ({
                  ...current,
                  yaw_deg: wrapYaw(current.yaw_deg + dYaw),
                  pitch_deg: clamp(current.pitch_deg + dPitch, -89.9, 89.9),
                }));
                inertiaRef.current.vx = inertiaRef.current.vx * PANO_INERTIA_BLEND_OLD + (dYaw / deltaSec) * PANO_INERTIA_BLEND_INST;
                inertiaRef.current.vy = inertiaRef.current.vy * PANO_INERTIA_BLEND_OLD + (dPitch / deltaSec) * PANO_INERTIA_BLEND_INST;
                return;
              }
              if (shot) {
                const overlay = buildPanoramaPanoOverlayGeometry(
                  shot,
                  view.yaw_deg,
                  view.pitch_deg,
                  view.fov_deg,
                  event.currentTarget.width,
                  event.currentTarget.height,
                );
                const point = canvasPointFromClientPoint(event.clientX, event.clientY, event.currentTarget);
                updateStageCursor(hitPanoOverlayHandle(overlay, point).cursor);
                return;
              }
              updateStageCursor(defaultCanvasCursor(viewMode, shot));
            }}
            onPointerUp={(event) => {
              if (viewMode === "unwrap") {
                if (unwrapDragRef.current.pointerId === event.pointerId) {
                  unwrapDragRef.current = { active: false, pointerId: null };
                  event.currentTarget.releasePointerCapture(event.pointerId);
                  updateStageCursor(defaultCanvasCursor(viewMode, shot));
                  commitShotSession();
                }
                return;
              }
              if (panoShotDragRef.current.pointerId === event.pointerId) {
                resetPanoShotDrag();
                event.currentTarget.releasePointerCapture(event.pointerId);
                updateStageCursor(defaultCanvasCursor(viewMode, shot));
                commitShotSession();
                return;
              }
              const drag = panoDragRef.current;
              if (drag.pointerId !== event.pointerId) return;
              drag.active = false;
              drag.pointerId = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
              updateStageCursor(defaultCanvasCursor(viewMode, shot));
              if (Math.hypot(inertiaRef.current.vx, inertiaRef.current.vy) > PANO_INERTIA_START_SPEED) {
                startInertia();
              }
            }}
            onPointerLeave={() => {
              if (viewMode === "unwrap" && unwrapDragRef.current.active) return;
              if (panoShotDragRef.current.active) return;
              panoDragRef.current.active = false;
              panoDragRef.current.pointerId = null;
              updateStageCursor(defaultCanvasCursor(viewMode, shot));
            }}
            onPointerCancel={(event) => {
              if (viewMode === "unwrap") {
                if (unwrapDragRef.current.pointerId === event.pointerId) {
                  unwrapDragRef.current = { active: false, pointerId: null };
                }
                updateStageCursor(defaultCanvasCursor(viewMode, shot));
                return;
              }
              if (panoShotDragRef.current.pointerId === event.pointerId) {
                resetPanoShotDrag();
              }
              if (panoDragRef.current.pointerId === event.pointerId) {
                panoDragRef.current.active = false;
                panoDragRef.current.pointerId = null;
              }
              updateStageCursor(defaultCanvasCursor(viewMode, shot));
            }}
            onWheel={(event) => {
              if (viewMode !== "pano") return;
              event.preventDefault();
              stopInertia();
              const sign = Math.sign(event.deltaY);
              if (!sign) return;
              setView((current) => ({
                ...current,
                fov_deg: clamp(current.fov_deg + sign * PANO_WHEEL_STEP, PANO_FOV_MIN, PANO_FOV_MAX),
              }));
            }}
          />

          {!erpImage && <div className="pano-stage-empty">正在加载全景图...</div>}

          {shot && (
            <div className="pano-stage-overlay-chip">
              <span>{shot.aspect_id}</span>
              <span>{shot.out_w}x{shot.out_h}</span>
            </div>
          )}

          <div className="pano-floating-top">
            <div className="pano-view-toggle" data-selected={viewMode}>
              <button
                type="button"
                className="pano-view-btn"
                data-view="pano"
                aria-pressed={viewMode === "pano"}
                onClick={() => setViewMode("pano")}
              >
                <Icon name="pano" />
                <span className="label">全景</span>
              </button>
              <button
                type="button"
                className="pano-view-btn"
                data-view="unwrap"
                aria-pressed={viewMode === "unwrap"}
                onClick={() => setViewMode("unwrap")}
              >
                <Icon name="unwrap" />
                <span className="label">展开</span>
              </button>
            </div>
          </div>

          <div className="pano-floating-bottom">
            <button
              type="button"
              className="pano-btn pano-btn-icon"
              onClick={handleUndo}
              disabled={!undoStack.length}
              {...renderTooltipHandlers("撤销")}
            >
              <Icon name="undo" />
            </button>
            <button
              type="button"
              className="pano-btn pano-btn-icon"
              onClick={handleRedo}
              disabled={!redoStack.length}
              {...renderTooltipHandlers("重做")}
            >
              <Icon name="redo" />
            </button>
            <button
              type="button"
              className="pano-btn pano-btn-texticon"
              onClick={handleAddFrame}
              {...renderTooltipHandlers("添加镜头")}
            >
              <Icon name="add" />
              <span className="label">添加镜头</span>
            </button>
            <button
              type="button"
              className="pano-btn pano-btn-icon"
              onClick={handleLookAtFrame}
              disabled={!shot}
              {...renderTooltipHandlers("查看镜头")}
            >
              <Icon name="camera" />
            </button>
            <button
              type="button"
              className="pano-btn pano-btn-icon"
              onClick={handleClearFrame}
              disabled={!shot}
              {...renderTooltipHandlers("清空镜头")}
            >
              <Icon name="clear" />
            </button>
          </div>

          <div className="pano-floating-right">
            <span>视角</span>
            <span className="pano-fov-value">{view.fov_deg.toFixed(1)}</span>
            <button
              type="button"
              className="pano-btn pano-btn-icon"
              onClick={handleResetView}
              {...renderTooltipHandlers("重置视角")}
            >
              <Icon name="reset" />
            </button>
            <button
              type="button"
              className="pano-btn pano-btn-icon"
              onClick={() => setShowGrid((current) => !current)}
              {...renderTooltipHandlers(showGrid ? "隐藏网格" : "显示网格")}
            >
              <Icon name={showGrid ? "eye" : "eye_dashed"} />
            </button>
            <button
              type="button"
              className="pano-btn pano-btn-icon"
              onClick={() => setFullscreen((current) => !current)}
              {...renderTooltipHandlers(fullscreen ? "退出全屏" : "全屏")}
            >
              <Icon name={fullscreen ? "fullscreen_close" : "fullscreen"} />
            </button>
          </div>

          <div className="pano-selection-menu" />

          <button
            type="button"
            className="pano-btn pano-btn-icon pano-output-preview-toggle"
            style={{
              display: outputPreviewAnchor.visible ? "inline-flex" : "none",
              left: `${outputPreviewAnchor.left}px`,
              top: `${outputPreviewAnchor.top}px`,
            }}
            onClick={() => setOutputPreviewExpanded((current) => !current)}
            {...renderTooltipHandlers(outputPreviewExpanded ? "收起预览" : "展开预览")}
          >
            <Icon name={outputPreviewExpanded ? "fullscreen_close" : "fullscreen"} />
          </button>

          <div
            className={`pano-tooltip ${tooltip.visible ? "show" : ""}`}
            style={{ left: tooltip.left, top: tooltip.top }}
          >
            {tooltip.text}
          </div>
        </div>

        <div className="pano-side" data-side>
          <div className="pano-side-head">
            <div className="pano-side-title">
              <span className="pano-side-title-icon">
                <Icon name="globe" />
              </span>
              <span>{titleText}</span>
            </div>
            <div className="pano-side-actions" />
          </div>
          <div className="pano-divider" />

          <div className="pano-output-manager">
            <div className="pano-section-title">
              <span>输出管理</span>
              <span className="pano-output-count">{panoramaOutputs.length}</span>
            </div>
            {panoramaOutputs.length > 0 ? (
              <div className="pano-output-list">
                {panoramaOutputs.map((output) => {
                  const thumbSrc = panoramaOutputThumbSrc(output);
                  return (
                    <div key={output.id} className="pano-output-item">
                      <button
                        type="button"
                        className="pano-output-thumb"
                        onClick={() => {
                          close();
                          void openResultDetail(output);
                        }}
                        title="打开详情"
                      >
                        {thumbSrc ? <img src={thumbSrc} alt="" /> : <span>无预览</span>}
                      </button>
                      <div className="pano-output-meta">
                        <div className="pano-output-line">
                          <span className="pano-output-role">{panoramaOutputRoleLabel(output)}</span>
                          <span className="pano-output-size">{output.width || output.previewWidth || "?"}x{output.height || output.previewHeight || "?"}</span>
                        </div>
                        <div className="pano-output-actions">
                          <button type="button" className="pano-mini-btn" onClick={() => {
                            close();
                            void openResultDetail(output);
                          }}>
                            详情
                          </button>
                          <button type="button" className="pano-mini-btn" onClick={() => {
                            void reuseAsSource(output).then(close);
                          }}>
                            编辑
                          </button>
                          {hasPanoramaRoundtripRef(output) ? (
                            <button type="button" className="pano-mini-btn" onClick={() => {
                              close();
                              openPanoramaPastebackAligner(output);
                            }}>
                              对齐贴回
                            </button>
                          ) : null}
                          {isLikelyPanoramaItem(output) ? (
                            <button type="button" className="pano-mini-btn" onClick={() => void openPanoramaViewer(output)}>
                              360
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="pano-output-empty">还没有镜头输出</div>
            )}
          </div>

          <div className="pano-divider" />

          <div className="pano-inspector">
            <div className="pano-section-title">
              <span>镜头参数</span>
            </div>

            <div className="pano-state-actions">
              <button
                type="button"
                className="pano-btn subtle pano-btn-copy"
                onClick={() => void handleCopyState()}
                disabled={!shot}
              >
                <Icon name="copy" />
                <span>{copyStateLabel}</span>
              </button>
            </div>

            <div className={`pano-params ${shot ? "" : "disabled"}`}>
              <div className="pano-field-wide pano-aspect-row">
                <label>比例</label>
                <div className="pano-cutout-aspect-inline">
                  <div className="pano-picker pano-cutout-aspect-picker">
                    <button
                      type="button"
                      className="pano-picker-trigger pano-cutout-aspect-trigger"
                      disabled={!shot}
                      onClick={() => setAspectMenuOpen((current) => !current)}
                    >
                      <span className="pano-cutout-aspect-label">
                        <Icon name="aspect" />
                        <span>{shot?.aspect_id ?? "1:1"}</span>
                      </span>
                      <span className="pano-picker-caret">▾</span>
                    </button>
                    <div className="pano-picker-pop pano-cutout-aspect-pop" hidden={!aspectMenuOpen}>
                      <div className="pano-cutout-aspect-presets">
                        {PANORAMA_ASPECT_PRESETS.map((preset) => (
                          <button
                            key={preset.value}
                            type="button"
                            className={`pano-picker-item ${shot?.aspect_id === preset.value ? "active" : ""}`.trim()}
                            onClick={() => handleAspectPreset(preset.value)}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                      <div className="pano-cutout-aspect-custom">
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={customAspectWidth}
                          onChange={(event) => setCustomAspectWidth(event.target.value)}
                          aria-label="比例宽度"
                        />
                        <span>:</span>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={customAspectHeight}
                          onChange={(event) => setCustomAspectHeight(event.target.value)}
                          aria-label="比例高度"
                        />
                        <button type="button" className="pano-btn" onClick={handleApplyCustomAspect}>
                          设置
                        </button>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="pano-btn pano-btn-icon pano-cutout-aspect-rotate"
                    disabled={!shot}
                    onClick={handleRotateAspect}
                  >
                    <Icon name="rotate_90" />
                  </button>
                </div>
              </div>

              <ParamRow
                label="水平旋转"
                min={-180}
                max={180}
                step={0.1}
                value={shot?.yaw_deg ?? 0}
                disabled={!shot}
                onBegin={beginShotSession}
                onCommit={commitShotSession}
                onChange={(value) => setShot((current) => current ? { ...current, yaw_deg: wrapYaw(value) } : current)}
              />
              <ParamRow
                label="俯仰"
                min={-90}
                max={90}
                step={0.1}
                value={shot?.pitch_deg ?? 0}
                disabled={!shot}
                onBegin={beginShotSession}
                onCommit={commitShotSession}
                onChange={(value) => setShot((current) => current ? { ...current, pitch_deg: clamp(value, -89, 89) } : current)}
              />
              <ParamRow
                label="水平视角"
                min={1}
                max={179}
                step={0.1}
                value={shot?.hFOV_deg ?? 0}
                disabled={!shot}
                onBegin={beginShotSession}
                onCommit={commitShotSession}
                onChange={(value) => setShot((current) => current ? { ...current, hFOV_deg: clamp(value, 1, 179) } : current)}
              />
              <ParamRow
                label="垂直视角"
                min={1}
                max={179}
                step={0.1}
                value={shot?.vFOV_deg ?? 0}
                disabled={!shot}
                onBegin={beginShotSession}
                onCommit={commitShotSession}
                onChange={(value) => setShot((current) => current ? { ...current, vFOV_deg: clamp(value, 1, 179) } : current)}
              />
              <ParamRow
                label="翻滚"
                min={-180}
                max={180}
                step={0.1}
                value={shot?.roll_deg ?? 0}
                disabled={!shot}
                onBegin={beginShotSession}
                onCommit={commitShotSession}
                onChange={(value) => setShot((current) => current ? { ...current, roll_deg: clamp(value, -180, 180) } : current)}
              />
            </div>

            <div className="pano-section-title">
              <span>输出</span>
              <span className="meta">{shot ? `${shot.out_w} x ${shot.out_h}` : "无镜头"}</span>
            </div>

            <div className={`pano-params ${shot ? "" : "disabled"}`}>
              <div className="pano-field-wide">
                <label>尺寸</label>
                <div className="pano-size-control">
                  <div className="pano-segment pano-size-mode" data-selected={outputSizeMode === "dimensions" ? "1" : "0"}>
                    <button
                      type="button"
                      className="pano-segment-btn"
                      aria-pressed={outputSizeMode === "longest"}
                      disabled={!shot}
                      onClick={() => handleOutputSizeMode("longest")}
                    >
                      长边
                    </button>
                    <button
                      type="button"
                      className="pano-segment-btn"
                      aria-pressed={outputSizeMode === "dimensions"}
                      disabled={!shot}
                      onClick={() => handleOutputSizeMode("dimensions")}
                    >
                      宽高
                    </button>
                  </div>
                  {outputSizeMode === "longest" ? (
                    <div className="pano-size-grid pano-size-grid-longedge">
                      <label>
                        <span>最长边</span>
                        <NumericInput
                          value={outputLongEdge}
                          step={8}
                          min={256}
                          disabled={!shot}
                          onBegin={beginShotSession}
                          onCommit={commitShotSession}
                          onChange={(value) => {
                            const nextLongEdge = normalizeOutputLongEdge(value);
                            setOutputLongEdge(nextLongEdge);
                            setShot((current) => current ? setPanoramaShotOutputLongEdge(current, nextLongEdge) : current);
                          }}
                        />
                      </label>
                      <span className="pano-size-derived">
                        {shot ? `输出 ${shot.out_w} x ${shot.out_h}` : "短边自动计算"}
                      </span>
                    </div>
                  ) : (
                    <div className="pano-size-grid">
                      <label>
                        <span>宽度</span>
                        <NumericInput
                          value={shot?.out_w ?? 1024}
                          step={8}
                          min={256}
                          disabled={!shot}
                          onBegin={beginShotSession}
                          onCommit={commitShotSession}
                          onChange={(value) => setShot((current) => current ? setPanoramaShotOutputSize(current, value, current.out_h) : current)}
                        />
                      </label>
                      <label>
                        <span>高度</span>
                        <NumericInput
                          value={shot?.out_h ?? 1024}
                          step={8}
                          min={256}
                          disabled={!shot}
                          onBegin={beginShotSession}
                          onCommit={commitShotSession}
                          onChange={(value) => setShot((current) => current ? setPanoramaShotOutputSize(current, current.out_w, value) : current)}
                        />
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <details className="pano-ui-settings">
              <summary>
                <span className="pano-ui-summary-label">界面设置</span>
                <span className="pano-ui-caret">
                  <Icon name="chevron" />
                </span>
              </summary>
              <div className="pano-ui-settings-body">
                <div className="pano-ui-row">
                  <label>横向拖动</label>
                  <div className="pano-segment" data-selected={invertX ? "1" : "0"}>
                    <button type="button" className="pano-segment-btn" aria-pressed={!invertX} onClick={() => setInvertX(false)}>正常</button>
                    <button type="button" className="pano-segment-btn" aria-pressed={invertX} onClick={() => setInvertX(true)}>反向</button>
                  </div>
                </div>
                <div className="pano-ui-row">
                  <label>纵向拖动</label>
                  <div className="pano-segment" data-selected={invertY ? "1" : "0"}>
                    <button type="button" className="pano-segment-btn" aria-pressed={!invertY} onClick={() => setInvertY(false)}>正常</button>
                    <button type="button" className="pano-segment-btn" aria-pressed={invertY} onClick={() => setInvertY(true)}>反向</button>
                  </div>
                </div>
                <div className="pano-ui-row">
                  <label>预览质量</label>
                  <div className="pano-picker pano-ui-picker">
                    <button type="button" className="pano-picker-trigger" onClick={() => setQualityMenuOpen((current) => !current)}>
                      <span className="pano-picker-label">
                        {previewQuality === "draft" ? "草稿" : previewQuality === "high" ? "高质量" : "均衡"}
                      </span>
                      <span className="pano-picker-caret">▾</span>
                    </button>
                    <div className="pano-picker-pop" hidden={!qualityMenuOpen}>
                      {[
                        { value: "draft", label: "草稿" },
                        { value: "balanced", label: "均衡" },
                        { value: "high", label: "高质量" },
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`pano-picker-item ${previewQuality === option.value ? "active" : ""}`.trim()}
                          onClick={() => {
                            setPreviewQuality(option.value as PreviewQuality);
                            setQualityMenuOpen(false);
                          }}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="pano-ui-row">
                  <span />
                  <button
                    type="button"
                    className="pano-btn subtle"
                    onClick={() => {
                      setInvertX(false);
                      setInvertY(false);
                      setPreviewQuality("balanced");
                    }}
                  >
                    恢复默认
                  </button>
                </div>
              </div>
            </details>

            <div className="pano-section-title">
              <span>工作台</span>
            </div>
            <div className="pano-workbench-actions">
              <button
                type="button"
                className="pano-btn pano-btn-primary"
                onClick={() => void handleSaveAndEdit()}
                disabled={!canOperate || busy}
              >
                {busy ? "处理中..." : "保存并编辑"}
              </button>
              <div className="pano-workbench-note">
                保存会将当前镜头图导出到历史记录；保存并编辑会直接将它送入现有编辑流程。
              </div>
            </div>
          </div>

          <div className="pano-side-footer">
            <button type="button" className="pano-btn" onClick={close}>取消</button>
            <button
              type="button"
              className="pano-btn pano-btn-primary"
              disabled={!canOperate || busy}
              onClick={() => void handleSave(true)}
            >
              {busy ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(portal, document.body);
}

function ParamRow({
  label,
  min,
  max,
  step,
  value,
  disabled,
  onChange,
  onBegin,
  onCommit,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  onBegin: () => void;
  onCommit: () => void;
}) {
  const rangeValue = Number.isFinite(value) ? value : 0;
  const rangeFill = `${clamp(((rangeValue - min) / Math.max(1e-6, max - min)) * 100, 0, 100)}%`;

  return (
    <div className="pano-field" data-key={label}>
      <label>{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={rangeValue}
        style={{ ["--v" as string]: rangeFill }}
        onPointerDown={onBegin}
        onChange={(event) => onChange(Number(event.target.value || 0))}
        onPointerUp={onCommit}
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={Number.isFinite(value) ? Number(value.toFixed(3)) : 0}
        onFocus={onBegin}
        onChange={(event) => onChange(Number(event.target.value || 0))}
        onBlur={onCommit}
      />
    </div>
  );
}

function NumericInput({
  value,
  step,
  min,
  disabled,
  onChange,
  onBegin,
  onCommit,
}: {
  value: number;
  step: number;
  min: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  onBegin: () => void;
  onCommit: () => void;
}) {
  return (
    <input
      type="number"
      min={min}
      step={step}
      disabled={disabled}
      value={Number.isFinite(value) ? value : min}
      onFocus={onBegin}
      onChange={(event) => onChange(Number(event.target.value || min))}
      onBlur={onCommit}
    />
  );
}
