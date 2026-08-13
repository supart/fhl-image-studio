package top.fangtangyuan.fhlstudio.android

import android.annotation.SuppressLint
import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.util.Log
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewFeature
import androidx.webkit.WebViewClientCompat
import org.json.JSONObject

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var bridge: AndroidImageStudioBridge
    private lateinit var assetLoader: WebViewAssetLoader
    private var androidSafeLeft = 0
    private var androidSafeTop = 0
    private var androidSafeRight = 0
    private var androidSafeBottom = 0
    private val openImageDocumentLauncher = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (::bridge.isInitialized) bridge.onOpenImageDialogResult(uri)
    }
    private val openImagePickerLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (::bridge.isInitialized) bridge.onOpenImageDialogResult(pickedImageUri(result.data))
    }
    private val requestLegacyGalleryPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        launchGalleryImagePicker()
    }
    private val requestNotificationPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        // Best effort only. Background generation still works if the user denies notifications.
    }
    private val importHistoryLauncher = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (::bridge.isInitialized) bridge.onImportHistoryResult(uri)
    }

    private fun isAppAssetUri(uri: Uri): Boolean {
        val scheme = uri.scheme?.lowercase() ?: return false
        val host = uri.host?.lowercase() ?: return false
        return scheme == "https"
            && host == "appassets.androidplatform.net"
            && (uri.path ?: "").startsWith("/assets/")
    }

    private fun shouldOpenExternally(uri: Uri): Boolean {
        if (isAppAssetUri(uri)) return false
        val scheme = uri.scheme?.lowercase() ?: return false
        return scheme == "http" || scheme == "https" || scheme == "mailto" || scheme == "tel"
    }

    private fun openExternalUri(uri: Uri): Boolean {
        return try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
            true
        } catch (_: ActivityNotFoundException) {
            false
        }
    }

    private fun isAndroidEmulator(): Boolean {
        val hardware = Build.HARDWARE.lowercase()
        val imageIdentity = listOf(Build.FINGERPRINT, Build.MODEL, Build.PRODUCT)
            .joinToString(" ")
            .lowercase()
        return hardware in setOf("goldfish", "ranchu") &&
            listOf("generic", "emulator", "sdk_gphone").any(imageIdentity::contains)
    }

    private fun toCssPx(px: Int): Int {
        val density = resources.displayMetrics.density.takeIf { it > 0f } ?: 1f
        return kotlin.math.round(px / density).toInt()
    }

    private fun updateAndroidSafeAreaInsets(insets: WindowInsetsCompat) {
        val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
        val displayCutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
        val density = resources.displayMetrics.density.takeIf { it > 0f } ?: 1f
        val rawLeft = maxOf(systemBars.left, displayCutout.left)
        val rawTop = maxOf(systemBars.top, displayCutout.top)
        val rawRight = maxOf(systemBars.right, displayCutout.right)
        val rawBottom = maxOf(systemBars.bottom, displayCutout.bottom)
        androidSafeLeft = toCssPx(rawLeft)
        androidSafeTop = toCssPx(rawTop)
        androidSafeRight = toCssPx(rawRight)
        androidSafeBottom = toCssPx(rawBottom)
        val diagnostics = JSONObject().apply {
            put("safeLeftPx", rawLeft)
            put("safeTopPx", rawTop)
            put("safeRightPx", rawRight)
            put("safeBottomPx", rawBottom)
            put("safeLeftCss", androidSafeLeft)
            put("safeTopCss", androidSafeTop)
            put("safeRightCss", androidSafeRight)
            put("safeBottomCss", androidSafeBottom)
            put("density", density.toDouble())
            put("widthPx", resources.displayMetrics.widthPixels)
            put("heightPx", resources.displayMetrics.heightPixels)
            put("systemBars", JSONObject().apply {
                put("left", systemBars.left)
                put("top", systemBars.top)
                put("right", systemBars.right)
                put("bottom", systemBars.bottom)
            })
            put("displayCutout", JSONObject().apply {
                put("left", displayCutout.left)
                put("top", displayCutout.top)
                put("right", displayCutout.right)
                put("bottom", displayCutout.bottom)
            })
        }
        if (::bridge.isInitialized) bridge.updateSafeAreaDiagnostics(diagnostics)
        applyAndroidSafeAreaToPage()
    }

    private fun applyAndroidSafeAreaToPage() {
        if (!::webView.isInitialized) return
        val headerSafeTop = androidSafeTop.coerceIn(24, 52)
        val script = """
            (() => {
              const root = document.documentElement;
              if (!root) return;
              root.style.setProperty('--android-safe-left', '${androidSafeLeft}px');
              root.style.setProperty('--android-safe-top', '${androidSafeTop}px');
              root.style.setProperty('--android-safe-right', '${androidSafeRight}px');
              root.style.setProperty('--android-safe-bottom', '${androidSafeBottom}px');
              root.style.setProperty('--android-safe-left-value', '${androidSafeLeft}px');
              root.style.setProperty('--android-safe-top-value', '${androidSafeTop}px');
              root.style.setProperty('--android-safe-right-value', '${androidSafeRight}px');
              root.style.setProperty('--android-safe-bottom-value', '${androidSafeBottom}px');
              root.style.setProperty('--android-header-safe-top-value', '${headerSafeTop}px');
              window.__imageStudioAndroidSafeArea = {
                left: ${androidSafeLeft},
                top: ${androidSafeTop},
                right: ${androidSafeRight},
                bottom: ${androidSafeBottom}
              };
              window.dispatchEvent(new Event('resize'));
              window.dispatchEvent(new Event('orientationchange'));
              if (window.visualViewport) {
                window.visualViewport.dispatchEvent(new Event('resize'));
              }
            })();
        """.trimIndent()
        webView.post {
            webView.evaluateJavascript(script, null)
        }
    }

    private fun launchImageImport() {
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.S_V2) {
            val granted = ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.READ_EXTERNAL_STORAGE,
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                requestLegacyGalleryPermissionLauncher.launch(Manifest.permission.READ_EXTERNAL_STORAGE)
                return
            }
        }
        launchGalleryImagePicker()
    }

    private fun pickedImageUri(intent: Intent?): Uri? {
        if (intent == null) return null
        intent.data?.let { return it }
        val clipData = intent.clipData ?: return null
        for (index in 0 until clipData.itemCount) {
            clipData.getItemAt(index)?.uri?.let { return it }
        }
        return null
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) {
            requestNotificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun launchGalleryImagePicker() {
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Intent(MediaStore.ACTION_PICK_IMAGES).apply {
                type = "image/*"
            }
        } else {
            @Suppress("DEPRECATION")
            Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI).apply {
                type = "image/*"
            }
        }

        try {
            openImagePickerLauncher.launch(intent)
        } catch (_: ActivityNotFoundException) {
            openImageDocumentLauncher.launch(arrayOf("image/*"))
        } catch (_: IllegalStateException) {
            openImageDocumentLauncher.launch(arrayOf("image/*"))
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webview)
        
        ViewCompat.setOnApplyWindowInsetsListener(webView) { _, insets ->
            updateAndroidSafeAreaInsets(insets)
            insets
        }

        bridge = AndroidImageStudioBridge(
            this,
            webView,
            launchOpenImageDialog = {
                launchImageImport()
            },
            launchImportHistory = {
                importHistoryLauncher.launch(arrayOf("application/json", "text/plain", "*/*"))
            },
        )
        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            useWideViewPort = true
            loadWithOverviewMode = true
            mediaPlaybackRequiresUserGesture = false
            databaseEnabled = true
            
            // Performance optimizations
            setSupportZoom(false)
            displayZoomControls = false
            builtInZoomControls = false
        }
        
        // Hardware acceleration
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)

        // Keep the Android shell visually consistent with the app's own theme
        // tokens instead of letting WebView auto-darken individual form controls.
        when {
            WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING) -> {
                WebSettingsCompat.setAlgorithmicDarkeningAllowed(webView.settings, false)
            }
            WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK) -> {
                WebSettingsCompat.setForceDark(webView.settings, WebSettingsCompat.FORCE_DARK_OFF)
            }
        }
        
        // Formal acceptance uses the non-debuggable Release APK on Android
        // emulator hardware. Physical-device Release builds keep CDP disabled.
        if (BuildConfig.DEBUG || isAndroidEmulator()) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
        
        if (BuildConfig.DEBUG && isAndroidEmulator()) {
            webView.addJavascriptInterface(
                object {
                    @JavascriptInterface
                    fun enabled(): Boolean = true
                },
                "AndroidEmulatorAudit",
            )
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
                Log.d(
                    "ImageStudioWebView",
                    "${consoleMessage.messageLevel()}: ${consoleMessage.message()} @ ${consoleMessage.sourceId()}:${consoleMessage.lineNumber()}",
                )
                return super.onConsoleMessage(consoleMessage)
            }
        }
        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                val uri = request.url ?: return false
                if (!shouldOpenExternally(uri)) return false
                return openExternalUri(uri)
            }

            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

            override fun onPageFinished(view: WebView, url: String?) {
                super.onPageFinished(view, url)
                applyAndroidSafeAreaToPage()
            }
        }
        webView.addJavascriptInterface(bridge, "AndroidImageStudio")
        AndroidJobManager.resumePendingWork(applicationContext)
        val launchNonce = System.currentTimeMillis()
        webView.loadUrl("https://appassets.androidplatform.net/assets/index.html?target=${BuildConfig.TARGET_PLATFORM}&rev=$launchNonce")
        ViewCompat.requestApplyInsets(webView)
        requestNotificationPermissionIfNeeded()
    }

    override fun onResume() {
        super.onResume()
        AndroidJobManager.resumePendingWork(applicationContext)
        refreshAndroidJobsForPage()
    }

    private fun refreshAndroidJobsForPage() {
        if (!::webView.isInitialized) return
        webView.post {
            AndroidJobManager.attach(applicationContext)
            webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('image-studio:android-jobs-resume'))",
                null,
            )
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        ViewCompat.requestApplyInsets(webView)
        applyAndroidSafeAreaToPage()
        webView.post {
            webView.evaluateJavascript(
                """
                (() => {
                  window.dispatchEvent(new Event('resize'));
                  window.dispatchEvent(new Event('orientationchange'));
                  if (window.visualViewport) {
                    window.visualViewport.dispatchEvent(new Event('resize'));
                  }
                })();
                """.trimIndent(),
                null,
            )
        }
    }

    override fun onDestroy() {
        webView.removeJavascriptInterface("AndroidImageStudio")
        if (::bridge.isInitialized) bridge.dispose()
        webView.destroy()
        super.onDestroy()
    }
}
