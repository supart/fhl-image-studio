package top.fangtangyuan.fhlstudio.android

import java.nio.charset.StandardCharsets
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal data class AndroidCredentialEnvelope(
    val iv: ByteArray,
    val ciphertext: ByteArray,
)

internal object AndroidCredentialCipher {
    private const val transformation = "AES/GCM/NoPadding"
    private const val envelopeVersion = "v1"
    private const val ivSizeBytes = 12
    private const val authenticationTagBits = 128

    fun encrypt(key: SecretKey, aad: String, plaintext: String): String {
        require(aad.isNotBlank()) { "Credential AAD must not be blank" }
        val cipher = Cipher.getInstance(transformation)
        cipher.init(Cipher.ENCRYPT_MODE, key)
        cipher.updateAAD(aad.toByteArray(StandardCharsets.UTF_8))
        val ciphertext = cipher.doFinal(plaintext.toByteArray(StandardCharsets.UTF_8))
        val iv = cipher.iv ?: throw IllegalStateException("Credential cipher did not provide an IV")
        check(iv.size == ivSizeBytes) { "Credential cipher must use a 12-byte IV" }
        return encodeEnvelope(AndroidCredentialEnvelope(iv, ciphertext))
    }

    fun decrypt(key: SecretKey, aad: String, encoded: String): String {
        require(aad.isNotBlank()) { "Credential AAD must not be blank" }
        val envelope = decodeEnvelope(encoded)
        val cipher = Cipher.getInstance(transformation)
        cipher.init(
            Cipher.DECRYPT_MODE,
            key,
            GCMParameterSpec(authenticationTagBits, envelope.iv),
        )
        cipher.updateAAD(aad.toByteArray(StandardCharsets.UTF_8))
        return String(cipher.doFinal(envelope.ciphertext), StandardCharsets.UTF_8)
    }

    internal fun encodeEnvelope(envelope: AndroidCredentialEnvelope): String {
        require(envelope.iv.size == ivSizeBytes) { "Credential envelope must use a 12-byte IV" }
        require(envelope.ciphertext.isNotEmpty()) { "Credential ciphertext must not be empty" }
        val encoder = Base64.getUrlEncoder().withoutPadding()
        return listOf(
            envelopeVersion,
            encoder.encodeToString(envelope.iv),
            encoder.encodeToString(envelope.ciphertext),
        ).joinToString(".")
    }

    internal fun decodeEnvelope(encoded: String): AndroidCredentialEnvelope {
        val parts = encoded.split('.')
        require(parts.size == 3 && parts[0] == envelopeVersion) {
            "Unsupported credential envelope"
        }
        val decoder = Base64.getUrlDecoder()
        val iv = try {
            decoder.decode(parts[1])
        } catch (error: IllegalArgumentException) {
            throw IllegalArgumentException("Invalid credential IV encoding", error)
        }
        val ciphertext = try {
            decoder.decode(parts[2])
        } catch (error: IllegalArgumentException) {
            throw IllegalArgumentException("Invalid credential ciphertext encoding", error)
        }
        require(iv.size == ivSizeBytes) { "Credential envelope must use a 12-byte IV" }
        require(ciphertext.isNotEmpty()) { "Credential ciphertext must not be empty" }
        return AndroidCredentialEnvelope(iv, ciphertext)
    }
}
