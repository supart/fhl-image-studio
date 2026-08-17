import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn(async () => undefined),
  pushToast: vi.fn(),
  writeText: vi.fn(async () => undefined),
}));

vi.mock("../src/platform/runtime/host", () => ({
  OpenExternalURL: mocks.openExternal,
}));

vi.mock("../src/state/studioStore", () => ({
  useStudioStore: { getState: () => ({ pushToast: mocks.pushToast }) },
}));

import { WindowsHeaderPromotion } from "../src/components/layout/WindowsHeaderPromotion";
import type { HeaderPromotionConfig } from "../src/lib/headerPromotion";

const fullConfig: HeaderPromotionConfig = {
  announcement: "可维护公告",
  groupNumber: "654321",
  registrationText: "使用测试邀请码注册",
  registrationURL: "https://example.test/register?invite=test",
};

describe("WindowsHeaderPromotion", () => {
  beforeEach(() => {
    mocks.openExternal.mockClear();
    mocks.pushToast.mockClear();
    mocks.writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: mocks.writeText },
    });
  });

  afterEach(() => cleanup());

  it("renders the complete config and uses configured click payloads", async () => {
    render(<WindowsHeaderPromotion config={fullConfig} />);

    expect(screen.getByText("可维护公告")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "复制QQ群号 654321" }));
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledWith("654321"));

    fireEvent.click(screen.getByRole("button", { name: "复制注册链接并打开注册页" }));
    await waitFor(() => {
      expect(mocks.openExternal).toHaveBeenCalledWith("https://example.test/register?invite=test");
      expect(mocks.writeText).toHaveBeenCalledWith("https://example.test/register?invite=test");
    });
  });

  it("hides announcement, group and registration controls independently", () => {
    const view = render(<WindowsHeaderPromotion config={{ ...fullConfig, announcement: "" }} />);
    expect(screen.queryByText("可维护公告")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /复制QQ群号/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制注册链接并打开注册页" })).toBeInTheDocument();

    view.rerender(<WindowsHeaderPromotion config={{ ...fullConfig, groupNumber: "" }} />);
    expect(screen.queryByRole("button", { name: /复制QQ群号/ })).not.toBeInTheDocument();
    expect(screen.getByText("可维护公告")).toBeInTheDocument();

    view.rerender(<WindowsHeaderPromotion config={{ ...fullConfig, registrationText: "" }} />);
    expect(screen.queryByRole("button", { name: "复制注册链接并打开注册页" })).not.toBeInTheDocument();

    view.rerender(<WindowsHeaderPromotion config={{ ...fullConfig, registrationURL: "" }} />);
    expect(screen.queryByRole("button", { name: "复制注册链接并打开注册页" })).not.toBeInTheDocument();
  });

  it("renders nothing for an empty, missing or failed-load equivalent config", () => {
    const { container } = render(<WindowsHeaderPromotion config={{
      announcement: "",
      groupNumber: "",
      registrationText: "",
      registrationURL: "",
    }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
