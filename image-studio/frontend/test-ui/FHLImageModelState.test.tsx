import { beforeEach, describe, expect, it } from "vitest";

import { useStudioStore } from "../src/state/studioStore.ts";
import { createDefaultWorkspace } from "../src/state/workspaceDefaults.ts";
import { supportsTransparentBackground } from "../src/lib/fhlImageModels.ts";

const officialProfiles = [
  {
    id: "fhl-images-1",
    name: "FHL Images 1",
    apiMode: "images" as const,
    requestPolicy: "openai" as const,
    baseURL: "https://www.fhl.mom",
    textModelID: "",
    imageModelID: "gpt-image-2.5-flare",
    imageModelSelectionStatus: "selected" as const,
    concurrencyLimit: 5,
    fhlImagesPoolSlot: 1,
    imagesNewAPICompat: true,
    createdAt: 1,
  },
  {
    id: "fhl-responses-1",
    name: "FHL Responses 1",
    apiMode: "responses" as const,
    requestPolicy: "openai" as const,
    baseURL: "https://www.fhl.mom",
    textModelID: "gpt-5.5",
    imageModelID: "gpt-image-2.5-flare",
    imageModelSelectionStatus: "selected" as const,
    concurrencyLimit: 5,
    createdAt: 2,
  },
];

const customProfile = {
  id: "custom-images",
  name: "Custom Images",
  apiMode: "images" as const,
  requestPolicy: "openai" as const,
  baseURL: "https://images.example.test",
  textModelID: "",
  imageModelID: "custom-image-model",
  concurrencyLimit: 1,
  createdAt: 3,
};

describe("FHL image model state", () => {
  beforeEach(() => {
    const workspace = {
      ...createDefaultWorkspace("model-state", "webp"),
      backgroundMode: "transparent" as const,
      outputFormat: "png" as const,
    };
    useStudioStore.setState({
      profiles: [...officialProfiles, customProfile],
      activeProfileId: officialProfiles[0].id,
      imageModelID: "gpt-image-2.5-flare",
      backgroundMode: "transparent",
      outputFormat: "png",
      workspaces: [workspace],
      activeWorkspaceId: workspace.id,
    });
  });

  it("forces PNG when transparent output is selected", () => {
    useStudioStore.setState({ outputFormat: "webp", backgroundMode: "opaque" });
    useStudioStore.getState().setField("backgroundMode", "transparent");
    expect(useStudioStore.getState().backgroundMode).toBe("transparent");
    expect(useStudioStore.getState().outputFormat).toBe("png");
  });

  it("updates every official FHL profile and resets transparency for gpt-image-2", async () => {
    await useStudioStore.getState().setFHLImageModelID("gpt-image-2");
    const state = useStudioStore.getState();
    expect(state.imageModelID).toBe("gpt-image-2");
    expect(state.backgroundMode).toBe("opaque");
    expect(state.workspaces[0].backgroundMode).toBe("opaque");
    expect(state.profiles
      .filter((profile) => profile.baseURL === "https://www.fhl.mom")
      .every((profile) => profile.imageModelID === "gpt-image-2"))
      .toBe(true);
    expect(state.profiles.find((profile) => profile.id === customProfile.id)?.imageModelID)
      .toBe("custom-image-model");
  });

  it("accepts a newly published or grey upstream model without a client allowlist", async () => {
    await useStudioStore.getState().setFHLImageModelID("gpt-image-2.6-sunburst");
    expect(useStudioStore.getState().imageModelID).toBe("gpt-image-2.6-sunburst");
    expect(useStudioStore.getState().backgroundMode).toBe("transparent");
  });

  it("allows transparent output for future GPT Image 2.x models but not exact 2.0", () => {
    expect(supportsTransparentBackground("gpt-image-2")).toBe(false);
    expect(supportsTransparentBackground("gpt-image-2.6-sunburst")).toBe(true);
    expect(supportsTransparentBackground("gpt-image-2-preview")).toBe(true);
    expect(supportsTransparentBackground("gpt-image-20")).toBe(false);
    expect(supportsTransparentBackground("custom-image-model")).toBe(false);
  });

  it("keeps a transparent workspace when switching between supported 2.x models", async () => {
    await useStudioStore.getState().setFHLImageModelID("gpt-image-2.6-sunburst");
    useStudioStore.getState().setField("backgroundMode", "transparent");
    expect(useStudioStore.getState().backgroundMode).toBe("transparent");
    await useStudioStore.getState().setFHLImageModelID("gpt-image-2.7-preview");
    expect(useStudioStore.getState().backgroundMode).toBe("transparent");
    expect(useStudioStore.getState().workspaces[0].backgroundMode).toBe("transparent");
  });

  it("still requires a non-empty FHL image model", async () => {
    await expect(useStudioStore.getState().setFHLImageModelID(""))
      .rejects.toThrow("请先在 FHL API 配置中拉取并选择生图模型");
  });
});
