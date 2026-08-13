package top.fangtangyuan.fhlstudio.android

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidCredentialStoreInstrumentedTest {
    private val context: Context
        get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Test
    fun legacyCredentialMigratesOnlyAfterEncryptedReadback() {
        val user = testUser("migration")
        val value = "instrumentation-migration-credential"
        val legacy = context.getSharedPreferences(
            AndroidCredentialStore.legacyPreferencesName,
            Context.MODE_PRIVATE,
        )
        val secure = context.getSharedPreferences(
            AndroidCredentialStore.securePreferencesName,
            Context.MODE_PRIVATE,
        )
        try {
            assertTrue(legacy.edit().putString(AndroidCredentialStore.legacyEntryName(user), value).commit())

            assertEquals(value, AndroidCredentialStore(context).getProfileCredential(user))

            assertFalse(legacy.contains(AndroidCredentialStore.legacyEntryName(user)))
            val encrypted = secure.getString(
                AndroidCredentialStore.secureEntryName(AndroidCredentialStore.profileCredentialAlias(user)),
                null,
            )
            assertTrue(!encrypted.isNullOrBlank())
            assertNotEquals(value, encrypted)
        } finally {
            cleanup(user)
        }
    }

    @Test
    fun interruptedMigrationRemovesMatchingLegacyPlaintextOnNextRead() {
        val user = testUser("interrupted-migration")
        val value = "interrupted-migration-credential"
        val legacy = context.getSharedPreferences(
            AndroidCredentialStore.legacyPreferencesName,
            Context.MODE_PRIVATE,
        )
        try {
            val store = AndroidCredentialStore(context)
            store.setProfileCredential(user, value)
            assertTrue(legacy.edit().putString(AndroidCredentialStore.legacyEntryName(user), value).commit())

            assertEquals(value, store.getProfileCredential(user))
            assertFalse(legacy.contains(AndroidCredentialStore.legacyEntryName(user)))
        } finally {
            cleanup(user)
        }
    }

    @Test
    fun mismatchedLegacyAndEncryptedCredentialsFailClosed() {
        val user = testUser("mismatch")
        val legacy = context.getSharedPreferences(
            AndroidCredentialStore.legacyPreferencesName,
            Context.MODE_PRIVATE,
        )
        val secure = context.getSharedPreferences(
            AndroidCredentialStore.securePreferencesName,
            Context.MODE_PRIVATE,
        )
        try {
            val store = AndroidCredentialStore(context)
            store.setProfileCredential(user, "encrypted-test-credential")
            assertTrue(
                legacy.edit()
                    .putString(AndroidCredentialStore.legacyEntryName(user), "different-legacy-credential")
                    .commit(),
            )

            expectCredentialFailure { store.getProfileCredential(user) }

            assertEquals(
                "different-legacy-credential",
                legacy.getString(AndroidCredentialStore.legacyEntryName(user), null),
            )
            assertTrue(
                secure.getBoolean(
                    AndroidCredentialStore.blockedEntryName(
                        AndroidCredentialStore.profileCredentialAlias(user),
                    ),
                    false,
                ),
            )
        } finally {
            cleanup(user)
        }
    }

    @Test
    fun explicitOverwriteMarkerMakesNewEncryptedCredentialAuthoritativeAfterCrash() {
        val user = testUser("explicit-overwrite")
        val legacy = context.getSharedPreferences(
            AndroidCredentialStore.legacyPreferencesName,
            Context.MODE_PRIVATE,
        )
        val secure = context.getSharedPreferences(
            AndroidCredentialStore.securePreferencesName,
            Context.MODE_PRIVATE,
        )
        val alias = AndroidCredentialStore.profileCredentialAlias(user)
        try {
            val store = AndroidCredentialStore(context)
            store.setProfileCredential(user, "new-explicit-credential")
            assertTrue(legacy.edit().putString(
                AndroidCredentialStore.legacyEntryName(user),
                "stale-legacy-credential",
            ).commit())
            assertTrue(secure.edit().putBoolean(
                AndroidCredentialStore.authoritativeEntryName(alias),
                true,
            ).commit())

            assertEquals("new-explicit-credential", store.getProfileCredential(user))
            assertFalse(legacy.contains(AndroidCredentialStore.legacyEntryName(user)))
            assertFalse(secure.contains(AndroidCredentialStore.authoritativeEntryName(alias)))
        } finally {
            cleanup(user)
        }
    }

    @Test
    fun encryptedCredentialCannotBeReadUnderAnotherUser() {
        val sourceUser = testUser("aad-source")
        val targetUser = testUser("aad-target")
        val secure = context.getSharedPreferences(
            AndroidCredentialStore.securePreferencesName,
            Context.MODE_PRIVATE,
        )
        try {
            val store = AndroidCredentialStore(context)
            store.setProfileCredential(sourceUser, "instrumentation-aad-credential")
            val encrypted = requireNotNull(secure.getString(
                AndroidCredentialStore.secureEntryName(
                    AndroidCredentialStore.profileCredentialAlias(sourceUser),
                ),
                null,
            )) { "Missing encrypted source credential" }
            assertTrue(
                secure.edit()
                    .putString(
                        AndroidCredentialStore.secureEntryName(
                            AndroidCredentialStore.profileCredentialAlias(targetUser),
                        ),
                        encrypted,
                    )
                    .commit(),
            )

            expectCredentialFailure { store.getProfileCredential(targetUser) }
            assertTrue(
                secure.getBoolean(
                    AndroidCredentialStore.blockedEntryName(
                        AndroidCredentialStore.profileCredentialAlias(targetUser),
                    ),
                    false,
                ),
            )
        } finally {
            cleanup(sourceUser)
            cleanup(targetUser)
        }
    }

    @Test
    fun temporaryJobCredentialUsesGroupIdAadAndCanBeDeleted() {
        val groupId = "instrumentation-group:${UUID.randomUUID()}"
        val value = "instrumentation-job-credential"
        val store = AndroidCredentialStore(context)
        try {
            store.setTemporaryJobCredential(groupId, value)

            assertEquals(value, store.getTemporaryJobCredential(groupId))
            store.deleteTemporaryJobCredential(groupId)
            assertEquals("", store.getTemporaryJobCredential(groupId))
        } finally {
            context.getSharedPreferences(
                AndroidCredentialStore.securePreferencesName,
                Context.MODE_PRIVATE,
            )
                .edit()
                .remove(
                    AndroidCredentialStore.secureEntryName(
                        AndroidCredentialStore.jobCredentialAlias(groupId),
                    ),
                )
                .remove(
                    AndroidCredentialStore.blockedEntryName(
                        AndroidCredentialStore.jobCredentialAlias(groupId),
                    ),
                )
                .commit()
        }
    }

    @Test
    fun corruptEncryptedValueFailsClosedWithoutFallingBackToLegacyPlaintext() {
        val user = testUser("corrupt")
        val legacy = context.getSharedPreferences(
            AndroidCredentialStore.legacyPreferencesName,
            Context.MODE_PRIVATE,
        )
        val secure = context.getSharedPreferences(
            AndroidCredentialStore.securePreferencesName,
            Context.MODE_PRIVATE,
        )
        try {
            assertTrue(
                legacy.edit()
                    .putString(AndroidCredentialStore.legacyEntryName(user), "legacy-test-credential")
                    .commit(),
            )
            assertTrue(
                secure.edit()
                    .putString(
                        AndroidCredentialStore.secureEntryName(
                            AndroidCredentialStore.profileCredentialAlias(user),
                        ),
                        "v1.invalid.invalid",
                    )
                    .commit(),
            )

            expectCredentialFailure { AndroidCredentialStore(context).getProfileCredential(user) }

            assertEquals(
                "legacy-test-credential",
                legacy.getString(AndroidCredentialStore.legacyEntryName(user), null),
            )
            assertTrue(
                secure.getBoolean(
                    AndroidCredentialStore.blockedEntryName(
                        AndroidCredentialStore.profileCredentialAlias(user),
                    ),
                    false,
                ),
            )
        } finally {
            cleanup(user)
        }
    }

    private fun cleanup(user: String) {
        context.getSharedPreferences(AndroidCredentialStore.legacyPreferencesName, Context.MODE_PRIVATE)
            .edit()
            .remove(AndroidCredentialStore.legacyEntryName(user))
            .commit()
        context.getSharedPreferences(AndroidCredentialStore.securePreferencesName, Context.MODE_PRIVATE)
            .edit()
            .remove(
                AndroidCredentialStore.secureEntryName(
                    AndroidCredentialStore.profileCredentialAlias(user),
                ),
            )
            .remove(
                AndroidCredentialStore.blockedEntryName(
                    AndroidCredentialStore.profileCredentialAlias(user),
                ),
            )
            .remove(
                AndroidCredentialStore.authoritativeEntryName(
                    AndroidCredentialStore.profileCredentialAlias(user),
                ),
            )
            .commit()
    }

    private fun expectCredentialFailure(block: () -> Unit) {
        try {
            block()
            fail("Expected credential access to fail closed")
        } catch (_: AndroidCredentialStoreException) {
            // Expected.
        }
    }

    private fun testUser(label: String): String = "instrumentation:$label:${UUID.randomUUID()}"
}
