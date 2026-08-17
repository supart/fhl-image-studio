# FHL Studio Windows V2.0.4 开发交接

## 当前状态

- 开发目标：Windows 桌面版 `V2.0.4`。
- 正式基线：标签 `windows-v2.0.3-release`，提交 `814da3e64566cc2e7838378639a3c5e7b6e8b948`。
- 当前本地分支：`codex/windows-v2.0.4-development`；未推送、未创建 PR、未修改 GitHub Release。
- 活动版本：界面、Wails、桌面 Go、CLI、E2E、构建与发布链由 `product-version.json` 统一为 `V2.0.4`。
- 批次 9“任务事件生命周期”已完成代码、自动化、三档 Codex 浏览器验收和记录；下一批拆分 `host.ts` 能力模块。

## 开发边界

- 只修改当前 V2.0.4 源码；不得修改 V2.0.3 正式版、旧开发版、桌面版根说明或历史证据。
- 保留稳定 namespace `fhl-image-studio-desktop`、开发 namespace `fhl-image-studio-desktop-dev` 和 `migration.desktop-v2.0.3`。
- 不复制或提交 API Key、`*.local`、`config/webview`、用户图片、输出、日志、缓存、`node_modules`、EXE 或 ZIP。
- Photoshop 插件和 Android 是独立项目；未经单独授权，不调用真实或付费 API。

## 批次 9 结果

- 新增 `studioStore.browserTaskLifecycle.ts`，统一 browser workspace SSE、Android job 订阅、refresh 单飞/待处理 job 和 reset generation；事件按 workspace 与 job 身份隔离。
- `desktopJobEvents.ts` 扩展为原生六 handler 生命周期注册表，统一顺序门禁、首个终态、低序号 settled、幂等解绑、元数据释放和 reset 清理。
- 关闭工作区会删除对应 job group 缓存并同步解绑；浏览器历史和原生结果异步链增加 reset epoch、工作区/任务存在性门禁，全景贴回在异步边界重复检查。
- 新增 10 条生命周期/Store 行为回归；前端 Node `591/591`、UI `64/64`、TypeScript、Lint `0/59` 和 Windows 1,963 modules 构建通过。
- 版本漂移、`git diff --check`、桌面/CLI 精确 Go test+vet、Worker `5/5` 和 674 文件源码快照合规扫描通过。
- Codex 浏览器 `1920x1080`、`1440x900`、`1024x768` 真实点击通过：模式、设置/初始化取消、360、工作区、空历史和布局均正常；三档无横向溢出，`1024x768` 无可见控件文本截断，控制台 warning/error 为 0。
- viewport override 已 reset；当前单一“图片 1”、历史 0、文生图、活动 API“已配置”、14 个下拉项。未确认初始化、切换 Profile、连接测试、提示词调用、导入或生成。
- 3 个 `output/log/ui-audit` 文件已精确删除并等待 12 秒复查，目录保持不存在；临时合规快照也已删除，未生成私有配置、用户图片、EXE 或 ZIP。

详细记录：`docs/changes/2026-08-17-windows-v2.0.4-task-event-lifecycle.md`。

## 架构治理顺序

1. 设置默认值、持久化策略和设置操作（已完成）。
2. 工作区、历史、素材组及相关动作（已完成）。
3. 自动尺寸锁状态所有权（已完成）。
4. 任务选择、取消、失败清理和队列插队动作（已完成）。
5. 连续池队列控制器（已完成）。
6. 浏览器任务与原生 Wails 任务事件生命周期（已完成）。
7. `host.ts` 文件/对话框、媒体、凭据/持久化、任务/Bridge 能力模块。
8. JS/Go 请求合约、Bridge watchdog、精确 CI/发布门禁。

保持 `useStudioStore` 和 `host.ts` 兼容门面，不更换状态框架，不做 Store 大重写；每批只迁移一个可独立验证的领域。

## 下一恢复点：批次 10

- 先确认批次 9 提交位于 HEAD 且工作树干净，阅读本文件、最新详细记录和外层 `..\..\项目日志.md`。
- 本批只拆分 `host.ts` 的文件/对话框、媒体、凭据/持久化和任务/Bridge 能力模块；先锁定现有导出、宿主 fallback 和测试替身合约。
- 原 `host.ts` 继续作为兼容门面，不改变 Wails/浏览器/Android 调用行为，不迁移 Store 状态。
- JS/Go 请求合约、Bridge watchdog、CI 和发布链继续保留为后续独立批次。
