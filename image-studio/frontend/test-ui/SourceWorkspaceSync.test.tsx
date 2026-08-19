import { beforeEach, describe, expect, it } from "vitest";

import { useStudioStore } from "../src/state/studioStore.ts";
import { createDefaultWorkspace } from "../src/state/workspaceDefaults.ts";
import type { SourceImage } from "../src/types/domain.ts";

function source(path: string, width = 1200, height = 800): SourceImage {
  return { path, name: `${path}.png`, size: 1, width, height };
}

function installWorkspace(sources: SourceImage[], autoAspectResolution = "") {
  const base = createDefaultWorkspace("workspace-source-sync", "png", "Source sync");
  const workspace = {
    ...base,
    mode: "edit" as const,
    sources,
    batchProcess: {
      ...base.batchProcess,
      autoAspectResolution,
    },
  };
  useStudioStore.setState({
    workspaces: [workspace],
    activeWorkspaceId: workspace.id,
    mode: workspace.mode,
    editSourceMode: workspace.editSourceMode,
    sources,
    batchProcess: workspace.batchProcess,
    size: workspace.size,
    editAutoAspectUserLocked: false,
    currentImage: null,
  });
}

function paths(value: SourceImage[] | undefined) {
  return (value ?? []).map((item) => item.path);
}

describe("reference source workspace synchronization", () => {
  beforeEach(() => {
    installWorkspace([source("I:/input/first.png"), source("I:/input/second.png")]);
  });

  it("persists removal in the active workspace while keeping edit mode", () => {
    useStudioStore.getState().removeSource(0);

    const state = useStudioStore.getState();
    expect(paths(state.sources)).toEqual(["I:/input/second.png"]);
    expect(paths(state.workspaces[0]?.sources)).toEqual(["I:/input/second.png"]);
    expect(state.mode).toBe("edit");
  });

  it("keeps clear and reorder operations mirrored in the workspace", () => {
    useStudioStore.getState().reorderSources(0, 1);
    expect(paths(useStudioStore.getState().sources)).toEqual([
      "I:/input/second.png",
      "I:/input/first.png",
    ]);
    expect(paths(useStudioStore.getState().workspaces[0]?.sources)).toEqual([
      "I:/input/second.png",
      "I:/input/first.png",
    ]);

    useStudioStore.getState().clearSources();
    const state = useStudioStore.getState();
    expect(state.sources).toEqual([]);
    expect(state.workspaces[0]?.sources).toEqual([]);
    expect(state.mode).toBe("edit");
  });

  it("does not resurrect a removed source when resolution changes", async () => {
    installWorkspace([
      source("I:/input/first.png"),
      source("I:/input/second.png"),
    ], "1k");
    useStudioStore.getState().removeSource(0);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const workspace = useStudioStore.getState().workspaces[0]!;
    useStudioStore.getState().setField("batchProcess", {
      ...workspace.batchProcess,
      autoAspectResolution: "2k",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const state = useStudioStore.getState();
    expect(paths(state.sources)).toEqual(["I:/input/second.png"]);
    expect(paths(state.workspaces[0]?.sources)).toEqual(["I:/input/second.png"]);
  });
});
