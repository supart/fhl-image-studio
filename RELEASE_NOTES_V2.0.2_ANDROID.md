# FHL Image Studio 方汤圆版 V2.0.2 Android

发布日期：2026-06-28

这是 Android V2.0.2 的正式发布记录。该版本对齐桌面 V2.0.2 的主要生图流程，同时保留手机和平板端的性能、发热和 WebView 约束。

## 主要升级

- 新增 Android 端 RunningHub 配置与生成链路，支持 `banana2` 和 `image_g2`，模拟器桥接地址为 `http://10.0.2.2:8117`。
- Android 端保留 FHL Responses / Images，并支持 APIMart 异步生成、任务恢复和按任务 ID 查询。
- 生图任务优先走原生后台任务管理器，减少 WebView 前台长连接压力。
- 成功生成的原图会尽可能自动写入系统相册，目录为 `Pictures/ImageStudio`。
- 连续生成默认开启，手机端并发采用保守策略：默认 1，最大 2，避免发热和卡顿。
- 结果、画布和历史流程补齐移动端常用操作：查看详情、保存原图、复制图片、分享图片、设为来源图、清空画布。
- 批量结果、历史记录和当前图预览保留 API 标签和真实像素尺寸角标。
- 提示词区域对齐桌面结构，包含提示词前缀、主提示词、折叠/展开和指令改写。
- 反推提示词可在生成中继续使用，并优先使用当前图或来源图作为输入。
- Android 设置、上游配置、历史、画布和暗色模式细节进行了可读性和触控优化。

## 发布整理

- 正式应用显示名：`FHL Image Studio 方汤圆版 V2.0.2`。
- 包名：`top.fangtangyuan.fhlstudio.android`。
- 版本名：`V2.0.2`。
- 版本号：`1050001`。
- API Key、RunningHub Key、本地配置、生成图、日志和审计文件不进入源码仓库或发布包。
- RunningHub Key 仍保存在本机 8117 桥接模块中，Android 配置不会写入 RH Key。
- 本次发布使用本机 release keystore 签名；keystore 和密码文件保存在 `.local/android-release/`，不会上传 GitHub。

## 已知未迁移

- 桌面版 360 / Panorama 高级工作流尚未迁移到 Android。Android 360 作为后续二期移动交互任务处理。

## 验证建议

发布前建议完成以下检查：

```powershell
cd image-studio/frontend
npm test
npm run build:android

cd ../../android-shell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:Path="$env:JAVA_HOME\bin;$env:Path"
.\gradlew.bat assembleRelease
```

安装 APK 后建议确认：首次启动没有预置 API Key，应用名和版本正确，配置页默认状态干净，基础结果/历史/画布流程可打开。

## 本次发布验证

- `npm test`：通过，205 个测试通过。
- `npm run build:android`：通过，仅有 Vite chunk size 警告。
- `assembleRelease`：通过，使用本机 release keystore 签名。
- `apksigner verify --verbose --print-certs`：通过，APK Signature Scheme v2 验证通过，RSA 4096 release 证书。
- `aapt dump badging`：确认包名 `top.fangtangyuan.fhlstudio.android`，版本名 `V2.0.2`，版本号 `1050001`，应用显示名 `FHL Image Studio 方汤圆版 V2.0.2`。
- 模拟器 `emulator-5554`：卸载旧包后安装正式 APK 成功，启动成功，crash buffer 为空。
- 发布前隐私扫描：未发现高置信 API Key、token、keystore、APK/ZIP 或本地配置进入 Git 文件列表。

## 发布资产

- APK：`FHL-Image-Studio-方汤圆版-V2.0.2-Android-Release-20260628.apk`
  - SHA256：`775E035F266BAAFEACD8C93EB8D67CA405B6F71E5A0FF89F0E2E5F096BB21475`
- ZIP：`FHL-Image-Studio-方汤圆版-V2.0.2-Android-Release-20260628.zip`
  - SHA256：`33867FE2E8FE475803B4957E855E159C76B5DB3022062A854895DB2222C1D8A2`
