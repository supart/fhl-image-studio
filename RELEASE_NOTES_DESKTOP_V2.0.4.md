# FHL Image Studio Windows 桌面版 V2.0.4 正式发布

这是 Windows 10/11 x64 Portable（免安装版）的独立正式更新。

本次发布不替代、覆盖或修改 macOS `v2.0.3`、`v2.0.3.1` 的标签、Release 或 DMG，Android 版本也不受影响。本项目是基于 Image-Studio 的独立修改发行，对应源码按 GNU AGPLv3 发布。

## 本次升级

- 新增 Cowart 风格图像标注工作台，支持箭头、形状、高亮、自由画、文字、变形、撤销/重做和 PNG 合成保存。
- 局部重绘采用镜头框工作流，补齐自动、手动和导入贴回；多次生成、重试和重启后仍保留原裁切区关系。
- 修复 Images API 多张参考图中第二张及以后可能失效的问题，每张图片现按原顺序重复使用 multipart `image` 字段。
- FHL 文本 API 支持手动拉取 `/v1/models`、选择内置或自定义模型；图片反推、提示词优化和 Photoshop Bridge 共用当前选择。
- Windows Portable 根目录新增固定的 `FHL Studio Photoshop 对接文件.json`，并公开 Bridge `prompt-reverse` capability 与认证路由。
- FHL Images 十槽快速配置补齐“批量配置 10 个 API”入口；关闭后不会残留批量弹窗状态。
- 默认生成参数统一为 2K、标准质量和 PNG；文本模型默认为 `gpt-5.6-sol`。
- 修复多标签工作区的异步回写、参考图同步、清空视图工具栏、原图对比和大图局部处理等稳定性问题。

## 安装与使用

1. 下载 `FHL-Image-Studio-Desktop-V2.0.4-Windows-Portable.zip`。
2. 使用 `SHA256SUMS.txt` 校验下载文件。
3. 完整解压 ZIP，双击 `一键启动FHL Studio V2.0.4.cmd`。
4. 在桌面版设置中配置并测试自己的 API。

这是免安装版，不依赖 Node、Vite、外部浏览器或管理员权限。系统需要 Microsoft Edge WebView2 Runtime，Windows 10/11 通常已预装。

## 发布附件

- `FHL-Image-Studio-Desktop-V2.0.4-Windows-Portable.zip`：Windows x64 免安装版。
- `FHL-Image-Studio-Desktop-V2.0.4-Windows-Source.zip`：与本 Windows 标签对应的干净完整源码。
- `SHA256SUMS.txt`：两个 ZIP 的 SHA-256 校验值。

## 安全与数据说明

发布源码和 Portable 不包含：

- API Key、Token、Windows Credential Manager 凭据、活动 Profile 或个人配置。
- 用户图片、PSD、生成历史、任务记录、WebView 数据、日志或测试输出。
- Node 依赖、Vite 构建缓存、Debug EXE、安装器或 Photoshop 插件交付物。

同一 Windows 账户从旧版升级时，软件可能读取该账户 Credential Manager 中已有的 FHL Studio 凭据。这是本机升级兼容行为，不表示 ZIP 携带 API Key。新电脑或新 Windows 账户会以无 API 配置状态启动。

已运行过的解压目录会生成本机 WebView 和用户数据，不应再次压缩或转发为原始发布包。

## 验证结果

- Windows V2.0.4 人工功能验收已通过；三张参考图的真实 FHL Images 测试已确认多图参考生效。
- 前端 Node `749/749`、UI `130/130`、Worker `5/5` 通过。
- TypeScript、ESLint、Windows 前端构建、Desktop/CLI Go test+vet、Fast 与 Batch 门禁通过。
- 发布阶段只执行离线测试、结构扫描和 Bridge 握手，不再调用真实文本或生图 API。

## 已知边界

- FHL Images、APIMart、RunningHub 和文本模型的可用性、额度、限流和模型兼容由对应上游服务决定。
- 本版不提供 Setup、MSI 或 MSIX 安装器。
- Photoshop UXP 插件是独立项目，不随本仓库、源码 ZIP 或 Release 附件分发。
