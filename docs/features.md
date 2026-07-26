# 功能说明

本文档记录当前软件能力。安装与构建见 [build.md](./build.md)，首次配置见 [usage.md](./usage.md)。

## 生成能力

- 文生图与图生图，支持多张参考图。
- 输入图源:文件对话框、拖拽窗口、剪贴板粘贴、历史复用、双击历史项设为源图。
- 参数:Auto 与固定尺寸、Auto / high / medium / low 质量、PNG / JPEG / WebP 输出格式、seed、negative prompt、风格 chip。
- 双 API 形态:
  - Responses API:POST `/v1/responses`，使用 `image_generation` 工具，SSE 流式接收事件。
  - Images API:POST `/v1/images/generations` 与 `/v1/images/edits`。
- 上游 provider:
  - FHL：独立 `gpt-5.5` 文本 API 加固定 10 槽 Images 连续池，文本 Key 与生图 Key 不复用。
  - APIMart：支持异步提交、轮询任务和结果重新同步。
  - RH：通过本地 8117 桥接支持 `banana2 / image_g2` 文生图与图生图。
- 参数策略:
  - `OpenAI 标准`:只发送官方公开字段。
  - `兼容中转扩展`:额外发送部分 relay 常见扩展字段，例如 seed / negative_prompt。
- prompt 辅助:prompt 历史、内置模板、一键 AI 优化 prompt；Responses API 请求默认要求上游按原始 prompt 生成。
- 批次失败恢复:APIMart / RH 任务可在失败卡片或失败日志中重新同步后台已完成结果。

## FHL 批量与并发

- 每个已启用 Images Key 使用相同的 `1–5/API` 并发设置；10 Key × `4/API` 的总容量为 40。
- 调度按 API1→API10 轮询，多轮填满每个 Key 的有效容量；单个 API 临时降级不压低其他 API。
- 一轮最多批量提交 50 个独立任务，每张图保留独立 `clientTaskId`、group、job、取消、来源和历史记录。
- 单图生成只使用第一个已启用 API；批量图生图根据源图数量创建任务，并由总容量决定运行和排队。
- 批量结果、完整历史和输入队列使用虚拟滚动；列表只加载最长边 384px 的 AVIF 缩略图。
- 成功图片置顶显示 5 秒后恢复任务顺序，不强制改变用户当前滚动位置。

## 360 工作台

- 左侧 `360 工作台`入口，支持生成 2:1 全景、导入外部全景、编辑当前全景和打开最近全景。
- 360 查看器支持 yaw、pitch、roll、FOV、镜头比例、最长边输出尺寸和右上角输出预览。
- 主预览优先使用 WebGL 逐像素渲染，WebGL 不可用时回退自适应加密 canvas 网格。
- 镜头导出带 roundtrip 元数据，可继续用图生图编辑并贴回原全景。
- 360 输出管理按源全景聚合镜头图、编辑镜头图和贴回后的新全景图。
- 大图预览对 roundtrip 图显示 `手动贴回`和`导入贴回`快捷入口。
- 手动贴回支持对齐、操控缩放、卷帘对比、原图按住对比、色彩调整、可调羽化和精细手绘蒙版。

详细说明见 [360 工作台与全景贴回](./panorama-360.md)。

## 画板

- Konva 画布，支持缩放、拖动、双击 fit 与 100% 切换。
- 蒙版:画笔、橡皮、大小滑块、实时半透明叠加。
- 标注:矩形、箭头、自由画笔、文字、颜色选择、选中删除。
- 图像变换:
  - macOS 桌面端优先走 Core Image / Metal。
  - Android、Windows、Linux 与浏览器预览优先走 WebGL 或 canvas 路径，再把结果持久化回宿主可读路径。
  - 不可用时回退 CPU / canvas。
  - 旋转、翻转、裁剪是就地编辑当前画板图，不创建新的生成历史条目。
- 历史对比:Shift + 点击历史项进入左右分屏对比，可拖动分割条。
- 全屏:`Ctrl+Cmd+F`(macOS) / `F11`(Windows/Linux)。

## 历史

- IndexedDB 本地持久化。
- 历史按 48 条分页读取，不再按 120 条上限破坏性裁剪；有输出路径的旧任务可按需恢复缩略图。
- 搜索 prompt、按 mode 筛选、按日期筛选。
- 历史项右键菜单:复制 prompt、复制本地路径、查看 raw 响应、设为源图、用作对比、以此参数重新生成、应用参数但不生成。
- JSON 导入 / 导出，便于跨设备迁移。

## Workspace

- 多 workspace 标签页。
- 每个 workspace 独立保存 prompt、参数、源图、当前图与运行状态。
- macOS 下 `Cmd+N` / `Cmd+W` 新建或关闭；Windows/Linux 下 `Ctrl+N` / `Ctrl+W`。
- 撤销 / 重做覆盖蒙版笔触、标注、清空等画板操作。

## 设置

- 上游配置:API 形态、BASE_URL、API Key、文本模型 ID、图像模型 ID、连接测试。
- FHL 专用配置：独立文本 API、10 槽 Images 连续池、每 API 并发和两套互不触发的保存测试按钮。
- API 凭据库：集中展示脱敏凭据状态，支持单项删除和一键真实清空。
- 一键配置:FHL / APIMart / RH 均提供 API 状态选择入口；RH 默认桥接地址为 `http://127.0.0.1:8117`。
- API Key:
  - 桌面端使用系统安全存储(Keychain / Credential Manager / Secret Service)。
  - Android 壳层使用应用私有 SharedPreferences。
- 主题:深色 / 浅色。
- 字号:小 / 中 / 大。
- 参数预设:尺寸、质量、输出格式、风格。
- 输出目录选择、打开输出目录、历史导入 / 导出、清除 API Key、清空历史。
- 关于窗口:版本号、AGPLv3 协议、GitHub、Issues。

## 平台能力

| 平台 | UI | 内核与宿主能力 |
|---|---|---|
| macOS | Windows V2.0.3 完整 Fluent 内容区 | Wails + Go 本地内核；WKWebView、Keychain、Mac 快捷键和系统对话框；图像变换优先 Core Image / Metal；arm64 DMG。 |
| Windows | Fluent 风格主题 | Wails + Go 本地内核；WebView2；图像变换走 WebGL/canvas 或本地持久化回退。 |
| Linux | 通用桌面主题 | Wails + Go 本地内核；依赖 GTK/WebKitGTK；图像变换走 WebGL/canvas 或本地持久化回退。 |
| Android | Material 3 phone/pad 自适应 | WebView 壳层 + 前端远程内核；壳层提供 native HTTP、图片选择、MediaStore 保存、历史导入导出、震动与全屏。 |
| 浏览器预览 | 按目标平台预览 | 主要用于前端调试；文件、保存和 raw 响应通过浏览器能力或内存虚拟路径回退。 |

Android APK 统一构建 `android` 前端目标，运行时根据窗口尺寸和方向切换 phone / pad 壳层，不再分别维护 phone/pad 两套 APK。

当前 V2.0.3 桌面源码树不包含 `android-shell/`，因此上表 Android 行描述的是保留的平台设计与历史实现，不代表本仓库当前可以直接构建 APK。项目以开源源码为主体，Windows 只提供 x64 Portable ZIP 免安装包。

## 快捷键

| 快捷键 | 功能 |
|---|---|
| `Cmd+Enter`(macOS) / `Ctrl+Enter`(Windows/Linux) | 提交生成 |
| `Cmd+N` / `Cmd+W`(macOS) | 新建 / 关闭 workspace |
| `Ctrl+N` / `Ctrl+W`(Windows/Linux) | 新建 / 关闭 workspace |
| `Cmd+Z` / `Shift+Cmd+Z`(macOS) | 撤销 / 重做 |
| `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`(Windows/Linux) | 撤销 / 重做 |
| `Cmd+C` / `Ctrl+C` | 复制当前画板图 |
| `Cmd+V` / `Ctrl+V` | 粘贴剪贴板图到画板 |
| `1` / `2` / `3` | 切换拖动 / 蒙版 / 标注工具 |
| `Space` | 按住临时切到拖动 |
| `F` | 重置视图 |
| 双击画板 | fit 与 100% 切换 |
| `Ctrl+Cmd+F`(macOS) / `F11`(Windows/Linux) | 全屏 |
| `[` / `]` | 笔刷大小减 / 加 5 |
| `Esc` | 取消生成、退出对比、清除选中或关闭错误 |
| `Delete` | 删除选中的标注 |
| `Shift` + 点击历史 | 设为对比图 B |
| 双击历史 | 作为源图 |
| 右键历史 | 打开上下文菜单 |
