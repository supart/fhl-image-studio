import {
  WindowSetDarkTheme,
  WindowSetLightTheme,
  WindowSetSystemDefaultTheme,
  RegisterTrustedOutputDir,
} from "../platform/runtime/host";
import type {
  Annotation,
  APIMartRecoveryTask,
  HistoryItem,
  OutputFormatValue,
  ProgressInfo,
  QualityValue,
  SizeValue,
  SourceImage,
  StreamPreview,
  StreamPreviewMap,
  ThemeMode,
  Workspace,
} from "../types/domain";
import type { ModeConfig, Stroke } from "./studioStore.types";
import { isAndroid, isWindows } from "../platform";
import { ACTIVE_PROFILE_LS_KEY, PROFILES_LS_KEY, tryParseProfile } from "../lib/profiles";
import type { UpstreamProfile } from "../types/domain";
import { pruneHistoryStorage } from "../lib/storage";
import { storageKey } from "../lib/storageNamespace.ts";
import { getImageDimensionsFromBase64 } from "../lib/images";
import { bestEffortUUID } from "../lib/runtimeCompat.ts";
import {
  readFHLTransportModePreference,
  type FHLTransportMode,
  writeFHLTransportModePreference,
} from "../lib/providerPolicy.ts";
import { MAX_HISTORY_ITEMS, retainHistoryItems } from "./historyRetention.ts";

export { MAX_HISTORY_ITEMS } from "./historyRetention.ts";

export const EMPTY_MODE_CFG: ModeConfig = {
  baseURL: "",
  apiKey: "",
  textModelID: "",
  imageModelID: "",
  concurrencyLimit: 0,
};

export const WORKSPACE_SESSION_INTERRUPTED_MESSAGE = "页面已刷新，之前的进行中任务已中断。请重试或检查 output 目录。";

const WORKSPACE_SESSION_LS_KEY = storageKey("gptcodex.workspaceSession.v1");
export const FHL_TRANSPORT_MODE_LS_KEY = storageKey("gptcodex.fhlTransportMode.v1");

let detachSystemThemeListener: (() => void) | null = null;

export function currentWorkspaceServiceInstanceId(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env;
  const raw = typeof env?.IMAGE_STUDIO_SERVICE_INSTANCE_ID === "string"
    ? env.IMAGE_STUDIO_SERVICE_INSTANCE_ID.trim()
    : "";
  return raw || "static";
}

export function resolvedTheme(theme: ThemeMode): "light" | "dark" {
  if (theme === "dark" || theme === "light") return theme;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "dark";
}

export function unbindSystemThemeListener() {
  if (detachSystemThemeListener) {
    detachSystemThemeListener();
    detachSystemThemeListener = null;
  }
}

export function writeResolvedTheme(theme: "light" | "dark") {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

export function bindSystemThemeListener() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = (matches: boolean) => writeResolvedTheme(matches ? "dark" : "light");
  const onChange = (event: MediaQueryListEvent) => apply(event.matches);
  apply(media.matches);
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", onChange);
    detachSystemThemeListener = () => media.removeEventListener("change", onChange);
    return;
  }
  media.addListener(onChange);
  detachSystemThemeListener = () => media.removeListener(onChange);
}

export function applyTheme(theme: ThemeMode) {
  unbindSystemThemeListener();
  document.documentElement.setAttribute("data-appearance", theme);
  writeResolvedTheme(resolvedTheme(theme));
  if (isWindows) {
    if (theme === "system") WindowSetSystemDefaultTheme();
    else if (theme === "dark") WindowSetDarkTheme();
    else WindowSetLightTheme();
  }
  if (theme === "system") bindSystemThemeListener();
}

export function loadModeConfig(mode: "responses" | "images"): ModeConfig {
  const r = (k: Exclude<keyof ModeConfig, "apiKey" | "concurrencyLimit">): string => {
    try { return localStorage.getItem(storageKey(`gptcodex.${mode}.${k}`)) ?? ""; } catch { return ""; }
  };
  const limit = (() => {
    try {
      const raw = localStorage.getItem(storageKey(`gptcodex.${mode}.concurrencyLimit`)) ?? "";
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    } catch {
      return 0;
    }
  })();
  return {
    baseURL: r("baseURL"),
    apiKey: "",
    textModelID: r("textModelID"),
    imageModelID: r("imageModelID"),
    concurrencyLimit: limit,
  };
}

export function persistProfiles(list: UpstreamProfile[]) {
  try { localStorage.setItem(PROFILES_LS_KEY, JSON.stringify(list)); } catch {}
}

export function persistActiveProfileId(id: string) {
  try {
    if (id) localStorage.setItem(ACTIVE_PROFILE_LS_KEY, id);
    else localStorage.removeItem(ACTIVE_PROFILE_LS_KEY);
  } catch {}
}

export function loadStoredProfiles(): UpstreamProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => tryParseProfile(x)).filter((p): p is UpstreamProfile => p !== null);
  } catch {
    return [];
  }
}

export function loadStoredActiveProfileId(): string {
  try { return localStorage.getItem(ACTIVE_PROFILE_LS_KEY) ?? ""; } catch { return ""; }
}

export function loadStoredFHLTransportMode(): FHLTransportMode {
  if (typeof localStorage === "undefined") return "images";
  return readFHLTransportModePreference(localStorage, FHL_TRANSPORT_MODE_LS_KEY);
}

export function persistFHLTransportMode(mode: FHLTransportMode): void {
  if (typeof localStorage === "undefined") return;
  writeFHLTransportModePreference(localStorage, FHL_TRANSPORT_MODE_LS_KEY, mode);
}

export function clearLegacyModeLocalStorage() {
  for (const mode of ["responses", "images"] as const) {
    for (const field of ["baseURL", "textModelID", "imageModelID", "concurrencyLimit"]) {
      try { localStorage.removeItem(storageKey(`gptcodex.${mode}.${field}`)); } catch {}
    }
  }
  try { localStorage.removeItem(storageKey("gptcodex.apiMode")); } catch {}
}

export function genId(): string {
  return bestEffortUUID("id");
}

export function tempDataURLFromB64(b64: string): string {
  return `data:image/png;base64,${b64}`;
}

export function stripDataURLPrefix(dataURL: string): string {
  const idx = dataURL.indexOf(",");
  return idx >= 0 ? dataURL.slice(idx + 1) : dataURL;
}

export function buildMaskPNGDataURL(strokes: Stroke[], dims: { w: number; h: number } | null): string | null {
  if (!dims || strokes.length === 0) return null;
  const c = document.createElement("canvas");
  c.width = dims.w;
  c.height = dims.h;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  let hasWhite = false;
  for (const s of strokes) {
    ctx.strokeStyle = s.erase ? "#000" : "#fff";
    ctx.lineWidth = s.size;
    ctx.beginPath();
    for (let i = 0; i < s.points.length; i += 2) {
      const x = s.points[i];
      const y = s.points[i + 1];
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    if (!s.erase) hasWhite = true;
  }
  return hasWhite ? c.toDataURL("image/png") : null;
}

export async function registerTrustedOutputRoots(roots: string[]): Promise<void> {
  for (const root of roots) {
    if (!root.trim()) continue;
    await RegisterTrustedOutputDir(root).catch(() => undefined);
  }
}

export function trimHistory(items: HistoryItem[], retainAll = isAndroid): HistoryItem[] {
  return retainHistoryItems(items, retainAll, MAX_HISTORY_ITEMS);
}

export function persistTrimmedHistory(items: HistoryItem[], force = false): Promise<void> {
  if (isAndroid && !force) return Promise.resolve();
  const keptIDs = items.map((item) => item.id);
  return pruneHistoryStorage(keptIDs);
}

function normalizeWorkspaceSize(value: unknown): SizeValue {
  return typeof value === "string" && value.trim()
    ? value as SizeValue
    : "1024x1024";
}

function normalizeWorkspaceQuality(value: unknown): QualityValue {
  return value === "auto" || value === "high" || value === "medium" || value === "low"
    ? value
    : "medium";
}

function normalizeWorkspaceOutputFormat(value: unknown, fallback: OutputFormatValue): OutputFormatValue {
  return value === "png" || value === "jpeg" || value === "webp"
    ? value
    : fallback;
}

function normalizeWorkspaceSeed(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function normalizeWorkspaceBatchCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(9, Math.floor(n)));
}

function normalizeWorkspaceStyleTag(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeAPIMartRecoveryTask(value: unknown, workspaceId: string): APIMartRecoveryTask | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<APIMartRecoveryTask>;
  const taskId = typeof raw.taskId === "string" ? raw.taskId.trim() : "";
  if (!taskId) return null;
  return {
    taskId,
    workspaceId,
    baseURL: typeof raw.baseURL === "string" ? raw.baseURL.trim() : "",
    prompt: typeof raw.prompt === "string" ? raw.prompt : "",
    mode: raw.mode === "edit" ? "edit" : "generate",
    size: normalizeWorkspaceSize(raw.size),
    quality: normalizeWorkspaceQuality(raw.quality),
    outputFormat: normalizeWorkspaceOutputFormat(raw.outputFormat, "png"),
    batchIndex: Number.isFinite(Number(raw.batchIndex)) ? Math.max(0, Math.floor(Number(raw.batchIndex))) : undefined,
    errorMessage: typeof raw.errorMessage === "string" ? raw.errorMessage : undefined,
    rawPath: typeof raw.rawPath === "string" && raw.rawPath.trim() ? raw.rawPath.trim() : undefined,
    status: typeof raw.status === "string" ? raw.status : undefined,
    createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now(),
    lastCheckedAt: Number.isFinite(Number(raw.lastCheckedAt)) ? Number(raw.lastCheckedAt) : undefined,
  };
}

function normalizeAPIMartRecoveryTasks(value: unknown, legacyValue: unknown, workspaceId: string): APIMartRecoveryTask[] {
  const values = Array.isArray(value) ? value : [];
  if (!values.length && legacyValue) values.push(legacyValue);
  const seen = new Set<string>();
  const out: APIMartRecoveryTask[] = [];
  for (const item of values) {
    const normalized = normalizeAPIMartRecoveryTask(item, workspaceId);
    if (!normalized || seen.has(normalized.taskId)) continue;
    seen.add(normalized.taskId);
    out.push(normalized);
  }
  return out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

function sanitizeStoredPreviewUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("blob:")) return undefined;
  return trimmed;
}

function normalizeProgressInfo(value: unknown): ProgressInfo | null {
  if (!value || typeof value !== "object") return null;
  const stage = typeof (value as { stage?: unknown }).stage === "string"
    ? (value as { stage: string }).stage
    : "";
  const elapsed = Number((value as { elapsed?: unknown }).elapsed);
  const bytes = Number((value as { bytes?: unknown }).bytes);
  if (!stage && !Number.isFinite(elapsed) && !Number.isFinite(bytes)) return null;
  return {
    stage,
    elapsed: Number.isFinite(elapsed) ? elapsed : 0,
    bytes: Number.isFinite(bytes) ? bytes : 0,
  };
}

function normalizeSourceImage(value: unknown): SourceImage | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<SourceImage>;
  const path = typeof raw.path === "string" ? raw.path.trim() : "";
  if (!path) return null;
  const name = typeof raw.name === "string" && raw.name.trim()
    ? raw.name.trim()
    : path.split(/[\\/]/).pop() ?? path;
  const size = Number.isFinite(Number(raw.size)) ? Math.max(0, Number(raw.size)) : 0;
  return {
    path,
    name,
    size,
    previewUrl: sanitizeStoredPreviewUrl(raw.previewUrl),
    imageBlob: null,
  };
}

function normalizeStreamPreview(value: unknown): StreamPreview | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<StreamPreview>;
  const jobId = typeof raw.jobId === "string" ? raw.jobId.trim() : "";
  if (!jobId) return null;
  const updatedAt = Number(raw.updatedAt);
  return {
    jobId,
    imageId: typeof raw.imageId === "string" && raw.imageId.trim() ? raw.imageId.trim() : undefined,
    previewUrl: sanitizeStoredPreviewUrl(raw.previewUrl),
    previewWidth: Number.isFinite(Number(raw.previewWidth)) ? Number(raw.previewWidth) : undefined,
    previewHeight: Number.isFinite(Number(raw.previewHeight)) ? Number(raw.previewHeight) : undefined,
    imageB64: typeof raw.imageB64 === "string" && raw.imageB64.trim() ? raw.imageB64.trim() : undefined,
    revisedPrompt: typeof raw.revisedPrompt === "string" && raw.revisedPrompt.trim() ? raw.revisedPrompt.trim() : undefined,
    partialImageIndex: Number.isFinite(Number(raw.partialImageIndex)) ? Number(raw.partialImageIndex) : undefined,
    batchIndex: Number.isFinite(Number(raw.batchIndex)) ? Number(raw.batchIndex) : undefined,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  };
}

function normalizeStreamPreviewMap(value: unknown): StreamPreviewMap {
  if (!value || typeof value !== "object") return {};
  const out: StreamPreviewMap = {};
  for (const [key, preview] of Object.entries(value as Record<string, unknown>)) {
    const normalized = normalizeStreamPreview(preview);
    if (normalized && key) out[key] = normalized;
  }
  return out;
}

function latestStreamPreview(previews: StreamPreviewMap): StreamPreview | null {
  const list = Object.values(previews);
  if (list.length === 0) return null;
  return list.reduce((latest, item) => (
    item.updatedAt >= latest.updatedAt ? item : latest
  ));
}

function toPersistedWorkspace(workspace: Workspace): Workspace {
  return {
    ...workspace,
    sources: workspace.sources.map((source) => ({
      path: source.path,
      name: source.name,
      size: source.size,
      previewUrl: sanitizeStoredPreviewUrl(source.previewUrl),
      imageBlob: null,
    })),
    errorRawPath: workspace.errorRawPath ?? null,
    apimartRecoveryTask: workspace.apimartRecoveryTask ?? null,
    apimartRecoveryTasks: workspace.apimartRecoveryTasks ?? [],
    lastPayload: null,
  };
}

function normalizeWorkspace(
  value: unknown,
  fallbackOutputFormat: OutputFormatValue,
): Workspace | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<Workspace>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) return null;
  const runningJobIds = Array.isArray(raw.runningJobIds)
    ? raw.runningJobIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const hadRunningJobs = runningJobIds.length > 0;
  const streamPreviews = normalizeStreamPreviewMap(raw.streamPreviews);
  const streamPreview = normalizeStreamPreview(raw.streamPreview) ?? latestStreamPreview(streamPreviews);
  const apimartRecoveryTasks = normalizeAPIMartRecoveryTasks(raw.apimartRecoveryTasks, raw.apimartRecoveryTask, id);
  return {
    id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "图片",
    promptPrefix: typeof raw.promptPrefix === "string" ? raw.promptPrefix : "",
    prompt: typeof raw.prompt === "string" ? raw.prompt : "",
    optimizationGuidance: typeof raw.optimizationGuidance === "string" ? raw.optimizationGuidance : "",
    negativePrompt: typeof raw.negativePrompt === "string" ? raw.negativePrompt : "",
    mode: raw.mode === "edit" ? "edit" : "generate",
    size: normalizeWorkspaceSize(raw.size),
    quality: normalizeWorkspaceQuality(raw.quality),
    outputFormat: normalizeWorkspaceOutputFormat(raw.outputFormat, fallbackOutputFormat),
    seed: normalizeWorkspaceSeed(raw.seed),
    batchCount: normalizeWorkspaceBatchCount(raw.batchCount),
    continuousGenerateTest: raw.continuousGenerateTest !== false,
    styleTag: normalizeWorkspaceStyleTag(raw.styleTag),
    sources: Array.isArray(raw.sources)
      ? raw.sources.map((item) => normalizeSourceImage(item)).filter((item): item is SourceImage => !!item)
      : [],
    currentImageId: typeof raw.currentImageId === "string" && raw.currentImageId.trim()
      ? raw.currentImageId.trim()
      : null,
    batchResultIds: Array.isArray(raw.batchResultIds)
      ? raw.batchResultIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [],
    resultGridOpen: !!raw.resultGridOpen,
    runningJobIds: [],
    jobsTotal: hadRunningJobs ? 0 : (Number.isFinite(Number(raw.jobsTotal)) ? Number(raw.jobsTotal) : 0),
    jobsCompleted: hadRunningJobs ? 0 : (Number.isFinite(Number(raw.jobsCompleted)) ? Number(raw.jobsCompleted) : 0),
    progress: hadRunningJobs ? null : normalizeProgressInfo(raw.progress),
    streamPreview,
    streamPreviews,
    lastLogLine: hadRunningJobs
      ? "页面已刷新，之前的进行中任务已中断。"
      : (typeof raw.lastLogLine === "string" ? raw.lastLogLine : ""),
    errorMessage: hadRunningJobs
      ? WORKSPACE_SESSION_INTERRUPTED_MESSAGE
      : (typeof raw.errorMessage === "string" ? raw.errorMessage : null),
    errorRawPath: hadRunningJobs
      ? null
      : (typeof raw.errorRawPath === "string" && raw.errorRawPath.trim() ? raw.errorRawPath.trim() : null),
    apimartRecoveryTask: apimartRecoveryTasks[0] ?? null,
    apimartRecoveryTasks,
    lastPayload: null,
  };
}

export function persistWorkspaceSession(activeWorkspaceId: string, workspaces: Workspace[]): void {
  try {
    if (!activeWorkspaceId || workspaces.length === 0) {
      localStorage.removeItem(WORKSPACE_SESSION_LS_KEY);
      return;
    }
    const payload = {
      version: 1,
      serviceInstanceId: currentWorkspaceServiceInstanceId(),
      activeWorkspaceId,
      updatedAt: Date.now(),
      workspaces: workspaces.map(toPersistedWorkspace),
    };
    localStorage.setItem(WORKSPACE_SESSION_LS_KEY, JSON.stringify(payload));
  } catch {}
}

export function loadWorkspaceSession(
  fallbackOutputFormat: OutputFormatValue,
): { activeWorkspaceId: string; serviceInstanceId: string; workspaces: Workspace[] } | null {
  try {
    const raw = localStorage.getItem(WORKSPACE_SESSION_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      activeWorkspaceId?: unknown;
      serviceInstanceId?: unknown;
      updatedAt?: unknown;
      workspaces?: unknown;
    };
    const hadPersistedLastPayload = Array.isArray(parsed?.workspaces)
      && parsed.workspaces.some((workspace) => (
        !!workspace
        && typeof workspace === "object"
        && (workspace as Partial<Workspace>).lastPayload != null
      ));
    const workspaces = Array.isArray(parsed?.workspaces)
      ? parsed.workspaces
        .map((item) => normalizeWorkspace(item, fallbackOutputFormat))
        .filter((item): item is Workspace => !!item)
      : [];
    if (workspaces.length === 0) return null;
    const requestedActiveId = typeof parsed.activeWorkspaceId === "string"
      ? parsed.activeWorkspaceId.trim()
      : "";
    const activeWorkspaceId = workspaces.some((workspace) => workspace.id === requestedActiveId)
      ? requestedActiveId
      : workspaces[0].id;
    const serviceInstanceId = typeof parsed.serviceInstanceId === "string"
      ? parsed.serviceInstanceId.trim()
      : "";
    if (hadPersistedLastPayload) {
      localStorage.setItem(WORKSPACE_SESSION_LS_KEY, JSON.stringify({
        version: typeof parsed.version === "number" ? parsed.version : 1,
        serviceInstanceId,
        activeWorkspaceId,
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
        workspaces: workspaces.map(toPersistedWorkspace),
      }));
    }
    return { activeWorkspaceId, serviceInstanceId, workspaces };
  } catch {
    return null;
  }
}

export function imageDims(b64: string): { w: number; h: number } | null {
  return getImageDimensionsFromBase64(b64);
}

export function augmentPromptWithAnnotations(
  prompt: string,
  annotations: Annotation[],
  dims: { w: number; h: number } | null,
): string {
  if (!annotations || annotations.length === 0) return prompt;
  const rects = annotations.filter((a) => a.kind === "rect");
  if (rects.length === 0) return prompt;
  const describe = (a: Annotation): string => {
    if (!dims) return `区域 ${rects.indexOf(a) + 1}`;
    const cx = (a.x + (a.width ?? 0) / 2) / dims.w;
    const cy = (a.y + (a.height ?? 0) / 2) / dims.h;
    const hPart = cx < 0.34 ? "左" : cx > 0.66 ? "右" : "中";
    const vPart = cy < 0.34 ? "上" : cy > 0.66 ? "下" : "中";
    return `${vPart}${hPart}部`;
  };
  const positions = rects.map(describe).join("、");
  return `${prompt}\n(请重点关注${positions}标注区域)`;
}
