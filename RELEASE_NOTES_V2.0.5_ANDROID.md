# FHL Image Studio 方汤圆版 Android V2.0.5 更新说明

发布身份：正式 APK 与对应源码以 `v2.0.5-android` Release 附件为准；最终验收及 SHA-256 随 Release 正文记录。
基线：V2.0.4 / 1050004，提交 `bbe7668609798873923005046366e44068e75eb6`
目标版本：V2.0.5 / 1050005
目标 Tag：`v2.0.5-android`

## 主要更新

- FHL Images 模型目录改为动态 GPT Image 2.x；十槽面板显示安全并集，只允许保存所有目标槽共同可用、且能力均通过验证的模型。
- 统一模型面板自动扫描并验证活动槽目录；用户明确点击保存后才原子更新配置。原生 receipt 和批次证明绑定模型、槽位与能力。
- 新增受验证的透明 PNG 流程，包括 provider 能力门禁、请求快照和最终图像 Alpha 校验；透明预览使用保留 Alpha 的格式。
- 启动与回前台恢复优化为任务状态单调合并、图片历史补偿、通知和旧状态防覆盖；系统杀进程后未知付费提交不自动重发。
- 修复 Android API Key 字段系统粘贴、图生图等待预览和画布缩放回弹；模型选择默认收起，点击后弹出可滚动列表，选中后收起。
- 保留 FHL Images/Responses、十槽 Keystore、每槽并发 4/总并发 40、重复 `image` multipart、多参考图、FHL 4:3/3:4 及其他 provider 的独立语义。

## 升级说明

- 正式包沿用 V2.0.4 的正式包名 `top.fangtangyuan.fhlstudio.android` 和正式签名证书。正式 APK 构建与同证书校验通过后，覆盖升级应保留该正式包的本地数据；该行为仍须使用本轮最终 APK 做设备升级验收。
- 目录缓存和模型能力证明已升级。升级后请在 FHL Images 十槽设置重新验证目录，并显式保存统一模型；不会自动替换原模型。完成前 FHL Images 提交会按门禁拦截。
- 外测 Debug 包使用独立包名 `top.fangtangyuan.fhlstudio.android.debug` 和 Debug 证书，可与正式包并存，不继承正式包数据，也不能代替正式升级验收。
- 首次安装不内置 API Key。

## 验证状态

- 本地源码回归记录：前端完整测试 `440/440`、TypeScript、Android 前端构建、Worker `5/5`、Android JVM `71/71`、androidTest 编译打包、Debug 构建及安全扫描通过。该记录针对本地候选，不代表正式签名 APK 已生成。
- 本轮发布工具回归：完整前端测试 `443/443`，发布工作流、安全扫描和构建身份定向测试 `9/9` 通过。正式产物结果随 Release 正文另附。
- 用户报告：Android 手机上安装测试可用。此项为用户反馈；本轮未以最终正式签名 APK 独立复验。
- 本轮正式签名 APK、APK/源码归档、最终产物扫描、V2.0.4 覆盖升级、远端附件复核和 GitHub Release 均尚待完成；完成前不记录正式包哈希或发布通过结论。
- 已授权推送 Android 专用分支、创建独立 Tag 和 Release；不合入或修改 `main`。正式 GitHub Release 必须设置为非 latest。

## 隐私与发布边界

- 正式包和发布附件不得包含 API Key、用户图片、任务历史、私人日志、Keystore 文件或签名密码。
- APK、APK ZIP、源码 ZIP 和哈希文件不进入 Git 树；发布附件必须与同一审核提交绑定并逐项复核 SHA-256。
- V2.0.4 Tag、Release 和附件保持不变。
