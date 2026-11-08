type WorkspaceSelection = {
  id: string;
  currentImageId?: string | null;
  batchResultIds?: readonly string[];
};

export type AndroidCanvasRecoveryState = {
  activeWorkspaceId: string;
  currentImage?: { id: string } | null;
  workspaces: readonly WorkspaceSelection[];
};

type AndroidCanvasRecoveryGuard = {
  workspaceId: string;
  eligibleJobIds: Set<string>;
  expectedCurrentImageId: string | null;
  expectedBatchResultIds: string[];
  expectedActiveCurrentImageId: string | null;
  allowMissingActiveCurrentImage: boolean;
};

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function normalizedJobIds(jobIds: readonly string[]): string[] {
  return [...new Set(jobIds.map((jobId) => jobId.trim()).filter(Boolean))];
}

export class AndroidCanvasRecoveryRegistry {
  private readonly guards = new Map<string, AndroidCanvasRecoveryGuard>();

  markEligible(
    state: AndroidCanvasRecoveryState,
    workspaceId: string,
    jobIds: readonly string[],
    options: { refreshAnchor?: boolean } = {},
  ): void {
    const eligibleJobIds = normalizedJobIds(jobIds);
    if (eligibleJobIds.length === 0) return;
    const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
    if (!workspace) return;

    const existing = this.guards.get(workspaceId);
    if (existing && options.refreshAnchor !== true) {
      for (const jobId of eligibleJobIds) existing.eligibleJobIds.add(jobId);
      return;
    }

    const currentImageId = workspace.currentImageId ?? null;
    const nextEligibleJobIds = new Set(existing?.eligibleJobIds ?? []);
    for (const jobId of eligibleJobIds) nextEligibleJobIds.add(jobId);
    this.guards.set(workspaceId, {
      workspaceId,
      eligibleJobIds: nextEligibleJobIds,
      expectedCurrentImageId: currentImageId,
      expectedBatchResultIds: [...(workspace.batchResultIds ?? [])],
      expectedActiveCurrentImageId: state.activeWorkspaceId === workspaceId
        ? state.currentImage?.id ?? currentImageId
        : currentImageId,
      allowMissingActiveCurrentImage: state.activeWorkspaceId === workspaceId
        && !state.currentImage
        && currentImageId !== null,
    });
  }

  isEligible(jobId: string): boolean {
    const normalizedJobId = jobId.trim();
    if (!normalizedJobId) return false;
    for (const guard of this.guards.values()) {
      if (guard.eligibleJobIds.has(normalizedJobId)) return true;
    }
    return false;
  }

  canUpdate(
    state: AndroidCanvasRecoveryState,
    workspaceId: string,
    jobId: string,
  ): boolean {
    const guard = this.guards.get(workspaceId);
    if (!guard || guard.workspaceId !== workspaceId || !guard.eligibleJobIds.has(jobId)) return false;
    const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
    if (!workspace) return false;
    if ((workspace.currentImageId ?? null) !== guard.expectedCurrentImageId) return false;
    if (!sameIds(workspace.batchResultIds ?? [], guard.expectedBatchResultIds)) return false;
    if (state.activeWorkspaceId !== workspaceId) return true;

    const activeCurrentImageId = state.currentImage?.id ?? null;
    if (activeCurrentImageId === guard.expectedActiveCurrentImageId) return true;
    if (activeCurrentImageId === null && guard.allowMissingActiveCurrentImage) return true;
    if (!activeCurrentImageId?.startsWith("preview-")) return false;
    return guard.eligibleJobIds.has(activeCurrentImageId.slice("preview-".length));
  }

  advance(
    workspaceId: string,
    currentImageId: string | null,
    batchResultIds: readonly string[],
    activeCurrentImageId: string | null,
  ): void {
    const guard = this.guards.get(workspaceId);
    if (!guard) return;
    guard.expectedCurrentImageId = currentImageId;
    guard.expectedBatchResultIds = [...batchResultIds];
    guard.expectedActiveCurrentImageId = activeCurrentImageId;
    guard.allowMissingActiveCurrentImage = false;
  }

  release(jobId: string): void {
    const normalizedJobId = jobId.trim();
    if (!normalizedJobId) return;
    for (const [workspaceId, guard] of this.guards) {
      guard.eligibleJobIds.delete(normalizedJobId);
      if (guard.eligibleJobIds.size === 0) this.guards.delete(workspaceId);
    }
  }
}
