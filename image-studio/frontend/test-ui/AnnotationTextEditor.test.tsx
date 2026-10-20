import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnotationTextEditor } from "../src/features/annotation/AnnotationTextEditor";

describe("AnnotationTextEditor", () => {
  afterEach(() => cleanup());

  it("keeps DOM typography in screen pixels and commits keyboard edits", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const onCancel = vi.fn();

    render(
      <AnnotationTextEditor
        value=""
        x={12}
        y={24}
        color="#ef6b10"
        onChange={onChange}
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "批注文字编辑" });
    expect(editor).toHaveStyle({
      minWidth: "180px",
      minHeight: "42px",
      padding: "4px 6px",
      fontSize: "20px",
    });

    fireEvent.change(editor, { target: { value: "说明" } });
    expect(onChange).toHaveBeenCalledWith("说明");
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    expect(onCommit).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows an in-canvas confirm button and commits it without a blur duplicate", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const onBlurCommit = vi.fn();
    const onCancel = vi.fn();

    render(
      <AnnotationTextEditor
        value="标注说明"
        x={12}
        y={24}
        color="#ef6b10"
        onChange={onChange}
        onCommit={onCommit}
        onBlurCommit={onBlurCommit}
        onCancel={onCancel}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "批注文字编辑" });
    const confirm = screen.getByTestId("annotation-text-confirm");
    expect(confirm).toHaveAccessibleName("确认文字");
    const surface = screen.getByTestId("annotation-text-editor");
    expect(surface).toHaveClass("annotation-text-editor");
    expect(screen.getByRole("textbox", { name: "批注文字编辑" })).toHaveClass("annotation-text-editor-input");
    expect(surface).toContainElement(confirm);

    fireEvent.change(editor, { target: { value: "最新草稿" } });
    fireEvent.blur(editor);
    expect(onBlurCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.mouseDown(confirm);
    fireEvent.click(confirm);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("最新草稿");
  });

  it("can confirm an empty draft without deleting it in the editor layer", () => {
    const onCommit = vi.fn();
    render(
      <AnnotationTextEditor
        value=""
        x={0}
        y={0}
        color="#ef6b10"
        onChange={vi.fn()}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("annotation-text-confirm"));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
