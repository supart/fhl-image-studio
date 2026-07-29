# Photoshop 插件兼容说明

## 项目边界

FHL-Image-Studio Photoshop 插件是独立销售、独立维护和独立交付的项目，
不上传到桌面版 GitHub 仓库，也不包含在桌面版源码包或 Portable ZIP 中。

插件与桌面版之间唯一的运行集成是本机回环 HTTP Bridge v1。桌面端不导入插件
源码，插件也不参与桌面端编译、打包或 GitHub Release 构建。

桌面版 GitHub 只记录并维护对插件的兼容能力，包括：

- 本机回环 Photoshop Bridge v1；
- 当前 Profile、模型和蒙版能力声明；
- 单任务提交、状态、取消和结果读取；
- Bridge 安全边界、合同测试和兼容版本记录；
- Portable 根目录标记和正式 EXE 命名约定。

桌面版 GitHub 不包含：

- Photoshop 插件源码；
- CCX 或直接安装负载；
- 插件安装、卸载和销售交付工具；
- 插件互联网分享包、销售素材或用户订单信息。

插件的源码、构建、测试、安装工具和销售交付物由独立插件项目管理。插件项目
自行履行适用许可证义务；桌面版 GitHub 不是插件的下载或源码托管渠道。

## 当前兼容组合

| 项目 | 支持版本 |
| --- | --- |
| Windows | Windows 10 / Windows 11 x64 |
| Photoshop | Photoshop 2023（24.0.0）及更高版本 |
| 桌面端 | FHL Studio 方汤圆版 V2.0.3 |
| Photoshop 插件 | FHL-Image-Studio-Plugins V0.1.0 |
| Bridge | `/fhl-ps/v1`，本机 `127.0.0.1:47631-47640` |

V2.0.3-dev 与 V2.0.3 Portable 使用相同 Bridge v1 协议，插件都可以连接。
开发版需要手动启动；插件的目录授权和自动启动只接受带
`.fhl-studio-portable` 标记及正式 V2.0.3 EXE 的 Portable 根目录。

不要同时运行开发版和 Portable。Photoshop 只会连接当前扫描到的一个 Bridge，
同时运行可能造成端口和当前 API Profile 来源混淆。

## 兼容承诺

- 桌面 V2.0.3 维护 Bridge v1 的现有请求路径和会话模型。
- Bridge 不向插件公开 API Key、Credential Manager 用户名、上游 Base URL 或
  代理配置。
- 桌面端升级如果改变 Bridge 字段、Profile 能力或 Portable 启动约定，必须先
  更新合同测试和本说明，再标记为支持现有插件。
- 插件升级如果需要新的 Bridge 能力，应在独立插件项目完成验证后，仅把兼容
  版本和桌面端所需接口变化记录回桌面文档。

## 用户获取方式

桌面版 GitHub 和 Portable 只提供“支持 Photoshop 插件”的兼容能力，不提供
插件下载。用户需要通过插件项目的独立销售或交付渠道获取插件，并按插件包内的
安装说明完成部署。
