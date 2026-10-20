import { Check, Redo2, Trash2, Undo2, X } from "lucide-react";

export type AnnotationActionBarProps = {
  canUndo: boolean;
  canRedo: boolean;
  canDelete: boolean;
  busy: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  onConfirm: () => void;
  onCancel: () => void;
};

function ActionButton({
  label,
  ariaLabel,
  title,
  disabled,
  tone = "default",
  onClick,
  children,
}: {
  label: string;
  ariaLabel?: string;
  title: string;
  disabled?: boolean;
  tone?: "default" | "danger" | "primary";
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`annotation-action-bar-button annotation-action-bar-button-${tone}`}
      aria-label={ariaLabel ?? label}
      title={title}
      disabled={disabled}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

export function AnnotationActionBar({
  canUndo,
  canRedo,
  canDelete,
  busy,
  onUndo,
  onRedo,
  onDelete,
  onConfirm,
  onCancel,
}: AnnotationActionBarProps) {
  return (
    <div
      className="annotation-action-bar"
      role="toolbar"
      aria-label="标注操作"
      data-testid="annotation-action-bar"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <ActionButton
        label="后退（撤销）"
        title="后退（撤销）"
        disabled={busy || !canUndo}
        onClick={onUndo}
      >
        <Undo2 className="annotation-action-bar-icon" />
      </ActionButton>
      <ActionButton
        label="前进（重做）"
        title="前进（重做）"
        disabled={busy || !canRedo}
        onClick={onRedo}
      >
        <Redo2 className="annotation-action-bar-icon" />
      </ActionButton>
      <ActionButton
        label="删除"
        ariaLabel="删除选中标注"
        title={canDelete ? "删除选中标注" : "请先选择一个标注"}
        disabled={busy || !canDelete}
        tone="danger"
        onClick={onDelete}
      >
        <Trash2 className="annotation-action-bar-icon" />
      </ActionButton>
      <ActionButton
        label={busy ? "合成中…" : "确认标注"}
        title={busy ? "正在合成标注图，请稍候" : "确认标注并退出工具"}
        disabled={busy}
        tone="primary"
        onClick={onConfirm}
      >
        <Check className="annotation-action-bar-icon" />
      </ActionButton>
      <ActionButton
        label="取消"
        title="取消本轮标注"
        disabled={busy}
        onClick={onCancel}
      >
        <X className="annotation-action-bar-icon" />
      </ActionButton>
    </div>
  );
}
