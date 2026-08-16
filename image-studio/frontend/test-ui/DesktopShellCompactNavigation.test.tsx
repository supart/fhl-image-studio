import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/components/panel/ControlPanel", () => ({
  ControlPanel: () => <div data-testid="compose-pane" />,
}));
vi.mock("../src/components/canvas/Toolbar", () => ({ Toolbar: () => null }));
vi.mock("../src/components/canvas/SourceStrip", () => ({ SourceStrip: () => null }));
vi.mock("../src/components/canvas/CanvasStage", () => ({ CanvasStage: () => null }));
vi.mock("../src/components/canvas/StatusBar", () => ({ StatusBar: () => null }));
vi.mock("../src/components/history/HistoryRail", () => ({
  HistoryRail: () => <div data-testid="history-pane" />,
}));

import { DesktopShell } from "../src/platform/desktop/DesktopShell";

describe("DesktopShell compact navigation", () => {
  afterEach(() => cleanup());

  it("switches the compact workspace pane with pressed-state feedback", () => {
    const { container } = render(<DesktopShell fullscreen={false} />);
    const studio = container.querySelector(".studio");

    expect(studio).toHaveAttribute("data-compact-pane", "compose");
    expect(screen.getByRole("button", { name: "创作" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "画布" }));
    expect(studio).toHaveAttribute("data-compact-pane", "canvas");
    expect(screen.getByRole("button", { name: "画布" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "历史" }));
    expect(studio).toHaveAttribute("data-compact-pane", "history");
    expect(screen.getByRole("button", { name: "历史" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "画布" })).toHaveAttribute("aria-pressed", "false");
  });
});
