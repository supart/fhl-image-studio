# 已贴回全景终态识别修正

## 问题

完成自动或手动贴回后生成的结果已经是最终 2:1 全景，但恢复逻辑仍可能从父级镜头图补回 `panoramaRoundtrip`，导致画布、历史菜单和 360 输出管理继续显示贴回入口。

## 修正

- `pasted-panorama` 项目角色现在是明确的贴回终态。
- `resolvePanoramaRoundtripRef()` 对该角色固定返回空，不再把最终全景识别为镜头图。
- 元数据恢复不再为该角色查找或补写 roundtrip 信息，也不再请求无用的镜头恢复路径。
- 真正的 `shot` 和 `edited-shot` 仍可继续使用自动贴回、手动贴回和导入贴回。

## 验证结果

- 聚焦 Node 测试通过：25/25。
- Codex 浏览器在当前 3840x1920 已贴回结果上确认：贴回操作容器为 0，三个贴回按钮均为 0，`data-panorama-pasteback-available=false`。
- 完整检查通过：typecheck、lint（0 error / 63 个既有 warning）、Node 551/551、UI 12/12、Windows 前端构建和 `git diff --check`。
- V2.0.3 Portable 与源码重新构建完成；Portable/ZIP 安全扫描和源码合规扫描均为 0 问题。
- 最新 ZIP SHA-256：`8CB620DBB9833BBB2FF3F64478A23719D18ED947587704493CDF793C0CB787B7`。
- 未点击贴回、未生成图片、未读取凭据、未调用付费 API。
