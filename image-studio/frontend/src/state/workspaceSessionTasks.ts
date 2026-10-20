import type { BatchTaskRecord, LocalEditRoundtripRef, Workspace } from "../types/domain";

export function storedLocalEditRoundtrip(value: unknown): LocalEditRoundtripRef | undefined {
  if (!value || typeof value !== "object") return undefined;
  const roundtrip = value as Partial<LocalEditRoundtripRef>;
  return roundtrip.kind === "planar" || roundtrip.kind === "panorama"
    ? value as LocalEditRoundtripRef
    : undefined;
}

export function compactWorkspaceSessionTasks(
  workspaces: readonly Pick<Workspace, "id" | "batchTaskIds">[],
  tasksById: Readonly<Record<string, BatchTaskRecord>>,
): Record<string, BatchTaskRecord> {
  const compact: Record<string, BatchTaskRecord> = {};
  for (const workspace of workspaces) {
    for (const taskId of workspace.batchTaskIds ?? []) {
      const task = tasksById[taskId];
      if (!task || task.workspaceId !== workspace.id || compact[taskId]) continue;
      compact[taskId] = {
        ...task,
        sourceImages: undefined,
      };
    }
  }
  return compact;
}
