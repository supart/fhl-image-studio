import {
  FHL_IMAGES_POOL_SLOT_COUNT,
  isOfficialFHLPoolProfile,
  mapFHLImagesProfilesToPoolSlots,
  normalizeFHLImagesPoolSlot,
} from "../lib/profiles.ts";
import type { UpstreamProfile } from "../types/domain.ts";

export class AndroidSubmissionCoordinator {
  private readonly flights = new Map<string, Promise<unknown>>();
  private queue: Promise<void> = Promise.resolve();

  run<T>(workspaceId: string, work: () => Promise<T>): Promise<T> {
    const existing = this.flights.get(workspaceId) as Promise<T> | undefined;
    if (existing) return existing;

    const scheduled = this.queue.then(work, work);
    this.queue = scheduled.then(() => undefined, () => undefined);
    let flight: Promise<T>;
    flight = scheduled.finally(() => {
      if (this.flights.get(workspaceId) === flight) this.flights.delete(workspaceId);
    });
    this.flights.set(workspaceId, flight);
    return flight;
  }
}

export function shouldUseAndroidFHLImagesPool(
  isAndroid: boolean,
  continuousGenerate: boolean,
  activeProfile: UpstreamProfile | undefined,
): boolean {
  return isAndroid
    && continuousGenerate
    && !!activeProfile
    && isOfficialFHLPoolProfile(activeProfile);
}

export function orderedFHLImagesPoolCandidates(
  profiles: readonly UpstreamProfile[],
  nextSlot: unknown,
): UpstreamProfile[] {
  const slots = mapFHLImagesProfilesToPoolSlots(profiles);
  const start = normalizeFHLImagesPoolSlot(nextSlot) ?? 1;
  const ordered: UpstreamProfile[] = [];
  for (let offset = 0; offset < FHL_IMAGES_POOL_SLOT_COUNT; offset += 1) {
    const index = (start - 1 + offset) % FHL_IMAGES_POOL_SLOT_COUNT;
    const profile = slots[index];
    if (profile && profile.continuousPoolEnabled !== false) ordered.push(profile);
  }
  return ordered;
}

export function nextFHLImagesPoolCursor(slot: unknown): number {
  const normalized = normalizeFHLImagesPoolSlot(slot) ?? 1;
  return normalized >= FHL_IMAGES_POOL_SLOT_COUNT ? 1 : normalized + 1;
}
