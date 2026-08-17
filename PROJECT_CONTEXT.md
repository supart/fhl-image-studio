# FHL Studio Windows V2.0.4 开发交接

## 当前状态

- 开发目标：Windows 桌面版 `V2.0.4`。
- 正式基线：标签 `windows-v2.0.3-release`，提交 `814da3e64566cc2e7838378639a3c5e7b6e8b948`。
- 当前本地分支：`codex/windows-v2.0.4-development`；未推送、未创建 PR、未修改 GitHub Release。
- 活动版本：界面、Wails、桌面 Go、CLI、E2E、构建与发布链由 `product-version.json` 统一为 `V2.0.4`。
- 批次 12“Photoshop Bridge 远程任务终态加固”已完成代码、自动化和三档 Codex 浏览器验收；下一批处理精确 CI/发布门禁。

## 开发边界

- 只修改当前 V2.0.4 源码；不得修改 V2.0.3 正式版、旧开发版、桌面版根说明或历史证据。
- 保留稳定 namespace `fhl-image-studio-desktop`、开发 namespace `fhl-image-studio-desktop-dev` 和 `migration.desktop-v2.0.3`。
- 不复制或提交 API Key、`*.local`、`config/webview`、用户图片、输出、日志、缓存、`node_modules`、EXE 或 ZIP。
- Photoshop 插件和 Android 是独立项目；未经单独授权，不调用真实或付费 API。

## 批次 12 结果

- APIMart/RunningHub desktop executor 增加锁内远程终态 claim；Complete、Fail、Cancel 和 watchdog 只有第一个调用方能落终态，重复或迟到回调幂等。
- Complete 在保存图片前 claim，避免并发重复写结果、缩略图和媒体记录；公开 Bridge v1 方法、路径、字段及 `succeeded/failed/cancelled` 状态保持不变。
- 增加 2 小时后端 watchdog；前端失联后统一失败、清理临时输入、发送一次 remote cancel 并释放单任务槽，正常终态和 ClearProfile 均会停表。
- 浏览器远程任务统一发送一次 `settled`，成功、失败和取消的事件顺序由 Node 行为测试锁定。
- 前端 Node `596/596`、UI `64/64`、TypeScript、Lint `0/58` 和 Windows 1,968 modules 构建通过；桌面/CLI Go test+vet、Worker `5/5`、版本漂移、格式和源码合规扫描通过。
- Windows 环境因 CGO 未启用不能执行 Go `-race`；16 路并发终态 claim 测试、锁内状态转换和完整 Go test/vet 均通过。
- Codex 浏览器三档真实点击通过，横向越界、控件截断和控制台 warning/error 为 0；已恢复原始 `1239x930`，单一空白工作区、历史 0、活动 API“已配置”和 14 个 Profile 不变。
- 未确认初始化、切换 Profile、连接测试、提示词调用、导入或生成；3 个延迟 UI 审计文件已精确移入回收站并等待复查未重建，未生成私有配置、用户图片、EXE 或 ZIP。

详细记录：`docs/changes/2026-08-17-windows-v2.0.4-ps-bridge-remote-terminal-watchdog.md`。

## 架构治理顺序

1. 设置默认值、持久化策略和设置操作（已完成）。
2. 工作区、历史、素材组及相关动作（已完成）。
3. 自动尺寸锁状态所有权（已完成）。
4. 任务选择、取消、失败清理和队列插队动作（已完成）。
5. 连续池队列控制器（已完成）。
6. 浏览器任务与原生 Wails 任务事件生命周期（已完成）。
7. `host.ts` 文件/对话框、媒体、凭据/持久化、任务/Bridge 能力模块（已完成）。
8. JS/Go 请求合约与 Bridge watchdog（已完成）；精确 CI/发布门禁待完成。

保持 `useStudioStore` 和 `host.ts` 兼容门面，不更换状态框架，不做 Store 大重写；每批只迁移一个可独立验证的领域。

## 下一恢复点：批次 13

- 先确认批次 12 提交位于 HEAD 且工作树干净，阅读本文件、最新详细记录和外层 `..\..\项目日志.md`。
- 本批只精确限定 CI 的 Go test/vet 包范围，并把版本漂移检查设为构建和发布脚本前置门禁；不继续修改 Bridge 状态机。
- 保持 CLI 命令、Bridge v1、请求 schema v2、序列化和存储兼容；不生成正式 EXE/ZIP、标签或 Release。
- 发布链改变先补离线脚本行为测试，再执行自动化、Codex 浏览器三档回归、三处记录和独立本地提交。
