import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnnotationActionBar } from "../src/features/annotation/AnnotationActionBar";

describe("AnnotationActionBar", () => {
  it("disables unavailable history and deletion actions while keeping confirm and cancel available", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const onDelete = vi.fn();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <AnnotationActionBar
        canUndo={false}
        canRedo={false}
        canDelete={false}
        busy={false}
        onUndo={onUndo}
        onRedo={onRedo}
        onDelete={onDelete}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole("button", { name: "后退（撤销）" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "前进（重做）" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "删除选中标注" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "确认标注" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("disables every action while the composite is busy", () => {
    cleanup();
    render(
      <AnnotationActionBar
        canUndo
        canRedo
        canDelete
        busy
        onUndo={() => undefined}
        onRedo={() => undefined}
        onDelete={() => undefined}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  });
});
