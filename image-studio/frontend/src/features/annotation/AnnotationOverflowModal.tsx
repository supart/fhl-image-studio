import { Modal } from "../../components/common/Modal";

export function AnnotationOverflowModal({
  open,
  busy,
  onClose,
  onExpand,
}: {
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onExpand: () => void;
}) {
  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} title="标注超出图像边缘" width={460}>
      <div className="space-y-4 p-4 text-sm text-[var(--text)]">
        <p className="m-0 leading-6 text-[var(--muted)]">
          当前标注有一部分落在原图外。返回调整不会生成文件；也可以扩展画布，超出区域自动使用白色填充。
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)] hover:bg-black/[0.04] disabled:opacity-50 dark:hover:bg-white/[0.06]"
            onClick={onClose}
            disabled={busy}
          >
            返回调整
          </button>
          <button
            type="button"
            className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm text-white hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
            onClick={onExpand}
            disabled={busy}
          >
            {busy ? "正在保存…" : "扩展白底并保存"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
