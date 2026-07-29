# 桌面 E2E 测试模式

桌面版 `V2.0.3` 提供只用于本机打包回归的浏览器镜像。`9230` 不是产品 API，也不能用于真实生图或上游连接测试。

## 启动

推荐只启动隔离镜像，不打开桌面窗口：

```cmd
"image-studio\build\bin\FHL Studio 方汤圆版 V2.0.3.exe" --e2e-only --e2e-port 9230
```

然后打开：

```text
http://127.0.0.1:9230/
```

服务只监听 `127.0.0.1`。每次进程启动都会生成新的会话令牌和系统临时媒体目录；服务关闭时会尝试删除该临时目录，异常退出后的残留只属于系统临时区。

## 隔离边界

`--e2e-only` 使用以下固定边界：

- Profile 与设置只存在于页面内存存储，不读取或修改 WebView/localStorage 用户数据。
- 不暴露 Keyring、API Key、本地 CLI 配置、真实 Generate/Edit、连接测试或任何上游代理。
- CSP 将网络连接限制为当前 E2E 源；服务端不提供 FHL、APIMart 或任意 URL 下载代理。
- 不提供系统文件选择、文件/目录打开、外部 URL 打开或反射式 Service 调用。
- 测试图片只能写入、列出和读取本进程的系统临时沙箱；路径会在解析符号链接后再次校验。
- POST 与 SSE 必须同时通过随机会话令牌、Host 和 Origin 校验；服务不启用 CORS。

旧的本地配置与上游代理 URL 在 E2E 模式固定返回 `404`，不会回退到真实网络或包内文件。

## 自动化入口

页面加载完成后提供：

```js
window.__imageStudioE2E
```

常用只读或 UI 操作：

```js
window.__imageStudioE2E.getStateSummary()
window.__imageStudioE2E.waitForIdle()
window.__imageStudioE2E.setPrompt("test prompt")
window.__imageStudioE2E.setSize("1024x1024")
window.__imageStudioE2E.openSettings()
window.__imageStudioE2E.openResultGrid()
```

多 API 与连续调度使用页面内存模拟，不提交真实任务：

```js
window.__imageStudioE2E.runContinuousPoolSimulation()
window.__imageStudioE2E.runImagesPoolSlotSimulation()
```

浏览器自动化上下文无法直接读取 `window` 时，可以使用页面已有的同源 `postMessage` 命令通道。命令白名单由前端 E2E harness 定义，未知命令会失败。

## 媒体回归

参考图、批量导入、悬浮参考图、结果大图和失效媒体回退仍需在重新打包后的 EXE 中验证，但测试素材必须先进入本进程临时沙箱。页面内对 `/__image-studio-files/*` 的写入由启动脚本自动附加会话令牌；外部路径不会被导入或读取。

测试结束后只停止本次 V2.0.2.2 开发 EXE。不要清理旧版本目录、用户 `input/output/intermediate`、WebView 数据或原始测试文件。
