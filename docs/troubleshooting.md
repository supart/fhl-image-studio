# 数据位置与故障排除

## 数据存储位置

| 类型 | 位置 |
|---|---|
| 桌面端 API Key | 系统安全存储(Keychain / Credential Manager / Secret Service)。 |
| 上游配置(API 形态、BASE_URL、模型 ID) | 前端本地存储。 |
| 历史记录元数据 | IndexedDB。 |
| 用户偏好 | 前端本地存储。 |
| 源码直构 Wails WebView/IndexedDB | 当前用户稳定数据目录；不作为正式预编译发行形态。 |
| Portable WebView/IndexedDB | 包内 `config\webview`。 |
| 拖入、粘贴和变换中间图 | Portable 包内 `input`。 |

Windows V2.0.3 默认输出：

| 运行形态 | GUI 图片 | GUI 原始响应 | CLI / Codex 输出 |
|---|---|---|---|
| Portable | 包内 `output\images` | 包内 `output\log` | 包内 `output` |

GUI 的输出根目录继续拆成：

```text
images/
log/
```

`images/` 存图，`log/` 存 Responses SSE dump 或 Images API JSON 响应，避免图片浏览目录被日志污染。

Portable 包不包含 API Key。复制一个干净包时，包内 WebView 和配置应为空；但同一 Windows 用户的 Credential Manager 仍可能保留旧凭据。需要验证完全空白状态时，应使用 Windows Sandbox、全新 Windows 用户或新机器，或者明确执行“一键清空 API”。

## 一直 524 / 504

这通常是上游网关超时，不一定是本地程序崩溃。

处理顺序:

1. 如果当前是 Images API，优先切到 Responses API。
2. 确认 key 有文本模型权限，例如默认 `gpt-5.5`。
3. 降低质量或尺寸，缩短单次推理时间。
4. 从历史项查看 raw 响应，确认是 Cloudflare 524/504、上游 JSON 5xx，还是模型权限错误。
5. 如果上游本身不支持 SSE 或会缓冲 SSE，换上游或走 Images API。

## `model not found` / 401 / 403

Responses API:

- key 没有文本模型权限。
- 文本模型 ID 或图像模型 ID 在该上游不可用。
- key 绑到了 image-only 分组，但 Responses API 需要文本模型来调用 `image_generation` 工具。

Images API:

- 图像模型 ID 不存在。
- key 没有 image endpoint 权限。
- 上游只实现了 `/v1/chat/completions`，没有实现 `/v1/images/generations` 或 `/v1/images/edits`。

## 多参考图、蒙版、seed、negative prompt 没生效

先检查当前 profile 的请求策略:

- `OpenAI 标准` 会尽量只发官方字段。
- `兼容中转扩展` 才会额外发送 seed / negative_prompt 等扩展字段。

还需要注意:

- Images API 的多参考图支持取决于 relay；标准 OpenAI Images Edits 通常只接受单张 `image`。
- 蒙版是否生效取决于目标模型和上游是否正确透传 multipart 或 Responses input mask。
- 有些中转站会接受字段但静默忽略。

## Android 保存或打开目录行为

Android 与桌面端不同:

- 保存图片优先走 MediaStore，结果会出现在系统相册的 `ImageStudio` 目录。
- 打开输出目录在 Android 10+ 上会打开系统图片集合，不一定是具体文件夹浏览器。
- 如果壳层能力不可用，前端会回退 Web Share API 或下载链接。

## 浏览器预览里的 `memory://`

浏览器预览和部分远程内核路径会使用 `memory://image/...` 或 `memory://text/...` 虚拟路径。它们只存在于当前页面运行时，用于调试和回退，不等同于已经写入真实文件系统。

需要真实持久化时，应在 Wails 桌面端或 Android 壳层中运行。

## 浏览器模式交互审计日志

`start-ui.cmd + Vite 浏览器模式` 默认开启本地交互审计，用来还原“报错前用户点了什么、当时界面是什么状态”。

文件位置：

```text
output\log\ui-audit\index.v1.json
output\log\ui-audit\session-<tabSessionId>.md
output\log\ui-audit\session-<tabSessionId>.jsonl
```

建议排查顺序：

1. 先看 `index.v1.json` 找最新会话
2. 再看对应 `session-*.md`
3. 需要逐条还原操作时，再读 `session-*.jsonl`

推荐排查材料：

- 报错截图
- 最新交互摘要 `session-*.md`
- 对应 raw 日志或 CLI `rawPath`（如果有）

脱敏规则：

- 不记录 API Key
- 不记录 Authorization
- 不记录 base64 图片内容
- 不记录完整外部绝对路径
- 只保留截断后的 prompt 预览、参考图 basename、路径类别

## 查看 raw 响应

历史项右键可以查看 raw 响应:

- Responses API:通常是 `sse-response-*.txt`。
- Images API:通常是 `images-response-*.json`。

排查时优先看:

- HTTP status。
- 上游返回的错误 message。
- 是否出现 `retryable=true`、524、504、5xx。
- Responses API 是否有 `partial_image_b64` 或 final image 事件。
