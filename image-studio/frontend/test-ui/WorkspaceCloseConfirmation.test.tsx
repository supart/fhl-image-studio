import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/platform/context", () => ({
  usePlatform: () => ({ usesFluentUI: true }),
}));

import { WorkspaceCloseConfirmGate } from "../src/app/gates/WorkspaceCloseConfirmGate";
import { WorkspaceTabItem } from "../src/components/layout/WorkspaceTabItem";
import { useStudioStore } from "../src/state/studioStore";
import { createDefaultWorkspace } from "../src/state/workspaceDefaults";
import { workspaceTabStatus } from "../src/state/studioStore.workspaces";

describe("workspace close confirmation and tab status", () => {
  beforeEach(() => {
    const first = createDefaultWorkspace("workspace-a", "png", "标签 A");
    const second = createDefaultWorkspace("workspace-b", "png", "标签 B");
    useStudioStore.setState({
      workspaces: [first, second],
      activeWorkspaceId: first.id,
      workspaceCloseRequest: { workspaceId: first.id, workspaceName: first.name },
      workspaceCanvasRuntime: {},
      workspacePromptOperations: {},
      batchTasksById: {},
      runningJobMeta: {},
      jobGroupsByWorkspace: {},
    });
  });

  afterEach(() => cleanup());

  it("keeps the workspace by default and closes only after explicit confirmation", () => {
    render(<WorkspaceCloseConfirmGate />);
    const keep = screen.getByRole("button", { name: "保留标签并继续" });
    expect(keep).toHaveFocus();
    fireEvent.click(keep);
    expect(useStudioStore.getState().workspaceCloseRequest).toBeNull();
    expect(useStudioStore.getState().workspaces).toHaveLength(2);

    const first = useStudioStore.getState().workspaces[0];
    act(() => useStudioStore.setState({ workspaceCloseRequest: { workspaceId: first.id, workspaceName: first.name } }));
    fireEvent.click(screen.getByRole("button", { name: "取消任务并关闭" }));
    expect(useStudioStore.getState().workspaces.map((workspace) => workspace.id)).toEqual(["workspace-b"]);
  });

  it("announces the prompting status on a workspace tab", () => {
    const workspace = createDefaultWorkspace("workspace-a", "png", "标签 A");
    render(
      <WorkspaceTabItem
        workspace={workspace}
        active
        canClose
        status="prompting"
        editingName=""
        isEditing={false}
        onChangeEditingName={vi.fn()}
        onClose={vi.fn()}
        onCommitRename={vi.fn()}
        onSelect={vi.fn()}
        onStartRename={vi.fn()}
        onStopEditing={vi.fn()}
      />,
    );
    expect(screen.getByRole("tab", { name: "标签 A，提示词处理中" })).toHaveAttribute("data-workspace-status", "prompting");
    expect(screen.getByLabelText("提示词处理中")).toBeInTheDocument();
  });

  it("derives queued, running, prompting, and failed tab states", () => {
    const workspace = useStudioStore.getState().workspaces[0];
    expect(workspaceTabStatus(useStudioStore.getState(), workspace.id)).toBe("idle");

    useStudioStore.setState({
      workspacePromptOperations: { [workspace.id]: { isOptimizingPrompt: true, isReversingPrompt: false } },
    });
    expect(workspaceTabStatus(useStudioStore.getState(), workspace.id)).toBe("prompting");

    useStudioStore.setState({
      workspacePromptOperations: {},
      batchTasksById: { queued: { id: "queued", workspaceId: workspace.id, status: "queued" } as never },
    });
    expect(workspaceTabStatus(useStudioStore.getState(), workspace.id)).toBe("queued");

    useStudioStore.setState({
      batchTasksById: { running: { id: "running", workspaceId: workspace.id, status: "running" } as never },
    });
    expect(workspaceTabStatus(useStudioStore.getState(), workspace.id)).toBe("running");

    useStudioStore.setState({
      batchTasksById: { failed: { id: "failed", workspaceId: workspace.id, status: "failed" } as never },
    });
    expect(workspaceTabStatus(useStudioStore.getState(), workspace.id)).toBe("failed");
  });
});
