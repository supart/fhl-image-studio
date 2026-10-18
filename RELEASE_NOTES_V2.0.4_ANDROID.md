# FHL Image Studio 方汤圆版 V2.0.4 Android 更新说明

发布日期：待 GitHub 审核后填写

本项目基于 [RoseKhlifa/Image-Studio](https://github.com/RoseKhlifa/Image-Studio) 独立修改，按 GNU AGPLv3.0 公开完整对应源码。本版本不内置任何 API Key。

## 版本信息

- 包名：`top.fangtangyuan.fhlstudio.android`
- 版本名：`V2.0.4`
- 版本号：`1050004`
- minSdk 28、targetSdk 34
- 计划 Tag：`v2.0.4-android`
- 正式证书 SHA-256：`6b04a805e50cf66e37c740ad0336bbdf6445653f93802005967babf472e8da36`

## 主要更新

- 修复 FHL Images 多参考图请求：底图和全部参考图按顺序重复使用 `image` multipart 字段，不再发送 `image[]`；`mask` 保持独立。
- FHL 生图比例新增 `4:3` 和 `3:4`，文生图、图生图与批量图生图沿用手动选择的比例。
- FHL Responses 文本配置新增“获取模型”：通过 `/v1/models` 拉取可用模型，支持自动补选、列表选择和自定义模型 ID。
- 图片反推和提示词优化共用一个已保存文本模型；当前模型仍可用时保持不变，一键配置不再覆盖已有选择。
- 浏览器请求和 Android 原生 Bridge 都兼容字符串及 `{ id }` 模型条目，并过滤空值、无效值和重复值。
- 应用显示名、About 页面、前端品牌和构建版本统一为 `V2.0.4 / 1050004`。

## 验证记录

- 文本模型定向前端测试 `48/48` 通过；Android 图像请求、比例和既有功能回归已纳入完整测试。
- 前端完整测试 `364/365`；唯一失败是既有 Windows PowerShell 环境缺少 `Get-FileHash`，不是 V2.0.4 产品断言失败。
- `npm run build:android`、Android JVM `54/54`、`:app:assembleDebug` 和 API 36.1 模拟器 instrumentation `13/13` 通过。
- 最新 Debug APK 已覆盖安装到模拟器，模型列表、获取按钮、自定义模型输入和共享模型说明显示正常。
- 正式 Release APK 从同一份模拟器验证源码重新签名构建，包含模型获取与选择控件。

## 隐私与限制

- APK、源码和发布附件不包含 API Key、用户图片、任务历史、日志、Keystore 或签名密码。
- 模型列表只在当前配置界面会话中保存；用户点击保存后才写入所选模型 ID。
- 当前没有可安全使用的测试 API Key，因此未执行真实 `/v1/models`、提示词优化、图片反推或付费生图；不得把静态或 Mock 验证表述为真实上游成功。
- APIMart 和 RunningHub 的请求字段及比例语义保持独立，没有转换为 FHL 像素尺寸。

## 发布资产

```text
FHL-Image-Studio-Fangtangyuan-V2.0.4-Android-Release-20261019.apk
FHL-Image-Studio-Fangtangyuan-V2.0.4-Android-Release-20261019.zip
FHL-Image-Studio-Fangtangyuan-V2.0.4-Android-Release-20261019.sha256.txt
FHL-Image-Studio-Fangtangyuan-V2.0.4-Android-Source-20261019.zip
FHL-Image-Studio-Fangtangyuan-V2.0.4-Android-Source-20261019.sha256.txt
```

正式哈希由本地冻结资产生成。APK、APK ZIP 和源码 ZIP 作为 GitHub Release 附件，不进入 Git 树。
