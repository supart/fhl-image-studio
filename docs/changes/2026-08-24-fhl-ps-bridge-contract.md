# V2.0.4 FHL PS Bridge 契约化

## 变更

- 保持 `/fhl-ps/v1` 所有路径、HTTP 方法、Session Token、Profile、Job 和 CLI
  内部执行语义不变。
- Health/Session 新增稳定协议握手元数据：`protocolMajor=1`、
  `contractRevision=2026-08-24`、`minClientMajor=1`、`maxClientMajor=1` 和
  `capabilities`。
- 中立契约源位于 `I:\AI\Image-Studio\FHL-PS-Bridge-Contract\v1`，桌面仓库
  只保留实现和测试，不复制插件业务源码。
- 前端 TypeScript 导出同一组协议常量和握手类型，供桌面调用层和夹具测试引用。

## 兼容边界

协议主版本一致时可新增可选字段和 capability；客户端忽略未知字段。删除或改名
字段、改变类型/枚举、认证方式、Session 绑定、任务状态语义或图片传输方式时，
必须升级协议主版本。CLI 继续只作为 Bridge 内部执行器。

## 验证

本批使用 Go handler 测试和插件 Mock Fetch 测试，不调用真实或付费图像 API，不
修改 V2.0.3 正式文件、Adobe External 旁载、用户配置或运行数据。完整 `go test`
和桌面分层门禁需在提交前执行。

