import { useState } from "react";
import { CheckCircle2, Edit3, Loader2, Plus, X } from "lucide-react";
import { Modal } from "../../components/common/Modal";
import { useStudioStore } from "../../state/studioStore";
import type { Workspace } from "../../types/domain";
import { vibrateForPlatform } from "./bridge";

function workspaceSubtitle(workspace: Workspace) {
  const bits = [
    workspace.mode === "edit" ? "图生图" : "文生图",
    workspace.batchCount > 1 ? `${workspace.batchCount} 张` : "单张",
    workspace.sources.length > 0 ? `参考 ${workspace.sources.length}` : "",
    workspace.batchResultIds.length > 0 ? `结果 ${workspace.batchResultIds.length}` : "",
  ].filter(Boolean);
  return bits.join(" · ");
}

export function AndroidWorkspaceSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const {
    activeWorkspaceId,
    closeWorkspace,
    newWorkspace,
    renameWorkspace,
    switchWorkspace,
    workspaces,
  } = useStudioStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const startRename = (workspace: Workspace) => {
    vibrateForPlatform(5);
    setEditingId(workspace.id);
    setEditingName(workspace.name);
  };

  const commitRename = () => {
    if (editingId) renameWorkspace(editingId, editingName.trim() || "未命名");
    setEditingId(null);
  };

  const handleSwitch = (workspaceId: string) => {
    vibrateForPlatform(8);
    switchWorkspace(workspaceId);
    onClose();
  };

  const handleNewWorkspace = () => {
    vibrateForPlatform(10);
    newWorkspace();
    onClose();
  };

  const handleCloseWorkspace = (workspaceId: string) => {
    vibrateForPlatform(12);
    closeWorkspace(workspaceId);
    if (workspaces.length <= 2) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="标签 / 工作区"
      width={560}
      cardClassName="android-workspace-sheet-card"
      bodyClassName="android-workspace-sheet-body"
    >
      <div className="android-workspace-sheet">
        <div className="android-workspace-sheet-summary">
          <strong>{workspaces.length} 个标签</strong>
          <span>每个标签保留独立提示词、参数、参考图、批次和后台任务。</span>
        </div>

        <div className="android-workspace-list">
          {workspaces.map((workspace, index) => {
            const active = workspace.id === activeWorkspaceId;
            const editing = editingId === workspace.id;
            const runningCount = workspace.runningJobIds.length;
            return (
              <section key={workspace.id} className={`android-workspace-item ${active ? "active" : ""}`}>
                <button
                  type="button"
                  className="android-workspace-main"
                  onClick={() => {
                    if (!editing) handleSwitch(workspace.id);
                  }}
                  disabled={editing}
                >
                  <span className="android-workspace-index">{index + 1}</span>
                  <span className="android-workspace-copy">
                    {editing ? (
                      <input
                        value={editingName}
                        autoFocus
                        onChange={(event) => setEditingName(event.currentTarget.value)}
                        onBlur={commitRename}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") commitRename();
                          if (event.key === "Escape") setEditingId(null);
                        }}
                      />
                    ) : (
                      <>
                        <span className="android-workspace-name">{workspace.name}</span>
                        <span className="android-workspace-meta">{workspaceSubtitle(workspace)}</span>
                      </>
                    )}
                  </span>
                  {runningCount > 0 ? (
                    <span className="android-workspace-running">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {runningCount}
                    </span>
                  ) : active ? (
                    <span className="android-workspace-active">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </span>
                  ) : null}
                </button>

                <div className="android-workspace-row-actions">
                  <button type="button" onClick={() => startRename(workspace)} title="重命名标签">
                    <Edit3 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCloseWorkspace(workspace.id)}
                    disabled={workspaces.length <= 1}
                    title={workspaces.length <= 1 ? "至少保留一个标签" : "关闭标签"}
                    className="danger"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </section>
            );
          })}
        </div>

        <button type="button" className="android-workspace-new" onClick={handleNewWorkspace}>
          <Plus className="h-4 w-4" />
          新建标签
        </button>
      </div>
    </Modal>
  );
}
