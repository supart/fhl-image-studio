package top.fangtangyuan.fhlstudio.android

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.util.AtomicFile
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.FileNotFoundException
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.URI
import java.net.URL
import java.text.SimpleDateFormat
import java.text.Normalizer
import java.util.Date
import java.util.Locale
import java.util.UUID
import java.util.concurrent.CancellationException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sqrt

object AndroidJobEventBus {
    private val listeners = CopyOnWriteArraySet<(JSONObject) -> Unit>()

    fun addListener(listener: (JSONObject) -> Unit): () -> Unit {
        listeners.add(listener)
        return { listeners.remove(listener) }
    }

    fun emit(event: JSONObject) {
        val serialized = event.toString()
        for (listener in listeners) {
            try {
                listener(JSONObject(serialized))
            } catch (_: Exception) {
                // Keep one bad WebView listener from breaking background work.
            }
        }
    }
}

object AndroidJobManager {
    private const val logTag = "FHLImageStudioJobs"
    private const val registryVersion = 3
    private const val payloadRegistryVersion = 2
    private const val auditLogVersion = 2
    private const val maxListGroups = 700
    private const val maxAuditEvents = 5_000
    private const val defaultTextModel = "gpt-5.5"
    private const val defaultImageModel = "gpt-image-2"
    private const val noPromptRevisionInstructions =
        "You are a tool runner. Pass the user prompt to image_generation VERBATIM. DO NOT rewrite, expand, polish, or revise it in any way. Use the exact text the user gave."
    private const val safeImageToolInstructions =
        "Use the image_generation tool and return an image result, not a text-only answer. If the user's wording is ambiguous or may trigger a safety refusal, adapt it into a policy-compliant visual prompt while preserving the creative intent."
    private const val uploadCopyJpegQuality = 82
    private const val previewMaxEdge = 1280
    private const val previewJpegQuality = 78
    private const val apimartOfficialBaseUrl = "https://api.apimart.ai"
    private const val apimartLegacyBaseUrl = "https://api.apib.ai"
    private const val apimartSubmitTimeoutMs = 240_000
    private const val apimartUploadTimeoutMs = 120_000
    private const val apimartPollTimeoutMs = 60_000
    private const val apimartTaskTimeoutMs = 1_800_000L
    private const val apimartImageDownloadTimeoutMs = 120_000
    private const val apimartPollIntervalMs = 3_000L
    private const val runningHubSubmitTimeoutMs = 240_000
    private const val runningHubUploadTimeoutMs = 120_000
    private const val runningHubPollTimeoutMs = 60_000
    private const val runningHubTaskTimeoutMs = 900_000L
    private const val runningHubImageDownloadTimeoutMs = 120_000
    private const val runningHubPollIntervalMs = 2_500L
    private const val openAIImageMinPixels = 655_360
    private const val openAIImageMaxPixels = 8_294_400
    private const val openAIImageMaxSide = 3_840
    private const val openAIImageAlignment = 16
    private const val openAIImageMaxAspect = 3.0

    private val lock = Any()
    private val auditLock = Any()
    private val fullPayloads = ConcurrentHashMap<String, JSONObject>()
    private val liveJobIds = ConcurrentHashMap.newKeySet<String>()
    private val cancelledJobIds = ConcurrentHashMap.newKeySet<String>()
    private val activeConnections = ConcurrentHashMap<String, HttpURLConnection>()
    private val activeWorkerJobIds = ConcurrentHashMap.newKeySet<String>()
    private val activeReservations = ConcurrentHashMap<String, AndroidJobSchedulingPolicy.Reservation>()
    private val workerRunning = AtomicBoolean(false)
    private val workerGeneration = AtomicLong(0L)
    private val processSessionId = "android-process-${UUID.randomUUID()}"
    private val auditSequence = AtomicLong(0L)
    private val processAuditStarted = AtomicBoolean(false)
    private val idleRegistration = AtomicReference(IdleRegistration(0L, null))

    fun resumePendingWork(context: Context) {
        val appContext = context.applicationContext
        ensureProcessAuditStarted(appContext)
        val shouldStart = synchronized(lock) {
            reconcilePendingJobsLocked(appContext)
        }
        if (shouldStart) {
            startService(appContext)
        }
    }

    fun submit(context: Context, payload: JSONObject): JSONObject {
        val appContext = context.applicationContext
        val submittedAPIMode = payload.optString("apiMode", "responses")
        val apiMode = normalizeSubmissionAPIMode(submittedAPIMode)
        val clientSubmissionId = payload.optString("clientSubmissionId").trim()
        if (clientSubmissionId.isBlank()) {
            throw IllegalArgumentException("Android 提交缺少 clientSubmissionId，已阻止可能的重复任务。")
        }
        val submittedCredential = payload.optString("apiKey").trim()
        if (apiModeRequiresCredential(apiMode) && submittedCredential.isBlank()) {
            throw IllegalArgumentException("API 凭据为空，请重新配置后再生成。")
        }
        val now = System.currentTimeMillis()
        val workspaceId = payload.optString("workspaceId").ifBlank { "default" }
        val batchCount = payload.optInt("batchCount", 1).coerceIn(1, 9)
        val continuousGenerateTest = payload.optBoolean("continuousGenerateTest", false)
        if (continuousGenerateTest && batchCount != 1) {
            throw IllegalArgumentException("连续生成一次只能创建一个 Android 任务。")
        }
        val continuousBatchIndex = payload.optInt("continuousBatchIndex", 0).coerceAtLeast(0)
        val rawFHLImagesPoolSlot = payload.optInt("fhlImagesPoolSlot", 0)
        val baseURL = payload.optString("baseURL")
        val fhlImagesPoolSlot = validatedNewSubmissionFHLPoolSlot(
            apiMode,
            baseURL,
            rawFHLImagesPoolSlot,
        )
        val apiLabel = apiLabelForAssignment(
            apiMode,
            baseURL,
            payload.optString("apiLabel", "FHL"),
            rawFHLImagesPoolSlot,
        )
        val apiProfileId = payload.optString("apiProfileId").trim()
        val apiProfileName = payload.optString("apiProfileName").trim()
        var createdGroup: JSONObject? = null
        var createdPayload: JSONObject? = null
        var shouldWakeService = false
        val response = synchronized(lock) {
            val registry = loadRegistry(appContext)
            val groups = registry.optJSONArray("groups") ?: JSONArray()
            for (i in 0 until groups.length()) {
                val existing = groups.optJSONObject(i) ?: continue
                if (existing.optString("clientSubmissionId") == clientSubmissionId) {
                    // A duplicate event must be idempotent, but it can arrive after a
                    // service restart or while the original worker wake-up was lost.
                    shouldWakeService = hasPendingSlots(existing.optJSONArray("slots"))
                    return@synchronized buildSubmitResponse(existing, deduplicated = true)
                }
            }

            val pendingSlotCount = countNonTerminalSlots(groups)
            if (!AndroidJobSchedulingPolicy.canAcceptNonTerminal(pendingSlotCount, batchCount)) {
                throw IllegalStateException(
                    "Android 后台队列已满（最多 ${AndroidJobSchedulingPolicy.MAX_NON_TERMINAL_SLOTS} 个未完成任务），请等待任务完成后再提交。",
                )
            }

            val groupId = "android-group-${UUID.randomUUID()}"
            val requestRunId = payload.optString("requestRunId").ifBlank { groupId }
            val slotIds = JSONArray()
            val slots = JSONArray()
            val newJobIds = mutableListOf<String>()
            var nextQueueSequence = registry.optLong("nextQueueSequence", 1L).coerceAtLeast(1L)
            for (index in 0 until batchCount) {
                val jobId = "android-job-${UUID.randomUUID()}"
                slotIds.put(jobId)
                newJobIds += jobId
                val slot = JSONObject()
                    .put("jobId", jobId)
                    .put("groupId", groupId)
                    .put("processSessionId", processSessionId)
                    .put("queueSequence", nextQueueSequence++)
                    .put("workspaceId", workspaceId)
                    .put("batchIndex", continuousBatchIndex + index)
                    .put("apiLabel", apiLabel)
                    .put("status", "queued")
                    .put("createdAt", now)
                    .put("updatedAt", now)
                    .put("startedAt", JSONObject.NULL)
                    .put("finishedAt", JSONObject.NULL)
                    .put("settledAt", JSONObject.NULL)
                    .put("stage", if (index == 0) "等待后台服务启动" else "排队中")
                    .put("elapsedSec", 0)
                    .put("bytes", 0)
                    .put("cancelRequested", false)
                    .put("reservationActive", false)
                if (apiProfileId.isNotBlank()) slot.put("apiProfileId", apiProfileId)
                if (apiProfileName.isNotBlank()) slot.put("apiProfileName", apiProfileName)
                if (fhlImagesPoolSlot != null) slot.put("fhlImagesPoolSlot", fhlImagesPoolSlot)
                slots.put(slot)
            }

            val group = JSONObject()
                .put("groupId", groupId)
                .put("clientSubmissionId", clientSubmissionId)
                .put("processSessionId", processSessionId)
                .put("workspaceId", workspaceId)
                .put("createdAt", now)
                .put("mode", if (payload.optString("mode") == "edit") "edit" else "generate")
                .put("apiMode", apiMode)
                .put("apiLabel", apiLabel)
                .put("prompt", payload.optString("prompt"))
                .put("batchCount", batchCount)
                .put("size", payload.optString("size", "1024x1024"))
                .put("quality", payload.optString("quality", "medium"))
                .put("outputFormat", payload.optString("outputFormat", "png"))
                .put("negativePrompt", payload.optString("negativePrompt"))
                .put("styleTag", payload.optString("styleTag"))
                .put("seed", payload.optLong("seed", 0L))
                .put("concurrencyLimit", payload.optInt("concurrencyLimit", 0).coerceAtLeast(0))
                .put("sourceImagePaths", safeStringArray(payload.optJSONArray("sourceImagePaths")))
                .put("continuousGenerateTest", continuousGenerateTest)
                .put("continuousBatchIndex", continuousBatchIndex)
                .put("requestRunId", requestRunId)
                .put("slotIds", slotIds)
                .put("slots", slots)
                .put("statusSummary", summarizeSlots(slots))
            if (apiProfileId.isNotBlank()) group.put("apiProfileId", apiProfileId)
            if (apiProfileName.isNotBlank()) group.put("apiProfileName", apiProfileName)
            if (fhlImagesPoolSlot != null) group.put("fhlImagesPoolSlot", fhlImagesPoolSlot)
            if (apiMode == "apimart") {
                val originalBaseURL = payload.optString("baseURL").trim()
                if (originalBaseURL.isNotBlank()) group.put("apimartBaseURL", originalBaseURL)
            }

            val storedPayload = payloadForPersistence(payload, groupId)
                .put("apiLabel", apiLabel)
            if (fhlImagesPoolSlot != null) {
                storedPayload.put("fhlImagesPoolSlot", fhlImagesPoolSlot)
            } else {
                storedPayload.remove("fhlImagesPoolSlot")
            }
            try {
                persistGroupPayload(appContext, groupId, storedPayload)
                if (submittedCredential.isNotBlank()) {
                    AndroidCredentialStore(appContext).setTemporaryJobCredential(groupId, submittedCredential)
                }
                val existingGroups = mutableListOf<JSONObject>()
                for (i in 0 until groups.length()) {
                    val existing = groups.optJSONObject(i) ?: continue
                    if (existing.optString("groupId") != groupId) existingGroups.add(existing)
                }
                val nextGroups = JSONArray()
                nextGroups.put(group)
                for (existing in existingGroups) {
                    nextGroups.put(existing)
                }
                registry.put("groups", nextGroups)
                val droppedGroupIds = trimTerminalGroups(registry)
                saveRegistry(
                    appContext,
                    registry
                        .put("nextQueueSequence", nextQueueSequence)
                        .put("groups", registry.optJSONArray("groups") ?: nextGroups),
                )
                for (droppedGroupId in droppedGroupIds) {
                    fullPayloads.remove(droppedGroupId)
                    deletePersistedPayload(appContext, droppedGroupId)
                }
            } catch (error: Exception) {
                fullPayloads.remove(groupId)
                deletePersistedPayload(appContext, groupId)
                throw IllegalStateException("Android 后台任务安全保存失败，未创建任务。", error)
            }
            fullPayloads[groupId] = JSONObject(storedPayload.toString())
            for (jobId in newJobIds) liveJobIds.add(jobId)
            createdGroup = group
            createdPayload = storedPayload
            shouldWakeService = true
            buildSubmitResponse(group, deduplicated = false)
        }
        if (createdGroup != null && createdPayload != null) {
            appendJobAudit(appContext, "submit", buildSubmitAudit(createdGroup!!, createdPayload!!))
        }
        if (shouldWakeService) startService(appContext)
        return response
    }

    private fun buildSubmitResponse(group: JSONObject, deduplicated: Boolean): JSONObject {
        val jobIds = JSONArray()
        val slots = group.optJSONArray("slots") ?: JSONArray()
        for (i in 0 until slots.length()) {
            val jobId = slots.optJSONObject(i)?.optString("jobId").orEmpty()
            if (jobId.isNotBlank()) jobIds.put(jobId)
        }
        return JSONObject()
            .put("groupId", group.optString("groupId"))
            .put("jobIds", jobIds)
            .put("group", JSONObject(group.toString()))
            .put("deduplicated", deduplicated)
    }

    fun list(context: Context, workspaceId: String, limit: Int): JSONObject {
        val appContext = context.applicationContext
        val shouldStart = synchronized(lock) {
            reconcilePendingJobsLocked(appContext)
        }
        if (shouldStart) startService(appContext)
        synchronized(lock) {
            val registry = loadRegistry(appContext)
            val groups = registry.optJSONArray("groups") ?: JSONArray()
            val out = JSONArray()
            for (i in 0 until groups.length()) {
                val group = groups.optJSONObject(i) ?: continue
                if (group.optString("workspaceId") == workspaceId && out.length() < limit.coerceIn(1, maxListGroups)) {
                    out.put(group)
                }
            }
            return JSONObject()
                .put("workspaceId", workspaceId)
                .put("groups", out)
        }
    }

    fun cancel(context: Context, jobIds: JSONArray): JSONObject {
        val appContext = context.applicationContext
        val cancelled = JSONArray()
        for (i in 0 until jobIds.length()) {
            val jobId = jobIds.optString(i).trim()
            if (jobId.isBlank()) continue
            val cancellation = synchronized(lock) {
                cancelledJobIds.add(jobId)
                try {
                    val reserved = activeReservations.containsKey(jobId)
                    var accepted = false
                    val updated = updateSlot(appContext, jobId, if (reserved) "snapshot" else "cancelled") { slot ->
                        if (hasPendingStatus(slot.optString("status"))) {
                            accepted = true
                            if (reserved) {
                                slot.put("cancelRequested", true)
                                slot.put("stage", "正在取消，等待请求结束")
                            } else {
                                applyCancelledState(slot, startedAt = null, settled = true)
                            }
                        }
                    }
                    if (!accepted || !reserved) cancelledJobIds.remove(jobId)
                    Triple(reserved && accepted, updated, accepted)
                } catch (error: Throwable) {
                    cancelledJobIds.remove(jobId)
                    throw error
                }
            }
            val active = cancellation.first
            val updated = cancellation.second
            if (!cancellation.third) continue
            cancelled.put(jobId)
            if (active) disconnectActiveConnection(jobId)
            if (!active) {
                liveJobIds.remove(jobId)
                cancelledJobIds.remove(jobId)
            }
            val groupId = updated?.first?.optString("groupId").orEmpty()
            if (groupId.isNotBlank() && allGroupSlotsTerminal(appContext, groupId)) {
                fullPayloads.remove(groupId)
                deletePersistedPayload(appContext, groupId)
            }
        }
        return JSONObject().put("cancelledJobIds", cancelled)
    }

    fun attach(context: Context): JSONObject {
        val appContext = context.applicationContext
        val shouldStart = synchronized(lock) {
            reconcilePendingJobsLocked(appContext)
        }
        if (shouldStart) startService(appContext)
        synchronized(lock) {
            val groups = loadRegistry(appContext).optJSONArray("groups") ?: JSONArray()
            for (i in 0 until groups.length()) {
                val group = groups.optJSONObject(i) ?: continue
                val slots = group.optJSONArray("slots") ?: continue
                for (j in 0 until slots.length()) {
                    val slot = slots.optJSONObject(j) ?: continue
                    AndroidJobEventBus.emit(
                        JSONObject()
                            .put("type", eventTypeForStatus(slot.optString("status")))
                            .put("slot", JSONObject(slot.toString()))
                            .put("group", JSONObject(group.toString())),
                    )
                }
            }
        }
        return JSONObject().put("ok", true)
    }

    fun ensureWorker(context: Context, idleCallback: (() -> Unit)? = null) {
        val appContext = context.applicationContext
        val generation = synchronized(lock) {
            reconcilePendingJobsLocked(appContext)
            if (!workerRunning.compareAndSet(false, true)) {
                if (idleCallback != null) {
                    idleRegistration.set(IdleRegistration(workerGeneration.get(), idleCallback))
                }
                return
            }
            val nextGeneration = workerGeneration.incrementAndGet()
            val callback = idleCallback ?: idleRegistration.get().callback
            idleRegistration.set(IdleRegistration(nextGeneration, callback))
            nextGeneration
        }
        try {
            thread(name = "fhl-studio-android-jobs") {
                var completedNormally = false
                try {
                    runWorker(appContext, generation)
                    completedNormally = true
                } catch (error: Exception) {
                    Log.e(logTag, "Android job scheduler stopped after a registry or worker failure; waiting for an explicit wake-up", error)
                } finally {
                    workerRunning.set(false)
                    val queuedWork = if (completedNormally) {
                        try {
                            hasQueuedWork(appContext)
                        } catch (error: Exception) {
                            Log.e(logTag, "Unable to inspect queued Android work after scheduler exit", error)
                            false
                        }
                    } else {
                        false
                    }
                    if (shouldRestartWorker(completedNormally, queuedWork)) {
                        ensureWorker(appContext, idleCallbackForGeneration(generation))
                    } else if (completedNormally || activeWorkerJobIds.isEmpty()) {
                        invokeIdleIfCurrent(generation)
                    }
                }
            }
        } catch (error: Throwable) {
            workerRunning.set(false)
            throw error
        }
    }

    private fun runWorker(context: Context, generation: Long) {
        runWorkerConcurrent(context, generation)
    }

    private fun shouldRestartWorker(completedNormally: Boolean, hasQueuedWork: Boolean): Boolean =
        completedNormally && hasQueuedWork

    private fun idleCallbackForGeneration(generation: Long): (() -> Unit)? =
        idleRegistration.get().takeIf { it.generation == generation }?.callback

    private fun invokeIdleIfCurrent(generation: Long) {
        val registration = idleRegistration.get()
        if (!shouldInvokeIdleCallback(
                generation,
                workerGeneration.get(),
                registration.generation,
                workerRunning.get(),
                activeWorkerJobIds.size,
            )
        ) return
        registration.callback?.invoke()
    }

    private fun shouldInvokeIdleCallback(
        workerGeneration: Long,
        currentGeneration: Long,
        callbackGeneration: Long,
        running: Boolean,
        activeWorkerCount: Int,
    ): Boolean = workerGeneration == currentGeneration &&
        workerGeneration == callbackGeneration &&
        !running &&
        activeWorkerCount == 0

    private fun runWorkerConcurrent(context: Context, generation: Long) {
        while (true) {
            var launched = false
            while (true) {
                val next = claimNextQueuedSlot(context) ?: break
                val group = next.first
                val slot = next.second
                val groupId = group.optString("groupId")
                val jobId = slot.optString("jobId")
                launched = true
                try {
                    thread(name = "fhl-studio-android-job-${jobId.takeLast(8)}") {
                        try {
                            val payload = hydratePayload(context, groupId)
                            if (payload == null) {
                                updateSlot(context, jobId, "error") { current ->
                                    current.put("status", "interrupted")
                                    current.put("stage", "任务已中断")
                                    current.put("errorMessage", "App 进程重启后无法继续未完成任务")
                                    current.put("finishedAt", System.currentTimeMillis())
                                }
                                liveJobIds.remove(jobId)
                                if (allGroupSlotsTerminal(context, groupId)) {
                                    fullPayloads.remove(groupId)
                                    deletePersistedPayload(context, groupId)
                                }
                                return@thread
                            }
                            if (cancelledJobIds.contains(jobId)) {
                                markCancelledSlot(context, jobId, slot.optLong("startedAt", System.currentTimeMillis()))
                                liveJobIds.remove(jobId)
                                if (allGroupSlotsTerminal(context, groupId)) {
                                    fullPayloads.remove(groupId)
                                    deletePersistedPayload(context, groupId)
                                }
                                return@thread
                            }
                            executeSlot(context, group, slot, payload)
                        } finally {
                            try {
                                releaseReservation(context, jobId)
                            } finally {
                                activeWorkerJobIds.remove(jobId)
                                cancelledJobIds.remove(jobId)
                                invokeIdleIfCurrent(generation)
                            }
                        }
                    }
                } catch (error: Throwable) {
                    try {
                        rollbackClaimAfterThreadStartFailure(context, jobId)
                    } catch (rollbackError: Throwable) {
                        error.addSuppressed(rollbackError)
                    }
                    throw error
                }
            }
            if (!launched) {
                if (activeWorkerJobIds.isEmpty() && !hasQueuedWork(context)) return
                Thread.sleep(250L)
            } else {
                Thread.sleep(50L)
            }
        }
    }

    private fun executeSlot(context: Context, group: JSONObject, slot: JSONObject, payload: JSONObject) {
        val groupId = group.optString("groupId")
        val jobId = slot.optString("jobId")
        val batchIndex = slot.optInt("batchIndex", 0)
        val startedAt = System.currentTimeMillis()
        updateSlot(context, jobId, "snapshot") { current ->
            current.put("status", "running")
            current.put("stage", "后台任务已启动")
            current.put("startedAt", startedAt)
            current.put("updatedAt", startedAt)
        }
        try {
            val slotPayload = JSONObject(payload.toString())
            val baseSeed = payload.optLong("seed", 0L)
            val slotSeed = if (baseSeed > 0L) baseSeed + batchIndex else seedForRandomBatchSlot(jobId, batchIndex)
            val requestRunId = payload.optString("requestRunId").ifBlank { group.optString("requestRunId").ifBlank { group.optString("groupId") } }
            slotPayload.put("seed", slotSeed)
            slotPayload.put("batchIndex", batchIndex)
            slotPayload.put("batchCount", payload.optInt("batchCount", group.optInt("batchCount", 1)).coerceAtLeast(1))
            slotPayload.put("groupId", group.optString("groupId"))
            slotPayload.put("clientSubmissionId", group.optString("clientSubmissionId"))
            slotPayload.put("requestRunId", requestRunId)
            slotPayload.put("batchVariationKey", "$requestRunId-${jobId.takeLast(12)}-${batchIndex + 1}")
            val existingAPIMartTaskId = slot.optString("apimartTaskId").trim()
            if (existingAPIMartTaskId.isNotBlank()) {
                slotPayload.put("apimartTaskId", existingAPIMartTaskId)
                val originalAPIMartBaseURL = slot.optString("apimartBaseURL").trim()
                    .ifBlank { group.optString("apimartBaseURL").trim() }
                if (originalAPIMartBaseURL.isNotBlank()) slotPayload.put("baseURL", originalAPIMartBaseURL)
            }
            val apiMode = normalizeAPIMode(slotPayload.optString("apiMode", group.optString("apiMode", "responses")))
            slotPayload.put("apiMode", apiMode)
            if (apiModeRequiresCredential(apiMode)) {
                val credential = try {
                    AndroidCredentialStore(context).getTemporaryJobCredential(groupId)
                } catch (_: Exception) {
                    throw JobRequestException("任务凭据无法解密，请重新提交任务。", null, false)
                }
                if (credential.isBlank()) {
                    throw JobRequestException("任务凭据已失效，请重新提交任务。", null, false)
                }
                slotPayload.put("apiKey", credential)
            }
            val result = when (apiMode) {
                "images" -> requestImages(context, jobId, slotPayload, startedAt)
                "apimart" -> requestAPIMart(context, jobId, slotPayload, startedAt)
                "runninghub" -> requestRunningHub(context, jobId, slotPayload, startedAt)
                else -> requestResponses(context, jobId, slotPayload, startedAt)
            }
            if (cancelledJobIds.contains(jobId)) throw CancellationException("cancelled")
            val outputFormat = payload.optString("outputFormat", "png").ifBlank { "png" }
            val suggestedName = "$apiMode-${payload.optString("mode", "generate")}-${safeNamePart(payload.optString("prompt"))}-${timestampForFile()}-${batchIndex + 1}.$outputFormat"
            val savedPath = if (result.imageBytes != null) {
                saveFinalImageBytes(context, result.imageBytes, outputFormat, suggestedName)
            } else {
                saveFinalImage(context, result.imageB64, outputFormat, suggestedName)
            }
            val galleryUri = publishImageToGallery(context, savedPath)
            val preview = createPreviewFile(context, savedPath)
            if (cancelledJobIds.contains(jobId)) throw CancellationException("cancelled")
            val succeeded = commitWorkerOutcomeUnlessCancelled(context, jobId, startedAt, "terminal") { current ->
                current.put("status", "succeeded")
                current.put("stage", "生成完成")
                current.put("finishedAt", System.currentTimeMillis())
                current.put("elapsedSec", ((System.currentTimeMillis() - startedAt) / 1000.0))
                current.put("savedPath", savedPath)
                if (!galleryUri.isNullOrBlank()) current.put("galleryUri", galleryUri)
                if (preview != null) {
                    current.put("thumbPath", preview.path)
                    current.put("previewWidth", preview.width)
                    current.put("previewHeight", preview.height)
                    current.put("width", preview.sourceWidth)
                    current.put("height", preview.sourceHeight)
                }
                current.put("rawPath", result.rawPath)
                current.put("revisedPrompt", result.revisedPrompt)
                current.put("sourceEvent", result.sourceEvent)
                current.put("apiMode", apiMode)
                val frozenApiLabel = slot.optString("apiLabel").trim()
                    .ifBlank { group.optString("apiLabel").trim() }
                    .ifBlank { payload.optString("apiLabel", "FHL").trim().ifBlank { "FHL" } }
                current.put("apiLabel", frozenApiLabel)
                if (!result.taskId.isNullOrBlank()) current.put("taskId", result.taskId)
                if (!result.apimartTaskId.isNullOrBlank()) current.put("apimartTaskId", result.apimartTaskId)
                if (!result.apimartTaskStatus.isNullOrBlank()) current.put("apimartTaskStatus", result.apimartTaskStatus)
            }
            if (succeeded) {
                AndroidJobNotifications.notifySuccess(
                    context,
                    jobId,
                    payload.optString("prompt"),
                    savedPath,
                    galleryUri,
                )
            }
        } catch (cancelled: CancellationException) {
            markCancelledSlot(context, jobId, startedAt)
        } catch (error: JobRequestException) {
            val failed = commitWorkerOutcomeUnlessCancelled(context, jobId, startedAt, "error") { current ->
                current.put("status", "failed")
                current.put("stage", "生成失败")
                current.put("finishedAt", System.currentTimeMillis())
                current.put("elapsedSec", ((System.currentTimeMillis() - startedAt) / 1000.0))
                current.put("errorMessage", error.message ?: "生成失败")
                if (!error.rawPath.isNullOrBlank()) current.put("rawPath", error.rawPath)
                if (!error.taskId.isNullOrBlank()) {
                    current.put("taskId", error.taskId)
                    current.put("runningHubRecoverable", true)
                }
                if (!error.apimartTaskId.isNullOrBlank()) current.put("apimartTaskId", error.apimartTaskId)
                if (!error.apimartTaskStatus.isNullOrBlank()) current.put("apimartTaskStatus", error.apimartTaskStatus)
            }
            if (failed) {
                AndroidJobNotifications.notifyFailure(context, jobId, error.message ?: "生成失败")
            }
        } catch (error: Exception) {
            val failed = commitWorkerOutcomeUnlessCancelled(context, jobId, startedAt, "error") { current ->
                current.put("status", "failed")
                current.put("stage", "生成失败")
                current.put("finishedAt", System.currentTimeMillis())
                current.put("elapsedSec", ((System.currentTimeMillis() - startedAt) / 1000.0))
                current.put("errorMessage", error.message ?: error.javaClass.simpleName)
            }
            if (failed) {
                AndroidJobNotifications.notifyFailure(context, jobId, error.message ?: error.javaClass.simpleName)
            }
        } finally {
            disconnectActiveConnection(jobId)
            liveJobIds.remove(jobId)
            if (allGroupSlotsTerminal(context, groupId)) {
                fullPayloads.remove(groupId)
                deletePersistedPayload(context, groupId)
            }
        }
    }

    private fun markCancelledSlot(context: Context, jobId: String, startedAt: Long) {
        updateSlot(context, jobId, "cancelled") { current ->
            applyCancelledState(current, startedAt, settled = false)
        }
    }

    private fun commitWorkerOutcomeUnlessCancelled(
        context: Context,
        jobId: String,
        startedAt: Long,
        eventType: String,
        commit: (JSONObject) -> Unit,
    ): Boolean {
        var committed = false
        updateSlot(context, jobId, eventType) { current ->
            val resolvedStatus = statusAfterCancellationArbitration(
                desiredStatus = if (eventType == "terminal") "succeeded" else "failed",
                cancelledInMemory = cancelledJobIds.contains(jobId),
                cancelRequested = current.optBoolean("cancelRequested", false),
            )
            if (resolvedStatus == "cancelled") {
                applyCancelledState(current, startedAt, settled = false)
            } else {
                commit(current)
                committed = true
            }
        }
        return committed
    }

    private fun applyCancelledState(slot: JSONObject, startedAt: Long?, settled: Boolean) {
        val now = System.currentTimeMillis()
        slot.put("status", "cancelled")
        slot.put("stage", "已取消")
        slot.put("cancelRequested", true)
        slot.put("finishedAt", now)
        slot.put("settledAt", if (settled) now else JSONObject.NULL)
        if (startedAt != null && startedAt > 0L) {
            slot.put("elapsedSec", ((now - startedAt) / 1000.0).coerceAtLeast(0.0))
        }
        slot.put("errorMessage", "")
    }

    private fun statusAfterCancellationArbitration(
        desiredStatus: String,
        cancelledInMemory: Boolean,
        cancelRequested: Boolean,
    ): String = if (cancelledInMemory || cancelRequested) "cancelled" else desiredStatus

    private fun requestResponses(
        context: Context,
        jobId: String,
        originalPayload: JSONObject,
        startedAt: Long,
    ): JobImageResult {
        if (cancelledJobIds.contains(jobId)) throw CancellationException("cancelled")
        val attempt = paidSubmissionAttemptNumbers("responses").single()
        return requestResponsesOnce(context, jobId, JSONObject(originalPayload.toString()), attempt, startedAt)
    }

    private fun requestResponsesOnce(
        context: Context,
        jobId: String,
        payload: JSONObject,
        attempt: Int,
        startedAt: Long,
    ): JobImageResult {
        val baseUrl = normalizeBaseURL(payload.optString("baseURL"))
        val apiKey = payload.optString("apiKey").trim()
        if (apiKey.isBlank()) throw JobRequestException("API Key 为空，请先在一键配置里填写并测试。", null, false)
        val url = "$baseUrl/v1/responses"
        val body = buildResponsesPayload(context, payload).toString()
        val bodyBytes = body.toByteArray(Charsets.UTF_8)
        val proxyMode = payload.optString("proxyMode", "system")
        val proxyUrl = payload.optString("proxyURL", "")
        val raw = StringBuilder()
        var bytesReceived = 0L
        var lastPartial: JobImageResult? = null
        updateSlot(context, jobId, "snapshot") { slot ->
            slot.put("stage", "FHL Responses/SSE request")
            slot.put("elapsedSec", ((System.currentTimeMillis() - startedAt) / 1000.0))
            slot.put("bytes", bytesReceived)
        }

        val connection = openHttpConnection(url, proxyMode, proxyUrl).apply {
            requestMethod = "POST"
            instanceFollowRedirects = shouldFollowRedirect("POST")
            connectTimeout = 30_000
            readTimeout = 600_000
            doInput = true
            doOutput = true
            useCaches = false
            setFixedLengthStreamingMode(bodyBytes.size)
            setRequestProperty("Authorization", "Bearer $apiKey")
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Accept", "text/event-stream, application/json")
            setRequestProperty("User-Agent", "fhl-studio-android")
        }
        registerActiveConnection(jobId, connection)
        try {
            appendUpstreamSubmitAttemptAudit(context, jobId, payload, "responses")
            connection.outputStream.use { it.write(bodyBytes) }
            val status = connection.responseCode
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            stream?.bufferedReader(Charsets.UTF_8)?.use { reader ->
                while (true) {
                    val line = reader.readLine() ?: break
                    if (cancelledJobIds.contains(jobId)) throw CancellationException("cancelled")
                    raw.append(line).append('\n')
                    bytesReceived += line.toByteArray(Charsets.UTF_8).size + 1
                    parseSSEEventLine(line)?.let { event ->
                        val partial = partialFromEvent(event)
                        if (partial != null) lastPartial = partial
                        val summary = summarizeSSEEvent(event)
                        if (summary.isNotBlank()) {
                            updateSlot(context, jobId, "snapshot") { slot ->
                                slot.put("stage", summary)
                                slot.put("elapsedSec", ((System.currentTimeMillis() - startedAt) / 1000.0))
                                slot.put("bytes", bytesReceived)
                            }
                        }
                        val final = finalFromSSEEvent(event)
                        if (final != null) {
                            val rawPath = writeRawLog(context, "sse-response-attempt$attempt-${jobId.takeLast(8)}.txt", raw.toString())
                            return final.copy(rawPath = rawPath)
                        }
                    }
                }
            }
            val rawText = raw.toString()
            val rawPath = writeRawLog(context, "sse-response-attempt$attempt-${jobId.takeLast(8)}.txt", rawText)
            if (status !in 200..299) {
                throw JobRequestException(describeProblem(rawText, status), rawPath, isRetryableRaw(rawText, status))
            }
            val result = extractFinalImageResult(rawText)
            if (result != null) return result.copy(rawPath = rawPath)
            if (lastPartial != null) {
                val intermediatePath = saveIntermediateImage(
                    context,
                    lastPartial!!.imageB64,
                    payload.optString("outputFormat", "png").ifBlank { "png" },
                    "partial-${timestampForFile()}-${jobId.takeLast(8)}.${payload.optString("outputFormat", "png").ifBlank { "png" }}",
                )
                throw JobRequestException("FHL 只返回了中间预览图，未返回 final；中间图已保存到 $intermediatePath。", rawPath, true)
            }
            throw JobRequestException(describeProblem(rawText, status), rawPath, true)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: JobRequestException) {
            throw error
        } catch (error: Exception) {
            val rawPath = if (raw.isNotBlank()) writeRawLog(context, "sse-response-attempt$attempt-${jobId.takeLast(8)}.txt", raw.toString()) else null
            throw JobRequestException(error.message ?: error.javaClass.simpleName, rawPath, true)
        } finally {
            unregisterActiveConnection(jobId, connection)
        }
    }

    private fun requestImages(
        context: Context,
        jobId: String,
        originalPayload: JSONObject,
        startedAt: Long,
    ): JobImageResult {
        if (cancelledJobIds.contains(jobId)) throw CancellationException("cancelled")
        val attempt = paidSubmissionAttemptNumbers("images").single()
        return requestImagesOnce(context, jobId, JSONObject(originalPayload.toString()), attempt, startedAt)
    }

    private fun requestImagesOnce(
        context: Context,
        jobId: String,
        payload: JSONObject,
        attempt: Int,
        startedAt: Long,
    ): JobImageResult {
        val built = buildImagesRequestBody(context, payload)
        logFHLImagesRequestDiagnostics(payload)
        val apiKey = payload.optString("apiKey").trim()
        if (apiKey.isBlank()) throw JobRequestException("API Key is empty", null, false)
        val proxyMode = payload.optString("proxyMode", "system")
        val proxyUrl = payload.optString("proxyURL", "")
        val raw = StringBuilder()
        var bytesReceived = 0L
        updateSlot(context, jobId, "snapshot") { slot ->
            slot.put("stage", "Images API request")
            slot.put("elapsedSec", ((System.currentTimeMillis() - startedAt) / 1000.0))
            slot.put("bytes", bytesReceived)
        }
        val connection = openHttpConnection(built.url, proxyMode, proxyUrl).apply {
            requestMethod = "POST"
            instanceFollowRedirects = shouldFollowRedirect("POST")
            connectTimeout = 30_000
            readTimeout = 600_000
            doInput = true
            doOutput = true
            useCaches = false
            setFixedLengthStreamingMode(built.bodyBytes.size)
            setRequestProperty("Authorization", "Bearer $apiKey")
            setRequestProperty("Accept", "text/event-stream, application/json")
            setRequestProperty("User-Agent", "fhl-studio-android")
            if (built.contentType.isNotBlank()) setRequestProperty("Content-Type", built.contentType)
        }
        registerActiveConnection(jobId, connection)
        try {
            appendUpstreamSubmitAttemptAudit(context, jobId, payload, "images")
            connection.outputStream.use { it.write(built.bodyBytes) }
            val status = connection.responseCode
            val contentType = connection.contentType ?: ""
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            stream?.bufferedReader(Charsets.UTF_8)?.useLines { lines ->
                lines.forEach { line ->
                    if (cancelledJobIds.contains(jobId)) throw CancellationException("cancelled")
                    raw.append(line).append('\n')
                    bytesReceived += line.toByteArray(Charsets.UTF_8).size + 1
                    parseSSEEventLine(line)?.let { event ->
                        val summary = summarizeImagesSSEEvent(event)
                        if (summary.isNotBlank()) {
                            updateSlot(context, jobId, "snapshot") { slot ->
                                slot.put("stage", summary)
                                slot.put("elapsedSec", ((System.currentTimeMillis() - startedAt) / 1000.0))
                                slot.put("bytes", bytesReceived)
                            }
                        }
                    }
                }
            }
            val rawText = raw.toString()
            val rawPath = writeRawLog(context, "images-response-attempt$attempt-${jobId.takeLast(8)}.txt", rawText)
            if (status !in 200..299) {
                throw JobRequestException(describeProblem(rawText, status), rawPath, isRetryableRaw(rawText, status))
            }
            val result = if (contentType.lowercase(Locale.US).contains("text/event-stream") || rawText.lineSequence().any { it.trim().startsWith("data: ") }) {
                extractImagesStreamResult(context, jobId, payload, rawText, rawPath)
            } else {
                extractImagesJSONResult(context, jobId, payload, rawText, rawPath)
            }
            return result ?: throw JobRequestException("Images API did not return an image", rawPath, true)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: JobRequestException) {
            throw error
        } catch (error: Exception) {
            val rawPath = if (raw.isNotBlank()) writeRawLog(context, "images-response-attempt$attempt-${jobId.takeLast(8)}.txt", raw.toString()) else null
            throw JobRequestException(error.message ?: error.javaClass.simpleName, rawPath, true)
        } finally {
            unregisterActiveConnection(jobId, connection)
        }
    }

    private fun requestAPIMart(
        context: Context,
        jobId: String,
        originalPayload: JSONObject,
        startedAt: Long,
    ): JobImageResult {
        if (cancelledJobIds.contains(jobId)) throw CancellationException("cancelled")
        val attempt = paidSubmissionAttemptNumbers("apimart").single()
        return requestAPIMartOnce(context, jobId, JSONObject(originalPayload.toString()), attempt, startedAt)
    }

    private fun requestAPIMartOnce(
        context: Context,
        jobId: String,
        payload: JSONObject,
        attempt: Int,
        startedAt: Long,
    ): JobImageResult {
        val apiKey = payload.optString("apiKey").trim()
        if (apiKey.isBlank()) throw JobRequestException("APIMart API Key is empty", null, false)
        val existingTaskId = payload.optString("apimartTaskId").trim()
        val sourceDataUrls = if (existingTaskId.isBlank()) resolveSourceDataURLs(context, payload) else JSONArray()
        if (existingTaskId.isBlank() && payload.optString("mode") == "edit" && sourceDataUrls.length() == 0) {
            throw JobRequestException("APIMart edit mode requires at least one reference image", null, false)
        }
        val baseCandidates = if (existingTaskId.isNotBlank()) {
            apimartQueryBaseURLCandidates(payload.optString("baseURL"))
        } else {
            apimartSubmissionBaseURLs(payload.optString("baseURL"))
        }
        var lastError: JobRequestException? = null
        for ((baseIndex, baseUrl) in baseCandidates.withIndex()) {
            try {
                if (existingTaskId.isNotBlank()) {
                    updateSlot(context, jobId, "snapshot") { slot ->
                        slot.put("stage", "APIMart continuing task $existingTaskId")
                        slot.put("elapsedSec", ((System.currentTimeMillis() - startedAt) / 1000.0))
                        slot.put("apimartTaskId", existingTaskId)
                        slot.put("apimartTaskStatus", "polling")
                    }
                    val polled = pollAPIMartTask(context, jobId, baseUrl, apiKey, existingTaskId, payload, attempt, startedAt)
                    val first = polled.images.firstOrNull().orEmpty()
                    if (first.isBlank()) {
                        throw JobRequestException("APIMart did not return an image", polled.rawPath, false, existingTaskId, "empty")
                    }
                    updateSlot(context, jobId, "snapshot") { slot ->
                        slot.put("stage", "APIMart downloading recovered result image")
                        slot.put("elapsedSec", ((System.currentTimeMillis() - startedAt) / 1000.0))
                        slot.put("apimartTaskId", existingTaskId)
                    }
                    val imageB64 = imageResultToBase64(context, jobId, first, payload, apimartImageDownloadTimeoutMs)
                    if (imageB64.isBlank()) {
                        throw JobRequestException("APIMart result image is empty", polled.rawPath, false, existingTaskId, "empty")
                    }
                    return JobImageResult(
                        imageB64,
                        "",
                        "apimart_async",
                        polled.rawPath,
                        existingTaskId,
                        "succeeded",
                    )
                }
                updateSlot(context, jobId, "snapshot") { slot ->
                    slot.put("stage", if (sourceDataUrls.length() > 0) "APIMart uploading reference images" else "APIMart submitting task")
                    slot.put("elapsedSec", ((System.currentTimeMillis() - startedAt) / 1000.0))
                }
                val imageUrls = mutableListOf<String>()
                for (i in 0 until sourceDataUrls.length()) {
                    imageUrls += uploadAPIMartImage(context, jobId, baseUrl, apiKey, sourceDataUrls.optString(i), i, sourceDataUrls.length(), attempt, payload, startedAt)
                }
                val submitted = submitAPIMartTask(context, jobId, baseUrl, apiKey, payload, imageUrls, attempt, startedAt)
                var images = submitted.images
                var rawPath = submitted.rawPath
                if (images.isEmpty() && submitted.taskId.isNotBlank()) {
                    val polled = pollAPIMartTask(context, jobId, baseUrl, apiKey, submitted.taskId, payload, attempt, startedAt)
                    images = polled.images
                    rawPath = polled.rawPath ?: rawPath
                }
                val first = images.firstOrNull().orEmpty()
                if (first.isBlank()) {
                    throw JobRequestException("APIMart did not return an image", rawPath, false, submitted.taskId, "empty")
                }
                updateSlot(context, jobId, "snapshot") { slot ->
                    slot.put("stage", "APIMart downloading result image")
                    slot.put("elapsedSec", ((System.currentTimeMillis() - startedAt) / 1000.0))
                    if (submitted.taskId.isNotBlank()) slot.put("apimartTaskId", submitted.taskId)
                }
                val imageB64 = imageResultToBase64(context, jobId, first, payload, apimartImageDownloadTimeoutMs)
                if (imageB64.isBlank()) {
                    throw JobRequestException("APIMart result image is empty", rawPath, false, submitted.taskId, "empty")
                }
                return JobImageResult(
                    imageB64,
                    "",
                    "apimart_async",
                    rawPath,
                    submitted.taskId.ifBlank { null },
                    "succeeded",
                )
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: JobRequestException) {
                lastError = error
                if (baseIndex < baseCandidates.lastIndex && isAPIMartNetworkFallbackError(error)) {
                    continue
                }
                throw error
            } catch (error: Exception) {
                val wrapped = JobRequestException(error.message ?: error.javaClass.simpleName, null, isAPIMartNetworkFallbackError(error))
                lastError = wrapped
                if (baseIndex < baseCandidates.lastIndex && wrapped.retryable) continue
                throw wrapped
            }
        }
        throw lastError ?: JobRequestException("APIMart request failed", null, true)
    }

    private fun requestRunningHub(
        context: Context,
        jobId: String,
        originalPayload: JSONObject,
        startedAt: Long,
    ): JobImageResult {
        if (cancelledJobIds.contains(jobId)) throw CancellationException("cancelled")
        val attempt = paidSubmissionAttemptNumbers("runninghub").single()
        return requestRunningHubOnce(context, jobId, JSONObject(originalPayload.toString()), attempt, startedAt)
    }

    private fun requestRunningHubOnce(
        context: Context,
        jobId: String,
        payload: JSONObject,
        attempt: Int,
        startedAt: Long,
    ): JobImageResult {
        val baseUrl = runningHubBaseURL(payload.optString("baseURL"))
        val mode = if (payload.optString("mode") == "edit") "image-to-image" else "text-to-image"
        val sourceDataUrls = if (mode == "image-to-image") resolveSourceDataURLs(context, payload) else JSONArray()
        if (mode == "image-to-image" && sourceDataUrls.length() == 0) {
            throw JobRequestException("RunningHub image-to-image requires at least one reference image", null, false)
        }
        val imageUrls = mutableListOf<String>()
        for (i in 0 until sourceDataUrls.length()) {
            imageUrls += uploadRunningHubImage(context, jobId, baseUrl, sourceDataUrls.optString(i), i, sourceDataUrls.length(), attempt, payload, startedAt)
        }
        val submitted = submitRunningHubTask(context, jobId, baseUrl, payload, mode, imageUrls, attempt, startedAt)
        var images = submitted.images
        var rawPath = submitted.rawPath
        if (images.isEmpty()) {
            if (submitted.taskId.isBlank()) {
                throw JobRequestException("RunningHub bridge did not return task id or image result", rawPath, true)
            }
            val polled = pollRunningHubTask(context, jobId, baseUrl, submitted.taskId, payload, attempt, startedAt)
            images = polled.images
            rawPath = polled.rawPath ?: rawPath
        }
        val first = images.firstOrNull().orEmpty()
        if (first.isBlank()) {
            throw JobRequestException("RunningHub did not return an image", rawPath, false, taskId = submitted.taskId.ifBlank { null })
        }
        updateSlot(context, jobId, "snapshot") { slot ->
            slot.put("stage", "RunningHub downloading final image")
            slot.put("elapsedSec", ((System.currentTimeMillis() - startedAt) / 1000.0))
            if (submitted.taskId.isNotBlank()) slot.put("taskId", submitted.taskId)
        }
        val imageBytes = runningHubImageValueToBytes(context, jobId, baseUrl, first, payload, runningHubImageDownloadTimeoutMs)
        if (imageBytes.isEmpty()) {
            throw JobRequestException("RunningHub result image is empty", rawPath, false, taskId = submitted.taskId.ifBlank { null })
        }
        return JobImageResult(
            "",
            "",
            "runninghub_async",
            rawPath,
            taskId = submitted.taskId.ifBlank { null },
            imageBytes = imageBytes,
        )
    }

    private fun uploadRunningHubImage(
        context: Context,
        jobId: String,
        baseUrl: String,
        dataURL: String,
        index: Int,
        sourceCount: Int,
        attempt: Int,
        payload: JSONObject,
        startedAt: Long,
    ): String {
        val image = parseDataURLImage(dataURL)
        val normalizedBytes = compressUploadCopy(image.bytes, sourceCount, forceJpeg = true)
        val uploadBytes = normalizedBytes ?: image.bytes
        val uploadMime = if (normalizedBytes != null) "image/jpeg" else image.mimeType
        val boundary = "----FHLStudioAndroid${UUID.randomUUID().toString().replace("-", "")}"
        val out = ByteArrayOutputStream()
        appendMultipartFile(out, boundary, "image", "source-${index + 1}.${imageExtensionForMimeType(uploadMime)}", uploadMime, uploadBytes)
        out.write("--$boundary--\r\n".toByteArray(Charsets.UTF_8))
        updateSlot(context, jobId, "snapshot") { slot ->
            slot.put("stage", "RunningHub upload source ${index + 1}/$sourceCount")
            slot.put("elapsedSec", ((System.currentTimeMillis() - startedAt) / 1000.0))
            slot.put("bytes", uploadBytes.size)
            slot.put("originalBytes", image.bytes.size)
            slot.put("uploadMime", uploadMime)
        }
        val response = httpRequestText(
            jobId,
            runningHubEndpoint(baseUrl, "/api/upload"),
            "POST",
            mapOf("Accept" to "application/json", "Content-Type" to "multipart/form-data; boundary=$boundary"),
            out.toByteArray(),
            payload,
            30_000,
            runningHubUploadTimeoutMs,
        )
        val parsed = parseRunningHubJSON(context, jobId, "upload-${index + 1}", attempt, response)
        val url = firstRunningHubStringForKeys(parsed.first, setOf("imageUrl", "image_url", "url"))
            .ifBlank { runningHubImageValuesFromPayload(parsed.first).firstOrNull().orEmpty() }
        if (url.isBlank()) throw JobRequestException("RunningHub upload response did not contain imageUrl", parsed.second, true)
        return url
    }

    private fun submitRunningHubTask(
        context: Context,
        jobId: String,
        baseUrl: String,
        payload: JSONObject,
        mode: String,
        imageUrls: List<String>,
        attempt: Int,
        startedAt: Long,
    ): RunningHubSubmitResult {
        val aspectAndResolution = runningHubAspectAndResolution(payload.optString("size", "1:1@1k"), mode)
        val body = JSONObject()
            .put("model", normalizeRunningHubModel(payload.optString("imageModelID", "banana2")))
            .put("mode", mode)
            .put("prompt", promptWithBatchVariation(payload))
            .put("aspect_ratio", aspectAndResolution.first)
            .put("resolution", aspectAndResolution.second)
        if (mode == "image-to-image") body.put("image_urls", JSONArray(imageUrls))
        updateSlot(context, jobId, "snapshot") { slot ->
            slot.put("stage", "RunningHub submitting async task")
            slot.put("elapsedSec", ((System.currentTimeMillis() - startedAt) / 1000.0))
        }
        appendUpstreamSubmitAttemptAudit(context, jobId, payload, "runninghub")
        val response = httpRequestText(
            jobId,
            runningHubEndpoint(baseUrl, "/api/generate"),
            "POST",
            mapOf("Accept" to "application/json", "Content-Type" to "application/json"),
            body.toString().toByteArray(Charsets.UTF_8),
            payload,
            30_000,
            runningHubSubmitTimeoutMs,
        )
        val parsed = parseRunningHubJSON(context, jobId, "submit", attempt, response)
        val taskId = extractRunningHubTaskId(parsed.first)
        val status = statusFromPayload(parsed.first)
        val images = if (taskId.isNotBlank() && !runningHubIsSuccessStatus(status)) {
            emptyList()
        } else {
            runningHubResultImagesFromPayload(parsed.first)
        }
        if (taskId.isBlank() && images.isEmpty()) {
            throw JobRequestException("RunningHub bridge did not return task id or image result", parsed.second, true)
        }
        if (taskId.isNotBlank()) {
            updateSlot(context, jobId, "snapshot") { slot ->
                slot.put("taskId", taskId)
                slot.put("stage", "RunningHub task submitted $taskId")
            }
        }
        return RunningHubSubmitResult(taskId, images, parsed.second)
    }

    private fun pollRunningHubTask(
        context: Context,
        jobId: String,
        baseUrl: String,
        taskId: String,
        payload: JSONObject,
        attempt: Int,
        startedAt: Long,
    ): RunningHubPollResult {
        val deadline = System.currentTimeMillis() + runningHubTaskTimeoutMs
        var rawPath: String? = null
        var lastStatus = ""
        while (System.currentTimeMillis() < deadline) {
            sleepWithCancel(jobId, runningHubPollIntervalMs)
            updateSlot(context, jobId, "snapshot") { slot ->
                slot.put("stage", "RunningHub polling task $taskId${if (lastStatus.isNotBlank()) " ($lastStatus)" else ""}")
                slot.put("elapsedSec", ((System.currentTimeMillis() - startedAt) / 1000.0))
                slot.put("taskId", taskId)
            }
            val response = httpRequestText(
                jobId,
                "${runningHubEndpoint(baseUrl, "/api/task")}?id=${Uri.encode(taskId)}",
                "GET",
                mapOf("Accept" to "application/json"),
                null,
                payload,
                30_000,
                runningHubPollTimeoutMs,
            )
            val parsed = parseRunningHubJSON(context, jobId, "poll", attempt, response)
            rawPath = parsed.second ?: rawPath
            val images = runningHubResultImagesFromPayload(parsed.first)
            if (images.isNotEmpty()) return RunningHubPollResult(images, rawPath)
            lastStatus = statusFromPayload(parsed.first)
            if (runningHubIsSuccessStatus(lastStatus)) {
                throw JobRequestException("RunningHub task completed without any image output", rawPath, false, taskId = taskId)
            }
            if (runningHubIsFailureStatus(lastStatus)) {
                throw JobRequestException(firstErrorMessage(parsed.first).ifBlank { "RunningHub task failed: $lastStatus" }, rawPath, false, taskId = taskId)
            }
        }
        throw JobRequestException("RunningHub task timed out: $taskId", rawPath, false, taskId = taskId)
    }

    private fun parseRunningHubJSON(
        context: Context,
        jobId: String,
        label: String,
        attempt: Int,
        response: HttpTextResponse,
    ): Pair<JSONObject, String?> {
        val rawPath = writeRawLog(context, "runninghub-$label-attempt$attempt-${jobId.takeLast(8)}.txt", response.body)
        val data = try {
            parseRunningHubJSONObject(response.body)
        } catch (error: Exception) {
            throw JobRequestException("RunningHub $label JSON parse failed: ${error.message ?: error.javaClass.simpleName}", rawPath, response.status >= 500)
        }
        if (response.status !in 200..299) {
            throw JobRequestException("RunningHub $label returned ${response.status}: ${firstErrorMessage(data).ifBlank { response.body.take(240) }}", rawPath, response.status in listOf(502, 503, 504, 524))
        }
        if (data.has("ok") && !data.optBoolean("ok", true)) {
            throw JobRequestException("RunningHub $label returned error: ${firstErrorMessage(data).ifBlank { "ok=false" }}", rawPath, true)
        }
        return data to rawPath
    }

    private fun parseRunningHubJSONObject(body: String): JSONObject {
        val trimmed = body.trim().trimStart('\uFEFF')
        if (trimmed.isBlank()) return JSONObject()
        try {
            return JSONObject(trimmed)
        } catch (first: Exception) {
            if (!trimmed.startsWith("{")) throw first
            var candidate = trimmed
            repeat(4) {
                candidate += "}"
                try {
                    return JSONObject(candidate)
                } catch (_: Exception) {
                    // Keep the original error unless a minimally closed object parses.
                }
            }
            throw first
        }
    }

    private fun runningHubImageValueToBytes(context: Context, jobId: String, baseUrl: String, value: String, payload: JSONObject, readTimeout: Int): ByteArray {
        val trimmed = value.trim()
        if (trimmed.startsWith("data:image/", ignoreCase = true)) return parseDataURLImage(trimmed).bytes
        val canFetchDirectly = trimmed.startsWith("http://", ignoreCase = true) || trimmed.startsWith("https://", ignoreCase = true)
        var response = try {
            httpRequestBytes(jobId, "${runningHubEndpoint(baseUrl, "/api/image")}?url=${Uri.encode(trimmed)}", payload, readTimeout)
        } catch (exception: Exception) {
            if (!canFetchDirectly || exception is CancellationException) throw exception
            httpRequestBytes(jobId, trimmed, payload, readTimeout)
        }
        if (response.status !in 200..299 && canFetchDirectly) {
            response = httpRequestBytes(jobId, trimmed, payload, readTimeout)
        }
        if (response.status !in 200..299) {
            val rawPath = writeRawLog(context, "runninghub-image-download-${jobId.takeLast(8)}.txt", response.bytes.decodeToString())
            throw JobRequestException("RunningHub image proxy failed ${response.status}", rawPath, response.status in listOf(502, 503, 504, 524))
        }
        val looksJson = response.contentType.lowercase(Locale.US).contains("json")
            || response.bytes.firstOrNull()?.toInt()?.toChar() == '{'
        if (looksJson) {
            val text = response.bytes.decodeToString().trim()
            try {
                val data = JSONObject(text)
                val first = runningHubResultImagesFromPayload(data).firstOrNull().orEmpty()
                if (first.startsWith("data:image/", ignoreCase = true)) return parseDataURLImage(first).bytes
                if (first.startsWith("http://", ignoreCase = true) || first.startsWith("https://", ignoreCase = true)) {
                    return runningHubImageValueToBytes(context, jobId, baseUrl, first, payload, readTimeout)
                }
            } catch (_: Exception) {
                // Treat non-JSON image bytes as the expected proxy response.
            }
        }
        return response.bytes
    }

    private fun runningHubBaseURL(raw: String): String {
        return raw.trim().ifBlank { "http://10.0.2.2:8117" }.trimEnd('/')
    }

    private fun runningHubEndpoint(baseUrl: String, path: String): String {
        val root = baseUrl.trim().trimEnd('/')
        return "$root${if (path.startsWith("/")) path else "/$path"}"
    }

    private fun normalizeRunningHubModel(modelID: String): String {
        return if (modelID.trim().lowercase(Locale.US).contains("g2")) "image_g2" else "banana2"
    }

    private fun runningHubAspectAndResolution(size: String, mode: String): Pair<String, String> {
        val normalized = size.trim().lowercase(Locale.US)
        parseRunningHubCompactSize(normalized, mode)?.let { return it }
        val aspect = runningHubKnownAspect(normalized).takeIf { it.isNotBlank() && runningHubAspectSupported(it, mode) }
            ?: nearestRunningHubAspect(normalized, mode)
        val resolution = runningHubKnownResolution(normalized).ifBlank { runningHubResolutionForSize(normalized) }
        return aspect to resolution
    }

    private fun parseRunningHubCompactSize(value: String, mode: String): Pair<String, String>? {
        val match = Regex("^(\\d+:\\d+)(?:@(1k|2k|4k))?$").matchEntire(value) ?: return null
        val aspect = match.groupValues[1]
        if (!runningHubAspectSupported(aspect, mode)) return null
        return aspect to match.groupValues.getOrNull(2).orEmpty().ifBlank { "1k" }
    }

    private fun runningHubAspectSupported(aspect: String, mode: String): Boolean {
        val imageAspects = setOf("1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "9:21")
        val textAspects = imageAspects + setOf("5:4", "4:5", "2:1", "1:2", "3:1", "1:3")
        return if (mode == "image-to-image") imageAspects.contains(aspect) else textAspects.contains(aspect)
    }

    private fun runningHubKnownAspect(size: String): String {
        return when (size) {
            "1024x1024", "2048x2048" -> "1:1"
            "1536x1024", "2048x1360" -> "3:2"
            "1024x1536", "1360x2048" -> "2:3"
            "1536x1152", "2048x1536" -> "4:3"
            "1152x1536", "1536x2048" -> "3:4"
            "1520x1216", "2040x1632" -> "5:4"
            "1216x1520", "1632x2040" -> "4:5"
            "1536x864", "2048x1152", "3840x2160" -> "16:9"
            "864x1536", "1152x2048", "2160x3840" -> "9:16"
            "1536x768", "2048x1024", "3840x1920" -> "2:1"
            "768x1536", "1024x2048", "1920x3840" -> "1:2"
            "1536x512", "2040x680", "3840x1280" -> "3:1"
            "512x1536", "680x2040", "1280x3840" -> "1:3"
            else -> ""
        }
    }

    private fun runningHubKnownResolution(size: String): String {
        return when (size) {
            "2048x2048", "2048x1360", "1360x2048", "2048x1536", "1536x2048",
            "2040x1632", "1632x2040", "2048x1152", "1152x2048", "2048x1024",
            "1024x2048", "2040x680", "680x2040" -> "2k"
            "3840x2160", "2160x3840", "3840x1920", "1920x3840", "3840x1280", "1280x3840" -> "4k"
            "1024x1024", "1536x1024", "1024x1536", "1536x1152", "1152x1536",
            "1520x1216", "1216x1520", "1536x864", "864x1536", "1536x768",
            "768x1536", "1536x512", "512x1536" -> "1k"
            else -> ""
        }
    }

    private fun nearestRunningHubAspect(size: String, mode: String): String {
        val parsed = parseSizePixels(size) ?: return "1:1"
        val ratio = parsed.width.toDouble() / parsed.height.toDouble()
        val candidates = if (mode == "image-to-image") {
            listOf("1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "9:21")
        } else {
            listOf("1:1", "3:2", "2:3", "5:4", "4:5", "16:9", "9:16", "21:9", "3:4", "4:3", "9:21", "2:1", "1:2", "3:1", "1:3")
        }
        var best = "1:1"
        var bestDiff = Double.POSITIVE_INFINITY
        for (aspect in candidates) {
            val parts = aspect.split(":")
            val candidate = parts[0].toDouble() / parts[1].toDouble()
            val diff = abs(kotlin.math.ln(ratio) - kotlin.math.ln(candidate))
            if (diff < bestDiff) {
                best = aspect
                bestDiff = diff
            }
        }
        return best
    }

    private fun runningHubResolutionForSize(size: String): String {
        val parsed = parseSizePixels(size) ?: return "1k"
        return when (max(parsed.width, parsed.height)) {
            in 0..1536 -> "1k"
            in 1537..2048 -> "2k"
            else -> "4k"
        }
    }

    private fun runningHubIsSuccessStatus(status: String): Boolean {
        return setOf("succeeded", "success", "completed", "complete", "done", "finished", "ok").contains(status.trim().lowercase(Locale.US))
    }

    private fun runningHubIsFailureStatus(status: String): Boolean {
        return setOf("failed", "fail", "error", "cancelled", "canceled", "rejected").contains(status.trim().lowercase(Locale.US))
    }

    private fun extractRunningHubTaskId(value: Any?, depth: Int = 0): String {
        if (depth > 8 || value == null || value == JSONObject.NULL) return ""
        if (value is String) return ""
        if (value is JSONArray) {
            for (i in 0 until value.length()) {
                val nested = extractRunningHubTaskId(value.opt(i), depth + 1)
                if (nested.isNotBlank()) return nested
            }
            return ""
        }
        if (value !is JSONObject) return ""
        for (key in listOf("task_id", "taskId", "id")) {
            val child = value.optString(key).trim()
            if (child.isNotBlank()) return child
        }
        val keys = value.keys()
        while (keys.hasNext()) {
            val nested = extractRunningHubTaskId(value.opt(keys.next()), depth + 1)
            if (nested.isNotBlank()) return nested
        }
        return ""
    }

    private fun firstRunningHubStringForKeys(value: Any?, keys: Set<String>, depth: Int = 0): String {
        if (depth > 8 || value == null || value == JSONObject.NULL) return ""
        if (value is JSONArray) {
            for (i in 0 until value.length()) {
                val nested = firstRunningHubStringForKeys(value.opt(i), keys, depth + 1)
                if (nested.isNotBlank()) return nested
            }
            return ""
        }
        if (value !is JSONObject) return ""
        for (key in keys) {
            val direct = value.optString(key).trim()
            if (direct.isNotBlank()) return direct
        }
        val iterator = value.keys()
        while (iterator.hasNext()) {
            val nested = firstRunningHubStringForKeys(value.opt(iterator.next()), keys, depth + 1)
            if (nested.isNotBlank()) return nested
        }
        return ""
    }

    private fun runningHubImageValuesFromPayload(value: Any?, key: String? = null, depth: Int = 0, out: MutableList<String> = mutableListOf()): List<String> {
        if (depth > 8 || value == null || value == JSONObject.NULL) return out.distinct()
        if (value is String) {
            val trimmed = value.trim()
            val keyAllows = key == null || Regex("url|image|output|src|uri|file", RegexOption.IGNORE_CASE).containsMatchIn(key)
            if (trimmed.isNotBlank() && keyAllows && (trimmed.startsWith("http://", true) || trimmed.startsWith("https://", true) || trimmed.startsWith("data:image/", true))) {
                out += trimmed
            }
            return out.distinct()
        }
        if (value is JSONArray) {
            for (i in 0 until value.length()) runningHubImageValuesFromPayload(value.opt(i), key, depth + 1, out)
            return out.distinct()
        }
        if (value is JSONObject) {
            val keys = value.keys()
            while (keys.hasNext()) {
                val childKey = keys.next()
                runningHubImageValuesFromPayload(value.opt(childKey), childKey, depth + 1, out)
            }
        }
        return out.distinct()
    }

    private fun runningHubResultImagesFromPayload(value: Any?, key: String? = null, depth: Int = 0, out: MutableList<String> = mutableListOf()): List<String> {
        if (depth > 8 || value == null || value == JSONObject.NULL || runningHubSourceImageKey(key)) return out.distinct()
        if (value is String) {
            val trimmed = value.trim()
            if (trimmed.isNotBlank() && runningHubResultImageKey(key) && (trimmed.startsWith("http://", true) || trimmed.startsWith("https://", true) || trimmed.startsWith("data:image/", true))) {
                out += trimmed
            }
            return out.distinct()
        }
        if (value is JSONArray) {
            for (i in 0 until value.length()) runningHubResultImagesFromPayload(value.opt(i), key, depth + 1, out)
            return out.distinct()
        }
        if (value is JSONObject) {
            val keys = value.keys()
            while (keys.hasNext()) {
                val childKey = keys.next()
                runningHubResultImagesFromPayload(value.opt(childKey), childKey, depth + 1, out)
            }
        }
        return out.distinct()
    }

    private fun runningHubSourceImageKey(key: String?): Boolean {
        return when (key?.trim()?.lowercase(Locale.US)) {
            "imageurls", "image_urls", "submittedrequest", "submitted_request", "upload", "uploads" -> true
            else -> false
        }
    }

    private fun runningHubResultImageKey(key: String?): Boolean {
        val lower = key?.trim()?.lowercase(Locale.US).orEmpty()
        return lower.isBlank()
            || lower.contains("url")
            || lower.contains("image")
            || lower.contains("output")
            || lower.contains("result")
            || lower.contains("src")
    }

    private fun buildResponsesPayload(context: Context, payload: JSONObject): JSONObject {
        val sourceDataUrls = resolveSourceDataURLs(context, payload)
        val rawSize = payload.optString("size", "1024x1024").trim()
        val parsedSize = if (rawSize.isNotBlank() && !rawSize.equals("auto", ignoreCase = true)) parseSizePixels(rawSize) else null
        val size = when {
            rawSize.equals("auto", ignoreCase = true) -> "auto"
            parsedSize != null -> repairSizeForOpenAI(rawSize)
            else -> "1024x1024"
        }
        val aspectSuffix = fhlExactResponsesAspectPromptSuffix(payload, size)
        val prompt = payload.optString("prompt").trim().let { base ->
            if (aspectSuffix.isBlank()) base else "$base\n\n$aspectSuffix"
        }
        val content = JSONArray().put(JSONObject().put("type", "input_text").put("text", prompt))
        val variation = batchVariationInstruction(payload)
        if (variation.isNotBlank()) {
            content.put(JSONObject().put("type", "input_text").put("text", variation))
        }
        for (i in 0 until sourceDataUrls.length()) {
            content.put(JSONObject().put("type", "input_image").put("image_url", sourceDataUrls.optString(i)))
        }
        val compat = payload.optString("requestPolicy", "openai") == "compat"
        val tool = JSONObject()
            .put("type", "image_generation")
            .put("model", payload.optString("imageModelID", defaultImageModel).ifBlank { defaultImageModel })
            .put("action", if (sourceDataUrls.length() > 0) "edit" else "generate")
            .put("size", size)
            .put("quality", payload.optString("quality", "medium").ifBlank { "medium" })
            .put("output_format", payload.optString("outputFormat", "png").ifBlank { "png" })
            .put("moderation", "low")
            .put(
                "partial_images",
                if (shouldDisablePartialImagesForFHLExactResponses(payload, size)) 0 else normalizePartialImages(payload.opt("partialImages")),
            )
        val seed = payload.optLong("seed", 0L)
        val negativePrompt = payload.optString("negativePrompt").trim()
        if (compat && seed > 0L) tool.put("seed", seed)
        if (compat && negativePrompt.isNotBlank()) tool.put("negative_prompt", negativePrompt)
        val maskB64 = payload.optString("maskB64").trim()
        if (maskB64.isNotBlank()) {
            tool.put("input_image_mask", JSONObject().put("image_url", "data:image/png;base64,$maskB64"))
        }
        return JSONObject()
            .put("model", payload.optString("textModelID", defaultTextModel).ifBlank { defaultTextModel })
            .put("input", JSONArray().put(JSONObject().put("role", "user").put("content", content)))
            .put("tools", JSONArray().put(tool))
            .put("tool_choice", JSONObject().put("type", "image_generation"))
            .put("reasoning", JSONObject().put("effort", "xhigh"))
            .put("store", false)
            .put("stream", true)
            .put(
                "instructions",
                buildResponsesInstructions(payload, size),
            )
    }

    private fun buildResponsesInstructions(payload: JSONObject, size: String): String {
        val base = if (payload.optBoolean("noPromptRevision", true)) {
            noPromptRevisionInstructions
        } else {
            safeImageToolInstructions
        }
        val aspectInstruction = fhlExactResponsesAspectInstruction(payload, size)
        return if (aspectInstruction.isBlank()) base else "$base $aspectInstruction"
    }

    private fun shouldDisablePartialImagesForFHLExactResponses(payload: JSONObject, size: String): Boolean {
        val apiMode = payload.optString("apiMode", "responses").trim()
        if (apiMode.isNotBlank() && normalizeAPIMode(apiMode) != "responses") return false
        if (!isFHLBaseURL(payload.optString("baseURL"))) return false
        if (!isGPTImage2Model(payload.optString("imageModelID", defaultImageModel))) return false
        val normalizedSize = size.ifBlank { payload.optString("size") }.trim()
        return normalizedSize.isNotBlank()
            && !normalizedSize.equals("auto", ignoreCase = true)
            && parseSizePixels(normalizedSize) != null
    }

    private fun fhlExactResponsesAspectInstruction(payload: JSONObject, size: String): String {
        if (!shouldDisablePartialImagesForFHLExactResponses(payload, size)) return ""
        val parsed = parseSizePixels(size.ifBlank { payload.optString("size") }) ?: return ""
        val divisor = gcd(parsed.width, parsed.height)
        if (divisor <= 0) return ""
        val aspect = "${parsed.width / divisor}:${parsed.height / divisor}"
        val orientation = when {
            parsed.width == parsed.height -> "square"
            parsed.width > parsed.height -> "landscape"
            else -> "portrait"
        }
        return "The selected output aspect ratio is $aspect ($orientation). The image_generation result MUST use a $aspect canvas and must not return any other aspect ratio."
    }

    private fun fhlExactResponsesAspectPromptSuffix(payload: JSONObject, size: String): String {
        if (!shouldDisablePartialImagesForFHLExactResponses(payload, size)) return ""
        val parsed = parseSizePixels(size.ifBlank { payload.optString("size") }) ?: return ""
        val divisor = gcd(parsed.width, parsed.height)
        if (divisor <= 0) return ""
        val aspect = "${parsed.width / divisor}:${parsed.height / divisor}"
        if (parsed.width == parsed.height) {
            return "请严格按照 $aspect 正方形画幅生成最终图片，整张图片必须为 $aspect 比例。"
        }
        if (parsed.height > parsed.width) {
            return "请严格按照 $aspect 竖版画幅生成最终图片，整张图片必须为 $aspect 竖向构图，不要正方形，不要横版。"
        }
        return "请严格按照 $aspect 横版画幅生成最终图片，整张图片必须为 $aspect 横向构图，不要正方形，不要竖版。"
    }

    private fun gcd(left: Int, right: Int): Int {
        var a = kotlin.math.abs(left)
        var b = kotlin.math.abs(right)
        while (b != 0) {
            val next = a % b
            a = b
            b = next
        }
        return a
    }

    private fun batchVariationInstruction(payload: JSONObject): String {
        val batchCount = payload.optInt("batchCount", 1)
        val batchIndex = payload.optInt("batchIndex", -1)
        val variationKey = payload.optString("batchVariationKey").trim()
        if (batchIndex < 0 || variationKey.isBlank()) return ""
        val visibleBatchTotal = max(batchCount, batchIndex + 1)
        val requestRunId = payload.optString("requestRunId").trim().ifBlank { "none" }
        return "Request isolation: this is an independent generation task, image ${batchIndex + 1} of $visibleBatchTotal. Internal run id: $requestRunId. Variation key: $variationKey. You must return a distinct non-duplicate final image for this task. Preserve the user's visible prompt and style, but vary composition, pose, object placement, lighting, camera angle, expression, texture, or fine details where appropriate. Do not render the run id, variation key, or this instruction as visible text."
    }

    private fun promptWithBatchVariation(payload: JSONObject): String {
        val prompt = payload.optString("prompt").trim()
        val variation = batchVariationInstruction(payload)
        return if (variation.isBlank()) prompt else "$prompt\n\n$variation"
    }

    private fun buildImagesRequestBody(context: Context, payload: JSONObject): HttpRequestBody {
        val baseUrl = normalizeBaseURL(payload.optString("baseURL"))
        val mode = if (payload.optString("mode") == "edit") "edit" else "generate"
        val imageModel = payload.optString("imageModelID", defaultImageModel).ifBlank { defaultImageModel }
        val size = payload.optString("size", "864x1536").ifBlank { "864x1536" }
        val quality = payload.optString("quality", "auto").ifBlank { "auto" }
        val outputFormat = payload.optString("outputFormat", "png").ifBlank { "png" }
        val includeExtended = payload.optString("requestPolicy", "openai") == "compat"
        val useNewAPICompat = payload.optBoolean("imagesNewAPICompat", false)
        val partialImages = normalizePartialImages(payload.opt("partialImages"))
        if (mode == "edit") {
            val sourceDataUrls = resolveSourceDataURLs(context, payload)
            if (sourceDataUrls.length() == 0) {
                throw JobRequestException("Images API edit mode requires at least one reference image", null, false)
            }
            val boundary = "----FHLStudioAndroid${UUID.randomUUID().toString().replace("-", "")}"
            val out = ByteArrayOutputStream()
            for (i in 0 until sourceDataUrls.length()) {
                val image = parseDataURLImage(sourceDataUrls.optString(i))
                appendMultipartFile(
                    out,
                    boundary,
                    if (i == 0) "image" else "image[]",
                    "source-${i + 1}.${imageExtensionForMimeType(image.mimeType)}",
                    image.mimeType,
                    image.bytes,
                )
            }
            val maskB64 = payload.optString("maskB64").trim()
            if (maskB64.isNotBlank()) {
                appendMultipartFile(out, boundary, "mask", "mask.png", "image/png", Base64.decode(maskB64, Base64.DEFAULT))
            }
            appendMultipartField(out, boundary, "prompt", promptWithBatchVariation(payload))
            appendMultipartField(out, boundary, "model", imageModel)
            appendMultipartField(out, boundary, "n", "1")
            appendMultipartField(out, boundary, "size", size)
            appendMultipartField(out, boundary, "quality", quality)
            appendMultipartField(out, boundary, "output_format", outputFormat)
            if (useNewAPICompat || supportsImagesResponseFormat(imageModel, mode)) appendMultipartField(out, boundary, "response_format", "b64_json")
            if (!useNewAPICompat) {
                appendMultipartField(out, boundary, "stream", "true")
                appendMultipartField(out, boundary, "partial_images", partialImages.toString())
            }
            val seed = payload.optLong("seed", 0L)
            val negativePrompt = payload.optString("negativePrompt").trim()
            if (includeExtended && seed > 0L) appendMultipartField(out, boundary, "seed", seed.toString())
            if (includeExtended && negativePrompt.isNotBlank()) appendMultipartField(out, boundary, "negative_prompt", negativePrompt)
            out.write("--$boundary--\r\n".toByteArray(Charsets.UTF_8))
            return HttpRequestBody("$baseUrl/v1/images/edits", out.toByteArray(), "multipart/form-data; boundary=$boundary")
        }

        val body = JSONObject()
            .put("model", imageModel)
            .put("prompt", promptWithBatchVariation(payload))
            .put("n", 1)
            .put("size", size)
            .put("quality", quality)
            .put("output_format", outputFormat)
        if (useNewAPICompat || supportsImagesResponseFormat(imageModel, mode)) body.put("response_format", "b64_json")
        if (!useNewAPICompat) {
            body.put("stream", true)
            body.put("partial_images", partialImages)
        }
        val seed = payload.optLong("seed", 0L)
        val negativePrompt = payload.optString("negativePrompt").trim()
        if (includeExtended && seed > 0L) body.put("seed", seed)
        if (includeExtended && negativePrompt.isNotBlank()) body.put("negative_prompt", negativePrompt)
        return HttpRequestBody(
            "$baseUrl/v1/images/generations",
            body.toString().toByteArray(Charsets.UTF_8),
            "application/json",
        )
    }

    private fun logFHLImagesRequestDiagnostics(payload: JSONObject) {
        if (normalizeAPIMode(payload.optString("apiMode", "responses")) != "images") return
        if (!isFHLBaseURL(payload.optString("baseURL"))) return
        val diagnostics = JSONObject()
            .put("apiMode", "images")
            .put("apiLabel", payload.optString("apiLabel", "FHL").ifBlank { "FHL" })
            .put("baseURLHost", hostForURL(payload.optString("baseURL")))
            .put("model", payload.optString("imageModelID", defaultImageModel).ifBlank { defaultImageModel })
            .put("mode", if (payload.optString("mode") == "edit") "edit" else "generate")
            .put("size", payload.optString("size", "1024x1024").ifBlank { "1024x1024" })
            .put("quality", payload.optString("quality", "auto").ifBlank { "auto" })
            .put("outputFormat", payload.optString("outputFormat", "png").ifBlank { "png" })
            .put("sourceCount", payload.optJSONArray("sourceImagePaths")?.length() ?: 0)
            .put("batchIndex", payload.optInt("batchIndex", 0))
            .put("requestRunId", payload.optString("requestRunId"))
            .put("imagesNewAPICompat", payload.optBoolean("imagesNewAPICompat", false))
        Log.i(logTag, "FHL Images request ${diagnostics}")
    }

    private fun isFHLBaseURL(baseURL: String): Boolean {
        val normalized = baseURL.trim().trimEnd('/').lowercase(Locale.US).removeSuffix("/v1")
        return normalized == "https://www.fhl.mom"
    }

    private fun hostForURL(value: String): String {
        return try {
            URI(value.trim()).host.orEmpty()
        } catch (_: Exception) {
            ""
        }
    }

    private fun appendMultipartField(out: ByteArrayOutputStream, boundary: String, name: String, value: String) {
        out.write("--$boundary\r\n".toByteArray(Charsets.UTF_8))
        out.write("Content-Disposition: form-data; name=\"$name\"\r\n\r\n".toByteArray(Charsets.UTF_8))
        out.write(value.toByteArray(Charsets.UTF_8))
        out.write("\r\n".toByteArray(Charsets.UTF_8))
    }

    private fun appendMultipartFile(
        out: ByteArrayOutputStream,
        boundary: String,
        name: String,
        fileName: String,
        mimeType: String,
        bytes: ByteArray,
    ) {
        out.write("--$boundary\r\n".toByteArray(Charsets.UTF_8))
        out.write("Content-Disposition: form-data; name=\"$name\"; filename=\"$fileName\"\r\n".toByteArray(Charsets.UTF_8))
        out.write("Content-Type: $mimeType\r\n\r\n".toByteArray(Charsets.UTF_8))
        out.write(bytes)
        out.write("\r\n".toByteArray(Charsets.UTF_8))
    }

    private fun parseDataURLImage(dataURL: String): DataURLImage {
        val comma = dataURL.indexOf(',')
        if (comma < 0 || !dataURL.startsWith("data:image/", ignoreCase = true)) {
            throw JobRequestException("Invalid image data URL", null, false)
        }
        val meta = dataURL.substring(0, comma)
        val semi = meta.indexOf(';')
        val mimeType = meta.substring(5, if (semi > 0) semi else meta.length).ifBlank { "image/png" }
        val payload = dataURL.substring(comma + 1).replace(Regex("\\s+"), "")
        return DataURLImage(mimeType, payload, Base64.decode(payload, Base64.DEFAULT))
    }

    private fun imageExtensionForMimeType(mimeType: String): String {
        return when (mimeType.lowercase(Locale.US)) {
            "image/jpeg", "image/jpg" -> "jpg"
            "image/webp" -> "webp"
            else -> "png"
        }
    }

    private fun supportsImagesResponseFormat(modelID: String, mode: String): Boolean {
        val model = modelID.lowercase(Locale.US)
        val family = when {
            model.startsWith("dall-e-2") -> "dalle2"
            model.startsWith("dall-e-3") -> "dalle3"
            model.startsWith("gpt-image") || model.startsWith("chatgpt-image") -> "gpt-image"
            else -> "other"
        }
        return if (mode == "edit") family == "dalle2" else family == "dalle2" || family == "dalle3"
    }

    private fun summarizeImagesSSEEvent(event: JSONObject): String {
        return when (event.optString("type")) {
            "image_generation.partial_image", "image_edit.partial_image" -> "Images API partial preview received"
            "image_generation.completed", "image_edit.completed" -> "Images API completed"
            else -> event.optString("type").takeIf { it.isNotBlank() }?.let { "Images API event: $it" } ?: ""
        }
    }

    private fun extractImagesStreamResult(
        context: Context,
        jobId: String,
        payload: JSONObject,
        raw: String,
        rawPath: String,
    ): JobImageResult? {
        var fallbackPartial = ""
        for (line in raw.split(Regex("\\r?\\n"))) {
            val event = parseSSEEventLine(line) ?: continue
            val type = event.optString("type")
            if ((type == "image_generation.partial_image" || type == "image_edit.partial_image") && event.optString("b64_json").isNotBlank()) {
                fallbackPartial = event.optString("b64_json")
            }
            if ((type == "image_generation.completed" || type == "image_edit.completed") && event.optString("b64_json").isNotBlank()) {
                return JobImageResult(event.optString("b64_json"), "", "images_api", rawPath)
            }
            val fromObject = extractImagesJSONObject(context, jobId, payload, event, rawPath)
            if (fromObject != null) return fromObject
        }
        return if (fallbackPartial.isNotBlank()) JobImageResult(fallbackPartial, "", "images_api_partial", rawPath) else null
    }

    private fun extractImagesJSONResult(
        context: Context,
        jobId: String,
        payload: JSONObject,
        raw: String,
        rawPath: String,
    ): JobImageResult {
        val parsed = try {
            JSONObject(raw)
        } catch (error: Exception) {
            throw JobRequestException("Images API JSON parse failed: ${error.message ?: error.javaClass.simpleName}", rawPath, true)
        }
        describeJSONProblem(parsed, 0)?.let {
            throw JobRequestException(it, rawPath, isRetryableRaw(raw, payloadStatusCode(parsed)))
        }
        parsed.optJSONObject("error")?.optString("message")?.takeIf { it.isNotBlank() }?.let {
            throw JobRequestException(it, rawPath, isRetryableRaw(raw, 0))
        }
        return extractImagesJSONObject(context, jobId, payload, parsed, rawPath)
            ?: throw JobRequestException("Images API did not return a usable image", rawPath, true)
    }

    private fun extractImagesJSONObject(
        context: Context,
        jobId: String,
        payload: JSONObject,
        parsed: JSONObject,
        rawPath: String,
    ): JobImageResult? {
        val directB64 = parsed.optString("b64_json")
        if (directB64.isNotBlank()) return JobImageResult(directB64, parsed.optString("revised_prompt"), "images_api", rawPath)
        val data = parsed.optJSONArray("data")
        val first = data?.optJSONObject(0)
        val firstB64 = first?.optString("b64_json").orEmpty()
        if (firstB64.isNotBlank()) return JobImageResult(firstB64, first?.optString("revised_prompt").orEmpty(), "images_api", rawPath)
        val firstUrl = first?.optString("url").orEmpty().ifBlank { parsed.optString("url") }
        if (firstUrl.isNotBlank()) {
            return JobImageResult(imageResultToBase64(context, jobId, firstUrl, payload, apimartImageDownloadTimeoutMs), "", "images_api_url", rawPath)
        }
        return null
    }

    private fun uploadAPIMartImage(
        context: Context,
        jobId: String,
        baseUrl: String,
        apiKey: String,
        dataURL: String,
        index: Int,
        sourceCount: Int,
        attempt: Int,
        payload: JSONObject,
        startedAt: Long,
    ): String {
        val image = parseDataURLImage(dataURL)
        val boundary = "----FHLStudioAndroid${UUID.randomUUID().toString().replace("-", "")}"
        val out = ByteArrayOutputStream()
        appendMultipartFile(out, boundary, "file", "source-${index + 1}.${imageExtensionForMimeType(image.mimeType)}", image.mimeType, image.bytes)
        out.write("--$boundary--\r\n".toByteArray(Charsets.UTF_8))
        updateSlot(context, jobId, "snapshot") { slot ->
            slot.put("stage", "APIMart upload reference ${index + 1}/$sourceCount")
            slot.put("elapsedSec", ((System.currentTimeMillis() - startedAt) / 1000.0))
            slot.put("bytes", image.bytes.size)
        }
        val response = httpRequestText(
            jobId,
            apimartEndpoint(baseUrl, "/v1/uploads/images"),
            "POST",
            mapOf("Authorization" to "Bearer $apiKey", "Accept" to "application/json", "Content-Type" to "multipart/form-data; boundary=$boundary"),
            out.toByteArray(),
            payload,
            apimartUploadTimeoutMs,
            apimartUploadTimeoutMs,
        )
        val parsed = parseAPIMartJSON(context, jobId, "upload-image", attempt, response)
        val url = resultImagesFromPayload(parsed.first).firstOrNull().orEmpty()
        if (url.isBlank()) throw JobRequestException("APIMart upload did not return an image URL", parsed.second, true)
        return url
    }

    private fun submitAPIMartTask(
        context: Context,
        jobId: String,
        baseUrl: String,
        apiKey: String,
        payload: JSONObject,
        imageUrls: List<String>,
        attempt: Int,
        startedAt: Long,
    ): APIMartSubmitResult {
        val model = payload.optString("imageModelID", defaultImageModel).ifBlank { defaultImageModel }
        val resolution = resolutionForAPIMartSize(payload.optString("size", "auto"))
        val body = JSONObject()
            .put("model", model)
            .put("prompt", promptWithBatchVariation(payload))
            .put("n", 1)
            .put("size", aspectForAPIMartSize(payload.optString("size", "auto")))
            .put("resolution", normalizeAPIMartResolution(resolution, model))
            .put("official_fallback", false)
        if (imageUrls.isNotEmpty()) body.put("image_urls", JSONArray(imageUrls))
        logAPIMartSubmitDiagnostics(baseUrl, body)
        updateSlot(context, jobId, "snapshot") { slot ->
            slot.put("stage", "APIMart submit async task")
            slot.put("elapsedSec", ((System.currentTimeMillis() - startedAt) / 1000.0))
        }
        appendUpstreamSubmitAttemptAudit(context, jobId, payload, "apimart")
        val response = httpRequestText(
            jobId,
            apimartEndpoint(baseUrl, "/v1/images/generations"),
            "POST",
            mapOf("Authorization" to "Bearer $apiKey", "Accept" to "application/json", "Content-Type" to "application/json"),
            body.toString().toByteArray(Charsets.UTF_8),
            payload,
            30_000,
            apimartSubmitTimeoutMs,
        )
        val parsed = parseAPIMartJSON(context, jobId, "submit-task", attempt, response)
        val taskId = extractTaskId(parsed.first)
        val images = resultImagesFromPayload(parsed.first)
        if (taskId.isBlank() && images.isEmpty()) {
            throw JobRequestException("APIMart did not return task_id or image result", parsed.second, true)
        }
        if (taskId.isNotBlank()) {
            updateSlot(context, jobId, "snapshot") { slot ->
                slot.put("apimartTaskId", taskId)
                slot.put("apimartBaseURL", baseUrl)
                slot.put("apimartTaskStatus", "submitted")
            }
        }
        return APIMartSubmitResult(taskId, images, parsed.second)
    }

    private fun pollAPIMartTask(
        context: Context,
        jobId: String,
        baseUrl: String,
        apiKey: String,
        taskId: String,
        payload: JSONObject,
        attempt: Int,
        startedAt: Long,
    ): APIMartPollResult {
        val deadline = System.currentTimeMillis() + apimartTaskTimeoutMs
        var rawPath: String? = null
        var lastStatus = ""
        val successStatuses = setOf("success", "succeed", "succeeded", "completed", "complete", "done", "finished", "ok")
        val failureStatuses = setOf("failed", "fail", "error", "cancelled", "canceled", "rejected")
        while (System.currentTimeMillis() < deadline) {
            sleepWithCancel(jobId, apimartPollIntervalMs)
            updateSlot(context, jobId, "snapshot") { slot ->
                slot.put("stage", "APIMart polling task $taskId${if (lastStatus.isNotBlank()) " ($lastStatus)" else ""}")
                slot.put("elapsedSec", ((System.currentTimeMillis() - startedAt) / 1000.0))
                slot.put("apimartTaskId", taskId)
                if (lastStatus.isNotBlank()) slot.put("apimartTaskStatus", lastStatus)
            }
            val response = httpRequestText(
                jobId,
                apimartEndpoint(baseUrl, "/v1/tasks/${Uri.encode(taskId)}?language=zh"),
                "GET",
                mapOf("Authorization" to "Bearer $apiKey", "Accept" to "application/json"),
                null,
                payload,
                30_000,
                apimartPollTimeoutMs,
            )
            val parsed = parseAPIMartJSON(context, jobId, "poll-task", attempt, response)
            rawPath = parsed.second ?: rawPath
            val images = resultImagesFromPayload(parsed.first)
            if (images.isNotEmpty()) return APIMartPollResult(images, rawPath)
            lastStatus = statusFromPayload(parsed.first)
            if (successStatuses.contains(lastStatus)) {
                throw JobRequestException("APIMart task completed without an image", rawPath, false, taskId, lastStatus)
            }
            if (failureStatuses.contains(lastStatus)) {
                throw JobRequestException(firstErrorMessage(parsed.first).ifBlank { "APIMart task failed: $lastStatus" }, rawPath, false, taskId, lastStatus)
            }
        }
        throw JobRequestException("APIMart task timed out locally: $taskId", rawPath, false, taskId, lastStatus.ifBlank { "timeout" })
    }

    private fun parseAPIMartJSON(
        context: Context,
        jobId: String,
        label: String,
        attempt: Int,
        response: HttpTextResponse,
    ): Pair<JSONObject, String?> {
        val rawPath = writeRawLog(context, "apimart-$label-attempt$attempt-${jobId.takeLast(8)}.txt", response.body)
        val data = try {
            if (response.body.trim().isBlank()) JSONObject() else JSONObject(response.body)
        } catch (error: Exception) {
            throw JobRequestException("APIMart $label JSON parse failed: ${error.message ?: error.javaClass.simpleName}", rawPath, response.status >= 500)
        }
        if (response.status !in 200..299) {
            throw JobRequestException("APIMart $label returned ${response.status}: ${firstErrorMessage(data).ifBlank { response.body.take(240) }}", rawPath, response.status in listOf(502, 503, 504, 524))
        }
        if ((data.has("success") && !data.optBoolean("success", true)) || data.optInt("code", 0) >= 400) {
            throw JobRequestException("APIMart $label returned error: ${firstErrorMessage(data).ifBlank { data.optString("code", "unknown") }}", rawPath, true)
        }
        return data to rawPath
    }

    private fun httpRequestText(
        jobId: String,
        url: String,
        method: String,
        headers: Map<String, String>,
        bodyBytes: ByteArray?,
        payload: JSONObject,
        connectTimeout: Int,
        readTimeout: Int,
    ): HttpTextResponse {
        if (cancelledJobIds.contains(jobId)) throw CancellationException("cancelled")
        val connection = openHttpConnection(url, payload.optString("proxyMode", "system"), payload.optString("proxyURL", "")).apply {
            requestMethod = method
            instanceFollowRedirects = shouldFollowRedirect(method)
            this.connectTimeout = connectTimeout
            this.readTimeout = readTimeout
            doInput = true
            setRequestProperty("User-Agent", "fhl-studio-android")
            for ((key, value) in headers) setRequestProperty(key, value)
            if (bodyBytes != null && bodyBytes.isNotEmpty()) {
                doOutput = true
                useCaches = false
                setFixedLengthStreamingMode(bodyBytes.size)
            }
        }
        registerActiveConnection(jobId, connection)
        try {
            if (bodyBytes != null && bodyBytes.isNotEmpty()) {
                connection.outputStream.use { it.write(bodyBytes) }
            }
            val status = connection.responseCode
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            val body = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            return HttpTextResponse(status, body, connection.contentType ?: "")
        } finally {
            unregisterActiveConnection(jobId, connection)
        }
    }

    private fun httpRequestBytes(
        jobId: String,
        url: String,
        payload: JSONObject,
        readTimeout: Int,
    ): HttpBytesResponse {
        var lastError: Exception? = null
        for (attempt in 1..3) {
            if (cancelledJobIds.contains(jobId)) throw CancellationException("cancelled")
            val connection = openHttpConnection(url, payload.optString("proxyMode", "system"), payload.optString("proxyURL", "")).apply {
                requestMethod = "GET"
                instanceFollowRedirects = true
                connectTimeout = 30_000
                this.readTimeout = readTimeout
                doInput = true
                setRequestProperty("Accept", "image/*,*/*")
                setRequestProperty("User-Agent", "fhl-studio-android")
            }
            registerActiveConnection(jobId, connection)
            try {
                val status = connection.responseCode
                val stream = if (status >= 400) connection.errorStream else connection.inputStream
                val bytes = stream?.use { it.readBytes() } ?: ByteArray(0)
                return HttpBytesResponse(status, bytes, connection.contentType ?: "")
            } catch (exception: Exception) {
                if (exception is CancellationException) throw exception
                lastError = exception
                if (attempt >= 3) throw exception
                Thread.sleep((attempt * 600L).coerceAtMost(1_800L))
            } finally {
                unregisterActiveConnection(jobId, connection)
            }
        }
        throw lastError ?: JobRequestException("Image download failed", null, true)
    }

    private fun registerActiveConnection(jobId: String, connection: HttpURLConnection) {
        activeConnections[jobId] = connection
        if (cancelledJobIds.contains(jobId)) {
            activeConnections.remove(jobId, connection)
            connection.disconnect()
            throw CancellationException("cancelled")
        }
    }

    private fun unregisterActiveConnection(jobId: String, connection: HttpURLConnection) {
        activeConnections.remove(jobId, connection)
        connection.disconnect()
    }

    private fun disconnectActiveConnection(jobId: String) {
        val connection = activeConnections[jobId] ?: return
        if (activeConnections.remove(jobId, connection)) connection.disconnect()
    }

    private fun imageResultToBase64(context: Context, jobId: String, value: String, payload: JSONObject, readTimeout: Int): String {
        val trimmed = value.trim()
        if (trimmed.startsWith("data:image/", ignoreCase = true)) {
            return parseDataURLImage(trimmed).base64
        }
        val response = httpRequestBytes(jobId, trimmed, payload, readTimeout)
        if (response.status !in 200..299) {
            val rawPath = writeRawLog(context, "image-download-${jobId.takeLast(8)}.txt", response.bytes.decodeToString())
            throw JobRequestException("Image download failed ${response.status}", rawPath, response.status in listOf(502, 503, 504, 524))
        }
        return Base64.encodeToString(response.bytes, Base64.NO_WRAP)
    }

    private fun apimartEndpoint(baseUrl: String, path: String): String {
        val root = baseUrl.trim().trimEnd('/').replace(Regex("/v1$", RegexOption.IGNORE_CASE), "")
        return "$root${if (path.startsWith("/")) path else "/$path"}"
    }

    private fun comparableBaseURL(value: String): String {
        return value.trim().lowercase(Locale.US).trimEnd('/').replace(Regex("/v1$", RegexOption.IGNORE_CASE), "")
    }

    private fun normalizeAPIMartBaseURL(raw: String): String {
        val normalized = raw.trim().trimEnd('/').replace(Regex("/v1$", RegexOption.IGNORE_CASE), "")
        if (normalized.isBlank()) throw JobRequestException("APIMart BASE_URL is empty", null, false)
        return normalized
    }

    private fun apimartSubmissionBaseURLs(raw: String): List<String> {
        val normalized = normalizeAPIMartBaseURL(raw)
        return listOf(
            if (comparableBaseURL(normalized) == comparableBaseURL(apimartOfficialBaseUrl)) apimartOfficialBaseUrl else normalized,
        )
    }

    private fun apimartQueryBaseURLCandidates(raw: String): List<String> {
        val normalized = normalizeAPIMartBaseURL(raw)
        return if (comparableBaseURL(normalized) == comparableBaseURL(apimartOfficialBaseUrl)) {
            listOf(apimartOfficialBaseUrl, apimartLegacyBaseUrl)
        } else {
            listOf(normalized)
        }
    }

    private fun paidSubmissionAttemptNumbers(apiMode: String): IntRange {
        return when (normalizeAPIMode(apiMode)) {
            "images", "responses", "apimart", "runninghub" -> 1..1
            else -> 1..1
        }
    }

    private fun apiModeRequiresCredential(apiMode: String): Boolean {
        return normalizeAPIMode(apiMode) in setOf("images", "responses", "apimart")
    }

    private fun payloadForPersistence(payload: JSONObject, groupId: String): JSONObject {
        require(groupId.isNotBlank()) { "Android job group ID must not be blank" }
        val stored = JSONObject(payload.toString())
        stored.remove("apiKey")
        return stored
            .put("groupId", groupId)
            .put("apiMode", normalizeAPIMode(payload.optString("apiMode", "responses")))
    }

    private fun temporaryCredentialAvailable(context: Context, groupId: String, apiMode: String): Boolean {
        if (!apiModeRequiresCredential(apiMode)) return true
        return try {
            AndroidCredentialStore(context).getTemporaryJobCredential(groupId).isNotBlank()
        } catch (_: Exception) {
            false
        }
    }

    private fun shouldFollowRedirect(method: String): Boolean = method.equals("GET", ignoreCase = true)

    private fun isAPIMartNetworkFallbackError(error: Throwable): Boolean {
        if (error is JobRequestException && !error.retryable) return false
        val text = "${error.javaClass.simpleName} ${error.message ?: ""}".lowercase(Locale.US)
        return listOf(
            "sockettimeoutexception",
            "connectexception",
            "unknownhostexception",
            "failed to connect",
            "connect timed out",
            "network is unreachable",
            "no route to host",
            "software caused connection abort",
        ).any { text.contains(it) }
    }

    private fun aspectForAPIMartSize(size: String): String {
        val normalized = size.trim().lowercase(Locale.US)
        parseAPIMartAspect(normalized)?.let { return it.first }
        return when (normalized) {
            "auto" -> "auto"
            "1024x1024", "2048x2048", "2880x2880" -> "1:1"
            "1536x1024", "2048x1360", "3456x2304" -> "3:2"
            "1024x1536", "1360x2048", "2304x3456" -> "2:3"
            "1536x1152", "2048x1536", "3840x2880" -> "4:3"
            "1152x1536", "1536x2048", "2880x3840" -> "3:4"
            "1520x1216", "2040x1632", "3840x3072" -> "5:4"
            "1216x1520", "1632x2040", "3072x3840" -> "4:5"
            "1536x864", "2048x1152", "3840x2160" -> "16:9"
            "864x1536", "1152x2048", "2160x3840" -> "9:16"
            "1536x768", "2048x1024", "3840x1920" -> "2:1"
            "768x1536", "1024x2048", "1920x3840" -> "1:2"
            "1536x512", "2040x680", "3840x1280" -> "3:1"
            "512x1536", "680x2040", "1280x3840" -> "1:3"
            else -> nearestAPIMartAspectForPixels(normalized).ifBlank { "1:1" }
        }
    }

    private fun resolutionForAPIMartSize(size: String): String {
        val normalized = size.trim().lowercase(Locale.US)
        parseAPIMartAspect(normalized)?.second?.takeIf { it.isNotBlank() }?.let { return it }
        return when (normalized) {
            "2048x2048", "2048x1360", "1360x2048", "2048x1536", "1536x2048",
            "2040x1632", "1632x2040", "2048x1152", "1152x2048", "2048x1024",
            "1024x2048", "2040x680", "680x2040" -> "2k"
            "2880x2880", "3456x2304", "2304x3456", "3840x2880", "2880x3840",
            "3840x3072", "3072x3840", "3840x2160", "2160x3840", "3840x1920",
            "1920x3840", "3840x1280", "1280x3840" -> "4k"
            else -> "1k"
        }
    }

    private fun parseAPIMartAspect(value: String): Pair<String, String>? {
        val match = Regex("^(\\d+:\\d+|auto)(?:@(1k|2k|4k))?$").matchEntire(value) ?: return null
        val aspect = match.groupValues[1]
        val allowed = setOf("auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "3:1", "1:3", "21:9", "9:21")
        if (!allowed.contains(aspect)) return null
        return aspect to match.groupValues.getOrElse(2) { "" }
    }

    private fun nearestAPIMartAspectForPixels(size: String): String {
        val match = Regex("^(\\d+)x(\\d+)$").matchEntire(size) ?: return ""
        val width = match.groupValues[1].toDoubleOrNull() ?: return ""
        val height = match.groupValues[2].toDoubleOrNull() ?: return ""
        if (width <= 0.0 || height <= 0.0) return ""
        val ratio = width / height
        val aspects = listOf("1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "3:1", "1:3", "21:9", "9:21")
        var best = "1:1"
        var bestDiff = Double.POSITIVE_INFINITY
        for (aspect in aspects) {
            val parts = aspect.split(":")
            val candidate = parts[0].toDouble() / parts[1].toDouble()
            val diff = kotlin.math.abs(kotlin.math.ln(ratio) - kotlin.math.ln(candidate))
            if (diff < bestDiff) {
                best = aspect
                bestDiff = diff
            }
        }
        return best
    }

    private fun normalizeAPIMartResolution(resolution: String, model: String): String {
        return if (model.lowercase(Locale.US).contains("gemini")) resolution.uppercase(Locale.US) else resolution
    }

    private fun logAPIMartSubmitDiagnostics(baseUrl: String, body: JSONObject) {
        val diagnostics = JSONObject()
            .put("baseURLHost", hostForURL(baseUrl))
            .put("model", body.optString("model"))
            .put("size", body.optString("size"))
            .put("resolution", body.optString("resolution"))
            .put("official_fallback", body.optBoolean("official_fallback", true))
            .put("image_urls_count", body.optJSONArray("image_urls")?.length() ?: 0)
        Log.i(logTag, "APIMart submit request $diagnostics")
    }

    private fun resultImagesFromPayload(value: Any?, key: String? = null, depth: Int = 0, out: MutableList<String> = mutableListOf()): List<String> {
        if (depth > 8 || value == null || value == JSONObject.NULL) return out.distinct()
        if (value is String) {
            val trimmed = value.trim()
            val keyAllows = key == null || Regex("url|image|output|src|uri|file", RegexOption.IGNORE_CASE).containsMatchIn(key)
            if (trimmed.isNotBlank() && keyAllows && (trimmed.startsWith("http://", true) || trimmed.startsWith("https://", true) || trimmed.startsWith("data:image/", true))) {
                out += trimmed
            }
            return out.distinct()
        }
        if (value is JSONArray) {
            for (i in 0 until value.length()) resultImagesFromPayload(value.opt(i), key, depth + 1, out)
            return out.distinct()
        }
        if (value is JSONObject) {
            val keys = value.keys()
            while (keys.hasNext()) {
                val childKey = keys.next()
                resultImagesFromPayload(value.opt(childKey), childKey, depth + 1, out)
            }
        }
        return out.distinct()
    }

    private fun extractTaskId(value: Any?, depth: Int = 0): String {
        if (depth > 8 || value == null || value == JSONObject.NULL) return ""
        if (value is JSONArray) {
            for (i in 0 until value.length()) {
                val nested = extractTaskId(value.opt(i), depth + 1)
                if (nested.isNotBlank()) return nested
            }
            return ""
        }
        if (value !is JSONObject) return ""
        val keys = value.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            val child = value.opt(key)
            if ((key == "task_id" || key == "taskId") && child is String && child.trim().isNotBlank()) return child.trim()
            if (key == "id" && child is String && Regex("^task(?:[_-]|$)", RegexOption.IGNORE_CASE).containsMatchIn(child.trim())) return child.trim()
            val nested = extractTaskId(child, depth + 1)
            if (nested.isNotBlank()) return nested
        }
        return ""
    }

    private fun statusFromPayload(value: JSONObject): String {
        return statusValueFromPayload(value)
            .trim()
            .lowercase(Locale.US)
    }

    private fun statusValueFromPayload(value: Any?, key: String? = null, depth: Int = 0): String {
        if (depth > 8 || value == null || value == JSONObject.NULL) return ""
        if (value is String) {
            val trimmed = value.trim()
            return if (trimmed.isNotBlank() && (key == "status" || key == "state")) trimmed else ""
        }
        if (value is JSONArray) {
            for (i in 0 until value.length()) {
                val status = statusValueFromPayload(value.opt(i), key, depth + 1)
                if (status.isNotBlank()) return status
            }
            return ""
        }
        if (value is JSONObject) {
            for (preferred in listOf("status", "state")) {
                val status = statusValueFromPayload(value.opt(preferred), preferred, depth + 1)
                if (status.isNotBlank()) return status
            }
            val keys = value.keys()
            while (keys.hasNext()) {
                val childKey = keys.next()
                val status = statusValueFromPayload(value.opt(childKey), childKey, depth + 1)
                if (status.isNotBlank()) return status
            }
        }
        return ""
    }

    private fun firstErrorMessage(value: Any?, key: String? = null, depth: Int = 0): String {
        if (depth > 8 || value == null || value == JSONObject.NULL) return ""
        if (value is String) {
            val trimmed = value.trim()
            return if (trimmed.isNotBlank() && key != null && Regex("message|msg|error|reason|detail|description", RegexOption.IGNORE_CASE).containsMatchIn(key)) trimmed else ""
        }
        if (value is JSONObject) {
            for (preferred in listOf("message", "msg", "error_message", "reason", "detail", "description", "error")) {
                val msg = firstErrorMessage(value.opt(preferred), preferred, depth + 1)
                if (msg.isNotBlank()) return msg
            }
            val keys = value.keys()
            while (keys.hasNext()) {
                val childKey = keys.next()
                val msg = firstErrorMessage(value.opt(childKey), childKey, depth + 1)
                if (msg.isNotBlank()) return msg
            }
        }
        if (value is JSONArray) {
            for (i in 0 until value.length()) {
                val msg = firstErrorMessage(value.opt(i), key, depth + 1)
                if (msg.isNotBlank()) return msg
            }
        }
        return ""
    }

    private fun normalizeAPIMode(raw: String): String {
        return when (raw.trim().lowercase(Locale.US)) {
            "images" -> "images"
            "apimart" -> "apimart"
            "runninghub" -> "runninghub"
            else -> "responses"
        }
    }

    private fun normalizeSubmissionAPIMode(raw: String): String {
        return when (val normalized = raw.trim().lowercase(Locale.US)) {
            "images", "responses", "apimart", "runninghub" -> normalized
            else -> throw IllegalArgumentException("Android 提交包含不支持的 API 形态，已阻止可能的错误付费请求。")
        }
    }

    private fun isOfficialFHLBaseURL(baseURL: String): Boolean {
        val uri = try {
            URI(baseURL.trim())
        } catch (_: Exception) {
            return false
        }
        if (!uri.isAbsolute || !uri.scheme.equals("https", ignoreCase = true)) return false
        if (!uri.host.equals("www.fhl.mom", ignoreCase = true)) return false
        if (uri.rawUserInfo != null || uri.rawQuery != null || uri.rawFragment != null) return false
        if (uri.port != -1 && uri.port != 443) return false
        return (uri.rawPath ?: "") in setOf("", "/", "/v1", "/v1/")
    }

    private fun acceptedFHLPoolSlot(apiMode: String, baseURL: String, rawSlot: Int): Int? {
        if (rawSlot !in 1..10) return null
        if (apiMode.trim().lowercase(Locale.US) !in setOf("images", "responses")) return null
        return rawSlot.takeIf { isOfficialFHLBaseURL(baseURL) }
    }

    private fun validatedNewSubmissionFHLPoolSlot(apiMode: String, baseURL: String, rawSlot: Int): Int? {
        val acceptedSlot = acceptedFHLPoolSlot(apiMode, baseURL, rawSlot)
        if (apiMode in setOf("images", "responses") && isOfficialFHLBaseURL(baseURL) && acceptedSlot == null) {
            throw IllegalArgumentException("官方 FHL 生图任务缺少合法的 FHL1-FHL10 槽位，已阻止绕过共享 4/40 调度。")
        }
        return acceptedSlot
    }

    private fun hasUnsafeLabelCodePoint(value: String): Boolean {
        var index = 0
        while (index < value.length) {
            val codePoint = value.codePointAt(index)
            when (Character.getType(codePoint)) {
                Character.CONTROL.toInt(),
                Character.FORMAT.toInt(),
                Character.NON_SPACING_MARK.toInt(),
                Character.COMBINING_SPACING_MARK.toInt(),
                Character.ENCLOSING_MARK.toInt(),
                -> return true
            }
            index += Character.charCount(codePoint)
        }
        return false
    }

    private fun apiLabelForAssignment(
        apiMode: String,
        baseURL: String,
        rawLabel: String,
        rawFHLImagesPoolSlot: Int,
    ): String {
        val fhlImagesPoolSlot = acceptedFHLPoolSlot(apiMode, baseURL, rawFHLImagesPoolSlot)
        if (fhlImagesPoolSlot != null) return "FHL$fhlImagesPoolSlot"
        val fallback = rawLabel.trim().ifBlank { "FHL" }
        // FHLn is reserved for a validated official FHL pool slot; do not let
        // a non-pool or invalid assignment spoof a slot label.
        if (hasUnsafeLabelCodePoint(fallback)) return "FHL"
        val normalizedFallback = Normalizer.normalize(fallback, Normalizer.Form.NFKC)
        val displaySkeleton = buildString {
            var index = 0
            while (index < normalizedFallback.length) {
                val codePoint = normalizedFallback.codePointAt(index)
                if (Character.isLetterOrDigit(codePoint)) appendCodePoint(codePoint)
                index += Character.charCount(codePoint)
            }
        }.uppercase(Locale.US)
        return if (Regex("FHL\\p{Nd}").containsMatchIn(displaySkeleton)) "FHL" else fallback
    }

    private fun seedForRandomBatchSlot(jobId: String, batchIndex: Int): Long {
        val uuid = UUID.nameUUIDFromBytes("$jobId:$batchIndex".toByteArray(Charsets.UTF_8))
        return ((uuid.mostSignificantBits xor uuid.leastSignificantBits) and 0x7fffffffL).coerceAtLeast(1L)
    }

    private fun resolveSourceDataURLs(context: Context, payload: JSONObject): JSONArray {
        val paths = payload.optJSONArray("sourceImagePaths")
            ?: payload.optJSONArray("imagePaths")
            ?: JSONArray()
        val out = JSONArray()
        for (i in 0 until paths.length()) {
            val path = paths.optString(i).trim()
            if (path.isBlank()) continue
            val dataUrl = sourcePathToDataURL(context, path, paths.length())
            if (dataUrl.isNotBlank()) out.put(dataUrl)
        }
        val singlePath = payload.optString("imagePath").trim()
        if (out.length() == 0 && singlePath.isNotBlank()) {
            val dataUrl = sourcePathToDataURL(context, singlePath, 1)
            if (dataUrl.isNotBlank()) out.put(dataUrl)
        }
        return out
    }

    private fun sourcePathToDataURL(context: Context, path: String, sourceCount: Int): String {
        val fileBytes = openInputStream(context, path).use { it.readBytes() }
        val compressed = compressUploadCopy(fileBytes, sourceCount)
        val bytes = compressed ?: fileBytes
        val mime = if (compressed != null) "image/jpeg" else mimeForPath(path)
        return "data:$mime;base64,${Base64.encodeToString(bytes, Base64.NO_WRAP)}"
    }

    private fun compressUploadCopy(bytes: ByteArray, sourceCount: Int, forceJpeg: Boolean = false): ByteArray? {
        val threshold = if (sourceCount >= 2) 512 * 1024 else (2.5 * 1024 * 1024).toInt()
        if (!forceJpeg && bytes.size < threshold) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        val maxLongSide = when {
            sourceCount >= 3 -> 1024
            sourceCount >= 2 -> 1280
            else -> 1600
        }
        val scale = minOf(1f, maxLongSide.toFloat() / max(bounds.outWidth, bounds.outHeight).toFloat())
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / sample > maxLongSide * 2) sample *= 2
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: return null
        val scaled = try {
            if (scale >= 0.999f) decoded
            else Bitmap.createScaledBitmap(
                decoded,
                max(1, (bounds.outWidth * scale).roundToInt()),
                max(1, (bounds.outHeight * scale).roundToInt()),
                true,
            )
        } catch (_: Exception) {
            decoded
        }
        return try {
            val out = ByteArrayOutputStream()
            scaled.compress(Bitmap.CompressFormat.JPEG, uploadCopyJpegQuality, out)
            val next = out.toByteArray()
            if (!forceJpeg && next.size >= bytes.size && scale >= 0.999f) null else next
        } finally {
            if (scaled != decoded) scaled.recycle()
            decoded.recycle()
        }
    }

    private fun updateSlot(
        context: Context,
        jobId: String,
        eventType: String,
        mutate: (JSONObject) -> Unit,
    ): Pair<JSONObject, JSONObject>? {
        synchronized(lock) {
            val registry = loadRegistry(context)
            val groups = registry.optJSONArray("groups") ?: return null
            for (groupIndex in 0 until groups.length()) {
                val group = groups.optJSONObject(groupIndex) ?: continue
                val slots = group.optJSONArray("slots") ?: continue
                for (slotIndex in 0 until slots.length()) {
                    val slot = slots.optJSONObject(slotIndex) ?: continue
                    if (slot.optString("jobId") != jobId) continue
                    mutate(slot)
                    slot.put("updatedAt", System.currentTimeMillis())
                    group.put("statusSummary", summarizeSlots(slots))
                    val droppedGroupIds = if (slotsAreTerminal(slots)) {
                        trimTerminalGroups(registry)
                    } else {
                        emptyList()
                    }
                    saveRegistry(context, registry)
                    for (droppedGroupId in droppedGroupIds) {
                        fullPayloads.remove(droppedGroupId)
                        deletePersistedPayload(context, droppedGroupId)
                    }
                    val resolvedEventType = when (eventType) {
                        "terminal", "error", "cancelled" -> eventTypeForStatus(slot.optString("status"))
                        else -> eventType
                    }
                    appendJobAudit(context, "slot_$resolvedEventType", buildSlotAudit(group, slot))
                    val event = JSONObject()
                        .put("type", resolvedEventType)
                        .put("slot", JSONObject(slot.toString()))
                        .put("group", JSONObject(group.toString()))
                    AndroidJobEventBus.emit(event)
                    return group to slot
                }
            }
        }
        return null
    }

    private fun claimNextQueuedSlot(context: Context): Pair<JSONObject, JSONObject>? {
        synchronized(lock) {
            val registry = loadRegistry(context)
            val groups = registry.optJSONArray("groups") ?: return null
            val candidates = mutableListOf<AndroidJobSchedulingPolicy.Candidate>()
            val locations = mutableMapOf<String, Pair<JSONObject, JSONObject>>()
            for (i in 0 until groups.length()) {
                val group = groups.optJSONObject(i) ?: continue
                val groupPayload = hydratePayload(context, group.optString("groupId"))
                val groupBaseURL = groupPayload?.optString("baseURL").orEmpty()
                val groupApiMode = group.optString("apiMode")
                val slots = group.optJSONArray("slots") ?: continue
                for (j in 0 until slots.length()) {
                    val slot = slots.optJSONObject(j) ?: continue
                    if (slot.optString("status") != "queued") continue
                    val jobId = slot.optString("jobId").trim()
                    if (jobId.isBlank() || activeReservations.containsKey(jobId)) continue
                    val poolSlot = acceptedFHLPoolSlot(
                        groupApiMode,
                        groupBaseURL,
                        slot.optInt("fhlImagesPoolSlot", 0),
                    )
                    val candidate = AndroidJobSchedulingPolicy.Candidate(
                        jobId = jobId,
                        queueSequence = slot.optLong("queueSequence", Long.MAX_VALUE),
                        createdAt = slot.optLong("createdAt", group.optLong("createdAt", Long.MAX_VALUE)),
                        fhlImagesPoolSlot = poolSlot,
                        nonPoolLaneKey = AndroidJobSchedulingPolicy.normalizedNonPoolLaneKey(
                            slot.optString("apiProfileId").ifBlank { group.optString("apiProfileId") },
                        ),
                        nonPoolLimit = group.optInt("concurrencyLimit", AndroidJobSchedulingPolicy.NON_POOL_DEFAULT_LIMIT),
                    )
                    candidates += candidate
                    locations[jobId] = group to slot
                }
            }
            val candidate = AndroidJobSchedulingPolicy.selectNext(candidates, activeReservations.values)
                ?: return null
            val location = locations[candidate.jobId] ?: return null
            val liveGroup = location.first
            val liveSlot = location.second
            val reservation = AndroidJobSchedulingPolicy.reservationFor(candidate)
            val now = System.currentTimeMillis()
            if (!activeWorkerJobIds.add(candidate.jobId)) return null
            activeReservations[candidate.jobId] = reservation
            try {
                liveSlot.put("status", "running")
                liveSlot.put("stage", "后台任务已进入并发执行")
                liveSlot.put("startedAt", now)
                liveSlot.put("updatedAt", now)
                liveSlot.put("reservationActive", true)
                liveSlot.put("reservationSessionId", processSessionId)
                liveSlot.put("reservationKind", if (reservation.isFhlImagesPool) "fhl_images_pool" else "direct")
                if (reservation.fhlImagesPoolSlot != null) {
                    liveSlot.put("reservationSlot", reservation.fhlImagesPoolSlot)
                    liveSlot.remove("reservationLaneKey")
                } else {
                    liveSlot.remove("reservationSlot")
                    liveSlot.put("reservationLaneKey", reservation.nonPoolLaneKey)
                }
                liveSlot.put("cancelRequested", false)
                liveSlot.put("settledAt", JSONObject.NULL)
                liveGroup.put("statusSummary", summarizeSlots(liveGroup.optJSONArray("slots") ?: JSONArray()))
                saveRegistry(context, registry)
                appendJobAudit(context, "slot_claimed", buildSlotAudit(liveGroup, liveSlot))
                AndroidJobEventBus.emit(
                    JSONObject()
                        .put("type", "snapshot")
                        .put("slot", JSONObject(liveSlot.toString()))
                        .put("group", JSONObject(liveGroup.toString())),
                )
                return JSONObject(liveGroup.toString()) to JSONObject(liveSlot.toString())
            } catch (error: Exception) {
                activeReservations.remove(candidate.jobId)
                activeWorkerJobIds.remove(candidate.jobId)
                throw error
            }
        }
        return null
    }

    private fun rollbackClaimAfterThreadStartFailure(context: Context, jobId: String) {
        var cancelled = false
        var groupId = ""
        synchronized(lock) {
            activeReservations.remove(jobId)
            activeWorkerJobIds.remove(jobId)
            val updated = updateSlot(context, jobId, "snapshot") { current ->
                cancelled = statusAfterCancellationArbitration(
                    desiredStatus = "queued",
                    cancelledInMemory = cancelledJobIds.contains(jobId),
                    cancelRequested = current.optBoolean("cancelRequested", false),
                ) == "cancelled"
                current.put("reservationActive", false)
                current.put("reservationSessionId", processSessionId)
                if (cancelled) {
                    applyCancelledState(current, startedAt = null, settled = true)
                } else {
                    current.put("status", "queued")
                    current.put("stage", "后台线程启动失败，等待下次显式唤醒")
                    current.put("startedAt", JSONObject.NULL)
                    current.put("finishedAt", JSONObject.NULL)
                    current.put("settledAt", JSONObject.NULL)
                    current.put("elapsedSec", 0)
                    current.put("cancelRequested", false)
                    current.put("errorMessage", "")
                }
            }
            groupId = updated?.first?.optString("groupId").orEmpty()
            cancelledJobIds.remove(jobId)
            if (cancelled) liveJobIds.remove(jobId)
        }
        if (cancelled && groupId.isNotBlank() && allGroupSlotsTerminal(context, groupId)) {
            fullPayloads.remove(groupId)
            deletePersistedPayload(context, groupId)
        }
    }

    private fun releaseReservation(context: Context, jobId: String) {
        val reservation = activeReservations.remove(jobId) ?: return
        val settledAt = System.currentTimeMillis()
        try {
            updateSlot(context, jobId, "reservation_released") { slot ->
                slot.put("reservationActive", false)
                slot.put("reservationSessionId", processSessionId)
                slot.put("reservationKind", if (reservation.isFhlImagesPool) "fhl_images_pool" else "direct")
                if (reservation.fhlImagesPoolSlot != null) {
                    slot.put("reservationSlot", reservation.fhlImagesPoolSlot)
                    slot.remove("reservationLaneKey")
                } else {
                    slot.remove("reservationSlot")
                    slot.put("reservationLaneKey", reservation.nonPoolLaneKey)
                }
                slot.put("settledAt", settledAt)
            }
        } catch (error: Exception) {
            Log.e(logTag, "Reservation release audit failed for ${jobId.takeLast(12)}", error)
        }
    }

    private fun countNonTerminalSlots(groups: JSONArray): Int {
        var count = 0
        for (i in 0 until groups.length()) {
            val slots = groups.optJSONObject(i)?.optJSONArray("slots") ?: continue
            for (j in 0 until slots.length()) {
                if (hasPendingStatus(slots.optJSONObject(j)?.optString("status"))) count += 1
            }
        }
        return count
    }

    private fun hasQueuedWork(context: Context): Boolean {
        synchronized(lock) {
            val groups = loadRegistry(context).optJSONArray("groups") ?: return false
            for (i in 0 until groups.length()) {
                val slots = groups.optJSONObject(i)?.optJSONArray("slots") ?: continue
                for (j in 0 until slots.length()) {
                    if (slots.optJSONObject(j)?.optString("status") == "queued") return true
                }
            }
            return false
        }
    }

    private fun hasPendingSlots(slots: JSONArray?): Boolean {
        if (slots == null) return false
        for (i in 0 until slots.length()) {
            if (hasPendingStatus(slots.optJSONObject(i)?.optString("status"))) return true
        }
        return false
    }

    private fun hasPendingStatus(status: String?): Boolean = status == "queued" || status == "running"

    private fun allGroupSlotsTerminal(context: Context, groupId: String): Boolean {
        synchronized(lock) {
            val groups = loadRegistry(context).optJSONArray("groups") ?: return true
            for (i in 0 until groups.length()) {
                val group = groups.optJSONObject(i) ?: continue
                if (group.optString("groupId") != groupId) continue
                val slots = group.optJSONArray("slots") ?: return true
                for (j in 0 until slots.length()) {
                    when (slots.optJSONObject(j)?.optString("status")) {
                        "queued", "running" -> return false
                    }
                }
            }
        }
        return true
    }

    private fun pendingRecoveryAction(
        status: String,
        cancelRequested: Boolean,
        apiMode: String,
        sameProcessSession: Boolean,
        activeWorker: Boolean,
        payloadAvailable: Boolean,
        taskId: String,
        originalBaseURL: String,
        credentialAvailable: Boolean,
    ): String {
        if (!hasPendingStatus(status)) return "ignore"
        if (cancelRequested) {
            return if (sameProcessSession && status == "running" && activeWorker) "keep" else "cancel"
        }
        if (sameProcessSession) {
            if (status == "running" && activeWorker) return "keep"
            if (status == "queued" && payloadAvailable) return "resume"
            return "interrupt"
        }
        return if (
            payloadAvailable &&
            canResumeAPIMartQuery(
                apiMode,
                taskId,
                originalBaseURL,
                credentialAvailable,
            )
        ) {
            "resume_apimart_query"
        } else {
            "interrupt"
        }
    }

    private fun canResumeAPIMartQuery(
        apiMode: String,
        taskId: String,
        originalBaseURL: String,
        credentialAvailable: Boolean,
    ): Boolean {
        return normalizeAPIMode(apiMode) == "apimart" &&
            taskId.isNotBlank() &&
            originalBaseURL.isNotBlank() &&
            credentialAvailable
    }

    private fun reconcilePendingJobsLocked(context: Context): Boolean {
        val registry = loadRegistry(context)
        val now = System.currentTimeMillis()
        var dirty = false
        var shouldStartWorker = false
        val groups = registry.optJSONArray("groups") ?: return false
        val groupsToCleanup = mutableSetOf<String>()
        cleanupOrphanedPayloads(context, groups)
        for (i in 0 until groups.length()) {
            val group = groups.optJSONObject(i) ?: continue
            val groupId = group.optString("groupId")
            val slots = group.optJSONArray("slots") ?: continue
            if (slotsAreTerminal(slots)) {
                if (groupId.isNotBlank()) groupsToCleanup += groupId
                continue
            }
            val payload = hydratePayload(context, groupId)
            var groupDirty = false
            var transferredToCurrentProcess = false
            for (j in 0 until slots.length()) {
                val slot = slots.optJSONObject(j) ?: continue
                val status = slot.optString("status")
                val jobId = slot.optString("jobId")
                if (status != "queued" && status != "running") continue
                val sameProcessSession = group.optString("processSessionId") == processSessionId &&
                    slot.optString("processSessionId") == processSessionId
                val cancelRequested = slot.optBoolean("cancelRequested", false)
                val apiMode = normalizeAPIMode(payload?.optString("apiMode", group.optString("apiMode", "")) ?: group.optString("apiMode", ""))
                val apimartTaskId = slot.optString("apimartTaskId").trim()
                val apimartBaseURL = slot.optString("apimartBaseURL").trim()
                    .ifBlank { group.optString("apimartBaseURL").trim() }
                    .ifBlank { payload?.optString("baseURL")?.trim().orEmpty() }
                val credentialAvailable = if (cancelRequested) false else temporaryCredentialAvailable(context, groupId, apiMode)
                val action = pendingRecoveryAction(
                    status,
                    cancelRequested,
                    apiMode,
                    sameProcessSession,
                    activeWorkerJobIds.contains(jobId),
                    payload != null && credentialAvailable,
                    apimartTaskId,
                    apimartBaseURL,
                    credentialAvailable,
                )
                when (action) {
                    "keep" -> {
                        liveJobIds.add(jobId)
                    }
                    "resume" -> {
                        liveJobIds.add(jobId)
                        shouldStartWorker = true
                    }
                    "resume_apimart_query" -> {
                        check(payload != null)
                        liveJobIds.add(jobId)
                        shouldStartWorker = true
                        slot.put("status", "queued")
                        slot.put("stage", "App 已恢复，只继续查询 APIMart 任务 $apimartTaskId")
                        slot.put("apimartTaskStatus", "resume_pending")
                        slot.put("apimartBaseURL", apimartBaseURL)
                        slot.put("processSessionId", processSessionId)
                        slot.put("startedAt", JSONObject.NULL)
                        slot.put("finishedAt", JSONObject.NULL)
                        slot.put("elapsedSec", 0)
                        slot.put("bytes", 0)
                        slot.put("reservationActive", false)
                        slot.put("settledAt", JSONObject.NULL)
                        slot.put("errorMessage", "")
                        slot.put("updatedAt", now)
                        transferredToCurrentProcess = true
                        dirty = true
                        groupDirty = true
                    }
                    "cancel" -> {
                        liveJobIds.remove(jobId)
                        cancelledJobIds.remove(jobId)
                        applyCancelledState(slot, startedAt = null, settled = true)
                        slot.put("reservationActive", false)
                        slot.put("updatedAt", now)
                        dirty = true
                        groupDirty = true
                    }
                    "interrupt" -> {
                        liveJobIds.remove(jobId)
                        slot.put("status", "interrupted")
                        slot.put("stage", "任务已中断")
                        slot.put(
                            "errorMessage",
                            if (apiMode == "apimart" && apimartTaskId.isNotBlank()) {
                                "App 重启后缺少安全查询 APIMart 任务 $apimartTaskId 所需的原地址或凭据，已阻止再次提交。"
                            } else {
                                "App 或系统重启后已中断未完成任务，未再次提交付费请求。"
                            },
                        )
                        slot.put("finishedAt", now)
                        slot.put("updatedAt", now)
                        slot.put("reservationActive", false)
                        slot.put("settledAt", now)
                        dirty = true
                        groupDirty = true
                    }
                    else -> Unit
                }
            }
            if (transferredToCurrentProcess) group.put("processSessionId", processSessionId)
            if (groupDirty) {
                group.put("statusSummary", summarizeSlots(slots))
                if (slotsAreTerminal(slots)) {
                    if (groupId.isNotBlank()) groupsToCleanup += groupId
                }
            }
        }
        val droppedGroupIds = trimTerminalGroups(registry)
        if (droppedGroupIds.isNotEmpty()) dirty = true
        if (dirty) saveRegistry(context, registry)
        groupsToCleanup += droppedGroupIds
        for (groupId in groupsToCleanup) {
            fullPayloads.remove(groupId)
            deletePersistedPayload(context, groupId)
        }
        return shouldStartWorker
    }

    private fun markDeadRunningJobsInterruptedLocked(context: Context) {
        val registry = loadRegistry(context)
        var dirty = false
        val groups = registry.optJSONArray("groups") ?: return
        for (i in 0 until groups.length()) {
            val group = groups.optJSONObject(i) ?: continue
            val slots = group.optJSONArray("slots") ?: continue
            for (j in 0 until slots.length()) {
                val slot = slots.optJSONObject(j) ?: continue
                val status = slot.optString("status")
                val jobId = slot.optString("jobId")
                if ((status == "queued" || status == "running") && !liveJobIds.contains(jobId)) {
                    slot.put("status", "interrupted")
                    slot.put("stage", "任务已中断")
                    slot.put("errorMessage", "App 或系统重启后无法继续未完成任务")
                    slot.put("finishedAt", System.currentTimeMillis())
                    slot.put("updatedAt", System.currentTimeMillis())
                    slot.put("reservationActive", false)
                    slot.put("settledAt", System.currentTimeMillis())
                    dirty = true
                }
            }
            if (dirty) group.put("statusSummary", summarizeSlots(slots))
        }
        if (dirty) saveRegistry(context, registry)
    }

    private fun eventTypeForStatus(status: String): String {
        return when (status) {
            "succeeded" -> "terminal"
            "failed", "interrupted" -> "error"
            "cancelled" -> "cancelled"
            else -> "snapshot"
        }
    }

    private fun loadRegistry(context: Context): JSONObject {
        val file = registryFile(context)
        return try {
            val registry = AtomicFile(file).openRead().bufferedReader(Charsets.UTF_8).use { reader ->
                JSONObject(reader.readText())
            }
            migrateRegistryIfNeeded(context, registry)
        } catch (_: FileNotFoundException) {
            JSONObject()
                .put("version", registryVersion)
                .put("updatedAt", System.currentTimeMillis())
                .put("nextQueueSequence", 1L)
                .put("groups", JSONArray())
        } catch (error: Exception) {
            throw IllegalStateException("Android 任务注册表损坏，已阻止后台任务自动恢复。", error)
        }
    }

    private fun saveRegistry(context: Context, registry: JSONObject) {
        val file = registryFile(context)
        registry.put("version", registryVersion)
        registry.put("updatedAt", System.currentTimeMillis())
        writeAtomicUTF8(file, registry.toString(2))
    }

    private fun migrateRegistryIfNeeded(context: Context, registry: JSONObject): JSONObject {
        val migration = migrateRegistrySnapshot(registry)
        if (migration.dirty) saveRegistry(context, registry)
        for (groupId in migration.droppedGroupIds) {
            fullPayloads.remove(groupId)
            deletePersistedPayload(context, groupId)
        }
        return registry
    }

    private fun migrateRegistrySnapshot(registry: JSONObject): RegistryMigration {
        val groups = registry.optJSONArray("groups") ?: JSONArray().also { registry.put("groups", it) }
        val sourceVersion = registry.optInt("version", 1)
        if (sourceVersion > registryVersion) {
            throw IllegalStateException(
                "Android 任务注册表版本 $sourceVersion 高于当前支持版本 $registryVersion，已阻止降级读取。",
            )
        }
        val slots = mutableListOf<Pair<JSONObject, AndroidJobSchedulingPolicy.RegistryQueueSlot>>()
        for (i in 0 until groups.length()) {
            val group = groups.optJSONObject(i) ?: continue
            val groupCreatedAt = group.optLong("createdAt", Long.MAX_VALUE)
            val groupSlots = group.optJSONArray("slots") ?: continue
            for (j in 0 until groupSlots.length()) {
                val slot = groupSlots.optJSONObject(j) ?: continue
                val createdAt = slot.optLong("createdAt", groupCreatedAt)
                slots += slot to AndroidJobSchedulingPolicy.RegistryQueueSlot(
                    jobId = slot.optString("jobId"),
                    batchIndex = slot.optInt("batchIndex", 0),
                    createdAt = createdAt,
                    queueSequence = slot.optLong("queueSequence").takeIf { slot.has("queueSequence") },
                )
            }
        }
        val queueMigration = AndroidJobSchedulingPolicy.migrateRegistryQueue(
            sourceVersion = sourceVersion,
            supportedVersion = registryVersion,
            currentNextQueueSequence = registry.optLong("nextQueueSequence", 1L),
            slots = slots.map { it.second },
        )
        var dirty = sourceVersion != registryVersion
        for ((index, entry) in slots.withIndex()) {
            val slot = entry.first
            val migratedSequence = queueMigration.queueSequences[index]
            if (!slot.has("queueSequence") || slot.optLong("queueSequence") != migratedSequence) {
                slot.put("queueSequence", migratedSequence)
                dirty = true
            }
            if (!slot.has("cancelRequested")) {
                slot.put("cancelRequested", false)
                dirty = true
            }
            if (!slot.has("reservationActive")) {
                slot.put("reservationActive", false)
                dirty = true
            }
        }
        if (registry.optLong("nextQueueSequence", 0L) != queueMigration.nextQueueSequence) {
            registry.put("nextQueueSequence", queueMigration.nextQueueSequence)
            dirty = true
        }
        val droppedGroupIds = trimTerminalGroups(registry)
        if (droppedGroupIds.isNotEmpty()) dirty = true
        if (sourceVersion != registryVersion) {
            registry.put("version", registryVersion)
        }
        return RegistryMigration(dirty = dirty, droppedGroupIds = droppedGroupIds)
    }

    private fun registryFile(context: Context): File = File(context.filesDir, "jobs/android-jobs.v1.json")

    private fun auditFile(context: Context): File = File(context.filesDir, "jobs/android-job-audit.v1.jsonl")

    private fun buildSubmitAudit(group: JSONObject, payload: JSONObject): JSONObject {
        return JSONObject()
            .put("groupId", group.optString("groupId"))
            .put("clientSubmissionId", group.optString("clientSubmissionId"))
            .put("workspaceId", group.optString("workspaceId"))
            .put("requestRunId", group.optString("requestRunId"))
            .put("mode", group.optString("mode"))
            .put("apiMode", group.optString("apiMode"))
            .put("apiLabel", group.optString("apiLabel"))
            .put("apiProfileId", group.optString("apiProfileId"))
            .put("fhlImagesPoolSlot", group.optInt("fhlImagesPoolSlot", 0))
            .put("baseURLHost", hostForURL(payload.optString("baseURL")))
            .put("size", group.optString("size"))
            .put("quality", group.optString("quality"))
            .put("outputFormat", group.optString("outputFormat"))
            .put("batchCount", group.optInt("batchCount", 1))
            .put("continuousGenerateTest", group.optBoolean("continuousGenerateTest", false))
            .put("continuousBatchIndex", group.optInt("continuousBatchIndex", 0))
            .put("concurrencyLimit", group.optInt("concurrencyLimit", 0))
            .put("sourceCount", group.optJSONArray("sourceImagePaths")?.length() ?: 0)
            .put("promptChars", payload.optString("prompt").length)
            .put("negativePromptChars", payload.optString("negativePrompt").length)
            .put("slotIds", group.optJSONArray("slotIds") ?: JSONArray())
    }

    private fun appendUpstreamSubmitAttemptAudit(
        context: Context,
        jobId: String,
        payload: JSONObject,
        apiMode: String,
    ) {
        appendJobAudit(
            context,
            "upstream_submit_attempt",
            buildUpstreamSubmitAttemptAudit(jobId, payload, apiMode),
        )
    }

    private fun buildUpstreamSubmitAttemptAudit(jobId: String, payload: JSONObject, apiMode: String): JSONObject {
        val details = JSONObject()
        for ((key, value) in upstreamSubmitAttemptAuditFields(
            jobId,
            payload.optString("groupId"),
            payload.optString("clientSubmissionId"),
            payload.optString("requestRunId"),
            payload.optString("apiProfileId"),
            apiMode,
            payload.optString("apiLabel"),
            payload.optInt("fhlImagesPoolSlot", 0),
        )) {
            details.put(key, value)
        }
        return details
    }

    private fun upstreamSubmitAttemptAuditFields(
        jobId: String,
        groupId: String,
        clientSubmissionId: String,
        requestRunId: String,
        apiProfileId: String,
        apiMode: String,
        apiLabel: String,
        fhlImagesPoolSlot: Int,
    ): Map<String, Any> {
        return linkedMapOf(
            "groupId" to groupId,
            "jobId" to jobId,
            "clientSubmissionId" to clientSubmissionId,
            "requestRunId" to requestRunId,
            "apiProfileId" to apiProfileId,
            "apiMode" to normalizeAPIMode(apiMode),
            "apiLabel" to apiLabel.trim().ifBlank { "FHL" },
            "fhlImagesPoolSlot" to fhlImagesPoolSlot,
        )
    }

    private fun buildSlotAudit(group: JSONObject, slot: JSONObject): JSONObject {
        val errorMessage = slot.optString("errorMessage")
        return JSONObject()
            .put("groupId", group.optString("groupId"))
            .put("workspaceId", group.optString("workspaceId"))
            .put("requestRunId", group.optString("requestRunId"))
            .put("jobId", slot.optString("jobId"))
            .put("queueSequence", slot.optLong("queueSequence", 0L))
            .put("fhlImagesPoolSlot", slot.optInt("fhlImagesPoolSlot", 0))
            .put("reservationActive", slot.optBoolean("reservationActive", false))
            .put("reservationSessionId", slot.optString("reservationSessionId"))
            .put("reservationKind", slot.optString("reservationKind"))
            .put("reservationSlot", slot.optInt("reservationSlot", 0))
            .put("reservationLaneKey", slot.optString("reservationLaneKey"))
            .put("cancelRequested", slot.optBoolean("cancelRequested", false))
            .put("settledAt", slot.opt("settledAt"))
            .put("batchIndex", slot.optInt("batchIndex", 0))
            .put("status", slot.optString("status"))
            .put("stage", slot.optString("stage"))
            .put("mode", group.optString("mode"))
            .put("apiMode", group.optString("apiMode"))
            .put("apiLabel", group.optString("apiLabel"))
            .put("apiProfileId", slot.optString("apiProfileId").ifBlank { group.optString("apiProfileId") })
            .put("size", group.optString("size"))
            .put("quality", group.optString("quality"))
            .put("outputFormat", group.optString("outputFormat"))
            .put("batchCount", group.optInt("batchCount", 1))
            .put("continuousGenerateTest", group.optBoolean("continuousGenerateTest", false))
            .put("concurrencyLimit", group.optInt("concurrencyLimit", 0))
            .put("elapsedSec", slot.optDouble("elapsedSec", 0.0))
            .put("bytes", slot.optLong("bytes", 0L))
            .put("hasRawPath", slot.optString("rawPath").isNotBlank())
            .put("hasSavedImage", slot.optString("savedPath").isNotBlank())
            .put("hasGalleryUri", slot.optString("galleryUri").isNotBlank())
            .put("errorMessageChars", errorMessage.length)
    }

    private fun appendJobAudit(context: Context, type: String, details: JSONObject) {
        synchronized(auditLock) {
            writeJobAuditLocked(context, type, details)
        }
    }

    private fun ensureProcessAuditStarted(context: Context) {
        synchronized(auditLock) {
            if (processAuditStarted.compareAndSet(false, true)) {
                writeJobAuditLocked(
                    context,
                    "process_started",
                    JSONObject().put("registryVersion", registryVersion),
                )
            }
        }
    }

    private fun writeJobAuditLocked(context: Context, type: String, details: JSONObject) {
        if (type != "process_started" && processAuditStarted.compareAndSet(false, true)) {
            writeJobAuditLocked(
                context,
                "process_started",
                JSONObject().put("registryVersion", registryVersion),
            )
        }
        val file = auditFile(context)
        file.parentFile?.mkdirs()
        val record = JSONObject()
            .put("version", auditLogVersion)
            .put("timestamp", System.currentTimeMillis())
            .put("processSessionId", processSessionId)
            .put("processId", android.os.Process.myPid())
            .put("auditSequence", auditSequence.incrementAndGet())
            .put("type", type)
            .put("details", details)
        try {
            file.appendText(record.toString() + "\n", Charsets.UTF_8)
            trimAuditFile(file)
            Log.i(logTag, "Job audit ${record}")
        } catch (error: Exception) {
            Log.w(logTag, "Job audit write failed: ${error.message ?: error.javaClass.simpleName}")
        }
    }

    private fun trimAuditFile(file: File) {
        if (!file.isFile || file.length() < 512_000L) return
        val lines = file.readLines(Charsets.UTF_8).takeLast(maxAuditEvents)
        file.writeText(lines.joinToString(separator = "\n", postfix = "\n"), Charsets.UTF_8)
    }

    private fun payloadDirectory(context: Context): File = File(context.filesDir, "jobs/payloads")

    private fun payloadFile(context: Context, groupId: String): File = File(payloadDirectory(context), "$groupId.json")

    private fun persistGroupPayload(context: Context, groupId: String, payload: JSONObject) {
        require(!payload.has("apiKey")) { "Persistent Android job payload must not contain apiKey" }
        val file = payloadFile(context, groupId)
        val wrapped = JSONObject()
            .put("version", payloadRegistryVersion)
            .put("updatedAt", System.currentTimeMillis())
            .put("payload", JSONObject(payload.toString()))
        writeAtomicUTF8(file, wrapped.toString(2))
    }

    private fun hydratePayload(context: Context, groupId: String): JSONObject? {
        fullPayloads[groupId]?.let {
            val copy = secureHydratedPayload(context, groupId, JSONObject(it.toString()), rewrite = false)
                ?: return null
            fullPayloads[groupId] = copy
            return JSONObject(copy.toString())
        }
        val file = payloadFile(context, groupId)
        val payload = try {
            AtomicFile(file).openRead().bufferedReader(Charsets.UTF_8).use { reader ->
                val wrapped = JSONObject(reader.readText())
                wrapped.optJSONObject("payload") ?: wrapped
            }
        } catch (_: FileNotFoundException) {
            return null
        } catch (_: Exception) {
            null
        } ?: return null
        val copy = secureHydratedPayload(context, groupId, payload, rewrite = payload.has("apiKey"))
            ?: return null
        fullPayloads[groupId] = copy
        return JSONObject(copy.toString())
    }

    private fun secureHydratedPayload(
        context: Context,
        groupId: String,
        payload: JSONObject,
        rewrite: Boolean,
    ): JSONObject? {
        val copy = JSONObject(payload.toString())
        val legacyCredential = copy.optString("apiKey").trim()
        return try {
            if (legacyCredential.isNotBlank()) {
                AndroidCredentialStore(context).setTemporaryJobCredential(groupId, legacyCredential)
            }
            copy.remove("apiKey")
            copy.put("groupId", groupId)
            if (rewrite) persistGroupPayload(context, groupId, copy)
            copy
        } catch (error: Exception) {
            Log.w(logTag, "Legacy Android job credential migration failed for ${groupId.takeLast(12)}: ${error.javaClass.simpleName}")
            fullPayloads.remove(groupId)
            deletePersistedPayload(context, groupId)
            null
        }
    }

    private fun deletePersistedPayload(context: Context, groupId: String) {
        val file = payloadFile(context, groupId)
        try {
            AndroidCredentialStore(context).deleteTemporaryJobCredential(groupId)
        } catch (error: Exception) {
            Log.w(logTag, "Temporary Android job credential cleanup failed for ${groupId.takeLast(12)}: ${error.javaClass.simpleName}")
            // Keep the keyless payload as a discoverable retry marker for the next orphan cleanup pass.
            return
        }
        AtomicFile(file).delete()
        file.parentFile?.takeIf { it.isDirectory && it.list()?.isEmpty() == true }?.delete()
    }

    private fun cleanupOrphanedPayloads(context: Context, groups: JSONArray) {
        val registeredGroupIds = mutableSetOf<String>()
        for (i in 0 until groups.length()) {
            groups.optJSONObject(i)?.optString("groupId")
                ?.takeIf { it.isNotBlank() }
                ?.let(registeredGroupIds::add)
        }
        val groupIds = payloadDirectory(context).listFiles()
            ?.asSequence()
            ?.filter(File::isFile)
            ?.mapNotNull { file -> payloadGroupIdForArtifact(file.name) }
            ?.toSet()
            ?: return
        for (groupId in groupIds) {
            if (groupId !in registeredGroupIds) {
                fullPayloads.remove(groupId)
                deletePersistedPayload(context, groupId)
            }
        }
    }

    private fun payloadGroupIdForArtifact(fileName: String): String? {
        val suffix = when {
            fileName.endsWith(".json.bak") -> ".json.bak"
            fileName.endsWith(".json.new") -> ".json.new"
            fileName.endsWith(".json") -> ".json"
            else -> return null
        }
        return fileName.removeSuffix(suffix).takeIf { it.isNotBlank() }
    }

    private fun writeAtomicUTF8(file: File, value: String) {
        file.parentFile?.mkdirs()
        val atomicFile = AtomicFile(file)
        var stream: FileOutputStream? = null
        try {
            stream = atomicFile.startWrite()
            stream.write(value.toByteArray(Charsets.UTF_8))
            atomicFile.finishWrite(stream)
            stream = null
        } catch (error: Exception) {
            stream?.let(atomicFile::failWrite)
            throw error
        }
    }

    private fun trimTerminalGroups(registry: JSONObject): List<String> {
        val groups = registry.optJSONArray("groups") ?: return emptyList()
        val retentionGroups = mutableListOf<AndroidJobSchedulingPolicy.RegistryRetentionGroup>()
        for (i in 0 until groups.length()) {
            val group = groups.optJSONObject(i) ?: continue
            retentionGroups += AndroidJobSchedulingPolicy.RegistryRetentionGroup(
                groupId = group.optString("groupId"),
                createdAt = group.optLong("createdAt", 0L),
                terminal = slotsAreTerminal(group.optJSONArray("slots") ?: JSONArray()),
            )
        }
        val droppedIdSet = AndroidJobSchedulingPolicy.terminalGroupIdsToDrop(retentionGroups).toSet()

        val kept = JSONArray()
        val dropped = mutableListOf<String>()
        for (i in 0 until groups.length()) {
            val group = groups.optJSONObject(i) ?: continue
            val groupId = group.optString("groupId")
            if (groupId !in droppedIdSet) {
                kept.put(group)
            } else {
                dropped += groupId
            }
        }
        if (dropped.isNotEmpty()) registry.put("groups", kept)
        return dropped
    }

    private fun slotsAreTerminal(slots: JSONArray): Boolean {
        for (i in 0 until slots.length()) {
            when (slots.optJSONObject(i)?.optString("status")) {
                "queued", "running" -> return false
            }
        }
        return true
    }

    private fun summarizeSlots(slots: JSONArray): JSONObject {
        val out = JSONObject()
            .put("queued", 0)
            .put("running", 0)
            .put("succeeded", 0)
            .put("failed", 0)
            .put("cancelled", 0)
            .put("interrupted", 0)
        for (i in 0 until slots.length()) {
            val status = slots.optJSONObject(i)?.optString("status") ?: continue
            if (out.has(status)) out.put(status, out.optInt(status) + 1)
        }
        return out
    }

    private fun safeStringArray(input: JSONArray?): JSONArray {
        val out = JSONArray()
        if (input == null) return out
        for (i in 0 until input.length()) {
            val value = input.optString(i).trim()
            if (value.isNotBlank()) out.put(value)
        }
        return out
    }

    private fun startService(context: Context) {
        val intent = Intent(context, AndroidJobService::class.java).setAction(AndroidJobService.ACTION_RUN_JOBS)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ContextCompat.startForegroundService(context, intent)
        } else {
            context.startService(intent)
        }
    }

    private fun sleepWithCancel(jobId: String, ms: Long) {
        val end = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < end) {
            if (cancelledJobIds.contains(jobId)) throw CancellationException("cancelled")
            Thread.sleep(250L)
        }
    }

    private fun isGPTImage2Model(modelID: String): Boolean {
        return modelID.trim().ifBlank { defaultImageModel }.lowercase(Locale.US).startsWith("gpt-image-2")
    }

    private fun stableSizeForRetry(size: String): String = when (size) {
        "2048x2048", "2880x2880" -> "1024x1024"
        "2048x1360", "3456x2304" -> "1536x1024"
        "1360x2048", "2304x3456" -> "1024x1536"
        "2048x1152", "3840x2160" -> "1536x864"
        "1152x2048", "2160x3840" -> "864x1536"
        "auto" -> "1024x1024"
        else -> size.ifBlank { "1024x1024" }
    }

    private fun parseSSEEventLine(line: String): JSONObject? {
        val trimmed = line.trim()
        if (!trimmed.startsWith("data: ")) return null
        val payload = trimmed.removePrefix("data: ").trim()
        if (payload.isBlank() || payload == "[DONE]") return null
        return try {
            JSONObject(payload)
        } catch (_: Exception) {
            null
        }
    }

    private fun summarizeSSEEvent(event: JSONObject): String {
        return when (event.optString("type")) {
            "response.created" -> "请求已创建"
            "response.in_progress" -> "模型处理中"
            "response.image_generation_call.in_progress" -> "图片工具已启动"
            "response.image_generation_call.generating" -> "图片正在生成"
            "response.image_generation_call.partial_image" -> "收到中间预览"
            "response.output_item.done" -> {
                val item = event.optJSONObject("item")
                if (item?.optString("type") == "image_generation_call" && item.optString("result").isNotBlank()) {
                    "收到 final 图片，正在保存"
                } else {
                    "模型输出项完成"
                }
            }
            "response.completed" -> "接口已完成"
            else -> event.optString("type").takeIf { it.isNotBlank() }?.let { "接口事件：$it" } ?: ""
        }
    }

    private fun partialFromEvent(event: JSONObject): JobImageResult? {
        if (event.optString("type") != "response.image_generation_call.partial_image") return null
        val b64 = event.optString("partial_image_b64")
        if (b64.isBlank()) return null
        return JobImageResult(b64, event.optString("revised_prompt"), "partial", null)
    }

    private fun finalFromSSEEvent(event: JSONObject): JobImageResult? {
        val item = event.optJSONObject("item")
        if (event.optString("type") == "response.output_item.done" && item?.optString("type") == "image_generation_call") {
            val result = item.optString("result")
            if (result.isNotBlank()) return JobImageResult(result, item.optString("revised_prompt"), "final", null)
        }
        val found = walkForImageCall(event)
        return if (found != null) {
            JobImageResult(found.optString("result"), found.optString("revised_prompt"), "final", null)
        } else {
            null
        }
    }

    private fun extractFinalImageResult(raw: String): JobImageResult? {
        for (line in raw.split(Regex("\\r?\\n"))) {
            val event = parseSSEEventLine(line) ?: continue
            finalFromSSEEvent(event)?.let { return it }
        }
        return try {
            val found = walkForImageCall(JSONObject(raw))
            if (found != null) JobImageResult(found.optString("result"), found.optString("revised_prompt"), "json", null) else null
        } catch (_: Exception) {
            null
        }
    }

    private fun walkForImageCall(value: Any?): JSONObject? {
        when (value) {
            is JSONObject -> {
                if (value.optString("type") == "image_generation_call" && value.optString("result").isNotBlank()) return value
                val keys = value.keys()
                while (keys.hasNext()) {
                    val found = walkForImageCall(value.opt(keys.next()))
                    if (found != null) return found
                }
            }
            is JSONArray -> {
                for (i in 0 until value.length()) {
                    val found = walkForImageCall(value.opt(i))
                    if (found != null) return found
                }
            }
        }
        return null
    }

    private fun describeProblem(raw: String, status: Int): String {
        val text = raw.trim()
        if (text.isBlank()) return if (status > 0) "接口返回 $status 且内容为空" else "接口返回为空"
        val lower = text.lowercase(Locale.US)
        if (lower.contains("524")) return "Cloudflare 524：上游超时"
        if (lower.contains("504") || lower.contains("gateway time-out")) return "Cloudflare 504：上游网关超时"
        return try {
            val parsed = JSONObject(text)
            describeJSONProblem(parsed, status)
                ?: parsed.optJSONObject("error")?.optString("message")?.takeIf { it.isNotBlank() }
                ?: parsed.optString("message").takeIf { it.isNotBlank() }
                ?: "接口已返回内容，但没有发现 image_generation_call.result"
        } catch (_: Exception) {
            "接口已返回内容，但没有发现 image_generation_call.result"
        }
    }

    private fun describeJSONProblem(parsed: JSONObject, httpStatus: Int): String? {
        val payloadStatus = payloadStatusCode(parsed)
        if (httpStatus < 400 && payloadStatus < 400 && !parsed.optBoolean("cloudflare_error", false)) return null
        val status = if (payloadStatus >= 400) payloadStatus else httpStatus
        val title = parsed.optString("title").takeIf { it.isNotBlank() }
        val message = parsed.optJSONObject("error")?.optString("message")?.takeIf { it.isNotBlank() }
            ?: parsed.optString("message").takeIf { it.isNotBlank() }
            ?: parsed.optString("detail").takeIf { it.isNotBlank() }
            ?: title
            ?: parsed.optString("error_name").takeIf { it.isNotBlank() }
        if (parsed.optBoolean("cloudflare_error", false) || message?.contains("cloudflare", ignoreCase = true) == true) {
            return "Cloudflare ${if (status > 0) status else "错误"}：${message ?: "上游网关错误"}"
        }
        if (status > 0) return "接口返回 $status：${message ?: "请求失败"}"
        return message
    }

    private fun payloadStatusCode(parsed: JSONObject): Int {
        return when (val statusValue = parsed.opt("status")) {
            is Number -> statusValue.toInt()
            is String -> statusValue.trim().toIntOrNull() ?: 0
            else -> 0
        }
    }

    private fun isRetryableRaw(raw: String, status: Int): Boolean {
        if (status in listOf(502, 503, 504, 524)) return true
        val lower = raw.lowercase(Locale.US)
        return listOf(
            "timeout",
            "gateway",
            "temporarily unavailable",
            "origin_gateway_timeout",
            "no final",
            "没有返回图片",
            "image_generation_call.result",
        ).any { lower.contains(it) }
    }

    private fun repairSizeForOpenAI(size: String): String {
        val currentSize = size.trim()
        if (currentSize.equals("auto", ignoreCase = true)) return "auto"
        val parsed = parseSizePixels(currentSize) ?: return currentSize.ifBlank { "1024x1024" }
        val normalized = normalizeOpenAIImageSize(parsed.width.toDouble(), parsed.height.toDouble()) ?: return currentSize
        val nextSize = "${normalized.width}x${normalized.height}"
        return if (nextSize == currentSize) currentSize else nextSize
    }

    private fun parseSizePixels(size: String): SizePixels? {
        val match = Regex("^(\\d+)x(\\d+)$", RegexOption.IGNORE_CASE).matchEntire(size.trim()) ?: return null
        val width = match.groupValues[1].toIntOrNull() ?: return null
        val height = match.groupValues[2].toIntOrNull() ?: return null
        if (width <= 0 || height <= 0) return null
        return SizePixels(width, height)
    }

    private fun normalizeOpenAIImageSize(rawWidth: Double, rawHeight: Double): SizePixels? {
        if (!rawWidth.isFinite() || !rawHeight.isFinite() || rawWidth <= 0.0 || rawHeight <= 0.0) return null
        var targetWidth = rawWidth
        var targetHeight = rawHeight
        val aspect = (targetWidth / targetHeight).coerceIn(1.0 / openAIImageMaxAspect, openAIImageMaxAspect)

        if (targetWidth / targetHeight != aspect) {
            if (targetWidth >= targetHeight) targetWidth = targetHeight * aspect else targetHeight = targetWidth / aspect
        }

        val maxSide = max(targetWidth, targetHeight)
        if (maxSide > openAIImageMaxSide) {
            val scale = openAIImageMaxSide / maxSide
            targetWidth *= scale
            targetHeight *= scale
        }

        val pixelCount = targetWidth * targetHeight
        if (pixelCount > openAIImageMaxPixels) {
            val scale = sqrt(openAIImageMaxPixels / pixelCount)
            targetWidth *= scale
            targetHeight *= scale
        }

        if (targetWidth * targetHeight < openAIImageMinPixels) {
            val scale = sqrt(openAIImageMinPixels / max(targetWidth * targetHeight, 1.0))
            targetWidth *= scale
            targetHeight *= scale
        }

        val postFloorMaxSide = max(targetWidth, targetHeight)
        if (postFloorMaxSide > openAIImageMaxSide) {
            val scale = openAIImageMaxSide / postFloorMaxSide
            targetWidth *= scale
            targetHeight *= scale
        }

        val widthCandidates = sizeCandidateSet(targetWidth)
        val heightCandidates = sizeCandidateSet(targetHeight)
        var best: SizePixels? = null
        var bestDistance = Double.POSITIVE_INFINITY
        var bestAspectDistance = Double.POSITIVE_INFINITY
        var bestAreaDistance = Double.POSITIVE_INFINITY

        for (width in widthCandidates) {
            for (height in heightCandidates) {
                if (!sizeWithinOpenAILimits(width, height)) continue
                val distance = abs(width - targetWidth) / max(targetWidth, 1.0) +
                    abs(height - targetHeight) / max(targetHeight, 1.0)
                val aspectDistance = abs((width.toDouble() / height.toDouble()) - (targetWidth / targetHeight))
                val areaDistance = abs((width * height).toDouble() - (targetWidth * targetHeight)) / max(targetWidth * targetHeight, 1.0)
                if (
                    distance < bestDistance ||
                    (distance == bestDistance && aspectDistance < bestAspectDistance) ||
                    (distance == bestDistance && aspectDistance == bestAspectDistance && areaDistance < bestAreaDistance)
                ) {
                    best = SizePixels(width, height)
                    bestDistance = distance
                    bestAspectDistance = aspectDistance
                    bestAreaDistance = areaDistance
                }
            }
        }

        return best
    }

    private fun sizeCandidateSet(value: Double): List<Int> {
        val clamped = value.coerceIn(openAIImageAlignment.toDouble(), openAIImageMaxSide.toDouble())
        return listOf(
            roundAligned(clamped, "nearest"),
            roundAligned(clamped, "down"),
            roundAligned(clamped, "up"),
        )
            .map { it.coerceIn(openAIImageAlignment, openAIImageMaxSide) }
            .distinct()
            .filter { it in openAIImageAlignment..openAIImageMaxSide }
            .sortedWith(compareBy<Int> { abs(it - clamped) }.thenByDescending { it })
    }

    private fun roundAligned(value: Double, mode: String): Int {
        val scaled = value / openAIImageAlignment
        val rounded = when (mode) {
            "down" -> floor(scaled)
            "up" -> ceil(scaled)
            else -> kotlin.math.round(scaled)
        }
        return (rounded * openAIImageAlignment).toInt()
    }

    private fun sizeWithinOpenAILimits(width: Int, height: Int): Boolean {
        if (width < openAIImageAlignment || height < openAIImageAlignment) return false
        if (width % openAIImageAlignment != 0 || height % openAIImageAlignment != 0) return false
        if (width > openAIImageMaxSide || height > openAIImageMaxSide) return false
        val pixels = width * height
        if (pixels < openAIImageMinPixels || pixels > openAIImageMaxPixels) return false
        val aspect = width.toDouble() / height.toDouble()
        return aspect <= openAIImageMaxAspect && aspect >= (1.0 / openAIImageMaxAspect)
    }

    private fun normalizePartialImages(value: Any?): Int {
        val n = when (value) {
            is Number -> value.toInt()
            is String -> value.toIntOrNull()
            else -> null
        } ?: 1
        return n.coerceIn(0, 3)
    }

    private fun normalizeBaseURL(raw: String): String {
        val cleaned = raw.trim().trimEnd('/')
        if (cleaned.isBlank()) throw JobRequestException("BASE_URL 为空", null, false)
        val hasTerminalVersionPath = try {
            val uri = URI(cleaned)
            uri.rawQuery == null &&
                uri.rawFragment == null &&
                (uri.rawPath ?: "").endsWith("/v1")
        } catch (_: Exception) {
            false
        }
        return if (hasTerminalVersionPath) cleaned.dropLast("/v1".length) else cleaned
    }

    private fun openHttpConnection(url: String, proxyMode: String, proxyUrl: String): HttpURLConnection {
        val target = URL(url)
        val connection = when (normalizeProxyMode(proxyMode)) {
            "none" -> target.openConnection(Proxy.NO_PROXY)
            "custom" -> target.openConnection(parseCustomProxy(proxyUrl))
            else -> target.openConnection()
        }
        return connection as HttpURLConnection
    }

    private fun normalizeProxyMode(raw: String): String = when (raw.trim().lowercase(Locale.US)) {
        "none" -> "none"
        "custom" -> "custom"
        else -> "system"
    }

    private fun parseCustomProxy(raw: String): Proxy {
        val uri = URI(raw.trim())
        val scheme = uri.scheme?.lowercase(Locale.US) ?: ""
        if (scheme != "http" && scheme != "https") throw IllegalArgumentException("代理地址仅支持 http:// 或 https://")
        val host = uri.host ?: throw IllegalArgumentException("代理地址必须包含主机")
        val port = if (uri.port > 0) uri.port else if (scheme == "https") 443 else 80
        return Proxy(Proxy.Type.HTTP, InetSocketAddress.createUnresolved(host, port))
    }

    private fun openInputStream(context: Context, path: String): InputStream {
        val trimmed = path.trim()
        if (trimmed.startsWith("content://")) {
            return context.contentResolver.openInputStream(Uri.parse(trimmed))
                ?: throw IllegalArgumentException("无法读取内容 URI")
        }
        return FileInputStream(File(trimmed))
    }

    private fun defaultOutputDir(context: Context): File {
        val prefs = context.getSharedPreferences("image_studio_android", Context.MODE_PRIVATE)
        val saved = prefs.getString("output_dir", "") ?: ""
        if (saved.isNotBlank()) return File(saved).apply { mkdirs() }
        val pictures = context.getExternalFilesDir(Environment.DIRECTORY_PICTURES)
        return File(pictures ?: context.filesDir, "ImageStudio").apply { mkdirs() }
    }

    private fun saveFinalImage(context: Context, imageB64: String, outputFormat: String, suggestedName: String): String {
        val bytes = Base64.decode(imageB64, Base64.DEFAULT)
        return saveFinalImageBytes(context, bytes, outputFormat, suggestedName)
    }

    private fun saveFinalImageBytes(context: Context, bytes: ByteArray, outputFormat: String, suggestedName: String): String {
        val name = ensureImageFileName(suggestedName, outputFormat)
        val dir = defaultOutputDir(context)
        val file = uniqueFile(dir, name)
        FileOutputStream(file).use { it.write(bytes) }
        return file.absolutePath
    }

    private fun publishImageToGallery(context: Context, savedPath: String): String? {
        val source = File(savedPath)
        if (!source.isFile) return null
        val name = ensureImageFileName(source.name, source.extension.ifBlank { "png" })
        val mimeType = mimeForPath(name)
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver = context.contentResolver
                val values = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                    put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
                    put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + File.separator + "ImageStudio")
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
                val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                    ?: throw IllegalStateException("MediaStore insert returned null")
                var completed = false
                try {
                    resolver.openOutputStream(uri)?.use { output ->
                        FileInputStream(source).use { input -> input.copyTo(output) }
                    } ?: throw IllegalStateException("MediaStore output stream is null")
                    values.clear()
                    values.put(MediaStore.MediaColumns.IS_PENDING, 0)
                    resolver.update(uri, values, null, null)
                    completed = true
                    uri.toString()
                } finally {
                    if (!completed) resolver.delete(uri, null, null)
                }
            } else {
                val publicDir = File(
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES),
                    "ImageStudio",
                ).apply { mkdirs() }
                val galleryFile = uniqueFile(publicDir, name)
                FileInputStream(source).use { input ->
                    FileOutputStream(galleryFile).use { output -> input.copyTo(output) }
                }
                context.sendBroadcast(Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE, Uri.fromFile(galleryFile)))
                galleryFile.absolutePath
            }
        } catch (error: Exception) {
            Log.w(logTag, "Auto gallery save failed for ${source.name}: ${error.message ?: error.javaClass.simpleName}")
            null
        }
    }

    private fun saveIntermediateImage(context: Context, imageB64: String, outputFormat: String, suggestedName: String): String {
        val bytes = Base64.decode(imageB64, Base64.DEFAULT)
        val file = uniqueFile(File(context.filesDir, "intermediate").apply { mkdirs() }, ensureImageFileName(suggestedName, outputFormat))
        FileOutputStream(file).use { it.write(bytes) }
        return file.absolutePath
    }

    private fun createPreviewFile(context: Context, savedPath: String): PreviewAsset? {
        return try {
            val source = File(savedPath)
            if (!source.exists()) return null
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(source.absolutePath, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
            val maxEdge = max(bounds.outWidth, bounds.outHeight)
            var sample = 1
            while (maxEdge / sample > previewMaxEdge * 2) sample *= 2
            val decoded = BitmapFactory.decodeFile(
                source.absolutePath,
                BitmapFactory.Options().apply { inSampleSize = sample },
            ) ?: return null
            val scaled = try {
                val scale = minOf(1f, previewMaxEdge.toFloat() / max(decoded.width, decoded.height).toFloat())
                if (scale >= 0.999f) decoded
                else Bitmap.createScaledBitmap(
                    decoded,
                    max(1, (decoded.width * scale).roundToInt()),
                    max(1, (decoded.height * scale).roundToInt()),
                    true,
                )
            } catch (_: Exception) {
                decoded
            }
            try {
                val out = ByteArrayOutputStream()
                scaled.compress(Bitmap.CompressFormat.JPEG, previewJpegQuality, out)
                val bytes = out.toByteArray()
                val previewFile = uniqueFile(
                    File(context.filesDir, "previews").apply { mkdirs() },
                    "${source.nameWithoutExtension}-preview.jpg",
                )
                FileOutputStream(previewFile).use { it.write(bytes) }
                PreviewAsset(
                    previewFile.absolutePath,
                    "",
                    scaled.width,
                    scaled.height,
                    bounds.outWidth,
                    bounds.outHeight,
                )
            } finally {
                if (scaled != decoded) scaled.recycle()
                decoded.recycle()
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun writeRawLog(context: Context, name: String, text: String): String {
        val file = uniqueFile(File(context.filesDir, "log").apply { mkdirs() }, safeFileName(name, "sse-response.txt"))
        file.writeText(text, Charsets.UTF_8)
        return file.absolutePath
    }

    private fun uniqueFile(directory: File, name: String): File {
        var candidate = File(directory, name)
        if (!candidate.exists()) return candidate
        val dot = name.lastIndexOf('.')
        val stem = if (dot >= 0) name.substring(0, dot) else name
        val ext = if (dot >= 0) name.substring(dot) else ""
        var index = 2
        while (candidate.exists()) {
            candidate = File(directory, "$stem-$index$ext")
            index += 1
        }
        return candidate
    }

    private fun ensureImageFileName(raw: String, outputFormat: String): String {
        val ext = when (outputFormat.lowercase(Locale.US)) {
            "jpeg", "jpg" -> "jpg"
            "webp" -> "webp"
            else -> "png"
        }
        val safe = safeFileName(raw, "image-${timestampForFile()}.$ext")
        return if (Regex("\\.(png|jpe?g|webp)$", RegexOption.IGNORE_CASE).containsMatchIn(safe)) safe else "$safe.$ext"
    }

    private fun safeFileName(raw: String, fallback: String): String {
        val cleaned = raw.trim().replace(Regex("[^A-Za-z0-9._\\-\\u4E00-\\u9FFF]+"), "-").trim('-')
        return cleaned.ifBlank { fallback }
    }

    private fun safeNamePart(raw: String): String = safeFileName(raw.take(24), "image")

    private fun mimeForPath(path: String): String {
        val lower = path.lowercase(Locale.US)
        return when {
            lower.endsWith(".jpg") || lower.endsWith(".jpeg") -> "image/jpeg"
            lower.endsWith(".webp") -> "image/webp"
            else -> "image/png"
        }
    }

    private fun timestampForFile(): String = SimpleDateFormat("yyyyMMdd-HHmmss-SSS", Locale.US).format(Date())

    private data class IdleRegistration(
        val generation: Long,
        val callback: (() -> Unit)?,
    )

    private data class SizePixels(
        val width: Int,
        val height: Int,
    )

    private data class JobImageResult(
        val imageB64: String,
        val revisedPrompt: String,
        val sourceEvent: String,
        val rawPath: String?,
        val apimartTaskId: String? = null,
        val apimartTaskStatus: String? = null,
        val taskId: String? = null,
        val imageBytes: ByteArray? = null,
    )

    private data class RegistryMigration(
        val dirty: Boolean,
        val droppedGroupIds: List<String>,
    )

    private data class HttpRequestBody(
        val url: String,
        val bodyBytes: ByteArray,
        val contentType: String,
    )

    private data class HttpTextResponse(
        val status: Int,
        val body: String,
        val contentType: String,
    )

    private data class HttpBytesResponse(
        val status: Int,
        val bytes: ByteArray,
        val contentType: String,
    )

    private data class DataURLImage(
        val mimeType: String,
        val base64: String,
        val bytes: ByteArray,
    )

    private data class APIMartSubmitResult(
        val taskId: String,
        val images: List<String>,
        val rawPath: String?,
    )

    private data class APIMartPollResult(
        val images: List<String>,
        val rawPath: String?,
    )

    private data class RunningHubSubmitResult(
        val taskId: String,
        val images: List<String>,
        val rawPath: String?,
    )

    private data class RunningHubPollResult(
        val images: List<String>,
        val rawPath: String?,
    )

    private data class PreviewAsset(
        val path: String,
        val dataUrl: String,
        val width: Int,
        val height: Int,
        val sourceWidth: Int,
        val sourceHeight: Int,
    )

    private class JobRequestException(
        message: String,
        val rawPath: String?,
        val retryable: Boolean,
        val apimartTaskId: String? = null,
        val apimartTaskStatus: String? = null,
        val taskId: String? = null,
    ) : Exception(message)
}
