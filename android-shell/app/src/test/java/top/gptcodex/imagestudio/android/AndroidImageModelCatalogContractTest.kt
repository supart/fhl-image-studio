package top.fangtangyuan.fhlstudio.android

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidImageModelCatalogContractTest {
    @Test
    fun `dynamic gpt image 2 family ids are preserved and fuzzy alias is disabled`() {
        val models = parseFHLImageModelCatalog(
            JSONArray()
                .put(JSONObject().put("id", "gpt-image-2"))
                .put(JSONObject().put("id", "gpt-image-2.5-flare"))
                .put(JSONObject().put("id", "gpt-image-2.6-sunburst"))
                .put(JSONObject().put("id", "gpt-image-2.7-future.v1"))
                .put(JSONObject().put("id", "gpt-image-2.5")),
        )

        assertEquals(
            listOf("gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.6-sunburst", "gpt-image-2.7-future.v1", "gpt-image-2.5"),
            models.map { it.id },
        )
        assertFalse(models.first { it.id == "gpt-image-2" }.supportsTransparency)
        assertTrue(models.first { it.id == "gpt-image-2.6-sunburst" }.supportsTransparency)
        val fuzzy = models.first { it.id == "gpt-image-2.5" }
        assertFalse(fuzzy.available)
        assertEquals("不可调用的模糊模型别名", fuzzy.disabledReason)
    }

    @Test
    fun `provider capability false is retained and duplicate ids merge conservatively`() {
        val models = parseFHLImageModelCatalog(
            JSONArray()
                .put(
                    JSONObject()
                        .put("id", "gpt-image-2.6")
                        .put("supportsTransparency", true),
                )
                .put(
                    JSONObject()
                        .put("id", "GPT-IMAGE-2.6")
                        .put("supportsGenerations", false)
                        .put("supportsTransparency", false),
                ),
        )
        assertEquals(1, models.size)
        val model = models.single()
        assertFalse(model.available)
        assertFalse(model.supportsGenerations)
        assertFalse(model.supportsTransparency)
    }

    @Test
    fun `invalid and non image models are filtered while explicit image diagnostic remains`() {
        val longId = "gpt-image-2.6-" + "x".repeat(140)
        val models = parseFHLImageModelCatalog(
            JSONArray()
                .put(JSONObject().put("id", "text-embedding-3-large"))
                .put(JSONObject().put("id", "audio-preview"))
                .put(JSONObject().put("id", "gpt-image-20"))
                .put(JSONObject().put("id", "gpt-image-2.6-\u0001"))
                .put(JSONObject().put("id", "gpt-image-2.6-\u0085"))
                .put(JSONObject().put("id", longId))
                .put(
                    JSONObject()
                        .put("id", "text-image-encoder")
                        .put("type", "embedding")
                        .put("input_modalities", JSONArray().put("image"))
                        .put("imageCapable", true),
                )
                .put(
                    JSONObject()
                        .put("id", "vendor-image-model")
                        .put("endpoints", JSONArray().put("images/generations")),
                )
                .put(
                    JSONObject()
                        .put("id", "audio-image-mix")
                        .put("endpoints", JSONArray().put("images/generations")),
                ),
        )
        assertTrue(models.none { it.id == "text-embedding-3-large" })
        assertTrue(models.none { it.id == "audio-preview" })
        assertTrue(models.none { it.id == "gpt-image-20" })
        assertTrue(models.none { it.id == "text-image-encoder" })
        assertTrue(models.none { it.id == "audio-image-mix" })
        val diagnostic = models.first { it.id == "vendor-image-model" }
        assertFalse(diagnostic.available)
        assertEquals("当前 Android 实现暂不支持", diagnostic.disabledReason)
        assertNull(models.find { it.id.contains('\u0001') || it.id.contains('\u0085') })
    }

    @Test
    fun `gpt image family stays visible but disabled for contradictory metadata`() {
        val models = parseFHLImageModelCatalog(
            JSONArray()
                .put(JSONObject().put("id", "gpt-image-2.6-text").put("type", "chat"))
                .put(
                    JSONObject()
                        .put("id", "gpt-image-2.7-input")
                        .put("input_modalities", JSONArray().put("image"))
                        .put("imageCapable", true),
                )
                .put(
                    JSONObject()
                        .put("id", "gpt-image-2.8-explicit")
                        .put("type", "chat")
                        .put("endpoints", JSONArray().put("images/generations")),
                ),
        )
        for (id in listOf("gpt-image-2.6-text", "gpt-image-2.7-input")) {
            val model = models.first { it.id == id }
            assertFalse(model.imageCapable)
            assertFalse(model.supportsGenerations)
            assertFalse(model.available)
        }
        assertTrue(models.first { it.id == "gpt-image-2.8-explicit" }.available)
    }
}
