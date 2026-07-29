# Windows V2.0.3 GitHub 正式发布

## 发布范围

- 发布目标为 Windows x64 Portable `V2.0.3`。
- GitHub 使用独立分支 `release/windows-v2.0.3` 与独立标签 `windows-v2.0.3`。
- 这是 Windows 的独立补充发布，不替代、不覆盖 macOS `v2.0.3` 或 `v2.0.3.1`。
- 独立销售的 Photoshop 插件不包含在仓库、源码 ZIP 或 Release 附件中；桌面端仅保留本机 Bridge v1 的兼容实现与文档。

## 发布资产

- `FHL-Image-Studio-Desktop-V2.0.3-Windows-Portable.zip`：已完成跨电脑验收的原始 Portable，不重新编译或替换。
- `FHL-Image-Studio-Desktop-V2.0.3-Source.zip`：与 Windows 发布分支和标签对应的干净源码归档。
- `SHA256SUMS.txt`：上述两个 ZIP 的 SHA-256 校验值。

## 本轮升级

- 连续生成严格保持一点击一任务；重复事件由工作区 single-flight 合并，多次明确点击才会按可用 API 容量运行或排队。
- 原生桌面重启时，旧的排队、提交中与运行中任务统一显示为已中断，后续生成不会把它们重新唤醒。
- 连续任务首次提交立即显示任务卡；启动失败转为可重试失败卡，成功、失败与后端结算任意顺序都会重新唤醒队列。
- 每张成功或失败任务记录并显示实际使用的 FHL API 槽位，例如 `FHL1`。
- Images 槽首次测试成功会在没有可用当前 API 时自动激活；已有有效当前 API 不会被覆盖。
- API Key 输入框支持 Windows 原生右键“粘贴”。

## 验证

- 前端 Node：581/581 通过。
- 前端 UI：24/24 通过。
- TypeScript：通过。
- ESLint：0 错误，63 条既有允许警告。
- Windows 前端构建：通过，1,956 个模块。
- 桌面端与 CLI：Go test / vet 通过。
- Cloudflare Worker：5/5 通过。
- 源码、Portable ZIP 的合规与发布安全扫描：0 问题。
- 未调用真实或付费生图接口。

## 凭据与分发说明

- 原始 ZIP 不包含 API Key、Token、用户图片、历史记录、WebView 用户数据或运行日志。
- 同一 Windows 账户从旧版升级时，应用可能读取该账户 Windows Credential Manager 中已有的 FHL Studio 凭据；这不表示 ZIP 内含 API。
- 请从原始 ZIP 解压后使用。已运行的目录会生成本机数据，不得重新作为发布包分发。

## 回滚

- Windows 发布资产的回滚来源是 `FHL-Image-Studio-V2.0.3-正式发布审核版-20260729` 中保留的原始审核 ZIP。
- 若 Windows 发布出现问题，只撤销 `windows-v2.0.3` 对应的独立 Release、标签和分支；不得修改 macOS 已发布的标签、Release 或附件。
