# FHL Studio Windows V2.0.3 发布交接记录

## 当前状态

- 发布基线：`FHL-Image-Studio-V2.0.3-正式发布审核版-20260729`。
- 源码基线：2026-07-29 已完成跨电脑测试的 V2.0.3 预发布包。
- 运行产物策略：已测试的 Portable EXE 和 ZIP 必须按字节保留，本审核批次不重新构建或替换。
- GitHub 目标：Windows 专用分支 `release/windows-v2.0.3` 与标签 `windows-v2.0.3`；该分支基于已验证的正式审核源码，而非日常开发树。
- Photoshop 策略：独立销售的插件不属于本仓库、源码归档或 Release 附件；仓库仅保留 Bridge 兼容代码和文档。

## 当前批次

- 让 GitHub CI 和 Release 工具链与已验证的开发工具链保持一致。
- 更新 V2.0.3 发布说明和验收文档。
- 在不发起真实或付费生图请求的前提下，执行前端、Go、Worker、合规、凭据、私有路径和归档完整性验证。
- 生成与源代码完全对应的 Windows 源码 ZIP、Portable ZIP 校验文件及中文 Release 正文，供 GitHub 发布使用。

## 已验证运行基线

- 已测试 EXE SHA-256：`0FCFC0DE8078393EF38F13C1877F523975793D6C8BEACA0756C9DC6FC37FD8E6`。
- 已测试 Portable ZIP SHA-256：`45B7BCB232F967531A8BE03FFD784A31754EE3E1EB6BA33120A3B29B68182FF1`。
- 源码调整前，复制的正式审核 EXE 和 Portable ZIP 均与上述哈希一致。
- 预发布交付物不包含 `cli.env.local`、`fhl-api.local.json`、`browser-jobs.v1.json`、WebView 配置、生成输出或用户 API 配置。

## 恢复点

若工作中断，请先查看本文件和 `docs/changes/2026-07-29-formal-release-review.md`。更新最终测试数量和哈希前，重新运行验证命令。未改动的预发布目录和 ZIP 是回滚来源。

## 验证检查点

- 已完成 `npm ci`，从锁文件安装 324 个软件包。
- 第一次并行验证暴露出预期的干净源码顺序约束：桌面端 `go test ./...` 在 `main.go:25:12: pattern all:frontend/dist: no matching files found` 停止，因为发布源码有意不包含已构建的前端产物。
- 这是验证顺序问题，不是运行测试失败。恢复时先在 `image-studio/frontend` 执行 `npm run build:windows`，再重跑桌面端和 CLI Go test/vet，以及全部前端和 Worker 检查。

## 已完成验证

- 前端：581/581 Node 测试、24/24 UI 测试、TypeScript 和 Windows 生产构建均通过。ESLint 为 0 错误、63 条已接受警告。
- 桌面端与 CLI Go test/vet 通过；Worker 测试为 5/5 通过。
- 源码合规扫描和 Portable 文件夹/ZIP 安全扫描均为 0 个问题。
- 私有路径和 Photoshop 负载检查通过；已删除仅用于验证的 `node_modules` 与 `frontend/dist`。
- 未发起真实或付费生图请求。

## Windows 发布验证

- 用户已授权 Windows GitHub 发布。本源码分支仅适用于 Windows，绝不可合并进或用于替换 macOS `v2.0.3` / `v2.0.3.1`。
- Windows Portable EXE 和 ZIP 仍与已验收的跨电脑测试包按字节完全一致。
- 对应 Windows 源码归档从干净工作树生成，先删除仅用于验证的依赖和构建产物；最终校验值与 Portable ZIP 一同写入 `SHA256SUMS.txt`。
- 审核目录仅包含 GitHub 源码、Release 附件、审核清单、Release 正文和校验值；不包含独立 Photoshop 插件交付物。
- 审核后的启动观察：不可变的 Portable ZIP 是干净的，但已启动的解压目录会生成包内 WebView 数据。Windows Credential Manager 服务名有意共享，使同一 Windows 账户升级时可复用已有 FHL Studio 凭据；新 Windows 账户或电脑没有这些凭据。不要重新分发已启动的解压目录，应分发已验证的 Portable ZIP。

## 发布记录

- 详细 Windows GitHub 发布记录：`docs/changes/2026-07-29-github-windows-v2.0.3-release.md`。
- 回滚：保留未改动的正式审核目录；如有必要，只移除独立 Windows Release、标签和分支。绝不编辑 macOS Release。

## 最终 CI 与发布准备

- GitHub Actions 运行 `30446009232` 的失败日志确认了两项跨平台问题：Linux 竞态检查编译桌面后端时缺少非 Windows 的 `dirExists`；Windows E2E 测试比较系统临时目录时遇到 8.3 短路径与长路径不一致。
- 修复已完成：将 `dirExists` 移至跨平台的 `backend/persistence.go`；E2E 测试先解析临时目录的真实路径再比较；Linux 测试同时隔离 `HOME` 与 `XDG_CONFIG_HOME`。
- 本机桌面端 `go test ./...` 与 `go vet ./...` 通过。GitHub CI 运行 `30447276745` 已全绿，覆盖 Linux 竞态检测、Windows Go test/vet、Wails Windows 构建、前端、Worker 和发布安全检查。
- 本次 Windows V2.0.3 的对外发布标题、Release 正文、验收报告、发布记录和最新版变更日志均为中文；技术文件名、命令和校验值保持不变。
- 最终发布使用新的 Windows 专用标签 `windows-v2.0.3-release`，避免改写早期准备标签 `windows-v2.0.3`；预计 Release 地址为 `https://github.com/supart/fhl-image-studio/releases/tag/windows-v2.0.3-release`，且不标记为 Latest。
