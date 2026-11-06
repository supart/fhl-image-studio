import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchModels: vi.fn(async () => [
    "gpt-5.7",
    "gpt-image-2.5-flare",
    "gpt-image-2.5-sunburst",
    "gpt-image-2",
  ]),
  getStoredAPIKey: vi.fn(async () => "sk-images-saved"),
  setFHLImageModelID: vi.fn(async () => undefined),
  state: {
    profiles: [{
      id: "fhl-images-slot-1",
      name: "FHL-1 Images",
      apiMode: "images",
      requestPolicy: "openai",
      baseURL: "https://www.fhl.mom",
      textModelID: "",
      imageModelID: "gpt-image-2",
      concurrencyLimit: 5,
      continuousPoolEnabled: true,
      fhlImagesPoolSlot: 1,
      imagesNewAPICompat: true,
      createdAt: 1,
    }],
    imageModelID: "gpt-image-2",
    proxyMode: "system",
    proxyURL: "",
  },
}));

vi.mock("../src/lib/fhlImageAPI.ts", () => ({
  fetchFHLImageAPIModels: mocks.fetchModels,
}));

vi.mock("../src/platform/runtime/host", () => ({
  GetStoredAPIKey: mocks.getStoredAPIKey,
}));

vi.mock("../src/platform/context", () => ({
  usePlatform: () => ({ usesFluentUI: true }),
}));

vi.mock("../src/state/studioStore", () => ({
  useStudioStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    ...mocks.state,
    setFHLImageModelID: mocks.setFHLImageModelID,
  }),
}));

import { FHLImageModelConfig } from "../src/components/panel/FHLImageModelConfig";

describe("FHLImageModelConfig", () => {
  beforeEach(() => {
    cleanup();
    mocks.fetchModels.mockClear();
    mocks.getStoredAPIKey.mockClear();
    mocks.setFHLImageModelID.mockClear();
    mocks.fetchModels.mockResolvedValue([
      "gpt-5.7",
      "gpt-image-2.5-flare",
      "gpt-image-2.5-sunburst",
      "gpt-image-2",
    ]);
    mocks.getStoredAPIKey.mockResolvedValue("sk-images-saved");
    mocks.state.imageModelID = "gpt-image-2";
  });

  it("fetches with a saved Images slot key and shows the complete list in a compact select", async () => {
    render(<FHLImageModelConfig active />);
    fireEvent.click(screen.getByTestId("fhl-image-fetch-models"));

    await waitFor(() => expect(mocks.fetchModels).toHaveBeenCalledWith("sk-images-saved", {
      proxyMode: "system",
      proxyURL: "",
    }));
    expect(mocks.getStoredAPIKey).toHaveBeenCalledOnce();
    const select = screen.getByTestId("fhl-image-model-select");
    expect(select).toHaveValue("gpt-image-2");
    expect(screen.getByRole("option", { name: /gpt-5\.7/ })).toBeDisabled();
    expect(screen.getByRole("option", { name: /gpt-image-2\.5-flare/ })).toBeEnabled();
    expect(screen.getByRole("option", { name: /gpt-5\.7/ })).toHaveTextContent("当前版本不可选");
    expect(screen.getByTestId("fhl-image-model-controls")).toContainElement(select);
    expect(screen.queryByTestId("fhl-image-model-list")).not.toBeInTheDocument();
  });

  it("persists an allowed selection through the global model action", async () => {
    render(<FHLImageModelConfig active />);
    fireEvent.click(screen.getByTestId("fhl-image-fetch-models"));
    const select = await screen.findByTestId("fhl-image-model-select");
    fireEvent.change(select, { target: { value: "gpt-image-2.5-sunburst" } });

    await waitFor(() => expect(mocks.setFHLImageModelID).toHaveBeenCalledWith("gpt-image-2.5-sunburst"));
  });

  it("shows only the saved selection before model discovery", () => {
    render(<FHLImageModelConfig active />);

    const select = screen.getByTestId("fhl-image-model-select");
    expect(select).toHaveValue("gpt-image-2");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByTestId("fhl-image-fetch-models")).toHaveTextContent("拉取模型列表");
  });

  it("requires a saved Images key before model discovery", async () => {
    mocks.getStoredAPIKey.mockResolvedValue("");
    render(<FHLImageModelConfig active />);
    fireEvent.click(screen.getByTestId("fhl-image-fetch-models"));

    expect(await screen.findByText("请先保存至少一个 FHL Images API Key，再拉取生图模型。")).toBeInTheDocument();
    expect(mocks.fetchModels).not.toHaveBeenCalled();
  });
});
