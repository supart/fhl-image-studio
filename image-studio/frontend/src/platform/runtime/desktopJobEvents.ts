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
