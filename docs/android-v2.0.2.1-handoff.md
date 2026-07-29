# Android V2.0.2.1 对齐交接提示

本文档用于把桌面版 `V2.0.2.1` 的小版本修改交接给 Android 版更新任务。当前桌面版已经完成比例选择修复、版本号升级和 Codex Skill 版本化命名。

## 桌面 V2.0.2.1 已完成

- 修复 FHL Responses / `gpt-image-2` 在明确尺寸下比例选择不稳定的问题。
- 针对 FHL Responses + `gpt-image-2` + explicit size：
  - 禁用 `partial_images`，避免预览帧/最终帧影响比例稳定性。
  - 根据 `1:1`、横版、竖版给 prompt 追加中文比例硬约束。
- 已用 Codex 浏览器真实出图验证：
  - `1:1` -> `1254x1254`
  - `16:9` -> `1672x941`
  - `9:16` -> `941x1672`
  - `2:1` -> `1774x887`
  - `1:2` -> `887x1774`
- 版本号升级为 `V2.0.2.1`：
  - 桌面顶部显示版本
  - Wails `productVersion`
  - Go CLI `packageVersion`
  - Go CLI client `Version` / User-Agent
  - Windows portable 包名、EXE 名、启动器文案
  - README / CHANGELOG / Release Notes
- Codex Skill 改为版本化命名：
  - Skill 名：`fhl-image-studio-v2-0-2-1`
  - 安装路径：`<用户目录>\.codex\skills\fhl-image-studio-v2-0-2-1\SKILL.md`
  - 旧稳定名 `fhl-image-studio` 已移到 `.disabled`，避免多版本混淆。

## 桌面关键文件

- `shared/kernel/requestModel.js`
- `go-cli/pkg/client/payload.go`
- `go-cli/pkg/client/payload_test.go`
- `image-studio/frontend/test/requestModel.test.mjs`
- `go-cli/cmd/gptcodex-image/main.go`
- `go-cli/pkg/client/types.go`
- `image-studio/wails.json`
- `image-studio/frontend/package.json`
- `image-studio/frontend/src/components/layout/AppHeaderBrand.tsx`
- `SKILL.md`
- `安装CodexSkill.cmd`
- `CHANGELOG.md`
- `RELEASE_NOTES_DESKTOP_V2.0.2.1.md`

## 已运行验证

- `cmd /c image-cli.cmd --status --json`
  - 返回 `packageVersion: "V2.0.2.1"`
  - 不输出明文 API Key。
- `cd go-cli && go test ./pkg/client`
- `cd image-studio/frontend && npm test -- requestModel`
- `cd image-studio/frontend && npm test -- skillChainRestore`
- `cd image-studio/frontend && npm run build`

## Android 需要对齐的方向

- 将 Android 版版本升级到 `V2.0.2.1`，保持桌面与安卓小版本一致。
- 检查 Android 远程内核是否复用 `shared/kernel/requestModel.js` 的 FHL Responses payload 逻辑；如果已经复用，重点做真机/模拟器验证。
- 如果 Android 壳层或 native bridge 里有独立 payload 构造逻辑，需要同步桌面修复：
  - FHL Responses + `gpt-image-2` + explicit size 时禁用 `partial_images`。
  - 根据选择比例追加中文比例硬约束。
  - 确认 `1:1 / 16:9 / 9:16 / 2:1 / 1:2` 都能稳定得到正确方向和比例。
- Android UI 的尺寸/比例选择要与桌面一致：
  - 手动选择比例后不能回到 Auto。
  - 图生图、批量、普通文生图都应尊重当前比例。
  - APIMart / RunningHub 的比例语义不要误用 FHL 像素尺寸。
- Android 性能测试继续保持：
  - 默认并发建议 1。
  - 历史和批次结果避免长期保存大 base64。
  - 生成过程中观察 UI 卡顿、发热、内存、logcat。

## 给另一个 Codex 窗口的提示词

```text
请继续 Android V2.0.2.1 对齐任务。桌面版 V2.0.2.1 已经完成一个小版本更新，需要把关键修复同步到安卓。

桌面源码包路径：
<开发工作区>\FHL-Image-Studio\源码

本次桌面小版本已完成：
1. 修复 FHL Responses / gpt-image-2 在明确尺寸下比例选择不稳定的问题。
2. 对 FHL Responses + gpt-image-2 + explicit size 禁用 partial_images。
3. 根据选择比例追加中文比例硬约束：
   - 1:1：严格正方形
   - 横版：严格横向构图，不要正方形，不要竖版
   - 竖版：严格竖向构图，不要正方形，不要横版
4. Codex 浏览器真实出图验证已通过：
   - 1:1 -> 1254x1254
   - 16:9 -> 1672x941
   - 9:16 -> 941x1672
   - 2:1 -> 1774x887
   - 1:2 -> 887x1774
5. 版本号升级为 V2.0.2.1。
6. Codex Skill 改为版本化命名：fhl-image-studio-v2-0-2-1。

请你在 Android 版里做以下事情：
1. 找到 Android 当前版本号、构建配置、前端 Android target 和 native shell 版本显示位置，统一升级到 V2.0.2.1。
2. 检查 Android 生图链路是否复用 shared/kernel/requestModel.js。如果复用，请确认桌面比例修复会进入 Android WebView/remote kernel；如果没有复用，请把同等逻辑同步到 Android 实际 payload 构造处。
3. 重点测试 FHL Responses + gpt-image-2 的比例选择：
   - 1:1
   - 16:9
   - 9:16
   - 2:1
   - 1:2
4. 确认手动选择比例后不会回到 Auto，文生图、图生图、批量图生图都尊重选择比例。
5. 保持 APIMart / RunningHub 的比例语义独立，不要把 APIMart/RH 比例参数误转成 FHL 像素尺寸。
6. 用 Android 模拟器做流程验证；如果真机已连接，再做一次真实生图和卡顿/发热观察。
7. 验证命令至少包括：
   - npm run build:android
   - cd android-shell && .\gradlew :app:assembleDebug
   - adb install / launch / screenshot / logcat 基础验证
8. 记录结果到安卓升级文档，说明哪些比例已实测、哪些因为 API/设备限制未测。

注意：不要动桌面发布包、不要上传 GitHub、不要清理 API Key。只做 Android V2.0.2.1 对齐和验证。
```
