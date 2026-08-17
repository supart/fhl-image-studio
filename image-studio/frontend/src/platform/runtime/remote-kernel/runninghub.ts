import { blobToBase64 } from "../../../lib/images.ts";
import {
  normalizeBaseURL,
  registerRawText,
  resolveSourceDataURLs,
  sleepWithSignal,
} from "./common.ts";
import {
  RemoteKernelError,
  type RemoteJobCallbacks,
  type RemoteJobRequest,
  type RemoteJobResult,
} from "./types.ts";

const RUNNINGHUB_POLL_INTERVAL_MS = 2_500;
const RUNNINGHUB_MAX_WAIT_MS = 900_000;
const RUNNINGHUB_IMAGE_TO_IMAGE_ASPECTS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "9:21"] as const;
const RUNNINGHUB_TEXT_TO_IMAGE_ASPECTS = [
  "1:1",
  "3:2",
  "2:3",
  "5:4",
  "4:5",
  "16:9",
  "9:16",
  "21:9",
  "3:4",
  "4:3",
  "9:21",
  "2:1",
  "1:2",
  "3:1",
  "1:3",
] as const;

const SIZE_TO_ASPECT: Record<string, string> = {
  "1024x1024": "1:1",
  "1536x1024": "3:2",
  "1024x1536": "2:3",
  "1536x1152": "4:3",
  "1152x1536": "3:4",
  "1520x1216": "5:4",
  "1216x1520": "4:5",
  "1536x864": "16:9",
  "864x1536": "9:16",
  "1536x768": "2:1",
  "768x1536": "1:2",
  "1536x512": "3:1",
  "512x1536": "1:3",
  "2048x2048": "1:1",
  "2048x1360": "3:2",
  "1360x2048": "2:3",
  "2048x1536": "4:3",
  "1536x2048": "3:4",
  "2040x1632": "5:4",
  "1632x2040": "4:5",
  "2048x1152": "16:9",
  "1152x2048": "9:16",
  "2048x1024": "2:1",
  "1024x2048": "1:2",
  "2040x680": "3:1",
  "680x2040": "1:3",
  "3840x2160": "16:9",
  "2160x3840": "9:16",
  "3840x1920": "2:1",
  "1920x3840": "1:2",
  "3840x1280": "3:1",
  "1280x3840": "1:3",
};

const SIZE_TO_RESOLUTION: Record<string, "1k" | "2k" | "4k"> = {
  "1024x1024": "1k",
  "1536x1024": "1k",
  "1024x1536": "1k",
  "1536x1152": "1k",
  "1152x1536": "1k",
  "1520x1216": "1k",
  "1216x1520": "1k",
  "1536x864": "1k",
  "864x1536": "1k",
  "1536x768": "1k",
  "768x1536": "1k",
  "1536x512": "1k",
  "512x1536": "1k",
  "2048x2048": "2k",
  "2048x1360": "2k",
  "1360x2048": "2k",
  "2048x1536": "2k",
  "1536x2048": "2k",
  "2040x1632": "2k",
  "1632x2040": "2k",
  "2048x1152": "2k",
  "1152x2048": "2k",
  "2048x1024": "2k",
  "1024x2048": "2k",
  "2040x680": "2k",
  "680x2040": "2k",
  "3840x2160": "4k",
  "2160x3840": "4k",
  "3840x1920": "4k",
  "1920x3840": "4k",
  "3840x1280": "4k",
  "1280x3840": "4k",
};

type RunningHubTaskImage = {
  url?: string;
  dataUrl?: string;
  mimeType?: string;
};

type RunningHubTask = {
  id?: string;
  status?: string;
  error?: string | null;
  prompt?: string;
  images?: RunningHubTaskImage[];
  raw?: unknown;
};

export function runningHubEndpoint(baseURL: string, path: string): string {
  return `${normalizeBaseURL(baseURL)}${path.startsWith("/") ? path : `/${path}`}`;
}

function runningHubMode(mode: string): "text-to-image" | "image-to-image" {
  return String(mode || "").trim() === "edit" || String(mode || "").trim() === "image-to-image"
    ? "image-to-image"
    : "text-to-image";
}

function normalizeModelKey(model: string): "banana2" | "image_g2" {
  const value = String(model || "").trim().toLowerCase();
  return value.includes("g2") ? "image_g2" : "banana2";
}

function supportedAspects(mode: "text-to-image" | "image-to-image"): readonly string[] {
  return mode === "image-to-image" ? RUNNINGHUB_IMAGE_TO_IMAGE_ASPECTS : RUNNINGHUB_TEXT_TO_IMAGE_ASPECTS;
}

function nearestAspect(size: string, mode: "text-to-image" | "image-to-image"): string {
  const match = String(size || "").trim().toLowerCase().match(/^(\d+)x(\d+)$/);
  if (!match) return supportedAspects(mode)[0] || "1:1";
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return supportedAspects(mode)[0] || "1:1";
  }
  const ratio = width / height;
  let best = supportedAspects(mode)[0] || "1:1";
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const aspect of supportedAspects(mode)) {
    const [w, h] = aspect.split(":").map(Number);
    const diff = Math.abs(Math.log(ratio) - Math.log(w / h));
    if (diff < bestDiff) {
      best = aspect;
      bestDiff = diff;
    }
  }
  return best;
}

function parseRunningHubSize(size: string, mode: "text-to-image" | "image-to-image"): { aspect: string; resolution: "1k" | "2k" | "4k" } {
  const normalized = String(size || "").trim().toLowerCase();
  const aspectMatch = normalized.match(/^(\d+:\d+)(?:@(1k|2k|4k))?$/);
  if (aspectMatch) {
    const aspect = aspectMatch[1];
    const supported = new Set(supportedAspects(mode));
    return {
      aspect: supported.has(aspect) ? aspect : nearestAspect("1024x1024", mode),
      resolution: (aspectMatch[2] as "1k" | "2k" | "4k" | undefined) || "1k",
    };
  }
  const pixelMatch = normalized.match(/^(\d+)x(\d+)$/);
  const maxSide = pixelMatch ? Math.max(Number(pixelMatch[1]), Number(pixelMatch[2])) : 0;
  const derivedResolution = maxSide > 2048 ? "4k" : maxSide > 1536 ? "2k" : "1k";
  return {
    aspect: SIZE_TO_ASPECT[normalized] || nearestAspect(normalized, mode),
    resolution: SIZE_TO_RESOLUTION[normalized] || derivedResolution,
  };
}

export type RunningHubSubmitPayload = {
  model: "banana2" | "image_g2";
  mode: "text-to-image" | "image-to-image";
  prompt: string;
  aspect_ratio: string;
  resolution: "1k" | "2k" | "4k";
  image_urls?: string[];
};

export function buildRunningHubSubmitPayload(
  payload: RemoteJobRequest["payload"],
  imageURLs: string[],
): RunningHubSubmitPayload {
  const mode = runningHubMode(payload.mode);
  const { aspect, resolution } = parseRunningHubSize(payload.size, mode);
  return {
    model: normalizeModelKey(payload.imageModelID),
    mode,
    prompt: payload.prompt,
    aspect_ratio: aspect,
    resolution,
    ...(mode === "image-to-image" ? { image_urls: imageURLs } : {}),
  };
}

function dataURLToBlob(dataURL: string): Blob {
  const match = dataURL.match(/^data:(image\/[^;]+);base64,(.+)$/i);
  if (!match) throw new RemoteKernelError("RunningHub 图生图上传失败：源图不是有效 data URL");
  const mimeType = match[1];
  const payload = match[2];
  return new Blob([Uint8Array.from(atob(payload), (ch) => ch.charCodeAt(0))], { type: mimeType });
}

async function readJSON<T>(response: Response, attempt: number): Promise<{ parsed: T; rawPath: string | null }> {
  const raw = await response.text();
  const rawPath = registerRawText("runninghub", attempt, raw);
  let parsed: any;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    throw new RemoteKernelError(
      raw.trim() ? `RunningHub bridge returned invalid JSON: ${raw.trim().slice(0, 260)}` : "RunningHub bridge returned invalid JSON",
      rawPath,
    );
  }
  if (!response.ok || parsed?.ok === false) {
    throw new RemoteKernelError(String(parsed?.message || `RunningHub bridge HTTP ${response.status}`).trim(), rawPath);
  }
  return { parsed, rawPath };
}

async function uploadSourceImage(
  baseURL: string,
  dataURL: string,
  index: number,
  attempt: number,
  callbacks: RemoteJobCallbacks,
): Promise<string> {
  const form = new FormData();
  form.set("image", new File([dataURLToBlob(dataURL)], `runninghub-source-${index + 1}.png`, { type: "image/png" }));
  callbacks.onLog?.(`RunningHub 上传参考图 ${index + 1}...`);
  const response = await fetch(runningHubEndpoint(baseURL, "/api/upload"), {
    method: "POST",
    body: form,
    signal: callbacks.signal,
  });
  const { parsed } = await readJSON<{ upload?: { imageUrl?: string } }>(response, attempt);
  const imageURL = String(parsed?.upload?.imageUrl || "").trim();
  if (!imageURL) throw new RemoteKernelError("RunningHub 上传成功，但没有返回 imageUrl");
  return imageURL;
}

async function fetchProxiedResultImage(
  baseURL: string,
  image: RunningHubTaskImage,
  signal: AbortSignal,
): Promise<string> {
  const dataURL = String(image?.dataUrl || "").trim();
  if (dataURL.startsWith("data:image/")) {
    const comma = dataURL.indexOf(",");
    if (comma >= 0) return dataURL.slice(comma + 1).replace(/\s+/g, "");
  }
  const url = String(image?.url || "").trim();
  if (!url) throw new RemoteKernelError("RunningHub 成功返回，但没有可用图片地址");
  const response = await fetch(`${runningHubEndpoint(baseURL, "/api/image")}?url=${encodeURIComponent(url)}`, {
    method: "GET",
    signal,
  });
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new RemoteKernelError(raw.trim() || `RunningHub 图片代理失败 (${response.status})`);
  }
  return await blobToBase64(await response.blob());
}

function extractTask(parsed: any): RunningHubTask {
  return (parsed?.task || parsed) as RunningHubTask;
}

export async function requestRunningHubOnce(
  request: RemoteJobRequest,
  attempt: number,
  callbacks: RemoteJobCallbacks,
): Promise<RemoteJobResult> {
  const payload = request.payload;
  const baseURL = normalizeBaseURL(payload.baseURL);
  const mode = runningHubMode(payload.mode);
  const sourceDataURLs = mode === "image-to-image" ? await resolveSourceDataURLs(request.sourceImages, payload) : [];

  if (mode === "image-to-image" && sourceDataURLs.length === 0) {
    throw new RemoteKernelError("RunningHub 图生图需要至少一张源图");
  }

  const imageURLs: string[] = [];
  for (let index = 0; index < sourceDataURLs.length; index += 1) {
    imageURLs.push(await uploadSourceImage(baseURL, sourceDataURLs[index], index, attempt, callbacks));
  }

  const submitPayload = buildRunningHubSubmitPayload(payload, imageURLs);

  callbacks.onLog?.(`RunningHub 提交 ${mode} 任务：${submitPayload.model} ${submitPayload.aspect_ratio} ${submitPayload.resolution}`);
  const submitResponse = await fetch(runningHubEndpoint(baseURL, "/api/generate"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(submitPayload),
    signal: callbacks.signal,
  });
  const submitJSON = await readJSON<{ task?: RunningHubTask }>(submitResponse, attempt);
  let task = extractTask(submitJSON.parsed);
  let rawPath = submitJSON.rawPath;
  const taskId = String(task?.id || "").trim();
  if (!taskId) throw new RemoteKernelError("RunningHub bridge returned no task id", rawPath);

  const startedAt = Date.now();
  while (String(task?.status || "").trim() === "queued" || String(task?.status || "").trim() === "running") {
    if (Date.now() - startedAt > RUNNINGHUB_MAX_WAIT_MS) {
      throw new RemoteKernelError("RunningHub task wait timed out", rawPath);
    }
    await sleepWithSignal(callbacks.signal, RUNNINGHUB_POLL_INTERVAL_MS);
    const taskResponse = await fetch(`${runningHubEndpoint(baseURL, "/api/task")}?id=${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: callbacks.signal,
    });
    const taskJSON = await readJSON<{ task?: RunningHubTask }>(taskResponse, attempt);
    task = extractTask(taskJSON.parsed);
    rawPath = taskJSON.rawPath || rawPath;
    callbacks.onLog?.(`RunningHub 任务状态：${String(task?.status || "unknown")}`);
  }

  const status = String(task?.status || "").trim();
  if (status !== "succeeded") {
    throw new RemoteKernelError(String(task?.error || `RunningHub task failed: ${status || "unknown"}`), rawPath);
  }

  const firstImage = Array.isArray(task.images) ? task.images[0] : null;
  if (!firstImage) throw new RemoteKernelError("RunningHub 成功返回，但没有图片结果", rawPath);
  const imageB64 = await fetchProxiedResultImage(baseURL, firstImage, callbacks.signal);

  return {
    imageB64,
    revisedPrompt: "",
    sourceEvent: "runninghub_async",
    rawPath,
    prompt: payload.prompt,
    mode: payload.mode,
  };
}
