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

const listeners = new Map<string, Set<(event: BrowserJobEvent) => void>>();
let hooksInstalled = false;
let previousHook: ((event: BrowserJobEvent) => void) | undefined;

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
  const refreshEvents = () => {
    void attachAndroidJobEvents().catch(() => undefined);
  };
  window.addEventListener("focus", refreshEvents);
  window.addEventListener("pageshow", refreshEvents);
  window.addEventListener("image-studio:android-jobs-resume", refreshEvents);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshEvents();
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

export async function attachAndroidJobEvents(): Promise<void> {
  ensureAndroidJobEventHook();
  await invokeAndroidNative("AttachAndroidJobEvents");
}

export function subscribeToAndroidJob(
  jobId: string,
  onEvent: (event: BrowserJobEvent) => void,
  onError?: (error: Error) => void,
) {
  const bucket = listeners.get(jobId) ?? new Set<(event: BrowserJobEvent) => void>();
  listeners.set(jobId, bucket);
  bucket.add(onEvent);
  try {
    ensureAndroidJobEventHook();
    void attachAndroidJobEvents().catch((error) => {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    });
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
