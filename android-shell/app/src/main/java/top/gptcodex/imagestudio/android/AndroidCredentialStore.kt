package top.fangtangyuan.fhlstudio.android

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

internal class AndroidCredentialStore(context: Context) {
    private val legacyPreferences = context.applicationContext.getSharedPreferences(
        legacyPreferencesName,
        Context.MODE_PRIVATE,
    )
    private val securePreferences = context.applicationContext.getSharedPreferences(
        securePreferencesName,
        Context.MODE_PRIVATE,
    )

    fun getProfileCredential(user: String): String = synchronized(storeLock) {
        validateUser(user)
        val alias = profileCredentialAlias(user)
        val secureValue = getCredential(alias, user)
        val legacyKey = legacyEntryName(user)
        val legacyValue = legacyPreferences.getString(legacyKey, null)
        if (securePreferences.getBoolean(authoritativeEntryName(alias), false)) {
            if (secureValue.isBlank()) throw migrationBlockedError()
            try {
                if (legacyValue != null && !legacyPreferences.edit().remove(legacyKey).commit()) {
                    throw IllegalStateException("Legacy credential removal failed")
                }
                if (!securePreferences.edit().remove(authoritativeEntryName(alias)).commit()) {
                    throw IllegalStateException("Credential write marker cleanup failed")
                }
                return@synchronized secureValue
            } catch (error: Exception) {
                throw AndroidCredentialStoreException(
                    "API 凭据安全保存未完成，请重试。",
                    error,
                )
            }
        }
        if (legacyValue.isNullOrBlank()) return@synchronized secureValue

        try {
            if (secureValue.isBlank()) {
                writeEncryptedAndVerify(alias, user, legacyValue)
            } else if (secureValue != legacyValue) {
                throw IllegalStateException("Legacy and encrypted credentials do not match")
            }
            if (!legacyPreferences.edit().remove(legacyKey).commit()) {
                legacyPreferences.edit().putString(legacyKey, legacyValue).commit()
                throw IllegalStateException("Legacy credential removal failed")
            }
            secureValue.ifBlank { legacyValue }
        } catch (error: Exception) {
            securePreferences.edit()
                .remove(secureEntryName(alias))
                .putBoolean(blockedEntryName(alias), true)
                .commit()
            throw AndroidCredentialStoreException(
                "API 凭据安全迁移失败，请重新配置该 API。",
                error,
            )
        }
    }

    fun setProfileCredential(user: String, value: String) = synchronized(storeLock) {
        validateUser(user)
        val alias = profileCredentialAlias(user)
        val normalized = value.trim()
        if (normalized.isBlank()) {
            deleteProfileCredential(user)
            return@synchronized
        }

        setCredential(alias, user, normalized, authoritative = true)
        val legacyKey = legacyEntryName(user)
        val oldLegacyValue = legacyPreferences.getString(legacyKey, null)
        if (!legacyPreferences.edit().remove(legacyKey).commit()) {
            if (oldLegacyValue != null) {
                legacyPreferences.edit().putString(legacyKey, oldLegacyValue).commit()
            }
            throw AndroidCredentialStoreException("API 凭据安全保存未完成，请重试。")
        }
        if (!securePreferences.edit().remove(authoritativeEntryName(alias)).commit()) {
            throw AndroidCredentialStoreException("API 凭据安全保存未完成，请重试。")
        }
    }

    fun deleteProfileCredential(user: String) = synchronized(storeLock) {
        validateUser(user)
        if (!legacyPreferences.edit().remove(legacyEntryName(user)).commit()) {
            throw AndroidCredentialStoreException("API 凭据删除失败，请重试。")
        }
        deleteCredential(profileCredentialAlias(user))
    }

    fun getTemporaryJobCredential(groupId: String): String =
        getCredential(jobCredentialAlias(groupId), groupId)

    fun setTemporaryJobCredential(groupId: String, value: String) =
        setCredential(jobCredentialAlias(groupId), groupId, value)

    fun deleteTemporaryJobCredential(groupId: String) =
        deleteCredential(jobCredentialAlias(groupId))

    internal fun getCredential(alias: String, aad: String): String = synchronized(storeLock) {
        validateAliasAndAad(alias, aad)
        if (securePreferences.getBoolean(blockedEntryName(alias), false)) {
            throw migrationBlockedError()
        }
        val encrypted = securePreferences.getString(secureEntryName(alias), null)
        if (encrypted.isNullOrBlank()) "" else decryptOrBlock(alias, aad, encrypted)
    }

    internal fun setCredential(
        alias: String,
        aad: String,
        value: String,
        authoritative: Boolean = false,
    ) = synchronized(storeLock) {
        validateAliasAndAad(alias, aad)
        val normalized = value.trim()
        if (normalized.isBlank()) {
            deleteCredential(alias)
            return@synchronized
        }
        try {
            writeEncryptedAndVerify(alias, aad, normalized, authoritative)
        } catch (error: Exception) {
            securePreferences.edit().putBoolean(blockedEntryName(alias), true).commit()
            throw AndroidCredentialStoreException(
                "API 凭据安全保存失败，请重新配置该 API。",
                error,
            )
        }
    }

    internal fun deleteCredential(alias: String) = synchronized(storeLock) {
        require(alias.isNotBlank()) { "Credential alias must not be blank" }
        if (!securePreferences.edit()
                .remove(secureEntryName(alias))
                .remove(blockedEntryName(alias))
                .remove(authoritativeEntryName(alias))
                .commit()
        ) {
            securePreferences.edit().putBoolean(blockedEntryName(alias), true).commit()
            throw AndroidCredentialStoreException("API 凭据删除失败，请重试。")
        }
    }

    private fun writeEncryptedAndVerify(
        alias: String,
        aad: String,
        value: String,
        authoritative: Boolean = false,
    ) {
        val encrypted = AndroidCredentialCipher.encrypt(getOrCreateSecretKey(), aad, value)
        val editor = securePreferences.edit()
            .putString(secureEntryName(alias), encrypted)
            .remove(blockedEntryName(alias))
        if (authoritative) {
            editor.putBoolean(authoritativeEntryName(alias), true)
        } else {
            editor.remove(authoritativeEntryName(alias))
        }
        if (!editor.commit()) {
            throw IllegalStateException("Encrypted credential write failed")
        }
        val stored = securePreferences.getString(secureEntryName(alias), null)
            ?: throw IllegalStateException("Encrypted credential readback failed")
        if (AndroidCredentialCipher.decrypt(getOrCreateSecretKey(), aad, stored) != value) {
            throw IllegalStateException("Encrypted credential verification failed")
        }
    }

    private fun decryptOrBlock(alias: String, aad: String, encrypted: String): String {
        return try {
            AndroidCredentialCipher.decrypt(getOrCreateSecretKey(), aad, encrypted)
        } catch (error: Exception) {
            securePreferences.edit().putBoolean(blockedEntryName(alias), true).commit()
            throw AndroidCredentialStoreException(
                "已保存的 API 凭据无法解密，请重新配置该 API。",
                error,
            )
        }
    }

    private fun getOrCreateSecretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(androidKeyStoreProvider).apply { load(null) }
        val existing = keyStore.getKey(keyAlias, null)
        if (existing != null) {
            return existing as? SecretKey
                ?: throw IllegalStateException("Credential key alias has an unexpected type")
        }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, androidKeyStoreProvider).run {
            init(
                KeyGenParameterSpec.Builder(
                    keyAlias,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .setRandomizedEncryptionRequired(true)
                    .build(),
            )
            generateKey()
        }
    }

    private fun validateUser(user: String) {
        require(user.isNotBlank()) { "Credential user must not be blank" }
    }

    private fun validateAliasAndAad(alias: String, aad: String) {
        require(alias.isNotBlank()) { "Credential alias must not be blank" }
        require(aad.isNotBlank()) { "Credential AAD must not be blank" }
    }

    private fun migrationBlockedError() = AndroidCredentialStoreException(
        "API 凭据安全迁移未完成，请重新配置该 API。",
    )

    companion object {
        internal const val legacyPreferencesName = "image_studio_android"
        internal const val securePreferencesName = "image_studio_secure_credentials"
        private const val androidKeyStoreProvider = "AndroidKeyStore"
        private const val keyAlias = "fhl_image_studio_credentials_v1"
        private const val legacyKeyPrefix = "apikey_"
        private const val secureKeyPrefix = "credential_v1_"
        private const val blockedKeyPrefix = "credential_blocked_v1_"
        private const val authoritativeKeyPrefix = "credential_authoritative_v1_"
        private val storeLock = Any()

        internal fun legacyEntryName(user: String): String = "$legacyKeyPrefix$user"

        internal fun profileCredentialAlias(user: String): String = "profile:$user"

        internal fun jobCredentialAlias(groupId: String): String = "job:$groupId"

        internal fun secureEntryName(alias: String): String = secureKeyPrefix + hashAlias(alias)

        internal fun blockedEntryName(alias: String): String = blockedKeyPrefix + hashAlias(alias)

        internal fun authoritativeEntryName(alias: String): String = authoritativeKeyPrefix + hashAlias(alias)

        private fun hashAlias(alias: String): String {
            val digest = MessageDigest.getInstance("SHA-256")
                .digest(alias.toByteArray(StandardCharsets.UTF_8))
            return digest.joinToString(separator = "") { byte -> "%02x".format(byte.toInt() and 0xff) }
        }
    }
}

internal class AndroidCredentialStoreException(
    message: String,
    cause: Throwable? = null,
) : IllegalStateException(message, cause)
