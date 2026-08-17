# FHL Studio Windows V2.0.4 开发交接

## 当前状态

- 开发目标：Windows 桌面版 `V2.0.4`。
- 正式基线：标签 `windows-v2.0.3-release`，提交 `814da3e64566cc2e7838378639a3c5e7b6e8b948`。
- 当前本地分支：`codex/windows-v2.0.4-development`；未推送、未创建 PR、未修改 GitHub Release。
- 活动版本：界面、Wails、桌面 Go、CLI、E2E、构建与发布链由 `product-version.json` 统一为 `V2.0.4`。
- 批次 10“Runtime Host 能力模块”已完成代码、自动化、三档 Codex 浏览器验收和记录；下一批建立 JS/Go 请求合约夹具。

## 开发边界

- 只修改当前 V2.0.4 源码；不得修改 V2.0.3 正式版、旧开发版、桌面版根说明或历史证据。
- 保留稳定 namespace `fhl-image-studio-desktop`、开发 namespace `fhl-image-studio-desktop-dev` 和 `migration.desktop-v2.0.3`。
- 不复制或提交 API Key、`*.local`、`config/webview`、用户图片、输出、日志、缓存、`node_modules`、EXE 或 ZIP。
- Photoshop 插件和 Android 是独立项目；未经单独授权，不调用真实或付费 API。

## 批次 10 结果

- `host.ts` 缩为 62 行兼容门面，继续显式导出原有 52 个接口；生产调用方和测试 mock 保持现有 import。
- 新增 `hostContext.ts`、`hostTasks.ts`、`hostFiles.ts`、`hostMedia.ts`、`hostCredentials.ts`，依赖保持 `Tasks -> Media -> Context`、`Files -> Credentials/Media -> Context`，无能力模块反向依赖门面。
- 新增 4 条 TypeScript AST 门禁，锁定门面导出、纯重导出、无反向依赖和无环依赖边；相关旧源码位置断言更新到能力所有者，现有 runtime 行为回归保持通过。
- 前端 Node `595/595`、UI `64/64`、TypeScript、Lint `0/58` 和 Windows 1,968 modules 构建通过；本批减少 1 条控制字符正则 warning。
- 版本漂移、`git diff --check`、桌面/CLI 精确 Go test+vet、Worker `5/5` 和 681 文件源码快照合规扫描通过。
- Codex 浏览器 `1920x1080`、`1440x900`、`1024x768` 真实点击通过：模式、设置/初始化取消、360、工作区、空历史和布局均正常；三档横向越界及可见控件截断为 0，控制台 warning/error 为 0。
- viewport override 已 reset 并恢复原始 `1440x900`；当前单一“图片 1”、历史 0、文生图、活动 API“已配置”、14 个下拉项。未确认初始化、切换 Profile、连接测试、提示词调用、导入或生成。
- 3 个 `output/log/ui-audit` 文件首次删除后发生一次延迟落盘；停止浏览器操作后按同一清单二次删除并等待 15 秒，目录保持不存在。临时合规快照也已删除，未生成私有配置、用户图片、EXE 或 ZIP。

详细记录：`docs/changes/2026-08-17-windows-v2.0.4-runtime-host-capability-modules.md`。

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

## 下一恢复点：批次 11

- 先确认批次 10 提交位于 HEAD 且工作树干净，阅读本文件、最新详细记录和外层 `..\..\项目日志.md`。
- 本批只建立 Responses、Images、APIMart、RunningHub 的前后端请求合约夹具，先盘点 JS/Go 字段、默认值和兼容分支，再用共享 fixture 锁定序列化。
- 保持 `host.ts` 兼容门面、CLI 命令、Bridge v1、存储和现有请求语义不变，不同时实现 watchdog 或 CI 改造。
- 专业 agent 在批次 10 发现 browser 远程任务未统一发出 `settled`；该行为变更登记到后续 Bridge/任务终态批次，不在请求合约批次顺带修改。
