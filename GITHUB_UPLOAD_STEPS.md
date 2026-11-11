# Android V2.0.5 正式审核与发布步骤

仓库：[supart/fhl-image-studio](https://github.com/supart/fhl-image-studio)

## 固定发布身份

```text
开发分支：codex/android-v2.0.5-upgrade
目标 Tag：v2.0.5-android
Release 标题：FHL Image Studio 方汤圆版 V2.0.5 Android
版本：V2.0.5 / 1050005
正式包名：top.fangtangyuan.fhlstudio.android
Build ID：android-v2.0.5-release
目标分支：不合入 main
GitHub Release latest：false
```

V2.0.5 沿用 V2.0.4 正式签名证书：

```text
6b04a805e50cf66e37c740ad0336bbdf6445653f93802005967babf472e8da36
```

## 发布前门禁

1. 在 `codex/android-v2.0.5-upgrade` 审查最终差异，确认工作树干净；不修改 V2.0.4 Tag、Release、附件或 `main`。
2. 复用与冻结产品代码一致且已通过的 TypeScript、Worker、Android JVM、androidTest 编译和产品回归证据；对本轮发布工具执行定向测试与完整前端测试，并完成 Release Lint、`assembleRelease` 和最终安全扫描。发布工具的验证不能代替正式包门禁。
3. 在干净 ASCII 路径使用同一提交、同一正式 Keystore 构建 Release APK。Gradle 只接受以下受保护环境变量，缺少任一项必须失败关闭：
   - `IMAGE_STUDIO_KEYSTORE_PATH`
   - `IMAGE_STUDIO_KEYSTORE_PASSWORD`
   - `IMAGE_STUDIO_KEY_ALIAS`
   - `IMAGE_STUDIO_KEY_PASSWORD`
4. 校验正式 APK 的 SHA-256、证书指纹、APK Signature Scheme v2、包名、`V2.0.5 / 1050005`、minSdk 28、targetSdk 34 和 `debuggable=false`。
5. 用 `scripts/check-android-release-safety.ps1` 扫描工作树、可达 Git blob、源码 ZIP、APK 内部和最终附件目录；API Key、Bearer/token、Keystore、签名密码、本机路径、私人日志和读取错误必须为 0。
6. 用同一正式 APK 通过审核的 Android MCP 流程完成隔离模拟器全新安装、V2.0.4 正式包覆盖升级和无用户提交的启动观察。只记录可独立观察的请求证据；没有网络观测时不得把“未操作”夸大为实测 POST=0。模拟器 UI 只使用 `ty-android-mcp`，不使用裸 ADB、scrcpy 或凭据截图。
7. 打包五类附件并逐项复核：正式 APK、只含该 APK 的 APK ZIP、APK SHA-256、同一提交的完整源码 ZIP、源码 ZIP SHA-256。APK ZIP 内部 APK 必须与外部 APK 逐字节一致。

正式包原地升级依赖同一正式签名证书，升级后应保留原有 Key/历史等本地数据；V2.0.5 的模型目录身份和能力证明发生变化时，必须重新获取目录并明确保存统一模型，不自动沿用旧验证。

## 附件命名约定

```text
FHL-Image-Studio-Fangtangyuan-V2.0.5-Android-Release-YYYYMMDD.apk
FHL-Image-Studio-Fangtangyuan-V2.0.5-Android-Release-YYYYMMDD.zip
FHL-Image-Studio-Fangtangyuan-V2.0.5-Android-Release-YYYYMMDD.sha256.txt
FHL-Image-Studio-Fangtangyuan-V2.0.5-Android-Source-YYYYMMDD.zip
FHL-Image-Studio-Fangtangyuan-V2.0.5-Android-Source-YYYYMMDD.sha256.txt
```

APK、APK ZIP、源码 ZIP 和哈希文件均不进入 Git 树。正式签名包和附件在本轮门禁前不得宣称已生成或已通过。

## 推送、Tag 与 Release

用户已授权本版本在审核门禁通过后推送 Android 分支、创建 `v2.0.5-android` Tag 和 GitHub Release；这些动作不再另行请求确认。授权不包含修改或合入 `main`。Release 必须明确设置 `latest=false`，并使用 [RELEASE_NOTES_V2.0.5_ANDROID.md](./RELEASE_NOTES_V2.0.5_ANDROID.md) 的最终正文。

发布顺序：

1. 完成并记录正式包门禁、签名核验、安全扫描、模拟器升级验证和附件哈希。
2. 推送 `codex/android-v2.0.5-upgrade` 到远端，复核远端提交与本地提交一致。
3. 在同一提交创建 `v2.0.5-android` Tag 并推送；不得覆盖已有 Tag。
4. 创建 `latest=false` 的 Draft GitHub Release，上传上述五个附件。
5. 从 Draft Release 重新下载全部附件，逐项计算 SHA-256，与本地冻结清单一致后转为正式发布；再次核查 Release 状态、Tag 和分支身份。

当前文档只记录授权和目标流程；正式包、远端提交、Tag、Release 与附件哈希仍以本轮实际门禁结果为准，不得预填或编造。
