package top.fangtangyuan.fhlstudio.android

import javax.crypto.spec.SecretKeySpec
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class AndroidCredentialCipherContractTest {
    private val key = SecretKeySpec(ByteArray(32) { index -> index.toByte() }, "AES")

    @Test
    fun roundTripUsesVersionedEnvelopeAndDoesNotExposePlaintext() {
        val plaintext = "contract-test-credential"
        val encoded = AndroidCredentialCipher.encrypt(key, "profile:test", plaintext)

        assertFalse(encoded.contains(plaintext))
        assertEquals(3, encoded.split('.').size)
        assertEquals("v1", encoded.substringBefore('.'))
        assertEquals(plaintext, AndroidCredentialCipher.decrypt(key, "profile:test", encoded))
    }

    @Test
    fun ciphertextIsBoundToItsUserAad() {
        val encoded = AndroidCredentialCipher.encrypt(key, "profile:a", "contract-test-credential")

        assertThrows(Exception::class.java) {
            AndroidCredentialCipher.decrypt(key, "profile:b", encoded)
        }
    }

    @Test
    fun envelopeCodecPreservesTwelveByteIvAndCiphertext() {
        val iv = ByteArray(12) { index -> (index + 1).toByte() }
        val ciphertext = byteArrayOf(7, 8, 9, 10)

        val decoded = AndroidCredentialCipher.decodeEnvelope(
            AndroidCredentialCipher.encodeEnvelope(AndroidCredentialEnvelope(iv, ciphertext)),
        )

        assertArrayEquals(iv, decoded.iv)
        assertArrayEquals(ciphertext, decoded.ciphertext)
    }

    @Test
    fun malformedOrUnsupportedEnvelopeIsRejected() {
        assertThrows(IllegalArgumentException::class.java) {
            AndroidCredentialCipher.decodeEnvelope("v2.invalid.invalid")
        }
        assertThrows(IllegalArgumentException::class.java) {
            AndroidCredentialCipher.decodeEnvelope("v1.c2hvcnQ.Y2lwaGVy")
        }
        assertThrows(IllegalArgumentException::class.java) {
            AndroidCredentialCipher.decodeEnvelope("v1.invalid")
        }
    }
}
