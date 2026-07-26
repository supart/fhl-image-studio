# Panorama Manual 2:1 Preservation

## Requirement

用户先选择 `360 工作台` 的全景生成，再切换到普通图生图时，比例必须继续显示并使用“手动比例 2:1”，不能被图生图默认自动适配覆盖。

## Root Cause

全景入口只把生成尺寸设置为 2:1，没有同步清除 `batchProcess.autoAspectResolution`。在新工作区或原本开启自动适配时，切换到图生图后仍会启用自动比例。

## Change

- 进入 360 全景生成时保留完整批处理配置，只把 `autoAspectResolution` 设置为空字符串，表示手动比例。
- 已经处于手动比例时复用原配置对象，避免无意义状态更新。
- 全景尺寸仍由现有 `buildPanoramaGenerateSize()` 根据当前分辨率与 API 能力生成。

## Verification

- 聚焦单元测试通过：`panoramaStudioEntry.test.mjs` 3/3。
- `npm run typecheck` 通过。
- `npm run lint` 通过，保持既有基线：0 errors、63 warnings。
- Codex 浏览器实测通过：“自动适配 → 360 全景生成 → 图生图”后，图生图仍处于选中状态，手动比例说明唯一可见，比例选择器为 `2:1`。
- 浏览器验收未点击生成，也未发起 API 请求；验收前检测到的用户任务已自然结束。
- `git diff --check` 通过；仅输出工作树既有的换行符转换提示。
