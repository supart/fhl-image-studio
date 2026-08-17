import { describe, expect, it, vi } from "vitest";
import {
  createDesktopJobEventGate,
  createDesktopJobLifecycleRegistry,
  parseDesktopJobEventMeta,
} from "../src/platform/runtime/desktopJobEvents";

describe("desktop job event metadata", () => {
  it("accepts legacy events without metadata", () => {
    const gate = createDesktopJobEventGate();
    expect(gate.accept(undefined)).toBe(true);
    expect(gate.accept("legacy")).toBe(true);
    expect(gate.lastSequence()).toBe(0);
  });

  it("rejects duplicate and out-of-order sequenced events", () => {
    const gate = createDesktopJobEventGate();
    expect(gate.accept({ sequence: 2, state: "running" })).toBe(true);
    expect(gate.accept({ sequence: 2, state: "running" })).toBe(false);
    expect(gate.accept({ sequence: 1, state: "accepted" })).toBe(false);
    expect(gate.accept({ sequence: 3, state: "succeeded" })).toBe(true);
  });

  it("observes settled metadata without gating cleanup", () => {
    const gate = createDesktopJobEventGate();
    expect(gate.accept({ sequence: 5, state: "running" })).toBe(true);
    expect(gate.observe({ sequence: 4, state: "settled" })?.state).toBe("settled");
    expect(gate.lastSequence()).toBe(5);
  });

  it("rejects malformed metadata during parsing", () => {
    expect(parseDesktopJobEventMeta({ sequence: 0, state: "running" })).toBeNull();
    expect(parseDesktopJobEventMeta({ sequence: 1.5, state: "running" })).toBeNull();
    expect(parseDesktopJobEventMeta({ sequence: 1, state: "unknown" })).toBeNull();
  });
});

describe("desktop job lifecycle registry", () => {
  function createHarness() {
    const handlers = new Map<string, (payload?: unknown, meta?: unknown) => void>();
    const detachers = new Map<string, ReturnType<typeof vi.fn>>();
    const registerEvent = vi.fn((
      eventName: string,
      callback: (payload?: unknown, meta?: unknown) => void,
    ) => {
      handlers.set(eventName, callback);
      const detach = vi.fn(() => handlers.delete(eventName));
      detachers.set(eventName, detach);
      return detach;
    });
    return {
      handlers,
      detachers,
      registerEvent,
      registry: createDesktopJobLifecycleRegistry(registerEvent),
    };
  }

  it("gates duplicate events, commits one terminal callback, and always settles", () => {
    const harness = createHarness();
    const onProgress = vi.fn();
    const onResult = vi.fn();
    const onError = vi.fn();
    const onSettled = vi.fn();
    const lifecycle = harness.registry.register("job-1", {
      isCancelled: () => false,
      onProgress,
      onLog: vi.fn(),
      onPreview: vi.fn(),
      onResult,
      onError,
      onSettled,
    });
    const progress = harness.handlers.get("progress:job-1")!;
    const result = harness.handlers.get("result:job-1")!;
    const error = harness.handlers.get("error:job-1")!;
    const settled = harness.handlers.get("settled:job-1")!;

    progress("first", { sequence: 2, state: "running" });
    progress("duplicate", { sequence: 2, state: "running" });
    progress("old", { sequence: 1, state: "accepted" });
    result({ ok: true }, { sequence: 3, state: "succeeded" });
    error({ message: "late" }, { sequence: 4, state: "failed" });
    settled(undefined, { sequence: 1, state: "settled" });
    settled(undefined, { sequence: 5, state: "settled" });

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledExactlyOnceWith("success");
    expect(harness.registry.activeJobIds()).toEqual([]);
    for (const detach of harness.detachers.values()) expect(detach).toHaveBeenCalledTimes(1);
    lifecycle.detach();
    for (const detach of harness.detachers.values()) expect(detach).toHaveBeenCalledTimes(1);
  });

  it("reset detaches all six handlers for every active job", () => {
    const harness = createHarness();
    const callbacks = {
      isCancelled: () => false,
      onProgress: vi.fn(),
      onLog: vi.fn(),
      onPreview: vi.fn(),
      onResult: vi.fn(),
      onError: vi.fn(),
      onSettled: vi.fn(),
    };
    harness.registry.register("job-1", callbacks);
    harness.registry.register("job-2", callbacks);
    const lateSettled = harness.handlers.get("settled:job-1")!;

    harness.registry.reset();
    harness.registry.reset();
    lateSettled(undefined, { sequence: 1, state: "settled" });

    expect(harness.registry.activeJobIds()).toEqual([]);
    expect(callbacks.onSettled).not.toHaveBeenCalled();
    expect(harness.detachers.size).toBe(12);
    for (const detach of harness.detachers.values()) expect(detach).toHaveBeenCalledTimes(1);
  });
});
