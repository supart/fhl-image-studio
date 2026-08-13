import { targetPlatform } from "../index.ts";
import {
  RemoteKernelError,
  runRemoteImageJob,
  optimizePromptRemote,
  reversePromptRemote,
  queryAPIMartTaskRemote,
} from "./remoteKernel.ts";
import {
  normalizeBaseURL as normalizeSharedBaseURL,
  normalizeRequestPolicy,
} from "../../../../../shared/kernel/requestModel.js";
import { validateAPIKeyForHeader } from "../../lib/apiKey.ts";
import { getImageDimensionsFromBase64 } from "../../lib/images.ts";
import { readBlobAsText, runtimeID, secureRuntimeID } from "../../lib/runtimeCompat.ts";
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
import { readProjectImage, saveProjectImage } from "./localProjectFiles.ts";
import {
  clearLocalEvents,
  emitLocalEvent,
  getForcedKernelRuntimeMode,
  onLocalEvent,
  setForcedKernelRuntimeMode,
} from "./hostEvents.ts";
import {
  canInvokeAndroidMethod,
  getRuntime,
  hasServiceMethod,
  invokeAndroid,
  invokeService,
} from "./hostBindings.ts";
import type {
  GenerateOptionsLike,
  APIMartTaskQueryOptionsLike,
  APIMartTaskQueryResultLike,
  HostCapabilities,
  HostKind,
  ImageTransformResultLike,
  ImportedImageLike,
  JobStartedLike,
  KernelRuntimeMode,
  MediaAssetRefLike,
  ProbeUpstreamOptionsLike,
  ProbeUpstreamResultLike,
  PromptOptimizeOptionsLike,
  PromptReverseOptionsLike,
  SelectFileResponseLike,
} from "./hostTypes.ts";

const remoteJobControllers = new Map<string, AbortController>();
const FHL_BASE_URL = "https://www.fhl.mom";
const FHL_LOCAL_PROXY_PREFIX = "/__image-studio-fhl";
const APIMART_API_MODE = "apimart";
const ANDROID_APP_ASSETS_HOST = "appassets.androidplatform.net";
const ANDROID_JOB_BRIDGE_UNAVAILABLE_MESSAGE = "Android 后台 Bridge 不可用，请重启 App";
const ANDROID_CREDENTIAL_BRIDGE_UNAVAILABLE_MESSAGE = "Android 凭据 Bridge 不可用，请重启 App";

function normalizeHostAPIMode(apiMode: string): "responses" | "images" | "apimart" | "runninghub" {
  const normalized = String(apiMode || "").trim().toLowerCase();
  if (normalized === "runninghub") return "runninghub";
  if (normalized === "apimart") return "apimart";
  if (normalized === "images") return "images";
  return "responses";
}

function extractAPIMartTaskIdFromText(text: string): string {
  return String(text || "").match(/\btask_[A-Za-z0-9_-]+\b/)?.[0] ?? "";
}

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

function isPackagedAndroidApp(): boolean {
  if (targetPlatform !== "android" && targetPlatform !== "android-pad") return false;
  if (typeof window === "undefined" || typeof window.location === "undefined") return false;
  return String(window.location.hostname || "").toLowerCase() === ANDROID_APP_ASSETS_HOST;
}

function missingPackagedAndroidJobBridgeError(): Error | null {
  return isPackagedAndroidApp() && !canUseAndroidJobs()
    ? new Error(ANDROID_JOB_BRIDGE_UNAVAILABLE_MESSAGE)
    : null;
}

function normalizeProbeBaseURL(raw: string): string {
  const normalized = normalizeSharedBaseURL(raw);
  if (isLocalPreviewHost() && normalized === FHL_BASE_URL) {
    return `${window.location.origin}${FHL_LOCAL_PROXY_PREFIX}`;
  }
  return normalized;
}

function summarizeProbeBody(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260);
}

async function probeUpstreamFromBrowser(
  baseURL: string,
  apiKey: string,
  apiMode = "responses",
  signal?: AbortSignal,
): Promise<void> {
  const normalizedBaseURL = normalizeProbeBaseURL(baseURL);
  const headerAPIKey = validateAPIKeyForHeader(apiKey);
  if (!normalizedBaseURL) throw new Error("BASE_URL 不能为空");
  if (apiMode === APIMART_API_MODE) {
    const response = await fetch(`${normalizedBaseURL}/v1/balance`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${headerAPIKey}`,
        Accept: "application/json",
      },
      signal,
    });
    const raw = await response.text();
    let parsed: any = null;
    if (raw.trim()) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error("APIMart /v1/balance 返回的 JSON 无效");
      }
    }
    if (!response.ok) {
      const summary = summarizeProbeBody(raw);
      if (response.status === 401 || response.status === 403) {
        throw new Error(summary ? `APIMart API Key 无效或未授权: ${summary}` : "APIMart API Key 无效或未授权");
      }
      throw new Error(summary ? `APIMart /v1/balance 返回 ${response.status}: ${summary}` : `APIMart /v1/balance 返回 ${response.status}`);
    }
    if (parsed?.success === false) {
      const message = String(parsed?.message || parsed?.error || "").trim();
      throw new Error(message ? `APIMart 配置不可用: ${message}` : "APIMart 配置不可用");
    }
    return;
  }
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

function makeRuntimeID(prefix: "job" | "submission"): string {
  return runtimeID(prefix);
}

function makeJobID(): string {
  return makeRuntimeID("job");
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

async function persistBrowserSelectedImage(res: SelectFileResponseLike): Promise<SelectFileResponseLike> {
  const selectedPath = String(res?.path || "").trim();
  const imageB64 = String(res?.imageB64 || "").trim();
  if (!selectedPath || !imageB64 || !isLocalPreviewHost() || !isVirtualPath(selectedPath)) return res;
  const saved = await saveProjectImage("input", imageB64, fileNameFromPath(selectedPath));
  if (!saved?.path) return res;
  return {
    ...res,
    path: saved.path,
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
        resolve(await readBlobAsText(file));
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
      const result = await runRemoteImageJob({ payload: {
        ...options,
        requestPolicy: normalizeRequestPolicy(options.requestPolicy),
      }, sourceImages: options.sourceImages }, {
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
        onAPIMartTaskSubmitted: (task) => emitLocalEvent(`apimart-task:${jobId}`, {
          taskId: task.taskId,
          status: task.status || "submitted",
          rawPath: task.rawPath || null,
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
      const dimensions = getImageDimensionsFromBase64(result.imageB64);
      emitLocalEvent(`result:${jobId}`, {
        imageB64: result.imageB64,
        revisedPrompt: result.revisedPrompt,
        sourceEvent: result.sourceEvent,
        savedPath: nativeSavedPath || projectSaved?.path || saved.path,
        rawPath: result.rawPath,
        mode: result.mode,
        prompt: result.prompt,
        width: dimensions?.w,
        height: dimensions?.h,
        apimartTaskId: result.apimartTaskId,
        apimartTaskStatus: result.apimartTaskStatus,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      const typed = error instanceof RemoteKernelError
        ? error
        : new RemoteKernelError(String((error as any)?.message || error));
      emitLocalEvent(`error:${jobId}`, {
        message: typed.message,
        rawPath: typed.rawPath || null,
        apimartTaskId: typed.apimartTaskId || extractAPIMartTaskIdFromText(typed.message),
        apimartTaskStatus: typed.apimartTaskStatus || "",
      });
    } finally {
      remoteJobControllers.delete(jobId);
    }
  })();
  return { jobId };
}

export function QueryAPIMartTask(options: APIMartTaskQueryOptionsLike): Promise<APIMartTaskQueryResultLike> {
  const controller = new AbortController();
  return queryAPIMartTaskRemote(options, controller.signal);
}

function withoutRuntimeSourceImages(options: GenerateOptionsLike): GenerateOptionsLike {
  const { sourceImages: _sourceImages, ...payload } = options;
  return payload;
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
  return detectHostKind() === "android-shell" && canUseAndroidJobs();
}

async function submitSingleAndroidJob(options: GenerateOptionsLike): Promise<JobStartedLike> {
  const response = await submitAndroidJobGroup({
    clientSubmissionId: secureRuntimeID("submission", "Android付费生图请求"),
    workspaceId: "default",
    mode: options.mode === "edit" ? "edit" : "generate",
    prompt: options.prompt,
    size: options.size as any,
    quality: options.quality as any,
    outputFormat: options.outputFormat as any,
    batchCount: 1,
    concurrencyLimit: options.concurrencyLimit,
    seed: options.seed || 0,
    negativePrompt: options.negativePrompt || "",
    sourceImagePaths: options.imagePaths?.length ? options.imagePaths : (options.imagePath ? [options.imagePath] : []),
    maskB64: options.maskB64 || "",
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    apiMode: normalizeHostAPIMode(options.apiMode),
    requestRunId: options.requestRunId,
    requestPolicy: normalizeRequestPolicy(options.requestPolicy) as any,
    imagesNewAPICompat: normalizeHostAPIMode(options.apiMode) === "images" && options.imagesNewAPICompat === true,
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
  const bridgeError = missingPackagedAndroidJobBridgeError();
  if (bridgeError) return Promise.reject(bridgeError);
  if (getForcedKernelRuntimeMode() === "local" && detectHostKind() !== "wails-desktop") {
    return Promise.reject(new Error("当前宿主不支持强制本地内核"));
  }
  if (getHostCapabilities().localGeneration) {
    return invokeService<JobStartedLike>(unsupportedMessage, "Generate", withoutRuntimeSourceImages(options));
  }
  if (shouldUseAndroidBackgroundJobs(options)) {
    return submitSingleAndroidJob({ ...options, mode: "generate" });
  }
  return startRemoteJob({ ...options, mode: "generate" });
}

export function Edit(options: GenerateOptionsLike): Promise<JobStartedLike> {
  const bridgeError = missingPackagedAndroidJobBridgeError();
  if (bridgeError) return Promise.reject(bridgeError);
  if (getForcedKernelRuntimeMode() === "local" && detectHostKind() !== "wails-desktop") {
    return Promise.reject(new Error("当前宿主不支持强制本地内核"));
  }
  if (getHostCapabilities().localGeneration) {
    return invokeService<JobStartedLike>(unsupportedMessage, "Edit", withoutRuntimeSourceImages(options));
  }
  if (shouldUseAndroidBackgroundJobs(options)) {
    return submitSingleAndroidJob({ ...options, mode: "edit" });
  }
  return startRemoteJob({ ...options, mode: "edit" });
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

export function GetOutputDir(): Promise<string> {
  if (hasServiceMethod("GetOutputDir")) {
    return invokeService<string>(unsupportedMessage, "GetOutputDir");
  }
  if (canInvokeAndroidMethod("GetOutputDir")) {
    return invokeAndroid<string>(unsupportedMessage, "GetOutputDir");
  }
  return Promise.resolve("");
}

export function DeleteStoredAPIKey(user: string): Promise<void> {
  if (hasServiceMethod("DeleteStoredAPIKey")) {
    return invokeService<void>(unsupportedMessage, "DeleteStoredAPIKey", user);
  }
  if (canInvokeAndroidMethod("DeleteStoredAPIKey")) {
    return invokeAndroid<void>(unsupportedMessage, "DeleteStoredAPIKey", user);
  }
  if (isPackagedAndroidApp()) {
    return Promise.reject(new Error(ANDROID_CREDENTIAL_BRIDGE_UNAVAILABLE_MESSAGE));
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
  if (isPackagedAndroidApp()) {
    return Promise.reject(new Error(ANDROID_CREDENTIAL_BRIDGE_UNAVAILABLE_MESSAGE));
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
  if (isPackagedAndroidApp()) {
    return Promise.reject(new Error(ANDROID_CREDENTIAL_BRIDGE_UNAVAILABLE_MESSAGE));
  }
  setBrowserStoredAPIKey(user, value);
  return Promise.resolve();
}

export function ReadClipboardText(): Promise<string> {
  if (canInvokeAndroidMethod("ReadClipboardText")) {
    return invokeAndroid<string>(unsupportedMessage, "ReadClipboardText");
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
    return navigator.clipboard.readText();
  }
  return Promise.reject(new Error(unsupportedMessage("ReadClipboardText")));
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
  return saveProjectImage("output", imageB64, suggestedName, mimeType).then((projectSaved) => {
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
  if (canInvokeAndroidMethod("RegisterMediaAsset")) {
    return invokeAndroid<MediaAssetRefLike>(unsupportedMessage, "RegisterMediaAsset", savedPath, thumbPath);
  }
  return Promise.resolve({ savedPath, thumbPath });
}

export function RegisterImportedImageAsset(path: string): Promise<MediaAssetRefLike> {
  if (hasServiceMethod("RegisterImportedImageAsset")) {
    return invokeService<MediaAssetRefLike>(unsupportedMessage, "RegisterImportedImageAsset", path);
  }
  if (canInvokeAndroidMethod("RegisterImportedImageAsset")) {
    return invokeAndroid<MediaAssetRefLike>(unsupportedMessage, "RegisterImportedImageAsset", path);
  }
  return Promise.resolve({ savedPath: path });
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

export function RegisterTrustedOutputDir(root: string): Promise<void> {
  if (hasServiceMethod("RegisterTrustedOutputDir")) {
    return invokeService<void>(unsupportedMessage, "RegisterTrustedOutputDir", root);
  }
  return Promise.resolve();
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
  return GetOutputDir();
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
  apiMode = "responses",
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const options: ProbeUpstreamOptionsLike = { baseURL, apiKey, apiMode, proxyMode, proxyURL };
  if (hasServiceMethod("ProbeUpstream")) {
    await invokeService<ProbeUpstreamResultLike>(unsupportedMessage, "ProbeUpstream", options);
    return;
  }
  if (canInvokeAndroidMethod("ProbeUpstream")) {
    await invokeAndroid<ProbeUpstreamResultLike>(unsupportedMessage, "ProbeUpstream", options);
    return;
  }
  if (detectHostKind() === "browser") {
    await probeUpstreamFromBrowser(baseURL, apiKey, apiMode, signal);
    return;
  }
  throw new Error(unsupportedMessage("ProbeUpstream"));
}

export function registerEphemeralLog(text: string, suggestedName = "raw-response.txt"): string {
  return registerVirtualText(text, suggestedName);
}
