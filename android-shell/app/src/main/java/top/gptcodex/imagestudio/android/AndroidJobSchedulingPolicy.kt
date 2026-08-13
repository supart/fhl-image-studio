package top.fangtangyuan.fhlstudio.android

/**
 * Pure scheduling rules shared by the Android dispatcher and JVM contract tests.
 * The policy deliberately does not know about persistence or HTTP workers.
 */
internal object AndroidJobSchedulingPolicy {
    const val FHL_IMAGES_POOL_SLOT_COUNT = 10
    const val FHL_IMAGES_POOL_SLOT_LIMIT = 4
    const val FHL_IMAGES_POOL_TOTAL_LIMIT = 40
    const val NON_POOL_DEFAULT_LIMIT = 1
    const val NON_POOL_MAX_LIMIT = 2
    const val LEGACY_NON_POOL_LANE_KEY = "__legacy_non_pool__"
    const val MAX_NON_TERMINAL_SLOTS = 200
    const val TERMINAL_GROUP_RETENTION = 500

    data class Candidate(
        val jobId: String,
        val queueSequence: Long,
        val createdAt: Long,
        val fhlImagesPoolSlot: Int?,
        val nonPoolLaneKey: String,
        val nonPoolLimit: Int,
    ) {
        val isFhlImagesPool: Boolean
            get() = fhlImagesPoolSlot != null
    }

    data class Reservation(
        val jobId: String,
        val fhlImagesPoolSlot: Int?,
        val nonPoolLaneKey: String,
        val nonPoolLimit: Int,
    ) {
        val isFhlImagesPool: Boolean
            get() = fhlImagesPoolSlot != null
    }

    data class RegistryQueueSlot(
        val jobId: String,
        val batchIndex: Int,
        val createdAt: Long,
        val queueSequence: Long?,
    )

    data class RegistryQueueMigration(
        val queueSequences: List<Long>,
        val nextQueueSequence: Long,
    )

    data class RegistryRetentionGroup(
        val groupId: String,
        val createdAt: Long,
        val terminal: Boolean,
    )

    fun isValidFhlImagesPoolSlot(slot: Int?): Boolean =
        slot != null && slot in 1..FHL_IMAGES_POOL_SLOT_COUNT

    fun canAcceptNonTerminal(current: Int, incoming: Int): Boolean =
        current >= 0 && incoming >= 0 && current + incoming <= MAX_NON_TERMINAL_SLOTS

    fun normalizedNonPoolLaneKey(apiProfileId: String?): String =
        apiProfileId?.trim()?.takeIf { it.isNotEmpty() } ?: LEGACY_NON_POOL_LANE_KEY

    fun migrateRegistryQueue(
        sourceVersion: Int,
        supportedVersion: Int,
        currentNextQueueSequence: Long,
        slots: List<RegistryQueueSlot>,
    ): RegistryQueueMigration {
        require(sourceVersion <= supportedVersion) {
            "Registry version $sourceVersion is newer than supported version $supportedVersion."
        }
        val orderedIndices = slots.indices.sortedWith(
            compareBy<Int> { slots[it].createdAt }
                .thenBy { slots[it].batchIndex }
                .thenBy { slots[it].jobId },
        )
        val migrated = MutableList(slots.size) { 0L }
        var nextQueueSequence = if (sourceVersion < supportedVersion) {
            1L
        } else {
            maxOf(
                currentNextQueueSequence.coerceAtLeast(1L),
                (slots.mapNotNull { it.queueSequence }.maxOrNull() ?: 0L) + 1L,
            )
        }
        for (index in orderedIndices) {
            val existing = slots[index].queueSequence
            migrated[index] = if (sourceVersion < supportedVersion || existing == null) {
                nextQueueSequence++
            } else {
                existing
            }
        }
        val requiredNext = maxOf(
            nextQueueSequence,
            (migrated.maxOrNull() ?: 0L) + 1L,
        )
        return RegistryQueueMigration(migrated, requiredNext)
    }

    fun terminalGroupIdsToDrop(groups: List<RegistryRetentionGroup>): List<String> {
        val newestTerminalIds = groups.asSequence()
            .filter { it.terminal && it.groupId.isNotBlank() }
            .sortedWith(
                compareByDescending<RegistryRetentionGroup> { it.createdAt }
                    .thenByDescending { it.groupId },
            )
            .take(TERMINAL_GROUP_RETENTION)
            .map { it.groupId }
            .toSet()
        return groups.asSequence()
            .filter { it.terminal && it.groupId.isNotBlank() && it.groupId !in newestTerminalIds }
            .map { it.groupId }
            .toList()
    }

    fun selectNext(
        candidates: List<Candidate>,
        activeReservations: Collection<Reservation>,
    ): Candidate? {
        val ordered = candidates.sortedWith(
            compareBy<Candidate> { it.queueSequence }
                .thenBy { it.createdAt }
                .thenBy { it.jobId },
        )
        val blockedPoolSlots = mutableSetOf<Int>()
        val blockedDirectLanes = mutableSetOf<String>()
        for (candidate in ordered) {
            val poolSlot = candidate.fhlImagesPoolSlot
            if (poolSlot != null) {
                if (poolSlot in blockedPoolSlots) continue
                if (canReserve(candidate, activeReservations)) return candidate
                blockedPoolSlots += poolSlot
                continue
            }
            val laneKey = normalizedNonPoolLaneKey(candidate.nonPoolLaneKey)
            // Each direct profile owns one FIFO lane. A blocked head may not be
            // bypassed inside that lane, while unrelated profiles keep moving.
            if (laneKey in blockedDirectLanes) continue
            if (canReserve(candidate, activeReservations)) return candidate
            blockedDirectLanes += laneKey
        }
        return null
    }

    fun canReserve(
        candidate: Candidate,
        activeReservations: Collection<Reservation>,
    ): Boolean {
        if (candidate.isFhlImagesPool) {
            val poolSlot = candidate.fhlImagesPoolSlot ?: return false
            if (!isValidFhlImagesPoolSlot(poolSlot)) return false
            val poolReservations = activeReservations.filter { it.isFhlImagesPool }
            val slotCount = poolReservations.count { it.fhlImagesPoolSlot == poolSlot }
            return slotCount < FHL_IMAGES_POOL_SLOT_LIMIT &&
                poolReservations.size < FHL_IMAGES_POOL_TOTAL_LIMIT
        }

        val laneKey = normalizedNonPoolLaneKey(candidate.nonPoolLaneKey)
        val directReservations = activeReservations.filter {
            !it.isFhlImagesPool && normalizedNonPoolLaneKey(it.nonPoolLaneKey) == laneKey
        }
        val requestedLimit = candidate.nonPoolLimit.coerceIn(1, NON_POOL_MAX_LIMIT)
        val activeLimit = directReservations.minOfOrNull { it.nonPoolLimit.coerceIn(1, NON_POOL_MAX_LIMIT) }
        val effectiveLimit = minOf(requestedLimit, activeLimit ?: requestedLimit)
        return directReservations.size < effectiveLimit && directReservations.size < NON_POOL_MAX_LIMIT
    }

    fun reservationFor(candidate: Candidate): Reservation = Reservation(
        jobId = candidate.jobId,
        fhlImagesPoolSlot = candidate.fhlImagesPoolSlot?.takeIf(::isValidFhlImagesPoolSlot),
        nonPoolLaneKey = normalizedNonPoolLaneKey(candidate.nonPoolLaneKey),
        nonPoolLimit = candidate.nonPoolLimit.coerceIn(1, NON_POOL_MAX_LIMIT),
    )
}
