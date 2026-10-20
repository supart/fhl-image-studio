# FHL Studio Windows V2.0.4 开发交接

## 2026-10-21 V2.0.4 GitHub 正式发布完成

- 正式稳定 Release 已公开：`https://github.com/supart/fhl-image-studio/releases/tag/windows-v2.0.4-release`。
- 不可移动 annotated tag `windows-v2.0.4-release` 指向 `66b96dbc5f4ec9d395072c381404444016943dfe`；发布前 GitHub CI `39459193847` 共 `10/10` 作业通过。
- 公开附件：Portable ZIP `39761D93606CC5D51DC1B19F081555730588741B39AAC25C8D2D37004A9A03E6`；Source ZIP `0D15F5458FAD3A19F9C16CEE691CC49576CBC8AD852891D3EC77CBB0EBBCC683`；两个 ZIP 已从公开 Release 回下载并复核一致。
- 隔离 Portable Bridge 使用 `47631` 完成离线握手：health/session 为 `200`、协议主版本 `1`、instanceId 一致、五项 capabilities 一致、`profileReady=false`；无活动 API 时 profile 按 v1 语义返回受控 `503`。
- Portable 和源码独立解压校验通过，发布安全/源码合规扫描为 `0` 问题；发布阶段未调用模型列表、文本测试、反推或真实/付费生图 API。
- 本记录是正式标签后的分支交接提交，不移动标签、不替换 Release 附件、不修改远程 `main`、macOS、Android、V2.0.3 或 Photoshop 插件项目。

## 2026-10-21 V2.0.4 GitHub 正式发布基线

- 首次远端 CI 的 Windows Desktop 测试暴露 `RUNNER~1` 与 `runneradmin` 的 8.3/长路径等价判断问题；共享 `isWithinRoot()` 已改为先解析现有祖先再做 `filepath.Rel`，不放宽托管目录边界。修复后必须重新通过本地 Go 测试和完整 GitHub CI，正式标签仍未创建。
- 用户已确认 Windows V2.0.4 手动验收通过，本批次按 V2.0.3 的独立 Windows 发布方式收口。
- 功能收口提交为 `92b4ce9`；正式发布分支为 `release/windows-v2.0.4`，标签固定为 `windows-v2.0.4-release`。
- 不合并、不修改远程 `main`，不覆盖 macOS Release/DMG、Android、V2.0.3 或 Photoshop 插件项目。
- 公开手工附件只包含 Windows Portable ZIP、干净源码 ZIP 和 `SHA256SUMS.txt`；两个 ZIP 必须从最终标签提交重新生成。
- 发布包默认无 API、无活动 Profile，不含 `cli.env.local`、Credential Manager 数据、WebView、用户图片、历史、任务或日志。
- 恢复点：先完成本地门禁和发布文档提交，再推送独立 Windows 分支；GitHub CI 全绿后才创建正式标签、重建附件并公开 Release。

## 2026-10-20 V2.0.4 收口、无 API 默认状态与最终 Portable（已完成）

- 当前断点：分支 `codex/windows-v2.0.4-feature/local-edit-360-parity`，提交基线 `70857fad718b6a8997b57cb1edbec1d6f808e5eb`；工作树仍包含本轮及此前未提交开发改动，不提交、不打标签、不推送，不能把成品标记为正式 GitHub Release。
- 完整门禁已通过：Desktop/CLI Go test+vet、TypeScript、Node `749/749`、UI `130/130`、lint `0 errors / 55 existing warnings`、Windows build `1997 modules`、Fast、Batch、Worker `5/5` 和 `git diff --check`。
- 最终隔离输出：`V2.0.4-开发版\临时验收输出\20261020-115809-v2.0.4-final-portable`。打包显式使用 `-OutputRoot`，未使用 `-SkipBuild` 或 `-SkipCliBuild`，未覆盖旧 Portable、V2.0.3、用户运行目录或正式附件。
- 发布安全检查为 `Issues: 0`，Portable 合同测试 `3/3`；包内有固定 Photoshop 对接 JSON、`.fhl-studio-portable`、相对启动路径和实际 EXE，`input/output/intermediate` 无用户文件，未包含 `cli.env.local`、WebView、API Key、历史或日志。
- SHA-256：EXE `D3795DFD680D564E2D11F88D1E662936AC5DE82D1B74267FD185D1AAE5CBDEF9`；CLI `8DA913529E2DD2527E9CC626800099AE7BD36D5418DE697D22E5CCCE6547ABF9`；ZIP `0748709BF6E099FBFF7E6F288E25CBA85E3AFA41CA9A912F4CC95264F5E72AA0`。
- 本机默认配置已恢复为无 API：开发/稳定命名空间的 FHL Images、FHL 文本和 FHL Responses 固定凭据已通过现有 `DeleteStoredAPIKey()` 删除并回读为空；源码 `config/cli.env.local` 已移除；Profile/active profile 清空，文本模型回到 `gpt-5.6-sol`。图片、历史和工作区未清除。
- 源码 Wails 与复制出的 Portable 验收实例均在 `127.0.0.1:47631` 通过 health/session/profile；协议主版本 `1`、契约修订 `2026-08-24`、三处 capabilities 一致，`profile.ready=false`、`promptOptimizationReady=false`、无 active profile 和敏感字段。验收进程与临时副本均已停止/删除，原始 Portable 与 ZIP 保持未启动状态。
- 本轮未读取或输出明文 Key，未调用模型列表、文本测试、图片反推或真实/付费生图 API。详细记录见 `docs/changes/2026-10-20-windows-v2.0.4-final-portable-api-reset.md`。

## 2026-10-20 FHL 文本模型拉取按钮显眼化（已完成）

- 按用户确认，未保存模型设置时的统一默认值为 `gpt-5.6-sol`；是否已有 FHL 文本 Key 不再触发 `gpt-5.5` 旧迁移。已经保存的内置或自定义模型仍保持不变，`gpt-5.5` 继续作为可选项。
- 默认初始化定向测试 `5/5`、typecheck 和 `git diff --check` 通过。
- 仅调整 `FHLTextAPIConfig`：现有模型拉取入口已移到模型下拉框右侧，显示为蓝色描边“拉取模型列表”；底部重复入口已移除，“保存并测试文本 API”仍是唯一蓝色实心主按钮。
- 获取逻辑、Key 优先级、模型清洗、模型持久化和错误处理均未修改；`aria-label`、`title` 与 `data-testid` 保持稳定。
- 定向 UI 测试 `7/7` 与 typecheck 已通过；完整 `wails dev` 页面 `http://127.0.0.1:34115/` 已在 `1024×768`、`1252×930`、`1440×900` 验证按钮可见、单一入口、无横向溢出且下拉框未被挤压。
- 完整收口通过：定向 UI `7/7`、typecheck、lint `0 errors / 55 existing warnings`、Windows build `1997 modules` 和 `git diff --check`；Wails 自动生成 `models.ts` 的尾随空白已机械清理，无类型或逻辑变化。
- 本轮未点击模型拉取或文本测试，未读取明文 Key，未调用真实文本或图像生成 API；不打包、不修改 Photoshop 插件、Bridge v1、Android 或 V2.0.3。
- 当前恢复点：用户可在源码 Wails 页面 `http://127.0.0.1:34115/` 打开 FHL 配置继续手工测试“拉取模型列表”；本批无需继续改代码。详细记录见 `docs/changes/2026-10-20-windows-v2.0.4-fhl-text-model-fetch-button.md`。

## 2026-10-19 FHL 文本 API 动态模型列表（实现与自动验收完成）

- 已复用现有 `GET /v1/models` 探测：Go/Wails 与浏览器回退均返回经过清洗的 `models`，同时保留原 `modelCount`；模型按上游顺序去重，过滤空值、超过 128 个 Unicode 字符、控制字符，并严格拒绝超过 1 MiB 的响应。
- `FHLTextAPIConfig` 已增加手动“获取模型”按钮。输入框中的新 Key 优先但不会提前保存；输入框为空时读取现有安全凭据；模型列表仅存在当前弹窗会话，刷新失败不会清空当前模型，已保存模型不在新列表时仍保留。
- 已保留 `gpt-5.6-sol`、`gpt-5.5` 与自定义模型入口；用户选择后继续复用现有 `fhlTextAPIModelID` 持久化，图片反推、提示词优化与 Photoshop Bridge Prompt Profile 请求链路未改。
- 完整门禁已通过：Desktop/CLI Go test+vet、typecheck、Node `749/749`、UI `130/130`、lint `0 errors / 55 existing warnings`、Windows build `1997 modules`、Fast、Batch、Worker `5/5`、本地 Mock smoke 和 `git diff --check`。
- 完整 `wails dev` 已从当前工作树启动 `image-studio/build/bin/FHL Studio 方汤圆版 V2.0.4-dev.exe`；页面 `http://127.0.0.1:34115/` 返回 200，Bridge `127.0.0.1:47631` 的 health/session/profile 握手一致，Profile ready。
- 自动验收全部使用离线 Mock；本轮未读取或输出 Key，未调用真实模型列表、真实文本测试或图像生成 API。真实上游验收入口是 Wails 窗口中的“获取模型”和“保存并测试文本 API”，各手动点击一次即可。
- 当前恢复点：等待用户完成真实上游手工验收；无需重新修改代码。若通过，可按单独授权决定是否生成新的隔离 V2.0.4 Portable；当前未打包、未提交、未创建标签或发布。
- 详细记录：[docs/changes/2026-10-19-windows-v2.0.4-fhl-text-dynamic-model-list.md](docs/changes/2026-10-19-windows-v2.0.4-fhl-text-dynamic-model-list.md)。

## 2026-10-13 多图参考上传修复（源码修复完成、三图人工验收通过、最终隔离 Portable 已生成）

- 根因已确认：参考图从 UI、workspace、Bridge 到 `Service.Edit` 均完整保留；身份失效发生在 Images API multipart 序列化，第一张使用 `image`、第二张及以后错误使用 `image[]`，部分 FHL 中转静默忽略后续字段。
- 已将桌面 Wails/CLI 的 `go-cli/pkg/client/images_api.go` 与浏览器远程回退的 `requestPayloads.ts` 统一为按原顺序重复 `image`；Responses、APIMart、RunningHub、Bridge 协议和持久化未修改。
- 离线合同和完整门禁已通过：Go module test/vet、typecheck、Node 748/748、UI 126/126、lint `0 errors / 55 warnings`、Windows build、Fast、Batch、Worker 5/5、本地 Mock smoke 和 `git diff --check`。
- 完整源码 Wails 开发程序为 `FHL Studio 方汤圆版 V2.0.4-dev.exe`；三图人工验收使用源码 Wails 页面 `http://127.0.0.1:34115/`，当时源码 Bridge 为 `127.0.0.1:47631`，health/session/profile 握手正常，测试后进程已退出。若旧 Portable 占用 `47631`，源码实例按现有端口选择规则使用 `47632`，两者不能混用。
- 用户要求先人工手动测试、后打包。此前生成的 `V2.0.4-开发版\\临时验收输出\\20261013-multi-reference-upload-fix` 仅作人工测试前时间点证据，不是最终包，不得发布或用于 Photoshop 插件验收；本轮必须重新构建新的隔离 Portable。
- 人工验收已通过：在源码 Wails 版使用三张参考图，真实 FHL Images 上游成功返回结果，三张图均生效；这次真实请求由用户手动完成，自动门禁仍全部使用离线 Mock。
- 本次失败已定位为上游账号池问题，不是本地崩溃或 `image[]` 字段：第 1-3 个任务返回 `503: No available compatible accounts`，第 4-5 个任务因软件关闭而中断。重试前需等待/切换到有可用账号的 FHL Images 槽；不要反复重试同一不可用槽。
- 此批次的 `503: No available compatible accounts` 来自 FHL Images 上游账号池，不是本地字段修复失败；后两次中断是软件被关闭造成的。自动验证未调用真实或付费生图 API；本批未读取或修改 Photoshop 插件源码，也未修改 V2.0.3、Android、Bridge 契约仓库或既有 Portable。
- 最终隔离 Portable 已从当前 Git 工作树重新构建，未使用 `-SkipBuild` 或 `-SkipCliBuild`：`V2.0.4-开发版\\临时验收输出\\20261013-multi-reference-upload-fix-final\\FHL-Image-Studio-Desktop-V2.0.4-Windows-Portable`；ZIP 与包目录均未覆盖旧包、V2.0.3、用户运行目录或正式附件。
- 最终包通过 `check-release-safety.ps1`（Issues 0）和 `portablePhotoshopIntegration.test.mjs`（3/3）；固定对接 JSON、`.fhl-studio-portable`、包内相对 EXE 路径、空的 `input/output/intermediate` 均已校验。EXE SHA-256 `DA1136BB992EDF374BBDF30A223A6FA1BC12A21C92E9564CACA1F0EF2F3EF59E`，CLI SHA-256 `8DA913529E2DD2527E9CC626800099AE7BD36D5418DE697D22E5CCCE6547ABF9`，ZIP SHA-256 `140218CEAFE6D777016DAC9C685C82F19D5AF5AE22A89E7748CE62EA383E3F8A`。
- 从最终包复制出的隔离运行验收副本监听 `127.0.0.1:47631`；health/session/profile 握手成功，协议主版本 `1`、契约修订 `2026-08-24`、能力 `profile,jobs,prompt-optimization,prompt-reverse,images`、Profile ready，未提交任务。握手后测试进程已关闭，最终包本身未被运行缓存污染；本次打包和握手没有调用真实或付费生图 API。
- 当前接手点：源码修复、三图人工验收、自动门禁和最终隔离包均完成；V2.0.4 仍是开发候选，不创建正式 Git 标签、不推送、不发布。
- 详细记录：[docs/changes/2026-10-13-windows-v2.0.4-multi-reference-upload-fix.md](docs/changes/2026-10-13-windows-v2.0.4-multi-reference-upload-fix.md)。

## 2026-09-14 Photoshop Bridge 图片反推能力修复（已完成）

- 根因：47631/47632 原先运行的是旧 EXE；源码已有 `prompt-reverse` 路由，但 `/profile` 和 CLI fallback 未统一公开能力列表。已补齐后端、CLI fallback 和前端 Bridge 能力常量。
- 已停止旧实例并重建当前 Git 源码。新隔离 Portable 唯一监听 `127.0.0.1:47631`，EXE 位于 `临时验收输出\\20260914-ps-reverse-prompt-final\\FHL-Image-Studio-Desktop-V2.0.4-Windows-Portable`。
- health/session/profile 均返回 `profile,jobs,prompt-optimization,prompt-reverse,images`；Session instanceId 与 health 一致，Profile ready，未公开凭据。
- 使用源码 `docs/picture/windows.png` 成功调用 `/fhl-ps/v1/prompts/reverse`，返回非空 prompt；未提交图像生成任务。
- 验证：Wails build、Go test/vet、typecheck、Node `747/747`、UI `126/126`、lint `0 errors / 55 warnings`、Fast、Batch、Portable 合同 `3/3`、`git diff --check` 均通过。
- 详细记录：[docs/changes/2026-09-14-windows-v2.0.4-ps-bridge-prompt-reverse.md](docs/changes/2026-09-14-windows-v2.0.4-ps-bridge-prompt-reverse.md)。

## 2026-09-14 Photoshop Bridge 图片反推能力修复（已完成）

- 源码 Bridge 已补齐 profile/CLI fallback 的统一 `capabilities` 字段，并加入 `prompt-reverse`；前端 `PS_BRIDGE_CAPABILITIES` 同步为五项。
- 旧 47631/47632 实例已停止。新隔离 Portable 唯一运行在 `127.0.0.1:47631`，health/session/profile 握手均含 `prompt-reverse`。
- 使用 `docs/picture/windows.png` 成功完成一次真实 `/fhl-ps/v1/prompts/reverse`，返回非空 prompt；未提交生成任务。
- Portable 根目录：`V2.0.4-开发版\\临时验收输出\\20260914-ps-reverse-prompt-final\\FHL-Image-Studio-Desktop-V2.0.4-Windows-Portable`。EXE SHA-256 与最终响应摘要记录在 `docs/changes/2026-09-14-windows-v2.0.4-ps-bridge-prompt-reverse.md`。

## 2026-09-07 局部重绘贴回状态修复（已完成，隔离 Portable 已生成）

- 根因已修复：`BatchTaskRecord` 顶层保存独立 `localEditRoundtrip`，workspace session 仍移除大体积 `sourceImages`，但保留局部裁切任务身份；任务创建、重试、浏览器后台、桌面直连、RunningHub/APIMart 恢复结果均继承该字段。
- 现有 roundtrip 恢复模块已扩展到 planar：只按结果/来源嵌套元数据、任务顶层/来源元数据，以及 `parentId`、`batchSourcePath`、`sourceImagePaths` 的历史 ID 或规范化完整路径精确匹配；不按文件名、尺寸或提示词推测。自动贴回终态写入 `localEditPastebackState="pasted"`，不再恢复重复入口。
- Windows 批次网格和完整历史相册的合格最终图新增蓝色“贴回”按钮及自动/手动/导入三项菜单；复用现有 Store 动作，卡片已拆为外层容器、主预览按钮和独立操作按钮，事件不会穿透选择或双击预览。Android 不传桌面回调，不显示该入口。
- 已通过：完整 Node `747/747`、UI `126/126`、typecheck、lint `0 errors / 55 existing warnings`、Windows build `1997 modules`、Fast、Batch、Go test/vet、Worker `5/5`、离线 smoke 和 `git diff --check`。补充边界测试覆盖终态不重复显示入口、历史 ID 大小写不折叠。
- 已启动并验证完整源码 Wails：`FHL Studio 方汤圆版 V2.0.4-dev.exe`，宿主 `34115`，Bridge `47631`；health/session/profile 握手通过且未提交任务。离线 CDP 三档 `1252×930`、`1440×900`、`1024×768` 已验证批次网格/历史相册贴回菜单、事件隔离和无横向溢出；Wails 页面的既有审计代理 `404` 与预览夹具 `ERR_INVALID_URL` 单独记录为环境残余。
- 隔离 Portable 已生成并完成离线校验、清单与 SHA-256、升级覆盖模拟：`V2.0.4-开发版\\临时验收输出\\20260907-local-edit-pasteback-final\\FHL-Image-Studio-Desktop-V2.0.4-Windows-Portable`。ZIP SHA-256 为 `30462165A6FC52FBA362FC225C6E71769FA1BEE9F84DB5BEB511B0C7311B2D38`；未升级到 V2.0.5，未覆盖既有正式包。

## 2026-08-27 FHL 文本 API 模型选择

- 独立 FHL 文本 API 配置新增 `gpt-5.6-sol`、`gpt-5.5` 和自定义模型 ID；专用设置与普通 `FHL_TEXT_MODEL_ID` 分离，普通 Profile、Images 池、APIMart、RunningHub 和图像模型行为不变。
- 模型偏好保存在当前桌面 namespace 的 `image-studio.<namespace>.gptcodex.fhlTextAPI.modelID.v1` localStorage 键；Keyring 只保存专用文本 API Key。新环境默认 `gpt-5.6-sol`，已有专用 Key 且无模型记录的旧环境迁移到 `gpt-5.5`，已有选择不覆盖；删除 Key 保留选择，完整 API 清空/应用恢复默认写回新默认。
- 自定义模型 ID 去首尾空格，限制 `1-128` 字符并拒绝控制字符；无效值不测试、不覆盖有效模型。模型测试请求、AI 优化、图片反推和 PS Bridge prompt profile 共用解析值，不自动降级。
- 实现文件：`frontend/src/lib/fhlTextAPIModel.ts`、`fhlTextAPI.ts`、`promptTextProfiles.ts`、`FHLTextAPIConfig.tsx`、`studioStore.ts`、`apiCredentialClear.ts`、`psBridgeContracts.ts`。测试：`fhlTextAPIModel.test.mjs`、更新的配置/解析/Bridge/重置合同。
- 已验证：typecheck、模型/配置/解析/Bridge 定向测试；未调用真实或付费生图 API。完整门禁和 `wails dev` 三档浏览器复核在本批收口阶段继续执行。

## 2026-08-27 本地 Git 源码版已启动

- 已通过外层 `一键启动V2.0.4开发版.cmd` 启动完整 Wails 开发程序；进程为源码 `image-studio/build/bin/FHL Studio 方汤圆版 V2.0.4-dev.exe`，不是 Portable、Vite-only 页面或 V2.0.3。
- Wails 开发宿主为 `http://localhost:34115`，前端开发资源仍由 `http://127.0.0.1:5173/` 提供；本轮 Bridge 为 `127.0.0.1:47632`。桌面上的旧 V2.0.3 Portable 继续占用 `47631`，不作为开发验证目标。
- V2.0.4 源码 Bridge 健康检查已返回 `ok=true`、`protocolMajor=1`、`contractRevision=2026-08-24`、`profileReady=true`；后续优化应连接 `47632` 或完整 Wails 窗口，不要把 `5173` 或 `47631` 当作本地 Git 修改版。
- 本批只启动和验证开发环境，没有调用真实或付费生图 API，没有修改 V2.0.3、Photoshop 插件或独立契约仓库。

## 2026-08-24 批次 64：快速配置批量 API 入口修复（已完成）

- 修复桌面 `FHLQuickConfigModal` 未向 `FHLDesktopAPIConfig` 传递批量弹窗状态的问题；现在快速配置入口与普通上游配置入口都显示“批量配置 10 个 API”。批量弹窗状态只存在于当前桌面弹窗会话，关闭或切换高级配置时清理。
- Android Legacy 快速配置、CLI、Bridge、凭据和 Images 池业务逻辑未修改。
- 验证：typecheck、Node `727/727`、UI `122/122`、lint `0 errors / 55 existing warnings`、Windows build `1996 modules`、`scripts\\dev-check.ps1 -Level Fast`、`git diff --check`、浏览器 Windows 快速/普通上游配置入口、批量弹窗关闭重置和 `?target=android` 分支检查均通过；未调用真实 API。
- 详见 [docs/changes/2026-08-24-windows-v2.0.4-bulk-config-entry-fix.md](docs/changes/2026-08-24-windows-v2.0.4-bulk-config-entry-fix.md)。

## 2026-08-23 批次 63：标注文字共享不透明编辑面板（已完成）

- 普通“文字”和批注箭头统一复用 `AnnotationTextEditor`；新增 `annotation-text-editor` 外层面板和 `annotation-text-editor-input` 输入框样式，浅色主题使用近不透明白底，深色主题使用近不透明深色底，补齐边框、圆角、阴影和移动端宽度约束。
- 保留自然像素字号、画布缩放对齐、确认文字按钮、双击进入编辑、框外提交和自动切换指针等既有语义；不新增状态、持久化或上传路径。
- 测试：typecheck 通过；Node `726/726`；UI `122/122`（含 `AnnotationTextEditor` `3/3`）；lint `0 errors / 55 existing warnings`；Windows build `1996 modules`；`scripts\\dev-check.ps1 -Level Fast`、`Batch`、`git diff --check` 均通过。
- Codex 浏览器当前预览实测普通文字编辑面板为实体深色背景，输入“共享文本框测试”后点击“确认文字”关闭编辑器并切换指针，文字仍保留；临时标注已清理。未调用真实 API，未修改 Android、V2.0.3、用户图片或 API 凭据。
- 接手：当前分支仍为 `codex/windows-v2.0.4-feature/local-edit-360-parity`，工作树保留此前未提交改动；未设置 upstream、未推送。后续可继续做三档视口下的编辑面板视觉复核或 Windows Wails DPI 实机观察。

## 2026-08-22 批次 62：标注文字双击编辑与确认保留（已完成）

- 指针模式下单击文字/批注箭头只选中对象，双击才进入编辑；双击标注不会再触发 Stage 的 fit/100% 缩放快捷键。
- 文字确认和 blur 提交均读取 textarea 当前值，并以提交瞬间的对象快照作为撤销基线，避免最后一次输入在确认/失焦竞态中丢失。
- 验证：typecheck、Node `726/726`、UI `122/122`、lint `0 errors / 55 existing warnings`、Windows `1996 modules` build、Fast、Batch 均通过；标注工具合同和 `AnnotationTextEditor` UI `3/3` 通过。Codex 浏览器真实验证单击不打开编辑、双击打开编辑、确认后文字仍显示且缩放 `83% -> 83%` 不变，控制台新增 warning/error 为 `0`。
- 未调用真实 API，未修改 Android 产品行为、V2.0.3、用户图片或 API 凭据；当前工作树仍包含此前批次未提交改动，未设置 upstream、未推送。详见 [docs/changes/2026-08-22-windows-v2.0.4-annotation-text-reopen.md](docs/changes/2026-08-22-windows-v2.0.4-annotation-text-reopen.md)。

## 2026-08-22 批次 61：标注文字确认与框外提交（已完成）

- 文字和批注箭头编辑框新增画布内“确认文字”按钮；按钮阻止冒泡并防止确认点击与失焦重复提交。
- 编辑草稿改用 ref 读取最新值；确认、Ctrl/Cmd+Enter 和画布框外点击提交后切换 `annotationKind` 为 `pointer`，保留当前选中对象供拖动、变形、字体和描边调整。
- 画布外失焦保存空文字对象，不再在确认/失焦路径自动删除；显式删除、清空和会话取消语义保持不变。工具栏点击仍可直接切换工具或调滑条。
- 验证：typecheck、Node `726/726`、UI `122/122`、lint `0 errors / 55 existing warnings`、Windows `1996 modules` build、`Fast`、`Batch`、桌面/CLI Go test+vet、Worker `5/5`、离线 smoke 和 `git diff --check` 均通过；`AnnotationTextEditor` UI `3/3`、标注工具合同 `6/6`。
- Codex 浏览器在 `1252×930`、`1440×900`、`1024×768` 三档验证确认按钮、画布框外提交、自动切换指针、无额外对象和无横向溢出；控制台新增 warning/error 为 `0`。测试后已恢复默认视口，隔离预览中的临时标注不写入生产数据。
- 未调用真实 API，未修改 Android、V2.0.3、用户图片或 API 凭据；当前工作树仍包含此前批次未提交改动，未设置 upstream、未推送。
- 详见 [docs/changes/2026-08-22-windows-v2.0.4-annotation-text-confirm.md](docs/changes/2026-08-22-windows-v2.0.4-annotation-text-confirm.md)。

## 2026-08-22 批次 60：批量 API 配置入口主按钮样式（已完成）

- “批量配置 10 个 API”入口改用现有 `liquid-primary-button` 亮蓝主操作样式，保留原批量预填、禁用态和点击逻辑。
- 验证：`npm run typecheck`、FHLImagesPoolConfig UI 18/18；Codex 浏览器实际计算样式为亮蓝背景、白色文字，未调用真实 API。
- 当前工作树仍包含此前批次未提交改动；未设置 upstream、未推送。详见 [docs/changes/2026-08-22-windows-v2.0.4-fhl-bulk-api-button.md](docs/changes/2026-08-22-windows-v2.0.4-fhl-bulk-api-button.md)。

## 2026-08-22 批次 59：标注移动与变形撤销步骤（已完成）

- 指针移动、变形句柄、批注标签拖动和文字提交现在按一次完整手势/提交各生成一个撤销步骤；`updateAnnotation()` 只负责拖动中的临时预览，`commitAnnotationUpdate()` 保存完整前后快照并清空 redo 栈。
- 新增 `frontend/src/features/annotation/annotationHistory.ts` 纯函数，深复制自由画点和前后标注对象；交互 Hook 使用 `annotationsRef` 读取最新 Store 状态，修复 React pointer 事件闭包导致提交旧快照、后退直接删除新对象的问题。
- 验证：定向标注 23/23、Node 725/725、UI 119/119、typecheck、lint 0 errors/55 existing warnings、Windows build 1996 modules、`git diff --check` 通过；Codex 浏览器 1252×930 实测移动后退/前进和变形后退，标注对象均保留。未调用真实 API。
- 当前工作树仍包含此前批次未提交改动；未设置 upstream、未推送。1440×900 与 1024×768 的布局/句柄此前已在批次 54 验收，本批未改变浮窗尺寸；Windows Wails DPI 实机复核仍是观察项。详见 [docs/changes/2026-08-22-windows-v2.0.4-annotation-history-steps.md](docs/changes/2026-08-22-windows-v2.0.4-annotation-history-steps.md)。

## 2026-08-22 批次 58：标注画布底部浮动操作栏（已完成）

- 普通图像进入标注模式后，画布底部中央显示浮动操作栏：后退（撤销）、前进（重做）、删除选中标注、确认标注、取消；顶部确认按钮保持不变，两处确认共享 `confirmAnnotationComposite("strict")` 和越界处理。
- `AnnotationActionBar` 位于 `frontend/src/features/annotation/`，通过 `.stage-host` 内 portal 定位，响应式/DPI 样式不影响 Android；合成中统一禁用，按钮事件不会穿透 Konva 画布。
- 标注会话按 `workspaceId + currentImage.id` 保存内存快照。取消有改动才二次确认，确认后恢复标注、选择和撤销/重做栈并清除临时源；未创建 Output、历史或参考图。确认成功会清理快照，删除只作用于当前选中对象。
- 验证：定向 Node 15/15、完整 Node 722/722、UI 26 文件 119/119、typecheck、lint 0 errors/55 existing warnings、Windows build 1995 modules、Fast、Batch、Go test/vet、Worker 5/5、离线 smoke、`git diff --check` 均通过。Codex 浏览器实测 1252×930 浮窗居中、撤销/重做和选中删除；取消原生确认框自动化阻塞，Store/UI 合同已覆盖。
- 未验证风险：1440×900 与 1024×768 本批未重新截图，Windows Wails DPI 仍需下一轮实机复核。未提交、未设置 upstream、未推送；详见 [docs/changes/2026-08-22-windows-v2.0.4-annotation-floating-actions.md](docs/changes/2026-08-22-windows-v2.0.4-annotation-floating-actions.md)。

## 2026-08-22 批次 57：全局默认 2K / 标准（已完成）

- 普通生成、工作区重置和新工作区原本已经是 `2048x2048`（2K）与 `medium`（界面“标准”）；本批补齐图生图按源图比例自动适配仍残留的 `1K` 缺省。
- 新增共享 `DEFAULT_AUTO_ASPECT_RESOLUTION = "2k"`，新工作区、旧字段缺失时的规范化，以及 Windows 桌面/Mac 面板从手动比例切回自动适配的回退均统一使用它。显式保存的 `1k`/`4k` 不迁移覆盖。
- 未修改 Android 参数默认、Provider 尺寸映射、V2.0.3、用户图片、API 凭据或真实生图；本批仍未提交、未设置 upstream、未推送。
- 验证：Node `718/718`、UI 默认模式 `117/117`、UI 单线程 `117/117`、typecheck、lint `0 errors / 55 existing warnings`、Windows build `1994 modules`、Fast、Batch、`git diff --check` 均通过。Codex 浏览器隔离新工作区显示 `2K · 标准`，图生图自动适配选中 `2K`，显式切换 `1K` 保持不变；重载恢复原始预览，控制台新增 warning/error 为 `0`。详细记录：[docs/changes/2026-08-22-windows-v2.0.4-global-defaults-2k-standard.md](docs/changes/2026-08-22-windows-v2.0.4-global-defaults-2k-standard.md)。

## 2026-08-22 批次 56：标注指针右键菜单（已完成）

- 指针模式右键命中标注后只选中并打开上下文菜单，不再直接删除；菜单提供“复制标注”和“删除标注”。复制通过 `cloneAnnotationForCopy()` 保留样式、文字、标签位置和自由画点列，按自然像素偏移后走现有 `addAnnotation()` 撤销栈；删除继续走 `removeAnnotation()` 撤销栈。空白右键不创建、不删除对象。
- 验证：标注定向 `17/17`、Node `718/718`、UI `117/117`、typecheck、lint `0 errors/55 existing warnings`、Windows `1994 modules` build、Fast、Batch、桌面/CLI Go test+vet、Worker `5/5`、离线 smoke 和 `git diff --check` 均通过。Codex 浏览器实测右键菜单、复制副本和显式删除，箭头文字标签也可右键命中；测试标注已清理，控制台新增 warning/error 为 `0`。详细记录：[docs/changes/2026-08-22-windows-v2.0.4-annotation-context-menu.md](docs/changes/2026-08-22-windows-v2.0.4-annotation-context-menu.md)。
- 未调用真实/付费 API，未修改 Android、V2.0.3、Cowart 源码、用户图片或 API 凭据；本批未创建提交、未设置 upstream、未推送。

## 2026-08-22 批次 55：批注标签独立拖动（已完成）

- 指针工具下，批注箭头文字标签现在可独立命中和拖动；拖动只更新 `labelX/labelY`，箭头起点、终点和弯曲保持不变。箭头本体移动时，已独立定位的标签同步平移；右键删除、撤销/重做和文字编辑语义保持不变。
- `Annotation` 新增兼容字段 `labelX`、`labelY`；旧数据缺失坐标时继续按箭头起点上方的默认位置。`annotationLabelPosition()`、`annotationLabelBounds()` 被 `AnnotationShape`、指针交互和 `annotationComposite` 共同复用，视窗预览与 PNG 合成保持一致。
- 验证：定向几何 `10/10`、Node `717/717`、UI `117/117`、typecheck、lint `0 errors/55 existing warnings`、Windows `1994 modules` build、Fast、Batch、Go test/vet、Worker `5/5`、离线 smoke 和 `git diff --check` 均通过。
- Codex 浏览器 `http://127.0.0.1:5173/?preview=mac-workspace` 实测创建批注箭头、输入文字、切换指针并拖动标签；文字独立移动且箭头端点未改变，随后清空测试标注。控制台新增 warning/error 为 `0`。
- 未调用真实/付费 API，未修改 Android、V2.0.3、Cowart 源码、用户图片或 API 凭据；本批未创建提交、未设置 upstream、未推送。详细记录：[docs/changes/2026-08-22-windows-v2.0.4-annotation-label-drag.md](docs/changes/2026-08-22-windows-v2.0.4-annotation-label-drag.md)。

## 2026-08-22 批次 54：标注指针变形句柄（已完成）

- 指针激活并选中标注后显示轻量句柄：矩形/椭圆/自由画/高亮四角拉伸，直线/箭头起终点调整，文字和箭头标签按自然像素比例缩放字号；句柄半径按 `1/viewScale` 绘制，拖动点限制在当前图像边界。
- 新增 `annotationTransformHandles()`、`annotationTransformBounds()` 和 `resizeAnnotationFromHandle()` 纯函数；交互层使用原始快照连续计算，变形不会误开文字编辑，现有整体拖动和右键删除保持不变。
- 验证：typecheck、定向几何 `9/9`、Node `716/716`、UI `117/117`、lint `0 errors/55 existing warnings`、Windows `1994 modules` build、Fast、Batch、`git diff --check` 通过；Batch 同时通过桌面/CLI Go test+vet、Worker `5/5` 和离线 smoke。Codex 浏览器已在 `1252×930` 实测矩形四角和直线端点，在 `1440×900`、`1024×768` 复核句柄可见性与无横向溢出，新增控制台 warning/error 为 `0`。
- 未调用真实/付费 API，未修改 Android、V2.0.3、Cowart 源码、用户图片或 API 凭据；工作树仍包含此前批次未提交改动，本批未创建提交或推送。回退只使用后续明确提交的 `git revert`。

## 2026-08-22 批次 53：标注指针拖动与右键删除（已完成）

- 指针模式现在可选中并拖动矩形、椭圆、线条、箭头、文字、自由画和高亮；拖动只改变标注几何，不改变原图像素。
- 新增按描边/字体像素和当前缩放计算的有限命中扩散范围，约为两倍线宽或 `10px` 屏幕半径；框外命中不会扩大成整块画布。
- 指针模式右键在命中标注时调用现有 `removeAnnotation()`，删除进入撤销栈；空白右键只阻止浏览器菜单，不创建或删除对象。
- 定向标注测试 `11/11`、Node 全量 `712/712`、UI `117/117`、typecheck 通过；Codex 浏览器实际验证矩形拖动、框外约 `10px` 命中拖动、右键删除，重载后新增 warning/error 为 `0`。未调用真实 API。
- 详细记录：[docs/changes/2026-08-22-windows-v2.0.4-annotation-pointer-font-default.md](docs/changes/2026-08-22-windows-v2.0.4-annotation-pointer-font-default.md)。

## 2026-08-22 批次 52：标注指针与字体默认值（已完成）

- 标注工具最左侧新增“指针（选择标注）”。指针不会在空白处创建新对象；点击已有文字或带标签箭头会重新打开编辑框，点击空白取消选择，确认前可以继续修改。
- 工具栏描边/字体滑条现在优先显示选中对象的实际样式；无选中对象时使用工作区默认值。对象样式修改继续通过 `updateAnnotationStyle()` 进入撤销/重做。
- 新增 `annotationFontSizeForImage()`：按标注 4K 临时源最长边 `÷64` 计算字体默认值，并限制最小 `16px`、最大 `128px`；`480×480 -> 16px`、`1152×1536 -> 24px`、`3840×2791 -> 60px`。只在当前图片首次准备标注源时初始化，同图再次进入保留用户调整。
- `npm run typecheck`、标注定向合同 `9/9`、`npm run test:node` `711/711`、`npm run test:ui` `117/117` 已通过。Codex 浏览器实际创建文字后切换指针并重新打开编辑框，默认预览字体显示 `16px`；重载后新增 warning/error 为 `0`，未提交合成、不调用真实 API。
- 浏览器控制层对受控 range 的程序化拖动仍有局限，真实 Windows Wails 鼠标/DPI 复核保留为观察项。详细记录：[docs/changes/2026-08-22-windows-v2.0.4-annotation-pointer-font-default.md](docs/changes/2026-08-22-windows-v2.0.4-annotation-pointer-font-default.md)。

## 2026-08-22 批次 51：标注尺寸与画布缩放统一（已完成）

- 根因是标注已经使用图像坐标保存，但渲染/合成又按 `viewScale` 二次缩小线宽、字体和箭头；同时标注描边复用了蒙版 `brushSize`。现在标注样式统一按当前 4K 临时源的自然像素保存、预览和合成。
- `Annotation.fontSize`、`annotationStrokeWidth`（默认 `4px`，范围 `1–96px`）和 `annotationFontSize`（范围 `8–128px`）已加入工作区运行态；正常进入标注时按当前 4K 临时源尺寸自动初始化字体，无法确认尺寸或旧标注缺失字体时回退 `20px`，旧 `strokeWidth` 不猜测历史缩放。蒙版 `brushSize` 保持独立。
- 工具栏新增“标注描边”“标注字体”滑条和固定“等比锁定”状态；选中对象即时更新并进入撤销/重做，未选中对象只影响后续新建标注。`AnnotationShape`、`AnnotationLayer`、文字编辑器和 `annotationComposite` 不再对线宽/字体做 `viewScale` 二次换算。
- 自动化门禁：typecheck、Node `711/711`、UI `117/117`、lint `0 errors / 55 existing warnings`、Windows 构建 `1994 modules`、Fast、Batch、Go test/vet、Worker smoke 和 `git diff --check` 均通过。
- Codex 浏览器 `http://127.0.0.1:5173/?preview=mac-workspace` 在 `1252×930`、`1440×900`、`1024×768` 验收了工具入口、两个滑条、等比锁定和响应式布局，并实际拖动创建矩形后清理预览标注；1024 档无横向溢出，新增 warning/error 为 `0`。浏览器驱动对受控 range 的程序化 `fill` 可能只改变原生值，真实 Windows Wails DPI/鼠标拖动仍需后续实机复核。
- 详细记录：[docs/changes/2026-08-22-windows-v2.0.4-annotation-scale-consistency.md](docs/changes/2026-08-22-windows-v2.0.4-annotation-scale-consistency.md)。当前工作树未提交、未设置 upstream、未推送；不修改 Android、V2.0.3、Cowart 源码、用户图片或 API 凭据，回退只使用后续明确提交的 `git revert`。

## 2026-08-22 批次 50：标注工作台 4K 临时源（已完成）

- 用户最终规则：超出标注工作台承载尺寸时统一按 4K 上限压缩，不读取外部 1K/2K 设置。当前实现以 `3840px` 最长边为上限，保持原图比例，小图不放大。
- 新增 `frontend/src/features/annotation/annotationSource.ts` 和运行时 `annotationSource` 会话。进入“图像标注工具”前解码完整媒体并压缩；`CanvasStage` 与 `confirmAnnotationComposite()` 复用同一 Blob，压缩副本不进入 workspace 持久化、Prompt、历史或原始参考槽。
- 楼房测试图 `7876×10835` 在工作台变为 `2791×3840`。确认成功后的 Output、历史、当前画布和新参考图使用该实际尺寸，原图仍保留；无匹配压缩源或压缩失败时本地阻止确认。
- 新增 `docs/changes/2026-08-22-windows-v2.0.4-annotation-4k-source.md`。Codex 浏览器 `http://127.0.0.1:5173/?preview=mac-workspace` 使用同一楼房测试图完成真实离线验收：进入标注显示 `2791×3840` 压缩提示，绘制矩形并确认后工具收起，当前画布、Output、历史和第 4 个参考图槽同步为 `2791×3840`，历史 `15 -> 16`，新增 warning/error 为 `0`。
- 收口门禁全部通过：`npm run typecheck`、`npm run test:node` `705/705`、`npm run test:ui` `117/117`、`npm run lint` `0 errors / 55 existing warnings`、`npm run build:windows` `1994 modules`、Fast、Batch 和 `git diff --check`；Batch 同时通过桌面/CLI Go test/vet、Worker `5/5` 和离线 smoke。未调用真实生图 API。
- 当前工作树未提交、未设置 upstream、未推送；回退只使用后续明确提交的 `git revert`。仍保留真实 Wails DPI/EXIF 方向的后续观察风险，不影响浏览器离线门禁结论。

## 2026-08-22 批次 49：高清标注 PNG 二进制保存上限修复（已完成）

- 根因：楼房测试图实际自然尺寸为 `7876×10835`（约 85MP），Canvas 合成后的 PNG 约 151MB；浏览器端虽然已切换到 `/save-image-binary`，Vite 仍使用旧的 90MB body 上限，超限后连接被断开，页面只显示 `Failed to fetch`。早期热更新期间还出现过 `host.ts` 导出未刷新，重启服务后已恢复。
- 修改：为 `/save-image-binary` 增加专用 `ANNOTATION_BINARY_SAVE_MAX_BYTES = 512MiB` 上限；JSON 图片接口和路径复制接口仍保持 90MB 旧限制。合成自身继续执行 `100MP / 16,384px / 768MiB` 预检，不放宽图像内存门禁。
- 浏览器真实验收：重启 `http://127.0.0.1:5173/?preview=mac-workspace` 后重新导入同一楼房图，绘制矩形并点击“确认标注”。按钮先显示“合成中…”，约 15 秒后自动收起；Output 新增 `annotation-composite-1787372941040.png`，历史 `15 -> 16`，参考图 `3 -> 4`，当前画布切换到栅格化结果，原始参考图仍保留。历史显示自然尺寸 `7876×10835`。
- 输出桥接验证：用同尺寸约 151MB PNG 离线探针 POST 到 `/__image-studio-files/save-image-binary` 返回 `200`，Output 路径和文件大小正确；未调用真实/付费生图。浏览器新增错误在本次成功操作中为 `0`（日志中保留的旧 HMR/失败记录不代表本次请求）。
- 收口门禁：`npm run typecheck`、`npm run test:node` `700/700`、`npm run test:ui` `117/117`、`npm run lint` `0 errors / 55 existing warnings`、`npm run build:windows`（1993 modules）、`git diff --check` 均通过。构建仅保留既有 chunk/dynamic-import 提示。
- 失败原因与回退点：本批只改 Vite body 上限和合同测试，未修改 Android、Cowart 源码、V2.0.3、用户原图、API 配置或远程 GitHub；当前工作树未提交，回退只使用后续明确提交的 `git revert`，不使用 `reset --hard`。本轮生成的离线探针文件位于项目 `.tmp` 和 `output/images`，不参与历史/参考图事务，后续清理时仅针对这些明确文件。

## 2026-08-22 批次 48：浏览器大图 Output 复制修复（已完成）

- 根因：确认标注的 Canvas 合成已完成，但浏览器预览没有 Wails `SaveImagePathToOutput`；旧回退把受管临时文件重新读为 Base64，再通过 JSON 写入 Output，大图在复制阶段失败并显示“宿主能力未注入”。
- 修改：新增 Vite `copy-image-to-output` 受管路径接口，校验项目路径、图片头、文件大小和唯一文件名后直接复制到 `output/images`；浏览器端优先走路径复制，旧服务和虚拟图片保留 Base64 回退。
- 验收：重启 `5173` 后用当前离线测试图直接点击确认，成功写入 Output、历史和参考图；控制台新增 warning/error 为 0。TypeScript、Output bridge 合同 7/7、`git diff --check` 通过。
- 约束：未调用真实/付费生图，未修改 Android、V2.0.3、用户图片、API 凭据或远程 GitHub；当前工作树未提交，回退只使用后续明确提交的 `git revert`。

## 2026-08-22 批次 47：确认按钮高亮与合成反馈（已完成）

- 根因：标注确认按钮只依赖 `bg-[var(--accent)]`，被全局 `button { background: transparent }` 覆盖，Windows 工具栏实际显示为透明按钮；合成期间也没有按钮文字反馈。浏览器评论标记还可能注入全屏透明遮罩，导致手动点击被拦截。
- 修改：确认按钮改为内联强调色背景/边框/阴影，保持亮蓝主按钮；新增 `aria-busy` 和“合成中…”状态，忙碌时禁用重复操作并保留可见反馈。未改变合成、Output、历史或 workspace 事务语义。
- 浏览器验收：`http://127.0.0.1:5173/?preview=mac-workspace` 计算样式为背景/边框 `rgb(96, 205, 255)`；DOM 真实点击后合成图更新当前画布，参考图 2 -> 3、历史 15 -> 16，控制台 warning/error 为 0。
- 超大图边界：约 `7876×10835`（约 85MP、150MB PNG）的浏览器合成会命中现有约 `768MiB` 工作内存预检并显示失败提示，不分配、不写 Output、不建历史；后续若要支持该尺寸需另开桌面流式合成批次。
- 自动化：typecheck、标注工具/合成定向 6/6、Node `698/698`、UI `117/117`、Windows 构建 `1993 modules`、Lint `0 errors/55 existing warnings`、Go test/vet、Fast、Batch 和 `git diff --check` 通过。
- 回退点：当前工作树未提交；回退只使用后续明确提交的 `git revert`，不使用 `reset --hard`。

## 2026-08-22 批次 46：确认合成结果切换当前画布（已完成）

- 根因：`confirmAnnotationComposite()` 已将合成 PNG 写入 Output、历史和参考图槽，但成功事务仍把 workspace `currentImageId` 保留为旧图，顶层 `currentImage` 也未更新，所以画布继续显示原图。
- 修改：成功提交时将目标 workspace 的 `currentImageId` 和活动 workspace 的 `currentImage` 一次性切换为 `nextItem`；同时关闭结果/历史预览、清除旧对比图与蒙版状态，保留原图历史和原参考图槽。结构化标注继续清空，失败/取消仍保留标注。
- 自动化：`npm run typecheck`、标注 Store/合成/工具栏定向测试（8+4+2）和 `git diff --check` 通过。
- Codex 浏览器：`http://127.0.0.1:5173/?preview=mac-workspace` 绘制矩形并确认后，画布立即显示合成像素图；参考图 2 -> 3、历史 15 -> 16，工具收起，控制台新增 warning/error 为 0。
- 约束：未调用真实/付费生图，未修改 Android、V2.0.3、用户图片、API 凭据或远程 GitHub；当前工作树仍未提交，回退只使用后续明确提交的 `git revert`。

## 2026-08-22 批次 45：确认合成后清理结构化标注（已完成）

- 用户确认：`确认标注`成功后，标注已全部转换为输出 PNG 像素；当前画布不应继续叠加旧箭头或文字，打开新增参考图时只显示合成后的像素结果。
- 修改：合成事务成功提交时将 `annotations` 清空、`selectedAnnotationId` 置空，并从通用 `undoStack/redoStack` 移除标注类记录；蒙版和其他画布撤销记录不受影响。失败、取消、越界返回调整和工作区竞态仍保留原标注供继续编辑。
- 浏览器验收：确认后重新打开标注工具，原图画布无旧矢量覆盖；新增参考图卡槽可打开，预览中仅保留 PNG 内已经栅格化的像素标注；历史 16 项、参考图 3 张，控制台新增 warning/error 为 0。
- 自动化：typecheck、定向标注合同 14/14 和 `git diff --check` 通过；上一轮 Node/UI/build、Go、Fast、Batch 门禁结果仍有效。
- 回退点：当前工作树未提交；回退只使用后续明确提交的 `git revert`，不使用 `reset --hard`。

## 2026-08-22 批次 44：标注自动合成与参考图接入（已完成）

- 目标：在现有 Cowart 标注模块内把“确认标注”改为离线栅格化确认，不调用 `submitAnnotationEdit()` 或真实生图；原图和旧参考槽保持不变，成功后清理当前结构化标注。
- 实现：新增 `frontend/src/features/annotation/annotationComposite.ts`，按自然像素绘制箭头、直线、矩形、椭圆、自由画、高亮和多行文字；支持严格越界与“扩展白底并保存”，保留 `100MP / 16,384px / 768MiB` 安全门禁。
- Store：`studioStore.annotations.ts` 捕获 workspace、当前图和标注快照，先写唯一 PNG 到受管 `Output/images`，再注册媒体、持久化历史并追加当前 workspace 参考图槽；失败、取消、竞态和重复点击清理临时文件且不提交半成品。
- 根因修复：Codex 浏览器 preview 夹具使用完整 SVG `data:` 原图，原二进制头尺寸解析误判自然尺寸未知；新增完整 Blob 的浏览器解码尺寸校验，仍禁止使用 `previewWidth/previewHeight` 猜测。
- 浏览器验收：`http://127.0.0.1:5173/?preview=mac-workspace` 实测矩形合成、严格模式“返回调整”（历史/参考图不变）和扩展模式；生成 `480×480` 及 `611×480` PNG，Output、历史和参考图槽同步，原参考图保留，工具成功关闭。
- 自动化：TypeScript、Node `697/697`、UI `117/117`、Windows 构建 `1993 modules`、Lint `0 errors/55 existing warnings`、桌面/CLI Go test+vet、Worker `5/5`、Fast、Batch、`git diff --check` 均通过。
- 约束：未修改 Android 产品行为、V2.0.3、Cowart 源码、用户图片、API 凭据或远程 GitHub；未调用真实/付费生图。Output 仅保留本地隔离 preview 夹具成果，未将图片数据写入 Zustand/workspace/prompt/history。
- 回退点：当前工作树未提交；回退只使用后续明确提交的 `git revert`，不使用 `reset --hard`。下一次接手先复查本节和 `docs/changes/2026-08-21-windows-v2.0.4-cowart-annotation.md`，再决定是否提交或继续 DPI/原生 Wails 实机验收。

## 2026-08-21 批次 43：确认标注按钮行为修复（已完成本轮）

- 根因：`AnnotationToolbar` 的原“批注修图”按钮直接绑定 `submitAnnotationEdit()`，点击会进入 edit source、任务和历史提交链路；它在标注工具内实际应是确认并退出工具。
- 修改：按钮改名为“确认标注”，通过 `onConfirm` 回调只执行 `setField("tool", "pan")`；`Toolbar` 的三条桌面路径均移除 `submitAnnotationEdit` 传入，`studioStore.annotations.ts` 的真实提交 API 保持独立不变。
- 验证：定向合同 7/7、Node 全量 693/693、UI 单线程 117/117、TypeScript 和 Windows 1991 modules 构建通过；Lint 0 errors、55 条既有 warnings；`git diff --check` 在记录更新后执行。
- Codex 浏览器离线验收：`http://127.0.0.1:5173/?preview=mac-workspace`。点击“图像标注工具”后再点“确认标注”，工具回到“拖动 / 缩放 (1)”并收起，历史仍为 15 项，没有“返回图像”或提交状态，新增 warning/error 为 0；未调用真实或付费生图。
- 用户数据隔离：只使用 preview 查询生成的合成工作区；未导入、上传、删除或修改用户图片、历史、API 配置和远程仓库。
- 回退点：本批未提交；如需回退，使用后续明确提交的 `git revert`，不使用 `reset --hard`。
- 下一步接手：若要提供真正的批注修图入口，应在独立按钮或提交面板显式调用 `submitAnnotationEdit()`，不要复用“确认标注”。

## 2026-08-21 批次 42：标注工具选中态可见性（已完成本轮）

- 根因：`AnnotationToolbar` 选中按钮使用的动态 Tailwind 颜色类未生成有效背景和边框，实际计算样式接近透明/白色；点击后 `aria-pressed` 虽然变化，视觉上看不出选中工具。
- 修改：选中态改用项目已有的 `border-[color:var(--accent)]`、`bg-[var(--accent-soft)]`、`text-[color:var(--accent)]`，增加强调色环和阴影；绘制工具、橡皮擦和键盘/状态语义不变。
- 验证：浏览器离线预览确认矩形选中按钮 `aria-pressed="true"` 且 computed background/border/color 使用强调色；定向合同新增 `annotationToolbar.test.mjs`，全 Node `692/692`、UI `117/117`、typecheck 通过，未调用真实生图。
- 回退点：本批当前工作树；回退使用后续明确提交的 `git revert`，不使用 reset；未修改 Android、V2.0.3、用户图片、API 凭据或远程 GitHub。

## 2026-08-21 批次 41：标注展开时固定变换入口（已完成本轮）

- 根因：Windows 工具栏按 JSX 顺序先渲染九个标注控件，再渲染旋转、翻转和局部重绘；标注展开后变换入口被 flex 换到后续行。
- 修改：调整 Windows 工具栏渲染顺序，`TransformSection` 先于可展开的 `ContextualSection`；变换与裁切入口保持第一排，标注工具在后续行展开。Mac 分组布局、按钮行为和标注状态不变。
- 验证：`npm run typecheck` 通过；`node --test frontend/test/clearViewToolbar.test.mjs` 为 `5/5`；Codex 浏览器在 `1252×930` 展开标注后，左转、右转、水平翻转、竖直翻转和裁切局部重绘均为 `y=152`，九个标注工具为下一行；未调用真实生图。
- 回退点：本批当前工作树；回退使用后续明确提交的 `git revert`，不使用 reset；未修改 Android、V2.0.3、用户图片、API 凭据或远程 GitHub。

## 2026-08-21 批次 40：主工具栏旋转图标去重（已完成本轮）

- 根因：主工具组同时显示全局撤销/重做与图片左转/右转，两组都使用相反方向的圆形箭头，视觉上像重复按钮。
- 修改：从 `BaseToolSection` 移除主工具组的撤销/重做按钮及无用传参；保留键盘快捷键、Store 撤销栈、局部编辑工作台和 360 工作台的撤销/重做。图片旋转、水平翻转和竖直翻转入口保持不变。
- 验证：`npm run typecheck` 通过；`node --test frontend/test/clearViewToolbar.test.mjs` 为 `4/4`；Codex 浏览器 `http://127.0.0.1:5173/?preview=mac-workspace` 实测工具栏标题只剩“左转 90°”“右转 90°”“水平翻转”“竖直翻转”，无“撤销/重做”按钮，页面无新增横向溢出，未调用真实生图。
- 回退点：本批当前工作树；回退使用后续明确提交的 `git revert`，不使用 reset；未修改 Android、V2.0.3、用户图片、API 凭据或远程 GitHub。

## 2026-08-21 批次 39：图像标注入口展开/折叠（已完成本轮）

- 根因：Cowart 标注入口仍使用旧的方框图标按钮，九个标注控件始终随 `tool === "annotate"` 展开；入口不够醒目，也没有明确的收起状态。
- 修改：`BaseToolSection` 用与保存按钮一致的蓝色 `ToolbarPrimaryButton` 显示“图像标注工具”，增加上下三角、`aria-expanded` 和稳定 `data-audit-id`；`Toolbar` 增加会话级 `annotationToolsExpanded`，点击入口在展开/收起之间切换，切换到其他工具后再次进入自动展开。无当前图时保持禁用。
- 浏览器验收：`http://127.0.0.1:5173/?preview=mac-workspace` 在 `1252×930`、`1440×900`、`1024×768` 均确认按钮可见、无横向溢出；展开时九个标注控件存在，收起时全部隐藏，再次点击恢复。刷新后检查按钮命中层为真实 `BUTTON`，无应用遮挡；评论标记产生的全屏遮罩已通过刷新清除。控制台新增 warning/error 为 `0`，未调用真实生图。
- 门禁：typecheck、Node `690/690`、UI `117/117`、Windows 构建 `1991 modules`、Lint `0 errors/55 existing warnings`、Fast、Batch、桌面/CLI Go test+vet、Worker `5/5`、离线 smoke 和 `git diff --check` 均通过。
- 用户反馈说明：评论标记会在页面上方注入 `z-index:2147483647` 的透明遮罩，可能导致手动点击暂时失效；这不是应用按钮自身的命中问题，刷新预览即可恢复。
- 回退点：本批工作树改动；回退使用后续明确提交的 `git revert`，不使用 reset。未提交、未设置 upstream、未推送 GitHub。

## 2026-08-21 批次 38：Cowart 标注 DPI/缩放视觉复核（已完成本轮）

- 接手记录：`I:\AI\Image-Studio\cowart-批注能力提取与FHL-V2.0.4模块化接入记录.md`；继续保持 `frontend/src/features/annotation` 与 `studioStore.annotations.ts` 边界，不引入 tldraw/Cowart MCP。
- 当前工作树保留批次 37 的未提交 Cowart 改动；本轮完成 DPI、窗口缩放、natural size 和视觉覆盖复核，并修复复用历史/导入图参考槽误用 preview 尺寸的问题。
- 回退点：批次 37 的现有工作树状态；不使用 reset，不修改 Android/V2.0.3、用户图片、API/Profile 凭据或远程 GitHub，不调用真实生图。
- 若中断，先读取本节和 `docs/changes/2026-08-21-windows-v2.0.4-cowart-annotation.md`，再从门禁结果继续；完成后更新本节为已完成并补充实际浏览器证据。
- 本轮收口门禁：typecheck 通过；Node `690/690`、UI `117/117`、Windows 构建 `1991 modules`、lint（0 errors，55 existing warnings）、Fast、Batch、`git diff --check` 均通过。Batch 同时通过桌面/CLI Go test+vet、Worker `5/5` 和离线 smoke。浏览器隔离预览在 `1252×930`、`1440×900`、`1024×768` 完成九工具交互复核，新增 warning/error 为 0。
- 浏览器曾短暂出现多个图片/预览标签：来源是本轮隔离预览和一次服务未启动的失败导航；不是产品循环打开。正常测试标签已清理，剩余错误页因 Browser Use URL policy 无法由工具关闭，用户可手动关闭该“无法访问此站点”标签；用户原有应用标签未操作。
- 既有 `OpenFile/openVirtualPath` 会在用户主动打开虚拟图片时使用 `window.open` 新建单个标签，属于预期行为；未发现重复监听。natural-pixel 端到端真实生图仍不在本批范围内，离线尺寸合同已通过。
- 批注源图准备失败、重复提交和工作区切换取消已由 Node 合同覆盖；失败不改变模式、参考槽或批注对象。未点击“批注修图”，未调用真实或付费生图。

## 2026-08-21 批次 37：Cowart 全绘图标注模块化接入（已完成本轮）

- 当前分支：`codex/windows-v2.0.4-feature/local-edit-360-parity`；本批未提交、未设置 upstream、未推送远程。
- 新增 `frontend/src/features/annotation/` 独立模块和 `frontend/src/state/studioStore.annotations.ts`。支持 Cowart 批注箭头、普通箭头、直线、矩形、椭圆、自由画、高亮、文字、对象橡皮擦；标注按图像本地坐标保存，旧版四种数据继续兼容。
- `plainArrow` 仅是工具值，保存为 `arrow` + `bend: 0`，不自动打开标签编辑；Cowart 批注箭头按 8px 最小长度、0.12/16/48 bend 规则创建后自动进入多行标签编辑。
- `CanvasStage` 只保留图片、Konva Stage、缩放/平移、坐标转换和蒙版；`AnnotationLayer` 负责标注渲染和预览；`Toolbar`/`toolbarActionSections` 只挂载工具栏、颜色/宽度和“批注修图”。
- `submitAnnotationEdit()` 复用现有 edit source、submit、任务队列、失败恢复、历史和结果网格；prompt 序列化明确保留未标注区域并移除批注痕迹；运行/失败保留原图和批注。
- 验证：`npm run typecheck`、`npm run test:node`（679/679）、`npm run test:ui`（116/116）、`npm run build:windows`（1990 modules）均通过。Codex 浏览器 `http://127.0.0.1:5174/?preview=mac-workspace` 已验收普通箭头无标签编辑、批注箭头多行标签、橡皮擦不改原图，控制台新增 warning/error 为 0。
- 截图证据在工作区外：`I:\AI\Image-Studio\cowart-批注普通箭头验收-20260821.png`、`cowart-批注箭头标签验收-20260821.png`、`cowart-批注橡皮擦验收-20260821.png`、`cowart-批注全工具贴合验收-20260821.png`。
- 详细调查、Cowart 源码定位、数据/Prompt/提交数据流和交给另一窗口的指令：[I:\AI\Image-Studio\cowart-批注能力提取与FHL-V2.0.4模块化接入记录.md](I:\AI\Image-Studio\cowart-批注能力提取与FHL-V2.0.4模块化接入记录.md)。批次记录：[docs/changes/2026-08-21-windows-v2.0.4-cowart-annotation.md](docs/changes/2026-08-21-windows-v2.0.4-cowart-annotation.md)。
- 未运行真实或付费生图；仍需后续在真实 Windows DPI/缩放下观察标签覆盖和自由画/高亮贴合，不得引入第二套 canvas 或持久化。

## 2026-08-21 批次 36：清空视图后工具栏保留（已完成）

- 当前分支：`codex/windows-v2.0.4-feature/local-edit-360-parity`；代码提交 `7b72287 fix(canvas): keep toolbar after clearing view`，后续门禁补丁 `28208ab fix(canvas): guard crop action without image`。本批仅修复空画布工具栏挂载，不修改 Android、V2.0.3、历史/源文件、API 配置或远程 GitHub。
- 根因：`Toolbar.tsx` 和 `BaseToolSection` 在 `currentImage` 为空时卸载工具、变换和对比入口；“清空视图”后只剩空状态，用户无法从同一工具栏恢复操作。复核还发现旧矩形标注可能在删除历史图后残留，因此裁出动作也必须检查当前图片。
- 修复后工具、变换和对比入口继续挂载；没有当前图时图像相关按钮禁用，全屏保持可用，清空按钮按原语义隐藏；残留矩形不会启用“裁出”。新增 `frontend/test/clearViewToolbar.test.mjs`，锁定挂载、禁用和 stale crop 契约。
- 自动化已通过：TypeScript、Node `676/676`、UI `116/116`、Lint `0 errors / 58 existing warnings`、桌面/CLI Go test+vet、Worker `5/5`、`scripts\dev-check.ps1 -Level Batch`、`git diff --check`。
- Codex 浏览器 `http://127.0.0.1:5174/` 新标签真实验收：点击“清空视图”后 12 个工具按钮仍可见，图像操作均禁用、全屏可用；`1252×930`、`1440×900`、`1024×768` 无横向溢出，控制台新增 warning/error 为 `0`。未生成任务、删除历史或源文件。
- 详细记录：[docs/changes/2026-08-21-windows-v2.0.4-clear-view-toolbar.md](docs/changes/2026-08-21-windows-v2.0.4-clear-view-toolbar.md)。回退使用 `git revert 7b72287` 及本批后续门禁补丁，不使用 reset。

## 2026-08-21 批次 35：卷帘对比使用原始参考图（已完成）

- 当前分支：`codex/windows-v2.0.4-feature/local-edit-360-parity`。本批修复普通图双图/卷帘对比左侧误用缩略图的问题；不修改 Android、V2.0.3、用户原图、历史、API 配置或远程 GitHub。
- 根因：参考图已有 `previewUrl` 时旧物化逻辑跳过完整媒体注册，并把缩略图作为 `fullUrl`；画布对比组件直接放大该地址，导致左侧自然尺寸约 `384×216`。
- 修改范围：`compareSourceSelection.ts` 始终按源路径注册完整媒体，外部路径失败时导入受管副本后重试；`historyFullSrc()` 拒绝 thumb/preview 误存地址；`CanvasStage.tsx` 的双图和卷帘左右地址统一走完整媒体 helper。缩略图仅在完整媒体和原始字节均不可用时降级。
- 自动化已通过：TypeScript、定向 Node `19/19`、Node `672/672`、UI `116/116`、Lint `0 errors / 58 existing warnings`、桌面/CLI `go test ./...` 与 `go vet ./...`、Fast、Batch（含 Worker `5/5`、离线 smoke）和 `git diff --check`。源码根目录没有 Go module，Go 门禁在 `image-studio` 与 `go-cli` 两个实际 module 目录执行。
- Codex 浏览器 `http://127.0.0.1:5174/` 已用离线历史验收：修复后左侧地址为受管 `/media/full/...`，自然尺寸 `1753×986`，右侧为 `2048×1152`；修复前同位置为 `/media/thumb/...`、`384×216`。`1252×930`、`1440×900`、`1024×768` 无横向溢出，新增 warning/error 为 `0`；未提交生图、删除历史或源文件。
- 提交：`8c4bedf fix(compare): use original source in curtain comparison`；回退使用 `git revert 8c4bedf`，不使用 reset。未设置 upstream、未推送 GitHub。
- 提交后再次在 Codex 浏览器加载 `http://127.0.0.1:5174/` 完成双图/卷帘真实验收：两种模式均读取 `1753×986` 原图与 `2048×1152` 成图的 `/media/full/` 地址；三档视口无横向溢出，控制台 warning/error 为 `0`。浏览器页面已保留给用户继续试用。
- 详细记录：[docs/changes/2026-08-21-windows-v2.0.4-compare-original-source.md](docs/changes/2026-08-21-windows-v2.0.4-compare-original-source.md)。

## 2026-08-20 批次 34：局部编辑镜头预览拖动（已完成）

- 当前分支：`codex/windows-v2.0.4-feature/local-edit-360-parity`；基线 `f105c40`，代码提交 `86b99c0 feat(local-edit): make lens preview draggable`；文档提交随后完成。未设置 upstream、未推送 GitHub。
- 普通图工作台镜头预览标题栏支持 Pointer Events 拖动，位置只保存在 modal 本地状态；`clampLocalEditPreviewPosition` 将浮窗限制在 `.lew-stage` 内，展开/收起、舞台尺寸变化和窗口 resize 后重新约束。
- 舞台 `frameSize` 更新改为按宽高值比较，预览观察回调只在坐标变化时写状态；修复首次展开时发现的 `Maximum update depth exceeded`。
- 新增 `frontend/test/localEditPreviewPosition.test.mjs`，扩展 `localEditRoundtrip.test.mjs`；定向测试 `7/7`、Node `669/669`、UI `116/116`、TypeScript 和 `git diff --check` 已通过，Lint 为 `0 errors / 58 existing warnings`。
- 桌面/CLI Go test/vet、Worker `5/5`、Fast、Batch 和离线 smoke 全部通过。
- Codex 浏览器隔离验收：拖动位移约 `-119,+81`；展开/收起及 `1252×930`、`1440×900`、`1024×768` 均在舞台边界内、无横向溢出，新增控制台 warning/error 为 `0`。未保存、生成或改变历史。
- 详细记录：[docs/changes/2026-08-20-windows-v2.0.4-local-edit-preview-drag.md](docs/changes/2026-08-20-windows-v2.0.4-local-edit-preview-drag.md)。
- 回退点：`git revert 86b99c0`；文档提交按对应提交单独回退。回退只用 `git revert`。

## 2026-08-20 批次 33：局部编辑 360 交互对齐（已完成）

- 当前分支：`codex/windows-v2.0.4-feature/local-edit-360-parity`；基线 `e7f8475`，代码提交 `f105c40 feat(local-edit): add 360-style planar lens toolbar`；未设置 upstream、未推送 GitHub。
- 普通图工作台新增 360 风格底部工具栏、镜头预览、撤销/重做、清除/重置和 `lensActive` 草稿恢复；几何辅助统一在 `frontend/src/localEdit/lens.ts`。
- 预览优先使用完整媒体 URL；原生/浏览器裁切结果核对实际宽高，并在取消、失败、工作区切换或尺寸不一致时清理受管临时文件和 Output 副本。
- 360 现有实现实际是单 `shot`；本批只复用交互结构和交接入口，不引入 `shots[]`、批量镜头保存或球面投影改写。
- 验证通过：TypeScript、Node `665/665`、UI `116/116`、Lint `0 errors/58 warnings`、Go test/vet、Fast、Batch、`git diff --check`。
- Codex 浏览器 `http://127.0.0.1:5174/` 已完成普通图工作台、比例下拉、镜头拖动/垂直角点缩放、撤销/重做、预览、清除/重置、360 交接和取消验收；`1252×930`、`1440×900`、`1024×768` 越界计数均为 `0`，控制台新增 warning/error 为 `0`，历史数量未改变。
- 中断原因：旧 `5174` Vite 进程停止导致空 HTML；已重启同一源码版本。脏草稿切换时的原生确认框是预期保护，重连后在干净草稿完成验收。
- 详细记录：[docs/changes/2026-08-20-windows-v2.0.4-local-edit-360-parity.md](docs/changes/2026-08-20-windows-v2.0.4-local-edit-360-parity.md)。
- 下一次接手：先确认工作树 clean；若继续增强，补 Output 复制成功后媒体注册失败的清理合同测试，不把大图 Base64 放入状态，不修改 360 球面投影。

## 2026-08-20 批次 32：局部编辑比例与保存流程（已完成）

- 当前分支：`codex/windows-v2.0.4-feature/local-edit-aspect-output`，基线 `84da906`；代码提交为 `6b40095`、`70e837d`，文档回写提交为 `7dae114`、`15c1008`，未设置 upstream、未推送 GitHub。
- 普通图“裁切局部重绘”复用外部比例下拉和形状预览；`Auto` 显示为“自由”，横向/竖向比例独立列出，删除重复横竖切换按钮。
- 新增“保存并编辑”和“保存镜头（不修改）”两种保存意图。两者均按自然像素裁切并写入 Output/历史；前者同步外部比例、解除自动比例锁并填入 `保持构图不变修改画面，将...改为...`，后者保留外部所有编辑参数。
- Wails/浏览器新增受管 `SaveImagePathToOutput` 桥接；`LocalEditPlanarRoundtripRef.outputPath` 持久化，原图不覆盖。工作区切换、取消、刷新和 EmptyState 导入恢复均有异步竞态保护。
- 验证已通过：TypeScript、Node `660/660`、UI `116/116`、Lint `0 errors/58 warnings`、Go test/vet、Fast、Batch、`git diff --check`。
- Codex 浏览器 `http://127.0.0.1:5174/` 已验收普通图工作台、比例 `4:3 -> 184×138`、360 模式共存和取消无历史副作用；`1252×930`、`1440×900`、`1024×768` 无溢出，控制台新增 warning/error 为 `0`。未保存草稿切换时出现的原生确认框已由用户手动确认，属于预期保护。
- 本批 7 个输入夹具、3 个 Output 裁切结果和 SHA-256 清单已移至 `%TEMP%\fhl-v204-local-edit-aspect-output-20260820`；用户图片和既有输出未删除。详细记录：[docs/changes/2026-08-20-windows-v2.0.4-local-edit-aspect-output.md](docs/changes/2026-08-20-windows-v2.0.4-local-edit-aspect-output.md)。
- 下一次接手：先确认工作树 clean，再从当前分支创建新功能分支；若继续增强，优先补 Output 复制成功后竞态失败的临时文件清理 API。

## 2026-08-20 批次 31：浏览器高清局部贴回宿主通道（已完成）

- 当前恢复分支：`codex/windows-v2.0.4-feature/browser-pasteback-host`；基线为 `9cb4461`，代码提交为 `61a2b50 fix(local-edit): add browser high-resolution crop and pasteback host`，文档提交为 `7a63d59 docs(dev): record browser high-resolution pasteback closure`。
- Codex 浏览器已用 `7876×10835`（约 85MP）合成大图完成“裁切局部重绘 -> 对齐 -> 确认贴回”；输出保持 `7876×10835`，裁切外像素保持，终态标记为“局部贴回”。
- 浏览器开发服务增加路径受限的 Sharp 裁切/贴回接口；浏览器只传受管路径和参数，不把整图 Base64 放入状态；Wails 原生方法仍优先。
- 100MP 源图和大蒙版在完整解码前分别以约 `915MiB`、`804MiB` 估算被 `768MiB` 门禁拒绝；失败不会产生输出或历史半成品。
- 已通过 Fast、Batch、TypeScript、Node `658/658`、UI `116/116`、Go test/vet、Worker `5/5`、Windows `1982 modules` 构建和浏览器三档视口验收；Lint 为 `0 errors / 58 warnings`。
- 本轮合成夹具已移出项目 `input`，可恢复副本位于 `%TEMP%\fhl-v204-cleanup-20260820`；未修改用户图片、Android、V2.0.3、正式附件或远程 GitHub。
- 回退点：`git revert 61a2b50`；文档提交单独回退。未创建标签或发布物。
- 详细记录：[docs/changes/2026-08-20-windows-v2.0.4-browser-pasteback-host.md](docs/changes/2026-08-20-windows-v2.0.4-browser-pasteback-host.md)。

## 2026-08-19 批次 30：参考图同步与高清裁切局部重绘（已完成）

- 当前分支：`codex/windows-v2.0.4-feature/reference-slot-workspace-sync`；代码提交为 `5df05a9 fix(state): close reference slot workspace restore race` 和 `70be0a5 fix(local-edit): harden high-resolution planar pasteback`。文档提交完成后工作区应保持干净，未设置 upstream、未推送 GitHub。
- 根因已闭环：参考图动作、异步物化和失败任务参数现在都按目标 workspace 的实时列表合并，删除后添加、切换 `1K/2K/4K`、切换标签和刷新恢复不会复活旧槽位。
- Windows `PasteLocalEdit` 先做 `DecodeConfig` 门禁，原图上限 `100MP / 16,384px`，编辑图/蒙版上限 `64MP / 16,384px`；超过 `64MP` 的源图不进入浏览器整图 Canvas，按自然像素裁切范围输出完整尺寸 PNG。
- 85MP 隔离夹具实测输出同尺寸、裁切外采样保持、源文件哈希不变；102MP 在约 7ms 内被解码前门禁拒绝。360 蒙版、羽化和颜色规则继续复用，入口文案为“裁切局部重绘”。
- Codex 浏览器隔离端口 `5174` 已完成删除/添加/分辨率/标签/刷新/清空重加和 `1252x930`、`1440x900`、`1024x768` 验收，页面控制台新增 warning/error 为 `0`。
- 自动化已通过：TypeScript、Node `651/651`、UI `113/113`、Lint `0 errors / 58 warnings`、桌面/CLI Go test/vet、Fast 和 Batch（含 Worker `5/5`、离线 smoke）。
- 详细记录：[docs/changes/2026-08-19-windows-v2.0.4-reference-slot-high-res-closure.md](docs/changes/2026-08-19-windows-v2.0.4-reference-slot-high-res-closure.md)。

## 2026-08-19 批次 29：FHL 浏览器相机 JPEG 规范化（已完成）

- 当前分支：`codex/windows-v2.0.4-feature/fhl-upload-browser-proxy-failed-params`；本批代码提交为 `54e5cfc fix(fhl-upload): normalize browser camera JPEGs`，未设置 upstream、未推送 GitHub。
- 根因已复核：失败相机原图为 `5168×3448`、约 `9.08MB`、含约 `44KB` EXIF；同图规范化为 `1600×1067`、无 EXIF JPEG 后，FHL Images 图生图成功。此前 `7999/8000/8192/8193px` 合成尺寸测试均成功，问题不是单一 8K 边界。
- 浏览器 FHL Images/Responses 编辑上传现在在 CLI 前按长边 `1600px`、文件 `6MiB`、透明通道三项预检；命中任一条件就生成白底、质量 `88`、无元数据 JPEG 临时副本，原图和历史不变。
- Codex 浏览器真实验收已用原始相机 JPEG 完成单任务 FHL Images 生图，结果成功并显示 `1536×1024`；任务结束后临时副本清理，控制台 warning/error 为 `0`。
- 自动化：TypeScript、Node `647/647`、UI `107/107`、Lint `0 errors/58 existing warnings`、Fast、Batch、`git diff --check` 均通过；新增相机 JPEG、已安全图片和非 FHL provider 隔离测试。
- 详细记录：[docs/changes/2026-08-19-windows-v2.0.4-fhl-browser-camera-normalization.md](docs/changes/2026-08-19-windows-v2.0.4-fhl-browser-camera-normalization.md)。
- 下一步：观察真实用户大图任务；若规范化后的 `1600px` 无元数据 JPEG 仍返回同类 400，另开格式/透明通道/模型兼容性批次，不继续盲目降低尺寸。

## 2026-08-19 批次 28：FHL 浏览器代理大图保护与失败任务参数菜单（已完成）

- 当前分支：`codex/windows-v2.0.4-feature/fhl-upload-browser-proxy-failed-params`；本批提交为 `1c125be fix(fhl-upload): guard browser proxy and failed task params`，未设置 upstream、未推送 GitHub。
- 根因已修复：Codex 浏览器批量任务走 `browserJobClient -> browserJobProxy -> gptcodex-image.exe`，此前绕过 remote-kernel 的 FHL 长边保护。代理现在只对官方 FHL、编辑模式、Images/Responses 参考图执行真实像素预检。
- 超过 `8192px` 长边的参考图按比例生成白底 JPEG 临时上传副本；真实浏览器用 `9000×6000` 图验证得到 `8192×5461`，FHL Images 图生图最终成功，任务结束后临时副本已清理，原图和历史未修改。
- 失败任务卡片右键菜单已接入共享历史上下文；浏览器实测“应用参数（不生成）”可恢复提示词、尺寸、质量和参考图，不创建新任务。
- 验证完成：TypeScript、Node `644/644`、UI `107/107`、Lint `0 errors/58 warnings`、`dev-check.ps1 -Level Fast`、`Batch`、`git diff --check` 全通过；Codex 浏览器控制台 warning/error 为 `0`。
- 详细记录：[docs/changes/2026-08-19-windows-v2.0.4-fhl-browser-proxy-failed-params.md](docs/changes/2026-08-19-windows-v2.0.4-fhl-browser-proxy-failed-params.md)。
- 下一步：观察真实用户大图日志；若 `8192px` 内仍复现同类 400，另开格式、透明通道、模型或 Images 编辑兼容性批次，不继续降低本批上限。

## 2026-08-19 批次 27：FHL 图生图参考图长边保护（已完成）

- 已在同一 FHL Images 配置下顺序真实测试 `7999 / 8000 / 8192 / 8193px` 四张同源 JPEG，四次均返回完整 `b64_json`；原 400 不能认定为单纯 8K 尺寸边界。按批准规则，浏览器安全上限固定为 `8192px`。
- Windows 浏览器 FHL Images / Responses 图生图现在先读取每张参考图真实尺寸；超过 `8192px` 时生成等比例白底 JPEG 上传副本，`preparedBase` 不能绕过。原图、历史和受管媒体不修改。
- 解码/编码失败在请求前阻断；安全尺寸内出现同类 400 时明确提示格式、透明通道、模型或 Images 编辑兼容性，不继续盲目缩小。APIMart、RunningHub、提示词服务和 Android 原生链路保持原行为。
- 新增 FHL 上传预处理和请求链回归；TypeScript、Node `642/642`、UI `107/107`、Lint `0 errors/58 warnings`、Fast、Batch 全通过，Batch 含桌面/CLI Go test+vet、Worker `5/5` 和离线 smoke。
- Codex 浏览器真实执行 `9000x100 PNG -> 8192x91 JPEG`，副本可解码、原 data URL 不变；主应用保持 1 个工作区和 37 项历史，控制台 warning/error 为 `0`。
- 分支：`codex/windows-v2.0.4-feature/fhl-upload-dimension-guard`；未设置 upstream、未推送 GitHub。详细记录：[docs/changes/2026-08-18-windows-v2.0.4-fhl-upload-dimension-guard.md](docs/changes/2026-08-18-windows-v2.0.4-fhl-upload-dimension-guard.md)。
- 下一步：若真实图片在 `8192px` 内仍复现相同 400，另开格式/透明通道/模式兼容性批次，不扩大本批 provider 范围。

## 2026-08-18 批次 26：局部贴回像素边界与 2K 默认修复（已完成）

- 已读取 360 `image-studio/frontend/src/panorama/core.ts` 的 `mapPanoramaPastebackSample` / `pastePanoramaRoundtripBase64`。其规则是：原始镜头矩形定义物理贴回范围，编辑图尺寸只影响采样；普通图现已遵循同一规则。
- 修复普通图自动贴回：`cropRect` 始终是默认物理覆盖范围，超分辨率或任意尺寸编辑结果只被双线性重采样到该范围；裁切框外像素保持不变。手动平移、缩放、旋转、蒙版、羽化和色彩调整保留。
- 修复旧工作区缺失尺寸字段的回退；`normalizeWorkspaceSize` 现在使用 `DEFAULT_FHL_SIZE`。`createDefaultWorkspace` 和一键初始化路径均保持 `2048x2048`（2K），已有历史显式尺寸不改写。
- 新增高分辨率越界回归测试和 2K 初始化断言；未在用户历史上点击自动贴回或一键初始化。
- 验证：`npm run typecheck`、Node `635/635`、UI `107/107`、Lint `0 errors/58 warnings`、`git diff --check`、Fast、Batch 全部通过；Batch 包含桌面/CLI Go test+vet、Worker `5/5` 和离线 smoke check。
- Codex 浏览器 `http://127.0.0.1:5173/` 已复核主界面默认显示 `2K`，普通图/360/贴回入口仍在，控制台 warning/error 为 `0`；未调用真实 API。
- 提交：`5b3e465 fix(defaults): keep reset resolution at 2K`、`4f19de3 fix(local-edit): fit automatic pasteback to crop bounds`。
- 详细记录：[docs/changes/2026-08-18-windows-v2.0.4-local-edit-pasteback-defaults.md](docs/changes/2026-08-18-windows-v2.0.4-local-edit-pasteback-defaults.md)。

## 2026-08-18 批次 25：普通图局部编辑面板对齐 360 工作流（已完成）

- 普通图局部编辑弹窗已收窄为“输出管理 / 镜头参数 / 输出 / 工作台”，移除弹窗内提示词、AI 优化、风格、生成、外部导入和对齐入口；外部主编辑区成为唯一提示词管理位置。
- 比例支持 `自由、1:1、4:3、3:2、16:9、2:1`，并新增横竖切换：`4:3↔3:4`、`3:2↔2:3`、`16:9↔9:16`、`2:1↔1:2`；自由和 `1:1` 禁用方向切换，镜头中心、边界和自然像素尺寸保持正确。
- 裁切成功后立即创建局部裁切副本、切换主界面图生图模式并清除工作台草稿；取消不新增历史。旧工作台 `edit/align` 草稿恢复时丢弃草稿，不影响已有历史和贴回入口。
- 360 模式仍跳转现有 `PanoramaViewerModal`；浏览器实测普通图面板分区、比例方向切换、自由比例禁用、取消无历史副作用和 360 镜头面板回归通过，当前 `1252×930` 无溢出、控制台无错误。
- 自动化：`npm run typecheck`、局部合同测试、UI `107/107`、Lint `0 errors/58 warnings`、`git diff --check` 已通过；Fast/Batch 与三档视口验收待批次收口时执行。
- 详细记录：[docs/changes/2026-08-18-windows-v2.0.4-local-edit-panel-alignment.md](docs/changes/2026-08-18-windows-v2.0.4-local-edit-panel-alignment.md)。

## 2026-08-18 批次 24：局部编辑清晰度与面板可读性修复（已完成）

- 工作台原先优先使用 `media/thumb/...` 缩略图，2048×1360 原图在弹窗中放大后发糊；现优先使用 `/media/full/...` 或受管原图路径，浏览器实测自然尺寸为 `2048×1360`。
- 右侧控件被全局表单样式覆盖成白底浅字；现使用工作台专用深色高对比样式，参数字号提高，面板扩大到 380px，`2K 方形 2048×2048` 等选项完整显示。
- Codex 浏览器三档视口 `1252x930`、`1440x900`、`1024x768` 均无溢出，控制台 warning/error 为 0。
- 自动化：`npm run typecheck`、Node 634/634、Lint 0 errors/58 warnings、`git diff --check` 通过；`dev-check.ps1 -Level Fast` 和 `Batch` 均通过，Batch 包含 UI 107/107、桌面/CLI Go test+vet、Worker 5/5 和离线 smoke check。
- 详细记录：[docs/changes/2026-08-18-windows-v2.0.4-local-edit-clarity.md](docs/changes/2026-08-18-windows-v2.0.4-local-edit-clarity.md)。

## 2026-08-18 批次 23：普通图局部编辑镜头框定位（已完成）

- 当前分支：`codex/windows-v2.0.4-feature/unified-local-edit-workbench`；本批在现有工作台提交上继续开发，未设置 upstream、未推送 GitHub。
- 普通图点击“局部编辑”现在无需先画矩形，直接打开工作台并创建居中的单镜头 `1:1` 框；已有矩形标注只作为初始镜头位置。
- 新增可恢复的 `LocalEditLens`，保留 `cropRect` 兼容旧草稿；镜头支持标准比例、拖动、四角缩放、比例锁定、自然像素边界约束和窗口尺寸自适应。
- 360 模式、球面投影、整图蒙版和现有局部贴回链路未重写；普通图旋转继续在后续对齐阶段处理。
- 验证：`npm run typecheck` 通过；`npm run test:node` 634/634；`npm run lint` 0 errors、58 个既有 warnings；`git diff --check` 通过。
- 项目门禁：`dev-check.ps1 -Level Fast` 和 `dev-check.ps1 -Level Batch` 均通过；Batch 包含 Node 634/634、UI 107/107、桌面/CLI Go test+vet、Worker 5/5 和离线 smoke check。
- Codex 浏览器真实验收：无矩形直接打开、`1:1`/`16:9` 比例切换、拖动、角点缩放、边界吸附、取消不新增历史、普通/360 模式切换；`1252x930`、`1440x900`、`1024x768` 无溢出，控制台 warning/error 为 0。
- 为避免修改用户历史，本轮未在浏览器点击“确认裁切并编辑”、生成或导入；提交路径已由类型检查、Node 合同和现有离线裁切链路覆盖。
- 下一步：在独立离线夹具工作区验证确认裁切、外部导入、对齐贴回终态和刷新恢复；不调用真实 API，不修改 V2.0.3。

## 2026-08-18 批次 22：统一局部编辑工作台（开发中）

- 已从 `110f698` 创建功能分支 `codex/windows-v2.0.4-feature/unified-local-edit-workbench`。
- 实现提交：`aa822ef feat(local-edit): add unified local edit workbench`；几何修正提交：`32b1c38 fix(local-edit): align crop frame with source aspect`；当前工作区干净，未设置 upstream。
- 新增普通图/360 双栏工作台入口、工作区轻量草稿持久化、比例/尺寸/质量/提示词/导入控件；普通图选区确认前不创建历史，取消不增加历史。
- 普通图继续复用现有自然像素裁切、平面贴回和对齐器；360 模式继续进入既有球面查看/贴回链路。非 2:1 源图在全景模式显示保护提示并阻止全景生成。
- `npm run typecheck`、`npm run lint`（0 errors/58 warnings）和 `npm run test:node`（634/634）通过。
- Codex 浏览器真实验收已覆盖普通历史图、选区打开、普通/360 切换、非 2:1 保护、取消无历史副作用；视口 `1252x930`、`1440x900`、`1024x768` 无横向溢出，控制台 warning/error 为 0。
- 第二轮复核确认裁切 frame 与原图实际显示比例一致，2048×1360 图像的 frame 与裁切框不再落入留白区；控制台仍为 0。
- 尚未点击确认裁切、生成或导入，避免修改用户历史和真实 API；下一轮需用离线夹具验证工作台提交、PNG/JPEG/WebP 导入、对齐终态和刷新恢复。
- 详细记录：[docs/changes/2026-08-18-windows-v2.0.4-local-edit-workbench.md](docs/changes/2026-08-18-windows-v2.0.4-local-edit-workbench.md)。

## 2026-08-18 批次 21 收口：浏览器验收与入口修复

- 在 `713767a` 上完成最后一轮 Codex 浏览器真实验收；发现并修复新画矩形未自动选中导致“局部编辑”仍提示框选的问题。修复代码使用显式选中矩形，否则使用最近创建的矩形。
- 修复后的浏览器流程已通过：普通图选择区域、创建局部裁切副本、打开平面对齐器、移动/缩放/旋转/羽化/色彩、启用并绘制精细蒙版、确认贴回；最终生成“局部贴回”终态并关闭对齐器。全景工作台、普通局部编辑和整图蒙版入口同时可见。
- 浏览器控制台 errors `0`，未调用真实或付费 API。浏览器验收使用本机既有离线历史图，未导入用户私有文件。
- 定向 `localEditRoundtrip` 合同测试 `3/3`、Fast、Batch 全部通过；Batch 包含 Node `634/634`、UI `107/107`、桌面/CLI Go test+vet、Worker `5/5`，Lint `0` errors/58 既有 warnings。
- 本轮文档和修复已提交为 `ced6473`（`fix(local-edit): use newest rectangle selection`）；提交后从新提交继续，不推送 GitHub。浏览器验收曾新增两条可识别的临时局部编辑记录，已在用户确认后逐条删除，当前历史已恢复为原有 `30` 项，其他历史未改动。

## 2026-08-18 批次 21：通用局部编辑往返

- 本批从 `4042440` 创建并验证分支 `codex/windows-v2.0.4-feature/planar-local-edit-roundtrip`，新增普通图片局部裁切、编辑/外部导入、对齐和贴回原图能力；全景球面模式保持不变。
- 实现提交：`d9cf356`，已通过合并节点 `993e5d6` 合并回 `codex/windows-v2.0.4-development`；工作区当前应保持干净，后续从主开发线继续人工验收。
- 新增 `LocalEditRoundtripRef`、平面贴回核心和统一对齐器分支；普通图入口已接入工具栏、画布快捷操作、历史栏、时间线和结果详情；整图蒙版编辑保留。
- 自动化通过：TypeScript、Node `634/634`、UI `107/107`、Lint `0/58`、Windows 前端构建 `1,980 modules`、`git diff --check`；全部离线，无真实 API。
- 新增详细记录：[docs/changes/2026-08-18-windows-v2.0.4-local-edit-roundtrip.md](docs/changes/2026-08-18-windows-v2.0.4-local-edit-roundtrip.md)。
- 当前恢复点：继续检查本批分支的桌面人工验收和 Fast/Batch 门禁；不要修改 Android、V2.0.3、正式附件或推送 GitHub。

## 2026-08-18 收口状态：专业本地开发环境

- V2.0.4 本地开发环境已完成：主线为 `codex/windows-v2.0.4-development`，`origin` 仅作只读参考，无 upstream，未授权 push 会被版本化 hook 阻止。
- `dev-setup.ps1` 已修正为幂等校验：`windows-v2.0.4-dev.0` 永远指向原始基线 `e29d40fb60dc88e14a8bcfad6942714b35759576`，后续提交不会导致重复初始化失败；归档说明会展开实际 bundle 和源码 ZIP 文件名。
- Fast、Batch、Milestone 已通过。V2.0.3 正式附件只读校验通过：Portable `45B7BCB232F967531A8BE03FFD784A31754EE3E1EB6BA33120A3B29B68182FF1`，Source `B3068A34BDD21961CB59F97EDA65ED32A8F952C975EF98A5C2D4C5E8999EF12E`。
- 核心收口提交为 `c2d6707`、`6ba2094` 和 `8309aad`；本地标签 `windows-v2.0.4-dev.6` 指向 `8309aad`。最终归档位于 `V2.0.4-开发版\开发归档\20260818-160026-windows-v2.0.4-dev.6`，bundle `1F7B75C7D284A02AE649623510712F355A59C9DBFFED388823152714DD839948`，源码 ZIP `03E56EA255E1021139D7625E4BE72CF9537A55CD56F0DF83513CCE81DFF07381`；独立恢复通过。
- 未推送 GitHub，未创建正式 release 标签，未修改 V2.0.3 或更早版本。本文件的最终归档证据更新是 `dev.6` 后的文档提交，不改变已归档的工具和应用代码。
- 恢复入口：先运行 `一键初始化V2.0.4开发环境.cmd`，批次完成运行 `一键检查V2.0.4开发批次.cmd`，里程碑再运行 `一键归档V2.0.4里程碑.cmd`。
- 里程碑入口在干净主开发线上通过 Milestone 后会自动创建下一个本地 `dev.N` 标签，用户不需要手工执行 Git 命令。
- 首次 Windows PowerShell 双击归档在创建已验证 `dev.5` 标签后发现本机缺少 `Get-FileHash`，未写 manifest；不完整目录已移入回收站，标签作为验证断点保留。SHA-256 改为纯 .NET 后，无参数入口自动创建 `dev.6` 并完成最终归档与独立恢复。

## 批次 20：专业本地开发环境

- 只治理 V2.0.4 源码仓库；V2.0.3 及更早版本、正式附件和历史证据未修改。
- 当前分支继续为 `codex/windows-v2.0.4-development`；环境规范提交为 `46d28c7`、`84b2a5d`、`8b66b96`，首次初始化后建立本地标签 `windows-v2.0.4-dev.0`。
- 新增本地优先 Git 规范、版本化 `.githooks`、`dev-setup.ps1`、分层 `dev-check.ps1` 和 `archive-v2.0.4.ps1`；`origin` 保留为只读参考，无 upstream，未授权推送会被 hook 阻止。
- V2.0.4 外层新增 `开发归档` 用途约束；归档只包含 Git bundle、跟踪源码快照、SHA-256 清单和恢复说明，不进入源码 Git。
- 新增中文开发工作流、批次模板和三个外层双击入口：初始化、批次检查、里程碑归档。
- 本批不调用真实或付费 API，不修改 API/Profile，不生成正式发布附件，不创建 `windows-v2.0.4-release`。
- Milestone 已通过：Batch 全部测试、Windows 前端构建、Wails Windows 构建、干净 Git 跟踪源码合规扫描 `Issues: 0`、构建副作用恢复和工作区 clean；现有 Codex 浏览器验收证据已确认。
- 恢复点：先运行 `一键初始化V2.0.4开发环境.cmd`，再按 [docs/development-workflow.md](docs/development-workflow.md) 进行批次开发；不要修改旧版本目录。

## 批次 19 完成状态

- 修复 Codex 内置浏览器参考图右键粘贴因 `navigator.clipboard.read()` 权限被拒绝而无法导入的问题。
- 原有直接读取路径保持不变；权限不可用或被拒绝时自动打开“粘贴参考图”，聚焦原生 `paste` 接收框，支持 `Ctrl+V` 追加或稳定路径替换，并提供本地文件选择降级。
- 相关辅助函数区分直接读取权限失败与空/不支持内容；原生粘贴只接受 PNG、JPEG 和 WebP，不记录图片内容、路径或剪贴板错误细节。
- 自动化通过：Node `628/628`、UI `107/107`、TypeScript、Lint `0/58`、Windows 前端构建 `1,979 modules`、版本漂移检查和 719 文件源码合规扫描。
- Codex 浏览器真实复现权限拒绝后，使用离线合成 PNG 完成右键粘贴、弹窗 `Ctrl+V` 和导入成功验收；随后恢复参考图 0 张，精确测试文件已移入回收站，未新增控制台 warning/error。
- 恢复点：从批次 19 本地提交继续；不得把网页剪贴板权限扩大为任意磁盘读取，也不得修改 Android、V2.0.3、API/Profile 或用户历史。

## 批次 18 完成状态

- 目标：完成多标签创作会话强隔离；基线提交 `30cf3375011518acd2f0e7266150fa084767995f`。
- 18A 已提交为 `9b29944`：Profile、传输模式和反推图进入工作区，会话升级 v2，新标签只继承 API 选择。
- 18B 已提交为 `82073ab`：提示词、反推、文件/剪贴板导入、历史物化和画布变换均按工作区令牌回写；关闭、重置和同类请求取代会丢弃迟到结果。
- 18C 已完成：蒙版、标注、笔画、对比、缩放、工具、视图与撤销栈按工作区保存运行态；关闭活动标签先确认，只取消目标标签任务并释放目标画布内存。
- 完整自动化通过：Node `628/628`、UI `105/105`、TypeScript、Lint `0/58`、Windows 前端构建、桌面/CLI Go test+vet、Worker `5/5`、版本、格式和 718 文件源码合规检查。
- Codex 浏览器完成双标签功能回归及 `1920x1080`、`1440x900`、`1024x768` 最终矩阵；控制台 warning/error 为 0，重载后两个原标签、活动标签和 30 项历史保持不变。
- 恢复方式：从三个 18A/18B/18C 本地提交继续后续批次；不得回退批次 17、修改 V2.0.3、调用真实 API、生成发布附件或推送 GitHub。

## 当前状态

- 开发目标：Windows 桌面版 `V2.0.4`。
- 正式基线：标签 `windows-v2.0.3-release`，提交 `814da3e64566cc2e7838378639a3c5e7b6e8b948`。
- 当前本地分支：`codex/windows-v2.0.4-development`；未推送、未创建 PR、未修改 GitHub Release。
- 活动版本：界面、Wails、桌面 Go、CLI、E2E、构建与发布链由 `product-version.json` 统一为 `V2.0.4`。
- 初始化、Codex 浏览器入口和 18 个后续批次均已完成；批次 18 完成多标签工作区、异步结果、画布运行态和关闭行为隔离。

## 批次 17 结果

- 目标：优化参考图卡槽的完整比例显示、悬浮预览、双击大图及右键复制/粘贴替换。
- 已完成代码：指定 `path` 的稳定替换契约、PNG/JPG/WebP 剪贴板读取、原图 PNG 复制、Windows `56px` 高动态宽度卡槽、250ms 悬浮浮层及单击对比/双击大图隔离。
- 浏览器复核发现旧 `.source-thumb img` 规则仍把最终计算样式设为 `cover`；已增加 Windows 卡槽专用高优先级 `contain` 规则，并以浏览器计算样式和 Node 合同同时锁定。
- Codex 浏览器已完成普通/批处理右键粘贴、复制、替换、删除、悬浮和双击，并通过 `1920x1080`、`1440x900`、`1024x768` 布局验收；设置与 360 弹窗在 1024 档完整位于视口内。
- 自动化通过：TypeScript、Lint `0/58`、Node `625/625`、UI `90/90`、Windows 构建 1,976 modules、桌面/CLI Go test+vet、Worker `5/5`、版本、格式和 709 文件源码合规快照。
- 三档页面横向溢出为 0，最终已恢复 `1239x930`、文生图、参考图 0、API 十槽已配置和现有 24 项历史；本批 6 个导入副本及 3 个临时原图已移入回收站并复查不存在。
- 未调用 API、生成图片、读取完整 Key、生成发布附件或推送 GitHub。
- 禁止在恢复时调用生成、连接测试、提示词 API、重试已有失败任务或修改用户 API/Profile。

详细记录：`docs/changes/2026-08-17-windows-v2.0.4-source-image-slot-interactions.md`。

## 批次 16 结果

- 新增最大 64 KiB 的十槽解析器、固定掩码批量弹窗和 Wails/浏览器剪贴板能力；支持 BOM、三种换行、编号、Bearer、赋值语句、说明行、去重、无效行和十槽截断统计。
- 批量确认只清除未保存草稿并预填槽 1-N；原文不进入 DOM，password value 保持空，关闭子/父弹窗或刷新立即丢弃内存 Key，已保存槽只显示“已保存密钥”。
- 保存事务先读取全部现有凭据、检查活动任务和覆盖/迁移计划，再直接写入 Keyring 并逐槽回读；全部目标验证后才清理旧重复槽，失败信息只包含槽号。
- 自动化通过：Node `624/624`、UI `76/76`、TypeScript、Lint `0/58`、Windows 1,974 modules、桌面/CLI Go test+vet、Worker `5/5`、版本、格式和 704 文件源码合规快照。
- Codex 浏览器在 `1920x1080`、`1440x900`、`1024x768` 完成十个合成 Key 的真实粘贴、固定掩码、取消、Esc、确认、单槽多行转入和重载验收；控制台 warning/error 为 0，最终恢复 `1239x930`、文生图、历史 14 项和 Images 十槽 `10/10`。
- 未点击保存、连接测试、生成、重试或注册链接，未读取完整 Key、调用真实 API、修改 Android、生成发布附件或推送 GitHub。

详细记录：`docs/changes/2026-08-17-windows-v2.0.4-bulk-api-configuration.md`。

## 批次 15 结果

- 新增源码根目录/Portable EXE 同级 `顶部推广信息.txt`；公告、群号、注册文案和 HTTP(S) 注册链接按固定键独立控制，缺失、空白、超限或读取失败时安全隐藏，不使用硬编码回退。
- Vite 与 Wails 只暴露固定 `GET/HEAD /__image-studio-files/header-promotion`，最大读取 16 KiB，不接受路径参数；Portable 和 release-source 脚本只在源文件存在时复制。
- 解析、加载、UI、Vite 文件合同、Go 路由和打包合同均有回归；Node `609/609`、UI `67/67`、TypeScript、Lint `0/58`、Windows 1,970 modules、桌面/CLI Go test+vet、Worker `5/5`、版本、格式和 696 文件源码合规快照通过。
- Codex 浏览器在 `1920x1080`、`1440x900`、`1024x768` 验证默认、仅注释和恢复三种状态；无横向溢出、控件重叠或控制台 warning/error，最终恢复默认 TXT、文生图和原始 `1239x930`。用户现有 14 项历史、2 个失败入口及 14 个 API Profile 未改变。
- 未点击注册链接、生成、重试、初始化、连接测试或提示词 API；未生成 EXE/ZIP、Portable、标签、Release 或 GitHub 推送。

详细记录：`docs/changes/2026-08-17-windows-v2.0.4-header-promotion-txt.md`。

## 批次 14 结果

- Windows 浏览器开发模式现在按 `版本检查 -> 开发 CLI 准备 -> Vite` 启动；Go 源码或版本清单变化时自动重建 `runtime\cli\gptcodex-image.exe`，无变化时按内容摘要跳过。
- 外层 Codex 浏览器启动器增加 Go 预检，并统一为 CMD 可稳定解析的 UTF-8 BOM + CRLF；开发 CLI 和摘要状态均为 Git 忽略的本地产物。
- 失败合同锁定 CLI 准备失败时 Vite 不启动；真实冷启动从 CLI 完全缺失状态生成 `V2.0.4` 代理并在 `127.0.0.1:5173` 启动成功。
- 前端 Node `603/603`、UI `64/64`、TypeScript、Lint `0/58` 和 Windows 1,968 modules 构建通过；桌面/CLI Go test+vet、Worker `5/5`、版本、格式和受跟踪源码快照合规通过。
- Codex 浏览器三档验收无越界、截断或控制台错误；最终恢复 `1239x930`、文生图、活动 API“已配置”和 14 个 Profile。用户已有 2 个排队记录和 2 个失败入口保持不变。
- 未重试、取消或清理现有任务，未调用生成、连接测试或提示词 API；没有发布、Portable、GitHub 推送、标签或 Release。

详细记录：`docs/changes/2026-08-17-windows-v2.0.4-browser-development-cli-bootstrap.md`。

## 开发边界

- 只修改当前 V2.0.4 源码；不得修改 V2.0.3 正式版、旧开发版、桌面版根说明或历史证据。
- 保留稳定 namespace `fhl-image-studio-desktop`、开发 namespace `fhl-image-studio-desktop-dev` 和 `migration.desktop-v2.0.3`。
- 不复制或提交 API Key、`*.local`、`config/webview`、用户图片、输出、日志、缓存、`node_modules`、EXE 或 ZIP。
- Photoshop 插件和 Android 是独立项目；未经单独授权，不调用真实或付费 API。

## 批次 12 结果

- APIMart/RunningHub desktop executor 增加锁内远程终态 claim；Complete、Fail、Cancel 和 watchdog 只有第一个调用方能落终态，重复或迟到回调幂等。
- Complete 在保存图片前 claim，避免并发重复写结果、缩略图和媒体记录；公开 Bridge v1 方法、路径、字段及 `succeeded/failed/cancelled` 状态保持不变。
- 增加 2 小时后端 watchdog；前端失联后统一失败、清理临时输入、发送一次 remote cancel 并释放单任务槽，正常终态和 ClearProfile 均会停表。
- 浏览器远程任务统一发送一次 `settled`，成功、失败和取消的事件顺序由 Node 行为测试锁定。
- 前端 Node `596/596`、UI `64/64`、TypeScript、Lint `0/58` 和 Windows 1,968 modules 构建通过；桌面/CLI Go test+vet、Worker `5/5`、版本漂移、格式和源码合规扫描通过。
- Windows 环境因 CGO 未启用不能执行 Go `-race`；16 路并发终态 claim 测试、锁内状态转换和完整 Go test/vet 均通过。
- Codex 浏览器三档真实点击通过，横向越界、控件截断和控制台 warning/error 为 0；已恢复原始 `1239x930`，单一空白工作区、历史 0、活动 API“已配置”和 14 个 Profile 不变。
- 未确认初始化、切换 Profile、连接测试、提示词调用、导入或生成；3 个延迟 UI 审计文件已精确移入回收站并等待复查未重建，未生成私有配置、用户图片、EXE 或 ZIP。

详细记录：`docs/changes/2026-08-17-windows-v2.0.4-ps-bridge-remote-terminal-watchdog.md`。

## 批次 13 结果

- 所有前端生产 build 在 TypeScript/Vite 之前统一运行版本漂移检查；真实临时夹具确认成功顺序为 `version -> tsc -> vite`，版本失败时编译和资产输出均不启动。
- 桌面 CI 收窄为 `go vet . ./backend` 与 `go test . ./backend`，不再扫描 `frontend/node_modules` 内的 Go 源码；Release hygiene 在源码合规扫描前显式验版本。
- Portable、源码准备和 Release identity 现有前置门禁增加离线顺序合同，未执行打包、上传或发布。
- 前端 Node `600/600`、UI `64/64`、TypeScript、Lint `0/58` 和 Windows 1,968 modules 构建通过；桌面/CLI Go test+vet、Worker `5/5`、版本、格式和最终 684 文件源码快照合规通过。
- Codex 浏览器三档真实点击通过，页面宽度等于视口、可见控件越界/截断和控制台 warning/error 均为 0；恢复 `1239x930` 后单一空白工作区、历史 0、API“已配置”和 14 个 Profile 不变。
- 3 个 UI 审计文件已移入回收站并等待复查未重建；没有私有配置、用户图片、EXE、ZIP、真实 API 调用、GitHub 推送或发布。

详细记录：`docs/changes/2026-08-17-windows-v2.0.4-ci-release-version-gates.md`。

## 架构治理顺序

1. 设置默认值、持久化策略和设置操作（已完成）。
2. 工作区、历史、素材组及相关动作（已完成）。
3. 自动尺寸锁状态所有权（已完成）。
4. 任务选择、取消、失败清理和队列插队动作（已完成）。
5. 连续池队列控制器（已完成）。
6. 浏览器任务与原生 Wails 任务事件生命周期（已完成）。
7. `host.ts` 文件/对话框、媒体、凭据/持久化、任务/Bridge 能力模块（已完成）。
8. JS/Go 请求合约、Bridge watchdog 与精确 CI/发布门禁（已完成）。

保持 `useStudioStore` 和 `host.ts` 兼容门面，不更换状态框架，不做 Store 大重写；每批只迁移一个可独立验证的领域。

## 最终验收结果

- 基线之后有初始化、Codex 浏览器入口和 18 个独立批次；分支没有上游跟踪，未推送、未创建 V2.0.4 标签或 Release。
- 产品版本、自动化、Windows 前端构建、桌面/CLI Go、Worker、格式和源码合规均通过；Codex 浏览器三档真实点击与最终重载通过。
- 当前开发状态保留用户原有两个工作区、活动标签“改为中午强光”、30 项历史和既有 API/Profile；批次 18 的临时标签、导入副本和视口覆盖均已清理。
- 稳定/开发 namespace 与 V2.0.3 迁移标记保持不变；未产生私有配置泄漏、真实 API 调用、EXE/ZIP 或发布目录内容。
- 当前 Windows 未启用 CGO，因此本机未运行 Go `-race`；CI race job、16 路并发终态测试和完整 Go test/vet 保留为竞态证据。

详细记录：`docs/changes/2026-08-17-windows-v2.0.4-continuous-goal-final-acceptance.md`。

## 后续开发入口

- 本轮持续目标已经验收完成。后续功能从当前分支新建独立批次，先更新本文件的恢复点，再按自动化、Codex 浏览器、三处记录和本地提交闭环执行。
- 正式封板、Portable/源码包、EXE/ZIP、V2.0.4 标签和 GitHub Release 尚未执行，必须由用户单独授权并重新做发布验收。

## 2026-08-24 FHL PS Bridge 契约化

- 独立契约源：`I:\AI\Image-Studio\FHL-PS-Bridge-Contract\v1`；协议主版本 `1`，契约修订 `2026-08-24`。
- `image-studio/backend/ps_bridge.go` 的 Health/Session 已发布服务名、协议版本、客户端范围、实例 ID 和 capabilities；现有 `/fhl-ps/v1` 路由和 CLI 内部执行器保持不变。
- `image-studio/frontend/src/platform/runtime/psBridgeContracts.ts` 已导出协议常量和握手类型；`ps_bridge_test.go` 覆盖握手元数据。
- 插件对应记录位于其独立仓库 `docs/changes/2026-08-24-fhl-ps-bridge-contract.md`；桌面正式 V2.0.3 未修改。
- 本批未生成 Portable/EXE/Release，未调用真实或付费图像 API；契约 fixture、Go/TypeScript/Node/UI、Windows 构建、Fast 和 Batch 门禁已通过，仍需未来 Photoshop 实机和 DSH 目标源码验收后才可发布客户端兼容声明。

## 2026-08-24 FHL PS Bridge 长期契约与 DSH 扩展治理

- 独立契约仓库 `I:\AI\Image-Studio\FHL-PS-Bridge-Contract` 是 Photoshop 插件、FHL Studio 桌面版和未来 DSH Harness Adapter 的唯一机器可读标准；当前协议主版本为 `1`，核心路径和语义长期保持兼容。
- v1 只允许新增可选字段、capability 和命名空间扩展；改变字段类型、枚举含义、认证、Session 绑定、任务状态或图片传输必须新增 `/fhl-ps/v2`，不得隐式修改 v1。
- `submitting` 是规范准备状态，`queued` 仅为旧客户端兼容别名；客户端同时兼容 JSON 和纯文本错误；CLI 继续只作为内部执行器。
- 契约仓库新增 `v1/extensions/dsh.harness.bridge.v1/`，只定义未来 DSH Cordis service/event Adapter 和 Trajectory 脱敏边界，不读取 DSH 插件源码、不调用桌面内部 CLI、不暴露凭据或 Base64 图片。
- 接口故障优先级：桌面违反已发布契约先修桌面；客户端误用契约修客户端；新能力先加 capability/extension；安全问题桌面优先；破坏性变化进入 v2。
- 交接记录：`docs/changes/2026-08-24-dsh-bridge-contract-governance.md`。契约对账和本地门禁已完成；下一步仅在取得插件或 DSH 项目授权后做客户端 Mock/实机兼容验收，不修改 V2.0.3、Android 或插件源码。

## 2026-08-24 Windows Portable Photoshop 对接文件

- 启动回归已修复：Windows PowerShell 5.1 会将无 BOM 的 UTF-8 启动脚本中的中文 EXE 名称解码为乱码，导致提示找不到桌面可执行文件；`scripts/portable-windows-launcher.ps1` 已改为 UTF-8 BOM，直接调用 `.cmd` 和 `.ps1` 均能启动 V2.0.4。重新打包时先停止本轮 V2.0.4 WebView 进程以解除 `config/webview` 锁，未触碰 V2.0.5。
- 2026-08-24 最终隔离验收：`cmd.exe /d /c "一键启动FHL Studio V2.0.4.cmd"` 返回 `0`；V2.0.4 进程监听 `127.0.0.1:47631`，health、session、profile 均成功（profile ready，凭据字段未返回）；仅运行离线合同测试 `portablePhotoshopIntegration.test.mjs`，`3/3` 通过。
- 最新 ZIP SHA-256 为 `b0d95bf50d447b04809e89646a42ea9053ecfc6260cfa6942e673f8b8762e732`；验证报告位于 `临时验收输出/portable-validation-report.json`。本轮不生成或升级 2.0.5。

- `scripts/package-windows-portable.ps1` 现在在复制当前 Wails EXE 后自动生成 Portable 根目录第一层的固定文件 `FHL Studio Photoshop 对接文件.json`；生成/读取/校验集中于 `scripts/portable-photoshop-integration.ps1`。
- 文件只包含 `productId=fhl-image-studio-desktop`、对接文件格式主版本 `1`、Bridge 协议主版本 `1`、根目录内相对 `launchPath`、显示名称和诊断用 `desktopVersion`；不包含 API Key、Session Token、Base URL、Credential Manager、用户数据、图片或绝对路径。
- `launchPath` 在打包时必须非空、非绝对、不含 `..`，并解析到包根目录内已存在的 EXE；`.fhl-studio-portable` 继续独立保留。桌面版本号不参与插件兼容判断，Bridge health/session/profile/capabilities 才是运行时依据。
- `portablePhotoshopIntegration.test.mjs` 离线合同测试 `3/3` 通过，覆盖实际隔离打包、缺失、格式、标识、协议、越界和升级覆盖。隔离成品保留在 `V2.0.4-开发版\临时验收输出`，未生成正式 Portable/Release。
- 按追加流程使用 `cmd /c wails dev` 启动完整 Wails 开发程序；旧 Portable 占用 `47631`，开发 Wails Bridge 使用 `47632`，health、session、profile 握手均已成功。未把 `5173`/Vite 当作 Bridge，未读取或修改 Photoshop 插件代码，未调用真实或付费生图 API。
- 后续入口：如需重新封板，继续显式使用隔离 `-OutputRoot` 并复核 ZIP 根目录中的固定 JSON 与 `.fhl-studio-portable`；不得改用默认正式输出，也不得覆盖 V2.0.3。

### 隔离成品已生成

- 生产 Wails 构建：`cmd /c "wails build -platform windows/amd64 -clean"` 成功。
- Portable 命令显式使用 `-OutputRoot I:\AI\Image-Studio\FHL-Image-Studio方汤圆版-桌面版整理\V2.0.4-开发版\临时验收输出`，并用 `-SkipBuild` 复用刚生成的 Wails EXE、重新构建 CLI。
- 成品根目录：`I:\AI\Image-Studio\FHL-Image-Studio方汤圆版-桌面版整理\V2.0.4-开发版\临时验收输出\FHL-Image-Studio-Desktop-V2.0.4-Windows-Portable`；对接文件、标记、EXE、启动脚本和 CLI 均已验证，ZIP 内对应条目也存在。
- SHA-256 清单：`I:\AI\Image-Studio\FHL-Image-Studio方汤圆版-桌面版整理\V2.0.4-开发版\临时验收输出\FHL-Image-Studio-Desktop-V2.0.4-Windows-Portable-SHA256SUMS.txt`；验证报告：同目录 `portable-validation-report.json`。
- 升级副本 `临时验收输出\升级覆盖-V2.0.5\FHL-Image-Studio-Desktop-V2.0.5-Windows-Portable` 已确认文件名/字段稳定，仅 `launchPath`、`desktopVersion` 变化；未覆盖正式发布目录、V2.0.3、插件源码或契约仓库。

## 2026-08-27 FHL 文本 API 模型选择批次收口

- 本批实现已完成：独立 FHL 文本 API 支持 `gpt-5.6-sol`、`gpt-5.5` 和自定义模型 ID；设置按当前桌面 namespace 保存，旧 Key 首次迁移保留 `gpt-5.5`，新环境默认 `gpt-5.6-sol`，不自动降级，不影响普通 Profile、Images 池、APIMart 或 RunningHub。
- 完整 Wails 开发程序继续运行于源码 `image-studio/build/bin/FHL Studio 方汤圆版 V2.0.4-dev.exe`，Wails 页面 `http://localhost:34115`，开发 Bridge `127.0.0.1:47632`。health、session、带 Bearer 的 profile 握手均通过；旧 V2.0.3 Bridge `47631` 未作为目标，Vite `5173` 未作为 Bridge。
- 最终门禁：typecheck、Node `737/737`、UI `123/123`、lint `0 errors / 55 existing warnings`、Windows build `1997 modules`、Fast、Batch、Go test/vet、CLI test/vet、Worker smoke 和 `git diff --check` 均通过。
- 浏览器在 `1252x930`、`1440x900`、`1024x768` 验收模型下拉、内置切换、自定义模型和非法值阻止测试；页面无横向溢出，控制台新增 warning/error 为 `0`。验收后已恢复默认视口并关闭配置弹窗。
- 本批不生成 Portable、不升级 2.0.5、不调用真实或付费生图 API；未读取或修改 Photoshop 插件源码、V2.0.3、Android 或 `FHL-PS-Bridge-Contract`。

## 2026-08-27 反推图像 Wails 文件选择器崩溃修复

- 根因：完整 Wails 页面点击反推图像时进入 Go `runtime.OpenFileDialog`，Windows WebView2 在 `Chromium.Focus` 报 `parameter is incorrect`，原生文件对话框栈随后导致 V2.0.4-dev EXE 退出；问题发生在导入请求之前。
- 修复：`PromptEditorSection` 的反推入口改为隐藏 HTML 文件输入（PNG/JPEG/WebP），选中文件继续复用 `importReversePromptImageFile`；普通源图、批量输入和历史导入仍保留原生/既有流程。
- 同步修复 Wails 事件注销在 WebView IPC 已关闭时的容错：清理回调捕获关闭异常，不再在窗口退出阶段产生二次未处理错误。
- 验证：TypeScript、Node `739/739`、UI 定向 `3/3` 通过；Codex 浏览器在 `http://127.0.0.1:34115/` 捕获文件选择器事件后，源码 EXE 保持运行，`127.0.0.1:47632/fhl-ps/v1/health` 返回 `ok=true`。未上传用户文件。
- 本批未调用真实或付费生图 API，未读取或修改 Photoshop 插件源码、V2.0.3、Android 或独立 Bridge 契约仓库。详细记录见 `docs/changes/2026-08-27-windows-v2.0.4-reverse-image-picker-crash.md`。

## 2026-09-07 V2.0.4 Photoshop 实测 Portable 候选（构建中）

- 目标：从当前 Windows V2.0.4 本地 Git 工作树生成全新隔离 Portable 和 ZIP，供用户进行 Photoshop 插件真实联调；不覆盖旧验收包、V2.0.3、正式附件或用户运行目录，不上传 GitHub。
- 隔离输出根：`V2.0.4-开发版\临时验收输出\20260907-104145-PS插件实测候选`。打包必须显式传入 `-OutputRoot`，由现有 `scripts/package-windows-portable.ps1` 重建 Wails 与 CLI。
- 当前版本元数据已同步为 `V2.0.4`；当前分支 `codex/windows-v2.0.4-feature/local-edit-360-parity`，工作树有 101 个修改或未跟踪路径，因此本产物属于未封板源码快照测试候选，不得在门禁、插件实测和用户确认前作为正式 GitHub Release 上传。
- 验收范围：离线检查 Portable 文件清单、固定 Photoshop 对接 JSON、空数据目录、敏感文件排除、ZIP SHA-256；启动打包后的完整 Wails 程序，验证 Bridge health/session/profile 握手，但不提交任务、不调用真实或付费生图 API。
- 回退/恢复点：本批不改产品代码；若构建失败，只保留日志和本节失败结论。可删除上述隔离输出目录后重跑，不得清理或重置当前工作树。

### 构建与验收完成

- 完整打包命令显式使用隔离 `-OutputRoot`，Wails v2.12.0 生产构建、CLI 构建、Portable 目录和 ZIP 均成功；未使用 Vite 页面或 `wails dev` 产物替代发布构建。
- 原始 ZIP：`V2.0.4-开发版\临时验收输出\20260907-104145-PS插件实测候选\FHL-Image-Studio-Desktop-V2.0.4-Windows-Portable.zip`，SHA-256 `E2489FEE0092864E65EA38C6E8B1F306EA8715BA94FDB44B6443A95CE93AB158`。文件清单为同目录 `portable-file-manifest.json`。
- 原始交付目录保持未启动、空输入输出和无 WebView 数据；单独复制 `运行验收副本`，通过包内一键启动脚本启动完整 Wails。当前 PID `52668`，Bridge 监听 `127.0.0.1:47631`，可供 Photoshop 插件实测。
- health/session/profile 握手全部通过：协议主版本 `1`、契约修订 `2026-08-24`、Session 与 health 实例一致、Profile ready，Profile 响应无凭据字段。未提交任务或调用真实/付费生图 API。
- 发布安全问题 `0`；Fast、Batch、TypeScript、Node `739/739`、UI `123/123`、Lint `0 errors / 55 warnings`、桌面/CLI Go、Worker `5/5` 与离线 smoke 全部通过。Wails 生成绑定的尾随空白已做无逻辑变化的规范化。
- 当前包是含未提交开发改动的 Photoshop 实测候选，不是可追溯正式 Release。插件实测通过后，先审查并提交源码、确认工作树干净，再从明确提交重新构建最终 ZIP，之后才能准备 GitHub 上传。
- 详细记录：`docs/changes/2026-09-07-windows-v2.0.4-ps-plugin-portable-candidate.md`。
