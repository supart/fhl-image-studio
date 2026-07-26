import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearAll: vi.fn(async () => ({
    credentialsCleared: 5,
    profilesCleared: 3,
    runningHubBridgesCleared: 1,
    localFilesCleared: true,
  })),
  state: {
    profiles: [] as Array<Record<string, unknown>>,
    fhlTextAPIConfigured: false,
    batchTasksById: {} as Record<string, { status: string }>,
    isRunning: false,
    runningJobs: [] as string[],
    isTestingKey: false,
    fhlTextAPITestStatus: "unconfigured",
    isOptimizingPrompt: false,
    isReversingPrompt: false,
  },
}));

vi.mock("../src/platform/context", () => ({
  usePlatform: () => ({ usesFluentUI: true }),
}));

vi.mock("../src/state/studioStore", () => ({
  useStudioStore: Object.assign((selector: (state: Record<string, unknown>) => unknown) => selector({
    ...mocks.state,
    pushToast: vi.fn(),
  }), {
    getState: () => ({ ...mocks.state, pushToast: vi.fn() }),
    setState: vi.fn(),
  }),
}));

vi.mock("../src/lib/apiCredentialClearRuntime", () => ({
  clearAllRuntimeAPIConfigurations: mocks.clearAll,
}));

import { APICredentialLibrary } from "../src/components/panel/APICredentialLibrary";

function profile(id: string, apiMode: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    apiMode,
    requestPolicy: "openai",
    baseURL: "https://example.test",
    textModelID: "",
    imageModelID: "",
    concurrencyLimit: 1,
    createdAt: 1,
    ...overrides,
  };
}

describe("APICredentialLibrary", () => {
  beforeEach(() => {
    cleanup();
    mocks.clearAll.mockClear();
    Object.assign(mocks.state, {
      profiles: [
        profile("FHL-1 Images", "images", {
          baseURL: "https://www.fhl.mom",
          imageModelID: "gpt-image-2",
          fhlImagesPoolSlot: 1,
          fhlImagesPoolKeyHint: "ABCD",
        }),
        profile("APIMart", "apimart"),
        profile("RunningHub", "runninghub"),
      ],
      fhlTextAPIConfigured: true,
      batchTasksById: {},
      isRunning: false,
      runningJobs: [],
      isTestingKey: false,
      fhlTextAPITestStatus: "unconfigured",
      isOptimizingPrompt: false,
      isReversingPrompt: false,
    });
  });

  it("shows one fixed non-secret inventory for every credential source", () => {
    render(<APICredentialLibrary />);

    expect(screen.getByText("本机 API 凭据库")).toBeInTheDocument();
    expect(screen.getByText("1/10")).toBeInTheDocument();
    expect(screen.getAllByText("1 条")).toHaveLength(2);
    expect(screen.getByText(/FHL-1 Images、APIMart、RunningHub/)).toBeInTheDocument();
    expect(screen.queryByText(/sk-/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "一键清空全部 API" })).toBeEnabled();
  });

  it("locks destructive clearing while queued work still owns credentials", () => {
    mocks.state.batchTasksById = { queued: { status: "queued" } };
    render(<APICredentialLibrary />);

    expect(screen.getByRole("button", { name: "一键清空全部 API" })).toBeDisabled();
    expect(screen.getByText(/任务结束后才能清空/)).toBeInTheDocument();
  });

  it("requires confirmation and reports the verified clear result", async () => {
    render(<APICredentialLibrary />);

    fireEvent.click(screen.getByRole("button", { name: "一键清空全部 API" }));
    expect(screen.getByRole("heading", { name: "清空全部 API" })).toBeInTheDocument();
    expect(screen.getByText("此操作不可撤销。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认永久清空" }));

    await waitFor(() => expect(mocks.clearAll).toHaveBeenCalledOnce());
    expect(screen.getByText(/已清空 5 个本地凭据目标、3 条配置记录、1 个 RunningHub 桥接/)).toBeInTheDocument();
  });
});
