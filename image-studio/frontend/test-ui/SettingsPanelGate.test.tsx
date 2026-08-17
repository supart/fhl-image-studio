import { useEffect, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));

vi.mock("../src/components/panel/SettingsPanel", () => ({
  SettingsPanel: ({ open }: { open: boolean }) => {
    const [detailOpen, setDetailOpen] = useState(false);
    useEffect(() => {
      lifecycle.mounts += 1;
      return () => { lifecycle.unmounts += 1; };
    }, []);
    return (
      <div>
        <span>{open ? "settings-mounted" : "settings-hidden"}</span>
        <button type="button" onClick={() => setDetailOpen(true)}>open-local-view</button>
        {detailOpen ? <span>local-view-open</span> : null}
      </div>
    );
  },
}));

import { SettingsPanelGate } from "../src/app/gates/SettingsPanelGate";

beforeEach(() => {
  cleanup();
  lifecycle.mounts = 0;
  lifecycle.unmounts = 0;
});

it("does not mount while closed and resets child state after reopening", async () => {
  const { rerender } = render(<SettingsPanelGate open={false} onClose={vi.fn()} />);
  expect(screen.queryByText("settings-mounted")).not.toBeInTheDocument();
  expect(lifecycle.mounts).toBe(0);

  rerender(<SettingsPanelGate open onClose={vi.fn()} />);
  expect(await screen.findByText("settings-mounted")).toBeInTheDocument();
  expect(lifecycle.mounts).toBe(1);

  fireEvent.click(screen.getByRole("button", { name: "open-local-view" }));
  expect(screen.getByText("local-view-open")).toBeInTheDocument();

  rerender(<SettingsPanelGate open={false} onClose={vi.fn()} />);
  expect(screen.queryByText("settings-mounted")).not.toBeInTheDocument();
  expect(lifecycle.unmounts).toBe(1);

  rerender(<SettingsPanelGate open onClose={vi.fn()} />);
  expect(await screen.findByText("settings-mounted")).toBeInTheDocument();
  expect(screen.queryByText("local-view-open")).not.toBeInTheDocument();
  expect(lifecycle.mounts).toBe(2);
});
