import { persistHistoryItem } from "../../lib/storage.ts";
import { useStudioStore } from "../../state/studioStore.ts";
import { trimHistory } from "../../state/studioStore.shared.ts";
import type { HistoryItem } from "../../types/domain.ts";
import {
  EventsOn,
  GetStoredAPIKey,
  ReadImageAsBase64,
} from "./host.ts";
import { hasServiceMethod, invokeService } from "./hostBindings.ts";
import { runRemoteImageJob } from "./remoteKernel.ts";
import {
  executePSBridgeRemoteDispatch,
  type PSBridgeExecutionDependencies,
} from "./psBridgeRemoteExecutor.ts";
import {
  buildPSBridgeProfileInput,
  historyItemFromPSBridgeEvent,
  psBridgeProfileSignature,
  type PSBridgeHistoryEvent,
  type PSBridgeProfileInput,
  type PSBridgeRemoteDispatch,
  type PSBridgeStatus,
} from "./psBridgeContracts.ts";

const PS_BRIDGE_REMOTE_JOB_EVENT = "ps-bridge:remote-job";
const PS_BRIDGE_REMOTE_CANCEL_EVENT = "ps-bridge:remote-cancel";
const PS_BRIDGE_HISTORY_EVENT = "ps-bridge:history";
const PS_BRIDGE_INSTALL_RETRIES = 20;
const PS_BRIDGE_INSTALL_RETRY_MS = 250;

const remoteControllers = new Map<string, AbortController>();
let installed = false;
let profileSyncRunning = false;
let desiredProfileSync: { signature: string; input: PSBridgeProfileInput | null } | null = null;
let appliedProfileSignature = "";
let profileWasSynced = false;

function bridgeUnavailableMessage(method: string): string {
  return `FHL Studio did not expose ${method}`;
}

function invokePSBridge<T>(method: string, ...args: unknown[]): Promise<T> {
  return invokeService<T>(bridgeUnavailableMessage, method, ...args);
}

const defaultExecutionDependencies: PSBridgeExecutionDependencies = {
  readImage: ReadImageAsBase64,
  readCredential: GetStoredAPIKey,
  runRemote: runRemoteImageJob,
  update: (input) => invokePSBridge<void>("UpdatePSBridgeRemoteJob", input),
  complete: (input) => invokePSBridge<void>("CompletePSBridgeRemoteJob", input),
  fail: (input) => invokePSBridge<void>("FailPSBridgeRemoteJob", input),
};

async function persistPSBridgeHistory(event: PSBridgeHistoryEvent): Promise<void> {
  if (!event?.jobId || !event?.result) return;
  const item = historyItemFromPSBridgeEvent(event);
  useStudioStore.setState((state) => {
    const history = trimHistory([item, ...state.history.filter((entry) => entry.id !== item.id)]);
    return { history };
  });
  await persistHistoryItem(item).catch(() => undefined);
}

function profileStateSignature(): { signature: string; input: PSBridgeProfileInput | null } {
  const state = useStudioStore.getState();
  const input = buildPSBridgeProfileInput(state);
  return {
    signature: psBridgeProfileSignature(input, Boolean(state.apiKey.trim())),
    input,
  };
}

async function drainProfileSync(): Promise<void> {
  if (profileSyncRunning) return;
  profileSyncRunning = true;
  try {
    while (desiredProfileSync && desiredProfileSync.signature !== appliedProfileSignature) {
      const desired = desiredProfileSync;
      desiredProfileSync = null;
      if (desired.input) {
        await invokePSBridge<PSBridgeStatus>("SyncPSBridgeProfile", desired.input);
        profileWasSynced = true;
      } else if (profileWasSynced) {
        await invokePSBridge<void>("ClearPSBridgeProfile");
        profileWasSynced = false;
      }
      appliedProfileSignature = desired.signature;
    }
  } catch {
    // A later store update retries the latest non-sensitive profile snapshot.
  } finally {
    profileSyncRunning = false;
    if (desiredProfileSync && desiredProfileSync.signature !== appliedProfileSignature) {
      void drainProfileSync();
    }
  }
}

function queueProfileSync(): void {
  const desired = profileStateSignature();
  if (desired.signature === appliedProfileSignature || desired.signature === desiredProfileSync?.signature) return;
  desiredProfileSync = desired;
  void drainProfileSync();
}

function eventPayload<T>(value: T | null | undefined): T | null {
  return value && typeof value === "object" ? value : null;
}

function startRemoteDispatch(dispatch: PSBridgeRemoteDispatch | null): void {
  if (!dispatch?.jobId || remoteControllers.has(dispatch.jobId)) return;
  const controller = new AbortController();
  remoteControllers.set(dispatch.jobId, controller);
  void executePSBridgeRemoteDispatch(dispatch, controller.signal, defaultExecutionDependencies)
    .finally(() => remoteControllers.delete(dispatch.jobId));
}

function cancelRemoteDispatch(payload: { jobId?: string } | null): void {
  const jobId = String(payload?.jobId || "").trim();
  if (!jobId) return;
  remoteControllers.get(jobId)?.abort();
  remoteControllers.delete(jobId);
}

export function installPSBridgeRuntime(): boolean {
  if (installed) return true;
  const requiredMethods = [
    "SyncPSBridgeProfile",
    "ClearPSBridgeProfile",
    "UpdatePSBridgeRemoteJob",
    "CompletePSBridgeRemoteJob",
    "FailPSBridgeRemoteJob",
  ];
  if (!requiredMethods.every((method) => hasServiceMethod(method))) return false;
  installed = true;

  const offRemoteJob = EventsOn(PS_BRIDGE_REMOTE_JOB_EVENT, (payload: PSBridgeRemoteDispatch) => {
    startRemoteDispatch(eventPayload(payload));
  });
  const offRemoteCancel = EventsOn(PS_BRIDGE_REMOTE_CANCEL_EVENT, (payload: { jobId?: string }) => {
    cancelRemoteDispatch(eventPayload(payload));
  });
  const offHistory = EventsOn(PS_BRIDGE_HISTORY_EVENT, (payload: PSBridgeHistoryEvent) => {
    const event = eventPayload(payload);
    if (event) void persistPSBridgeHistory(event);
  });
  const unsubscribe = useStudioStore.subscribe(() => queueProfileSync());
  queueProfileSync();

  const teardown = () => {
    offRemoteJob();
    offRemoteCancel();
    offHistory();
    unsubscribe();
    for (const controller of remoteControllers.values()) controller.abort();
    remoteControllers.clear();
    installed = false;
  };
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", teardown, { once: true });
  }
  return true;
}

export function startPSBridgeRuntime(): void {
  if (installPSBridgeRuntime()) return;
  if (typeof window === "undefined") return;
  const hostname = String(window.location?.hostname || "").toLowerCase();
  if (hostname !== "wails.localhost") return;
  let attempts = 0;
  const retry = () => {
    if (installPSBridgeRuntime() || attempts >= PS_BRIDGE_INSTALL_RETRIES) return;
    attempts += 1;
    setTimeout(retry, PS_BRIDGE_INSTALL_RETRY_MS);
  };
  retry();
}

export function mergePSBridgeHistory(current: HistoryItem[], event: PSBridgeHistoryEvent): HistoryItem[] {
  const item = historyItemFromPSBridgeEvent(event);
  return trimHistory([item, ...current.filter((entry) => entry.id !== item.id)]);
}
