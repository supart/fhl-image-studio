# Windows 桌面版 V2.0.3 发布说明

这是 Windows x64 Portable 的独立正式补充发布，包含 2026 年 7 月的桌面批处理与稳定性更新。它不替代、不覆盖 macOS 的 `v2.0.3` 或 `v2.0.3.1` Release；Android 版本也不在本次发布范围内。

本次直接分发已经完成跨电脑验收的 Windows Portable 二进制，不重新编译或替换该程序。对应源码和自动化使用 Node.js 24.13.1、Go 1.26.3 与 Wails v2.12.0。

## 下载、解压与升级

1. 下载 `FHL-Image-Studio-Desktop-V2.0.3-Windows-Portable.zip`，并使用同页的 `SHA256SUMS.txt` 校验文件完整性。
2. 解压到普通本地文件夹后，双击 `一键启动FHL Studio V2.0.3.cmd`。无需安装程序、管理员权限、外部浏览器、Node 或 Vite。
3. 首次使用请在桌面版内填写并测试自己的 API。发布 ZIP 不包含 API Key、用户图片、历史记录或运行日志。
4. 同一 Windows 账户从旧版升级时，应用可能读取该账户 Windows Credential Manager 中已有的 FHL Studio 凭据；这不表示 ZIP 内含 API Key。新电脑或新 Windows 账户需要自行配置。
5. 请始终从原始 ZIP 解压后使用；已经运行过的解压目录会生成本机 WebView 数据，不应再次打包或分发。

## 主要更新

- FHL Images 支持 10 个独立 Key，并发按每 API 计算；`10 × 4/API` 的目标总容量为 40。
- 连续模式每次点击“生成”只新增 1 个任务；运行中可以继续点击，多次明确提交会按 API 容量运行或排队，不再把 20/40 的总容量误当作单击任务数。
- 连续模式首次提交会立即打开任务网格并显示对应任务；任务启动失败时显示可重试的失败卡片，不会停在任务数为 0 的“正在生成”。
- 桌面端重启后，旧的排队、提交中和运行中任务会显示为“已中断”，不会自动继续或被下一次生成点击唤醒，可由用户单独重试。
- 首次保存并测试 Images 槽成功后，桌面端会在当前没有可用 Profile 时自动选中第一个成功槽位，使主界面和 Photoshop Bridge 立即进入已配置状态；已有可用当前 API 不会被切换。
- 正式桌面版的 API Key 输入框支持系统右键菜单，可直接使用“粘贴”写入已复制的 Key。
- 批量提交改为一轮规划和传输、后台独立 job，任意任务结束后立即补位。
- 独立 FHL 文本 API 为 AI 优化和图片反推提供 `gpt-5.5` 路由，不使用生图 Key。
- 批量结果、完整相册和批量输入队列均使用虚拟滚动；列表只加载 384px AVIF 缩略图。
- 历史不再因 120 条上限自动删除，397 项压测工作区可按 ID 恢复结果。
- 新的稳定 namespace 会在启动时迁移旧正式/开发数据，一键清空 API 同时覆盖旧凭据副本。

- 360 镜头编辑结果支持自动、手动和导入贴回；手动对齐页恢复边缘羽化，蒙版页提供独立蒙版羽化；完成贴回后的 2:1 全景作为终态显示，不再重复出现贴回按钮。
- 桌面端新增仅回环访问的 Photoshop Bridge，自动避让 `47631-47640` 中已占用端口，并复用当前活动 Profile；公开接口不返回 API Key、Credential Manager 用户、上游 Base URL 或代理配置。
- 桌面 Bridge 支持独立销售和交付的 Photoshop UXP 插件 V0.1.0，覆盖单任务文生图/图生图、选区修改、多图层参考、透明边缘裁切和结果回写。插件必须与桌面端同时运行，不在 Photoshop 内配置 API。

## 本地产物

- GitHub 仓库与 Release 自动源码归档（主要开源交付）
- `FHL-Image-Studio-Desktop-V2.0.3-Windows-Portable.zip`（唯一预编译 Windows 包）
- `FHL-Image-Studio-Desktop-V2.0.3-Source`（本地安全扫描用干净源码暂存）
- 旧版 `fhl-image-studio-*` Codex Skill 已弃用，不再随源码包或 Portable 提供安装入口。
- Photoshop 插件不属于桌面版发布产物。其源码、CCX、安装工具和销售交付物不进入桌面版 GitHub、源码包或 Portable ZIP；桌面版只记录兼容版本和 Bridge 支持。

## Windows Portable

- 仅支持 Windows 10/11 x64，解压后运行 `一键启动FHL Studio V2.0.3.cmd`，无需安装和管理员权限。
- Portable 继续使用 Wails/WebView2 轻量窗口，复用同一套 React 前端和 Go 后端；正常运行不依赖外部浏览器、Node、Vite 或安装程序。
- 作品、历史、WebView 数据和 CLI 私有配置都保存在 Portable 包内，便于移动、备份和一键清理。
- API 凭据继续使用 Windows Credential Manager；发布包自身不包含 API Key、用户图片或个人配置。
- 项目不再构建或维护 Setup/MSI/MSIX，避免同时维护安装、修复、卸载和 Portable 两套数据边界。

## 验收边界

- 本批只使用模拟数据和现有输出验收，不发起付费生图。
- 原生连续提交已通过离线 Wails Mock Store 回归：一次点击创建一个可见任务并只调用一次本地生成入口；最终 Portable 仍需用户在正常窗口完成一次人工界面确认。
- Photoshop 插件的构建、测试和实机验收由独立插件项目负责，不作为桌面 GitHub 发布物。桌面 V2.0.3 的验收范围是 Bridge v1、Profile 能力声明、任务生命周期和与插件 V0.1.0 的兼容记录。
- 完整命令、构建、E2E 和发布包安全检查见 `V2.0.3_ACCEPTANCE_REPORT.md`。
