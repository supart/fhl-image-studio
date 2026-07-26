import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BatchResultGrid, type BatchGridSlot } from "../src/components/canvas/BatchResultGrid";
import type { HistoryItem } from "../src/types/domain";

function result(id: string, prompt: string, createdAt: number): HistoryItem {
  return {
    id,
    prompt,
    mode: "edit",
    size: "1024x1024",
    quality: "medium",
    createdAt,
  };
}

function displayedTiles(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(".batch-grid-tile")).map((tile) => (
    tile.getAttribute("aria-label") || tile.getAttribute("title") || ""
  ));
}

describe("BatchResultGrid recent success pin", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(10_000));
    vi.stubGlobal("ResizeObserver", class ResizeObserverMock {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        const contentRect = target.getBoundingClientRect();
        this.callback([{
          target,
          contentRect,
          borderBoxSize: [{ inlineSize: contentRect.width, blockSize: contentRect.height }],
          contentBoxSize: [{ inlineSize: contentRect.width, blockSize: contentRect.height }],
          devicePixelContentBoxSize: [],
        } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 1_000,
      height: 700,
      top: 0,
      right: 1_000,
      bottom: 700,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("pins a completed image for five seconds and then restores default ordering", () => {
    const oldResult = result("old-result", "old result", 1_000);
    const newResult = result("new-result", "new result", 10_000);
    const initialSlots: BatchGridSlot[] = [
      { type: "result", item: oldResult, slotIndex: 0, updatedAt: 1_000 },
      { type: "pending", id: "queued", slotIndex: 1, status: "queued" },
      { type: "pending", id: "running", slotIndex: 2, status: "running" },
    ];
    const completedSlots: BatchGridSlot[] = [
      initialSlots[0],
      initialSlots[1],
      { type: "result", item: newResult, slotIndex: 2, updatedAt: 10_000 },
    ];
    const props = {
      items: [oldResult],
      currentId: null,
      onSelect: vi.fn(),
      onClose: vi.fn(),
      showClose: false,
      preserveSlotOrder: true,
    };

    const view = render(<BatchResultGrid {...props} slots={initialSlots} />);
    expect(displayedTiles(view.container)).toEqual([
      "第 3 张 正在生成",
      "第 2 张 等待生成",
      "old result",
    ]);

    view.rerender(<BatchResultGrid {...props} items={[oldResult, newResult]} slots={completedSlots} />);
    expect(displayedTiles(view.container)).toEqual([
      "new result",
      "第 2 张 等待生成",
      "old result",
    ]);

    act(() => vi.advanceTimersByTime(5_020));
    expect(displayedTiles(view.container)).toEqual([
      "第 2 张 等待生成",
      "old result",
      "new result",
    ]);
  });

  it("mounts only the visible virtual rows for a 397-item result grid", () => {
    const items = Array.from({ length: 397 }, (_, index) => ({
      ...result(`result-${index}`, `result ${index + 1}`, index + 1),
      previewUrl: `/media/thumb/result-${index}`,
    }));
    const view = render(
      <BatchResultGrid
        items={items}
        currentId={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        showClose={false}
      />,
    );

    const mountedTiles = view.container.querySelectorAll(".batch-grid-tile").length;
    const mountedImages = view.container.querySelectorAll(".batch-grid-tile img").length;
    expect(mountedTiles).toBeGreaterThan(0);
    expect(mountedTiles).toBeLessThanOrEqual(80);
    expect(mountedImages).toBeLessThanOrEqual(80);
  });
});
