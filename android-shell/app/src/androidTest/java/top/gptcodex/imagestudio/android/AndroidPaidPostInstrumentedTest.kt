package top.fangtangyuan.fhlstudio.android

import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.lang.reflect.InvocationTargetException
import java.net.ServerSocket
import java.net.SocketTimeoutException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidPaidPostInstrumentedTest {
    @Test
    fun fixedLengthPostIsNotReplayedAfterServerDropsTheAcceptedRequest() {
        val acceptedRequests = AtomicInteger(0)
        val serverFailure = AtomicReference<Throwable?>(null)
        val serverFinished = CountDownLatch(1)
        val server = ServerSocket(0).apply { soTimeout = 2_000 }
        val body = "{\"request\":\"single-attempt\"}".toByteArray(Charsets.UTF_8)
        val serverThread = thread(name = "single-attempt-http-server") {
            try {
                server.accept().use { socket ->
                    acceptedRequests.incrementAndGet()
                    socket.soTimeout = 2_000
                    val input = BufferedInputStream(socket.getInputStream())
                    var contentLength = 0
                    while (true) {
                        val line = readHttpLine(input)
                        if (line.isEmpty()) break
                        if (line.startsWith("Content-Length:", ignoreCase = true)) {
                            contentLength = line.substringAfter(':').trim().toInt()
                        }
                    }
                    var remaining = contentLength
                    while (remaining > 0) {
                        val read = input.read(ByteArray(minOf(remaining, 1_024)))
                        if (read < 0) break
                        remaining -= read
                    }
                    assertEquals(body.size, contentLength)
                    assertEquals(0, remaining)
                    // Close after accepting the full body and before any response bytes.
                }
                try {
                    server.accept().use { acceptedRequests.incrementAndGet() }
                } catch (_: SocketTimeoutException) {
                    // Expected: fixed-length streaming prevents a transparent second POST.
                }
            } catch (error: Throwable) {
                serverFailure.set(error)
            } finally {
                server.close()
                serverFinished.countDown()
            }
        }

        val method = AndroidJobManager::class.java.declaredMethods.single {
            it.name == "httpRequestText" && it.parameterCount == 8
        }.apply { isAccessible = true }
        try {
            method.invoke(
                AndroidJobManager,
                "instrumentation-post-job",
                "http://127.0.0.1:${server.localPort}/submit",
                "POST",
                mapOf("Content-Type" to "application/json"),
                body,
                JSONObject().put("proxyMode", "none").put("proxyURL", ""),
                2_000,
                2_000,
            )
            fail("Expected the deliberately closed connection to fail")
        } catch (error: InvocationTargetException) {
            assertTrue(error.cause != null)
        } finally {
            assertTrue(serverFinished.await(5, TimeUnit.SECONDS))
            server.close()
            serverThread.join(1_000)
        }
        serverFailure.get()?.let { throw AssertionError("Local fault server failed", it) }
        assertEquals(1, acceptedRequests.get())
    }

    private fun readHttpLine(input: BufferedInputStream): String {
        val bytes = ByteArrayOutputStream()
        var previous = -1
        while (true) {
            val current = input.read()
            if (current < 0) break
            if (previous == '\r'.code && current == '\n'.code) {
                val raw = bytes.toByteArray()
                return String(raw, 0, (raw.size - 1).coerceAtLeast(0), Charsets.US_ASCII)
            }
            bytes.write(current)
            previous = current
        }
        return bytes.toString(Charsets.US_ASCII.name())
    }
}
