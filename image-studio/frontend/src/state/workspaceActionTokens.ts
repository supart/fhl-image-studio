export type WorkspaceActionKind =
  | "optimize-prompt"
  | "reverse-prompt"
  | "select-source"
  | "select-batch-directory"
  | "select-batch-files"
  | "refresh-batch-directory"
  | "select-batch-output"
  | "import-source"
  | "select-reverse-image"
  | "import-reverse-image"
  | "import-image"
  | "reuse-history-source"
  | "select-batch-result"
  | "select-history-result"
  | "canvas-transform";

export interface WorkspaceActionToken {
  workspaceId: string;
  workspaceEpoch: number;
  operationId: string;
  kind: WorkspaceActionKind;
}

let operationSequence = 0;
const workspaceEpochs = new Map<string, number>();
const activeOperations = new Map<string, Set<string>>();

function operationKey(workspaceId: string, kind: WorkspaceActionKind): string {
  return `${workspaceId}\u0000${kind}`;
}

export function captureWorkspaceAction(
  workspaceId: string,
  kind: WorkspaceActionKind,
  options: { supersede?: boolean } = {},
): WorkspaceActionToken {
  const workspaceEpoch = workspaceEpochs.get(workspaceId) ?? 0;
  const operationId = `${kind}-${++operationSequence}`;
  const key = operationKey(workspaceId, kind);
  const operations = options.supersede ? new Set<string>() : new Set(activeOperations.get(key) ?? []);
  operations.add(operationId);
  activeOperations.set(key, operations);
  return { workspaceId, workspaceEpoch, operationId, kind };
}

export function isWorkspaceActionCurrent(
  token: WorkspaceActionToken,
  knownWorkspaceIds: Iterable<string>,
): boolean {
  if (!new Set(knownWorkspaceIds).has(token.workspaceId)) return false;
  return (workspaceEpochs.get(token.workspaceId) ?? 0) === token.workspaceEpoch
    && activeOperations.get(operationKey(token.workspaceId, token.kind))?.has(token.operationId) === true;
}

export function settleWorkspaceAction(
  token: WorkspaceActionToken,
  knownWorkspaceIds: Iterable<string>,
): boolean {
  if (!isWorkspaceActionCurrent(token, knownWorkspaceIds)) return false;
  const key = operationKey(token.workspaceId, token.kind);
  const operations = activeOperations.get(key);
  operations?.delete(token.operationId);
  if (!operations || operations.size === 0) activeOperations.delete(key);
  return true;
}

export function invalidateWorkspaceActions(workspaceId: string): void {
  workspaceEpochs.set(workspaceId, (workspaceEpochs.get(workspaceId) ?? 0) + 1);
  const prefix = `${workspaceId}\u0000`;
  for (const key of activeOperations.keys()) {
    if (key.startsWith(prefix)) activeOperations.delete(key);
  }
}

export function resetWorkspaceActions(): void {
  workspaceEpochs.clear();
  activeOperations.clear();
  operationSequence = 0;
}
