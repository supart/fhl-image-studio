# FHL Image Studio 文档中心

本目录是 FHL Image Studio 方汤圆修改版的统一文档入口。当前索引对应桌面版 `V2.0.3` 源码树；代码、发布产物和本机运行数据之间的边界以本文档及[项目结构](./project-structure.md)为准。

## 快速入口

| 文档 | 用途 |
| --- | --- |
| [项目首页](../README.md) | 产品定位、主要功能、源码启动和交付形态 |
| [使用与上游配置](./usage.md) | 首次使用、API 形态、生成流程和结果管理 |
| [功能说明](./features.md) | 桌面工作台、画布、历史、工作区和平台能力 |
| [数据位置与故障排除](./troubleshooting.md) | 数据目录、常见上游错误、恢复和诊断 |
| [构建与发布](./build.md) | 开发环境、Portable 构建、验证入口和 CI |
| [项目结构](./project-structure.md) | 当前源码目录、模块职责和维护边界 |
| [现阶段项目整理](./current-stage-2026-07-28.md) | 桌面端、Portable、Photoshop 插件、Codex 开发入口和最终收尾断点 |
| [Photoshop 插件兼容说明](./photoshop-plugin-compatibility.md) | 独立销售项目边界、桌面 Bridge 支持范围和兼容版本 |

## 开发与专题

| 文档 | 用途 |
| --- | --- |
| [桌面 E2E 测试模式](./desktop-e2e-test-mode.md) | 在隔离端口运行打包桌面 UI 和模拟验收 |
| [360 工作台与全景贴回](./panorama-360.md) | 全景生成、查看、编辑和贴回流程 |
| [Photoshop UXP Bridge 实现记录](./changes/2026-07-25-photoshop-uxp-bridge.md) | 桌面端回环接口、安全边界、插件验证与恢复断点 |
| [原始提示词传递说明](./no-prompt-revision/README.md) | 不改写提示词路径的能力边界 |
| [内容审核风险改写规则](./content-audit-risk-rules.md) | 上游内容安全错误的分析与提示词处理原则 |
| [反馈渠道](./feedback.md) | Issue 与用户反馈入口 |

`android-v2.0.2.1-handoff.md`、`mumu-android-debug.md`、`cross-platform-kernel-plan.md` 等文件保留为历史或跨项目协作资料。当前桌面 V2.0.3 源码树不包含 `android-shell/`，因此这些文件不能替代当前桌面构建说明。

## 版本与验收

| 文档 | 记录内容 |
| --- | --- |
| [CHANGELOG](../CHANGELOG.md) | 跨版本、面向发布的功能与修复摘要 |
| [V2.0.3 发布说明](../RELEASE_NOTES_DESKTOP_V2.0.3.md) | 单一版本的交付内容、产物和已知边界 |
| [V2.0.3 验收报告](../V2.0.3_ACCEPTANCE_REPORT.md) | 测试矩阵、Portable 产物校验和残余风险 |
| [详细变更记录](./changes/) | 每个开发批次、事故调查或性能验证的完整过程 |
| [当前开发交接](../PROJECT_CONTEXT.md) | 当前状态、精确断点、验证结果和恢复方式 |

旧版本的发布说明继续保留在仓库根目录。它们是对应版本的历史快照，不随新版本行为回写。

## 文档归档规则

| 信息类型 | 唯一主要记录位置 |
| --- | --- |
| 产品定位、运行入口、快速开始 | 根目录 `README.md` |
| 稳定的用户操作与功能行为 | `docs/usage.md`、`docs/features.md` |
| 数据目录、错误恢复与排查 | `docs/troubleshooting.md` |
| 构建、测试和发布命令 | `docs/build.md` |
| 架构、目录和模块职责 | `docs/project-structure.md` |
| 本批实现、排错证据和技术决策 | `docs/changes/YYYY-MM-DD-topic.md` |
| 跨版本发布摘要 | 根目录 `CHANGELOG.md` |
| 单版本交付说明 | `RELEASE_NOTES_DESKTOP_V*.md` |
| 单版本完整验证结果 | `V*_ACCEPTANCE_REPORT.md` |
| 当前 Codex 接手所需的最短上下文 | `PROJECT_CONTEXT.md` |
| Codex 工作约束 | [AGENTS.md](../AGENTS.md) |
| 许可证、来源和分发义务 | [LICENSE](../LICENSE)、[NOTICE](../NOTICE.md)、[COMPLIANCE](../COMPLIANCE.md) |

`PROJECT_CONTEXT.md` 不是长期产品手册。后续只在其中保留当前状态、未完成事项、已运行验证和恢复断点；详细过程写入 `docs/changes/`，稳定结论再同步到对应正式文档。

## 编写要求

- 新变更记录使用 `YYYY-MM-DD-topic.md`，标题中写明目标或问题。
- “计划中”“已实现”“已验证”必须明确区分；未运行的测试不得写成通过。
- 修改稳定行为时同步更新用户说明；修改交付内容时同步更新 `CHANGELOG`、发布说明和验收报告。
- 文档不得包含完整 API Key、Credential Manager 内容、私有配置、Base64 图片、个人日志或可识别用户的临时路径。
- 大型日志、截图和测试输出保存到本地验证目录，文档只记录结论、必要路径和可复现命令。
