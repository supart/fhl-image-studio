package top.fangtangyuan.fhlstudio.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONObject
import java.lang.reflect.InvocationTargetException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CancellationException
import java.util.concurrent.ConcurrentHashMap

class AndroidJobManagerPureContractTest {
    @Test
    fun `api mode normalization preserves supported routes`() {
        assertEquals("images", invoke<String>("normalizeAPIMode", " Images "))
        assertEquals("apimart", invoke<String>("normalizeAPIMode", "APIMART"))
        assertEquals("runninghub", invoke<String>("normalizeAPIMode", "RunningHub"))
        assertEquals("responses", invoke<String>("normalizeAPIMode", "responses"))
    }

    @Test
    fun `unknown api mode falls back to responses`() {
        assertEquals("responses", invoke<String>("normalizeAPIMode", ""))
        assertEquals("responses", invoke<String>("normalizeAPIMode", "unsupported-provider"))
    }

    @Test
    fun `new submissions reject unsupported api modes instead of silently routing them`() {
        assertEquals("images", invoke<String>("normalizeSubmissionAPIMode", " Images "))
        assertEquals("responses", invoke<String>("normalizeSubmissionAPIMode", "RESPONSES"))
        assertInvocationThrows<IllegalArgumentException>("normalizeSubmissionAPIMode", "")
        assertInvocationThrows<IllegalArgumentException>("normalizeSubmissionAPIMode", "response")
        assertInvocationThrows<IllegalArgumentException>("normalizeSubmissionAPIMode", "unsupported-provider")
    }

    @Test
    fun `pool slot owns the immutable public api label`() {
        assertEquals("FHL1", invoke<String>("apiLabelForAssignment", "images", "https://www.fhl.mom", "spoofed", 1))
        assertEquals("FHL10", invoke<String>("apiLabelForAssignment", " images ", "https://www.fhl.mom/v1", "FHL", 10))
        assertEquals("FHL7", invoke<String>("apiLabelForAssignment", "responses", "https://www.fhl.mom/v1/", "ignored", 7))
        assertEquals("APIMart", invoke<String>("apiLabelForAssignment", "apimart", "https://www.fhl.mom", " APIMart ", 0))
        assertEquals("FHL", invoke<String>("apiLabelForAssignment", "images", "https://www.fhl.mom", "", 11))
        assertEquals("FHL", invoke<String>("apiLabelForAssignment", "responses", "https://example.test", "FHL7", 7))
        assertEquals("FHL", invoke<String>("apiLabelForAssignment", "responses", "https://example.test", "FHL7 \u00b7 Responses API", 7))
        assertEquals("FHL", invoke<String>("apiLabelForAssignment", "responses", "https://example.test", "FHL7-Images", 7))
        assertEquals("FHL", invoke<String>("apiLabelForAssignment", "responses", "https://example.test", "FHL\u200b7", 7))
        assertEquals("FHL", invoke<String>("apiLabelForAssignment", "responses", "https://example.test", "Vendor FHL-7", 7))
        assertEquals("FHL", invoke<String>("apiLabelForAssignment", "responses", "https://example.test", "F\u200bH-L 7", 7))
        assertEquals("FHL", invoke<String>("apiLabelForAssignment", "responses", "https://example.test", "\uFF26\uFF28\uFF2C\uFF17", 7))
        assertEquals("FHL", invoke<String>("apiLabelForAssignment", "responses", "https://example.test", "F\uFE0FHL7", 7))
        assertEquals("FHL", invoke<String>("apiLabelForAssignment", "responses", "https://example.test", "F\u0301HL7", 7))
        assertEquals("FHL", invoke<String>("apiLabelForAssignment", "responses", "https://example.test", "7LH\u202EF", 7))
        assertEquals("FHL", invoke<String>("apiLabelForAssignment", "responses", "https://example.test", "FHL\u06F7", 7))
    }

    @Test
    fun `pool slots accept only official FHL Images or Responses roots`() {
        assertEquals(1, invoke<Int?>("acceptedFHLPoolSlot", " images ", "https://www.fhl.mom", 1))
        assertEquals(10, invoke<Int?>("acceptedFHLPoolSlot", "responses", "https://www.fhl.mom/v1/", 10))
        assertEquals(4, invoke<Int?>("acceptedFHLPoolSlot", "responses", "https://www.fhl.mom:443/v1", 4))

        for (invalidBaseURL in listOf(
            "http://www.fhl.mom",
            "https://fhl.mom",
            "https://www.fhl.mom.evil.test",
            "https://www.fhl.mom/v1/images",
            "https://www.fhl.mom/v%31",
            "https://www.fhl.mom?redirect=https://evil.test",
            "https://www.fhl.mom/#fragment",
            "https://user@www.fhl.mom",
            "https://www.fhl.mom:444/v1",
        )) {
            assertNull(invoke<Int?>("acceptedFHLPoolSlot", "images", invalidBaseURL, 1))
        }
        assertNull(invoke<Int?>("acceptedFHLPoolSlot", "apimart", "https://www.fhl.mom", 10))
        assertNull(invoke<Int?>("acceptedFHLPoolSlot", "unsupported-provider", "https://www.fhl.mom", 10))
        assertNull(invoke<Int?>("acceptedFHLPoolSlot", "images", "https://www.fhl.mom", 0))
        assertNull(invoke<Int?>("acceptedFHLPoolSlot", "responses", "https://www.fhl.mom", 11))
    }

    @Test
    fun `new official FHL submissions cannot escape the shared pool`() {
        assertEquals(1, invoke<Int?>("validatedNewSubmissionFHLPoolSlot", "images", "https://www.fhl.mom", 1))
        assertEquals(10, invoke<Int?>("validatedNewSubmissionFHLPoolSlot", "responses", "https://www.fhl.mom/v1", 10))
        assertInvocationThrows<IllegalArgumentException>(
            "validatedNewSubmissionFHLPoolSlot",
            "images",
            "https://www.fhl.mom",
            0,
        )
        assertInvocationThrows<IllegalArgumentException>(
            "validatedNewSubmissionFHLPoolSlot",
            "responses",
            "https://www.fhl.mom/v1",
            11,
        )
        assertNull(invoke<Int?>("validatedNewSubmissionFHLPoolSlot", "responses", "https://example.test/v1", 0))
        assertNull(invoke<Int?>("validatedNewSubmissionFHLPoolSlot", "apimart", "https://www.fhl.mom", 0))
    }

    @Test
    fun `versioned OpenAI compatible roots append exactly one v1 segment`() {
        assertEquals("https://www.fhl.mom", invoke<String>("normalizeBaseURL", " https://www.fhl.mom/v1/ "))
        assertEquals("https://example.test/openai", invoke<String>("normalizeBaseURL", "https://example.test/openai/v1"))
        assertEquals("https://www.fhl.mom", invoke<String>("normalizeBaseURL", "https://www.fhl.mom/"))
        assertEquals("https://v1", invoke<String>("normalizeBaseURL", "https://v1"))
    }

    @Test
    fun `persistent payload freezes api mode and excludes credentials`() {
        val source = JSONObject()
            .put("apiMode", " Images ")
            .put("apiKey", "secret-value")
            .put("baseURL", "https://www.fhl.mom/v1")
        val stored = invoke<JSONObject>("payloadForPersistence", source, "group-1")

        assertEquals("images", stored.optString("apiMode"))
        assertEquals("group-1", stored.optString("groupId"))
        assertEquals("https://www.fhl.mom/v1", stored.optString("baseURL"))
        assertFalse(stored.has("apiKey"))
        assertEquals(" Images ", source.optString("apiMode"))
        assertTrue(source.has("apiKey"))
    }

    @Test
    fun `duplicate submissions wake only groups with pending status`() {
        assertTrue(invoke<Boolean>("hasPendingStatus", "queued"))
        assertTrue(invoke<Boolean>("hasPendingStatus", "running"))
        assertTrue(!invoke<Boolean>("hasPendingStatus", "succeeded"))
        assertTrue(!invoke<Boolean>("hasPendingStatus", null as Any?))
    }

    @Test
    fun `registry retention keeps pending work and allows five hundred terminal groups`() {
        assertEquals(200, AndroidJobSchedulingPolicy.MAX_NON_TERMINAL_SLOTS)
        assertEquals(500, AndroidJobSchedulingPolicy.TERMINAL_GROUP_RETENTION)
        assertTrue(AndroidJobSchedulingPolicy.canAcceptNonTerminal(199, 1))
        assertTrue(!AndroidJobSchedulingPolicy.canAcceptNonTerminal(200, 1))
        assertTrue(AndroidJobSchedulingPolicy.canAcceptNonTerminal(198, 2))
        assertFalse(AndroidJobSchedulingPolicy.canAcceptNonTerminal(199, 2))
    }

    @Test
    fun `registry v1 and v2 snapshots migrate deterministically to v3`() {
        for (sourceVersion in listOf(1, 2)) {
            val migration = AndroidJobSchedulingPolicy.migrateRegistryQueue(
                sourceVersion = sourceVersion,
                supportedVersion = 3,
                currentNextQueueSequence = 99L,
                slots = listOf(
                    AndroidJobSchedulingPolicy.RegistryQueueSlot("job-newer", 0, 200L, 88L),
                    AndroidJobSchedulingPolicy.RegistryQueueSlot("job-older-b", 1, 100L, null),
                    AndroidJobSchedulingPolicy.RegistryQueueSlot("job-older-a", 0, 100L, 77L),
                ),
            )

            assertEquals(listOf(3L, 2L, 1L), migration.queueSequences)
            assertEquals(4L, migration.nextQueueSequence)
        }
    }

    @Test
    fun `registry refuses a future schema instead of downgrading it`() {
        var failure: Throwable? = null
        try {
            AndroidJobSchedulingPolicy.migrateRegistryQueue(4, 3, 1L, emptyList())
        } catch (error: IllegalArgumentException) {
            failure = error
        }

        assertTrue(failure is IllegalArgumentException)
    }

    @Test
    fun `terminal retention keeps all active groups and newest five hundred terminals`() {
        val groups = buildList {
            add(AndroidJobSchedulingPolicy.RegistryRetentionGroup("active", 1L, terminal = false))
            repeat(502) { index ->
                add(AndroidJobSchedulingPolicy.RegistryRetentionGroup("terminal-$index", index.toLong(), terminal = true))
            }
        }
        val dropped = AndroidJobSchedulingPolicy.terminalGroupIdsToDrop(groups)
        assertEquals(listOf("terminal-0", "terminal-1"), dropped)
        assertFalse("active" in dropped)
        assertFalse("terminal-501" in dropped)
    }

    @Test
    fun `cancelled running work retains capacity until its worker settles`() {
        val reservation = AndroidJobSchedulingPolicy.Reservation("running", 1, "pool-1", 1)
        val waiting = AndroidJobSchedulingPolicy.Candidate("waiting", 2, 2, 1, "pool-1", 1)
        val active = MutableList(4) { index ->
            if (index == 0) reservation else AndroidJobSchedulingPolicy.Reservation("running-$index", 1, "pool-1", 1)
        }

        assertFalse(AndroidJobSchedulingPolicy.canReserve(waiting, active))
        active.remove(reservation)
        assertTrue(AndroidJobSchedulingPolicy.canReserve(waiting, active))
    }

    @Test
    fun `fhl images scheduling enforces four per slot and forty total`() {
        val reservations = (1..10).flatMap { slot ->
            (1..4).map { index ->
                AndroidJobSchedulingPolicy.Reservation("running-$slot-$index", slot, "pool-$slot", 1)
            }
        }
        val sameSlot = AndroidJobSchedulingPolicy.Candidate("queued-same", 1, 1, 1, "pool-1", 1)
        val otherSlot = AndroidJobSchedulingPolicy.Candidate("queued-other", 2, 2, 2, "pool-2", 1)
        assertTrue(!AndroidJobSchedulingPolicy.canReserve(sameSlot, reservations))
        assertTrue(!AndroidJobSchedulingPolicy.canReserve(otherSlot, reservations))
        assertEquals(null, AndroidJobSchedulingPolicy.selectNext(listOf(sameSlot, otherSlot), reservations))
    }

    @Test
    fun `FHL Responses pool uses four per slot and forty total`() {
        val queued = mutableListOf<AndroidJobSchedulingPolicy.Candidate>()
        var sequence = 1L
        repeat(4) { round ->
            for (slot in 1..10) {
                assertEquals(
                    slot,
                    invoke<Int?>("acceptedFHLPoolSlot", "responses", "https://www.fhl.mom/v1", slot),
                )
                queued += AndroidJobSchedulingPolicy.Candidate(
                    jobId = "responses-$round-$slot",
                    queueSequence = sequence++,
                    createdAt = sequence,
                    fhlImagesPoolSlot = slot,
                    nonPoolLaneKey = "pool-$slot",
                    nonPoolLimit = 1,
                )
            }
        }
        val active = mutableListOf<AndroidJobSchedulingPolicy.Reservation>()
        repeat(40) {
            val next = AndroidJobSchedulingPolicy.selectNext(queued, active)
            assertTrue(next != null)
            queued.remove(next)
            active += AndroidJobSchedulingPolicy.reservationFor(next!!)
        }

        assertTrue(queued.isEmpty())
        assertEquals(40, active.size)
        for (slot in 1..10) {
            assertEquals(4, active.count { it.fhlImagesPoolSlot == slot })
        }
    }

    @Test
    fun `six FHL Responses tasks in one slot run four and queue two`() {
        val acceptedSlot = invoke<Int?>("acceptedFHLPoolSlot", "responses", "https://www.fhl.mom/v1", 3)
        assertEquals(3, acceptedSlot)
        val queued = MutableList(6) { index ->
            AndroidJobSchedulingPolicy.Candidate(
                jobId = "responses-slot-3-$index",
                queueSequence = (index + 1).toLong(),
                createdAt = (index + 1).toLong(),
                fhlImagesPoolSlot = acceptedSlot,
                nonPoolLaneKey = "pool-3",
                nonPoolLimit = 1,
            )
        }
        val active = mutableListOf<AndroidJobSchedulingPolicy.Reservation>()
        repeat(4) {
            val next = AndroidJobSchedulingPolicy.selectNext(queued, active)
            assertTrue(next != null)
            queued.remove(next)
            active += AndroidJobSchedulingPolicy.reservationFor(next!!)
        }

        assertEquals(4, active.size)
        assertEquals(2, queued.size)
        assertNull(AndroidJobSchedulingPolicy.selectNext(queued, active))
    }

    @Test
    fun `sixty FHL Responses tasks run forty and queue twenty`() {
        val queued = mutableListOf<AndroidJobSchedulingPolicy.Candidate>()
        var sequence = 1L
        repeat(6) { round ->
            for (slot in 1..10) {
                val acceptedSlot = invoke<Int?>("acceptedFHLPoolSlot", "responses", "https://www.fhl.mom", slot)
                assertEquals(slot, acceptedSlot)
                queued += AndroidJobSchedulingPolicy.Candidate(
                    jobId = "responses-$round-$slot",
                    queueSequence = sequence++,
                    createdAt = sequence,
                    fhlImagesPoolSlot = acceptedSlot,
                    nonPoolLaneKey = "pool-$slot",
                    nonPoolLimit = 1,
                )
            }
        }
        val active = mutableListOf<AndroidJobSchedulingPolicy.Reservation>()
        repeat(40) {
            val next = AndroidJobSchedulingPolicy.selectNext(queued, active)
            assertTrue(next != null)
            queued.remove(next)
            active += AndroidJobSchedulingPolicy.reservationFor(next!!)
        }

        assertEquals(40, active.size)
        assertEquals(20, queued.size)
        for (slot in 1..10) {
            assertEquals(4, active.count { it.fhlImagesPoolSlot == slot })
            assertEquals(2, queued.count { it.fhlImagesPoolSlot == slot })
        }
        assertNull(AndroidJobSchedulingPolicy.selectNext(queued, active))
    }

    @Test
    fun `mixed FHL Images and Responses share the same four per slot and forty total capacity`() {
        val active = mutableListOf<AndroidJobSchedulingPolicy.Reservation>()
        for (slot in 1..10) {
            repeat(2) { index ->
                assertEquals(
                    slot,
                    invoke<Int?>("acceptedFHLPoolSlot", "images", "https://www.fhl.mom", slot),
                )
                active += AndroidJobSchedulingPolicy.Reservation("images-$slot-$index", slot, "pool-$slot", 1)
            }
            repeat(2) { index ->
                assertEquals(
                    slot,
                    invoke<Int?>("acceptedFHLPoolSlot", "responses", "https://www.fhl.mom/v1", slot),
                )
                active += AndroidJobSchedulingPolicy.Reservation("responses-$slot-$index", slot, "pool-$slot", 1)
            }
        }

        assertEquals(40, active.size)
        assertFalse(
            AndroidJobSchedulingPolicy.canReserve(
                AndroidJobSchedulingPolicy.Candidate("next-images", 41, 41, 1, "pool-1", 1),
                active,
            ),
        )
        assertFalse(
            AndroidJobSchedulingPolicy.canReserve(
                AndroidJobSchedulingPolicy.Candidate("next-responses", 42, 42, 2, "pool-2", 1),
                active,
            ),
        )
    }

    @Test
    fun `FHL Images and Responses share the same per slot capacity`() {
        val slot = 3
        val active = listOf(
            AndroidJobSchedulingPolicy.Reservation("images-1", slot, "pool-$slot", 1),
            AndroidJobSchedulingPolicy.Reservation("images-2", slot, "pool-$slot", 1),
            AndroidJobSchedulingPolicy.Reservation("responses-1", slot, "pool-$slot", 1),
            AndroidJobSchedulingPolicy.Reservation("responses-2", slot, "pool-$slot", 1),
        )
        for (apiMode in listOf("images", "responses")) {
            val acceptedSlot = invoke<Int?>("acceptedFHLPoolSlot", apiMode, "https://www.fhl.mom/v1", slot)
            val candidate = AndroidJobSchedulingPolicy.Candidate(
                jobId = "next-$apiMode",
                queueSequence = 5,
                createdAt = 5,
                fhlImagesPoolSlot = acceptedSlot,
                nonPoolLaneKey = "pool-$slot",
                nonPoolLimit = 1,
            )
            assertEquals(slot, acceptedSlot)
            assertFalse(AndroidJobSchedulingPolicy.canReserve(candidate, active))
        }
    }

    @Test
    fun `non FHL Responses stay outside a full FHL pool`() {
        val activePool = (1..10).flatMap { slot ->
            (1..4).map { index ->
                AndroidJobSchedulingPolicy.Reservation("pool-$slot-$index", slot, "pool-$slot", 1)
            }
        }
        val acceptedSlot = invoke<Int?>("acceptedFHLPoolSlot", "responses", "https://example.test/v1", 1)
        val direct = AndroidJobSchedulingPolicy.Candidate(
            jobId = "direct-responses",
            queueSequence = 41,
            createdAt = 41,
            fhlImagesPoolSlot = acceptedSlot,
            nonPoolLaneKey = "profile-direct",
            nonPoolLimit = 1,
        )

        assertNull(acceptedSlot)
        assertTrue(AndroidJobSchedulingPolicy.canReserve(direct, activePool))
    }

    @Test
    fun `scheduler skips a full slot but preserves FIFO within each slot`() {
        val active = (1..4).map { index ->
            AndroidJobSchedulingPolicy.Reservation("running-$index", 1, "pool-1", 1)
        }
        val candidates = listOf(
            AndroidJobSchedulingPolicy.Candidate("old-full", 1, 1, 1, "pool-1", 1),
            AndroidJobSchedulingPolicy.Candidate("new-full", 2, 2, 1, "pool-1", 1),
            AndroidJobSchedulingPolicy.Candidate("other-slot", 3, 3, 2, "pool-2", 1),
        )
        assertEquals("other-slot", AndroidJobSchedulingPolicy.selectNext(candidates, active)?.jobId)
    }

    @Test
    fun `pool and direct reservations remain independent and direct lanes cap at two`() {
        val active = listOf(
            AndroidJobSchedulingPolicy.Reservation("direct-1", null, "profile-a", 2),
            AndroidJobSchedulingPolicy.Reservation("pool-1", 1, "pool-1", 1),
        )
        val direct = AndroidJobSchedulingPolicy.Candidate("direct-2", 1, 1, null, "profile-a", 2)
        val directThird = AndroidJobSchedulingPolicy.Candidate("direct-3", 2, 2, null, "profile-a", 2)
        val pool = AndroidJobSchedulingPolicy.Candidate("pool-2", 3, 3, 2, "pool-2", 1)
        assertTrue(AndroidJobSchedulingPolicy.canReserve(direct, active))
        assertTrue(!AndroidJobSchedulingPolicy.canReserve(directThird, active + AndroidJobSchedulingPolicy.Reservation("direct-2", null, "profile-a", 2)))
        assertTrue(AndroidJobSchedulingPolicy.canReserve(pool, active))
    }

    @Test
    fun `a blocked direct profile does not block another profile`() {
        val active = listOf(
            AndroidJobSchedulingPolicy.Reservation("running-a", null, "profile-a", 1),
        )
        val candidates = listOf(
            AndroidJobSchedulingPolicy.Candidate("waiting-a", 1, 1, null, "profile-a", 1),
            AndroidJobSchedulingPolicy.Candidate("waiting-b", 2, 2, null, "profile-b", 2),
        )

        assertEquals("waiting-b", AndroidJobSchedulingPolicy.selectNext(candidates, active)?.jobId)
    }

    @Test
    fun `same direct profile preserves FIFO when its head is blocked`() {
        val active = listOf(
            AndroidJobSchedulingPolicy.Reservation("running-a", null, "profile-a", 1),
        )
        val candidates = listOf(
            AndroidJobSchedulingPolicy.Candidate("old-a", 1, 1, null, "profile-a", 1),
            AndroidJobSchedulingPolicy.Candidate("new-a", 2, 2, null, "profile-a", 2),
        )

        assertNull(AndroidJobSchedulingPolicy.selectNext(candidates, active))
    }

    @Test
    fun `each direct profile enforces its own configured limit`() {
        val active = listOf(
            AndroidJobSchedulingPolicy.Reservation("a-1", null, "profile-a", 1),
            AndroidJobSchedulingPolicy.Reservation("b-1", null, "profile-b", 2),
        )
        val nextA = AndroidJobSchedulingPolicy.Candidate("a-2", 1, 1, null, "profile-a", 2)
        val nextB = AndroidJobSchedulingPolicy.Candidate("b-2", 2, 2, null, "profile-b", 2)
        val thirdB = AndroidJobSchedulingPolicy.Candidate("b-3", 3, 3, null, "profile-b", 2)

        assertFalse(AndroidJobSchedulingPolicy.canReserve(nextA, active))
        assertTrue(AndroidJobSchedulingPolicy.canReserve(nextB, active))
        assertFalse(
            AndroidJobSchedulingPolicy.canReserve(
                thirdB,
                active + AndroidJobSchedulingPolicy.Reservation("b-2", null, "profile-b", 2),
            ),
        )
    }

    @Test
    fun `legacy direct jobs share one conservative lane`() {
        assertEquals(
            AndroidJobSchedulingPolicy.LEGACY_NON_POOL_LANE_KEY,
            AndroidJobSchedulingPolicy.normalizedNonPoolLaneKey("  "),
        )
        val active = listOf(
            AndroidJobSchedulingPolicy.Reservation("legacy-running", null, "", 1),
        )
        val candidate = AndroidJobSchedulingPolicy.Candidate("legacy-waiting", 1, 1, null, " ", 2)

        assertFalse(AndroidJobSchedulingPolicy.canReserve(candidate, active))
        assertNull(AndroidJobSchedulingPolicy.selectNext(listOf(candidate), active))
    }

    @Test
    fun `sixty round robin tasks reserve forty and leave twenty queued`() {
        val queued = mutableListOf<AndroidJobSchedulingPolicy.Candidate>()
        var sequence = 1L
        repeat(6) { round ->
            for (slot in 1..10) {
                queued += AndroidJobSchedulingPolicy.Candidate(
                    jobId = "job-$round-$slot",
                    queueSequence = sequence++,
                    createdAt = sequence,
                    fhlImagesPoolSlot = slot,
                    nonPoolLaneKey = "pool-$slot",
                    nonPoolLimit = 1,
                )
            }
        }
        val active = mutableListOf<AndroidJobSchedulingPolicy.Reservation>()
        repeat(40) {
            val next = AndroidJobSchedulingPolicy.selectNext(queued, active)
            assertTrue(next != null)
            queued.remove(next)
            active += AndroidJobSchedulingPolicy.reservationFor(next!!)
        }
        assertEquals(40, active.size)
        assertEquals(20, queued.size)
        for (slot in 1..10) {
            assertEquals(4, active.count { it.fhlImagesPoolSlot == slot })
        }
        assertNull(AndroidJobSchedulingPolicy.selectNext(queued, active))

        active.removeAt(active.indexOfFirst { it.fhlImagesPoolSlot == 1 })
        val refill = AndroidJobSchedulingPolicy.selectNext(queued, active)
        assertEquals(1, refill?.fhlImagesPoolSlot)
        assertEquals("job-4-1", refill?.jobId)
    }

    @Test
    fun `atomic payload artifacts resolve to the same group id`() {
        assertEquals("group-1", invoke<String?>("payloadGroupIdForArtifact", "group-1.json"))
        assertEquals("group-1", invoke<String?>("payloadGroupIdForArtifact", "group-1.json.bak"))
        assertEquals("group-1", invoke<String?>("payloadGroupIdForArtifact", "group-1.json.new"))
        assertNull(invoke<String?>("payloadGroupIdForArtifact", "unrelated.txt"))
    }

    @Test
    fun `paid generation routes allow exactly one submit attempt`() {
        for (apiMode in listOf("images", "responses", "apimart", "runninghub")) {
            assertEquals(1..1, invoke<IntRange>("paidSubmissionAttemptNumbers", apiMode))
        }
    }

    @Test
    fun `only authenticated direct providers require temporary credentials`() {
        for (apiMode in listOf("images", "responses", "apimart")) {
            assertTrue(invoke<Boolean>("apiModeRequiresCredential", apiMode))
        }
        assertTrue(!invoke<Boolean>("apiModeRequiresCredential", "runninghub"))
    }

    @Test
    fun `apimart paid submission uses one configured base without legacy fallback`() {
        assertEquals(
            listOf("https://api.apimart.ai"),
            invoke<List<String>>("apimartSubmissionBaseURLs", "https://api.apimart.ai/v1"),
        )
        assertEquals(
            listOf("https://example.test/custom"),
            invoke<List<String>>("apimartSubmissionBaseURLs", "https://example.test/custom/v1/"),
        )
    }

    @Test
    fun `paid posts never auto follow redirects while query gets may`() {
        assertTrue(!invoke<Boolean>("shouldFollowRedirect", "POST"))
        assertTrue(invoke<Boolean>("shouldFollowRedirect", "GET"))
        assertTrue(!shouldFollowBridgeRedirect("POST"))
        assertTrue(shouldFollowBridgeRedirect("GET"))
        assertTrue(shouldFollowBridgeRedirect("HEAD"))
    }

    @Test
    fun `same process resumes queued work but interrupts orphan running work`() {
        assertEquals(
            "resume",
            recoveryAction(status = "queued", sameProcess = true, activeWorker = false),
        )
        assertEquals(
            "keep",
            recoveryAction(status = "running", sameProcess = true, activeWorker = true),
        )
        assertEquals(
            "interrupt",
            recoveryAction(status = "running", sameProcess = true, activeWorker = false),
        )
        assertEquals(
            "interrupt",
            recoveryAction(status = "queued", sameProcess = true, activeWorker = false, payloadAvailable = false),
        )
    }

    @Test
    fun `new process interrupts direct paid routes`() {
        for (apiMode in listOf("images", "responses", "runninghub")) {
            assertEquals(
                "interrupt",
                recoveryAction(
                    status = "queued",
                    apiMode = apiMode,
                    sameProcess = false,
                    activeWorker = false,
                    taskId = "upstream-task",
                    baseURL = "https://example.test",
                    credentialAvailable = true,
                ),
            )
        }
    }

    @Test
    fun `new process resumes only a fully recoverable apimart query`() {
        assertEquals(
            "resume_apimart_query",
            recoveryAction(
                status = "running",
                apiMode = "apimart",
                sameProcess = false,
                activeWorker = false,
                taskId = "task-123",
                baseURL = "https://api.apimart.ai",
                credentialAvailable = true,
            ),
        )
        assertEquals(
            "interrupt",
            recoveryAction(status = "running", apiMode = "apimart", sameProcess = false, activeWorker = false, taskId = ""),
        )
        assertEquals(
            "interrupt",
            recoveryAction(status = "running", apiMode = "apimart", sameProcess = false, activeWorker = false, baseURL = ""),
        )
        assertEquals(
            "interrupt",
            recoveryAction(status = "running", apiMode = "apimart", sameProcess = false, activeWorker = false, credentialAvailable = false),
        )
        assertEquals(
            "interrupt",
            recoveryAction(status = "running", apiMode = "apimart", sameProcess = false, activeWorker = false, payloadAvailable = false),
        )
        assertEquals(
            "ignore",
            recoveryAction(status = "succeeded", apiMode = "apimart", sameProcess = false, activeWorker = false),
        )
    }

    @Test
    fun `recovery settles requested cancellation before any resume`() {
        assertEquals(
            "cancel",
            recoveryAction(status = "queued", sameProcess = true, activeWorker = false, cancelRequested = true),
        )
        assertEquals(
            "cancel",
            recoveryAction(status = "running", sameProcess = false, activeWorker = false, cancelRequested = true),
        )
        assertEquals(
            "keep",
            recoveryAction(status = "running", sameProcess = true, activeWorker = true, cancelRequested = true),
        )
    }

    @Test
    fun `worker completion and thread rollback both honor cancellation arbitration`() {
        assertEquals("succeeded", invoke<String>("statusAfterCancellationArbitration", "succeeded", false, false))
        assertEquals("cancelled", invoke<String>("statusAfterCancellationArbitration", "succeeded", true, false))
        assertEquals("cancelled", invoke<String>("statusAfterCancellationArbitration", "failed", false, true))
        assertEquals("queued", invoke<String>("statusAfterCancellationArbitration", "queued", false, false))
        assertEquals("cancelled", invoke<String>("statusAfterCancellationArbitration", "queued", true, false))
    }

    @Test
    fun `scheduler restarts only after a normal exit`() {
        assertTrue(invoke<Boolean>("shouldRestartWorker", true, true))
        assertTrue(!invoke<Boolean>("shouldRestartWorker", true, false))
        assertTrue(!invoke<Boolean>("shouldRestartWorker", false, true))
    }

    @Test
    fun `connection registration closes the cancellation race and compare removes`() {
        val cancelledIds = field<MutableSet<String>>("cancelledJobIds")
        val connections = field<ConcurrentHashMap<String, HttpURLConnection>>("activeConnections")
        val cancelledJobId = "cancelled-registration-test"
        val cancelledConnection = FakeHttpURLConnection()
        cancelledIds.add(cancelledJobId)
        try {
            var cancellationThrown = false
            try {
                invokeVoid("registerActiveConnection", cancelledJobId, cancelledConnection)
            } catch (error: InvocationTargetException) {
                cancellationThrown = error.cause is CancellationException
            }
            assertTrue(cancellationThrown)
            assertTrue(cancelledConnection.disconnected)
            assertTrue(!connections.containsKey(cancelledJobId))
        } finally {
            cancelledIds.remove(cancelledJobId)
            connections.remove(cancelledJobId)?.disconnect()
        }

        val replacementJobId = "compare-remove-test"
        val first = FakeHttpURLConnection()
        val replacement = FakeHttpURLConnection()
        try {
            invokeVoid("registerActiveConnection", replacementJobId, first)
            invokeVoid("registerActiveConnection", replacementJobId, replacement)
            invokeVoid("unregisterActiveConnection", replacementJobId, first)
            assertTrue(first.disconnected)
            assertTrue(connections[replacementJobId] === replacement)
        } finally {
            invokeVoid("unregisterActiveConnection", replacementJobId, replacement)
        }
    }

    @Test
    fun `upstream submit attempt audit excludes credentials and prompts`() {
        val audit = invoke<Map<String, Any>>(
            "upstreamSubmitAttemptAuditFields",
            "job-1",
            "group-1",
            "submission-1",
            "run-1",
            "profile-1",
            "images",
            "FHL7",
            7,
        )

        assertEquals("group-1", audit["groupId"])
        assertEquals("job-1", audit["jobId"])
        assertEquals("submission-1", audit["clientSubmissionId"])
        assertEquals("FHL7", audit["apiLabel"])
        assertEquals("images", audit["apiMode"])
        assertTrue(!audit.containsKey("apiKey"))
        assertTrue(!audit.containsKey("prompt"))
        assertTrue(!audit.containsKey("negativePrompt"))
    }

    @Test
    fun `apimart size mapping keeps aspect and resolution contracts`() {
        assertEquals("16:9", invoke<String>("aspectForAPIMartSize", "3840x2160"))
        assertEquals("4k", invoke<String>("resolutionForAPIMartSize", "3840x2160"))
        assertEquals("9:21", invoke<String>("aspectForAPIMartSize", "9:21@2k"))
        assertEquals("2k", invoke<String>("resolutionForAPIMartSize", "9:21@2k"))
    }

    @Test
    fun `runninghub size mapping respects text and image aspect support`() {
        assertEquals(
            "5:4" to "2k",
            invoke<Pair<String, String>>("runningHubAspectAndResolution", "5:4@2k", "text-to-image"),
        )
        assertEquals(
            "1:1" to "1k",
            invoke<Pair<String, String>>("runningHubAspectAndResolution", "5:4@2k", "image-to-image"),
        )
    }

    @Test
    fun `retry size downgrade preserves orientation`() {
        assertEquals("1024x1024", invoke<String>("stableSizeForRetry", "2880x2880"))
        assertEquals("1536x1024", invoke<String>("stableSizeForRetry", "3456x2304"))
        assertEquals("1024x1536", invoke<String>("stableSizeForRetry", "2304x3456"))
        assertEquals("1024x1024", invoke<String>("stableSizeForRetry", ""))
    }

    @Test
    fun `openai size repair returns aligned in-range dimensions`() {
        assertEquals("auto", invoke<String>("repairSizeForOpenAI", "AUTO"))
        val repaired = invoke<String>("repairSizeForOpenAI", "8000x1000")
        val (width, height) = repaired.split('x').map(String::toInt)
        assertEquals(0, width % 16)
        assertEquals(0, height % 16)
        assertTrue(width <= 3840)
        assertTrue(width.toDouble() / height <= 3.0)
        assertTrue(width * height in 655_360..8_294_400)
    }

    @Test
    fun `partial image count is parsed and clamped`() {
        assertEquals(0, invoke<Int>("normalizePartialImages", -4))
        assertEquals(2, invoke<Int>("normalizePartialImages", "2"))
        assertEquals(3, invoke<Int>("normalizePartialImages", 99))
        assertEquals(1, invoke<Int>("normalizePartialImages", "invalid"))
    }

    @Test
    fun `proxy mode normalization is conservative`() {
        assertEquals("none", invoke<String>("normalizeProxyMode", " NONE "))
        assertEquals("custom", invoke<String>("normalizeProxyMode", "CUSTOM"))
        assertEquals("system", invoke<String>("normalizeProxyMode", ""))
        assertEquals("system", invoke<String>("normalizeProxyMode", "unexpected"))
    }

    @Test
    fun `only the current idle worker generation may stop the foreground service`() {
        assertTrue(invoke("shouldInvokeIdleCallback", 7L, 7L, 7L, false, 0))
        assertFalse(invoke("shouldInvokeIdleCallback", 6L, 7L, 7L, false, 0))
        assertFalse(invoke("shouldInvokeIdleCallback", 7L, 7L, 6L, false, 0))
        assertFalse(invoke("shouldInvokeIdleCallback", 7L, 7L, 7L, true, 0))
        assertFalse(invoke("shouldInvokeIdleCallback", 7L, 7L, 7L, false, 1))
    }

    @Test
    fun `batch seed is positive deterministic and slot-specific`() {
        val first = invoke<Long>("seedForRandomBatchSlot", "job-123", 0)
        val repeated = invoke<Long>("seedForRandomBatchSlot", "job-123", 0)
        val nextSlot = invoke<Long>("seedForRandomBatchSlot", "job-123", 1)

        assertTrue(first > 0)
        assertEquals(first, repeated)
        assertNotEquals(first, nextSlot)
    }

    private fun recoveryAction(
        status: String,
        apiMode: String = "images",
        sameProcess: Boolean,
        activeWorker: Boolean,
        cancelRequested: Boolean = false,
        payloadAvailable: Boolean = true,
        taskId: String = "task-123",
        baseURL: String = "https://api.apimart.ai",
        credentialAvailable: Boolean = true,
    ): String = invoke(
        "pendingRecoveryAction",
        status,
        cancelRequested,
        apiMode,
        sameProcess,
        activeWorker,
        payloadAvailable,
        taskId,
        baseURL,
        credentialAvailable,
    )

    @Suppress("UNCHECKED_CAST")
    private fun <T> field(name: String): T {
        val field = AndroidJobManager::class.java.getDeclaredField(name)
        field.isAccessible = true
        return field.get(AndroidJobManager) as T
    }

    private fun invokeVoid(name: String, vararg arguments: Any?) {
        val method = AndroidJobManager::class.java.declaredMethods.single {
            it.name == name && it.parameterCount == arguments.size
        }
        method.isAccessible = true
        method.invoke(AndroidJobManager, *arguments)
    }

    private inline fun <reified T : Throwable> assertInvocationThrows(name: String, vararg arguments: Any?) {
        try {
            invoke<Any?>(name, *arguments)
            throw AssertionError("Expected ${T::class.java.simpleName} from $name")
        } catch (error: InvocationTargetException) {
            assertTrue(
                "Expected ${T::class.java.name}, got ${error.cause?.javaClass?.name}",
                error.cause is T,
            )
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun <T> invoke(name: String, vararg arguments: Any?): T {
        val method = AndroidJobManager::class.java.declaredMethods.single {
            it.name == name && it.parameterCount == arguments.size
        }
        method.isAccessible = true
        return method.invoke(AndroidJobManager, *arguments) as T
    }

    private class FakeHttpURLConnection : HttpURLConnection(URL("https://example.test")) {
        var disconnected = false

        override fun disconnect() {
            disconnected = true
        }

        override fun usingProxy(): Boolean = false

        override fun connect() = Unit
    }
}
