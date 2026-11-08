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
                .put("outputFormat", "webp")
                .put("imageBackgroundMode", "transparent")
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
            assertTrue(body.contains("name=\"background\""))
            assertTrue(body.contains("name=\"output_format\"\r\n\r\npng"))
            assertEquals(1, body.split(transparentImagePromptInstruction).size - 1)
            assertTrue(contentType.startsWith("multipart/form-data; boundary="))
        } finally {
            first.delete()
            second.delete()
        }
    }

    @Test
    fun generationRequestUsesTransparentFieldsOnlyInTransparentMode() {
        val method: Method = AndroidJobManager::class.java
            .getDeclaredMethod("buildImagesRequestBody", Context::class.java, JSONObject::class.java)
            .apply { isAccessible = true }

        val transparentPayload = JSONObject()
            .put("baseURL", "https://www.fhl.mom")
            .put("mode", "generate")
            .put("imageModelID", "gpt-image-2.5-flare")
            .put("prompt", "a glass orb")
            .put("outputFormat", "jpeg")
            .put("imageBackgroundMode", "transparent")
        val transparentRequest = method.invoke(AndroidJobManager, context, transparentPayload)
        val transparentBody = JSONObject(
            String(
                transparentRequest.javaClass.getDeclaredField("bodyBytes").apply { isAccessible = true }
                    .get(transparentRequest) as ByteArray,
                Charsets.UTF_8,
            ),
        )
        assertEquals("transparent", transparentBody.optString("background"))
        assertEquals("png", transparentBody.optString("output_format"))
        assertEquals(1, transparentBody.optString("prompt").split(transparentImagePromptInstruction).size - 1)

        val standardPayload = JSONObject(transparentPayload.toString()).put("imageBackgroundMode", "standard")
        val standardRequest = method.invoke(AndroidJobManager, context, standardPayload)
        val standardBody = JSONObject(
            String(
                standardRequest.javaClass.getDeclaredField("bodyBytes").apply { isAccessible = true }
                    .get(standardRequest) as ByteArray,
                Charsets.UTF_8,
            ),
        )
        assertFalse(standardBody.has("background"))
        assertEquals("jpeg", standardBody.optString("output_format"))
        assertFalse(standardBody.optString("prompt").contains(transparentImagePromptInstruction))
    }

    @Test
    fun responsesToolUsesTransparentFieldsOnlyInTransparentMode() {
        val method: Method = AndroidJobManager::class.java
            .getDeclaredMethod("buildResponsesPayload", Context::class.java, JSONObject::class.java)
            .apply { isAccessible = true }
        val transparentPayload = JSONObject()
            .put("apiMode", "responses")
            .put("baseURL", "https://www.fhl.mom")
            .put("imageModelID", "gpt-image-2.5-sunburst")
            .put("textModelID", "gpt-5.5")
            .put("prompt", "a carved pendant")
            .put("size", "auto")
            .put("outputFormat", "webp")
            .put("imageBackgroundMode", "transparent")

        val transparentBody = method.invoke(AndroidJobManager, context, transparentPayload) as JSONObject
        val transparentTool = transparentBody.getJSONArray("tools").getJSONObject(0)
        val transparentPrompt = transparentBody.getJSONArray("input").getJSONObject(0)
            .getJSONArray("content").getJSONObject(0).getString("text")
        assertEquals("transparent", transparentTool.optString("background"))
        assertEquals("png", transparentTool.optString("output_format"))
        assertEquals(1, transparentPrompt.split(transparentImagePromptInstruction).size - 1)

        val standardPayload = JSONObject(transparentPayload.toString()).put("imageBackgroundMode", "standard")
        val standardBody = method.invoke(AndroidJobManager, context, standardPayload) as JSONObject
        val standardTool = standardBody.getJSONArray("tools").getJSONObject(0)
        val standardPrompt = standardBody.getJSONArray("input").getJSONObject(0)
            .getJSONArray("content").getJSONObject(0).getString("text")
        assertFalse(standardTool.has("background"))
        assertEquals("webp", standardTool.optString("output_format"))
        assertFalse(standardPrompt.contains(transparentImagePromptInstruction))
    }

    @Test
    fun providerSpecificPromptPathDoesNotAddTransparentInstruction() {
        val method: Method = AndroidJobManager::class.java
            .getDeclaredMethod("promptWithBatchVariation", JSONObject::class.java)
            .apply { isAccessible = true }
        val payload = JSONObject()
            .put("prompt", "provider-owned prompt")
            .put("imageBackgroundMode", "transparent")

        assertEquals("provider-owned prompt", method.invoke(AndroidJobManager, payload))
    }
}
