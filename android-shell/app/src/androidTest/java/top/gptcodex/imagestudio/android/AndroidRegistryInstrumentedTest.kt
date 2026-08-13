package top.fangtangyuan.fhlstudio.android

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.lang.reflect.InvocationTargetException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidRegistryInstrumentedTest {
    @Test
    fun processAuditStartsWithAuthenticatedSentinel() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val auditFile = File(context.filesDir, "jobs/android-job-audit.v1.jsonl")
        val originalBytes = if (auditFile.isFile) auditFile.readBytes() else null
        val started = field<AtomicBoolean>("processAuditStarted")
        val sequence = field<AtomicLong>("auditSequence")
        val originalStarted = started.get()
        val originalSequence = sequence.get()

        try {
            auditFile.delete()
            started.set(false)
            sequence.set(0L)
            AndroidJobManager.resumePendingWork(context)

            val records = auditFile.readLines(Charsets.UTF_8).filter(String::isNotBlank).map(::JSONObject)
            assertTrue(records.isNotEmpty())
            assertEquals("process_started", records.first().getString("type"))
            assertEquals(1L, records.first().getLong("auditSequence"))
            assertEquals(3, records.first().getJSONObject("details").getInt("registryVersion"))
        } finally {
            started.set(originalStarted)
            sequence.set(originalSequence)
            if (originalBytes == null) {
                auditFile.delete()
            } else {
                auditFile.parentFile?.mkdirs()
                auditFile.writeBytes(originalBytes)
            }
        }
    }

    @Test
    fun v1AndV2SnapshotsMigrateToV3WithoutChangingTerminalStates() {
        for (sourceVersion in listOf(1, 2)) {
            val newer = slot("job-newer", 200L, 0, "succeeded")
            val olderSecond = slot("job-older-b", 100L, 1, "queued")
            val olderFirst = slot("job-older-a", 100L, 0, "failed")
            val registry = JSONObject()
                .put("version", sourceVersion)
                .put(
                    "groups",
                    JSONArray()
                        .put(group("newer", 200L, newer))
                        .put(group("older", 100L, olderSecond, olderFirst)),
                )

            invoke<Any>("migrateRegistrySnapshot", registry)

            assertEquals(3, registry.getInt("version"))
            assertEquals(1L, olderFirst.getLong("queueSequence"))
            assertEquals(2L, olderSecond.getLong("queueSequence"))
            assertEquals(3L, newer.getLong("queueSequence"))
            assertEquals(4L, registry.getLong("nextQueueSequence"))
            assertEquals("failed", olderFirst.getString("status"))
            assertEquals("queued", olderSecond.getString("status"))
            assertEquals("succeeded", newer.getString("status"))
            for (entry in listOf(olderFirst, olderSecond, newer)) {
                assertFalse(entry.getBoolean("cancelRequested"))
                assertFalse(entry.getBoolean("reservationActive"))
            }
        }
    }

    @Test
    fun futureRegistryVersionFailsClosed() {
        val registry = JSONObject().put("version", 4).put("groups", JSONArray())
        var failure: Throwable? = null

        try {
            invoke<Any>("migrateRegistrySnapshot", registry)
        } catch (error: InvocationTargetException) {
            failure = error.cause
        }

        assertTrue(failure is IllegalStateException)
        assertEquals(4, registry.getInt("version"))
    }

    @Test
    fun terminalRetentionKeepsAllActiveAndNewestFiveHundredTerminalGroups() {
        val groups = JSONArray().put(group("active", 1L, slot("active-job", 1L, 0, "running")))
        repeat(502) { index ->
            groups.put(group("terminal-$index", index.toLong(), slot("job-$index", index.toLong(), 0, "succeeded")))
        }
        val registry = JSONObject().put("version", 3).put("groups", groups)

        val dropped = invoke<List<String>>("trimTerminalGroups", registry)
        val kept = registry.getJSONArray("groups")
        val keptIds = (0 until kept.length()).map { kept.getJSONObject(it).getString("groupId") }.toSet()

        assertEquals(listOf("terminal-0", "terminal-1"), dropped)
        assertEquals(501, kept.length())
        assertTrue("active" in keptIds)
        assertTrue("terminal-501" in keptIds)
        assertFalse("terminal-0" in keptIds)
    }

    private fun slot(jobId: String, createdAt: Long, batchIndex: Int, status: String): JSONObject =
        JSONObject()
            .put("jobId", jobId)
            .put("createdAt", createdAt)
            .put("batchIndex", batchIndex)
            .put("status", status)

    private fun group(groupId: String, createdAt: Long, vararg slots: JSONObject): JSONObject =
        JSONObject()
            .put("groupId", groupId)
            .put("createdAt", createdAt)
            .put("slots", JSONArray().apply { slots.forEach(::put) })

    @Suppress("UNCHECKED_CAST")
    private fun <T> invoke(name: String, vararg arguments: Any?): T {
        val method = AndroidJobManager::class.java.declaredMethods.single {
            it.name == name && it.parameterCount == arguments.size
        }
        method.isAccessible = true
        return method.invoke(AndroidJobManager, *arguments) as T
    }

    @Suppress("UNCHECKED_CAST")
    private fun <T> field(name: String): T {
        val field = AndroidJobManager::class.java.getDeclaredField(name)
        field.isAccessible = true
        return field.get(AndroidJobManager) as T
    }
}
