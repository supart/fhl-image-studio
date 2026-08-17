# FHL Studio Windows V2.0.4 开发交接

## 当前状态

- 开发目标：Windows 桌面版 `V2.0.4`。
- 正式基线：标签 `windows-v2.0.3-release`，提交 `814da3e64566cc2e7838378639a3c5e7b6e8b948`。
- 当前本地分支：`codex/windows-v2.0.4-development`；未推送、未创建 PR、未修改 GitHub Release。
- 活动版本：界面、Wails、桌面 Go、CLI、E2E、构建与发布链由 `product-version.json` 统一为 `V2.0.4`。
- 批次 4“设置默认值与持久化模块化”已完成代码、自动化、三档 Codex 浏览器验收、合规扫描和记录；下一批是工作区、历史、素材组及相关动作模块化。

## 开发边界

- 只修改当前 V2.0.4 源码；不得修改 V2.0.3 正式版、旧开发版、桌面版根说明或历史证据。
- 保留稳定 namespace `fhl-image-studio-desktop`、开发 namespace `fhl-image-studio-desktop-dev` 和 `migration.desktop-v2.0.3`。
- 不复制或提交 API Key、`*.local`、`config/webview`、用户图片、输出、日志、缓存、`node_modules`、EXE 或 ZIP。
- Photoshop 插件和 Android 是独立项目；未经单独授权，不调用真实或付费 API。

## 批次 4 结果

- 新增 `studioStore.settings.ts`，集中六项普通设置的默认值、原有存储键、读取校验、持久化和运行时应用；运行时副作用通过依赖注入保持策略模块纯净。
- `studioStore.ts` 的初始状态、普通/E2E/预览 bootstrap、设置 actions 与应用初始化统一复用设置策略；`applicationStateReset.ts` 不再维护第二套默认值。
- 删除已合并的 `lib/proxy.ts`；`useStudioStore` 公共入口、namespace、迁移标记、API/Profile/凭据和序列化格式不变。
- 新增 3 条行为测试；Node `590/590`、UI `34/34`、TypeScript、Lint `0/62` 和 Windows 1,959 modules 构建全部通过。
- 版本漂移、`git diff --check`、桌面/CLI 精确 Go test+vet、Worker `5/5` 和干净源码合规扫描全部通过。
- Codex 浏览器先验证深色、115% 字号和无代理能跨重载持久化，再恢复系统主题、100% 字号和系统代理并重载确认。
- `1920x1080`、`1440x900`、`1024x768` 真实点击通过：设置取消、文生图/图生图、360、历史空状态、弹窗边界和横向溢出均正常；控制台 warning/error 为 0。
- 浏览器已恢复验收前 `1213x930`；当前历史 0、文生图模式、活动 API“已配置”、14 个下拉项。没有确认初始化、切换 Profile、连接测试、提示词调用或生成。
- 精确清理上轮遗留的 2 张临时导入图和 3 个 UI 审计日志；浏览器截图与合规快照也已删除，实际目录无私有配置、WebView 数据、用户运行图片、日志、EXE 或 ZIP。

详细记录：`docs/changes/2026-08-17-windows-v2.0.4-settings-persistence-module.md`。

## 架构治理顺序

1. 设置默认值、持久化策略和设置操作。
2. 工作区、历史、素材组及相关动作。
3. 任务队列和任务生命周期。
4. `host.ts` 文件/对话框、媒体、凭据/持久化、任务/Bridge 能力模块。
5. JS/Go 请求合约、Bridge watchdog、精确 CI/发布门禁。

保持 `useStudioStore` 和 `host.ts` 兼容门面，不更换状态框架，不做 Store 大重写；每批只迁移一个可独立验证的领域。

## 下一恢复点：批次 5

- 先运行 `git status --short --branch` 并阅读本文件、最新详细记录和外层 `..\..\项目日志.md`；确认批次 4 提交在 HEAD 且工作树干净。
- 只梳理和迁移工作区、历史、素材组及相关 actions；优先复用 `studioStore.workspaces.ts`、`studioStore.media.ts`、`workspaceDefaults.ts` 和现有 runtime helper。
- 保持 `useStudioStore` 导出、存储键、namespace、V2.0.3 迁移标记、API/凭据保留行为及序列化格式不变。
- 不在本批迁移任务队列、任务生命周期或 `host.ts`，也不处理七条反向依赖基线。
- 修改后从自动化和 Codex 浏览器三档桌面流程起点验收；不要点击“确认恢复默认”或任何真实 API 路径。
