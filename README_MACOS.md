# FHL Studio V2.0.3.1 for macOS

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

发布包使用默认设置，不包含 API Key、用户图片、历史记录、日志或本机设置。

## V2.0.3.1 补丁

- 修复一键配置 FHL Images 后，主界面仍显示“未配置”、需要再次进入配置验证的问题。
- API Key 输入框现在支持 macOS 原生右键菜单，可直接粘贴已经复制的 Key。
- 保留 V2.0.3 的 AVIF 图片反推崩溃修复及全部 macOS 功能。

## 图像反推

V2.0.3.1 包含 V2.0.3 的 AVIF hardened-runtime 崩溃修复。最终 App 和 DMG 均会检查签名权限。

## Codex Skill

需要 Codex 调用本地 CLI 时，双击 `安装CodexSkill.command`。安装脚本只复制 CLI、Skill 和包路径，不复制或显示 API Key。

## 开源

与本 DMG 完全对应的源码位于同一 GitHub Release 的 `FHL-Image-Studio-Desktop-V2.0.3.1-Source.zip`。
