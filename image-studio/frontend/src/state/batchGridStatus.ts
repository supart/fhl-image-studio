import type { JobSlotSnapshot } from "../types/domain";

export type BatchPendingStatus =
  | "waiting"
  | "local_queued"
  | "submitting"
  | "queued"
  | "running"
  | "missing"
  | "succeeded_no_image"
  | "cancelled";

export type BatchSlotDisplayStatus = BatchPendingStatus | "failed";

export function displayStatusFromContinuousSlot(slot: JobSlotSnapshot | null | undefined): BatchSlotDisplayStatus {
  if (!slot) return "missing";
  if (slot.status === "queued") return "queued";
  if (slot.status === "running") return "running";
  if (slot.status === "succeeded") return "succeeded_no_image";
  if (slot.status === "cancelled") return "cancelled";
  if (slot.status === "failed" || slot.status === "interrupted") return "failed";
  return "waiting";
}
