import { afterEach, describe, expect, it, vi } from "vitest";

import {
  calculateWindowsSourceTileWidth,
  ClipboardImageError,
  clipboardImageReadMessage,
  copySourceImageToClipboard,
  readClipboardImageFile,
  readClipboardImageFileFromPasteEvent,
  shouldUseClipboardPasteFallback,
} from "../src/components/canvas/sourceImageInteractions";
import { applySourceImageImport } from "../src/state/sourceImageImport";
import type { SourceImage } from "../src/types/domain";

function source(path: string, width = 100, height = 100): SourceImage {
  return { path, name: `${path}.png`, size: 1, width, height };
}

function setClipboard(value: Partial<Clipboard>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value,
  });
}

describe("source image layout and import rules", () => {
  it("keeps common aspect ratios and clamps extreme tiles", () => {
    expect(calculateWindowsSourceTileWidth(1_600, 900)).toBe(100);
    expect(calculateWindowsSourceTileWidth(1_000, 1_000)).toBe(56);
    expect(calculateWindowsSourceTileWidth(9, 16)).toBe(36);
    expect(calculateWindowsSourceTileWidth(4_000, 500)).toBe(112);
    expect(calculateWindowsSourceTileWidth(0, 0)).toBe(56);
    expect(calculateWindowsSourceTileWidth(Number.NaN, 100)).toBe(56);
    expect(calculateWindowsSourceTileWidth(0, 0, 1_600, 900)).toBe(100);
  });

  it("adds or replaces by stable path without changing unrelated slots", () => {
    const first = source("first");
    const second = source("second");
    const replacement = source("replacement", 1_600, 900);

    const added = applySourceImageImport([first], second);
    expect(added.outcome).toBe("added");
    expect(added.sources).toEqual([first, second]);

    const replaced = applySourceImageImport([first, second], replacement, "first");
    expect(replaced.outcome).toBe("replaced");
    expect(replaced.sources).toEqual([replacement, second]);
  });

  it("refuses duplicate and stale replacement targets without mutating the list", () => {
    const first = source("first");
    const second = source("second");
    const sources = [first, second];

    expect(applySourceImageImport(sources, second).outcome).toBe("duplicate");
    expect(applySourceImageImport(sources, second, "first")).toEqual({ sources, outcome: "duplicate" });
    expect(applySourceImageImport(sources, source("replacement"), "missing")).toEqual({ sources, outcome: "stale" });
  });
});

describe("source image clipboard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  });

  it.each([
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/webp", "webp"],
  ])("reads the first supported %s clipboard image as a named File", async (type, extension) => {
    const getType = vi.fn(async () => new Blob([extension], { type }));
    setClipboard({
      read: vi.fn(async () => [
        { types: ["text/plain"], getType: vi.fn() },
        { types: [type], getType },
      ] as unknown as ClipboardItems),
    });

    const file = await readClipboardImageFile();
    expect(file.name).toBe(`clipboard-image.${extension}`);
    expect(file.type).toBe(type);
    expect(getType).toHaveBeenCalledWith(type);
  });

  it("distinguishes empty, unsupported and denied clipboard reads", async () => {
    setClipboard({ read: vi.fn(async () => [] as unknown as ClipboardItems) });
    await expect(readClipboardImageFile()).rejects.toMatchObject({ code: "empty" });

    setClipboard({
      read: vi.fn(async () => [{
        types: ["image/gif"],
        getType: vi.fn(),
      }] as unknown as ClipboardItems),
    });
    await expect(readClipboardImageFile()).rejects.toMatchObject({ code: "unsupported" });

    setClipboard({ read: vi.fn(async () => { throw new Error("secret clipboard detail"); }) });
    await expect(readClipboardImageFile()).rejects.toMatchObject({ code: "denied" });
    expect(clipboardImageReadMessage(new ClipboardImageError("denied"))).not.toContain("secret");
  });

  it("reads supported image files from a user-initiated paste event", () => {
    const file = new File(["png"], "pasted.png", { type: "image/png" });
    const event = {
      clipboardData: {
        items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
      },
    } as unknown as ClipboardEvent;

    expect(readClipboardImageFileFromPasteEvent(event)).toBe(file);
    expect(shouldUseClipboardPasteFallback(new ClipboardImageError("denied"))).toBe(true);
    expect(shouldUseClipboardPasteFallback(new ClipboardImageError("empty"))).toBe(false);
  });

  it("copies a full PNG source without exposing its payload", async () => {
    const write = vi.fn(async () => undefined);
    class ClipboardItemMock {
      constructor(readonly items: Record<string, Blob>) {}
    }
    vi.stubGlobal("ClipboardItem", ClipboardItemMock);
    setClipboard({ write });
    const png = btoa("synthetic-png-payload");

    await expect(copySourceImageToClipboard({
      path: "virtual-source.png",
      name: "source.png",
      size: 1,
      imageB64: png,
    })).resolves.toBe("success");
    expect(write).toHaveBeenCalledTimes(1);
    const clipboardItem = write.mock.calls[0][0][0] as unknown as ClipboardItemMock;
    expect(clipboardItem.items["image/png"]).toBeInstanceOf(Blob);
  });

  it("reports unavailable, missing and failed copy paths without source details", async () => {
    setClipboard({ write: vi.fn() });
    vi.stubGlobal("ClipboardItem", undefined);
    await expect(copySourceImageToClipboard(source("private-path"))).resolves.toBe("unavailable");

    class ClipboardItemMock {
      constructor(readonly items: Record<string, Blob>) {}
    }
    vi.stubGlobal("ClipboardItem", ClipboardItemMock);
    await expect(copySourceImageToClipboard({ path: "", name: "", size: 0 })).resolves.toBe("missing");

    setClipboard({ write: vi.fn(async () => { throw new Error("private clipboard detail"); }) });
    await expect(copySourceImageToClipboard({
      path: "virtual-source.png",
      name: "source.png",
      size: 1,
      imageB64: btoa("synthetic-png-payload"),
    })).resolves.toBe("failed");
  });
});
