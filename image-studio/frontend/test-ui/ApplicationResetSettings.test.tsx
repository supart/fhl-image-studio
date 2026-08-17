import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reset: vi.fn(async () => ({
    historyEntriesCleared: 3,
    fullHistoryEntriesCleared: 2,
    workspacesReset: 2,
    taskRecordsCleared: 1,
    promptHistoryEntriesCleared: 4,
    presetsCleared: 1,
    materialGroupsCleared: 2,
    localContentEntriesCleared: 6,
    apiConfigurationsPreserved: 5,
    defaultsRestored: ["主题", "字号"],
    warnings: ["磁盘文件未删除。"],
  })),
  state: {
    profiles: [{ id: "one" }, { id: "two" }],
    fhlTextAPIConfigured: true,
    batchTasksById: {} as Record<string, { status: string; launchState?: string }>,
    runningJobMeta: {} as Record<string, unknown>,
    jobGroupsByWorkspace: {} as Record<string, Array<Record<string, unknown>>>,
    isRunning: false,
    runningJobs: [] as string[],
    isTestingKey: false,
    fhlTextAPITestStatus: "saved",
    isOptimizingPrompt: false,
    isReversingPrompt: false,
  },
}));

vi.mock("../src/platform/context", () => ({
  usePlatform: () => ({ usesFluentUI: true, isAndroidPhone: false, usesAppleUI: false }),
}));

vi.mock("../src/state/studioStore", () => ({
  useStudioStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    ...mocks.state,
    resetApplicationStatePreservingAPI: mocks.reset,
  }),
}));

import {
  ApplicationResetConfirmView,
  ApplicationResetSettingsEntry,
} from "../src/components/panel/ApplicationResetSettings";

describe("ApplicationResetSettings", () => {
  beforeEach(() => {
    cleanup();
    mocks.reset.mockClear();
    Object.assign(mocks.state, {
      batchTasksById: {},
      runningJobMeta: {},
      jobGroupsByWorkspace: {},
      isRunning: false,
      runningJobs: [],
      isTestingKey: false,
      fhlTextAPITestStatus: "saved",
      isOptimizingPrompt: false,
      isReversingPrompt: false,
    });
  });

  it("shows the API-preserving entry and locks it for active work", () => {
    const onOpen = vi.fn();
    mocks.state.batchTasksById = { queued: { status: "queued" } };
    render(<ApplicationResetSettingsEntry onOpen={onOpen} />);

    const button = screen.getByRole("button", { name: "恢复默认但保留 API" });
    expect(button).toBeDisabled();
    expect(screen.getByText(/当前有排队、运行、连接测试或提示词任务/)).toBeInTheDocument();
    expect(screen.getByText(/保留 3 项 API 配置及凭据/)).toBeInTheDocument();
    fireEvent.click(button);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("cancels without resetting", () => {
    const onCancel = vi.fn();
    render(
      <ApplicationResetConfirmView
        onCancel={onCancel}
        onComplete={vi.fn()}
        onRunningChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(mocks.reset).not.toHaveBeenCalled();
  });

  it("runs once and reports only a non-sensitive preservation summary", async () => {
    render(
      <ApplicationResetConfirmView
        onCancel={vi.fn()}
        onComplete={vi.fn()}
        onRunningChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "确认恢复默认" }));
    await waitFor(() => expect(mocks.reset).toHaveBeenCalledOnce());
    expect(await screen.findByText(/保留 5 项 API 配置/)).toBeInTheDocument();
    expect(screen.getByText(/API 配置保持不变/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/sk-[A-Za-z0-9]/i);
  });
});
