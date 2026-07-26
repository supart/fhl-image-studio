export type BatchGridDisplaySlotLike = {
  type: "result" | "preview" | "failed" | "pending";
  status?: string;
};

export type BatchGridDisplayEntry<T extends BatchGridDisplaySlotLike> = {
  slot: T;
  originalIndex: number;
  recentSuccessUntil?: number;
};

export const RECENT_BATCH_SUCCESS_PIN_MS = 5_000;

function pendingStatusDisplayRank(status: string | undefined) {
  if (status === "running" || status === "submitting") return 0;
  if (status === "queued" || status === "local_queued" || status === "waiting" || !status) return 1;
  if (status === "succeeded_no_image") return 2;
  if (status === "cancelled") return 4;
  if (status === "missing") return 5;
  return 5;
}

export function batchGridSlotDisplayRank(slot: BatchGridDisplaySlotLike) {
  if (slot.type === "preview") return 0;
  if (slot.type === "pending") return pendingStatusDisplayRank(slot.status);
  if (slot.type === "failed") return 2;
  return 3;
}

export function sortBatchGridSlotsForDisplay<T extends BatchGridDisplaySlotLike>(
  entries: Array<BatchGridDisplayEntry<T>>,
  preserveSlotOrder: boolean,
  now = Date.now(),
) {
  const indexDirection = preserveSlotOrder ? 1 : -1;
  return [...entries].sort((a, b) => {
    const aRecentSuccess = a.slot.type === "result" && Number(a.recentSuccessUntil || 0) > now;
    const bRecentSuccess = b.slot.type === "result" && Number(b.recentSuccessUntil || 0) > now;
    if (aRecentSuccess !== bRecentSuccess) return aRecentSuccess ? -1 : 1;
    if (aRecentSuccess && bRecentSuccess) {
      const completionOrder = Number(b.recentSuccessUntil || 0) - Number(a.recentSuccessUntil || 0);
      if (completionOrder !== 0) return completionOrder;
    }
    return batchGridSlotDisplayRank(a.slot) - batchGridSlotDisplayRank(b.slot)
      || (a.originalIndex - b.originalIndex) * indexDirection;
  });
}
