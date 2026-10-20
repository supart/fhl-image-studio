# 2026-08-24 FHL PS Bridge 长期契约与 DSH 扩展治理

## 状态

已建立长期契约规则；桌面实现和独立契约仓库的完整门禁仍需在下一次候选构建前复跑。

## 证据范围

- 独立契约源：`I:\AI\Image-Studio\FHL-PS-Bridge-Contract`。
- DSH 阅读包：`H:\wx\xwechat_files\supar5271_320b\msg\file\2026-08\DSH-Developer-Preview-Codex-Article-2026-08-18(1).zip`。
- 阅读包内完整文件：`README.md`、`DeepSeek-Harness-Developer-Preview-Codex.md`、`SHA256SUMS.txt`。
- DSH 文章记录为 v0.1 开发者预览；原文愿景、源码核对、项目推断和未验证内容不得混为当前已实现能力。
- 独立契约中的客户端版本矩阵不替代客户端项目自己的发布记录；在未读取或验证客户端源码前，不把任何插件或 DSH 版本标记为已兼容。
- 未读取或修改 Photoshop 插件源码，未读取或修改 DSH 源码，未调用真实或付费 API。

## 长期契约决定

- `/fhl-ps/v1` 是长期核心协议；软件版本号与协议主版本号分离。
- `contractRevision` 只表示契约修订，不代表协议主版本变化；客户端只协商协议主版本和服务端客户端范围，不要求精确匹配修订号。
- `v1` 只允许新增可选字段、capability 和命名空间扩展；客户端忽略未知字段和 capability，服务端对缺失可选字段使用默认值。
- 改变字段类型、枚举语义、认证、Session 绑定、任务终态、图片传输或已有路径语义时，必须创建 `/fhl-ps/v2`，不得隐式修改 v1。
- `submitting` 是任务准备状态的规范值；`queued` 仅作为旧客户端兼容别名，不能成为新的服务端输出。
- 错误客户端同时兼容 JSON 错误对象和旧版纯文本错误；`resultUrl` 始终按当前 Bridge origin 拼接并携带 Bearer Token。
- 桌面 Bridge 是 v1 服务端；Photoshop 插件和 DSH Harness 是客户端。契约仓库而非任一实现仓库是最终标准。
- 桌面 CLI 继续作为内部执行器，不作为 Photoshop 或 DSH 的公共协议。

## DSH 扩展边界

契约仓库新增 `v1/extensions/dsh.harness.bridge.v1/`，定义 Cordis service `fhl.psBridge`、任务状态事件和 Trajectory 脱敏规则。DSH Adapter 只调用核心 HTTP Bridge，不读取桌面内部数据库、Credential Manager、Provider 执行器或 CLI。

允许写入 Trajectory 的内容仅包括实例/协议标识、capability、job/client task ID、状态、错误码和 artifact 引用；禁止写入 Token、API Key、keyring 用户、Base64 图片、私有 Photoshop 路径和未脱敏的私密会话正文。

文章中提到的创造模式、动态插件组合和路线图功能，必须经过目标 DSH 源码和测试验证后才可标记为已实现。

## 接口故障优先级

1. 桌面端违反已发布 v1 契约：优先修 Bridge，保持旧客户端可用。
2. 插件或 DSH 错误调用 v1：修客户端适配器，不改变服务端语义。
3. 契约未覆盖的新能力：先增加 capability/extension，再实现两端。
4. 安全、凭据或数据完整性问题：桌面端优先修复，必要时拒绝不安全旧请求并记录兼容影响。
5. 破坏性变化：新增 v2 并保留 v1 过渡期。

## 对账与门禁

下一次候选构建前必须对齐 OpenAPI、JSON Schema、fixtures、Go Handler 测试、TypeScript 测试和客户端 Mock。重点检查 Health/Session 握手元数据、任务状态、长度限制、错误双格式、相对结果 URL、重复 clientTaskId、Session 轮换和 capability 降级。

所有契约测试使用离线 Mock，不调用真实 Provider，不把凭据、用户图片或运行日志写入契约仓库。

## 本批验证结果

- 独立契约 `node tests/verify-contract.mjs`：17 个 JSON 文件通过，DSH 成功事件 fixture 通过脱敏断言。
- 桌面 `go test ./backend`：通过；Batch 同时通过桌面/CLI Go test 与 vet、Worker `5/5`。
- 前端 TypeScript：通过；Bridge 定向 Node `13/13`，Node 全量 `727/727`，UI `122/122`。
- Windows 前端构建：`1996 modules` 通过。
- Lint：`0 errors / 55 existing warnings`，本批没有新增 error。
- `scripts/dev-check.ps1 -Level Fast` 和 `-Level Batch`：通过；`git diff --check`：通过。
- 未启动开发服务，未调用真实或付费 API，未读取或修改 Photoshop 插件源码和 DSH 源码。

## 下一接手入口

先读取：

1. `I:\AI\Image-Studio\FHL-PS-Bridge-Contract\PROJECT_CONTEXT.md`
2. `I:\AI\Image-Studio\FHL-PS-Bridge-Contract\v1\COMPATIBILITY.md`
3. `I:\AI\Image-Studio\FHL-PS-Bridge-Contract\v1\EXTENSIONS.md`
4. 本文件和 `PROJECT_CONTEXT.md` 的本节

确认契约仓库与桌面工作树的状态后，再执行 Go、TypeScript、Node/UI 和 Windows 构建门禁。不得使用 `reset --hard`，不得修改 V2.0.3、Android 或插件源码。
