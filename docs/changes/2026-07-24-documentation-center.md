# V2.0.3 Documentation Center

> The installer references described in this historical batch were superseded
> later on 2026-07-24 when delivery was reduced to open-source code and the
> Windows Portable ZIP.

## Scope

建立统一的项目文档入口，明确产品说明、使用文档、构建文档、版本记录、验收报告、详细开发记录和当前交接信息各自的归档位置。本批只修改文档，不修改程序、API 配置或发布产物。

## Changes

- 新增 `docs/README.md`，集中链接常用说明、专题文档、发布资料和开发记录。
- 在根 `README.md` 增加文档入口，并明确 `docs/changes/` 与 `PROJECT_CONTEXT.md` 的不同职责。
- 按当前桌面 V2.0.3 文件系统重写 `docs/project-structure.md`，补充安装器、Portable、CLI、媒体、凭据和数据目录边界。
- 删除项目结构中不存在的 `android-shell/` 当前目录描述；相关 Android 文件仍作为历史或跨项目协作资料保留。
- 同步更新 `docs/build.md`、`docs/usage.md`、`docs/features.md` 和 `docs/troubleshooting.md`，校正 V2.0.3 的独立 FHL 文本/Images 配置、每 API 并发、虚拟预览、Windows 交付形态和真实数据路径。

## Documentation Policy

- 稳定产品行为写入 `README.md` 或对应 `docs/*.md`。
- 每批技术过程写入 `docs/changes/YYYY-MM-DD-topic.md`。
- 当前接手所需的状态、验证和恢复断点写入 `PROJECT_CONTEXT.md`。
- 发布摘要、单版本交付和完整验收分别写入 `CHANGELOG.md`、`RELEASE_NOTES_DESKTOP_V*.md` 和 `V*_ACCEPTANCE_REPORT.md`。
- 所有文档禁止记录完整 API Key、私有配置、用户图片或大段原始日志。

## Verification

- 已解析本批入口、结构、使用、功能、构建、排错和交接文档中的 46 个本地 Markdown 链接，缺失目标为 0。
- 已检查本批九个 Markdown 文件，行尾多余空白为 0；Markdown 表格列数检查通过。
- `git diff --check` 通过；命令只报告工作树中既有文件的换行符转换提示。
- 本批未修改运行时代码，因此未重复运行前端、Go 或 Worker 测试。
