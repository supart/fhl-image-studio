# Android Studio + MuMu / AVD 调试

这份流程用于在电脑上联调安卓版本，优先用模拟器，真机只做最后验收。

## 推荐环境

- Android Studio
- Android SDK 34
- Android Emulator
- Platform Tools (`adb`)
- JDK 17
- Node.js 24.13.1
- Chrome

## 主开发流程

1. 打开 `image-studio/frontend`。
2. 执行：

```bash
npm ci
npm test
npm run build:android
```

3. 打开 `android-shell`，在 Android Studio 里运行 `debug` 变体到模拟器。
4. 每次修改前端后重新执行 `npm run build:android`，再回到模拟器刷新或重跑。

## 调试入口

- Android Studio `Logcat`
- `chrome://inspect` 调试 WebView
- `adb logcat` 直接看系统日志

## 推荐模拟器

- Phone: Pixel 6 / Android 14
- Tablet: Pixel Tablet / Android 14

## 常见问题

- WebView 页面不是直连 Vite dev server，而是打包进 APK 的静态 assets。
- `退到后台仍在跑` 与 `进程死亡后可恢复` 是两件事。
- 当前版本只在进程仍存活时继续后台任务；进程死亡或强制停止后，旧直接生图任务会标记中断且不会自动重提。仍应先用模拟器验证后台通知和冷启动零重复POST。
