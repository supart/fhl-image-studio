import { describe, expect, it } from "vitest";
import {
  createDesktopJobEventGate,
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
