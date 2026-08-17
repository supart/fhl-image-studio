export type DesktopJobLifecycleState =
  | "accepted"
  | "running"
  | "cancelRequested"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "settled";

export interface DesktopJobEventMeta {
  sequence: number;
  state: DesktopJobLifecycleState;
}

const JOB_STATES = new Set<DesktopJobLifecycleState>([
  "accepted",
  "running",
  "cancelRequested",
  "succeeded",
  "failed",
  "cancelled",
  "settled",
]);

export function parseDesktopJobEventMeta(value: unknown): DesktopJobEventMeta | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { sequence?: unknown; state?: unknown };
  if (!Number.isSafeInteger(candidate.sequence) || Number(candidate.sequence) <= 0) return null;
  if (typeof candidate.state !== "string" || !JOB_STATES.has(candidate.state as DesktopJobLifecycleState)) {
    return null;
  }
  return {
    sequence: Number(candidate.sequence),
    state: candidate.state as DesktopJobLifecycleState,
  };
}

export function createDesktopJobEventGate() {
  let lastSequence = 0;

  const observe = (value: unknown) => {
    const meta = parseDesktopJobEventMeta(value);
    if (meta && meta.sequence > lastSequence) lastSequence = meta.sequence;
    return meta;
  };

  return {
    accept(value: unknown): boolean {
      const meta = parseDesktopJobEventMeta(value);
      if (!meta) return true;
      if (meta.sequence <= lastSequence) return false;
      lastSequence = meta.sequence;
      return true;
    },
    observe,
    lastSequence: () => lastSequence,
  };
}

export type DesktopJobTerminalStatus = "success" | "error" | "cancelled";

type DesktopJobTerminalControl = {
  setTerminalStatus: (status: DesktopJobTerminalStatus) => void;
};

type DesktopJobEventCallbacks = {
  isCancelled: () => boolean;
  onProgress: (payload: unknown) => void;
  onLog: (payload: unknown) => void;
  onPreview: (payload: unknown) => void;
  onResult: (payload: unknown, control: DesktopJobTerminalControl) => void;
  onError: (payload: unknown) => void;
  onSettled: (status: DesktopJobTerminalStatus) => void;
};

type DesktopEventRegistrar = (
  eventName: string,
  callback: (payload?: unknown, meta?: unknown) => void,
) => () => void;

export type DesktopJobEventLifecycle = {
  detach: () => void;
  setTerminalStatus: (status: DesktopJobTerminalStatus) => void;
};

function onceDetach(callback: () => void) {
  let detached = false;
  return () => {
    if (detached) return;
    detached = true;
    try { callback(); } catch {}
  };
}

export function createDesktopJobLifecycleRegistry(registerEvent: DesktopEventRegistrar) {
  const active = new Map<string, DesktopJobEventLifecycle>();

  const detach = (jobId: string) => {
    const lifecycle = active.get(jobId);
    if (!lifecycle) return;
    active.delete(jobId);
    lifecycle.detach();
  };

  const register = (jobId: string, callbacks: DesktopJobEventCallbacks): DesktopJobEventLifecycle => {
    detach(jobId);
    const gate = createDesktopJobEventGate();
    const terminalDetachers: Array<() => void> = [];
    let settledDetacher = () => {};
    let terminalStatus: DesktopJobTerminalStatus = "error";
    let terminalHandled = false;
    let settled = false;
    let disposed = false;

    const cleanupTerminalHandlers = () => {
      for (const off of terminalDetachers) off();
    };
    const cleanup = onceDetach(() => {
      disposed = true;
      cleanupTerminalHandlers();
      settledDetacher();
    });
    const setTerminalStatus = (status: DesktopJobTerminalStatus) => {
      terminalStatus = status;
    };
    const onNonTerminal = (callback: (payload: unknown) => void) => (
      payload?: unknown,
      meta?: unknown,
    ) => {
      if (disposed) return;
      if (!gate.accept(meta) || callbacks.isCancelled()) return;
      callback(payload);
    };
    const onTerminal = (
      status: DesktopJobTerminalStatus,
      callback: (payload: unknown) => void,
    ) => (payload?: unknown, meta?: unknown) => {
      if (disposed) return;
      if (!gate.accept(meta)) return;
      if (terminalHandled) return;
      if (callbacks.isCancelled()) {
        terminalHandled = true;
        terminalStatus = "cancelled";
        cleanupTerminalHandlers();
        return;
      }
      terminalHandled = true;
      terminalStatus = status;
      cleanupTerminalHandlers();
      callback(payload);
    };

    terminalDetachers.push(onceDetach(registerEvent(`progress:${jobId}`, onNonTerminal(callbacks.onProgress))));
    terminalDetachers.push(onceDetach(registerEvent(`log:${jobId}`, onNonTerminal(callbacks.onLog))));
    terminalDetachers.push(onceDetach(registerEvent(`preview:${jobId}`, onNonTerminal(callbacks.onPreview))));
    terminalDetachers.push(onceDetach(registerEvent(`result:${jobId}`, onTerminal("success", (payload) => {
      callbacks.onResult(payload, { setTerminalStatus });
    }))));
    terminalDetachers.push(onceDetach(registerEvent(`error:${jobId}`, onTerminal("error", callbacks.onError))));
    settledDetacher = onceDetach(registerEvent(`settled:${jobId}`, (_payload, meta) => {
      if (disposed) return;
      gate.observe(meta);
      if (settled) return;
      settled = true;
      cleanup();
      if (active.get(jobId)?.detach === lifecycle.detach) active.delete(jobId);
      callbacks.onSettled(callbacks.isCancelled() ? "cancelled" : terminalStatus);
    }));

    const lifecycle: DesktopJobEventLifecycle = {
      detach: cleanup,
      setTerminalStatus,
    };
    active.set(jobId, lifecycle);
    return lifecycle;
  };

  const reset = () => {
    for (const jobId of Array.from(active.keys())) detach(jobId);
  };

  return {
    register,
    detach,
    reset,
    activeJobIds: () => Array.from(active.keys()),
  };
}
