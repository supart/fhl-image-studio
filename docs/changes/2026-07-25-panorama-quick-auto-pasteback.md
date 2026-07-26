# Panorama Quick Auto Pasteback

## Requirement

带有 360 往返信息的编辑结果在大图预览中，除“手动贴回”和“导入贴回”外，还需要一个“自动贴回”按钮。点击后直接使用默认参数完成贴回，不打开手动对齐弹窗。

## Change

- 大图快捷操作调整为 `自动贴回 / 手动贴回 / 导入贴回` 三项同排布局。
- 自动贴回复用现有 `repastePanoramaRoundtrip()` action，以 `selectAsCurrent: true` 直接生成新的全景历史项并切换到结果。
- 自动贴回期间按钮显示“贴回中”，三项操作暂时禁用，避免重复生成或与手动流程并行冲突。
- 入口继续受 `panoramaRoundtrip` 校验保护，普通图生图结果、流式预览和临时参考图不会显示该操作组。

## Verification

- 聚焦贴回入口测试通过：4/4。
- `npm run typecheck` 通过。
- `npm run lint` 通过，保持既有基线：0 errors、63 warnings。
- `npm run test:node` 通过：550/550。
- `npm run build:windows` 通过，仅保留既有 chunk 提示。
- Codex 浏览器确认三项按钮同排完整显示、没有遮挡；未点击自动贴回，未生成新图片。
- Windows x64 Portable 与干净源码已重新构建，Portable/ZIP/源码安全与合规扫描均为 `0 issues`。
- 最终 Portable EXE SHA-256：`823E911842FB66C2A7F8EE4D62E6241E0DE86DEE1A1F5475F1AFFD5E1CFF55BA`。
- 最终 Portable ZIP SHA-256：`7F5BFB346BDEB38610F80444E8C4AF8F454DB8DDB39C482A717F50CF11F8619D`。
- 未调用真实上游或付费 API。
