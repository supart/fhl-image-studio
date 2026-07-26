# Panorama Pasteback Roundtrip Recovery

## Requirement

360 镜头图完成图生图编辑后，结果大图必须继续提供“手动贴回”和“导入贴回”入口。旧任务或刷新恢复后的任务也应保留自动贴回、手动对齐、精细蒙版、软边和边缘羽化能力。

## Root Cause

贴回组件和两类入口一直存在，没有被版本迭代删除。入口由 `panoramaRoundtrip` 元数据控制，但工作区和批量任务的持久化恢复路径没有完整保留该字段。旧结果恢复后因此无法通过 `hasPanoramaRoundtripRef()`，界面误判为普通图生图结果并隐藏贴回入口。

## Change

- 工作区参考图持久化和恢复继续保留 `panoramaRoundtrip` 与 `panoramaProject`，批量任务恢复保留顶层 `panoramaRoundtrip`；Blob 和 Base64 仍不持久化。
- 新增统一的 roundtrip 恢复逻辑，按任务元数据、当前参考图和历史镜头输出记录补回关联。
- 提交、启动、分页恢复、自动贴回、手动贴回和外部图片贴回均使用同一恢复规则。
- IndexedDB 升级到 v4，新增 `savedPath` 索引和按路径批量读取历史元数据接口；恢复过程不读取原图。
- 结果预览增加非敏感验收属性，用于确认当前结果、任务和参考图是否已恢复关联。

## Verification

- `npm run typecheck` 通过。
- `npm run test:node` 通过：552/552。
- `npm run test:ui` 通过：12/12。
- `npm run lint` 通过，保持既有基线：0 errors、63 warnings。
- roundtrip 恢复与历史路径查询聚焦测试通过：14/14。
- Codex 浏览器确认当前旧结果的贴回可用状态为 true，并重新显示“手动贴回”和“导入贴回”。
- 手动贴回弹窗确认仍包含对齐、精细蒙版、蒙版软边、色彩、边缘羽化和对比度控制。
- 未点击“确认贴回”，未生成图片，未调用付费 API。
- `git diff --check` 通过；仅保留工作树既有的换行符转换提示。
