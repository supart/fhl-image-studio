# FHL Studio Windows V2.0.4 开发交接

## 当前状态

- 开发目标：Windows 桌面版 `V2.0.4`。
- 正式基线：标签 `windows-v2.0.3-release`，提交 `814da3e64566cc2e7838378639a3c5e7b6e8b948`。
- 当前本地分支：`codex/windows-v2.0.4-development`；未推送、未创建 PR、未修改 GitHub Release。
- 活动版本：界面、Wails、桌面 Go、CLI、E2E、构建与发布链由 `product-version.json` 统一为 `V2.0.4`。
- 批次 7“任务动作模块化”已完成代码、自动化、三档 Codex 浏览器验收和记录；下一批迁移连续池队列控制器。

## 开发边界

- 只修改当前 V2.0.4 源码；不得修改 V2.0.3 正式版、旧开发版、桌面版根说明或历史证据。
- 保留稳定 namespace `fhl-image-studio-desktop`、开发 namespace `fhl-image-studio-desktop-dev` 和 `migration.desktop-v2.0.3`。
- 不复制或提交 API Key、`*.local`、`config/webview`、用户图片、输出、日志、缓存、`node_modules`、EXE 或 ZIP。
- Photoshop 插件和 Android 是独立项目；未经单独授权，不调用真实或付费 API。

## 批次 7 结果

- 新增 `studioStore.tasks.ts`，迁移任务选择、单项取消、批量取消排队项、清理失败项、队列插队和兼容取消入口；`useStudioStore` 保留原公共签名并做转发。
- 将 `taskRuntimePatchForWorkspace()` 从主 Store 迁为任务模块公共纯函数，现有启动和事件路径继续共用同一派生逻辑。
- 宿主取消、自动重试计时器、连续池启动集合、任务启动、队列 pump、FHL 容量保留和自动比例同步均通过运行时依赖注入；任务结构、workspace session v1 和 Bridge v1 不变。
- 行为测试先证明关闭工作区漏解绑 `settled:${jobId}`，再修复为六类原生事件统一解绑；取消继续先提交终态再调用宿主，并防止并发完成被旧取消快照覆盖。
- 原取消/清理/插队源码字符串断言改为 9 条模块行为测试，工作区新增 1 条解绑回归；前端 Node `591/591`、UI `48/48`、TypeScript、Lint `0/60` 和 Windows 1,961 modules 构建通过。
- 版本漂移、`git diff --check`、桌面/CLI 精确 Go test+vet、Worker `5/5` 和 668 文件源码快照合规扫描通过。
- Codex 浏览器 `1920x1080`、`1440x900`、`1024x768` 真实点击通过：模式、设置/初始化取消、360、工作区、空历史均正常；三档横向溢出和控制台 warning/error 为 0。
- 浏览器 viewport override 已 reset；当前单一“图片 1”、历史 0、文生图、活动 API“已配置”、14 个下拉项。没有确认初始化、切换 Profile、连接测试、提示词调用、导入或生成。
- 浏览器审计缓冲延迟写回后，第二次精确删除 3 个 `output/log/ui-audit` 文件并等待 12 秒复查为 0；临时合规快照也已删除，未生成私有配置、用户图片、EXE 或 ZIP。

详细记录：`docs/changes/2026-08-17-windows-v2.0.4-task-actions-module.md`。

## 架构治理顺序

1. 设置默认值、持久化策略和设置操作（已完成）。
2. 工作区、历史、素材组及相关动作（已完成）。
3. 自动尺寸锁状态所有权（已完成）。
4. 任务选择、取消、失败清理和队列插队动作（已完成）。
5. 连续池队列控制器。
6. 浏览器任务与原生 Wails 任务事件生命周期。
7. `host.ts` 文件/对话框、媒体、凭据/持久化、任务/Bridge 能力模块。
8. JS/Go 请求合约、Bridge watchdog、精确 CI/发布门禁。

保持 `useStudioStore` 和 `host.ts` 兼容门面，不更换状态框架，不做 Store 大重写；每批只迁移一个可独立验证的领域。

## 下一恢复点：批次 8

- 先确认批次 7 本地提交位于 HEAD 且工作树干净，阅读本文件、最新详细记录和外层 `..\..\项目日志.md`。
- 本批只迁移连续池队列的候选选择、启动占位和 pump 编排；先写并发容量、取消后等待 `settled` 释放、重复启动保护和跨工作区公平性的行为测试。
- 继续使用 Store/宿主依赖注入，并复用 `studioStore.tasks.ts`、`continuousPoolScheduler.ts`、`batchTaskRecords.ts` 和现有启动集合，不复制第二套队列状态。
- 保留现有 FHL 10 槽、每 API 并发、任务状态、Toast、Profile 选择和非敏感任务快照语义。
- 浏览器订阅、原生 Wails 事件生命周期、`host.ts`、Bridge 和发布链各自留在后续独立批次。
