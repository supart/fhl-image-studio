# FHL Image Studio macOS V2.0.5.1

这是基于 [RoseKhlifa/Image-Studio](https://github.com/RoseKhlifa/Image-Studio) 的独立修改发行版，不是上游官方版本。本版只升级 macOS 桌面端模型选择兼容性，不修改 Android、Photoshop 插件、独立 Bridge 或 Windows 发布分支。

## 本次更新

- FHL Images 模型拉取不再依赖客户端固定白名单。上游 `/v1/models` 返回的所有非空模型 ID 都会进入紧凑下拉框，可直接选择并保存。
- `gpt-image-2`、`gpt-image-2.5-*`、`gpt-image-2.6-*` 以及未来同系列模型按动态前缀规则高亮显示；其他模型保持灰色说明，但仍然可以点击选择。
- 保留 10 个 FHL Images 槽共享全局模型选择、旧配置迁移和未知模型不静默覆盖的行为。
- 输出背景选择永久显示：精确 `gpt-image-2` 保持普通图像并禁用透明选项；所有带版本号或后缀的 `gpt-image-2.x` / `gpt-image-2-*` 模型（包括 2.5、2.6 及未来 2.x）都可选择透明 PNG。其他灰色模型仍可选择普通图像，但透明控件禁用。
- 透明请求继续固定 `output_format=png`，并由 Images/Responses 请求链路发送透明参数；切换到不支持透明的模型会自动恢复普通图像。
- macOS 版本同步到 V2.0.5.1，继续使用 Universal `arm64 + x86_64`、macOS 13+、ad-hoc 签名和 hardened runtime。

## 安装与升级

1. 下载 `FHL-Image-Studio-Desktop-V2.0.5.1-macOS-Universal.dmg` 和 `SHA256SUMS.txt`，校验文件完整性。
2. 打开 DMG，将 `FHL Studio.app` 拖入 `Applications`，已有旧版时选择“替换”。
3. 本版不包含 API Key、Keychain 数据、用户图片、历史、日志或 WebKit 数据。升级会继续读取当前 macOS 账户已有的本地配置和凭据；新账户仍从默认未配置状态开始。
4. 本版使用 ad-hoc 签名，未进行 Developer ID 签名和 Apple 公证。首次启动请在 Finder 中右键应用并选择“打开”。

## Release 资产

- `FHL-Image-Studio-Desktop-V2.0.5.1-macOS-Universal.dmg`
- `FHL-Image-Studio-Desktop-V2.0.5.1-Source.zip`
- `SHA256SUMS.txt`

## 已知限制

- x86_64 切片完成构建与静态验证，但尚未在 Intel Mac 实机启动。
- Gatekeeper 对 ad-hoc 未公证包的拒绝属于预期分发限制，不代表 bundle 或签名结构失败。
- 上游模型的实际能力、额度和限流由 FHL 服务决定；模型列表显示不等于上游已开放全部功能参数。

## 开源致谢

- 原项目：[RoseKhlifa/Image-Studio](https://github.com/RoseKhlifa/Image-Studio)
- 方汤圆修改版：[supart/fhl-image-studio](https://github.com/supart/fhl-image-studio)
