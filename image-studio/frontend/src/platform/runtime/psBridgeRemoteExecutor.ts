import { keyringUserFor } from "../../lib/profiles.ts";
import type {
  KernelImageSource,
  RemoteJobCallbacks,
  RemoteJobRequest,
  RemoteJobResult,
} from "./remote-kernel/types.ts";
import type {
  PSBridgeRemoteCompletion,
  PSBridgeRemoteDispatch,
  PSBridgeRemoteFailure,
  PSBridgeRemoteProgress,
} from "./psBridgeContracts.ts";

export type PSBridgeExecutionDependencies = {
  readImage: (path: string) => Promise<string>;
  readCredential: (user: string) => Promise<string>;
  runRemote: (request: RemoteJobRequest, callbacks: RemoteJobCallbacks) => Promise<RemoteJobResult>;
  update: (input: PSBridgeRemoteProgress) => Promise<void>;
  complete: (input: PSBridgeRemoteCompletion) => Promise<void>;
  fail: (input: PSBridgeRemoteFailure) => Promise<void>;
};

function imageNameFromPath(path: string): string {
  return String(path || "").split(/[\\/]/).pop() || "photoshop-input.png";
}

function imageMimeType(path: string): string {
  const lower = String(path || "").toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

function remoteRequestForPSBridge(
  dispatch: PSBridgeRemoteDispatch,
  apiKey: string,
  sourceImages: KernelImageSource[],
): RemoteJobRequest {
  return {
    payload: {
      apiKey,
      apiProfileId: dispatch.profileId,
      mode: dispatch.mode === "edit" ? "edit" : "generate",
      prompt: dispatch.prompt,
      size: dispatch.size || "1024x1024",
      quality: dispatch.quality || "medium",
      outputFormat: dispatch.outputFormat || "png",
      imagePaths: [],
      imagePath: "",
      // These providers currently consume the cropped selection as source 1.
      maskB64: "",
      seed: Number(dispatch.seed) || 0,
      negativePrompt: dispatch.negativePrompt || "",
      baseURL: dispatch.baseURL,
      textModelID: dispatch.textModelID,
      imageModelID: dispatch.imageModelID,
      proxyMode: dispatch.proxyMode,
      proxyURL: dispatch.proxyURL,
      apiMode: dispatch.apiMode,
      requestPolicy: dispatch.requestPolicy === "compat" ? "compat" : "openai",
      imagesNewAPICompat: dispatch.imagesNewAPICompat === true,
      noPromptRevision: true,
      concurrencyLimit: 1,
      partialImages: 0,
    },
    sourceImages,
  };
}

function describePSBridgeError(error: unknown): string {
  const message = String((error as { message?: unknown })?.message || error || "").trim();
  return message || "Photoshop bridge task failed";
}

export async function executePSBridgeRemoteDispatch(
  dispatch: PSBridgeRemoteDispatch,
  signal: AbortSignal,
  dependencies: PSBridgeExecutionDependencies,
): Promise<void> {
  let apiKey = "";
  const sourceImages: KernelImageSource[] = [];
  let rawPath = "";
  try {
    if (dispatch.apiMode !== "apimart" && dispatch.apiMode !== "runninghub") {
      throw new Error(`Unsupported remote Photoshop profile: ${dispatch.apiMode}`);
    }
    if (dispatch.apiMode === "apimart") {
      apiKey = (await dependencies.readCredential(keyringUserFor(dispatch.profileId))).trim();
      if (!apiKey) throw new Error("The active APIMart profile has no stored credential");
    }
    await dependencies.update({
      jobId: dispatch.jobId,
      stage: "Reading Photoshop input",
      elapsed: 0,
      bytes: 0,
    });
    for (const path of dispatch.imagePaths || []) {
      if (signal.aborted) return;
      const imageB64 = (await dependencies.readImage(path)).trim();
      if (!imageB64) throw new Error(`Unable to read Photoshop input: ${imageNameFromPath(path)}`);
      sourceImages.push({
        path,
        name: imageNameFromPath(path),
        mimeType: imageMimeType(path),
        imageB64,
      });
    }
    const result = await dependencies.runRemote(
      remoteRequestForPSBridge(dispatch, apiKey, sourceImages),
      {
        signal,
        onProgress: (stage, elapsed, bytes) => {
          void dependencies.update({ jobId: dispatch.jobId, stage, elapsed, bytes }).catch(() => undefined);
        },
      },
    );
    rawPath = result.rawPath || "";
    if (signal.aborted) return;
    await dependencies.complete({
      jobId: dispatch.jobId,
      imageB64: result.imageB64,
      revisedPrompt: result.revisedPrompt || "",
      sourceEvent: result.sourceEvent || "",
      rawPath,
    });
  } catch (error) {
    if (!signal.aborted) {
      await dependencies.fail({
        jobId: dispatch.jobId,
        message: describePSBridgeError(error),
        rawPath: String((error as { rawPath?: unknown })?.rawPath || rawPath || ""),
      }).catch(() => undefined);
    }
  } finally {
    apiKey = "";
    for (const source of sourceImages) {
      source.imageB64 = null;
      source.imageBlob = null;
    }
    sourceImages.length = 0;
  }
}
