# FHL Studio Windows V2.0.4 开发交接

## 当前状态

- 开发目标：Windows 桌面版 `V2.0.4`。
- 正式基线：标签 `windows-v2.0.3-release`，提交 `814da3e64566cc2e7838378639a3c5e7b6e8b948`。
- 当前本地分支：`codex/windows-v2.0.4-development`；未推送、未创建 PR、未修改 GitHub Release。
- 活动版本：界面、Wails、桌面 Go、CLI、E2E、构建与发布链由 `product-version.json` 统一为 `V2.0.4`。
- 批次 2“恢复默认但保留 API”已完成全部自动化、三档 Codex 浏览器验收、合规扫描和记录；下一批是设置性能与依赖边界。

## 开发边界

- 只修改当前 V2.0.4 源码；不得修改 V2.0.3 正式版、旧开发版、桌面版根说明或历史证据。
- 保留稳定 namespace `fhl-image-studio-desktop`、开发 namespace `fhl-image-studio-desktop-dev` 和 `migration.desktop-v2.0.3`。
- 不复制或提交 API Key、`*.local`、`config/webview`、用户图片、输出、日志、缓存、`node_modules`、EXE 或 ZIP。
- Photoshop 插件和 Android 是独立项目；未经单独授权，不调用真实或付费 API。

## 已完成验证

- 版本漂移：`V2.0.4 (windows-v2.0.4-release)`；`git diff --check` 通过。
- 前端：TypeScript、Node `586/586`、UI `31/31`、Windows 构建 1,959 modules 全部通过。
- Lint：`0` errors、`62` warnings，低于允许基线 `63`，本批零新增。
- 桌面端：精确 `go test . ./backend`、`go vet . ./backend` 通过；CLI `go test ./...`、`go vet ./...` 通过。受限环境下将 Go cache、`TEMP/TMP` 指向仓库忽略的 `.tmp` 后复跑成功。
- Worker：语法检查与 `5/5` 测试通过。
- 合规：仅包含跟踪/待提交源码的临时快照为 `0` issues，快照已删除；实际目录无私有配置、WebView 数据、用户图片、运行日志、EXE 或 ZIP。
- Codex 浏览器：`1920x1080`、`1440x900`、`1024x768` 均通过设置取消、文生图/图生图、360、历史空状态、弹窗边界与横向溢出检查，控制台 warning/error 为 0。
- `1024x768` 截图发现初始化按钮受全局 button reset 影响；补充组件级字号和内边距后，从三档流程起点重跑通过。
- 浏览器已恢复原始 `1213x930` 并重载；当前为单一空白工作区、历史 0、文生图模式、活动 API“已配置”、14 个下拉项。没有重新初始化、切换 Profile、连接测试、提示词调用或生成。
- 历史确认路径已验证 13 个 Profile 名称/顺序/活动项不变，12 个 FHL 配置仍“已配置”，APIMart Profile 仍“未配置”；没有读取或显示 Key。

## 架构治理顺序

1. 设置组件精确 selector、关闭时卸载、Profiler 测试和反向依赖基线。
2. 设置/持久化、工作区/历史、任务生命周期的独立模块化批次。
3. `host.ts` 内部能力拆分，同时保留兼容门面。
4. JS/Go 请求合约、Bridge watchdog、精确 CI/发布门禁。

不更换状态框架，不做 Store 大重写；每批只迁移一个可独立验证的领域。

## 下一恢复点：批次 3

- 先运行 `git status --short --branch` 并阅读 `docs/changes/2026-08-17-windows-v2.0.4-reset-preserving-api.md` 与外层 `..\..\项目日志.md`。
- 当前有 19 处整 Store 订阅；本批只收敛 `SettingsPanel`、`SettingsPresetsRow`、`SettingsPanelGate`，使用 `useShallow` 精确订阅并确保关闭时真正卸载。
- 增加 React Profiler 测试：无关 `jobsCompleted`/`canvasViewResetTick` 变化不提交，主题变化会更新，历史内容同长度替换不更新、数量变化更新，关闭不挂载且重开重置局部状态。
- 用 TypeScript Compiler API 锁定七条既有反向依赖：三个 state 文件到 `components/panel/sizeCapabilities`，`materialLibrary.ts` 到 `components/history/historyPromptGroups`，`studioStore.ts` 到 `app/dev/previewData`，两个 `studioStore.*` 文件到 `platform/android/bridge`。本批禁止新增，不迁移这七条。
- 每次代码修改后运行自动化并在 Codex 浏览器完成 `1920x1080`、`1440x900`、`1024x768` 真实点击；结束后恢复默认 viewport。不要再次点击“确认恢复默认”。
