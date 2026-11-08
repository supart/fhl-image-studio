package top.fangtangyuan.fhlstudio.android

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.io.File

@RunWith(AndroidJUnit4::class)
class AndroidTransparentPngInstrumentedTest {
    @Test
    fun finalPngValidatorRequiresRealAlphaAndVisiblePixels() {
        val valid = rgbaPng(Color.argb(128, 255, 32, 32))
        assertNull(validateTransparentPngBytes(valid))
        assertNotNull(validateTransparentPngBytes(opaquePng()))
        assertNotNull(validateTransparentPngBytes(allTransparentPng()))
        assertNotNull(validateTransparentPngBytes(checkerboardRgbPng()))
        assertNotNull(validateTransparentPngBytes(valid.copyOf(valid.size - 8)))
        assertNotNull(validateTransparentPngBytes(byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47)))
    }

    @Test
    fun transparentPreviewEncodingPreservesAlphaAndUsesPng() {
        val bitmap = Bitmap.createBitmap(4, 4, Bitmap.Config.ARGB_8888)
        try {
            bitmap.eraseColor(Color.TRANSPARENT)
            bitmap.setPixel(1, 1, Color.argb(128, 255, 32, 32))

            val encoded = encodeAndroidPreview(bitmap, 78)
            assertEquals("image/png", encoded.mimeType)
            assertEquals("png", encoded.fileExtension)

            val decoded = BitmapFactory.decodeByteArray(encoded.bytes, 0, encoded.bytes.size)
            assertNotNull(decoded)
            try {
                assertTrue(Color.alpha(decoded.getPixel(0, 0)) < 255)
                assertEquals(128, Color.alpha(decoded.getPixel(1, 1)))
            } finally {
                decoded.recycle()
            }
        } finally {
            bitmap.recycle()
        }
    }

    @Test
    fun opaquePreviewEncodingKeepsCompactJpegPath() {
        val bitmap = Bitmap.createBitmap(4, 4, Bitmap.Config.ARGB_8888)
        try {
            bitmap.eraseColor(Color.WHITE)
            bitmap.setHasAlpha(false)

            val encoded = encodeAndroidPreview(bitmap, 78)
            assertEquals("image/jpeg", encoded.mimeType)
            assertEquals("jpg", encoded.fileExtension)
        } finally {
            bitmap.recycle()
        }
    }

    @Test
    fun jobPreviewFileKeepsTransparentPngAndOpaqueJpeg() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val fixtureDir = File(context.cacheDir, "transparent-preview-test").apply { mkdirs() }
        val transparentSource = File(fixtureDir, "transparent-source.png")
        val opaqueSource = File(fixtureDir, "opaque-source.jpg")
        val transparentBitmap = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
        val opaqueBitmap = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
        try {
            transparentBitmap.eraseColor(Color.TRANSPARENT)
            transparentBitmap.setPixel(3, 3, Color.argb(128, 255, 32, 32))
            transparentSource.writeBytes(compress(transparentBitmap))

            opaqueBitmap.eraseColor(Color.WHITE)
            opaqueBitmap.setHasAlpha(false)
            ByteArrayOutputStream().use { output ->
                check(opaqueBitmap.compress(Bitmap.CompressFormat.JPEG, 90, output))
                opaqueSource.writeBytes(output.toByteArray())
            }

            val method = AndroidJobManager::class.java.getDeclaredMethod(
                "createPreviewFile",
                android.content.Context::class.java,
                String::class.java,
            ).apply { isAccessible = true }
            val transparentPreview = method.invoke(AndroidJobManager, context, transparentSource.absolutePath)
            val opaquePreview = method.invoke(AndroidJobManager, context, opaqueSource.absolutePath)
            assertNotNull(transparentPreview)
            assertNotNull(opaquePreview)

            val transparentPath = previewPath(transparentPreview)
            val opaquePath = previewPath(opaquePreview)
            assertTrue(transparentPath.endsWith(".png"))
            assertTrue(opaquePath.endsWith(".jpg"))

            val decoded = BitmapFactory.decodeFile(transparentPath)
            assertNotNull(decoded)
            try {
                assertTrue(Color.alpha(decoded.getPixel(0, 0)) < 255)
                assertEquals(128, Color.alpha(decoded.getPixel(3, 3)))
            } finally {
                decoded.recycle()
            }
        } finally {
            transparentBitmap.recycle()
            opaqueBitmap.recycle()
            fixtureDir.listFiles()?.forEach { it.delete() }
            fixtureDir.delete()
        }
    }

    private fun previewPath(preview: Any?): String {
        requireNotNull(preview)
        return preview.javaClass.getDeclaredField("path").apply { isAccessible = true }.get(preview) as String
    }

    private fun rgbaPng(pixel: Int): ByteArray {
        val bitmap = Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888)
        return try {
            bitmap.eraseColor(pixel)
            bitmap.setPixel(1, 1, Color.argb(255, 16, 200, 64))
            compress(bitmap)
        } finally {
            bitmap.recycle()
        }
    }

    private fun opaquePng(): ByteArray {
        val bitmap = Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888)
        return try {
            bitmap.eraseColor(Color.rgb(255, 255, 255))
            compress(bitmap)
        } finally {
            bitmap.recycle()
        }
    }

    private fun allTransparentPng(): ByteArray {
        val bitmap = Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888)
        return try {
            bitmap.eraseColor(Color.TRANSPARENT)
            compress(bitmap)
        } finally {
            bitmap.recycle()
        }
    }

    private fun checkerboardRgbPng(): ByteArray {
        val bitmap = Bitmap.createBitmap(2, 2, Bitmap.Config.RGB_565)
        return try {
            bitmap.setPixel(0, 0, Color.WHITE)
            bitmap.setPixel(1, 0, Color.BLACK)
            bitmap.setPixel(0, 1, Color.BLACK)
            bitmap.setPixel(1, 1, Color.WHITE)
            compress(bitmap)
        } finally {
            bitmap.recycle()
        }
    }

    private fun compress(bitmap: Bitmap): ByteArray {
        val output = ByteArrayOutputStream()
        check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output))
        return output.toByteArray()
    }
}
