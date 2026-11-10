package top.fangtangyuan.fhlstudio.android

import android.content.ContentValues
import android.content.Context
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONObject
import org.json.JSONArray
import android.provider.OpenableColumns
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.URI
import java.net.Proxy
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.concurrent.ConcurrentHashMap
import java.util.Locale
import kotlin.concurrent.thread
import kotlin.math.max
import kotlin.math.roundToInt
import android.graphics.Bitmap
import android.graphics.BitmapFactory

internal fun shouldFollowBridgeRedirect(method: String): Boolean {
    return method.equals("GET", ignoreCase = true) || method.equals("HEAD", ignoreCase = true)
}

private val probeModelIdPattern = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{1,159}$")

private const val maxImageModelCatalogIdLength = 128

/**
 * Keep this predicate in sync with the web catalog.  A prefix check is unsafe:
 * it would also admit ids such as `gpt-image-20` and arbitrary provider paths.
 */
internal val gptImage2FamilyPattern = Regex(
    "^gpt-image-2(?:\\.(\\d+))?(?:-[a-z0-9][a-z0-9._-]*)?$",
    RegexOption.IGNORE_CASE,
)
private val nonImageModelHintPattern = Regex(
    "(?:embedding|embed|audio|speech|moderation|rerank|transcri(?:be|ption)|tts|whisper)",
    RegexOption.IGNORE_CASE,
)
private val imageModelNameHintPattern = Regex("(?:image|dall|imagen)", RegexOption.IGNORE_CASE)

internal data class FHLImageModelCatalogEntry(
    val id: String,
    val description: String,
    val imageCapable: Boolean = true,
    val supportsGenerations: Boolean = true,
    val supportsEdits: Boolean = true,
    val supportsTransparency: Boolean,
    val available: Boolean = true,
    val disabledReason: String? = null,
)

private const val fuzzyImage25AliasReason = "不可调用的模糊模型别名"
private const val unsupportedAndroidImageModelReason = "当前 Android 实现暂不支持"
private const val providerUnavailableReason = "Provider 标记为不可用"
private const val providerImageCapabilityReason = "Provider 未声明图像生成能力"
private const val providerGenerationReason = "Provider 不支持图像生成"

private fun knownImageModelDescription(id: String): String = when (id.lowercase(Locale.US)) {
    "gpt-image-2" -> "兼容原有 V2.0 工作方式，继续使用稳定流程。"
    "gpt-image-2.5-flare" -> "速度优先，适合批量生成和快速迭代，支持透明 PNG。"
    "gpt-image-2.5-sunburst" -> "高精度，适合精细编辑、复杂细节和透明 PNG。"
    else -> "Provider 返回的图像模型"
}

private fun sanitizeImageModelCatalogId(raw: String): String {
    val id = raw.trim()
    if (id.isBlank() || id.codePointCount(0, id.length) > maxImageModelCatalogIdLength) return ""
    var offset = 0
    while (offset < id.length) {
        val codePoint = id.codePointAt(offset)
        if (Character.getType(codePoint) == Character.CONTROL.toInt()) return ""
        offset += Character.charCount(codePoint)
    }
    return id
}

internal fun parseFHLImageModelCatalog(data: JSONArray): List<FHLImageModelCatalogEntry> {
    val entries = linkedMapOf<String, FHLImageModelCatalogEntry>()
    for (index in 0 until data.length()) {
        val item = data.opt(index)
        val objectItem = item as? JSONObject
        val rawId = when (item) {
            is String -> item
            is JSONObject -> item.optString("id")
            else -> ""
        }
        val id = sanitizeImageModelCatalogId(rawId)
        if (id.isBlank()) continue
        val family = gptImage2FamilyPattern.matches(id)
        val explicitImageCapable = objectItem?.strictBoolean("imageCapable", "image_capable")
        val explicitGenerations = objectItem?.strictBoolean("supportsGenerations", "supports_generations")
        val explicitEdits = objectItem?.strictBoolean("supportsEdits", "supports_edits")
        val explicitTransparency = objectItem?.strictBoolean("supportsTransparency", "supports_transparency")
        val explicitAvailable = objectItem?.strictBoolean("available", "isAvailable", "is_available")
        val explicitImageCapability = hasExplicitImageGenerationCapability(objectItem)
            || explicitGenerations == true
            || explicitEdits == true
        val knownNonImage = knownNonImageModel(id, objectItem)
        val declaresImageInput = declaresImageInput(objectItem)
        val contradictoryMetadata = !explicitImageCapability && (knownNonImage || declaresImageInput)
        // A malformed GPT Image-looking id without an explicit image endpoint
        // is not a safe diagnostic candidate. Keep provider-specific image
        // candidates visible only when the response explicitly describes an
        // image-generation route.
        if (!family && id.lowercase(Locale.US).startsWith("gpt-image-") && !explicitImageCapability) continue
        // Keep non-GPT image candidates as visible diagnostics only. Text/audio/etc.
        // models without an explicit image capability must never enter the catalog.
        if (!family && (nonImageModelHintPattern.containsMatchIn(id) || knownNonImage)) continue
        if (!family && declaresImageInput && !explicitImageCapability) continue
        if (!family && !imageModelNameHintPattern.containsMatchIn(id) && !explicitImageCapability) continue

        // Exact GPT Image ids remain visible for diagnosis, but contradictory
        // text/input-only metadata must not inherit the family defaults.
        val imageCapable = if (contradictoryMetadata) false else explicitImageCapable ?: true
        val supportsGenerations = if (contradictoryMetadata) false else explicitGenerations ?: true
        val supportsEdits = explicitEdits ?: true
        val fuzzyAlias = id.equals("gpt-image-2.5", ignoreCase = true)
        var available = (explicitAvailable != false) && imageCapable && supportsGenerations && family
        var disabledReason: String? = when {
            fuzzyAlias -> fuzzyImage25AliasReason
            explicitAvailable == false -> providerUnavailableReason
            !imageCapable -> providerImageCapabilityReason
            !supportsGenerations -> providerGenerationReason
            !family -> unsupportedAndroidImageModelReason
            else -> null
        }
        if (fuzzyAlias) available = false
        val minor = gptImage2Minor(id)
        val supportsTransparency = available
            && family
            && minor != null
            && minor >= 5
            && !fuzzyAlias
            && explicitTransparency != false
        val candidate = FHLImageModelCatalogEntry(
            id = id,
            description = knownImageModelDescription(id),
            imageCapable = imageCapable,
            supportsGenerations = supportsGenerations,
            supportsEdits = supportsEdits,
            supportsTransparency = supportsTransparency,
            available = available,
            disabledReason = disabledReason,
        )
        val key = id.lowercase(Locale.US)
        val previous = entries[key]
        entries[key] = if (previous == null) candidate else mergeCatalogEntries(previous, candidate)
    }
    return entries.values.toList()
}

private fun knownNonImageModel(id: String, item: JSONObject?): Boolean {
    val lower = id.lowercase(Locale.US)
    if (listOf("text-", "embedding", "text_embedding", "whisper", "audio", "speech", "transcribe", "transcription", "tts-", "moderation", "omni-moderation", "rerank")
            .any(lower::startsWith)
    ) return true
    if (item == null) return false
    for (key in listOf("type", "model_type", "object")) {
        val value = (item.opt(key) as? String)?.trim()?.lowercase(Locale.US).orEmpty()
        if (value in setOf("text", "text_model", "text-model", "language_model", "language-model", "chat")
            || listOf("embedding", "moderation", "audio", "speech", "rerank").any(value::contains)
        ) return true
    }
    return false
}

private fun hasExplicitImageGenerationCapability(item: JSONObject?): Boolean {
    if (item == null) return false
    for (key in listOf("type", "model_type")) {
        if (imageTypeCapabilityValue(item.opt(key))) return true
    }
    for (key in listOf("output_modalities", "output_types", "output_type")) {
        if (imageOutputCapabilityValue(item.opt(key))) return true
    }
    for (key in listOf("modality", "modalities", "capabilities", "endpoints", "supported_endpoints")) {
        if (imageGenerationCapabilityValue(item.opt(key))) return true
    }
    return false
}

private fun declaresImageInput(item: JSONObject?): Boolean {
    if (item == null) return false
    return listOf("input_modality", "input_modalities", "input_types", "input_type")
        .any { imageOutputCapabilityValue(item.opt(it)) }
}

private fun imageGenerationMarker(value: String): Boolean {
    val text = value.lowercase(Locale.US)
    return listOf(
        "image_generation", "image-generation", "image generation",
        "image_edit", "image-edit", "image editing", "images/generations", "images/edits",
    ).any(text::contains)
}

private fun imageGenerationCapabilityValue(value: Any?): Boolean = when (value) {
    is String -> imageGenerationMarker(value)
    is JSONArray -> (0 until value.length()).any { imageGenerationCapabilityValue(value.opt(it)) }
    is JSONObject -> value.keys().asSequence().any { key ->
        val child = value.opt(key)
        (imageGenerationMarker(key) && (child !is Boolean || child)) || imageGenerationCapabilityValue(child)
    }
    else -> false
}

private fun imageTypeCapabilityValue(value: Any?): Boolean {
    if (imageGenerationCapabilityValue(value)) return true
    val normalized = (value as? String)?.trim()?.lowercase(Locale.US).orEmpty()
    return normalized in setOf("image", "image_model", "image-model")
}

private fun imageOutputCapabilityValue(value: Any?): Boolean = when (value) {
    is String -> imageGenerationMarker(value) || value.trim().lowercase(Locale.US) in setOf("image", "images")
    is JSONArray -> (0 until value.length()).any { imageOutputCapabilityValue(value.opt(it)) }
    is JSONObject -> value.keys().asSequence().any { key ->
        val child = value.opt(key)
        ((key.equals("image", true) || key.equals("images", true)) && (child !is Boolean || child))
            || imageOutputCapabilityValue(child)
    }
    else -> false
}

private fun JSONObject.strictBoolean(vararg keys: String): Boolean? {
    for (key in keys) {
        if (has(key) && !isNull(key)) return opt(key) as? Boolean
        val capabilities = optJSONObject("capabilities")
        if (capabilities != null && capabilities.has(key) && !capabilities.isNull(key)) {
            return capabilities.opt(key) as? Boolean
        }
    }
    return null
}

private fun gptImage2Minor(id: String): Int? {
    val match = gptImage2FamilyPattern.matchEntire(id.trim()) ?: return 0
    val raw = match.groupValues.getOrNull(1).orEmpty()
    if (raw.isBlank()) return 0
    return raw.toIntOrNull()?.takeIf { it >= 0 }
}

private fun mergeCatalogEntries(
    left: FHLImageModelCatalogEntry,
    right: FHLImageModelCatalogEntry,
): FHLImageModelCatalogEntry {
    val available = left.available && right.available
    val reason = when {
        left.disabledReason == fuzzyImage25AliasReason || right.disabledReason == fuzzyImage25AliasReason -> fuzzyImage25AliasReason
        left.disabledReason != null -> left.disabledReason
        right.disabledReason != null -> right.disabledReason
        !available -> providerUnavailableReason
        else -> null
    }
    return left.copy(
        imageCapable = left.imageCapable && right.imageCapable,
        supportsGenerations = left.supportsGenerations && right.supportsGenerations,
        supportsEdits = left.supportsEdits && right.supportsEdits,
        supportsTransparency = left.supportsTransparency && right.supportsTransparency,
        available = available,
        disabledReason = reason,
    )
}

internal fun parseProbeModelIds(data: JSONArray): List<String> {
    val models = linkedSetOf<String>()
    for (index in 0 until data.length()) {
        val item = data.opt(index)
        val id = when (item) {
            is String -> item.trim()
            is JSONObject -> item.optString("id").trim()
            else -> ""
        }
        if (probeModelIdPattern.matches(id)) models.add(id)
    }
    return models.toList()
}

class AndroidImageStudioBridge(
    private val context: Context,
    private val webView: WebView,
    private val launchOpenImageDialog: () -> Unit,
    private val launchImportHistory: () -> Unit,
) {
    private val prefs = context.getSharedPreferences("image_studio_android", Context.MODE_PRIVATE)
    private val credentialStore = AndroidCredentialStore(context)
    private val outputDirKey = "output_dir"
    private var pendingOpenImageRequestId: String? = null
    private var pendingImportHistoryRequestId: String? = null
    private val httpRequests = ConcurrentHashMap<String, HttpURLConnection>()
    @Volatile private var fullscreen = false
    @Volatile private var safeAreaDiagnostics = JSONObject()

    companion object {
        private const val maxDialogReadBytes: Long = 50L * 1024L * 1024L
        private const val maxDialogPreviewEdge = 1536
        private const val maxCanvasPreviewEdge = 1280
        private const val dialogPreviewJpegQuality = 92
        private const val defaultPreviewJpegQuality = 74
        private const val apimartOfficialBaseUrl = "https://api.apimart.ai"
        private const val apimartOfficialHost = "api.apimart.ai"
        private const val apimartLegacyBaseUrl = "https://api.apib.ai"
    }

    @JavascriptInterface
    fun invoke(requestId: String, method: String, payloadJson: String) {
        try {
            val args = JSONArray(payloadJson)
            when (method) {
                "OpenImageDialog" -> {
                    if (pendingOpenImageRequestId != null) {
                        throw IllegalStateException("图片选择已在进行中")
                    }
                    pendingOpenImageRequestId = requestId
                    launchOpenImageDialog()
                    return
                }
                "ImportHistoryFromFile" -> {
                    if (pendingImportHistoryRequestId != null) {
                        throw IllegalStateException("历史导入已在进行中")
                    }
                    pendingImportHistoryRequestId = requestId
                    launchImportHistory()
                    return
                }
            }
            val result: Any? = when (method) {
                "GetOutputDir" -> getOutputDir()
                "SetOutputDir" -> {
                    setOutputDir(args.optString(0, ""))
                    null
                }
                "ChooseOutputDir" -> getOutputDir()
                "GetStoredAPIKey" -> getStoredApiKey(args.optString(0))
                "SetStoredAPIKey" -> {
                    setStoredApiKey(args.optString(0), args.optString(1))
                    null
                }
                "DeleteStoredAPIKey" -> {
                    deleteStoredApiKey(args.optString(0))
                    null
                }
                "ReadClipboardText" -> readClipboardText()
                "OpenExternalURL" -> {
                    openExternalUrl(args.optString(0))
                    null
                }
                "OpenOutputDir" -> {
                    openOutputDir()
                    null
                }
                "ImportImageFromB64" -> importImageFromB64(args.optString(0), args.optString(1))
                "RegisterMediaAsset" -> registerMediaAsset(args.optString(0), args.optString(1))
                "RegisterImportedImageAsset" -> registerImportedImageAsset(args.optString(0))
                "ReadImageAsBase64" -> readImageAsBase64(args.optString(0))
                "ReadTextFile" -> readTextFile(args.optString(0))
                "OpenFile" -> {
                    openFile(args.optString(0))
                    null
                }
                "ExportHistoryToFile" -> exportHistory(args.optString(0))
                "SaveImageAs" -> saveImage(args.optString(0), args.optString(1))
                "SaveImagePathAs" -> saveImagePathAs(args.optString(0), args.optString(1))
                "SaveImageToDir" -> saveImageToDir(args.optString(0), args.optString(1), args.optString(2))
                "SaveImagePathToDir" -> saveImagePathToDir(args.optString(0), args.optString(1), args.optString(2))
                "ShareImageAs" -> shareImage(args.optString(0), args.optString(1))
                "ShareImagePathAs" -> shareImagePathAs(args.optString(0), args.optString(1))
                "HttpRequestText" -> {
                    val payload = args.optJSONObject(0) ?: throw IllegalArgumentException("缺少 HTTP 请求参数")
                    runHttpRequestText(requestId, payload)
                }
                "ProbeUpstream" -> {
                    val payload = args.optJSONObject(0) ?: throw IllegalArgumentException("缺少测活参数")
                    runProbeUpstream(requestId, payload)
                }
                "ListImageModels" -> {
                    val payload = args.optJSONObject(0) ?: throw IllegalArgumentException("缺少生图模型目录参数")
                    runListImageModels(requestId, payload)
                }
                "CommitImageModelValidationBatch" -> {
                    val payload = args.optJSONObject(0) ?: throw IllegalArgumentException("缺少统一模型验证参数")
                    commitImageModelValidationBatch(payload)
                }
                "InvalidateImageModelValidationProfiles" -> {
                    val profileIds = args.optJSONArray(0)
                        ?: throw IllegalArgumentException("缺少需要撤销模型验证的 Profile")
                    invalidateImageModelValidationProfiles(profileIds)
                    null
                }
                "InvalidateImageModelValidationBatches" -> {
                    val profileIds = args.optJSONArray(0)
                        ?: throw IllegalArgumentException("缺少需要撤销模型验证的 Profile")
                    invalidateImageModelValidationProfiles(profileIds, batchesOnly = true)
                    null
                }
                "SubmitAndroidJobs" -> {
                    val payload = args.optJSONObject(0) ?: throw IllegalArgumentException("缺少后台任务参数")
                    AndroidJobManager.submit(context, payload)
                }
                "ListAndroidJobs" -> AndroidJobManager.list(
                    context,
                    args.optString(0, "default"),
                    args.optInt(1, 50),
                )
                "CancelAndroidJobs" -> AndroidJobManager.cancel(
                    context,
                    args.optJSONArray(0) ?: JSONArray(),
                )
                "AttachAndroidJobEvents" -> AndroidJobManager.attach(
                    context,
                    args.optJSONArray(0) ?: JSONArray(),
                )
                "CancelHttpRequest" -> {
                    cancelHttpRequest(args.optString(0))
                    null
                }
                "Vibrate" -> {
                    vibrate(args.optLong(0, 50L))
                    null
                }
                "SetFullscreen" -> {
                    setFullscreen(args.optBoolean(0, false))
                    null
                }
                "IsFullscreen" -> fullscreen
                else -> throw UnsupportedOperationException("$method is not implemented in Android shell yet")
            }
            resolve(requestId, result)
        } catch (_: EarlyResolve) {
            return
        } catch (error: Exception) {
            reject(requestId, error.message ?: error.javaClass.simpleName)
        }
    }

    @JavascriptInterface
    fun getOutputDir(): String {
        return prefs.getString(outputDirKey, defaultOutputDir().absolutePath) ?: defaultOutputDir().absolutePath
    }

    @JavascriptInterface
    fun setOutputDir(path: String) {
        val dir = if (path.isBlank()) defaultOutputDir() else File(path)
        dir.mkdirs()
        prefs.edit().putString(outputDirKey, dir.absolutePath).apply()
    }

    @JavascriptInterface
    fun importImageFromB64(imageB64: String, suggestedName: String): Map<String, Any> {
        val bytes = Base64.decode(imageB64, Base64.DEFAULT)
        val file = writeImportedBytes(bytes, suggestedName)
        val preview = createPreviewRef(file, maxCanvasPreviewEdge)
        val result = mutableMapOf<String, Any>(
            "path" to file.absolutePath,
            "imageB64" to imageB64,
        )
        result.putAll(preview)
        return result
    }

    @JavascriptInterface
    fun registerMediaAsset(savedPath: String, thumbPath: String): Map<String, Any> {
        val saved = savedPath.trim()
        if (saved.isBlank()) throw IllegalArgumentException("image path is empty")
        val result = mutableMapOf<String, Any>("savedPath" to saved)
        val thumb = thumbPath.trim()
        if (thumb.isNotBlank()) result["thumbPath"] = thumb
        val previewSource = androidPreviewSourcePath(saved, thumb)
        result.putAll(createPreviewRef(File(previewSource), maxCanvasPreviewEdge))
        return result
    }

    @JavascriptInterface
    fun registerImportedImageAsset(path: String): Map<String, Any> {
        val saved = path.trim()
        if (saved.isBlank()) throw IllegalArgumentException("image path is empty")
        val result = mutableMapOf<String, Any>("savedPath" to saved)
        result.putAll(createPreviewRef(File(saved), maxCanvasPreviewEdge))
        return result
    }

    @JavascriptInterface
    fun getStoredApiKey(user: String): String {
        return credentialStore.getProfileCredential(user)
    }

    @JavascriptInterface
    fun setStoredApiKey(user: String, value: String) {
        credentialStore.setProfileCredential(user, value)
        AndroidImageModelValidationRegistry.invalidateCredentialUser(context, user)
    }

    @JavascriptInterface
    fun deleteStoredApiKey(user: String) {
        credentialStore.deleteProfileCredential(user)
        AndroidImageModelValidationRegistry.invalidateCredentialUser(context, user)
    }

    @JavascriptInterface
    fun readClipboardText(): String {
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            ?: return ""
        val item = clipboard.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)
            ?: return ""
        return item.coerceToText(context)?.toString().orEmpty()
    }

    @JavascriptInterface
    fun getDisplayMetricsJson(): String {
        val dm = context.resources.displayMetrics
        val config = context.resources.configuration
        val widthPx = dm.widthPixels
        val heightPx = dm.heightPixels
        val orientation = when (config.orientation) {
            Configuration.ORIENTATION_LANDSCAPE -> "landscape"
            Configuration.ORIENTATION_PORTRAIT -> "portrait"
            else -> "undefined"
        }
        return JSONObject()
            .put("widthPx", widthPx)
            .put("heightPx", heightPx)
            .put("density", dm.density.toDouble())
            .put("densityDpi", dm.densityDpi)
            .put("screenWidthDp", config.screenWidthDp)
            .put("screenHeightDp", config.screenHeightDp)
            .put("smallestScreenWidthDp", config.smallestScreenWidthDp)
            .put("orientation", orientation)
            .toString()
    }

    fun updateSafeAreaDiagnostics(value: JSONObject) {
        safeAreaDiagnostics = value
    }

    @JavascriptInterface
    fun getDeviceDiagnosticsJson(): String {
        val dm = context.resources.displayMetrics
        val config = context.resources.configuration
        val orientation = when (config.orientation) {
            Configuration.ORIENTATION_LANDSCAPE -> "landscape"
            Configuration.ORIENTATION_PORTRAIT -> "portrait"
            else -> "undefined"
        }
        val appVersion = runCatching {
            val info = context.packageManager.getPackageInfo(context.packageName, 0)
            info.versionName ?: ""
        }.getOrDefault("")
        val webViewVersion = runCatching {
            WebView.getCurrentWebViewPackage()?.versionName ?: ""
        }.getOrDefault("")
        return JSONObject()
            .put("appVersion", appVersion)
            .put("packageName", context.packageName)
            .put("androidSdk", Build.VERSION.SDK_INT)
            .put("androidRelease", Build.VERSION.RELEASE)
            .put("manufacturer", Build.MANUFACTURER)
            .put("model", Build.MODEL)
            .put("webViewVersion", webViewVersion)
            .put("widthPx", dm.widthPixels)
            .put("heightPx", dm.heightPixels)
            .put("density", dm.density.toDouble())
            .put("densityDpi", dm.densityDpi)
            .put("screenWidthDp", config.screenWidthDp)
            .put("screenHeightDp", config.screenHeightDp)
            .put("smallestScreenWidthDp", config.smallestScreenWidthDp)
            .put("orientation", orientation)
            .put("safeArea", safeAreaDiagnostics)
            .toString()
    }

    @JavascriptInterface
    fun openOutputDir(): String {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "image/*")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            return "MediaStore"
        }
        val dir = File(getOutputDir()).apply { mkdirs() }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", dir)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "*/*")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(intent)
        return dir.absolutePath
    }

    @JavascriptInterface
    fun openExternalUrl(url: String) {
        val target = url.trim()
        if (target.isBlank()) throw IllegalArgumentException("URL is empty")
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(target)).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            context.startActivity(intent)
        } catch (error: ActivityNotFoundException) {
            throw IllegalStateException("No app can open this URL", error)
        }
    }

    @JavascriptInterface
    fun exportHistory(jsonContent: String): String {
        val file = File(getOutputDir(), "fhl-studio-history-${timestamp()}.json")
        file.parentFile?.mkdirs()
        file.writeText(jsonContent)
        return file.absolutePath
    }

    @JavascriptInterface
    fun readImageAsBase64(path: String): String {
        val bytes = openInputStreamForPath(path).use { it.readBytes() }
        return Base64.encodeToString(bytes, Base64.NO_WRAP)
    }

    @JavascriptInterface
    fun readTextFile(path: String): String {
        return openInputStreamForPath(path).bufferedReader().use { it.readText() }
    }

    @JavascriptInterface
    fun openFile(path: String) {
        val uriAndMime = uriAndMimeForPath(path)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uriAndMime.first, uriAndMime.second)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(intent)
    }

    @JavascriptInterface
    fun saveImage(imageB64: String, suggestedName: String): String {
        if (imageB64.isBlank()) throw IllegalArgumentException("图片数据为空")
        val name = ensureImageFileName(suggestedName, "image-${timestamp()}.png")
        val bytes = Base64.decode(imageB64, Base64.DEFAULT)
        return saveImageStream(name, imageMimeForName(name)) { output ->
            output.write(bytes)
        }
    }

    @JavascriptInterface
    fun saveImagePathAs(path: String, suggestedName: String): String {
        val trimmed = path.trim()
        if (trimmed.isBlank()) throw IllegalArgumentException("图片路径为空")
        val fallback = trimmed.substringAfterLast('/').substringAfterLast('\\').ifBlank { "image-${timestamp()}.png" }
        val name = ensureImageFileName(suggestedName.ifBlank { fallback }, fallback)
        return saveImageStream(name, imageMimeForName(name)) { output ->
            openInputStreamForPath(trimmed).use { input ->
                input.copyTo(output)
            }
        }
    }

    @JavascriptInterface
    fun saveImageToDir(imageB64: String, directory: String, suggestedName: String): String {
        if (imageB64.isBlank()) throw IllegalArgumentException("image data is empty")
        val targetDir = ensureWritableDirectory(directory)
        val name = ensureImageFileName(suggestedName, "image-${timestamp()}.png")
        val bytes = Base64.decode(imageB64, Base64.DEFAULT)
        val file = uniqueTargetFile(targetDir, name)
        FileOutputStream(file).use { output -> output.write(bytes) }
        return file.absolutePath
    }

    @JavascriptInterface
    fun saveImagePathToDir(path: String, directory: String, suggestedName: String): String {
        val trimmed = path.trim()
        if (trimmed.isBlank()) throw IllegalArgumentException("image path is empty")
        val targetDir = ensureWritableDirectory(directory)
        val fallback = trimmed.substringAfterLast('/').substringAfterLast('\\').ifBlank { "image-${timestamp()}.png" }
        val name = ensureImageFileName(suggestedName.ifBlank { fallback }, fallback)
        val file = uniqueTargetFile(targetDir, name)
        openInputStreamForPath(trimmed).use { input ->
            FileOutputStream(file).use { output -> input.copyTo(output) }
        }
        return file.absolutePath
    }

    @JavascriptInterface
    fun shareImage(imageB64: String, suggestedName: String): String {
        if (imageB64.isBlank()) throw IllegalArgumentException("image data is empty")
        val name = ensureImageFileName(suggestedName, "image-${timestamp()}.png")
        val bytes = Base64.decode(imageB64, Base64.DEFAULT)
        val file = uniqueTargetFile(shareDir(), name)
        FileOutputStream(file).use { output -> output.write(bytes) }
        shareImageUri(fileProviderUri(file), imageMimeForName(name), name)
        return file.absolutePath
    }

    @JavascriptInterface
    fun shareImagePathAs(path: String, suggestedName: String): String {
        val trimmed = path.trim()
        if (trimmed.isBlank()) throw IllegalArgumentException("image path is empty")
        val fallback = trimmed.substringAfterLast('/').substringAfterLast('\\').ifBlank { "image-${timestamp()}.png" }
        val name = ensureImageFileName(suggestedName.ifBlank { fallback }, fallback)
        val uri = if (trimmed.startsWith("content://")) Uri.parse(trimmed) else fileProviderUri(File(trimmed))
        shareImageUri(uri, imageMimeForName(name), name)
        return trimmed
    }

    private fun saveImageStream(name: String, mimeType: String, write: (OutputStream) -> Unit): String {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val contentValues = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + File.separator + "ImageStudio")
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }

            val resolver = context.contentResolver
            val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, contentValues)
            if (uri != null) {
                var mediaSaved = false
                try {
                    resolver.openOutputStream(uri)?.use { output ->
                        write(output)
                    } ?: throw IllegalStateException("无法写入相册文件")
                    mediaSaved = true
                } catch (error: Exception) {
                    resolver.delete(uri, null, null)
                }
                if (mediaSaved) {
                    try {
                        contentValues.clear()
                        contentValues.put(MediaStore.MediaColumns.IS_PENDING, 0)
                        resolver.update(uri, contentValues, null, null)
                        return uri.toString()
                    } catch (_: Exception) {
                        resolver.delete(uri, null, null)
                    }
                }
            }
        }

        val file = uniqueTargetFile(File(getOutputDir()), name)
        file.parentFile?.mkdirs()
        FileOutputStream(file).use { output ->
            write(output)
        }
        return file.absolutePath
    }

    private fun ensureWritableDirectory(path: String): File {
        val trimmed = path.trim()
        if (trimmed.isBlank()) throw IllegalArgumentException("target directory is empty")
        val dir = File(trimmed)
        dir.mkdirs()
        return dir
    }

    private fun uniqueTargetFile(directory: File, suggestedName: String): File {
        val baseName = ensureImageFileName(suggestedName, "image-${timestamp()}.png")
        var candidate = File(directory, baseName)
        if (!candidate.exists()) return candidate
        val dot = baseName.lastIndexOf('.')
        val stem = if (dot >= 0) baseName.substring(0, dot) else baseName
        val ext = if (dot >= 0) baseName.substring(dot) else ""
        var index = 2
        while (candidate.exists()) {
            candidate = File(directory, "$stem-$index$ext")
            index += 1
        }
        return candidate
    }

    @JavascriptInterface
    fun vibrate(milliseconds: Long) {
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vibratorManager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            vibratorManager.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createOneShot(milliseconds, VibrationEffect.DEFAULT_AMPLITUDE))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(milliseconds)
        }
    }

    @JavascriptInterface
    fun setFullscreen(enabled: Boolean) {
        fullscreen = enabled
        val activity = context as? AppCompatActivity ?: return
        activity.runOnUiThread {
            WindowCompat.setDecorFitsSystemWindows(activity.window, false)
            val controller = WindowInsetsControllerCompat(activity.window, webView)
            if (enabled) {
                controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                controller.hide(WindowInsetsCompat.Type.systemBars())
            } else {
                controller.show(WindowInsetsCompat.Type.systemBars())
            }
            webView.post {
                webView.evaluateJavascript(
                    """
                    (() => {
                      window.dispatchEvent(new Event('resize'));
                      if (window.visualViewport) {
                        window.visualViewport.dispatchEvent(new Event('resize'));
                      }
                    })();
                    """.trimIndent(),
                    null,
                )
            }
        }
    }

    private fun runHttpRequestText(requestId: String, payload: JSONObject): Nothing {
        val requestKey = payload.optString("requestKey").ifBlank { requestId }
        val url = payload.optString("url").trim()
        val method = payload.optString("method", "GET").trim().uppercase(Locale.US)
        val headersJson = payload.optJSONObject("headers")
        val bodyBase64 = payload.optString("bodyBase64")
        val contentType = payload.optString("contentType")
        val streamLines = payload.optBoolean("streamLines", false)
        val responseBase64 = payload.optBoolean("responseBase64", false)
        val proxyMode = payload.optString("proxyMode", "system")
        val proxyUrl = payload.optString("proxyURL", "")
        thread(name = "fhl-studio-http-$requestKey") {
            try {
                val connection = openHttpConnection(url, proxyMode, proxyUrl).apply {
                    requestMethod = method
                    instanceFollowRedirects = shouldFollowBridgeRedirect(method)
                    connectTimeout = connectTimeoutForUrl(url, 30_000)
                    readTimeout = 180_000
                    doInput = true
                }
                httpRequests[requestKey] = connection
                if (headersJson != null) {
                    val keys = headersJson.keys()
                    while (keys.hasNext()) {
                        val key = keys.next()
                        connection.setRequestProperty(key, headersJson.optString(key))
                    }
                }
                if (contentType.isNotBlank() && connection.getRequestProperty("Content-Type").isNullOrBlank()) {
                    connection.setRequestProperty("Content-Type", contentType)
                }
                val requestBytes = if (bodyBase64.isBlank()) ByteArray(0) else Base64.decode(bodyBase64, Base64.DEFAULT)
                if (requestBytes.isNotEmpty()) {
                    connection.doOutput = true
                    connection.useCaches = false
                    connection.setFixedLengthStreamingMode(requestBytes.size)
                    connection.outputStream.use { it.write(requestBytes) }
                }
                val status = connection.responseCode
                val stream = if (status >= 400) connection.errorStream else connection.inputStream
                val responseBytes = if (responseBase64) {
                    stream?.use { it.readBytes() } ?: ByteArray(0)
                } else {
                    null
                }
                val body = if (responseBase64) {
                    ""
                } else if (streamLines) {
                    val lines = mutableListOf<String>()
                    stream?.bufferedReader()?.useLines { sequence ->
                        sequence.forEach { line ->
                            lines.add(line)
                            emitNativeProgress(requestKey, mapOf("line" to line))
                        }
                    }
                    if (lines.isEmpty()) "" else lines.joinToString(separator = "\n", postfix = "\n")
                } else {
                    stream?.bufferedReader()?.use { it.readText() } ?: ""
                }
                val result = mapOf(
                    "status" to status,
                    "body" to body,
                    "bodyBase64" to (responseBytes?.let { Base64.encodeToString(it, Base64.NO_WRAP) } ?: ""),
                    "contentType" to (connection.contentType ?: ""),
                )
                resolve(requestId, result)
            } catch (error: Exception) {
                reject(requestId, error.message ?: error.javaClass.simpleName)
            } finally {
                httpRequests.remove(requestKey)?.disconnect()
            }
        }
        throw EarlyResolve()
    }

    private fun runProbeUpstream(requestId: String, payload: JSONObject): Nothing {
        val baseUrl = validateProbeBaseUrl(payload.optString("baseURL"))
        val apiKey = payload.optString("apiKey").trim()
        val apiMode = payload.optString("apiMode", "responses").trim().lowercase(Locale.US)
        val proxyMode = payload.optString("proxyMode", "system")
        val proxyUrl = payload.optString("proxyURL", "")
        if (apiKey.isBlank()) throw IllegalArgumentException("API Key 不能为空")
        val endpointPath = if (apiMode == "apimart") "/v1/balance" else "/v1/models"
        val baseUrlCandidates = apimartProbeBaseUrlCandidates(baseUrl, apiMode)
        thread(name = "fhl-studio-probe-${requestId.take(12)}") {
            var lastError: Exception? = null
            try {
                for ((index, candidateBaseUrl) in baseUrlCandidates.withIndex()) {
                    try {
                        val url = "$candidateBaseUrl$endpointPath"
                        val connection = openHttpConnection(url, proxyMode, proxyUrl).apply {
                            requestMethod = "GET"
                            instanceFollowRedirects = true
                            connectTimeout = connectTimeoutForUrl(url, 20_000)
                            readTimeout = 20_000
                            doInput = true
                            setRequestProperty("Authorization", "Bearer $apiKey")
                            setRequestProperty("Accept", "application/json")
                            setRequestProperty("User-Agent", "fhl-studio-android")
                        }
                        val status = connection.responseCode
                        val stream = if (status >= 400) connection.errorStream else connection.inputStream
                        val body = stream?.bufferedReader()?.use { reader ->
                            reader.readText().take(1_048_576)
                        } ?: ""
                        connection.disconnect()
                        if (status !in 200..299) {
                            val summary = summarizeProbeBody(body)
                            if (apiMode == "apimart" && (status == 401 || status == 403)) {
                                throw IllegalStateException(if (summary.isBlank()) "APIMart API Key 无效或未授权" else "APIMart API Key 无效或未授权: $summary")
                            }
                            val prefix = if (apiMode == "apimart") "APIMart /v1/balance" else "上游 /v1/models"
                            throw IllegalStateException("$prefix 返回 $status${summary.let { if (it.isBlank()) "" else ": $it" }}")
                        }
                        if (apiMode == "apimart") {
                            val parsed = if (body.isBlank()) JSONObject() else JSONObject(body)
                            if (parsed.has("success") && !parsed.optBoolean("success", true)) {
                                val message = parsed.optString("message").trim().ifBlank {
                                    parsed.optString("error").trim()
                                }
                                throw IllegalStateException(if (message.isBlank()) "APIMart 配置不可用" else "APIMart 配置不可用: $message")
                            }
                            resolve(requestId, mapOf("ok" to true))
                            return@thread
                        }
                        val parsed = JSONObject(body)
                        if (!parsed.has("data") || parsed.isNull("data")) {
                            throw IllegalStateException("上游 /v1/models 响应缺少 data 数组")
                        }
                        val data = parsed.optJSONArray("data") ?: throw IllegalStateException("上游 /v1/models 响应缺少 data 数组")
                        val models = parseProbeModelIds(data)
                        resolve(requestId, mapOf("modelCount" to models.size, "models" to models))
                        return@thread
                    } catch (error: Exception) {
                        lastError = error
                        if (index < baseUrlCandidates.lastIndex && isAPIMartNetworkFallbackError(error)) {
                            continue
                        }
                        throw error
                    }
                }
                throw lastError ?: IllegalStateException("APIMart probe failed")
            } catch (error: Exception) {
                reject(requestId, error.message ?: error.javaClass.simpleName)
            }
        }
        throw EarlyResolve()
    }

    private fun runListImageModels(requestId: String, payload: JSONObject): Nothing {
        // Keep image-model discovery independent from the text-model probe. The caller must
        // provide the image profile's own key, base URL, and proxy settings for this request.
        val baseUrl = normalizedSafeImageCatalogBaseURL(payload.optString("baseURL"))
        val provider = safeImageProviderIdentifier(payload.optString("provider"))
        val apiKey = payload.optString("apiKey").trim()
        val proxyMode = payload.optString("proxyMode", "system")
        val proxyUrl = payload.optString("proxyURL", "")
        val profileId = safeJobMetadataIdentifier(payload.optString("profileId"), "profileId")
        val slotNumber = payload.optInt("slotNumber", 0)
        val validationFetchedAt = payload.optLong("fetchedAt", 0L)
        if (apiKey.isBlank()) throw IllegalArgumentException("API Key 不能为空")
        if (provider.isBlank()) throw IllegalArgumentException("生图模型目录缺少 provider 标识")
        if (profileId.isBlank() || slotNumber !in 1..10 || validationFetchedAt <= 0L) {
            throw IllegalArgumentException("生图模型目录缺少有效的 Profile、槽位或验证时间。")
        }
        if (apiKey.any { it.code < 0x20 || it.code == 0x7F }) {
            throw IllegalArgumentException("API Key 格式无效")
        }
        thread(name = "fhl-studio-image-models-${requestId.take(12)}") {
            var connection: HttpURLConnection? = null
            try {
                val url = "$baseUrl/v1/models"
                connection = openHttpConnection(url, proxyMode, proxyUrl).apply {
                    requestMethod = "GET"
                    // A catalog redirect must not forward this profile's bearer token to a
                    // different origin. The configured URL must serve /v1/models directly.
                    instanceFollowRedirects = false
                    connectTimeout = connectTimeoutForUrl(url, 20_000)
                    readTimeout = 20_000
                    doInput = true
                    setRequestProperty("Authorization", "Bearer $apiKey")
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("User-Agent", "fhl-studio-android")
                }
                val status = connection.responseCode
                if (status !in 200..299) {
                    // Do not include the upstream body in a user-visible error. Some providers
                    // echo authorization material or other sensitive request details.
                    throw IllegalStateException("生图模型目录返回 $status")
                }
                val body = (connection.inputStream?.bufferedReader()?.use { reader ->
                    reader.readText().take(1_048_576)
                } ?: "")
                val parsed = try {
                    JSONObject(body)
                } catch (_: Exception) {
                    throw IllegalStateException("生图模型目录返回的 JSON 无效")
                }
                val data = parsed.optJSONArray("data")
                    ?: throw IllegalStateException("生图模型目录响应缺少 data 数组")
                val models = parseFHLImageModelCatalog(data)
                val validationId = AndroidImageModelValidationRegistry.issueSlotReceipt(
                    context = context,
                    profileId = profileId,
                    slotNumber = slotNumber,
                    baseURL = baseUrl,
                    provider = provider,
                    fetchedAt = validationFetchedAt,
                    models = models,
                )
                val modelJSON = JSONArray()
                for (model in models) {
                    modelJSON.put(
                        JSONObject()
                            .put("id", model.id)
                            .put("description", model.description)
                            .put("imageCapable", model.imageCapable)
                            .put("supportsGenerations", model.supportsGenerations)
                            .put("supportsEdits", model.supportsEdits)
                            .put("supportsTransparency", model.supportsTransparency)
                            .put("available", model.available)
                            .apply {
                                model.disabledReason?.let { put("disabledReason", it) }
                            },
                    )
                }
                resolve(
                    requestId,
                    mapOf(
                        "modelCount" to models.size,
                        "provider" to provider,
                        "baseURL" to baseUrl,
                        "fetchedAt" to validationFetchedAt,
                        "validationId" to validationId,
                        "models" to modelJSON,
                    ),
                )
            } catch (error: Exception) {
                val safeMessage = error.message
                    ?.takeIf { it.startsWith("生图模型目录") }
                    ?: "生图模型目录请求失败，请检查网络和 provider 配置。"
                reject(requestId, safeMessage)
            } finally {
                connection?.disconnect()
            }
        }
        throw EarlyResolve()
    }

    private fun commitImageModelValidationBatch(payload: JSONObject): Map<String, Any> {
        val modelID = safeJobMetadataIdentifier(payload.optString("modelID"), "imageModelID")
        val baseURL = normalizedSafeImageCatalogBaseURL(payload.optString("baseURL"))
        val provider = safeImageProviderIdentifier(payload.optString("provider"))
        val fetchedAt = payload.optLong("fetchedAt", 0L)
        val capabilities = NativeImageModelCapabilities(
            available = requiredBridgeBoolean(payload, "available"),
            supportsGenerations = requiredBridgeBoolean(payload, "supportsGenerations"),
            supportsEdits = requiredBridgeBoolean(payload, "supportsEdits"),
            supportsTransparency = requiredBridgeBoolean(payload, "supportsTransparency"),
        )
        val targetArray = payload.optJSONArray("targets")
            ?: throw IllegalArgumentException("统一生图模型验证缺少目标槽位。")
        val targets = mutableListOf<Triple<String, Int, String>>()
        for (index in 0 until targetArray.length()) {
            val target = targetArray.optJSONObject(index)
                ?: throw IllegalArgumentException("统一生图模型目标槽位无效。")
            targets += Triple(
                safeJobMetadataIdentifier(target.optString("profileId"), "profileId"),
                target.optInt("slotNumber", 0),
                safeJobMetadataIdentifier(target.optString("validationId"), "catalogValidationId"),
            )
        }
        val validationId = AndroidImageModelValidationRegistry.issueBatchProof(
            context = context,
            modelID = modelID,
            baseURL = baseURL,
            provider = provider,
            fetchedAt = fetchedAt,
            capabilities = capabilities,
            targets = targets,
        )
        return mapOf("validationId" to validationId)
    }

    private fun requiredBridgeBoolean(payload: JSONObject, field: String): Boolean {
        return payload.opt(field) as? Boolean
            ?: throw IllegalArgumentException("统一生图模型的 $field 能力无效。")
    }

    private fun invalidateImageModelValidationProfiles(
        profileIds: JSONArray,
        batchesOnly: Boolean = false,
    ) {
        val normalized = linkedSetOf<String>()
        for (index in 0 until profileIds.length()) {
            val raw = profileIds.opt(index) as? String
                ?: throw IllegalArgumentException("需要撤销模型验证的 Profile 无效。")
            val profileId = safeJobMetadataIdentifier(raw, "profileId")
            if (profileId.isBlank()) throw IllegalArgumentException("需要撤销模型验证的 Profile 无效。")
            normalized += profileId
        }
        if (normalized.isNotEmpty()) {
            if (batchesOnly) {
                AndroidImageModelValidationRegistry.invalidateBatchProofs(context, normalized)
            } else {
                AndroidImageModelValidationRegistry.invalidateProfiles(context, normalized)
            }
        }
    }

    private fun openHttpConnection(url: String, proxyMode: String, proxyUrl: String): HttpURLConnection {
        System.setProperty("java.net.preferIPv4Stack", "true")
        System.setProperty("java.net.preferIPv6Addresses", "false")
        val target = URL(url)
        val connection = when (normalizeProxyMode(proxyMode)) {
            "none" -> target.openConnection(Proxy.NO_PROXY)
            "custom" -> target.openConnection(parseCustomProxy(proxyUrl))
            else -> target.openConnection()
        }
        return connection as HttpURLConnection
    }

    private fun connectTimeoutForUrl(url: String, fallback: Int): Int {
        return if (isOfficialAPIMartURL(url)) minOf(fallback, 8_000) else fallback
    }

    private fun isOfficialAPIMartURL(url: String): Boolean {
        return try {
            URI(url).host?.equals(apimartOfficialHost, ignoreCase = true) == true
        } catch (_: Exception) {
            false
        }
    }

    private fun apimartProbeBaseUrlCandidates(baseUrl: String, apiMode: String): List<String> {
        if (apiMode != "apimart") return listOf(baseUrl)
        val comparable = baseUrl.trim().trimEnd('/').removeSuffix("/v1")
        if (!isOfficialAPIMartURL(comparable)) return listOf(comparable)
        return listOf(apimartOfficialBaseUrl, apimartLegacyBaseUrl)
    }

    private fun isAPIMartNetworkFallbackError(error: Exception): Boolean {
        val type = error.javaClass.simpleName.lowercase(Locale.US)
        val message = (error.message ?: "").lowercase(Locale.US)
        return type.contains("sockettimeoutexception")
            || type.contains("connectexception")
            || type.contains("unknownhostexception")
            || message.contains("failed to connect")
            || message.contains("connect timed out")
            || message.contains("network is unreachable")
            || message.contains("no route to host")
    }

    private fun normalizeProxyMode(raw: String): String {
        return when (raw.trim().lowercase(Locale.US)) {
            "none" -> "none"
            "custom" -> "custom"
            else -> "system"
        }
    }

    private fun parseCustomProxy(raw: String): Proxy {
        val cleaned = raw.trim()
        if (cleaned.isBlank()) throw IllegalArgumentException("自定义代理地址不能为空")
        val uri = try {
            URI(cleaned)
        } catch (error: Exception) {
            throw IllegalArgumentException("代理地址无效: ${error.message ?: error.javaClass.simpleName}")
        }
        val scheme = uri.scheme?.lowercase(Locale.US) ?: ""
        if (scheme != "http" && scheme != "https") {
            throw IllegalArgumentException("代理地址仅支持 http:// 或 https://")
        }
        val host = uri.host ?: throw IllegalArgumentException("代理地址必须包含主机")
        if (!uri.rawQuery.isNullOrBlank() || !uri.rawFragment.isNullOrBlank()) {
            throw IllegalArgumentException("代理地址不能包含 query 或 fragment")
        }
        val path = uri.rawPath ?: ""
        if (path.isNotBlank() && path != "/") {
            throw IllegalArgumentException("代理地址不能包含路径")
        }
        val port = if (uri.port > 0) uri.port else if (scheme == "https") 443 else 80
        return Proxy(Proxy.Type.HTTP, InetSocketAddress.createUnresolved(host, port))
    }

    private fun cancelHttpRequest(requestKey: String) {
        httpRequests.remove(requestKey)?.disconnect()
    }

    private fun validateProbeBaseUrl(raw: String): String {
        val cleaned = raw.trim().trimEnd('/').removeSuffix("/v1")
        if (cleaned.isBlank()) throw IllegalArgumentException("未配置上游 BASE_URL")
        val uri = try {
            URI(cleaned)
        } catch (error: Exception) {
            throw IllegalArgumentException("BASE_URL 无效: ${error.message ?: error.javaClass.simpleName}")
        }
        val scheme = uri.scheme?.lowercase(Locale.US) ?: ""
        val host = uri.host ?: ""
        if (scheme.isBlank() || host.isBlank()) {
            throw IllegalArgumentException("BASE_URL 必须包含协议和主机,例如 https://example.com")
        }
        if (scheme == "https") return cleaned
        if (scheme == "http" && isProbeLoopbackHost(host)) return cleaned
        if (scheme == "http") {
            throw IllegalArgumentException("拒绝使用非 TLS 上游: $cleaned。只有 localhost / 127.0.0.1 / ::1 允许 http://")
        }
        throw IllegalArgumentException("BASE_URL 仅支持 http:// 或 https://")
    }

    private fun isProbeLoopbackHost(host: String): Boolean {
        val lower = host.lowercase(Locale.US).trim('[', ']')
        return lower == "localhost" || lower.endsWith(".localhost") || lower == "127.0.0.1" || lower == "::1" || lower == "0:0:0:0:0:0:0:1"
    }

    private fun summarizeProbeBody(body: String): String {
        val trimmed = body.trim()
        if (trimmed.isBlank()) return ""
        return try {
            val parsed = JSONObject(trimmed)
            val message = parsed.optJSONObject("error")?.optString("message")?.trim().orEmpty()
            val fallback = parsed.optString("message").trim()
            (message.ifBlank { fallback }).ifBlank { trimmed }.take(160)
        } catch (_: Exception) {
            trimmed.take(160)
        }
    }

    fun onOpenImageDialogResult(uri: Uri?) {
        val requestId = pendingOpenImageRequestId ?: return
        pendingOpenImageRequestId = null
        if (uri == null) {
            resolve(requestId, mapOf("path" to "", "size" to 0, "imageB64" to ""))
            return
        }
        try {
            val suggestedName = queryDisplayName(uri) ?: "import-${timestamp()}.png"
            val copied = copyUriToImports(uri, suggestedName)
            val previewUrl = androidPreviewDataUrl(copied.previewMimeType, copied.previewB64)
            resolve(
                requestId,
                mapOf(
                    "path" to copied.file.absolutePath,
                    "size" to copied.size,
                    "imageB64" to copied.imageB64,
                    "previewUrl" to previewUrl,
                    "previewB64" to copied.previewB64,
                ),
            )
        } catch (error: Exception) {
            reject(requestId, error.message ?: error.javaClass.simpleName)
        }
    }

    fun onImportHistoryResult(uri: Uri?) {
        val requestId = pendingImportHistoryRequestId ?: return
        pendingImportHistoryRequestId = null
        if (uri == null) {
            resolve(requestId, "")
            return
        }
        try {
            val text = context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() } ?: ""
            resolve(requestId, text)
        } catch (error: Exception) {
            reject(requestId, error.message ?: error.javaClass.simpleName)
        }
    }

    private fun defaultOutputDir(): File {
        val pictures = context.getExternalFilesDir(Environment.DIRECTORY_PICTURES)
        return File(pictures ?: context.filesDir, "ImageStudio")
    }

    private fun importsDir(): File {
        return File(context.filesDir, "imports").apply { mkdirs() }
    }

    private fun shareDir(): File {
        return File(context.cacheDir, "share").apply { mkdirs() }
    }

    private fun sanitizeFileName(name: String, fallback: String): String {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) return fallback
        return trimmed.replace(Regex("[^A-Za-z0-9._\\-\\u4E00-\\u9FFF]+"), "-")
    }

    private fun ensureImageFileName(name: String, fallback: String): String {
        val safe = sanitizeFileName(name, fallback)
        return if (Regex("\\.(png|jpe?g|webp)$", RegexOption.IGNORE_CASE).containsMatchIn(safe)) {
            safe
        } else {
            "$safe.png"
        }
    }

    private fun imageMimeForName(name: String): String {
        val lower = name.lowercase(Locale.US)
        return when {
            lower.endsWith(".jpg") || lower.endsWith(".jpeg") -> "image/jpeg"
            lower.endsWith(".webp") -> "image/webp"
            else -> "image/png"
        }
    }

    private fun queryDisplayName(uri: Uri): String? {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (index >= 0 && cursor.moveToFirst()) {
                val name = cursor.getString(index)
                if (!name.isNullOrBlank()) return name
            }
        }
        return null
    }

    private data class CopiedImport(
        val file: File,
        val size: Long,
        val imageB64: String,
        val previewB64: String,
        val previewMimeType: String,
    )

    private data class PreviewData(
        val base64: String,
        val mimeType: String,
    )

    private fun copyUriToImports(uri: Uri, suggestedName: String): CopiedImport {
        val name = sanitizeFileName(suggestedName, "import-${timestamp()}.png")
        val target = uniqueTargetFile(importsDir(), "${timestamp()}-$name")
        var total = 0L
        val preview = java.io.ByteArrayOutputStream()
        context.contentResolver.openInputStream(uri)?.use { input ->
            FileOutputStream(target).use { output ->
                val buffer = ByteArray(8192)
                while (true) {
                    val read = input.read(buffer)
                    if (read <= 0) break
                    output.write(buffer, 0, read)
                    total += read
                    if (total <= maxDialogReadBytes) {
                        preview.write(buffer, 0, read)
                    }
                }
            }
        } ?: throw IllegalStateException("无法读取所选文件")
        val imageB64 = if (total in 1..maxDialogReadBytes) {
            Base64.encodeToString(preview.toByteArray(), Base64.NO_WRAP)
        } else {
            ""
        }
        val file = target
        val previewData = createPreviewData(file, maxDialogPreviewEdge, dialogPreviewJpegQuality)
            ?: createPreviewB64(file, maxDialogPreviewEdge, dialogPreviewJpegQuality)
                .takeIf { it.isNotBlank() }
                ?.let { PreviewData(it, if (file.extension.equals("png", ignoreCase = true)) "image/png" else "image/jpeg") }
        return CopiedImport(
            target,
            total,
            imageB64,
            previewData?.base64.orEmpty(),
            previewData?.mimeType.orEmpty(),
        )
    }

    // Keep the small preview helpers as named contract points for the picker tests;
    // the MIME-aware implementation lives in createPreviewData below.
    private fun createPreviewB64(file: File): String {
        return createPreviewData(file, maxDialogPreviewEdge, dialogPreviewJpegQuality)?.base64.orEmpty()
    }

    private fun createPreviewB64(file: File, maxEdgeLimit: Int): String {
        return createPreviewData(file, maxEdgeLimit, defaultPreviewJpegQuality)?.base64.orEmpty()
    }

    private fun createPreviewB64(file: File, maxEdgeLimit: Int, jpegQuality: Int): String {
        return createPreviewData(file, maxEdgeLimit, jpegQuality)?.base64.orEmpty()
    }

    private fun createPreviewData(file: File, maxEdgeLimit: Int, jpegQuality: Int): PreviewData? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        val maxEdge = max(bounds.outWidth, bounds.outHeight)
        var sample = 1
        while (maxEdge / sample > maxEdgeLimit * 2) sample *= 2
        val decode = BitmapFactory.Options().apply { inSampleSize = sample }
        val decoded = BitmapFactory.decodeFile(file.absolutePath, decode) ?: return null
        val preserveAlpha = decoded.hasAlpha()
        val scaled = try {
            val scale = minOf(1f, maxEdgeLimit.toFloat() / max(decoded.width, decoded.height).toFloat())
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
        return try {
            if (scaled !== decoded) scaled.setHasAlpha(preserveAlpha)
            val encoded = encodeAndroidPreview(scaled, jpegQuality)
            PreviewData(
                base64 = Base64.encodeToString(encoded.bytes, Base64.NO_WRAP),
                mimeType = encoded.mimeType,
            )
        } finally {
            if (scaled != decoded) scaled.recycle()
            decoded.recycle()
        }
    }

    private fun createPreviewRef(file: File, maxEdgeLimit: Int): Map<String, Any> {
        val preview = createPreviewData(file, maxEdgeLimit, defaultPreviewJpegQuality) ?: return emptyMap()
        if (preview.base64.isBlank()) return emptyMap()
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        val bytes = Base64.decode(preview.base64, Base64.DEFAULT)
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val out = mutableMapOf<String, Any>(
            "previewUrl" to androidPreviewDataUrl(preview.mimeType, preview.base64),
        )
        if (bounds.outWidth > 0 && bounds.outHeight > 0) {
            out["previewWidth"] = bounds.outWidth
            out["previewHeight"] = bounds.outHeight
        }
        return out
    }

    private fun writeImportedBytes(bytes: ByteArray, suggestedName: String): File {
        val safeName = sanitizeFileName(suggestedName, "import-${timestamp()}.png")
        val file = uniqueTargetFile(importsDir(), "${timestamp()}-$safeName")
        file.writeBytes(bytes)
        return file
    }

    private fun openInputStreamForPath(path: String): InputStream {
        val trimmed = path.trim()
        if (trimmed.startsWith("content://")) {
            return context.contentResolver.openInputStream(Uri.parse(trimmed))
                ?: throw IllegalArgumentException("无法读取内容 URI: $trimmed")
        }
        return FileInputStream(File(trimmed))
    }

    private fun uriAndMimeForPath(path: String): Pair<Uri, String> {
        val trimmed = path.trim()
        val mime = when {
            trimmed.endsWith(".png", true) -> "image/png"
            trimmed.endsWith(".jpg", true) || trimmed.endsWith(".jpeg", true) -> "image/jpeg"
            trimmed.endsWith(".webp", true) -> "image/webp"
            trimmed.endsWith(".json", true) -> "application/json"
            trimmed.endsWith(".txt", true) -> "text/plain"
            else -> "*/*"
        }
        if (trimmed.startsWith("content://")) {
            return Uri.parse(trimmed) to mime
        }
        return fileProviderUri(File(trimmed)) to mime
    }

    private fun fileProviderUri(file: File): Uri {
        return FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    }

    private fun shareImageUri(uri: Uri, mimeType: String, title: String) {
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = mimeType
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_TITLE, title)
            clipData = ClipData.newUri(context.contentResolver, title, uri)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val chooser = Intent.createChooser(intent, "分享图片").apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(chooser)
    }

    private fun timestamp(): String = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())

    private fun resolve(requestId: String, payload: Any?) {
        val serialized = when (payload) {
            null -> "null"
            is String -> JSONObject.quote(payload)
            is Number, is Boolean -> payload.toString()
            else -> JSONObject.wrap(payload)?.toString() ?: "null"
        }
        webView.post {
            webView.evaluateJavascript("window.__imageStudioNativeResolve(${JSONObject.quote(requestId)}, $serialized)", null)
        }
    }

    private fun reject(requestId: String, message: String) {
        webView.post {
            webView.evaluateJavascript(
                "window.__imageStudioNativeReject(${JSONObject.quote(requestId)}, ${JSONObject.quote(message)})",
                null,
            )
        }
    }

    private fun emitNativeProgress(requestId: String, payload: Any?) {
        val serialized = when (payload) {
            null -> "null"
            is String -> JSONObject.quote(payload)
            is Number, is Boolean -> payload.toString()
            else -> JSONObject.wrap(payload)?.toString() ?: "null"
        }
        webView.post {
            webView.evaluateJavascript(
                "if (typeof window.__imageStudioNativeProgress === 'function') { window.__imageStudioNativeProgress(${JSONObject.quote(requestId)}, $serialized); }",
                null,
            )
        }
    }

    private fun emitAndroidJobEvent(payload: JSONObject) {
        val serialized = payload.toString()
        webView.post {
            webView.evaluateJavascript(
                "if (typeof window.__imageStudioAndroidJobEvent === 'function') { window.__imageStudioAndroidJobEvent($serialized); }",
                null,
            )
        }
    }

    private val removeAndroidJobListener = AndroidJobEventBus.addListener { event ->
        emitAndroidJobEvent(event)
    }

    fun dispose() {
        removeAndroidJobListener()
    }

    private class EarlyResolve : RuntimeException()
}
