# AGPL 合规清单

本清单用于发布 FHL Image Studio 方汤圆版前自查。

## 必须满足

- 公开完整对应源码，源码能构建对应 APK/ZIP。
- README、NOTICE、Release notes、下载页、视频/社群说明均标注原项目来源。
- 原项目链接固定为：https://github.com/RoseKhlifa/Image-Studio
- 仓库根目录保留 GNU AGPLv3.0 `LICENSE`。
- 每个二进制 Release 资产都绑定对应 tag/source archive。
- 不上传 API Key、本机配置、输入图、输出图、raw 日志、审计日志或浏览器缓存。

## 对作者的回复模板

```text
您好，感谢提醒。我会补充衍生项目完整源码、README/Release/视频说明中的原仓库来源链接，并检查历史发布包。

另请您方便提供一下自 v1.0.7 起切换 AGPLv3 的具体 commit/tag/release 链接，我会按对应版本边界处理授权说明。
```

## 发布渠道文案模板

```text
本项目是基于 RoseKhlifa/Image-Studio 的独立修改发行版，遵循 GNU AGPLv3.0 协议公开源码。原项目地址：https://github.com/RoseKhlifa/Image-Studio。
```

## 旧桌面包处理

旧桌面 ZIP 不需要被 Android 发布覆盖，但继续公开分发前应补齐对应源码。若暂时无法确认源码对应关系，建议在 Release 中标注“已停止推荐分发”，并引导用户下载已公开源码对应的新版发布包。
