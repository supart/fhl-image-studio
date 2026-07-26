import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(async () => undefined),
  saveAndTest: vi.fn(async () => true),
  remove: vi.fn(async () => undefined),
  state: {
    fhlTextAPIConfigured: false,
    fhlTextAPIKeyHint: "",
    fhlTextAPITestStatus: "unconfigured",
    fhlTextAPITestMessage: "",
  },
}));

vi.mock("../src/platform/context", () => ({
  usePlatform: () => ({ usesFluentUI: true }),
}));

vi.mock("../src/lib/fhlTextAPI", () => ({
  FHL_TEXT_API_BASE_URL: "https://www.fhl.mom",
  FHL_TEXT_API_MODEL_ID: "gpt-5.5",
  validateFHLTextAPIKey: (value: string) => value.trim(),
}));

vi.mock("../src/state/studioStore", () => ({
  useStudioStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
      ...mocks.state,
      refreshFHLTextAPIConfig: mocks.refresh,
      saveAndTestFHLTextAPI: mocks.saveAndTest,
      deleteFHLTextAPIConfig: mocks.remove,
    }),
}));

import { FHLTextAPIConfig } from "../src/components/panel/FHLTextAPIConfig";

describe("FHLTextAPIConfig", () => {
  beforeEach(() => {
    cleanup();
    mocks.refresh.mockClear();
    mocks.saveAndTest.mockClear();
    mocks.remove.mockClear();
    Object.assign(mocks.state, {
      fhlTextAPIConfigured: false,
      fhlTextAPIKeyHint: "",
      fhlTextAPITestStatus: "unconfigured",
      fhlTextAPITestMessage: "",
    });
  });

  it("renders a separate fixed-model text credential and clears submitted input", async () => {
    render(<FHLTextAPIConfig active />);

    expect(screen.getByText("FHL 文本 API")).toBeInTheDocument();
    expect(screen.getByText("FHL Responses")).toBeInTheDocument();
    expect(screen.getAllByText("gpt-5.5").length).toBeGreaterThan(0);
    expect(mocks.refresh).toHaveBeenCalledOnce();

    const input = screen.getByPlaceholderText("粘贴专用 FHL 文本 API Key");
    expect(input).toHaveAttribute("type", "password");
    fireEvent.change(input, { target: { value: "sk-text-test-value" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并测试文本 API" }));

    await waitFor(() => expect(mocks.saveAndTest).toHaveBeenCalledWith("sk-text-test-value"));
    expect(input).toHaveValue("");
  });

  it("shows a redacted saved key and retained failure state without filling the input", () => {
    Object.assign(mocks.state, {
      fhlTextAPIConfigured: true,
      fhlTextAPIKeyHint: "sk-...1234",
      fhlTextAPITestStatus: "error",
      fhlTextAPITestMessage: "已保存，文本测试失败：上游不可用",
    });

    render(<FHLTextAPIConfig active />);

    const input = screen.getByPlaceholderText("已保存：sk-...1234；输入新 Key 可替换");
    expect(input).toHaveValue("");
    expect(screen.getByText("已保存，测试失败")).toBeInTheDocument();
    expect(screen.getByText(/已保存，文本测试失败/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除 FHL 文本 API" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "保存并测试文本 API" })).toBeEnabled();
  });
});
