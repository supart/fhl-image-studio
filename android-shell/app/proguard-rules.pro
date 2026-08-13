# Keep JavascriptInterface methods callable from WebView.
-keepclassmembers class top.fangtangyuan.fhlstudio.android.** {
    @android.webkit.JavascriptInterface <methods>;
}
