# AGPLv3 合规说明

本仓库是 `FHL Image Studio 方汤圆修改版 V2.0.2` 的公开源码发布树，基于 `RoseKhlifa/Image-Studio` 做独立修改并以 GNU Affero General Public License v3.0 发布。

## 项目来源

- Image-Studio 原作者 RoseKhlifa 项目地址：https://github.com/RoseKhlifa/Image-Studio
- 方汤圆修改版项目地址：https://github.com/supart/fhl-image-studio
- 上游历史许可证记录：[LICENSES/UPSTREAM-MIT-v1.0.7.txt](./LICENSES/UPSTREAM-MIT-v1.0.7.txt)

本项目不是原作者官方版本，也不代表原作者对本修改版提供维护或背书。

## 分发义务

根据 AGPLv3：

- 重新分发本项目或其修改版时，必须随附完整对应源码。
- 如果通过网络向用户提供修改版服务，也需要向用户提供对应源码。
- 必须保留许可证、版权、NOTICE 和修改来源说明。
- 不得移除或规避 AGPLv3 赋予用户的权利。

## 本次发布清理

本次 `V2.0.2` 发布源码和便携包准备流程明确不包含：

- API Key、访问令牌、真实账号配置或本机私有配置。
- `cli.env.local`、`fhl-api.local.json`、`browser-jobs.v1.json`。
- 用户生成图片、测试图、导入源图、临时图。
- `input/`、`output/`、`intermediate/`、`output/log/`。
- `node_modules/`、`frontend/dist/`、`build/bin/`、Gradle 缓存、`.local` 和运行日志。

仓库只保留 `.example` 示例配置。示例文件不得包含真实 API Key。

## API 与数据说明

应用需要用户自行配置兼容的上游 API。发布包不提供、不代理、不内置任何可用 API Key。

桌面端生成历史、图片、配置和运行日志默认保存在用户本机。用户自行配置的 API Key 会尽量走系统安全存储或本机私有配置，不应进入公开仓库。

## 二次开发建议

二次开发者在公开发布前应运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-compliance-package.ps1
```

该脚本会扫描常见密钥模式、禁止提交的本机配置、生成目录、构建缓存和运行日志。
