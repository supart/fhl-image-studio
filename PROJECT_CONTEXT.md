# FHL Studio Windows V2.0.4 开发交接

## 2026-08-18 批次 21 收口：浏览器验收与入口修复

- 在 `713767a` 上完成最后一轮 Codex 浏览器真实验收；发现并修复新画矩形未自动选中导致“局部编辑”仍提示框选的问题。修复代码使用显式选中矩形，否则使用最近创建的矩形。
- 修复后的浏览器流程已通过：普通图选择区域、创建局部裁切副本、打开平面对齐器、移动/缩放/旋转/羽化/色彩、启用并绘制精细蒙版、确认贴回；最终生成“局部贴回”终态并关闭对齐器。全景工作台、普通局部编辑和整图蒙版入口同时可见。
- 浏览器控制台 errors `0`，未调用真实或付费 API。浏览器验收使用本机既有离线历史图，未导入用户私有文件。
- 定向 `localEditRoundtrip` 合同测试 `3/3`、Fast、Batch 全部通过；Batch 包含 Node `634/634`、UI `107/107`、桌面/CLI Go test+vet、Worker `5/5`，Lint `0` errors/58 既有 warnings。
- 本轮文档和修复待提交为一个本地批次提交；提交后从新提交继续，不推送 GitHub。归档前应清理本轮浏览器生成的临时局部编辑历史项，保持用户原有历史不变。

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
