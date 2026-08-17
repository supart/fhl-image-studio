# FHL Studio Windows V2.0.4 开发交接

## 当前状态

- 开发目标：Windows 桌面版 `V2.0.4`。
- 正式基线：标签 `windows-v2.0.3-release`，提交 `814da3e64566cc2e7838378639a3c5e7b6e8b948`。
- 当前本地分支：`codex/windows-v2.0.4-development`；未推送、未创建 PR、未修改 GitHub Release。
- 活动版本：界面、Wails、桌面 Go、CLI、E2E、构建与发布链由 `product-version.json` 统一为 `V2.0.4`。
- 批次 8“连续池队列控制器”已完成代码、自动化、三档 Codex 浏览器验收和记录；下一批迁移浏览器任务与原生 Wails 任务事件生命周期。

## 开发边界

- 只修改当前 V2.0.4 源码；不得修改 V2.0.3 正式版、旧开发版、桌面版根说明或历史证据。
- 保留稳定 namespace `fhl-image-studio-desktop`、开发 namespace `fhl-image-studio-desktop-dev` 和 `migration.desktop-v2.0.3`。
- 不复制或提交 API Key、`*.local`、`config/webview`、用户图片、输出、日志、缓存、`node_modules`、EXE 或 ZIP。
- Photoshop 插件和 Android 是独立项目；未经单独授权，不调用真实或付费 API。

## 批次 8 结果

- 新增 `studioStore.continuousPool.ts`，迁移候选过滤、跨工作区公平顺序、启动占位、Profile/工作区游标、in-flight 计数、pump 单飞和 reset 世代隔离；主 Store 保留现有队列与传输入口。
- 候选只来自活动工作区引用；工作区内保持创建顺序，工作区之间逐个轮转。已分配任务继续绑定原 Profile，未分配任务继续按 API 槽 round-robin，容量仍计入 starting/submitting/running 和等待 `settled` 的取消任务元数据。
- reset 会清空启动占位与两个游标，并用 generation 隔离尚未结束的旧 pass；重置后的新请求不会合并进旧 Promise 或丢失唤醒。
- 新增 6 条控制器行为测试、1 条原生失败可见测试和 1 条已分配 Profile 稳定性测试；前端 Node `591/591`、UI `55/55`、TypeScript、Lint `0/60` 和 Windows 1,962 modules 构建通过。
- 第一次 Windows 构建捕获 pump Promise 清理的初始化顺序错误；修正后重新执行 TypeScript、定向测试、Windows 构建和最终全量前端回归均通过。
- 版本漂移、`git diff --check`、桌面/CLI 精确 Go test+vet、Worker `5/5` 和 670 文件源码快照合规扫描通过。
- Codex 浏览器 `1920x1080`、`1440x900`、`1024x768` 真实点击通过：模式、设置/初始化取消、360、工作区、空历史均正常；三档页面宽度与视口一致，越界按钮和控制台 warning/error 为 0。
- 浏览器 viewport override 已 reset；当前单一“图片 1”、历史 0、文生图、活动 API“已配置”、14 个下拉项。30 次审计点击无错误上下文，未确认初始化、切换 Profile、连接测试、提示词调用、导入或生成。
- 3 个 `output/log/ui-audit` 文件已精确删除并等待两轮延迟复查，目录保持不存在；临时合规快照也已删除，未生成私有配置、用户图片、EXE 或 ZIP。

详细记录：`docs/changes/2026-08-17-windows-v2.0.4-continuous-pool-controller.md`。

## 架构治理顺序

1. 设置默认值、持久化策略和设置操作（已完成）。
2. 工作区、历史、素材组及相关动作（已完成）。
3. 自动尺寸锁状态所有权（已完成）。
4. 任务选择、取消、失败清理和队列插队动作（已完成）。
5. 连续池队列控制器（已完成）。
6. 浏览器任务与原生 Wails 任务事件生命周期。
7. `host.ts` 文件/对话框、媒体、凭据/持久化、任务/Bridge 能力模块。
8. JS/Go 请求合约、Bridge watchdog、精确 CI/发布门禁。

保持 `useStudioStore` 和 `host.ts` 兼容门面，不更换状态框架，不做 Store 大重写；每批只迁移一个可独立验证的领域。

## 下一恢复点：批次 9

- 先确认批次 8 提交位于 HEAD 且工作树干净，阅读本文件、最新详细记录和外层 `..\..\项目日志.md`。
- 本批只迁移浏览器任务订阅、工作区 SSE 订阅和原生 Wails 任务事件生命周期；先写迟到事件、解绑、重复终态和跨工作区隔离行为测试。
- 复用 `desktopJobEvents.ts`、`browserJobs.ts`、`studioStore.tasks.ts` 和连续池控制器；不得创建第二套任务状态或修改 Bridge v1。
- `launchOneJob`、`host.ts`、请求合约、Bridge watchdog 和发布链继续保留为后续独立批次。
