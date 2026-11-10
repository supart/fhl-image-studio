import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BackgroundModeSwitch } from "../src/components/panel/BackgroundModeSwitch";

afterEach(cleanup);

describe("BackgroundModeSwitch", () => {
  it("keeps both choices visible and selectable for a supported GPT Image 2.x model", () => {
    const onChange = vi.fn();
    render(<BackgroundModeSwitch value="opaque" onChange={onChange} />);

    const control = screen.getByTestId("background-mode-control");
    expect(control).toHaveAttribute("data-background-supported", "true");
    expect(screen.getByTestId("background-mode-opaque")).toBeEnabled();
    expect(screen.getByTestId("background-mode-transparent")).toBeEnabled();

    fireEvent.click(screen.getByTestId("background-mode-transparent"));
    expect(onChange).toHaveBeenCalledWith("transparent");
  });

  it("keeps both choices visible but disables them for opaque-only or unknown models", () => {
    const onChange = vi.fn();
    render(<BackgroundModeSwitch value="opaque" onChange={onChange} disabled />);

    const control = screen.getByTestId("background-mode-control");
    expect(control).toHaveAttribute("data-background-supported", "false");
    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("background-mode-opaque")).toBeDisabled();
    expect(screen.getByTestId("background-mode-transparent")).toBeDisabled();
    expect(screen.getByText("当前模型不支持或未确认透明背景，已固定为普通图像。")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
