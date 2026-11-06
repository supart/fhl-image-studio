# FHL Image Studio macOS V2.0.5

这是基于 [RoseKhlifa/Image-Studio](https://github.com/RoseKhlifa/Image-Studio) 的独立修改发行版，不是上游官方版本。本版按 GNU AGPLv3 发布完整对应源码，不内置任何 API Key、账号配置、Keychain 数据、历史记录、测试图片或用户数据。

V2.0.5 是独立的 macOS Universal 更新，延续 V2.0.4 的完整工作区和 V2.0.3 蓝灰 Fluent 视觉。本次 Release 只提供 macOS 成品、对应源码 ZIP 和 SHA-256 校验文件，不上传或覆盖 Android、Photoshop 插件及独立 Bridge 资产，也不替代其他平台的 Latest Release。

## 本次更新

- 新增 FHL 生图模型拉取与手动选择，模型列表使用已保存的 FHL Images Key 请求 `/v1/models`。完整列表会显示，但仅允许选择 `gpt-image-2.5-flare`、`gpt-image-2.5-sunburst` 和 `gpt-image-2`。
- 生图模型列表改为紧凑下拉框：未拉取时只显示当前模型，拉取后按上游顺序展开完整列表，不支持的模型保持禁用，不会把无关模型误设为当前选择。
- 10 个 FHL Images API 槽共享同一个全局生图模型。旧 V2.0.4 配置缺少模型字段时迁移为 `gpt-image-2`；新配置必须先拉取并选择模型，未知旧模型会保留并阻止生成，不会静默替换。
- `gpt-image-2.5-flare` 与 `gpt-image-2.5-sunburst` 新增“普通图像 / 透明 PNG”选择。`gpt-image-2` 不显示透明选项，切换到该模型会自动恢复普通图像。
- “普通图像 / 透明 PNG”使用与文生图 / 图生图一致的蓝色边框、浅蓝底和内描边选中态，保持紧凑 Fluent 视觉。
- 透明模式固定输出 PNG。Images API 发送 `background=transparent`、`output_format=png` 和 `response_format=b64_json`；Responses API 只在 `image_generation` 工具参数中发送背景和格式。
- 透明结果会解码 PNG 并检查真实 Alpha：必须同时存在透明像素和可见主体像素。全不透明 PNG、全透明空图、解码失败及棋盘格伪透明结果不会记为成功，也不会自动降级为普通图像。
- 透明模式和显式 Profile 请求不再静默跨 Images/Responses 路由。失败会保留脱敏错误及 raw 响应路径，便于诊断。
- CLI 新增 `--background opaque|transparent`、`IMAGE_STUDIO_BACKGROUND_MODE`、模型选择状态和 Alpha 结果字段，并提供 `--list-workers`、`--self-test-adaptive`、`--self-test-workflow` 离线自检入口。

## 安装与升级

1. 下载 `FHL-Image-Studio-Desktop-V2.0.5-macOS-Universal.dmg` 和 `SHA256SUMS.txt`，校验文件完整性。
2. 打开 DMG，将 `FHL Studio.app` 拖入 `Applications`；已有旧版时选择“替换”。
3. 本版使用 ad-hoc 签名和 hardened runtime，未使用 Developer ID，也未进行 Apple 公证。首次启动请在 Finder 中右键应用并选择“打开”。
4. 进入 FHL 配置，先保存自己的 Images API Key，再点击“拉取模型”并选择生图模型。正式包不提供默认 Key 或共享账号。

替换 App 不会主动删除本机图片、历史记录、设置或 Keychain 凭据。同一 macOS 账户升级后可能继续读取该账户已有数据，这不表示发布包包含用户数据；新 Mac 或新用户账户会以默认未配置、未选择模型状态启动。

## 数据与安全边界

- 生成图片：`~/Pictures/FHL Studio`
- 应用配置：`~/Library/Application Support/fhl-studio`
- 运行日志：`~/Library/Logs/FHL Studio`
- API 凭据：macOS Keychain，service 为 `FHL Studio`

正式 DMG 只包含 `FHL Studio.app`、Applications 快捷入口和 `README_MACOS.md`，不包含 API Key、访问令牌、Keychain 数据、用户图片、历史、日志、raw 响应、WebKit 数据、`cli.env.local`、`node_modules` 或构建缓存。

## Release 资产

- `FHL-Image-Studio-Desktop-V2.0.5-macOS-Universal.dmg`
- `FHL-Image-Studio-Desktop-V2.0.5-Source.zip`
- `SHA256SUMS.txt`

## 已知限制

- 当前版本未使用 Developer ID 签名且未进行 Apple 公证，首次启动存在 Gatekeeper 提示。
- x86_64 切片会完成构建与静态验证，但尚未在 Intel Mac 实机启动。
- 自动测试全部使用离线 Mock，没有执行真实或付费模型列表、文本优化、图片反推或生图请求。
- FHL Images、FHL Responses、APIMart 和 RunningHub 的可用性、额度、模型列表及限流由各自上游服务决定。

## 开源致谢

- 原项目：[RoseKhlifa/Image-Studio](https://github.com/RoseKhlifa/Image-Studio)
- 方汤圆修改版：[supart/fhl-image-studio](https://github.com/supart/fhl-image-studio)
