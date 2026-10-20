import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BatchResultGrid, type BatchGridSlot } from "../src/components/canvas/BatchResultGrid";
import { PlatformProvider } from "../src/platform/context";
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

  it("shows the assigned FHL slot on successful and failed image tiles", () => {
    const completed = {
      ...result("slot-3-result", "slot 3 result", 9_000),
      apiMode: "images" as const,
      apiProfileId: "fhl-slot-3",
      apiProfileName: "FHL-3 Images",
      fhlImagesPoolSlot: 3,
    };
    const slots: BatchGridSlot[] = [
      { type: "result", item: completed, slotIndex: 0, updatedAt: 9_000 },
      {
        type: "failed",
        id: "slot-7-failure",
        slotIndex: 1,
        label: "生成失败",
        apiSource: {
          apiMode: "images",
          apiProfileId: "fhl-slot-7",
          apiProfileName: "FHL-7 Images",
          fhlImagesPoolSlot: 7,
        },
      },
    ];
    const view = render(
      <BatchResultGrid
        items={[completed]}
        slots={slots}
        currentId={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        showClose={false}
        preserveSlotOrder
      />,
    );

    const labels = Array.from(view.container.querySelectorAll<HTMLElement>(".batch-grid-api-source"));
    expect(labels.map((label) => label.textContent)).toEqual(["FHL3", "FHL7"]);
    expect(labels[1].title).toBe("FHL7 · FHL-7 Images | FHL");
  });

  it.each(["batch", "historyGallery"] as const)("offers planar pasteback actions without selecting the %s card", (variant) => {
    const localResult = {
      ...result("local-result", "local result", 9_000),
      localEditRoundtrip: {
        version: 1 as const,
        kind: "planar" as const,
        sourceHistoryId: "source-1",
        sourcePath: "I:/output/source.png",
        sourceWidth: 2048,
        sourceHeight: 1536,
        cropRect: { x: 10, y: 20, width: 640, height: 480 },
        editWidth: 1280,
        editHeight: 960,
      },
    };
    const onSelect = vi.fn();
    const onPreview = vi.fn();
    const onAutoPasteLocalEdit = vi.fn();
    const onManualPasteLocalEdit = vi.fn();
    const onImportPasteLocalEdit = vi.fn();
    render(
      <PlatformProvider><BatchResultGrid
        items={[localResult]}
        currentId={null}
        onSelect={onSelect}
        onPreview={onPreview}
        onClose={vi.fn()}
        showClose={false}
        variant={variant}
        onAutoPasteLocalEdit={onAutoPasteLocalEdit}
        onManualPasteLocalEdit={onManualPasteLocalEdit}
        onImportPasteLocalEdit={onImportPasteLocalEdit}
      /></PlatformProvider>,
    );

    const pasteback = screen.getByTestId("batch-grid-pasteback-local-result");
    fireEvent.doubleClick(pasteback);
    fireEvent.click(pasteback);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onPreview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "自动贴回" }));
    expect(onAutoPasteLocalEdit).toHaveBeenCalledWith(localResult);

    fireEvent.click(pasteback);
    fireEvent.click(screen.getByRole("button", { name: "手动贴回" }));
    expect(onManualPasteLocalEdit).toHaveBeenCalledWith(localResult);

    fireEvent.click(pasteback);
    fireEvent.click(screen.getByRole("button", { name: "导入贴回" }));
    expect(onImportPasteLocalEdit).toHaveBeenCalledWith(localResult);
  });

  it("does not show pasteback on previews, normal images, or pasted terminal results", () => {
    const localResult = {
      ...result("local-terminal", "(局部贴回)done", 9_000),
      localEditRoundtrip: {
        version: 1 as const,
        kind: "planar" as const,
        sourceHistoryId: "source-1",
        sourceWidth: 100,
        sourceHeight: 100,
        cropRect: { x: 0, y: 0, width: 50, height: 50 },
        editWidth: 50,
        editHeight: 50,
      },
      localEditPastebackState: "pasted" as const,
    };
    const legacyTerminal = {
      ...localResult,
      id: "legacy-local-terminal",
      prompt: "(局部贴回)legacy done",
      localEditPastebackState: undefined,
    };
    const normal = result("normal", "normal", 10_000);
    render(
      <BatchResultGrid
        items={[localResult, legacyTerminal, normal]}
        slots={[
          { type: "result", item: localResult },
          { type: "result", item: legacyTerminal },
          { type: "preview", item: { ...localResult, id: "preview", localEditPastebackState: undefined } },
          { type: "result", item: normal },
        ]}
        currentId={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        showClose={false}
        onAutoPasteLocalEdit={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("打开局部重绘贴回菜单")).not.toBeInTheDocument();
  });
});
