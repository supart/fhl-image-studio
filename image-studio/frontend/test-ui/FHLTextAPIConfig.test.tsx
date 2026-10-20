import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(async () => undefined),
  saveAndTest: vi.fn(async () => true),
  fetchModels: vi.fn(async () => ["gpt-5.7", "gpt-5.6-sol", "gpt-image-2"]),
  loadKey: vi.fn(async () => "sk-saved-text-key"),
  setModel: vi.fn(),
  remove: vi.fn(async () => undefined),
  state: {
    fhlTextAPIConfigured: false,
    fhlTextAPIModelID: "gpt-5.6-sol",
    fhlTextAPIKeyHint: "",
    fhlTextAPITestStatus: "unconfigured",
    fhlTextAPITestMessage: "",
    proxyMode: "system",
    proxyURL: "",
  },
}));

vi.mock("../src/platform/context", () => ({
  usePlatform: () => ({ usesFluentUI: true }),
}));

vi.mock("../src/lib/fhlTextAPI", () => ({
  FHL_TEXT_API_BASE_URL: "https://www.fhl.mom",
  FHL_TEXT_API_DEFAULT_MODEL_ID: "gpt-5.6-sol",
  FHL_TEXT_API_LEGACY_MODEL_ID: "gpt-5.5",
  FHL_TEXT_API_MODEL_ID: "gpt-5.5",
  fetchFHLTextAPIModels: mocks.fetchModels,
  loadFHLTextAPIKey: mocks.loadKey,
  validateFHLTextAPIKey: (value: string) => value.trim(),
  validateFHLTextAPIModelInput: (value: string) => {
    const trimmed = value.trim();
    return trimmed && !/[\u0000-\u001f\u007f]/u.test(trimmed)
      ? { value: trimmed, valid: true, message: "" }
      : { value: trimmed, valid: false, message: "文本模型 ID 不能包含控制字符。" };
  },
}));

vi.mock("../src/state/studioStore", () => ({
  useStudioStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
      ...mocks.state,
      refreshFHLTextAPIConfig: mocks.refresh,
      setFHLTextAPIModelID: mocks.setModel,
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
    mocks.fetchModels.mockClear();
    mocks.loadKey.mockClear();
    mocks.remove.mockClear();
    mocks.setModel.mockClear();
    Object.assign(mocks.state, {
      fhlTextAPIConfigured: false,
      fhlTextAPIModelID: "gpt-5.6-sol",
      fhlTextAPIKeyHint: "",
      fhlTextAPITestStatus: "unconfigured",
      fhlTextAPITestMessage: "",
      proxyMode: "system",
      proxyURL: "",
    });
  });

  it("renders a selectable text model and tests the selected model", async () => {
    render(<FHLTextAPIConfig active />);

    expect(screen.getByText("FHL 文本 API")).toBeInTheDocument();
    expect(screen.getByText("FHL Responses")).toBeInTheDocument();
    expect(screen.getAllByText("gpt-5.6-sol").length).toBeGreaterThan(0);
    expect(mocks.refresh).toHaveBeenCalledOnce();

    const input = screen.getByPlaceholderText("粘贴专用 FHL 文本 API Key");
    expect(input).toHaveAttribute("type", "password");
    fireEvent.change(input, { target: { value: "sk-text-test-value" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并测试文本 API" }));

    await waitFor(() => expect(mocks.saveAndTest).toHaveBeenCalledWith("sk-text-test-value", "gpt-5.6-sol"));
    expect(input).toHaveValue("");
  });

  it("persists built-in and valid custom model choices while blocking invalid custom IDs", async () => {
    render(<FHLTextAPIConfig active />);
    const select = screen.getByTestId("fhl-text-model-select");
    fireEvent.change(select, { target: { value: "gpt-5.5" } });
    expect(mocks.setModel).toHaveBeenCalledWith("gpt-5.5");
    fireEvent.change(select, { target: { value: "" } });
    const custom = screen.getByTestId("fhl-text-custom-model-input");
    fireEvent.change(custom, { target: { value: " custom-model " } });
    expect(mocks.setModel).toHaveBeenLastCalledWith("custom-model");
    fireEvent.change(custom, { target: { value: "\u0000" } });
    expect(screen.getByTestId("fhl-text-model-error")).toHaveTextContent("控制字符");
  });

  it("loads models with the typed key without saving it", async () => {
    render(<FHLTextAPIConfig active />);
    const input = screen.getByPlaceholderText("粘贴专用 FHL 文本 API Key");
    const modelControls = screen.getByTestId("fhl-text-model-controls");
    const fetchButton = screen.getByTestId("fhl-text-fetch-models");
    expect(modelControls).toContainElement(screen.getByTestId("fhl-text-model-select"));
    expect(modelControls).toContainElement(fetchButton);
    expect(fetchButton).toHaveTextContent("拉取模型列表");
    expect(screen.getAllByTestId("fhl-text-fetch-models")).toHaveLength(1);
    fireEvent.change(input, { target: { value: "sk-new-text-key" } });
    fireEvent.click(screen.getByRole("button", { name: "获取 FHL 文本模型" }));

    await waitFor(() => expect(mocks.fetchModels).toHaveBeenCalledWith("sk-new-text-key", {
      proxyMode: "system",
      proxyURL: "",
    }));
    expect(mocks.loadKey).not.toHaveBeenCalled();
    expect(mocks.saveAndTest).not.toHaveBeenCalled();
    expect(screen.getByRole("option", { name: "gpt-5.7" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "gpt-image-2" })).toBeInTheDocument();
    expect(screen.getByTestId("fhl-text-model-list-success")).toHaveTextContent("已获取 3 个模型");
  });

  it("shows a clear error when no text API key is available", async () => {
    mocks.loadKey.mockResolvedValueOnce("");
    render(<FHLTextAPIConfig active />);

    fireEvent.click(screen.getByRole("button", { name: "获取 FHL 文本模型" }));

    expect(await screen.findByTestId("fhl-text-model-list-error")).toHaveTextContent(
      "请先输入或保存 FHL 文本 API Key",
    );
    expect(mocks.fetchModels).not.toHaveBeenCalled();
  });

  it("uses the saved key and preserves a selected model missing from the fetched list", async () => {
    Object.assign(mocks.state, {
      fhlTextAPIConfigured: true,
      fhlTextAPIModelID: "retired-text-model",
      fhlTextAPIKeyHint: "sk-...1234",
    });
    mocks.fetchModels.mockResolvedValueOnce(["gpt-5.7", "gpt-5.6-sol"]);
    render(<FHLTextAPIConfig active />);

    fireEvent.click(screen.getByRole("button", { name: "获取 FHL 文本模型" }));

    await waitFor(() => expect(mocks.loadKey).toHaveBeenCalledOnce());
    expect(mocks.fetchModels).toHaveBeenCalledWith("sk-saved-text-key", {
      proxyMode: "system",
      proxyURL: "",
    });
    const select = screen.getByTestId("fhl-text-model-select");
    expect(select).toHaveValue("retired-text-model");
    expect(screen.getByRole("option", { name: /retired-text-model/ })).toHaveTextContent("当前已保存");
    expect(mocks.setModel).not.toHaveBeenCalled();
  });

  it("keeps the current model when model loading fails", async () => {
    mocks.fetchModels.mockRejectedValueOnce(new Error("上游暂时不可用"));
    render(<FHLTextAPIConfig active />);
    const input = screen.getByPlaceholderText("粘贴专用 FHL 文本 API Key");
    fireEvent.change(input, { target: { value: "sk-new-text-key" } });
    fireEvent.click(screen.getByRole("button", { name: "获取 FHL 文本模型" }));

    expect(await screen.findByTestId("fhl-text-model-list-error")).toHaveTextContent("上游暂时不可用");
    expect(screen.getByTestId("fhl-text-model-select")).toHaveValue("gpt-5.6-sol");
  });

  it("shows a redacted saved key and retained failure state without filling the input", () => {
    Object.assign(mocks.state, {
      fhlTextAPIConfigured: true,
      fhlTextAPIModelID: "gpt-5.5",
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
