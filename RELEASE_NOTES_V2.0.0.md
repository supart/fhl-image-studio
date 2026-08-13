# FHL Image Studio 方汤圆 CLI 魔改版 V2.0.0 Desktop Notes

## 状态

这个文件记录旧桌面发布包：

```text
FHL-Image-Studio方汤圆CLI魔改版V2.0.0-发行版-20260605-152640.zip
```

旧桌面资产不会被 Android V2.0.1 发布覆盖。继续公开分发桌面 ZIP 前，请同步提供对应源码 tag/source archive，或在 GitHub Release 中标注“旧桌面包已停止推荐分发，请等待补齐源码的新版桌面发布包”。

## 合规说明

本项目是基于 `RoseKhlifa/Image-Studio` 的独立修改发行版，不是上游官方版本。

原项目地址：

```text
https://github.com/RoseKhlifa/Image-Studio
```

为稳妥遵守上游当前 AGPLv3 许可要求，本项目仓库按 GNU AGPLv3.0 公开源码。每个二进制发布包都应能找到对应源码。

## 安全与隐私要求

- 不内置 API Key。
- 不包含私有 `cli.env.local`。
- 不包含 `fhl-api.local.json`。
- 不包含输入图、输出图、中间图、raw 日志、任务注册表或 UI 审计日志。
- 用户首次启动后需要自行配置 API Key。
