package top.fangtangyuan.fhlstudio.android

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
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
}
