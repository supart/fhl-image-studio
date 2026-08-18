import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  importSourceImageFile: vi.fn(),
  removeSource: vi.fn(),
  reorderSources: vi.fn(),
  selectSourceImage: vi.fn(),
  selectBatchInputFiles: vi.fn(),
  setField: vi.fn(),
  setCompareB: vi.fn(),
  pushToast: vi.fn(),
  openSourcePreview: vi.fn(),
  readClipboardImageFile: vi.fn(),
  readClipboardImageFileFromPasteEvent: vi.fn(),
  shouldUseClipboardPasteFallback: vi.fn(),
  copySourceImageToClipboard: vi.fn(),
  materializeCompareSource: vi.fn(),
  state: {} as Record<string, any>,
}));

vi.mock("../src/platform/context", () => ({
  usePlatform: () => ({ isMac: false, usesFluentUI: true, usesAppleUI: false }),
}));

vi.mock("../src/state/studioStore", () => {
  const useStudioStore = Object.assign(
    (selector: (state: Record<string, any>) => unknown) => selector(mocks.state),
    { getState: () => mocks.state },
  );
  return { useStudioStore };
});

vi.mock("../src/state/compareSourceSelection", () => ({
  materializeCompareSourceAsHistoryItem: mocks.materializeCompareSource,
}));

vi.mock("../src/lib/virtualHostStore", () => ({
  sourceToDataURL: vi.fn(async () => `data:image/png;base64,${btoa("source")}`),
}));

vi.mock("../src/platform/runtime/host", () => ({
  ImportImagePath: vi.fn(async () => null),
  ReadImageAsBase64: vi.fn(async () => ""),
  RegisterImportedImageAsset: vi.fn(async () => null),
}));

vi.mock("../src/components/canvas/sourceImageInteractions", () => ({
  calculateWindowsSourceTileWidth: (width?: number, height?: number) => (
    width === 1_600 && height === 900 ? 100 : 56
  ),
  clipboardImageReadMessage: () => "clipboard error",
  copySourceImageToClipboard: mocks.copySourceImageToClipboard,
  readClipboardImageFile: mocks.readClipboardImageFile,
  readClipboardImageFileFromPasteEvent: mocks.readClipboardImageFileFromPasteEvent,
  shouldUseClipboardPasteFallback: mocks.shouldUseClipboardPasteFallback,
}));

import { SourceStrip } from "../src/components/canvas/SourceStrip";

const historyItem = {
  id: "history-1",
  prompt: "history",
  mode: "edit",
  size: "1024x1024",
  quality: "medium",
  createdAt: 1,
};

describe("SourceStrip reference interactions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(mocks.state, {
      sources: [{
        path: "source-a.png",
        name: "source-a.png",
        size: 10,
        width: 1_600,
        height: 900,
        previewUrl: "data:image/png;base64,cHJldmlldw==",
      }],
      removeSource: mocks.removeSource,
      reorderSources: mocks.reorderSources,
      mode: "edit",
      editSourceMode: "manual",
      batchProcess: { discoveredSources: [], batchSourceSlotIndex: 0 },
      setField: mocks.setField,
      currentImage: historyItem,
      compareB: historyItem,
      setCompareB: mocks.setCompareB,
      selectSourceImage: mocks.selectSourceImage,
      selectBatchInputFiles: mocks.selectBatchInputFiles,
      importSourceImageFile: mocks.importSourceImageFile,
      pushToast: mocks.pushToast,
      openSourcePreview: mocks.openSourcePreview,
      size: "1024x1024",
      quality: "medium",
      outputFormat: "png",
    });
    mocks.importSourceImageFile.mockReset();
    mocks.removeSource.mockReset();
    mocks.reorderSources.mockReset();
    mocks.setCompareB.mockReset();
    mocks.pushToast.mockReset();
    mocks.openSourcePreview.mockReset();
    mocks.readClipboardImageFile.mockReset();
    mocks.readClipboardImageFileFromPasteEvent.mockReset();
    mocks.shouldUseClipboardPasteFallback.mockReset();
    mocks.copySourceImageToClipboard.mockReset();
    mocks.materializeCompareSource.mockReset();
    mocks.materializeCompareSource.mockResolvedValue(historyItem);
    mocks.readClipboardImageFile.mockResolvedValue(new File(["png"], "clipboard.png", { type: "image/png" }));
    mocks.readClipboardImageFileFromPasteEvent.mockReturnValue(new File(["png"], "pasted.png", { type: "image/png" }));
    mocks.shouldUseClipboardPasteFallback.mockReturnValue(false);
    mocks.copySourceImageToClipboard.mockResolvedValue("success");
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 100,
      height: 56,
      top: 400,
      right: 500,
      bottom: 456,
      left: 400,
      x: 400,
      y: 400,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows the full 16:9 thumbnail and opens a delayed hover preview", () => {
    const view = render(<SourceStrip />);
    const tile = view.container.querySelector<HTMLElement>('[data-audit-id="source-image"]')!;
    const image = tile.querySelector("img")!;
    expect(tile.style.getPropertyValue("--source-tile-width")).toBe("100px");
    expect(image).toHaveClass("object-contain");

    fireEvent.mouseEnter(tile);
    act(() => vi.advanceTimersByTime(249));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("tooltip", { name: "第 1 张参考图大预览" })).toBeInTheDocument();

    fireEvent.mouseLeave(tile);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("delays compare selection and cancels it when a double click opens the canvas", async () => {
    const view = render(<SourceStrip />);
    const tile = view.container.querySelector<HTMLElement>('[data-audit-id="source-image"]')!;

    fireEvent.click(tile);
    act(() => vi.advanceTimersByTime(219));
    expect(mocks.setCompareB).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(mocks.setCompareB).toHaveBeenCalledTimes(1);

    mocks.setCompareB.mockClear();
    fireEvent.click(tile);
    fireEvent.click(tile);
    fireEvent.doubleClick(tile);
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.setCompareB).not.toHaveBeenCalled();
    expect(mocks.openSourcePreview).toHaveBeenCalledTimes(1);
  });

  it("opens the source preview with Enter without scheduling compare selection", async () => {
    const view = render(<SourceStrip />);
    const tile = view.container.querySelector<HTMLElement>('[data-audit-id="source-image"]')!;

    fireEvent.keyDown(tile, { key: "Enter" });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.setCompareB).not.toHaveBeenCalled();
    expect(mocks.openSourcePreview).toHaveBeenCalledTimes(1);
  });

  it("pastes into the add tile and replaces a stable existing source from its menu", async () => {
    const view = render(<SourceStrip />);
    const tile = view.container.querySelector<HTMLElement>('[data-audit-id="source-image"]')!;
    const add = view.container.querySelector<HTMLElement>('[data-audit-id="select-source-image"]')!;

    fireEvent.contextMenu(add, { clientX: 700, clientY: 200 });
    fireEvent.click(screen.getByRole("button", { name: "粘贴图像" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.importSourceImageFile).toHaveBeenCalledWith(expect.any(File), undefined);

    mocks.importSourceImageFile.mockClear();
    fireEvent.contextMenu(tile, { clientX: 500, clientY: 220 });
    fireEvent.click(screen.getByRole("button", { name: "粘贴替换当前格" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.importSourceImageFile).toHaveBeenCalledWith(
      expect.any(File),
      { replaceSourcePath: "source-a.png" },
    );
  });

  it("copies the original and deletes the current source through the context menu", async () => {
    const view = render(<SourceStrip />);
    const tile = view.container.querySelector<HTMLElement>('[data-audit-id="source-image"]')!;

    fireEvent.contextMenu(tile, { clientX: 500, clientY: 220 });
    fireEvent.click(screen.getByRole("button", { name: "复制图像" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.copySourceImageToClipboard).toHaveBeenCalledWith(mocks.state.sources[0]);
    expect(mocks.pushToast).toHaveBeenCalledWith("已复制参考图原图", "success", 2200);

    fireEvent.contextMenu(tile, { clientX: 500, clientY: 220 });
    fireEvent.click(screen.getByRole("button", { name: "删除参考图" }));
    expect(mocks.removeSource).toHaveBeenCalledWith(0);
  });

  it("falls back to a user-initiated Ctrl+V paste when clipboard permission is denied", async () => {
    const view = render(<SourceStrip />);
    const add = view.container.querySelector<HTMLElement>('[data-audit-id="select-source-image"]')!;
    mocks.readClipboardImageFile.mockRejectedValue(new Error("permission denied"));
    mocks.shouldUseClipboardPasteFallback.mockReturnValue(true);

    fireEvent.contextMenu(add, { clientX: 700, clientY: 200 });
    fireEvent.click(screen.getByRole("button", { name: "粘贴图像" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("dialog", { name: "粘贴参考图" })).toBeInTheDocument();

    fireEvent.paste(screen.getByRole("textbox", { name: "按 Ctrl+V 粘贴图片" }), {
      clipboardData: { items: [{ kind: "file", type: "image/png" }] },
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.importSourceImageFile).toHaveBeenCalledWith(expect.any(File), undefined);
    expect(screen.queryByRole("dialog", { name: "粘贴参考图" })).not.toBeInTheDocument();
  });
});
