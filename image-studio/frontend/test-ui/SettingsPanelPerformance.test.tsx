import { Profiler, type ProfilerOnRenderCallback } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/platform/runtime/host", () => ({
  Cancel: vi.fn(async () => undefined),
  EventsOff: vi.fn(),
  GetOutputDir: vi.fn(() => new Promise<string>(() => undefined)),
  OpenOutputDir: vi.fn(async () => undefined),
  OpenExternalURL: vi.fn(async () => undefined),
  ChooseOutputDir: vi.fn(async () => ""),
  SetOutputDir: vi.fn(async () => undefined),
  setKernelRuntimeMode: vi.fn(),
}));

vi.mock("../src/platform", () => ({
  platformOutputRootLabel: () => "output",
}));

vi.mock("../src/platform/android/bridge", () => ({
  androidTarget: { isAndroid: false },
  androidSaveHint: () => "",
  openExternalURLForPlatform: vi.fn(async () => undefined),
  openOutputLocationForPlatform: vi.fn(async () => undefined),
}));

vi.mock("../src/platform/context", () => ({
  usePlatform: () => ({
    isMac: false,
    usesFluentUI: true,
    isAndroid: false,
    isAndroidPad: false,
    isAndroidPhone: false,
    usesAppleUI: false,
  }),
}));

vi.mock("../src/platform/android/settings/AndroidSettingsPanel", () => ({ AndroidSettingsPanel: () => null }));
vi.mock("../src/components/common/Modal", () => ({
  Modal: ({ open, title, children }: { open: boolean; title?: string; children: React.ReactNode }) => (
    open ? <section aria-label={title}>{children}</section> : null
  ),
}));
vi.mock("../src/components/panel/AboutImageStudioModal", () => ({ AboutImageStudioModal: () => null }));
vi.mock("../src/components/panel/FHLAPIChoiceModal", () => ({ FHLAPIChoiceModal: () => null }));
vi.mock("../src/components/panel/APIMartAPIChoiceModal", () => ({ APIMartAPIChoiceModal: () => null }));
vi.mock("../src/components/panel/RunningHubAPIChoiceModal", () => ({ RunningHubAPIChoiceModal: () => null }));
vi.mock("../src/components/panel/FHLQuickConfigModal", () => ({ FHLQuickConfigModal: () => null }));
vi.mock("../src/components/panel/RunningHubQuickConfigModal", () => ({ RunningHubQuickConfigModal: () => null }));

import { SettingsPanel } from "../src/components/panel/SettingsPanel";
import { SettingsPresetsRow } from "../src/components/panel/SettingsPresetsRow";
import { useStudioStore } from "../src/state/studioStore";

function historyItem(id: string, createdAt: number) {
  return {
    id,
    prompt: `prompt-${id}`,
    mode: "generate" as const,
    size: "1024x1024" as const,
    quality: "medium" as const,
    createdAt,
  };
}

function preset(id: string) {
  return {
    id,
    name: `preset-${id}`,
    size: "1024x1024" as const,
    quality: "medium" as const,
    negativePrompt: "",
    batchCount: 1,
  };
}

function renderProfiler(children: React.ReactNode) {
  const commits: string[] = [];
  const onRender: ProfilerOnRenderCallback = (_id, phase) => commits.push(phase);
  render(<Profiler id="settings" onRender={onRender}>{children}</Profiler>);
  commits.length = 0;
  return commits;
}

describe("settings selector performance", () => {
  beforeEach(() => {
    cleanup();
    useStudioStore.setState({
      history: [historyItem("one", 1)],
      presets: [],
      theme: "system",
      jobsCompleted: 0,
      canvasViewResetTick: 0,
    });
  });

  afterEach(() => cleanup());

  it("skips unrelated and same-count history updates but renders relevant changes", () => {
    const commits = renderProfiler(<SettingsPanel open onClose={vi.fn()} />);

    act(() => useStudioStore.setState((state) => ({
      jobsCompleted: state.jobsCompleted + 1,
      canvasViewResetTick: state.canvasViewResetTick + 1,
    })));
    expect(commits).toEqual([]);

    act(() => useStudioStore.setState({ theme: "dark" }));
    expect(commits).toContain("update");
    commits.length = 0;

    act(() => useStudioStore.setState({ history: [historyItem("replacement", 2)] }));
    expect(commits).toEqual([]);

    act(() => useStudioStore.setState({
      history: [historyItem("replacement", 2), historyItem("second", 3)],
    }));
    expect(commits).toContain("update");
  });

  it("keeps the preset row stable until preset data changes", () => {
    const commits = renderProfiler(<SettingsPresetsRow />);

    act(() => useStudioStore.setState((state) => ({
      jobsCompleted: state.jobsCompleted + 1,
      canvasViewResetTick: state.canvasViewResetTick + 1,
    })));
    expect(commits).toEqual([]);

    act(() => useStudioStore.setState({ presets: [preset("one")] }));
    expect(commits).toContain("update");
  });
});
