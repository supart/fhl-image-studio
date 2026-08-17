import { Modal } from "../../components/common/Modal";
import { usePlatform } from "../../platform/context";
import { useStudioStore } from "../../state/studioStore";

export function WorkspaceCloseConfirmGate() {
  const request = useStudioStore((state) => state.workspaceCloseRequest);
  const cancel = useStudioStore((state) => state.cancelWorkspaceClose);
  const confirm = useStudioStore((state) => state.confirmWorkspaceClose);
  const { usesFluentUI } = usePlatform();

  return (
    <Modal open={request !== null} onClose={cancel} title="关闭正在工作的标签？" width={440}>
      <div className="space-y-4">
        <p className="text-[13px] leading-6 text-zinc-600 dark:text-zinc-300">
          “{request?.workspaceName ?? "当前标签"}”仍有排队、运行、提交中或提示词处理任务。
          关闭后只会取消这个标签的任务，其他标签不受影响。
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={cancel}
            className={`platform-action-btn border border-black/[0.08] px-4 py-2 text-sm text-zinc-700 transition-colors hover:bg-black/[0.04] dark:border-white/[0.08] dark:text-zinc-300 dark:hover:bg-white/[0.06] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
          >
            保留标签并继续
          </button>
          <button
            type="button"
            data-audit-id="confirm-close-active-workspace"
            onClick={confirm}
            className={`platform-action-btn bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
          >
            取消任务并关闭
          </button>
        </div>
      </div>
    </Modal>
  );
}
