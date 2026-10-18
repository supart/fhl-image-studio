package top.fangtangyuan.fhlstudio.android

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.lang.reflect.Method
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidImagesMultipartInstrumentedTest {
    private val context: Context
        get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Test
    fun editRequestRepeatsImageFieldForEverySource() {
        val first = File(context.cacheDir, "multipart-source-a.png")
        val second = File(context.cacheDir, "multipart-source-b.png")
        first.writeBytes(byteArrayOf(1, 2, 3))
        second.writeBytes(byteArrayOf(4, 5, 6))
        try {
            val payload = JSONObject()
                .put("baseURL", "https://www.fhl.mom")
                .put("mode", "edit")
                .put("imageModelID", "gpt-image-2")
                .put("size", "1536x1152")
                .put("quality", "auto")
                .put("outputFormat", "png")
                .put("requestPolicy", "openai")
                .put("imagesNewAPICompat", true)
                .put("sourceImagePaths", JSONArray().put(first.absolutePath).put(second.absolutePath))

            val method: Method = AndroidJobManager::class.java
                .getDeclaredMethod("buildImagesRequestBody", Context::class.java, JSONObject::class.java)
                .apply { isAccessible = true }
            val requestBody = method.invoke(AndroidJobManager, context, payload)
            val bodyField = requestBody.javaClass.getDeclaredField("bodyBytes").apply { isAccessible = true }
            val contentTypeField = requestBody.javaClass.getDeclaredField("contentType").apply { isAccessible = true }
            val body = String(bodyField.get(requestBody) as ByteArray, Charsets.UTF_8)
            val contentType = contentTypeField.get(requestBody) as String

            assertEquals(2, Regex("name=\"image\"").findAll(body).count())
            assertFalse(body.contains("name=\"image[]\""))
            assertTrue(body.indexOf("source-1.png") < body.indexOf("source-2.png"))
            assertTrue(contentType.startsWith("multipart/form-data; boundary="))
        } finally {
            first.delete()
            second.delete()
        }
    }
}
