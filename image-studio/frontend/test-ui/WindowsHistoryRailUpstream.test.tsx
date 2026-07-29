import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WindowsHistoryRail } from "../src/components/history/WindowsHistoryRail";

const profile = {
  id: "slot-1",
  name: "FHL-1 Images",
  apiMode: "images" as const,
  baseURL: "https://www.fhl.mom",
};

function props(overrides: Record<string, unknown> = {}) {
  return {
    activeProfileId: "",
    apiKey: "",
    apiMode: "images" as const,
    baseURL: profile.baseURL,
    fhlTransportMode: "images" as const,
    batchQueueCompleted: 0,
    batchQueueMode: "generate" as const,
    batchQueueQuality: "medium" as const,
    batchQueueRunning: false,
    batchQueueSize: "1024x1024" as const,
    batchQueueSlots: [],
    batchQueueTotal: 0,
    buildMenu: vi.fn(() => []),
    closeMenu: vi.fn(),
    closeRaw: vi.fn(),
    compareB: null,
    currentImage: null,
    dateF: "all" as const,
    deleteHistoryItem: vi.fn(),
    filtered: [],
    generateCount: 0,
    editCount: 0,
    entries: [],
    history: [],
    historyHasMore: false,
    historyFiltersActive: false,
    historyLoading: false,
    historyRailCollapsed: false,
    isTestingKey: false,
    menu: null,
    modeF: "all" as const,
    loadMoreHistory: vi.fn(),
    openHistoryTimeline: vi.fn(),
    openHistoryGallery: vi.fn(),
    openMaterialManager: vi.fn(),
    openMenu: vi.fn(),
    openUpstreamConfig: vi.fn(),
    profiles: [profile],
    q: "",
    rawPath: null,
    recentJobGroups: [],
    reuseAsSource: vi.fn(),
    selectCurrent: vi.fn(),
    setActiveProfile: vi.fn(),
    setCompareB: vi.fn(),
    setDateF: vi.fn(),
    setHistoryRailCollapsed: vi.fn(),
    setModeF: vi.fn(),
    setQ: vi.fn(),
    testAPIKey: vi.fn(),
    onOpenPromptGroup: vi.fn(),
    ...overrides,
  };
}

describe("WindowsHistoryRail upstream selection", () => {
  afterEach(() => cleanup());

  it("shows an explicit placeholder when profiles exist but none is active", () => {
    render(<WindowsHistoryRail {...props() as any} />);

    const select = screen.getByTitle("切换上游配置 / 管理");
    expect(select).toHaveValue("");
    expect(screen.getByRole("option", { name: "请选择当前 API" })).toBeDisabled();
    expect(screen.getByText("未配置")).toBeInTheDocument();
  });

  it("shows the real active profile and configured state after credential activation", () => {
    render(<WindowsHistoryRail {...props({
      activeProfileId: profile.id,
      apiKey: "stored-active-key",
    }) as any} />);

    expect(screen.getByTitle("切换上游配置 / 管理")).toHaveValue(profile.id);
    expect(screen.queryByRole("option", { name: "请选择当前 API" })).not.toBeInTheDocument();
    expect(screen.getByText("已配置")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "测试当前" })).toBeEnabled();
  });
});
