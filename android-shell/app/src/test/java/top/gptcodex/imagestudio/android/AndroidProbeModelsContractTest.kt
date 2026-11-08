package top.fangtangyuan.fhlstudio.android

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidProbeModelsContractTest {
    @Test
    fun `model probe accepts strings and objects while removing invalid duplicates`() {
        val data = JSONArray()
            .put(JSONObject().put("id", "gpt-5.6-sol"))
            .put("gpt-5.6-sol")
            .put("gpt-5.5")
            .put(JSONObject().put("id", ""))
            .put(JSONObject().put("id", "bad model"))

        assertEquals(listOf("gpt-5.6-sol", "gpt-5.5"), parseProbeModelIds(data))
    }

    @Test
    fun `image model catalog keeps only exact supported ids and fixed safe metadata`() {
        val data = JSONArray()
            .put(JSONObject().put("id", "gpt-image-2"))
            .put("gpt-image-2")
            .put(JSONObject().put("id", "gpt-image-2.5"))
            .put(JSONObject().put("id", "gpt-image-2.5-flare"))
            .put(JSONObject().put("id", "gpt-image-2.5-sunburst"))
            .put(JSONObject().put("id", "gpt-image-2.5-sunburst\u0000spoof"))
            .put(JSONObject().put("id", "x".repeat(129)))

        val models = parseFHLImageModelCatalog(data)

        assertEquals(
            listOf("gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"),
            models.map { it.id },
        )
        assertFalse(models.first().supportsTransparency)
        assertTrue(models[1].supportsTransparency)
        assertTrue(models[2].supportsTransparency)
        assertTrue(models.all { it.imageCapable && it.supportsGenerations && it.supportsEdits })
        assertTrue(models.all { it.description.isNotBlank() })
    }
}
