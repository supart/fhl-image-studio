import {
  RemoteKernelError,
  optimizePromptRemote,
  reversePromptRemote,
  runRemoteImageJob,
} from "./remoteKernel.ts";
import { normalizeRequestPolicy } from "../../../../../shared/kernel/requestModel.js";
import { registerVirtualImage } from "../../lib/virtualHostStore.ts";
import { cancelBrowserJobs } from "./browserJobClient.ts";
import { suggestImageFileName } from "../../lib/imageFileNames.ts";
import {
  canUseAndroidJobs,
  cancelAndroidJobs,
  submitAndroidJobGroup,
} from "./androidJobClient.ts";
import { saveProjectImage } from "./localProjectFiles.ts";
import {
  emitLocalEvent,
  getForcedKernelRuntimeMode,
} from "./hostEvents.ts";
import {
  generationRequestForMode,
  toRemoteGenerationPayload,
  toWailsGenerationRequest,
} from "./generationRequest.ts";
import {
  canInvokeAndroidMethod,
  hasServiceMethod,
  invokeAndroid,
  invokeService,
} from "./hostBindings.ts";
import {
  detectHostKind,
  getHostCapabilities,
  unsupportedMessage,
} from "./hostContext.ts";
import { SaveImageAs } from "./hostMedia.ts";
import type {
  GenerateOptionsLike,
  JobStartedLike,
  PromptOptimizeOptionsLike,
  PromptReverseOptionsLike,
} from "./hostTypes.ts";

const remoteJobControllers = new Map<string, AbortController>();

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
