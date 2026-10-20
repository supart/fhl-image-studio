import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openOutputDir: vi.fn(async () => undefined),
  openExternalURL: vi.fn(async () => undefined),
  openUpstreamConfig: vi.fn(),
  openStarPrompt: vi.fn(),
  newWorkspace: vi.fn(),
  pushToast: vi.fn(),
  setTheme: vi.fn(),
  setFHLTransportMode: vi.fn(),
  platform: {
    hostPlatform: "macos",
    presentationPlatform: "windows",
    desktopUIVariant: "windows-parity",
    platform: "macos",
    isAndroid: false,
    isAndroidPhone: false,
    isAndroidPad: false,
    isMac: false,
    isWindows: true,
    isMacHost: true,
    isWindowsHost: false,
    usesMacDesktopUI: false,
    usesWindowsDesktopUI: true,
    usesAndroidUI: false,
    usesAppleUI: false,
    usesFluentUI: true,
  },
  store: {
    profiles: [],
    apiKey: "",
    apiMode: "responses",
    baseURL: "",
    fhlTransportMode: "images",
    fullscreen: false,
    history: [],
    imageModelID: "",
    runningJobs: [],
    isRunning: false,
    theme: "system",
    workspaces: [{ runningJobIds: [] }],
  },
}));

vi.mock("../src/platform/context", () => ({
  usePlatform: () => mocks.platform,
}));

vi.mock("../src/lib/version", () => ({
  appVersion: "2.0.4",
}));

vi.mock("../src/state/studioStore", () => {
  const state = {
    ...mocks.store,
    newWorkspace: mocks.newWorkspace,
    openUpstreamConfig: mocks.openUpstreamConfig,
    openStarPrompt: mocks.openStarPrompt,
    pushToast: mocks.pushToast,
    setTheme: mocks.setTheme,
    setFHLTransportMode: mocks.setFHLTransportMode,
  };
  const useStudioStore = Object.assign(
    (selector?: (value: typeof state) => unknown) => selector ? selector(state) : state,
    { getState: () => state },
  );
  return { useStudioStore };
});

vi.mock("../src/platform/runtime/host", () => ({
  OpenExternalURL: mocks.openExternalURL,
  OpenOutputDir: mocks.openOutputDir,
}));

vi.mock("../src/platform/android/bridge", () => ({
  androidTarget: { isAndroid: false },
  openExternalURLForPlatform: (url: string, open: (value: string) => Promise<void>) => open(url),
  openOutputLocationForPlatform: (open: () => Promise<void>) => open(),
}));

vi.mock("../src/lib/headerPromotion", () => ({
  EMPTY_HEADER_PROMOTION_CONFIG: {
    announcement: "",
    groupNumber: "",
    registrationText: "",
    registrationURL: "",
  },
  loadHeaderPromotionConfig: vi.fn(async () => ({
    announcement: "",
    groupNumber: "",
    registrationText: "",
    registrationURL: "",
  })),
}));

vi.mock("../src/components/layout/WindowsHeaderPromotion", () => ({
  WindowsHeaderPromotion: () => null,
}));

vi.mock("../src/components/layout/HitokotoStrip", () => ({
  HitokotoStrip: () => <div data-testid="hitokoto" />,
}));

vi.mock("../src/components/panel/FHLAPIChoiceModal", () => ({
  FHLAPIChoiceModal: ({ open }: { open: boolean }) => open
    ? <div data-testid="fhl-api-choice-modal" />
    : null,
}));

vi.mock("../src/components/panel/FHLQuickConfigModal", () => ({
  FHLQuickConfigModal: ({ open }: { open: boolean }) => open
    ? <div data-testid="fhl-quick-config-modal" />
    : null,
}));

import { AppHeaderBrand } from "../src/components/layout/AppHeaderBrand";
import { AppHeader } from "../src/components/layout/AppHeader";
import { FooterBar } from "../src/components/layout/FooterBar";

describe("macOS host with Windows desktop presentation", () => {
  beforeEach(() => {
    mocks.openOutputDir.mockClear();
    mocks.openExternalURL.mockClear();
    mocks.openUpstreamConfig.mockClear();
    mocks.openStarPrompt.mockClear();
    mocks.newWorkspace.mockClear();
    mocks.pushToast.mockClear();
    mocks.setTheme.mockClear();
    mocks.setFHLTransportMode.mockClear();
  });

  afterEach(() => cleanup());

  it("shows one-click FHL configuration and both transport modes", () => {
    render(<AppHeaderBrand />);

    fireEvent.click(screen.getByRole("button", { name: "一键配置 FHL API" }));
    expect(screen.getByTestId("fhl-api-choice-modal")).toBeInTheDocument();

    expect(screen.getByRole("group", { name: "FHL 接口模式" })).toBeInTheDocument();
    expect(screen.getByText("FHL Images")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "切换全部 FHL API 为 Responses" }));
    expect(mocks.setFHLTransportMode).toHaveBeenCalledWith("responses");
  });

  it("shows the Windows desktop header actions on the Mac host", () => {
    const onOpenSettings = vi.fn();
    const { container } = render(<AppHeader onOpenSettings={onOpenSettings} />);

    expect(container.querySelector('[data-audit-id="open-github"]')).toBeInTheDocument();
    expect(container.querySelector('[data-audit-id="open-star"]')).toBeInTheDocument();
    expect(container.querySelector('[data-audit-id="open-settings"]')).toBeInTheDocument();

    fireEvent.click(container.querySelector('[data-audit-id="open-star"]') as HTMLButtonElement);
    fireEvent.click(container.querySelector('[data-audit-id="open-settings"]') as HTMLButtonElement);
    expect(mocks.openStarPrompt).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("shows the complete footer and opens the macOS output location", () => {
    render(<FooterBar />);

    expect(screen.getByText("输出目录")).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("反馈")).toBeInTheDocument();
    expect(screen.getByText("今日已生图:")).toBeInTheDocument();
    expect(screen.getByText("总生图:")).toBeInTheDocument();
    expect(screen.getByText("就绪")).toBeInTheDocument();
    expect(screen.getByText("v2.0.4")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /输出目录/ }));
    expect(mocks.openOutputDir).toHaveBeenCalledTimes(1);
  });
});
