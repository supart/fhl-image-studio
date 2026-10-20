import { useEffect, useRef, type FocusEvent } from "react";
import { Check } from "lucide-react";
import {
  ANNOTATION_TEXT_FONT_SIZE,
  ANNOTATION_TEXT_MIN_HEIGHT,
  ANNOTATION_TEXT_MIN_WIDTH,
  ANNOTATION_TEXT_PADDING_X,
  ANNOTATION_TEXT_PADDING_Y,
} from "./annotationTypes";

export function AnnotationTextEditor({
  value,
  x,
  y,
  color,
  fontSize = ANNOTATION_TEXT_FONT_SIZE,
  scale = 1,
  onChange,
  onCommit,
  onBlurCommit,
  onCancel,
}: {
  value: string;
  x: number;
  y: number;
  color: string;
  fontSize?: number;
  scale?: number;
  onChange: (value: string) => void;
  onCommit: () => void;
  onBlurCommit?: (event: FocusEvent<HTMLTextAreaElement>) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const commitLatest = () => {
    const latest = ref.current?.value;
    if (latest !== undefined && latest !== value) onChange(latest);
    onCommit();
  };
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.focus();
    node.select();
  }, []);
  return (
    <div
      data-testid="annotation-text-editor"
      className="annotation-text-editor"
      style={{
        position: "absolute",
        left: x,
        top: y,
        zIndex: 20,
        pointerEvents: "auto",
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <textarea
        ref={ref}
        className="annotation-text-editor-input"
        value={value}
        aria-label="批注文字编辑"
        onChange={(event) => onChange(event.currentTarget.value)}
        onBlur={onBlurCommit ?? onCommit}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            commitLatest();
          }
        }}
        style={{
          // The overlay is outside Konva's transform, so keep its dimensions
          // in CSS pixels while the stage zooms underneath it.
          minWidth: ANNOTATION_TEXT_MIN_WIDTH,
          minHeight: ANNOTATION_TEXT_MIN_HEIGHT,
          color,
          border: `1px solid ${color}`,
          padding: `${ANNOTATION_TEXT_PADDING_Y}px ${ANNOTATION_TEXT_PADDING_X}px`,
          fontSize: Math.max(8, fontSize * Math.max(0.05, scale)),
          lineHeight: 1.2,
          resize: "both",
        }}
      />
      <button
        type="button"
        data-testid="annotation-text-confirm"
        aria-label="确认文字"
        title="确认文字并切换到指针"
        className="inline-flex min-h-[28px] items-center gap-1 rounded-md border border-[var(--accent)] bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-white shadow-sm transition-colors hover:bg-[var(--accent-2)]"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          commitLatest();
        }}
      >
        <Check className="h-3.5 w-3.5" />
        <span>确认文字</span>
      </button>
    </div>
  );
}
