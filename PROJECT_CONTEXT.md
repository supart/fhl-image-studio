# FHL Studio Windows V2.0.4 开发交接

## 当前状态

- 开发目标：Windows 桌面版 `V2.0.4`。
- 正式基线：标签 `windows-v2.0.3-release`，提交 `814da3e64566cc2e7838378639a3c5e7b6e8b948`。
- 当前本地分支：`codex/windows-v2.0.4-development`；未推送、未创建 PR、未修改 GitHub Release。
- 活动版本：界面、Wails、桌面 Go、CLI、E2E、构建与发布链由 `product-version.json` 统一为 `V2.0.4`。
- 批次 11“跨运行时请求合约”已完成代码、自动化、三档 Codex 浏览器验收和记录；下一批加固 Photoshop Bridge 远程任务终态。

## 开发边界

- 只修改当前 V2.0.4 源码；不得修改 V2.0.3 正式版、旧开发版、桌面版根说明或历史证据。
- 保留稳定 namespace `fhl-image-studio-desktop`、开发 namespace `fhl-image-studio-desktop-dev` 和 `migration.desktop-v2.0.3`。
- 不复制或提交 API Key、`*.local`、`config/webview`、用户图片、输出、日志、缓存、`node_modules`、EXE 或 ZIP。
- Photoshop 插件和 Android 是独立项目；未经单独授权，不调用真实或付费 API。

## 批次 11 结果

- `shared/kernel/testdata/generation-request-contracts.json` 升级为 schema v2，8 个离线用例覆盖 Responses openai/compat、Images streaming/New API、APIMart generate/edit 和 RunningHub text/edit。
- 前端与 Go 生产提交复用同一批 provider payload builder；夹具同时验证最终 URL、JSON body type 和完整 body，Worker Responses 也比较 Content-Type/URL/body。
- 修复 CLI/Worker 对尾部 `/v1` 的重复拼接、APIMart/RunningHub 自定义像素尺寸分辨率漂移、Go 比例选择不确定，以及 Worker 将 RunningHub 错误代理为 Responses。
- `partialImages=0` 的前端“关闭预览”和 CLI“使用默认”语义保持现状；本批没有在缺少显式未指定状态时强行改变接口。
- 前端 Node `595/595`、UI `64/64`、TypeScript、Lint `0/58` 和 Windows 1,968 modules 构建通过；本批触及文件零 warning。
- 版本漂移、gofmt、`git diff --check`、桌面/CLI 精确 Go test+vet、Worker `5/5` 和 682 文件源码快照合规扫描通过。
- Codex 浏览器 `1920x1080`、`1440x900`、`1024x768` 真实点击通过：模式、设置/初始化取消、360、工作区、空历史和布局均正常；三档横向溢出、越界控件及文本截断为 0，控制台 warning/error 为 0。
- viewport override 已 reset 并恢复原始 `1239x930`；当前单一“图片 1”、历史 0、文生图、活动 API“已配置”、14 个下拉项。未确认初始化、切换 Profile、连接测试、提示词调用、导入或生成。
- 3 个 `output/log/ui-audit` 文件已按精确路径删除；停止浏览器操作后目录保持不存在。临时合规快照也已删除，未生成私有配置、用户图片、EXE 或 ZIP。

详细记录：`docs/changes/2026-08-17-windows-v2.0.4-shared-request-contracts.md`。

## 架构治理顺序

1. 设置默认值、持久化策略和设置操作（已完成）。
2. 工作区、历史、素材组及相关动作（已完成）。
3. 自动尺寸锁状态所有权（已完成）。
4. 任务选择、取消、失败清理和队列插队动作（已完成）。
5. 连续池队列控制器（已完成）。
6. 浏览器任务与原生 Wails 任务事件生命周期（已完成）。
7. `host.ts` 文件/对话框、媒体、凭据/持久化、任务/Bridge 能力模块（已完成）。
8. JS/Go 请求合约、Bridge watchdog、精确 CI/发布门禁。

保持 `useStudioStore` 和 `host.ts` 兼容门面，不更换状态框架，不做 Store 大重写；每批只迁移一个可独立验证的领域。

## 下一恢复点：批次 12

- 先确认批次 11 提交位于 HEAD 且工作树干净，阅读本文件、最新详细记录和外层 `..\..\项目日志.md`。
- 本批只为 Photoshop Bridge 远程前端任务增加后端 watchdog、统一终态和重复完成保护，并处理已登记的 browser 远程任务 `settled` 合同。
- 保持 `host.ts` 兼容门面、CLI 命令、Bridge v1、请求 schema v2、序列化和存储兼容，不同时改造 CI 或发布链。
- CI 精确 Go 包范围与版本前置门禁继续作为后续独立批次；任何 Bridge 行为变化必须先有离线生命周期测试，再做 Codex 浏览器三档回归。
