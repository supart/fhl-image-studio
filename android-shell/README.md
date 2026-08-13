# Android Shell

This module packages the existing React frontend into a single Android APK.
The frontend always builds the `android` target, and the app switches between
phone and pad shells at runtime based on the current window size / orientation.

The shell is a minimal WebView wrapper. During Gradle asset merging it runs the
frontend build for the matching target and copies `image-studio/frontend/dist/`
into `app/src/main/assets/web/`.

Current scope:

- APK packaging works from the WebView shell
- Frontend startup is supported by the Android-side `AndroidImageStudio` bridge
- Desktop-only backend features that still depend on the Go/Wails runtime are
  surfaced as explicit "not implemented in Android shell yet" errors

Local build:

```bash
cd android-shell
./gradlew assembleRelease
```

Android Studio / emulator debugging:

- See `../docs/mumu-android-debug.md` for the shared ADB connection,
  emulator setup, install, screenshot, rotation, and troubleshooting workflow.
