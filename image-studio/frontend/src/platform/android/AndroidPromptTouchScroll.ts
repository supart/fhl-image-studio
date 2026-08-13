import type { TouchEvent } from "react";

type PromptTouchRef = { current: { y: number } | null };

function promptScrollContainerFor(input: HTMLTextAreaElement): HTMLElement | null {
  return input.closest(".android-phone-compose, .android-pad-compose, .control-panel") as HTMLElement | null;
}

export function handlePromptTextareaTouchStart(
  event: TouchEvent<HTMLTextAreaElement>,
  touchRef: PromptTouchRef,
) {
  const touch = event.touches[0];
  if (!touch) return;
  touchRef.current = { y: touch.clientY };
}

export function handlePromptTextareaTouchMove(
  event: TouchEvent<HTMLTextAreaElement>,
  touchRef: PromptTouchRef,
) {
  const touch = event.touches[0];
  const state = touchRef.current;
  if (!touch || !state) return;

  const dy = touch.clientY - state.y;
  if (Math.abs(dy) < 2) return;

  const panel = promptScrollContainerFor(event.currentTarget);
  if (!panel) {
    touchRef.current = { y: touch.clientY };
    return;
  }

  const canScrollUp = panel.scrollTop > 0;
  const canScrollDown = panel.scrollTop + panel.clientHeight < panel.scrollHeight - 1;
  const shouldScrollPanel = (dy > 0 && canScrollUp) || (dy < 0 && canScrollDown);
  if (shouldScrollPanel) {
    event.preventDefault();
    panel.scrollTop -= dy;
  }
  touchRef.current = { y: touch.clientY };
}

export function handlePromptTextareaTouchEnd(touchRef: PromptTouchRef) {
  touchRef.current = null;
}
