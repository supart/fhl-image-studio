import { hasAndroidInvokeBridge, invokeAndroidNative } from "../android/nativeInvoke.ts";
import type {
  BrowserJobCancelPayload,
  BrowserJobCancelResponse,
  BrowserJobEvent,
  BrowserJobListResponse,
  BrowserJobSubmitPayload,
  BrowserJobSubmitResponse,
} from "./browserJobContracts.ts";

type AndroidJobWindow = Window & {
  __imageStudioAndroidJobEvent?: (event: BrowserJobEvent) => void;
};

export type AndroidJobForegroundResumeHandler = () => void | Promise<void>;

const listeners = new Map<string, Set<(event: BrowserJobEvent) => void>>();
const foregroundResumeHandlers = new Set<AndroidJobForegroundResumeHandler>();
let hooksInstalled = false;
let previousHook: ((event: BrowserJobEvent) => void) | undefined;
let foregroundResumeNotificationQueued = false;

function dispatchForegroundResumeHandlers() {
  for (const handler of Array.from(foregroundResumeHandlers)) {
    try {
      void Promise.resolve(handler()).catch(() => undefined);
    } catch {
      // A failed consumer must not prevent the remaining resume handlers.
    }
  }
}

function notifyForegroundResumeHandlers() {
  if (foregroundResumeNotificationQueued) return;
  foregroundResumeNotificationQueued = true;
  void Promise.resolve().then(() => {
    foregroundResumeNotificationQueued = false;
    dispatchForegroundResumeHandlers();
  });
}

function ensureAndroidJobEventHook() {
  if (typeof window === "undefined" || hooksInstalled) return;
  const browserWindow = window as AndroidJobWindow;
  previousHook = browserWindow.__imageStudioAndroidJobEvent;
  browserWindow.__imageStudioAndroidJobEvent = (event) => {
    const jobId = event?.slot?.jobId;
    if (jobId) {
      const bucket = listeners.get(jobId);
      if (bucket) {
        for (const callback of Array.from(bucket)) {
          try {
            callback(event);
          } catch {
            // Ignore listener failures in bridge fanout.
          }
        }
      }
    }
    previousHook?.(event);
  };
  window.addEventListener("focus", notifyForegroundResumeHandlers);
  window.addEventListener("pageshow", notifyForegroundResumeHandlers);
  window.addEventListener("image-studio:android-jobs-resume", notifyForegroundResumeHandlers);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") notifyForegroundResumeHandlers();
  });
  hooksInstalled = true;
}

export function canUseAndroidJobs(): boolean {
  return hasAndroidInvokeBridge();
}

export async function submitAndroidJobGroup(payload: BrowserJobSubmitPayload): Promise<BrowserJobSubmitResponse> {
  ensureAndroidJobEventHook();
  return invokeAndroidNative<BrowserJobSubmitResponse>("SubmitAndroidJobs", payload);
}

export async function listAndroidJobGroups(workspaceId: string, limit = 700): Promise<BrowserJobListResponse> {
  ensureAndroidJobEventHook();
  return invokeAndroidNative<BrowserJobListResponse>("ListAndroidJobs", workspaceId, limit);
}

export async function cancelAndroidJobs(jobIds: string[]): Promise<BrowserJobCancelResponse> {
  ensureAndroidJobEventHook();
  const payload: BrowserJobCancelPayload = { jobIds };
  return invokeAndroidNative<BrowserJobCancelResponse>("CancelAndroidJobs", payload.jobIds);
}

export async function attachAndroidJobEvents(jobIds: string[] = []): Promise<void> {
  ensureAndroidJobEventHook();
  const requestedJobIds = [...new Set(jobIds.map((jobId) => jobId.trim()).filter(Boolean))];
  await invokeAndroidNative("AttachAndroidJobEvents", requestedJobIds);
}

export function registerAndroidJobForegroundResumeHandler(
  handler: AndroidJobForegroundResumeHandler,
) {
  ensureAndroidJobEventHook();
  foregroundResumeHandlers.add(handler);
  return () => {
    foregroundResumeHandlers.delete(handler);
  };
}

export function subscribeToAndroidJob(
  jobId: string,
  onEvent: (event: BrowserJobEvent) => void,
  onError?: (error: Error) => void,
  options: { replayOnSubscribe?: boolean } = {},
) {
  const bucket = listeners.get(jobId) ?? new Set<(event: BrowserJobEvent) => void>();
  listeners.set(jobId, bucket);
  bucket.add(onEvent);
  try {
    ensureAndroidJobEventHook();
    if (options.replayOnSubscribe !== false) {
      void attachAndroidJobEvents([jobId]).catch((error) => {
        onError?.(error instanceof Error ? error : new Error(String(error)));
      });
    }
  } catch (error) {
    onError?.(error instanceof Error ? error : new Error(String(error)));
  }
  return () => {
    const existing = listeners.get(jobId);
    if (!existing) return;
    existing.delete(onEvent);
    if (existing.size === 0) listeners.delete(jobId);
  };
}
