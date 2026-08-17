# FHL Studio Windows V2.0.4 开发交接

## 当前状态

- 开发目标：Windows 桌面版 `V2.0.4`。
- 正式基线：标签 `windows-v2.0.3-release`，提交 `814da3e64566cc2e7838378639a3c5e7b6e8b948`。
- 当前本地分支：`codex/windows-v2.0.4-development`；未推送、未创建 PR、未修改 GitHub Release。
- 活动版本：界面、Wails、桌面 Go、CLI、E2E、构建与发布链由 `product-version.json` 统一为 `V2.0.4`。
- 批次 6“自动尺寸锁状态所有权”已完成代码、自动化、三档 Codex 浏览器验收和记录；下一批迁移任务队列与任务生命周期。

## 开发边界

- 只修改当前 V2.0.4 源码；不得修改 V2.0.3 正式版、旧开发版、桌面版根说明或历史证据。
- 保留稳定 namespace `fhl-image-studio-desktop`、开发 namespace `fhl-image-studio-desktop-dev` 和 `migration.desktop-v2.0.3`。
- 不复制或提交 API Key、`*.local`、`config/webview`、用户图片、输出、日志、缓存、`node_modules`、EXE 或 ZIP。
- Photoshop 插件和 Android 是独立项目；未经单独授权，不调用真实或付费 API。

## 批次 6 结果

- `Workspace.editAutoAspectUserLocked` 成为图生图自动比例锁的权威状态；顶层同名字段只作为活动工作区兼容镜像。
- 手动尺寸修改将尺寸、工作区锁和活动镜像一次性原子提交；自动解锁、工作区切换和 bootstrap 恢复同步镜像。
- 提交流程直接读取活动工作区权威值，顶层旧镜像即使短暂不一致也不会重新覆盖用户手动尺寸。
- 新增 Store 行为回归，覆盖手动锁定、故意制造旧镜像、切换到未锁工作区并切回；既有提交源码守卫同步更新。
- 前端 Node `591/591`、UI `38/38`、TypeScript、Lint `0/60` 和 Windows 1,960 modules 构建通过。
- 版本漂移、`git diff --check`、桌面/CLI 精确 Go test+vet、Worker `5/5` 和当前源码快照合规扫描通过。
- Codex 浏览器 `1920x1080`、`1440x900`、`1024x768` 真实点击通过：模式、手动比例、工作区切换、设置/初始化取消、360 和空历史均正常；横向溢出及控制台 warning/error 为 0。
- 浏览器恢复 `1213x930`；当前单一“图片 1”、历史 0、文生图、活动 API“已配置”、14 个下拉项。没有确认初始化、切换 Profile、连接测试、提示词调用、导入或生成。
- 本轮 3 个可再生成的 `output/log/ui-audit` 文件已精确删除；未生成私有配置、用户图片、EXE 或 ZIP。

详细记录：`docs/changes/2026-08-17-windows-v2.0.4-edit-auto-aspect-lock-ownership.md`。

## 架构治理顺序

1. 设置默认值、持久化策略和设置操作（已完成）。
2. 工作区、历史、素材组及相关动作（已完成）。
3. 自动尺寸锁状态所有权（已完成）。
4. 任务队列和任务生命周期。
5. `host.ts` 文件/对话框、媒体、凭据/持久化、任务/Bridge 能力模块。
6. JS/Go 请求合约、Bridge watchdog、精确 CI/发布门禁。

保持 `useStudioStore` 和 `host.ts` 兼容门面，不更换状态框架，不做 Store 大重写；每批只迁移一个可独立验证的领域。

## 下一恢复点：批次 7

- 先确认批次 6 本地提交位于 HEAD 且工作树干净，阅读本文件、最新详细记录和外层 `..\..\项目日志.md`。
- 先把任务动作的源码字符串测试迁为行为测试，再迁移选择、取消、清理失败任务和队列提升等低副作用动作。
- 独立审查确认关闭工作区时解绑了 `progress/log/preview/result/error`，但漏掉 `settled:${jobId}`；迁移时先补六类事件统一解绑回归。
- 任务模块使用 Store/宿主依赖注入，保留现有动作签名、`BatchTaskRecord`、workspace session v1、浏览器任务映射、Wails 事件名和取消后晚终态保护。
- 连续池控制器、浏览器任务生命周期和原生 Wails 生命周期分成后续独立小批，不在同一提交拆 `host.ts`、Bridge 或发布链。
