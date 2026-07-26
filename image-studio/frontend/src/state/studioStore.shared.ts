import {
  WindowSetDarkTheme,
  WindowSetLightTheme,
  WindowSetSystemDefaultTheme,
} from "../platform/runtime/host";
import type {
  Annotation,
  BatchProcessAutoAspectResolution,
  BatchProcessSourceImage,
  BatchTaskRecord,
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
import { compactWorkspaceSessionTasks } from "./workspaceSessionTasks";
import type { FHLTransportMode, ModeConfig, Stroke } from "./studioStore.types";
import { isWindowsHost } from "../platform";
import {
  ACTIVE_PROFILE_LS_KEY,
  PROFILES_LS_KEY,
  normalizeFHLPoolPerAPIConcurrencyLimit,
  tryParseProfile,
} from "../lib/profiles";
import type { UpstreamProfile } from "../types/domain";
import { storageKey } from "../lib/storageNamespace.ts";
import { getImageDimensionsFromBase64 } from "../lib/images";
import {
  defaultBatchProcessConfig,
  normalizeBatchProcessConfig,
  normalizeEditSourceMode,
} from "./workspaceRuntime";

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
export const FHL_POOL_PER_API_CONCURRENCY_LS_KEY = storageKey("gptcodex.fhlImagesPool.perApiConcurrencyLimit.v1");
export const LEGACY_FHL_POOL_SHARED_CONCURRENCY_LS_KEY = storageKey("gptcodex.fhlImagesPool.sharedConcurrencyLimit.v1");

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
  if (isWindowsHost) {
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
  try {
    return localStorage.getItem(FHL_TRANSPORT_MODE_LS_KEY) === "responses" ? "responses" : "images";
  } catch {
    return "images";
  }
}

export function persistFHLTransportMode(mode: FHLTransportMode): void {
  try { localStorage.setItem(FHL_TRANSPORT_MODE_LS_KEY, mode); } catch {}
}

function normalizeStoredConcurrencyLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

export function loadStoredFHLPoolPerAPIConcurrencyLimit(): number | null {
  try {
    const raw = localStorage.getItem(FHL_POOL_PER_API_CONCURRENCY_LS_KEY);
    return raw === null ? null : normalizeFHLPoolPerAPIConcurrencyLimit(raw);
  } catch {
    return null;
  }
}

export function loadLegacyFHLPoolSharedConcurrencyLimit(): number | null {
  try {
    const raw = localStorage.getItem(LEGACY_FHL_POOL_SHARED_CONCURRENCY_LS_KEY);
    return raw === null ? null : normalizeStoredConcurrencyLimit(raw);
  } catch {
    return null;
  }
}

export function persistFHLPoolPerAPIConcurrencyLimit(limit: number): void {
  try {
    localStorage.setItem(
      FHL_POOL_PER_API_CONCURRENCY_LS_KEY,
      String(normalizeFHLPoolPerAPIConcurrencyLimit(limit)),
    );
  } catch {}
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
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {}
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
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

export function trimHistory(items: HistoryItem[]): HistoryItem[] {
  return items;
}

export function persistTrimmedHistory(items: HistoryItem[]): void {
  void items;
}

function normalizeWorkspaceSize(value: unknown): SizeValue {
  return typeof value === "string" && value.trim()
    ? value as SizeValue
    : "1024x1024";
}

function normalizeBatchTaskAutoAspectResolution(value: unknown): Exclude<BatchProcessAutoAspectResolution, ""> | undefined {
  return value === "1k" || value === "2k" || value === "4k" ? value : undefined;
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

function sanitizeStoredPreviewUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("blob:")) return undefined;
  return trimmed;
}

function isVolatileMemoryPath(value: unknown): boolean {
  return typeof value === "string" && value.trim().startsWith("memory://");
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
  if (!path || isVolatileMemoryPath(path)) return null;
  const name = typeof raw.name === "string" && raw.name.trim()
    ? raw.name.trim()
    : path.split(/[\\/]/).pop() ?? path;
  const size = Number.isFinite(Number(raw.size)) ? Math.max(0, Number(raw.size)) : 0;
  return {
    path,
    name,
    size,
    width: Number.isFinite(Number(raw.width)) ? Math.floor(Number(raw.width)) : undefined,
    height: Number.isFinite(Number(raw.height)) ? Math.floor(Number(raw.height)) : undefined,
    previewUrl: sanitizeStoredPreviewUrl(raw.previewUrl),
    imageBlob: null,
    panoramaRoundtrip: raw.panoramaRoundtrip,
    panoramaProject: raw.panoramaProject,
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

function normalizeBatchProcessSourceImage(value: unknown): BatchProcessSourceImage | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<BatchProcessSourceImage>;
  const itemPath = typeof raw.path === "string" ? raw.path.trim() : "";
  if (!itemPath || isVolatileMemoryPath(itemPath)) return null;
  const itemName = typeof raw.name === "string" && raw.name.trim()
    ? raw.name.trim()
    : itemPath.split(/[\\/]/).pop() ?? itemPath;
  return {
    path: itemPath,
    name: itemName,
    size: Number.isFinite(Number(raw.size)) ? Math.max(0, Number(raw.size)) : 0,
    width: Number.isFinite(Number(raw.width)) ? Number(raw.width) : undefined,
    height: Number.isFinite(Number(raw.height)) ? Number(raw.height) : undefined,
    previewUrl: sanitizeStoredPreviewUrl(raw.previewUrl),
    previewWidth: Number.isFinite(Number(raw.previewWidth)) ? Number(raw.previewWidth) : undefined,
    previewHeight: Number.isFinite(Number(raw.previewHeight)) ? Number(raw.previewHeight) : undefined,
    selected: raw.selected !== false,
  };
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
    batchProcess: {
      ...workspace.batchProcess,
      discoveredSources: workspace.batchProcess.discoveredSources
        .filter((source) => !isVolatileMemoryPath(source.path))
        .map((source) => ({
          path: source.path,
          name: source.name,
          size: source.size,
          width: source.width,
          height: source.height,
          previewUrl: sanitizeStoredPreviewUrl(source.previewUrl),
          previewWidth: source.previewWidth,
          previewHeight: source.previewHeight,
          selected: source.selected !== false,
        })),
    },
    sources: workspace.sources
      .filter((source) => !isVolatileMemoryPath(source.path))
      .map((source) => ({
        path: source.path,
        name: source.name,
        size: source.size,
        width: source.width,
          height: source.height,
          previewUrl: sanitizeStoredPreviewUrl(source.previewUrl),
          imageBlob: null,
          panoramaRoundtrip: source.panoramaRoundtrip,
          panoramaProject: source.panoramaProject,
        })),
    editAutoAspectUserLocked: workspace.editAutoAspectUserLocked === true,
    selectedBatchTaskId: null,
    errorRawPath: workspace.errorRawPath ?? null,
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
  const rawBatchSources = Array.isArray(raw.batchProcess?.discoveredSources)
    ? raw.batchProcess.discoveredSources
    : [];
  const batchProcess = (() => {
    const normalized = normalizeBatchProcessConfig(raw.batchProcess);
    const fallback = defaultBatchProcessConfig();
    const discoveredSources = rawBatchSources.length > 0
      ? rawBatchSources
          .map((item) => normalizeBatchProcessSourceImage(item))
          .filter((item): item is BatchProcessSourceImage => !!item) ?? normalized.discoveredSources
      : normalized.discoveredSources;
    return {
      ...fallback,
      ...normalized,
      discoveredSources,
    };
  })();
  const droppedVolatileBatchState = isVolatileMemoryPath(raw.batchProcess?.inputDir)
    || (rawBatchSources.length > 0 && batchProcess.discoveredSources.length < rawBatchSources.length);
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
    continuousGenerateTest: raw.continuousGenerateTest === true,
    editSourceMode: normalizeEditSourceMode(raw.editSourceMode),
    batchProcess,
    editAutoAspectUserLocked: raw.editAutoAspectUserLocked === true,
    styleTag: normalizeWorkspaceStyleTag(raw.styleTag),
    sources: Array.isArray(raw.sources)
      ? raw.sources.map((item) => normalizeSourceImage(item)).filter((item): item is SourceImage => !!item)
      : [],
    currentImageId: typeof raw.currentImageId === "string" && raw.currentImageId.trim()
      ? raw.currentImageId.trim()
      : null,
    batchResultIds: !droppedVolatileBatchState && Array.isArray(raw.batchResultIds)
      ? raw.batchResultIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [],
    batchTaskIds: !droppedVolatileBatchState && Array.isArray(raw.batchTaskIds)
      ? raw.batchTaskIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [],
    clearedJobGroupsBefore: Number.isFinite(Number(raw.clearedJobGroupsBefore)) && Number(raw.clearedJobGroupsBefore) > 0
      ? Number(raw.clearedJobGroupsBefore)
      : undefined,
    selectedBatchTaskId: null,
    batchSinglePreviewOpen: !droppedVolatileBatchState && raw.batchSinglePreviewOpen === true,
    resultGridOpen: !droppedVolatileBatchState && !!raw.resultGridOpen,
    historyGalleryOpen: raw.historyGalleryOpen === true,
    historyGallerySinglePreviewId: typeof raw.historyGallerySinglePreviewId === "string" && raw.historyGallerySinglePreviewId.trim()
      ? raw.historyGallerySinglePreviewId.trim()
      : null,
    historyGallerySort: raw.historyGallerySort === "oldest" ? "oldest" : "newest",
    runningJobIds: [],
    jobsTotal: hadRunningJobs || droppedVolatileBatchState ? 0 : (Number.isFinite(Number(raw.jobsTotal)) ? Number(raw.jobsTotal) : 0),
    jobsCompleted: hadRunningJobs || droppedVolatileBatchState ? 0 : (Number.isFinite(Number(raw.jobsCompleted)) ? Number(raw.jobsCompleted) : 0),
    jobsFailed: hadRunningJobs || droppedVolatileBatchState ? 0 : (Number.isFinite(Number(raw.jobsFailed)) ? Number(raw.jobsFailed) : 0),
    progress: hadRunningJobs || droppedVolatileBatchState ? null : normalizeProgressInfo(raw.progress),
    streamPreview,
    streamPreviews,
    lastLogLine: hadRunningJobs
      ? "页面已刷新，之前的进行中任务已中断。"
      : (typeof raw.lastLogLine === "string" ? raw.lastLogLine : ""),
    errorMessage: droppedVolatileBatchState
      ? null
      : hadRunningJobs
      ? WORKSPACE_SESSION_INTERRUPTED_MESSAGE
      : (typeof raw.errorMessage === "string" ? raw.errorMessage : null),
    errorRawPath: hadRunningJobs || droppedVolatileBatchState
      ? null
      : (typeof raw.errorRawPath === "string" && raw.errorRawPath.trim() ? raw.errorRawPath.trim() : null),
    lastPayload: null,
  };
}

export function normalizeBatchTasks(value: unknown): Record<string, BatchTaskRecord> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, BatchTaskRecord> = {};
  for (const rawTask of Object.values(value as Record<string, unknown>)) {
    const raw = rawTask as Partial<BatchTaskRecord>;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const workspaceId = typeof raw.workspaceId === "string" ? raw.workspaceId.trim() : "";
    const slotIndex = Number(raw.slotIndex);
    const prompt = typeof raw.prompt === "string" ? raw.prompt : "";
    if (!id || !workspaceId || !Number.isFinite(slotIndex) || slotIndex < 0 || !prompt.trim()) continue;
    const status = raw.status === "queued" || raw.status === "running" || raw.status === "succeeded"
      || raw.status === "failed" || raw.status === "cancelled" || raw.status === "interrupted"
      ? raw.status
      : "queued";
    out[id] = {
      id,
      runId: typeof raw.runId === "string" && raw.runId.trim() ? raw.runId.trim() : undefined,
      workspaceId,
      slotIndex: Math.floor(slotIndex),
      status,
      createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now(),
      updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : Date.now(),
      mode: raw.mode === "edit" ? "edit" : "generate",
      apiMode: raw.apiMode === "images" || raw.apiMode === "apimart" || raw.apiMode === "runninghub"
        ? raw.apiMode
        : "responses",
      apiProfileId: typeof raw.apiProfileId === "string" && raw.apiProfileId.trim() ? raw.apiProfileId.trim() : undefined,
      apiProfileName: typeof raw.apiProfileName === "string" && raw.apiProfileName.trim() ? raw.apiProfileName.trim() : undefined,
      apiBaseURL: typeof raw.apiBaseURL === "string" && raw.apiBaseURL.trim() ? raw.apiBaseURL.trim() : undefined,
      continuousPoolTask: raw.continuousPoolTask === true,
      prompt,
      size: normalizeWorkspaceSize(raw.size),
      autoAspectResolution: normalizeBatchTaskAutoAspectResolution(raw.autoAspectResolution),
      quality: normalizeWorkspaceQuality(raw.quality),
      outputFormat: normalizeWorkspaceOutputFormat(raw.outputFormat, "png"),
      requestPolicy: raw.requestPolicy === "compat" ? "compat" : raw.requestPolicy === "openai" ? "openai" : undefined,
      imagesNewAPICompat: raw.imagesNewAPICompat === true,
      textModelID: typeof raw.textModelID === "string" ? raw.textModelID : undefined,
      imageModelID: typeof raw.imageModelID === "string" ? raw.imageModelID : undefined,
      seed: Number.isFinite(Number(raw.seed)) ? Number(raw.seed) : undefined,
      negativePrompt: typeof raw.negativePrompt === "string" ? raw.negativePrompt : undefined,
      styleTag: typeof raw.styleTag === "string" ? raw.styleTag : undefined,
      sourceImagePaths: Array.isArray(raw.sourceImagePaths)
        ? raw.sourceImagePaths.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : undefined,
      panoramaRoundtrip: raw.panoramaRoundtrip,
      batchSourcePath: typeof raw.batchSourcePath === "string" && raw.batchSourcePath.trim() ? raw.batchSourcePath.trim() : undefined,
      batchSourceSlotIndex: Number.isFinite(Number(raw.batchSourceSlotIndex)) ? Math.max(0, Math.floor(Number(raw.batchSourceSlotIndex))) : undefined,
      maskB64: typeof raw.maskB64 === "string" ? raw.maskB64 : undefined,
      launchAttempt: Number.isFinite(Number(raw.launchAttempt)) ? Math.max(0, Math.floor(Number(raw.launchAttempt))) : undefined,
      launchStartedAt: Number.isFinite(Number(raw.launchStartedAt)) ? Number(raw.launchStartedAt) : undefined,
      jobId: typeof raw.jobId === "string" ? raw.jobId : undefined,
      groupId: typeof raw.groupId === "string" ? raw.groupId : undefined,
      historyItemId: typeof raw.historyItemId === "string" ? raw.historyItemId : undefined,
      savedPath: typeof raw.savedPath === "string" ? raw.savedPath : undefined,
      rawPath: typeof raw.rawPath === "string" ? raw.rawPath : undefined,
      apimartTaskId: typeof raw.apimartTaskId === "string" && raw.apimartTaskId.trim() ? raw.apimartTaskId.trim() : undefined,
      apimartTaskExpiresAt: Number.isFinite(Number(raw.apimartTaskExpiresAt)) ? Number(raw.apimartTaskExpiresAt) : undefined,
      errorMessage: typeof raw.errorMessage === "string" ? raw.errorMessage : undefined,
      lastLogLine: typeof raw.lastLogLine === "string" ? raw.lastLogLine : undefined,
      elapsedSec: Number.isFinite(Number(raw.elapsedSec)) ? Number(raw.elapsedSec) : undefined,
      queuedReason: raw.queuedReason === "local_concurrency" || raw.queuedReason === "batch_shared_concurrency" || raw.queuedReason === "continuous_pool"
        ? raw.queuedReason
        : undefined,
      queuePriority: Number.isFinite(Number(raw.queuePriority)) ? Number(raw.queuePriority) : undefined,
      batchOutputMode: raw.batchOutputMode === "custom_dir" ? "custom_dir" : raw.batchOutputMode === "source_dir" ? "source_dir" : undefined,
      batchOutputDir: typeof raw.batchOutputDir === "string" ? raw.batchOutputDir : undefined,
      batchOutputPrefix: typeof raw.batchOutputPrefix === "string" ? raw.batchOutputPrefix : undefined,
    };
  }
  return out;
}

export function persistWorkspaceSession(
  activeWorkspaceId: string,
  workspaces: Workspace[],
  batchTasksById: Record<string, BatchTaskRecord> = {},
): void {
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
      batchTasksById: compactWorkspaceSessionTasks(workspaces, batchTasksById),
    };
    localStorage.setItem(WORKSPACE_SESSION_LS_KEY, JSON.stringify(payload));
  } catch {}
}

export function loadWorkspaceSession(
  fallbackOutputFormat: OutputFormatValue,
): {
  activeWorkspaceId: string;
  serviceInstanceId: string;
  workspaces: Workspace[];
  batchTasksById: Record<string, BatchTaskRecord>;
} | null {
  try {
    const raw = localStorage.getItem(WORKSPACE_SESSION_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      activeWorkspaceId?: unknown;
      serviceInstanceId?: unknown;
      workspaces?: unknown;
      batchTasksById?: unknown;
    };
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
    return {
      activeWorkspaceId,
      serviceInstanceId,
      workspaces,
      batchTasksById: normalizeBatchTasks(parsed.batchTasksById),
    };
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
