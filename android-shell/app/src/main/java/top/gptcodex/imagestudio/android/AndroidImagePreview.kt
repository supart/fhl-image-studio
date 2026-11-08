package top.fangtangyuan.fhlstudio.android

import android.graphics.Bitmap
import java.io.ByteArrayOutputStream

internal data class AndroidEncodedPreview(
    val bytes: ByteArray,
    val mimeType: String,
    val fileExtension: String,
)

internal fun encodeAndroidPreview(bitmap: Bitmap, jpegQuality: Int): AndroidEncodedPreview {
    val preserveAlpha = bitmap.hasAlpha()
    val format = if (preserveAlpha) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG
    val output = ByteArrayOutputStream()
    check(bitmap.compress(format, jpegQuality.coerceIn(1, 100), output)) {
        "Image preview compression failed"
    }
    return AndroidEncodedPreview(
        bytes = output.toByteArray(),
        mimeType = if (preserveAlpha) "image/png" else "image/jpeg",
        fileExtension = if (preserveAlpha) "png" else "jpg",
    )
}

internal fun androidPreviewSourcePath(savedPath: String, thumbPath: String): String {
    val saved = savedPath.trim()
    val thumb = thumbPath.trim()
    val oldJpegPreviewForPng = saved.endsWith(".png", ignoreCase = true) &&
        (thumb.endsWith(".jpg", ignoreCase = true) || thumb.endsWith(".jpeg", ignoreCase = true))
    return if (oldJpegPreviewForPng) saved else thumb.ifBlank { saved }
}

internal fun androidPreviewDataUrl(mimeType: String, base64: String): String {
    if (base64.isBlank()) return ""
    val safeMimeType = if (mimeType == "image/png") "image/png" else "image/jpeg"
    return "data:$safeMimeType;base64,$base64"
}
