# FHL Studio V2.0.3 for macOS

## 系统要求

- macOS 13 或更高版本
- Apple Silicon（arm64）
- 当前版本未提供 Intel 构建，也未进行 Apple 公证

## 安装

1. 打开 DMG，将 `FHL Studio.app` 拖入 `Applications`。
2. 当前版本使用 ad-hoc 签名，首次运行请在 Finder 中右键应用并选择“打开”。
3. 在应用内配置并测试自己的 FHL、APIMart 或 RunningHub 上游。

如果直接双击被 Gatekeeper 阻止，请不要修改应用包内容；回到 Finder 使用右键“打开”完成首次授权。

## 数据位置

- 图片：`~/Pictures/FHL Studio`
- 配置：`~/Library/Application Support/fhl-studio`
- 日志：`~/Library/Logs/FHL Studio`
- API 凭据：macOS Keychain

发布包不包含 API Key、用户图片、历史记录、日志或本机设置。

## 图像反推

V2.0.3 已修复导入 AVIF 预览时的 hardened-runtime 崩溃。最终 App 和 DMG 均会检查签名权限，签名后的 AVIF 回归测试及一次真实 FHL `gpt-5.5` 图片反推已通过。

## Codex Skill

需要 Codex 调用本地 CLI 时，双击 `安装CodexSkill.command`。安装脚本只复制 CLI、Skill 和包路径，不复制或显示 API Key。

## 开源

与本 DMG 完全对应的源码位于同一 GitHub Release 的 `FHL-Image-Studio-Desktop-V2.0.3-Source.zip`。
