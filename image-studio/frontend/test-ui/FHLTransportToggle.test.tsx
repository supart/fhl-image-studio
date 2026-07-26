import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FHLTransportToggle } from "../src/components/layout/FHLTransportToggle";

describe("FHLTransportToggle", () => {
  it("shows the effective mode and requests a global mode change", () => {
    const onChange = vi.fn();
    const view = render(<FHLTransportToggle mode="images" onChange={onChange} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button).toHaveClass("fhl-transport-option");

    expect(screen.getByRole("button", { name: "切换全部 FHL API 为 Images" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "切换全部 FHL API 为 Responses" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "切换全部 FHL API 为 Responses" }));
    expect(onChange).toHaveBeenCalledWith("responses");

    view.rerender(<FHLTransportToggle mode="responses" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "切换全部 FHL API 为 Responses" })).toHaveAttribute("aria-pressed", "true");
  });
});
