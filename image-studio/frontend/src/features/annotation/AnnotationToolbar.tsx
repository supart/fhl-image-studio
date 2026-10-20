import {
  ArrowDownRight,
  ArrowRight,
  Circle,
  Eraser,
  Highlighter,
  MousePointer2,
  Minus,
  Pencil,
  Square,
  Type as TypeIcon,
} from "lucide-react";
import { ANNOTATION_COLORS } from "../../types/domain";
import {
  ANNOTATION_FONT_SIZE_MAX,
  ANNOTATION_FONT_SIZE_MIN,
  ANNOTATION_STROKE_WIDTH_MAX,
  ANNOTATION_STROKE_WIDTH_MIN,
  type AnnotationTool,
} from "./annotationTypes";

const toolMeta: Array<{ id: AnnotationTool; label: string; Icon: typeof Square }> = [
  { id: "pointer", label: "指针（选择标注）", Icon: MousePointer2 },
  { id: "arrow", label: "批注箭头", Icon: ArrowDownRight },
  { id: "plainArrow", label: "普通箭头", Icon: ArrowRight },
  { id: "line", label: "直线", Icon: Minus },
  { id: "rect", label: "矩形", Icon: Square },
  { id: "ellipse", label: "椭圆", Icon: Circle },
  { id: "freehand", label: "自由画", Icon: Pencil },
  { id: "highlight", label: "高亮", Icon: Highlighter },
  { id: "text", label: "文字", Icon: TypeIcon },
  { id: "eraser", label: "橡皮擦", Icon: Eraser },
];

export function AnnotationToolbar({
  tool,
  color,
  strokeWidth,
  fontSize,
  onToolChange,
  onColorChange,
  onStrokeWidthChange,
  onFontSizeChange,
  onClear,
  onConfirm,
  disabled = false,
  busy = false,
}: {
  tool: AnnotationTool;
  color: string;
  strokeWidth: number;
  fontSize: number;
  onToolChange: (tool: AnnotationTool) => void;
  onColorChange: (color: string) => void;
  onStrokeWidthChange: (value: number) => void;
  onFontSizeChange: (value: number) => void;
  onClear: () => void;
  onConfirm: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="annotation-toolbar">
      {toolMeta.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          aria-label={label}
          title={label}
          aria-pressed={tool === id}
          disabled={disabled}
          onClick={() => onToolChange(id)}
          style={tool === id ? {
            backgroundColor: "var(--accent-soft)",
            borderColor: "var(--accent)",
            color: "var(--accent)",
            boxShadow: "0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent), 0 1px 3px rgb(0 0 0 / 0.18)",
          } : undefined}
          className={`inline-flex h-7 w-7 items-center justify-center rounded-md border text-xs transition ${tool === id
            ? "border-[color:var(--accent)] bg-[var(--accent-soft)] text-[color:var(--accent)] ring-2 ring-[color:var(--accent)]/35 shadow-sm"
            : "border-transparent text-[var(--muted)] hover:border-[var(--border)] hover:text-[var(--text)]"}`}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
      <span className="mx-1 h-5 w-px bg-black/10 dark:bg-white/10" />
      <div className="flex items-center gap-1" aria-label="标注颜色">
        {ANNOTATION_COLORS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-label={`颜色 ${candidate}`}
            title={`颜色 ${candidate}`}
            disabled={disabled}
            onClick={() => onColorChange(candidate)}
            className={`h-4 w-4 rounded-full ring-1 ring-black/10 transition ${color === candidate ? "ring-2 ring-offset-1 ring-[var(--accent)]" : ""}`}
            style={{ background: candidate }}
          />
        ))}
      </div>
      <label className="ml-1 flex items-center gap-1 text-[11px] text-[var(--muted)]" title="标注描边按图像像素随画布等比缩放">
        <span>标注描边</span>
        <input
          type="range"
          min={ANNOTATION_STROKE_WIDTH_MIN}
          max={ANNOTATION_STROKE_WIDTH_MAX}
          step={1}
          value={strokeWidth}
          disabled={disabled}
          onChange={(event) => onStrokeWidthChange(Number(event.currentTarget.value))}
          className="w-16"
          aria-label="标注描边宽度（图像像素）"
        />
        <span className="min-w-[32px] tabular-nums">{strokeWidth}px</span>
      </label>
      <label className="ml-1 flex items-center gap-1 text-[11px] text-[var(--muted)]" title="标注字体按图像像素随画布等比缩放">
        <span>标注字体</span>
        <input
          type="range"
          min={ANNOTATION_FONT_SIZE_MIN}
          max={ANNOTATION_FONT_SIZE_MAX}
          step={1}
          value={fontSize}
          disabled={disabled}
          onChange={(event) => onFontSizeChange(Number(event.currentTarget.value))}
          className="w-16"
          aria-label="标注字体大小（图像像素）"
        />
        <span className="min-w-[36px] tabular-nums">{fontSize}px</span>
      </label>
      <span
        className="ml-1 inline-flex items-center rounded-md border border-[color:var(--border)] px-1.5 py-1 text-[10px] text-[var(--muted)]"
        title="标注按图像像素随画布等比缩放"
        aria-label="标注按图像像素随画布等比缩放"
      >
        等比锁定
      </span>
      <button type="button" className="ml-1 rounded-md px-2 py-1 text-xs text-[var(--danger)] hover:bg-[var(--danger)]/10" onClick={onClear} disabled={disabled}>
        清空标注
      </button>
      <button
        type="button"
        className="rounded-md border px-2 py-1 text-xs text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
        onClick={onConfirm}
        disabled={disabled}
        aria-label="确认标注并退出工具"
        aria-busy={busy}
        title={busy ? "正在合成标注图，请稍候" : "确认标注并退出工具"}
        style={{
          backgroundColor: "var(--accent)",
          borderColor: "var(--accent)",
          boxShadow: "0 0 0 1px color-mix(in srgb, var(--accent) 24%, transparent), 0 1px 3px rgb(0 0 0 / 0.2)",
        }}
      >
        {busy ? "合成中…" : "确认标注"}
      </button>
      <ArrowRight className="sr-only" />
    </div>
  );
}
