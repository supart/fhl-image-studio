export type ContinuousPoolProfile = Readonly<{
  id: string;
  apiMode: string;
  continuousPoolEnabled?: boolean;
  concurrencyLimit: number;
}>;

export type ContinuousPoolInFlightCounts = Readonly<Record<string, number | undefined>>;

export type ContinuousPoolSelection<TProfile extends ContinuousPoolProfile> = Readonly<{
  profile: TProfile | null;
  nextCursor: number;
}>;

export type ContinuousPoolWaveTask = Readonly<{
  id: string;
  apiProfileId?: string;
}>;

export type ContinuousPoolWaveAssignment<
  TTask extends ContinuousPoolWaveTask,
  TProfile extends ContinuousPoolProfile,
> = Readonly<{
  task: TTask;
  profile: TProfile;
}>;

export type ContinuousPoolWavePlan<
  TTask extends ContinuousPoolWaveTask,
  TProfile extends ContinuousPoolProfile,
> = Readonly<{
  assignments: readonly ContinuousPoolWaveAssignment<TTask, TProfile>[];
  nextCursor: number;
  inFlightByProfileId: ContinuousPoolInFlightCounts;
}>;

function nonNegativeInteger(value: number): number {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? Math.max(0, Math.floor(normalized)) : 0;
}

function normalizeCursor(cursor: number, profileCount: number): number {
  if (profileCount <= 0) return 0;
  return nonNegativeInteger(cursor) % profileCount;
}

/**
 * Picks the next caller-approved pool profile with capacity. The caller owns
 * provider filtering so an FHL Images slot can keep its stored metadata while
 * a newly assigned task snapshots either Images or Responses transport.
 * `cursor` points to the first profile checked on this call; `nextCursor`
 * points after a selected profile.
 */
export function selectNextContinuousPoolProfile<TProfile extends ContinuousPoolProfile>(
  profiles: readonly TProfile[],
  inFlightByProfileId: ContinuousPoolInFlightCounts,
  cursor = 0,
): ContinuousPoolSelection<TProfile> {
  const profileCount = profiles.length;
  const startCursor = normalizeCursor(cursor, profileCount);

  for (let offset = 0; offset < profileCount; offset += 1) {
    const profileIndex = (startCursor + offset) % profileCount;
    const profile = profiles[profileIndex];
    if (profile.continuousPoolEnabled !== true) continue;

    const concurrencyLimit = nonNegativeInteger(profile.concurrencyLimit);
    const inFlight = nonNegativeInteger(inFlightByProfileId[profile.id] ?? 0);
    if (concurrencyLimit > 0 && inFlight >= concurrencyLimit) continue;

    return {
      profile,
      nextCursor: (profileIndex + 1) % profileCount,
    };
  }

  return {
    profile: null,
    nextCursor: startCursor,
  };
}

/**
 * Reserves every currently available pool slot in one deterministic pass.
 * Tasks already pinned to a profile keep that assignment; unassigned tasks
 * consume capacity in round-robin order.
 */
export function planContinuousPoolWave<
  TTask extends ContinuousPoolWaveTask,
  TProfile extends ContinuousPoolProfile,
>(
  tasks: readonly TTask[],
  profiles: readonly TProfile[],
  inFlightByProfileId: ContinuousPoolInFlightCounts,
  cursor = 0,
  totalLimit = Number.POSITIVE_INFINITY,
): ContinuousPoolWavePlan<TTask, TProfile> {
  const counts: Record<string, number> = {};
  for (const profile of profiles) {
    counts[profile.id] = nonNegativeInteger(inFlightByProfileId[profile.id] ?? 0);
  }
  const finiteTotalLimit = Number.isFinite(totalLimit)
    ? nonNegativeInteger(totalLimit)
    : Number.POSITIVE_INFINITY;
  let totalInFlight = Object.values(counts).reduce((sum, value) => sum + value, 0);
  let nextCursor = normalizeCursor(cursor, profiles.length);
  const assignments: ContinuousPoolWaveAssignment<TTask, TProfile>[] = [];

  for (const task of tasks) {
    if (totalInFlight >= finiteTotalLimit) break;
    const assignedProfileId = String(task.apiProfileId || "").trim();
    let profile: TProfile | null = null;

    if (assignedProfileId) {
      profile = profiles.find((entry) => (
        entry.id === assignedProfileId
        && entry.continuousPoolEnabled === true
        && (
          nonNegativeInteger(entry.concurrencyLimit) === 0
          || (counts[entry.id] ?? 0) < nonNegativeInteger(entry.concurrencyLimit)
        )
      )) ?? null;
    } else {
      const selection = selectNextContinuousPoolProfile(profiles, counts, nextCursor);
      profile = selection.profile;
      nextCursor = selection.nextCursor;
    }

    if (!profile) continue;
    assignments.push({ task, profile });
    counts[profile.id] = (counts[profile.id] ?? 0) + 1;
    totalInFlight += 1;
  }

  return {
    assignments,
    nextCursor,
    inFlightByProfileId: counts,
  };
}

export function selectNextFailoverPoolProfile<TProfile extends ContinuousPoolProfile>(
  profiles: readonly TProfile[],
  currentProfileId: string,
): TProfile | null {
  // Callers pass effective-capacity projections, where 0 means temporarily unavailable.
  if (profiles.length < 2) return null;
  const currentIndex = profiles.findIndex((profile) => profile.id === currentProfileId);
  const startIndex = currentIndex >= 0 ? (currentIndex + 1) % profiles.length : 0;

  for (let offset = 0; offset < profiles.length; offset += 1) {
    const profile = profiles[(startIndex + offset) % profiles.length];
    if (profile.id === currentProfileId) continue;
    if (profile.continuousPoolEnabled !== true) continue;
    if (nonNegativeInteger(profile.concurrencyLimit) <= 0) continue;
    return profile;
  }
  return null;
}
