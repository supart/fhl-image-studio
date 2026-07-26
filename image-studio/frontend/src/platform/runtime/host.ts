import { targetPlatform } from "../index.ts";
import {
  RemoteKernelError,
  runRemoteImageJob,
  optimizePromptRemote,
  reversePromptRemote,
} from "./remoteKernel.ts";
import {
  normalizeBaseURL as normalizeSharedBaseURL,
  normalizeRequestPolicy,
} from "../../../../../shared/kernel/requestModel.js";
import { validateAPIKeyForHeader } from "../../lib/apiKey.ts";
import { normalizeProviderBaseURL, ProviderPolicy } from "../../lib/providerPolicy.ts";
import {
  canUseWebGLImageTransforms,
  cropVirtualImage,
  flipVirtualImage,
  isVirtualPath,
  openImageDialogFallback,
  openVirtualPath,
  readVirtualImageAsBase64,
  readVirtualText,
  registerVirtualImage,
  registerVirtualText,
  releaseVirtualPath,
  rotateVirtualImage,
} from "../../lib/virtualHostStore.ts";
import {
  browserStoredAPIKey,
  fileNameFromPath,
  saveByDownload,
  setBrowserStoredAPIKey,
} from "./hostBrowser.ts";
import { cancelBrowserJobs } from "./browserJobClient.ts";
import { suggestImageFileName } from "../../lib/imageFileNames.ts";
import {
  canUseAndroidJobs,
  cancelAndroidJobs,
  submitAndroidJobGroup,
} from "./androidJobClient.ts";
import {
  buildProjectBatchOutputPath,
  chooseProjectDirectory,
  listProjectBatchInputImages,
  openProjectMaterialSyncDir,
  readProjectImage,
  readProjectText,
  registerProjectMedia,
  saveProjectImage,
  syncProjectMaterialGroup,
  takeLastProjectImageSaveError,
} from "./localProjectFiles.ts";
import {
  clearLocalEvents,
  emitLocalEvent,
  getForcedKernelRuntimeMode,
  onLocalEvent,
  setForcedKernelRuntimeMode,
} from "./hostEvents.ts";
import { isTransportishError } from "./remote-kernel/common.ts";
import {
  generationRequestForMode,
  toRemoteGenerationPayload,
  toWailsGenerationRequest,
} from "./generationRequest.ts";
import {
  canInvokeAndroidMethod,
  getRuntime,
  hasServiceMethod,
  invokeAndroid,
  invokeService,
} from "./hostBindings.ts";
import type {
  BatchInputDirectoryLike,
  BatchInputImageLike,
  AutomationStatusLike,
  GenerateOptionsLike,
  HostCapabilities,
  HostKind,
  ImageTransformResultLike,
  ImportedImageLike,
  JobStartedLike,
  KernelRuntimeMode,
  MaterialOutputSyncItemLike,
  MaterialOutputSyncResultLike,
  MediaAssetRefLike,
  ProbeUpstreamOptionsLike,
  ProbeUpstreamResultLike,
  PromptOptimizeOptionsLike,
  PromptReverseOptionsLike,
  SelectFileResponseLike,
  SelectFilesResponseLike,
} from "./hostTypes.ts";

const remoteJobControllers = new Map<string, AbortController>();
const FHL_BASE_URL = ProviderPolicy.fhl.baseURL;
const FHL_LOCAL_PROXY_PREFIX = "/__image-studio-fhl";
const APIMART_BASE_URL = ProviderPolicy.apimart.baseURL;
const APIMART_LEGACY_BASE_URL = ProviderPolicy.apimart.legacyBaseURL;
const APIMART_LOCAL_PROXY_PREFIX = "/__image-studio-apimart";
const APIMART_LEGACY_LOCAL_PROXY_PREFIX = "/__image-studio-apimart-legacy";
const APIMART_PROBE_TIMEOUT_MS = 15_000;

type LocalInputImageLike = ImportedImageLike & { name?: string };

function unsupportedMessage(method: string): string {
  const kind = detectHostKind();
  if (kind === "android-shell") {
    return `当前 Android shell 未提供 ${method} 对应的本地内核能力`;
  }
  if (kind === "browser") {
    return `当前浏览器预览环境未注入 ${method} 宿主能力`;
  }
  return `宿主未暴露 ${method} 能力`;
}

function isLocalPreviewHost(): boolean {
  if (typeof window === "undefined" || typeof window.location === "undefined") return false;
  const hostname = String(window.location.hostname || "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function bootstrapAutomationStatus(): AutomationStatusLike | undefined {
  return typeof window !== "undefined"
    ? (window as Window & { __IMAGE_STUDIO_E2E_BOOTSTRAP?: AutomationStatusLike }).__IMAGE_STUDIO_E2E_BOOTSTRAP
    : undefined;
}

function shouldFallbackFromEmptyNativeDialog(): boolean {
  return bootstrapAutomationStatus()?.e2eOnly === true;
}

function shouldAvoidVolatileBrowserImages(): boolean {
  return bootstrapAutomationStatus()?.e2eOnly === true;
}

function normalizeProbeBaseURL(
  raw: string,
  apiMode: "responses" | "images" | "apimart" | "runninghub" = "responses",
): string {
  const normalized = normalizeProviderBaseURL(apiMode, normalizeSharedBaseURL(raw));
  if (isLocalPreviewHost() && normalized === FHL_BASE_URL) {
    return `${window.location.origin}${FHL_LOCAL_PROXY_PREFIX}`;
  }
  if (isLocalPreviewHost() && normalized === APIMART_BASE_URL) {
    return `${window.location.origin}${APIMART_LOCAL_PROXY_PREFIX}`;
  }
  if (isLocalPreviewHost() && normalized === APIMART_LEGACY_BASE_URL) {
    return `${window.location.origin}${APIMART_LEGACY_LOCAL_PROXY_PREFIX}`;
  }
  return normalized;
}

function summarizeProbeBody(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260);
}

function fallbackAPIMartProbeBaseURL(baseURL: string): string {
  const normalized = String(baseURL || "").replace(/\/+$/, "").replace(/\/v1$/i, "");
  if (normalized === APIMART_BASE_URL) return APIMART_LEGACY_BASE_URL;
  if (normalized.endsWith(APIMART_LOCAL_PROXY_PREFIX)) {
    return `${normalized.slice(0, -APIMART_LOCAL_PROXY_PREFIX.length)}${APIMART_LEGACY_LOCAL_PROXY_PREFIX}`;
  }
  return "";
}

function apimartProbeSignal(signal?: AbortSignal): AbortSignal | undefined {
  if (typeof AbortSignal === "undefined" || typeof AbortSignal.timeout !== "function") return signal;
  const timeout = AbortSignal.timeout(APIMART_PROBE_TIMEOUT_MS);
  if (signal && typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeout]);
  return timeout;
}

function isRetryableAPIMartProbeError(error: unknown): boolean {
  const name = String((error as any)?.name || "").toLowerCase();
  const message = String((error as any)?.message || error || "").toLowerCase();
  return name === "timeouterror"
    || message.includes("timeout")
    || /\b50[0-4]\b/.test(message)
    || isTransportishError(error);
}

async function probeUpstreamFromBrowser(
  baseURL: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<void> {
  const normalizedBaseURL = normalizeProbeBaseURL(baseURL);
  const headerAPIKey = validateAPIKeyForHeader(apiKey);
  if (!normalizedBaseURL) throw new Error("BASE_URL 不能为空");
  const response = await fetch(`${normalizedBaseURL}/v1/models`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${headerAPIKey}`,
      Accept: "application/json",
    },
    signal,
  });
  const raw = await response.text();
  if (!response.ok) {
    const summary = summarizeProbeBody(raw);
    throw new Error(summary ? `上游 /v1/models 返回 ${response.status}: ${summary}` : `上游 /v1/models 返回 ${response.status}`);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("上游 /v1/models 返回的 JSON 无效");
  }
  if (!Array.isArray(parsed?.data)) {
    throw new Error("上游 /v1/models 响应缺少 data 数组");
  }
}

async function probeAPIMartFromBrowser(
  baseURL: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<void> {
  const normalizedBaseURL = normalizeProbeBaseURL(baseURL, "apimart");
  const headerAPIKey = validateAPIKeyForHeader(apiKey);
  if (!normalizedBaseURL) throw new Error("BASE_URL 不能为空");
  const probeOnce = async (probeBaseURL: string): Promise<void> => {
  const response = await fetch(`${probeBaseURL}/v1/balance`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${headerAPIKey}`,
      Accept: "application/json",
    },
    signal: apimartProbeSignal(signal),
  });
  const raw = await response.text();
  const summary = summarizeProbeBody(raw);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(summary ? `APIMart API Key 无效或未授权 (${response.status}): ${summary}` : `APIMart API Key 无效或未授权 (${response.status})`);
    }
    if (response.status >= 500) {
      throw new Error(summary ? `APIMart 上游或网络异常 (${response.status}): ${summary}` : `APIMart 上游或网络异常 (${response.status})`);
    }
    throw new Error(summary ? `APIMart /v1/balance 返回 ${response.status}: ${summary}` : `APIMart /v1/balance 返回 ${response.status}`);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("APIMart /v1/balance 返回的 JSON 无效");
  }
  if (parsed?.success === false || parsed?.ok === false) {
    const message = typeof parsed?.message === "string"
      ? parsed.message
      : typeof parsed?.error === "string"
        ? parsed.error
        : typeof parsed?.error?.message === "string"
          ? parsed.error.message
          : "";
    throw new Error(message ? `APIMart /v1/balance 返回失败: ${message}` : "APIMart /v1/balance 返回 success:false");
  }
  };
  try {
    await probeOnce(normalizedBaseURL);
  } catch (error) {
    const fallbackBaseURL = isRetryableAPIMartProbeError(error) ? fallbackAPIMartProbeBaseURL(normalizedBaseURL) : "";
    if (!fallbackBaseURL) throw error;
    await probeOnce(fallbackBaseURL);
  }
}

async function probeRunningHubFromBrowser(
  baseURL: string,
  signal?: AbortSignal,
): Promise<void> {
  const normalizedBaseURL = normalizeProbeBaseURL(baseURL, "runninghub");
  if (!normalizedBaseURL) throw new Error("BASE_URL 不能为空");
  const configResponse = await fetch(`${normalizedBaseURL}/api/config`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });
  const configRaw = await configResponse.text();
  const configSummary = summarizeProbeBody(configRaw);
  if (!configResponse.ok) {
    throw new Error(configSummary ? `RunningHub bridge /api/config 返回 ${configResponse.status}: ${configSummary}` : `RunningHub bridge /api/config 返回 ${configResponse.status}`);
  }
  let configParsed: any;
  try {
    configParsed = JSON.parse(configRaw);
  } catch {
    throw new Error("RunningHub bridge /api/config 返回的 JSON 无效");
  }
  if (configParsed?.ok === false) {
    throw new Error(String(configParsed?.message || "RunningHub bridge /api/config 返回失败"));
  }
  if (configParsed?.config?.api_key_configured !== true) {
    throw new Error("RunningHub bridge 可达，但桥接里还没有配置 RunningHub API Key");
  }

  const sizesResponse = await fetch(`${normalizedBaseURL}/api/runninghub-sizes`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });
  const sizesRaw = await sizesResponse.text();
  const sizesSummary = summarizeProbeBody(sizesRaw);
  if (!sizesResponse.ok) {
    throw new Error(sizesSummary ? `RunningHub bridge /api/runninghub-sizes 返回 ${sizesResponse.status}: ${sizesSummary}` : `RunningHub bridge /api/runninghub-sizes 返回 ${sizesResponse.status}`);
  }
  let sizesParsed: any;
  try {
    sizesParsed = JSON.parse(sizesRaw);
  } catch {
    throw new Error("RunningHub bridge /api/runninghub-sizes 返回的 JSON 无效");
  }
  if (sizesParsed?.ok === false) {
    throw new Error(String(sizesParsed?.message || "RunningHub bridge /api/runninghub-sizes 返回失败"));
  }
  if (!sizesParsed?.modes?.["text-to-image"] || !sizesParsed?.modes?.["image-to-image"]) {
    throw new Error("RunningHub bridge 没有返回完整的文生图/图生图能力矩阵");
  }
}
function makeJobID(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `job-${crypto.randomUUID()}`;
    }
  } catch {
    // ignore
  }
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function supportsDesktopNativeGPUTransforms(): boolean {
  return detectHostKind() === "wails-desktop" && targetPlatform === "macos";
}

async function persistVirtualTransformResult(
  result: { path: string; imageB64?: string; mimeType?: string; name?: string; acceleration?: string },
  fallbackName: string,
): Promise<ImageTransformResultLike> {
  const imageB64 = result.imageB64 || readVirtualImageAsBase64(result.path);
  const suggested = result.name || fallbackName;
  const imported = await ImportImageFromB64(imageB64, suggested);
  return {
    path: imported.path,
    acceleration: result.acceleration,
  };
}

async function materializeReadablePathAsVirtual(path: string): Promise<ImportedImageLike> {
  const imageB64 = await ReadImageAsBase64(path);
  return registerVirtualImage({
    imageB64,
    suggestedName: fileNameFromPath(path),
  });
}

async function persistBrowserImageToLocalInput(
  imageB64: string,
  suggestedName: string,
  mimeType?: string | null,
  options: { subdir?: string; preserveName?: boolean } = {},
): Promise<LocalInputImageLike | null> {
  const saved = await saveProjectImage("input", imageB64, suggestedName, mimeType, options);
  if (saved?.path) {
    return {
      path: saved.path,
      name: saved.name,
    };
  }
  if (!hasServiceMethod("ImportImageFromB64")) return null;
  return invokeService<ImportedImageLike>(unsupportedMessage, "ImportImageFromB64", imageB64, suggestedName)
    .then((imported) => {
      const importedPath = String(imported?.path || "").trim();
      return importedPath && !isVirtualPath(importedPath) ? imported : null;
    })
    .catch((error) => {
      if (typeof console !== "undefined") console.warn("native import fallback failed", error);
      return null;
    });
}

async function persistBrowserSelectedImage(res: SelectFileResponseLike): Promise<SelectFileResponseLike> {
  const selectedPath = String(res?.path || "").trim();
  const imageB64 = String(res?.imageB64 || "").trim();
  if (!selectedPath || !imageB64 || !isLocalPreviewHost() || !isVirtualPath(selectedPath)) return res;
  const imported = await persistBrowserImageToLocalInput(imageB64, fileNameFromPath(selectedPath));
  if (!imported?.path) return res;
  return {
    ...res,
    path: imported.path,
    width: imported.width ?? res.width,
    height: imported.height ?? res.height,
    previewUrl: imported.previewUrl || res.previewUrl,
    previewWidth: imported.previewWidth ?? res.previewWidth,
    previewHeight: imported.previewHeight ?? res.previewHeight,
  };
}

type BrowserDirectoryInput = HTMLInputElement & {
  webkitdirectory?: boolean;
  directory?: boolean;
};

type BrowserBatchDirectoryPick = {
  label: string;
  files: File[];
};

function batchInputMimeMatch(file: File): boolean {
  return /^image\/(png|jpe?g|webp)$/i.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
}

function safeBatchFolderSegment(value: string): string {
  return String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "batch";
}

function directoryFromFilePath(filePath: string): string {
  const normalized = String(filePath || "").trim();
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return index >= 0 ? normalized.slice(0, index) : "";
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error(`failed to read ${file.name}`));
    reader.onload = () => {
      const raw = String(reader.result || "");
      const comma = raw.indexOf(",");
      resolve((comma >= 0 ? raw.slice(comma + 1) : raw).trim());
    };
    reader.readAsDataURL(file);
  });
}

function readBrowserImageDimensions(file: File): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve) => {
    try {
      const objectURL = URL.createObjectURL(file);
      const img = new Image();
      const cleanup = () => URL.revokeObjectURL(objectURL);
      img.onload = () => {
        resolve({
          width: img.naturalWidth || img.width || undefined,
          height: img.naturalHeight || img.height || undefined,
        });
        cleanup();
      };
      img.onerror = () => {
        resolve({});
        cleanup();
      };
      img.src = objectURL;
    } catch {
      resolve({});
    }
  });
}

async function persistBrowserBatchFiles(
  files: File[],
  subdir: string,
): Promise<BatchInputImageLike[]> {
  const savedFiles: BatchInputImageLike[] = [];
  const failedFiles: string[] = [];
  for (const file of files) {
    if (!batchInputMimeMatch(file)) continue;
    try {
      const imageB64 = await readFileAsBase64(file);
      const imported = await persistBrowserImageToLocalInput(imageB64, file.name, file.type || null, {
        subdir,
        preserveName: true,
      });
      const fallbackVirtual = () => registerVirtualImage({
        imageB64,
        suggestedName: file.name,
        mimeType: file.type || null,
      });
      const localFile = imported?.path
        ? {
          path: imported.path,
          name: imported.name || file.name,
          size: file.size,
          width: imported.width,
          height: imported.height,
          previewUrl: imported.previewUrl,
          previewWidth: imported.previewWidth,
          previewHeight: imported.previewHeight,
        }
        : shouldAvoidVolatileBrowserImages()
          ? null
          : {
          ...fallbackVirtual(),
          size: file.size,
        };
      if (!localFile?.path) {
        throw new Error(takeLastProjectImageSaveError() || "unable to persist local input image");
      }
      const dims = await readBrowserImageDimensions(file);
      savedFiles.push({
        path: localFile.path,
        name: file.name,
        size: file.size,
        width: localFile.width ?? dims.width,
        height: localFile.height ?? dims.height,
        previewUrl: localFile.previewUrl,
        previewWidth: localFile.previewWidth,
        previewHeight: localFile.previewHeight,
      });
    } catch (error: any) {
      failedFiles.push(`${file.name}: ${error?.message ?? error}`);
      if (typeof console !== "undefined") console.warn("batch input image skipped", file.name, error);
    }
  }
  if (savedFiles.length === 0 && failedFiles.length > 0) {
    throw new Error(`无法写入本地输入图片: ${failedFiles.slice(0, 3).join("; ")}`);
  }
  return savedFiles;
}

async function chooseBrowserFiles(options: {
  multiple?: boolean;
  directory?: boolean;
} = {}): Promise<File[]> {
  if (typeof document === "undefined") return [];
  return new Promise((resolve, reject) => {
    const input = document.createElement("input") as BrowserDirectoryInput;
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    input.multiple = options.multiple !== false;
    if (options.directory) {
      input.setAttribute("webkitdirectory", "");
      input.setAttribute("directory", "");
      input.webkitdirectory = true;
      input.directory = true;
    }
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    const cleanup = () => input.remove();
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      cleanup();
      resolve(files);
    }, { once: true });
    input.addEventListener("error", () => {
      cleanup();
      reject(new Error("failed to open file picker"));
    }, { once: true });
    input.click();
  });
}

async function openImagesDialogFallback(): Promise<SelectFilesResponseLike> {
  const files = await chooseBrowserFiles({ multiple: true });
  if (files.length === 0) return { files: [] };
  const subdir = `batch-inputs/manual-${Date.now().toString(36)}`;
  return { files: await persistBrowserBatchFiles(files, subdir) };
}

async function chooseBrowserBatchDirectoryFiles(): Promise<BrowserBatchDirectoryPick> {
  const showDirectoryPicker = typeof window !== "undefined"
    ? (window as typeof window & { showDirectoryPicker?: () => Promise<{ name?: string; values?: () => AsyncIterable<any> }> }).showDirectoryPicker
    : undefined;
  if (typeof showDirectoryPicker === "function") {
    try {
      const handle = await showDirectoryPicker();
      const files: File[] = [];
      if (handle?.values) {
        for await (const entry of handle.values()) {
          if (!entry || entry.kind !== "file" || typeof entry.getFile !== "function") continue;
          const file = await entry.getFile();
          if (file) files.push(file);
        }
      }
      return {
        label: String(handle?.name || "").trim(),
        files,
      };
    } catch (error: any) {
      if (String(error?.name || "") === "AbortError") {
        return { label: "", files: [] };
      }
      throw error;
    }
  }

  // Embedded preview browsers can crash on `webkitdirectory`; fall back to the
  // regular multi-file picker instead of opening an unstable directory dialog.
  return {
    label: "",
    files: await chooseBrowserFiles({ multiple: true }),
  };
}

async function chooseBatchInputDirFallback(): Promise<BatchInputDirectoryLike> {
  const picked = await chooseBrowserBatchDirectoryFiles();
  if (picked.files.length === 0) return { directory: "", images: [] };
  const typedFiles = picked.files.filter((file) => batchInputMimeMatch(file));
  if (typedFiles.length === 0) return { directory: "", images: [] };
  const relativePaths = typedFiles.map((file) => String((file as any).webkitRelativePath || file.name));
  const rootName = picked.label || relativePaths[0]?.split(/[\\/]/).filter(Boolean)[0] || "batch-input";
  const topLevelFiles = typedFiles.filter((file) => {
    const rel = String((file as any).webkitRelativePath || file.name);
    const segments = rel.split(/[\\/]/).filter(Boolean);
    return segments.length <= 2;
  });
  const selectedFiles = topLevelFiles.length > 0 ? topLevelFiles : typedFiles;
  const subdir = `batch-inputs/${safeBatchFolderSegment(rootName)}-${Date.now().toString(36)}`;
  const savedFiles = await persistBrowserBatchFiles(selectedFiles, subdir);
  return {
    directory: directoryFromFilePath(savedFiles[0]?.path || ""),
    images: savedFiles,
  };
}

async function importHistoryFallback(): Promise<string> {
  if (typeof document === "undefined") return "";
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    const cleanup = () => input.remove();
    input.addEventListener("change", async () => {
      try {
        const file = input.files?.[0];
        if (!file) {
          cleanup();
          resolve("");
          return;
        }
        cleanup();
        resolve(await file.text());
      } catch (error) {
        cleanup();
        reject(error);
      }
    }, { once: true });
    input.click();
  });
}

async function startRemoteJob(options: GenerateOptionsLike): Promise<JobStartedLike> {
  const jobId = options.requestedJobId?.trim() || makeJobID();
  const controller = new AbortController();
  remoteJobControllers.set(jobId, controller);
  void (async () => {
    try {
      const result = await runRemoteImageJob({
        payload: toRemoteGenerationPayload(options),
        sourceImages: options.sourceImages,
      }, {
        signal: controller.signal,
        onLog: (line) => emitLocalEvent(`log:${jobId}`, line),
        onProgress: (stage, elapsed, bytes) => emitLocalEvent(`progress:${jobId}`, { stage, elapsed, bytes }),
        onPartialImage: (partial) => emitLocalEvent(`preview:${jobId}`, {
          imageB64: partial.imageB64,
          revisedPrompt: partial.revisedPrompt || "",
          partialImageIndex: partial.partialImageIndex ?? -1,
          mode: options.mode || "generate",
          prompt: options.prompt,
        }),
      });
      if (controller.signal.aborted) return;
      const suggestedName = suggestImageFileName({
        prompt: result.prompt || options.prompt,
        outputFormat: options.outputFormat || "png",
      });
      const nativeSavedPath = canInvokeAndroidMethod("SaveImageAs")
        ? await SaveImageAs(result.imageB64, suggestedName).catch(() => "")
        : "";
      const projectSaved = nativeSavedPath ? null : await saveProjectImage("output", result.imageB64, suggestedName);
      const saved = registerVirtualImage({
        imageB64: result.imageB64,
        suggestedName,
      });
      emitLocalEvent(`result:${jobId}`, {
        imageB64: result.imageB64,
        revisedPrompt: result.revisedPrompt,
        sourceEvent: result.sourceEvent,
        savedPath: nativeSavedPath || projectSaved?.path || saved.path,
        rawPath: result.rawPath,
        apimartTaskId: result.apimartTaskId || undefined,
        mode: result.mode,
        prompt: result.prompt,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      const typed = error instanceof RemoteKernelError
        ? error
        : new RemoteKernelError(String((error as any)?.message || error));
      emitLocalEvent(`error:${jobId}`, {
        message: typed.message,
        rawPath: typed.rawPath || null,
        apimartTaskId: typed.apimartTaskId || undefined,
      });
    } finally {
      remoteJobControllers.delete(jobId);
    }
  })();
  return { jobId };
}

function mimeTypeForImageName(name: string): string {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

function blobFromBase64(imageB64: string, mimeType: string): Blob {
  return new Blob([Uint8Array.from(atob(imageB64), (ch) => ch.charCodeAt(0))], { type: mimeType });
}

function shouldUseAndroidBackgroundJobs(options: GenerateOptionsLike): boolean {
  void options;
  return false;
}

async function submitSingleAndroidJob(options: GenerateOptionsLike): Promise<JobStartedLike> {
  const response = await submitAndroidJobGroup({
    workspaceId: "default",
    mode: options.mode === "edit" ? "edit" : "generate",
    prompt: options.prompt,
    size: options.size as any,
    quality: options.quality as any,
    outputFormat: options.outputFormat as any,
    batchCount: 1,
    seed: options.seed || 0,
    negativePrompt: options.negativePrompt || "",
    sourceImagePaths: options.imagePaths || [],
    maskB64: options.maskB64 || "",
    apiKey: options.apiKey,
    apiProfileId: options.apiProfileId,
    baseURL: options.baseURL,
    apiMode: "responses",
    requestPolicy: normalizeRequestPolicy(options.requestPolicy) as any,
    imagesNewAPICompat: false,
    textModelID: options.textModelID,
    imageModelID: options.imageModelID,
  });
  return { jobId: response.jobIds[0] || options.requestedJobId || "" };
}

async function runPersistedVirtualTransform(
  path: string,
  transform: (virtualPath: string) => Promise<{ path: string; imageB64?: string; mimeType?: string; name?: string; acceleration?: string }>,
): Promise<ImageTransformResultLike> {
  const imported = await materializeReadablePathAsVirtual(path);
  let resultPath: string | null = null;
  try {
    const result = await transform(imported.path);
    resultPath = result.path;
    return await persistVirtualTransformResult(result, fileNameFromPath(path));
  } finally {
    releaseVirtualPath(imported.path);
    if (resultPath && resultPath !== imported.path) releaseVirtualPath(resultPath);
  }
}

export function detectHostKind(): HostKind {
  if (targetPlatform === "android" || targetPlatform === "android-pad") {
    return canInvokeAndroidMethod("GetOutputDir") || hasServiceMethod("GetOutputDir") ? "android-shell" : "browser";
  }
  if (hasServiceMethod("Generate") && getRuntime()) return "wails-desktop";
  return "browser";
}

export function setKernelRuntimeMode(mode: KernelRuntimeMode) {
  setForcedKernelRuntimeMode(mode);
}

export function getKernelRuntimeMode(): KernelRuntimeMode {
  return getForcedKernelRuntimeMode();
}

export function getHostCapabilities(): HostCapabilities {
  const kind = detectHostKind();
  const localGenerationCapable = kind === "wails-desktop" && hasServiceMethod("Generate") && hasServiceMethod("Edit");
  const localPromptOptimizeCapable = kind === "wails-desktop" && hasServiceMethod("OptimizePrompt");
  const localModeEnabled = getForcedKernelRuntimeMode() !== "remote";
  const hasDesktopNativeTransforms = kind === "wails-desktop"
    && hasServiceMethod("RotateImage")
    && hasServiceMethod("FlipImage")
    && hasServiceMethod("CropImage");
  const webGLTransforms = canUseWebGLImageTransforms();
  const imageTransformAcceleration = supportsDesktopNativeGPUTransforms()
    ? "gpu-metal"
    : webGLTransforms
      ? "gpu-webgl"
      : hasDesktopNativeTransforms
        ? "native"
        : kind === "android-shell" || kind === "browser"
          ? "cpu-canvas"
          : "none";
  return {
    localGeneration: localGenerationCapable && localModeEnabled,
    promptOptimization: localPromptOptimizeCapable && localModeEnabled,
    nativeFileDialogs: kind === "wails-desktop" || canInvokeAndroidMethod("OpenImageDialog"),
    nativeImageTransforms:
      hasDesktopNativeTransforms
      || kind === "android-shell"
      || kind === "browser",
    imageTransformAcceleration,
    nativeHistoryFileIO: kind === "wails-desktop" || canInvokeAndroidMethod("ImportHistoryFromFile"),
    nativeOutputDirectoryPicker: hasServiceMethod("ChooseOutputDir") && kind !== "android-shell",
    secureCredentialStore: kind === "wails-desktop",
  };
}

export function EventsOn(eventName: string, callback: (...args: any[]) => void) {
  const offLocal = onLocalEvent(eventName, callback);
  const runtime = getRuntime();
  const offRuntime = runtime?.EventsOnMultiple
    ? runtime.EventsOnMultiple(eventName, callback, -1)
    : () => undefined;
  return () => {
    offLocal();
    offRuntime();
  };
}

export function EventsOff(eventName: string, ...additionalEventNames: string[]) {
  clearLocalEvents(eventName, ...additionalEventNames);
  getRuntime()?.EventsOff?.(eventName, ...additionalEventNames);
}

export function WindowSetSystemDefaultTheme() {
  getRuntime()?.WindowSetSystemDefaultTheme?.();
}

export function WindowSetLightTheme() {
  getRuntime()?.WindowSetLightTheme?.();
}

export function WindowSetDarkTheme() {
  getRuntime()?.WindowSetDarkTheme?.();
}

export function Generate(options: GenerateOptionsLike): Promise<JobStartedLike> {
  const request = generationRequestForMode(options, "generate");
  if (getForcedKernelRuntimeMode() === "local" && detectHostKind() !== "wails-desktop") {
    return Promise.reject(new Error("当前宿主不支持强制本地内核"));
  }
  if (getHostCapabilities().localGeneration) {
    return invokeService<JobStartedLike>(unsupportedMessage, "Generate", toWailsGenerationRequest(request));
  }
  if (shouldUseAndroidBackgroundJobs(request)) {
    return submitSingleAndroidJob(request);
  }
  return startRemoteJob(request);
}

export function Edit(options: GenerateOptionsLike): Promise<JobStartedLike> {
  const request = generationRequestForMode(options, "edit");
  if (getForcedKernelRuntimeMode() === "local" && detectHostKind() !== "wails-desktop") {
    return Promise.reject(new Error("当前宿主不支持强制本地内核"));
  }
  if (getHostCapabilities().localGeneration) {
    return invokeService<JobStartedLike>(unsupportedMessage, "Edit", toWailsGenerationRequest(request));
  }
  if (shouldUseAndroidBackgroundJobs(request)) {
    return submitSingleAndroidJob(request);
  }
  return startRemoteJob(request);
}

export function OptimizePrompt(options: PromptOptimizeOptionsLike): Promise<string> {
  if (getForcedKernelRuntimeMode() === "local" && detectHostKind() !== "wails-desktop") {
    return Promise.reject(new Error("当前宿主不支持强制本地内核"));
  }
  if (getHostCapabilities().promptOptimization) {
    return invokeService<string>(unsupportedMessage, "OptimizePrompt", options);
  }
  const controller = new AbortController();
  return optimizePromptRemote({
    apiKey: options.apiKey,
    prompt: options.prompt,
    optimizationGuidance: options.optimizationGuidance,
    mode: options.mode,
    baseURL: options.baseURL,
    textModelID: options.textModelID,
    proxyMode: options.proxyMode,
    proxyURL: options.proxyURL,
    imagePaths: options.imagePaths,
    imagePath: options.imagePath,
  }, controller.signal);
}

export function ReversePrompt(options: PromptReverseOptionsLike): Promise<string> {
  if (getForcedKernelRuntimeMode() === "local" && detectHostKind() !== "wails-desktop") {
    return Promise.reject(new Error("当前宿主不支持强制本地内核"));
  }
  if (detectHostKind() === "wails-desktop" && hasServiceMethod("ReversePrompt") && getForcedKernelRuntimeMode() !== "remote") {
    const { sourceImages: _sourceImages, ...payload } = options;
    return invokeService<string>(unsupportedMessage, "ReversePrompt", payload);
  }
  const controller = new AbortController();
  return reversePromptRemote({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    textModelID: options.textModelID,
    proxyMode: options.proxyMode,
    proxyURL: options.proxyURL,
    imagePaths: options.imagePaths,
    imagePath: options.imagePath,
    sourceImages: options.sourceImages,
  }, controller.signal);
}

export function Cancel(jobId: string): Promise<void> {
  const remote = remoteJobControllers.get(jobId);
  if (remote) {
    remote.abort();
    remoteJobControllers.delete(jobId);
    return Promise.resolve();
  }
  if (detectHostKind() === "browser") {
    return cancelBrowserJobs([jobId]).then(() => undefined).catch(() => undefined);
  }
  if (detectHostKind() === "android-shell" && canUseAndroidJobs()) {
    return cancelAndroidJobs([jobId]).then(() => undefined).catch(() => undefined);
  }
  if (hasServiceMethod("Cancel")) {
    return invokeService<void>(unsupportedMessage, "Cancel", jobId);
  }
  if (canInvokeAndroidMethod("Cancel")) {
    return invokeAndroid<void>(unsupportedMessage, "Cancel", jobId).catch(() => undefined);
  }
  return Promise.resolve();
}

export function OpenImageDialog(): Promise<SelectFileResponseLike> {
  if (hasServiceMethod("OpenImageDialog")) {
    return invokeService<SelectFileResponseLike>(unsupportedMessage, "OpenImageDialog")
      .catch(() => openImageDialogFallback())
      .then((res) => persistBrowserSelectedImage(res));
  }
  if (canInvokeAndroidMethod("OpenImageDialog")) {
    return invokeAndroid<SelectFileResponseLike>(unsupportedMessage, "OpenImageDialog")
      .catch(() => openImageDialogFallback())
      .then((res) => persistBrowserSelectedImage(res));
  }
  return openImageDialogFallback().then((res) => persistBrowserSelectedImage(res));
}

export function OpenImagesDialog(): Promise<SelectFilesResponseLike> {
  if (hasServiceMethod("OpenImagesDialog")) {
    return invokeService<SelectFilesResponseLike>(unsupportedMessage, "OpenImagesDialog")
      .then((res) => {
        if (shouldFallbackFromEmptyNativeDialog() && (!Array.isArray(res?.files) || res.files.length === 0)) {
          return openImagesDialogFallback();
        }
        return res;
      })
      .catch(() => openImagesDialogFallback());
  }
  return openImagesDialogFallback();
}

export function ChooseBatchInputDir(): Promise<BatchInputDirectoryLike> {
  if (hasServiceMethod("ChooseBatchInputDir")) {
    return invokeService<BatchInputDirectoryLike>(unsupportedMessage, "ChooseBatchInputDir")
      .then((res) => {
        const images = Array.isArray(res?.images) ? res.images : [];
        if (shouldFallbackFromEmptyNativeDialog() && !String(res?.directory || "").trim() && images.length === 0) {
          return chooseBatchInputDirFallback();
        }
        return res;
      })
      .catch(() => chooseBatchInputDirFallback());
  }
  return chooseBatchInputDirFallback();
}

export function ListBatchInputImages(directory: string): Promise<BatchInputDirectoryLike> {
  if (hasServiceMethod("ListBatchInputImages")) {
    return invokeService<BatchInputDirectoryLike>(unsupportedMessage, "ListBatchInputImages", directory);
  }
  return listProjectBatchInputImages(directory).then((result) => {
    if (result) return result;
    throw new Error(unsupportedMessage("ListBatchInputImages"));
  });
}

export function GetOutputDir(): Promise<string> {
  if (hasServiceMethod("GetOutputDir")) {
    return invokeService<string>(unsupportedMessage, "GetOutputDir");
  }
  if (canInvokeAndroidMethod("GetOutputDir")) {
    return invokeAndroid<string>(unsupportedMessage, "GetOutputDir");
  }
  return Promise.resolve("");
}

export function GetAutomationStatus(): Promise<AutomationStatusLike> {
  const bootstrapStatus = bootstrapAutomationStatus();
  if (hasServiceMethod("GetAutomationStatus")) {
    return invokeService<AutomationStatusLike>(unsupportedMessage, "GetAutomationStatus")
      .catch(() => bootstrapStatus ?? { enabled: false });
  }
  return Promise.resolve(bootstrapStatus ?? { enabled: false });
}

export function DeleteStoredAPIKey(user: string): Promise<void> {
  if (hasServiceMethod("DeleteStoredAPIKey")) {
    return invokeService<void>(unsupportedMessage, "DeleteStoredAPIKey", user);
  }
  if (canInvokeAndroidMethod("DeleteStoredAPIKey")) {
    return invokeAndroid<void>(unsupportedMessage, "DeleteStoredAPIKey", user);
  }
  setBrowserStoredAPIKey(user, "");
  return Promise.resolve();
}

export function GetStoredAPIKey(user: string): Promise<string> {
  if (hasServiceMethod("GetStoredAPIKey")) {
    return invokeService<string>(unsupportedMessage, "GetStoredAPIKey", user);
  }
  if (canInvokeAndroidMethod("GetStoredAPIKey")) {
    return invokeAndroid<string>(unsupportedMessage, "GetStoredAPIKey", user);
  }
  return Promise.resolve(browserStoredAPIKey(user));
}

export function SetStoredAPIKey(user: string, value: string): Promise<void> {
  if (hasServiceMethod("SetStoredAPIKey")) {
    return invokeService<void>(unsupportedMessage, "SetStoredAPIKey", user, value);
  }
  if (canInvokeAndroidMethod("SetStoredAPIKey")) {
    return invokeAndroid<void>(unsupportedMessage, "SetStoredAPIKey", user, value);
  }
  setBrowserStoredAPIKey(user, value);
  return Promise.resolve();
}

export function SaveImageAs(imageB64: string, suggestedName: string): Promise<string> {
  if (hasServiceMethod("SaveImageAs")) {
    return invokeService<string>(unsupportedMessage, "SaveImageAs", imageB64, suggestedName);
  }
  if (canInvokeAndroidMethod("SaveImageAs")) {
    return invokeAndroid<string>(unsupportedMessage, "SaveImageAs", imageB64, suggestedName);
  }
  const mimeType = mimeTypeForImageName(suggestedName);
  return saveProjectImage("output", imageB64, suggestedName, mimeType).then((projectSaved) => {
    if (projectSaved?.path) return projectSaved.path;
    return saveByDownload(blobFromBase64(imageB64, mimeType), suggestedName);
  });
}

export function SaveImagePathAs(path: string, suggestedName: string): Promise<string> {
  if (hasServiceMethod("SaveImagePathAs")) {
    return invokeService<string>(unsupportedMessage, "SaveImagePathAs", path, suggestedName);
  }
  if (isVirtualPath(path)) {
    return ReadImageAsBase64(path).then((b64) => SaveImageAs(b64, suggestedName));
  }
  if (canInvokeAndroidMethod("SaveImagePathAs")) {
    return invokeAndroid<string>(unsupportedMessage, "SaveImagePathAs", path, suggestedName)
      .catch(() => ReadImageAsBase64(path).then((b64) => SaveImageAs(b64, suggestedName)));
  }
  return ReadImageAsBase64(path).then((b64) => SaveImageAs(b64, suggestedName));
}

export function SaveImageToDir(imageB64: string, directory: string, suggestedName: string): Promise<string> {
  if (hasServiceMethod("SaveImageToDir")) {
    return invokeService<string>(unsupportedMessage, "SaveImageToDir", imageB64, directory, suggestedName);
  }
  if (canInvokeAndroidMethod("SaveImageToDir")) {
    return invokeAndroid<string>(unsupportedMessage, "SaveImageToDir", imageB64, directory, suggestedName);
  }
  const mimeType = mimeTypeForImageName(suggestedName);
  return saveProjectImage("output", imageB64, suggestedName, mimeType, { directory }).then((projectSaved) => {
    if (projectSaved?.path) return projectSaved.path;
    throw new Error(unsupportedMessage("SaveImageToDir"));
  });
}

export function SaveImagePathToDir(path: string, directory: string, suggestedName: string): Promise<string> {
  if (hasServiceMethod("SaveImagePathToDir")) {
    return invokeService<string>(unsupportedMessage, "SaveImagePathToDir", path, directory, suggestedName);
  }
  if (isVirtualPath(path)) {
    return ReadImageAsBase64(path).then((b64) => SaveImageToDir(b64, directory, suggestedName));
  }
  if (canInvokeAndroidMethod("SaveImagePathToDir")) {
    return invokeAndroid<string>(unsupportedMessage, "SaveImagePathToDir", path, directory, suggestedName)
      .catch(() => ReadImageAsBase64(path).then((b64) => SaveImageToDir(b64, directory, suggestedName)));
  }
  return ReadImageAsBase64(path).then((b64) => SaveImageToDir(b64, directory, suggestedName));
}

export function BeginNativeFileDrag(path: string): Promise<void> {
  if (hasServiceMethod("BeginNativeFileDrag")) {
    return invokeService<void>(unsupportedMessage, "BeginNativeFileDrag", path);
  }
  return Promise.reject(new Error(unsupportedMessage("BeginNativeFileDrag")));
}

export function SyncMaterialGroupToOutput(
  groupKind: string,
  groupName: string,
  items: MaterialOutputSyncItemLike[],
): Promise<MaterialOutputSyncResultLike> {
  if (hasServiceMethod("SyncMaterialGroupToOutput")) {
    return invokeService<MaterialOutputSyncResultLike>(
      unsupportedMessage,
      "SyncMaterialGroupToOutput",
      groupKind,
      groupName,
      items,
    );
  }
  return syncProjectMaterialGroup(groupKind, groupName, items).then((result) => {
    if (result) return result;
    throw new Error(unsupportedMessage("SyncMaterialGroupToOutput"));
  });
}

export async function ShareImageAs(imageB64: string, suggestedName: string): Promise<string> {
  if (!imageB64.trim()) throw new Error("没有可分享的图片");
  if (canInvokeAndroidMethod("ShareImageAs")) {
    return invokeAndroid<string>(unsupportedMessage, "ShareImageAs", imageB64, suggestedName);
  }
  const mimeType = mimeTypeForImageName(suggestedName);
  if (typeof navigator !== "undefined" && navigator.share && typeof File !== "undefined") {
    const file = new File([blobFromBase64(imageB64, mimeType)], suggestedName, { type: mimeType });
    const canShare = !navigator.canShare || navigator.canShare({ files: [file] });
    if (canShare) {
      await navigator.share({ files: [file], title: suggestedName });
      return suggestedName;
    }
  }
  return SaveImageAs(imageB64, suggestedName);
}

export function ShareImagePathAs(path: string, suggestedName: string): Promise<string> {
  if (!path.trim()) return Promise.reject(new Error("没有可分享的图片"));
  if (canInvokeAndroidMethod("ShareImagePathAs")) {
    return invokeAndroid<string>(unsupportedMessage, "ShareImagePathAs", path, suggestedName)
      .catch(() => ReadImageAsBase64(path).then((b64) => ShareImageAs(b64, suggestedName)));
  }
  return ReadImageAsBase64(path).then((b64) => ShareImageAs(b64, suggestedName));
}

export function RegisterMediaAsset(savedPath: string, thumbPath: string): Promise<MediaAssetRefLike> {
  if (hasServiceMethod("RegisterMediaAsset")) {
    return invokeService<MediaAssetRefLike>(unsupportedMessage, "RegisterMediaAsset", savedPath, thumbPath);
  }
  return registerProjectMedia(savedPath, thumbPath)
    .then((ref) => ref ?? { savedPath, thumbPath });
}

export function RegisterImportedImageAsset(path: string): Promise<MediaAssetRefLike> {
  if (hasServiceMethod("RegisterImportedImageAsset")) {
    return invokeService<MediaAssetRefLike>(unsupportedMessage, "RegisterImportedImageAsset", path);
  }
  return registerProjectMedia(path)
    .then((ref) => ref ?? { savedPath: path });
}

export function ImportImageFromB64(imageB64: string, suggestedName: string): Promise<ImportedImageLike> {
  if (hasServiceMethod("ImportImageFromB64")) {
    return invokeService<ImportedImageLike>(unsupportedMessage, "ImportImageFromB64", imageB64, suggestedName)
      .catch(() => registerVirtualImage({ imageB64, suggestedName }));
  }
  if (canInvokeAndroidMethod("ImportImageFromB64")) {
    return invokeAndroid<ImportedImageLike>(unsupportedMessage, "ImportImageFromB64", imageB64, suggestedName)
      .catch(() => registerVirtualImage({ imageB64, suggestedName }));
  }
  return saveProjectImage("input", imageB64, suggestedName)
    .then((saved) => saved
      ? { path: saved.path, imageB64 }
      : registerVirtualImage({ imageB64, suggestedName }));
}

export function ImportImagePath(path: string): Promise<ImportedImageLike> {
  const suggestedName = fileNameFromPath(path);
  if (hasServiceMethod("ImportImagePath")) {
    return invokeService<ImportedImageLike>(unsupportedMessage, "ImportImagePath", path);
  }
  return ReadImageAsBase64(path)
    .then((imageB64) => ImportImageFromB64(imageB64, suggestedName));
}

export function RotateImage(path: string, degrees: number): Promise<ImageTransformResultLike> {
  if (isVirtualPath(path)) {
    return rotateVirtualImage(path, degrees).then((result) => ({ path: result.path, acceleration: result.acceleration || "cpu-canvas" }));
  }
  if (supportsDesktopNativeGPUTransforms()) {
    return invokeService<ImageTransformResultLike>(unsupportedMessage, "RotateImage", path, degrees);
  }
  return runPersistedVirtualTransform(path, (virtualPath) => rotateVirtualImage(virtualPath, degrees));
}

export function FlipImage(path: string, horizontal: boolean): Promise<ImageTransformResultLike> {
  if (isVirtualPath(path)) {
    return flipVirtualImage(path, horizontal).then((result) => ({ path: result.path, acceleration: result.acceleration || "cpu-canvas" }));
  }
  if (supportsDesktopNativeGPUTransforms()) {
    return invokeService<ImageTransformResultLike>(unsupportedMessage, "FlipImage", path, horizontal);
  }
  return runPersistedVirtualTransform(path, (virtualPath) => flipVirtualImage(virtualPath, horizontal));
}

export function CropImage(path: string, x: number, y: number, width: number, height: number): Promise<ImageTransformResultLike> {
  if (isVirtualPath(path)) {
    return cropVirtualImage(path, x, y, width, height).then((result) => ({ path: result.path, acceleration: result.acceleration || "cpu-canvas" }));
  }
  if (supportsDesktopNativeGPUTransforms()) {
    return invokeService<ImageTransformResultLike>(unsupportedMessage, "CropImage", path, x, y, width, height);
  }
  return runPersistedVirtualTransform(path, (virtualPath) => cropVirtualImage(virtualPath, x, y, width, height));
}

export function ReadImageAsBase64(path: string): Promise<string> {
  if (isVirtualPath(path)) {
    return Promise.resolve(readVirtualImageAsBase64(path));
  }
  if (!hasServiceMethod("ReadImageAsBase64") && !canInvokeAndroidMethod("ReadImageAsBase64")) {
    return readProjectImage(path).then((imageB64) => {
      if (imageB64) return imageB64;
      throw new Error(unsupportedMessage("ReadImageAsBase64"));
    });
  }
  if (canInvokeAndroidMethod("ReadImageAsBase64")) {
    return invokeAndroid<string>(unsupportedMessage, "ReadImageAsBase64", path);
  }
  return invokeService<string>(unsupportedMessage, "ReadImageAsBase64", path);
}

export function ExportHistoryToFile(jsonContent: string): Promise<string> {
  if (hasServiceMethod("ExportHistoryToFile")) {
    return invokeService<string>(unsupportedMessage, "ExportHistoryToFile", jsonContent);
  }
  return Promise.resolve(saveByDownload(new Blob([jsonContent], { type: "application/json" }), `fhl-studio-history-${Date.now()}.json`));
}

export function ImportHistoryFromFile(): Promise<string> {
  if (hasServiceMethod("ImportHistoryFromFile")) {
    return invokeService<string>(unsupportedMessage, "ImportHistoryFromFile");
  }
  if (canInvokeAndroidMethod("ImportHistoryFromFile")) {
    return invokeAndroid<string>(unsupportedMessage, "ImportHistoryFromFile");
  }
  return importHistoryFallback();
}

export function SetOutputDir(path: string): Promise<void> {
  if (hasServiceMethod("SetOutputDir")) {
    return invokeService<void>(unsupportedMessage, "SetOutputDir", path);
  }
  if (canInvokeAndroidMethod("SetOutputDir")) {
    return invokeAndroid<void>(unsupportedMessage, "SetOutputDir", path);
  }
  return Promise.resolve();
}

export function ChooseOutputDir(): Promise<string> {
  if (hasServiceMethod("ChooseOutputDir")) {
    return invokeService<string>(unsupportedMessage, "ChooseOutputDir");
  }
  if (canInvokeAndroidMethod("ChooseOutputDir")) {
    return invokeAndroid<string>(unsupportedMessage, "ChooseOutputDir");
  }
  return chooseProjectDirectory("选择输出目录").then((chosen) => {
    if (chosen !== null) return chosen;
    return GetOutputDir();
  });
}

export function ChooseBatchOutputDir(): Promise<string> {
  if (hasServiceMethod("ChooseBatchOutputDir")) {
    return invokeService<string>(unsupportedMessage, "ChooseBatchOutputDir");
  }
  if (canInvokeAndroidMethod("ChooseDirectory")) {
    return invokeAndroid<string>(unsupportedMessage, "ChooseDirectory", "选择批处理输出目录");
  }
  if (canInvokeAndroidMethod("ChooseOutputDir")) {
    return invokeAndroid<string>(unsupportedMessage, "ChooseOutputDir");
  }
  return chooseProjectDirectory("选择批处理输出目录").then((chosen) => {
    if (chosen !== null) return chosen;
    throw new Error(unsupportedMessage("ChooseBatchOutputDir"));
  });
}

export function OpenOutputDir(): Promise<void> {
  if (hasServiceMethod("OpenOutputDir")) {
    return invokeService<void>(unsupportedMessage, "OpenOutputDir");
  }
  if (canInvokeAndroidMethod("OpenOutputDir")) {
    return invokeAndroid<void>(unsupportedMessage, "OpenOutputDir");
  }
  return Promise.reject(new Error(unsupportedMessage("OpenOutputDir")));
}

export function OpenMaterialSyncDir(path: string): Promise<void> {
  if (hasServiceMethod("OpenMaterialSyncDir")) {
    return invokeService<void>(unsupportedMessage, "OpenMaterialSyncDir", path);
  }
  return openProjectMaterialSyncDir(path).then((opened) => {
    if (opened) return;
    return OpenOutputDir();
  });
}

export function BuildBatchOutputPath(sourcePath: string, outputDir: string, prefix: string): Promise<string> {
  if (hasServiceMethod("BuildBatchOutputPath")) {
    return invokeService<string>(unsupportedMessage, "BuildBatchOutputPath", sourcePath, outputDir, prefix);
  }
  return buildProjectBatchOutputPath(sourcePath, outputDir, prefix).then((result) => {
    if (result) return result;
    throw new Error(unsupportedMessage("BuildBatchOutputPath"));
  });
}

export function OpenExternalURL(url: string): Promise<void> {
  if (canInvokeAndroidMethod("OpenExternalURL")) {
    return invokeAndroid<void>(unsupportedMessage, "OpenExternalURL", url).catch((error) => {
      if (targetPlatform === "android" || targetPlatform === "android-pad") {
        return Promise.reject(error);
      }
      const opened = typeof window !== "undefined" ? window.open(url, "_blank", "noopener,noreferrer") : null;
      if (!opened && typeof window !== "undefined") window.location.href = url;
    });
  }
  if (!hasServiceMethod("OpenExternalURL")) {
    if (targetPlatform === "android" || targetPlatform === "android-pad") {
      return Promise.reject(new Error(unsupportedMessage("OpenExternalURL")));
    }
    if (typeof window !== "undefined") {
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) window.location.href = url;
      return Promise.resolve();
    }
    return Promise.reject(new Error(unsupportedMessage("OpenExternalURL")));
  }
  return invokeService<void>(unsupportedMessage, "OpenExternalURL", url);
}

export function OpenFile(path: string): Promise<void> {
  if (isVirtualPath(path)) {
    return openVirtualPath(path);
  }
  if (canInvokeAndroidMethod("OpenFile")) {
    return invokeAndroid<void>(unsupportedMessage, "OpenFile", path);
  }
  return invokeService<void>(unsupportedMessage, "OpenFile", path);
}

export function ReadTextFile(path: string): Promise<string> {
  if (isVirtualPath(path)) {
    return Promise.resolve(readVirtualText(path));
  }
  if (!hasServiceMethod("ReadTextFile") && !canInvokeAndroidMethod("ReadTextFile")) {
    return readProjectText(path).then((text) => {
      if (text !== null) return text;
      throw new Error(unsupportedMessage("ReadTextFile"));
    });
  }
  if (canInvokeAndroidMethod("ReadTextFile")) {
    return invokeAndroid<string>(unsupportedMessage, "ReadTextFile", path);
  }
  return invokeService<string>(unsupportedMessage, "ReadTextFile", path);
}

export async function probeCurrentUpstream(
  baseURL: string,
  apiKey: string,
  proxyMode = "system",
  proxyURL = "",
  apiModeOrSignal: string | AbortSignal = "responses",
  maybeSignal?: AbortSignal,
): Promise<void> {
  const apiMode = typeof apiModeOrSignal === "string" ? apiModeOrSignal : "responses";
  const signal = typeof apiModeOrSignal === "string" ? maybeSignal : apiModeOrSignal;
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (apiMode === "apimart") {
    await probeAPIMartFromBrowser(baseURL, apiKey, signal);
    return;
  }
  if (apiMode === "runninghub") {
    await probeRunningHubFromBrowser(baseURL, signal);
    return;
  }
  const options: ProbeUpstreamOptionsLike = { baseURL, apiKey, proxyMode, proxyURL };
  if (hasServiceMethod("ProbeUpstream")) {
    await invokeService<ProbeUpstreamResultLike>(unsupportedMessage, "ProbeUpstream", options);
    return;
  }
  if (canInvokeAndroidMethod("ProbeUpstream")) {
    await invokeAndroid<ProbeUpstreamResultLike>(unsupportedMessage, "ProbeUpstream", options);
    return;
  }
  if (detectHostKind() === "browser") {
    await probeUpstreamFromBrowser(baseURL, apiKey, signal);
    return;
  }
  throw new Error(unsupportedMessage("ProbeUpstream"));
}

export function registerEphemeralLog(text: string, suggestedName = "raw-response.txt"): string {
  return registerVirtualText(text, suggestedName);
}
