# Android V2.0.3 GitHub审核与上传步骤

仓库：[supart/fhl-image-studio](https://github.com/supart/fhl-image-studio)

## 固定发布身份

```text
分支：codex/android-v2.0.3-public-release
Tag：v2.0.3-android
标题：FHL Image Studio 方汤圆版 V2.0.3 Android
版本：V2.0.3 / 1050003
包名：top.fangtangyuan.fhlstudio.android
Build ID：android-v2.0.3-release
```

正式证书 SHA-256：

```text
6b04a805e50cf66e37c740ad0336bbdf6445653f93802005967babf472e8da36
```

## 上传前门禁

1. 确认工作树干净，公开提交只包含构建源码、测试、许可证、Workflow和用户文档。
2. 运行前端测试、TypeScript、Worker测试、Android JVM、Lint和UI矩阵。
3. 在两个全新ASCII路径工作树构建正式APK，要求逐字节一致。
4. 校验包名、版本、SDK、`debuggable=false`、v2签名和正式证书。
5. 扫描公开Git历史、源码ZIP、APK内部和全部附件；真实Key、Bearer/token、Keystore、本机路径、私人日志和读取错误必须为0。
6. 用同一APK完成隔离模拟器全新安装、V2.0.2.1覆盖升级和30秒零自动POST验证。
7. 核对APK ZIP内只有一个APK且逐字节一致；源码ZIP必须来自同一提交的`git archive`。

正式构建关闭AGP可选的加密依赖信息块。该块不参与应用运行，但每次加密都会写入新的随机数据；关闭后才能让两个干净路径生成的正式签名APK逐字节一致。不得通过复用第一次产物、忽略签名块或只比较ZIP条目来替代双构建门禁。

签名材料只通过环境变量提供：

```text
IMAGE_STUDIO_KEYSTORE_PATH
IMAGE_STUDIO_KEYSTORE_PASSWORD
IMAGE_STUDIO_KEY_ALIAS
IMAGE_STUDIO_KEY_PASSWORD
```

这些值、Keystore文件和本机签名环境脚本不得进入Git、源码ZIP、日志或发布附件。

## GitHub Actions

`.github/workflows/android-release.yml`只允许手动`workflow_dispatch`，权限为`contents: read`，只上传14天保留的审核附件。它不会响应Tag推送，也不会创建GitHub Release。

仓库Secrets需要配置：

```text
ANDROID_RELEASE_KEYSTORE_BASE64
ANDROID_RELEASE_KEYSTORE_PASSWORD
ANDROID_RELEASE_KEY_ALIAS
ANDROID_RELEASE_KEY_PASSWORD
```

缺少任一项都会失败，不允许回退到Debug签名。

## 用户审核后的实际发布

本地审核包通过后，才执行以下独立步骤：

1. 将公开分支推送到GitHub并审查提交差异。
2. 在该公开提交上创建签名Tag `v2.0.3-android`。
3. 手动创建GitHub Release，正文使用 `RELEASE_NOTES_V2.0.3_ANDROID.md`。
4. 上传APK、APK ZIP、两份SHA256文件和完整源码ZIP。
5. 下载GitHub附件重新计算哈希，确认与本地冻结资产一致。

本文件不授权自动推送、自动打Tag或自动发布。执行这些外部操作前必须再次取得用户确认。
