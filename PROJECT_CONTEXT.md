# FHL Studio Windows V2.0.4 开发交接

## 当前状态

- 开发目标：Windows 桌面版 `V2.0.4`。
- 正式基线：标签 `windows-v2.0.3-release`，提交 `814da3e64566cc2e7838378639a3c5e7b6e8b948`。
- 当前本地分支：`codex/windows-v2.0.4-development`；未推送、未创建 PR、未修改 GitHub Release。
- 活动版本：界面、Wails、桌面 Go、CLI、E2E、构建与发布链由 `product-version.json` 统一为 `V2.0.4`。
- 批次 5“工作区、历史与素材模块化”已完成代码、自动化、三档 Codex 浏览器验收、合规扫描和记录；下一小批先收敛自动尺寸锁状态，再迁移任务队列与生命周期。

## 开发边界

- 只修改当前 V2.0.4 源码；不得修改 V2.0.3 正式版、旧开发版、桌面版根说明或历史证据。
- 保留稳定 namespace `fhl-image-studio-desktop`、开发 namespace `fhl-image-studio-desktop-dev` 和 `migration.desktop-v2.0.3`。
- 不复制或提交 API Key、`*.local`、`config/webview`、用户图片、输出、日志、缓存、`node_modules`、EXE 或 ZIP。
- Photoshop 插件和 Android 是独立项目；未经单独授权，不调用真实或付费 API。

## 批次 5 结果

- 工作区新建/切换/关闭统一使用选择补丁；取消、事件解绑和快照通过运行时依赖注入，模块不再直接依赖 Wails host。
- 新增 `studioStore.materials.ts`，承接素材组与参考图组动作及 output 同步；历史分页和预览水合归入 `studioStore.media.ts`。
- `studioStore.ts` 保留 `useStudioStore` 兼容入口，相关动作退化为领域转发；namespace、存储键、API/Profile、迁移标记和序列化格式不变。
- 修复素材组启动时误删历史引用，以及历史分页旧快照覆盖新结果/旧排序响应写回两个既有缺陷。
- 新增 4 条行为回归；Node `591/591`、UI `37/37`、TypeScript、Lint `0/60` 和 Windows 1,960 modules 构建全部通过。
- 版本漂移、`git diff --check`、桌面/CLI 精确 Go test+vet、Worker `5/5` 和当前源码合规扫描全部通过。
- Codex 浏览器 `1920x1080`、`1440x900`、`1024x768` 真实点击通过：设置取消、初始化取消、模式切换、360、工作区新建/关闭、历史空状态和弹窗边界均正常；横向溢出和控制台 warning/error 均为 0。
- 浏览器已恢复 `1213x930`；当前单一“图片 1”、历史 0、文生图、活动 API“已配置”、14 个下拉项。没有确认初始化、切换 Profile、连接测试、提示词调用、导入或生成。
- 精确删除本轮 3 个 UI 审计日志；实际目录无私有配置、WebView 数据、用户运行图片、日志、EXE 或 ZIP。

详细记录：`docs/changes/2026-08-17-windows-v2.0.4-workspace-history-material-modules.md`。

## 架构治理顺序

1. 设置默认值、持久化策略和设置操作（已完成）。
2. 工作区、历史、素材组及相关动作（已完成）。
3. 自动尺寸锁状态所有权、任务队列和任务生命周期。
4. `host.ts` 文件/对话框、媒体、凭据/持久化、任务/Bridge 能力模块。
5. JS/Go 请求合约、Bridge watchdog、精确 CI/发布门禁。

保持 `useStudioStore` 和 `host.ts` 兼容门面，不更换状态框架，不做 Store 大重写；每批只迁移一个可独立验证的领域。

## 下一恢复点：批次 6

- 先确认批次 5 本地提交位于 HEAD 且工作树干净，阅读本文件、最新详细记录和外层 `..\..\项目日志.md`。
- `editAutoAspectUserLocked` 当前同时存在顶层与工作区两份来源：`setParam(size)` 和 `setSharedEditAutoAspectLock` 主要写工作区，提交逻辑读取顶层；先补双向同步行为测试，再选择单一所有权或明确同步边界。
- 自动尺寸锁闭合后，只迁移任务队列和任务生命周期；复用 `batchTaskRecords`、continuous runtime、browser job runtime 和现有 epoch/single-flight，不改命令、Bridge v1 或序列化格式。
- 不在同一批拆 `host.ts`、修改后端 Bridge 或发布链；每个小段从自动化与 Codex 浏览器三档流程起点重新验收。
