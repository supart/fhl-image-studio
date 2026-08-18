# V2.0.4 开发工作流

本文档只适用于 Windows 桌面版 V2.0.4。V2.0.3 及更早版本是只读历史，不在本流程内修改。

## 你日常只需要使用三个入口

入口位于 `V2.0.4-开发版` 外层目录：

1. `一键启动V2.0.4开发版.cmd`：启动 Wails 原生开发窗口。
2. `一键检查V2.0.4开发批次.cmd`：在一个功能批次完成后执行完整批次检查。
3. `一键归档V2.0.4里程碑.cmd`：在确认版本阶段生成可恢复归档。

首次使用或更换电脑后，先运行 `一键初始化V2.0.4开发环境.cmd`。初始化只配置当前源码仓库，不会修改旧版本目录。

## Git 规则

- 主开发线：`codex/windows-v2.0.4-development`。
- 高风险功能分支：`codex/windows-v2.0.4-feature/<short-topic>`。
- 一个有意义的功能批次对应一个提交。
- 提交信息使用 `type(scope): summary`，例如 `fix(clipboard): handle browser paste permission fallback`。
- 不使用自动 `reset --hard`；需要撤销时使用 `git revert`。
- `origin` 只保留为只读参考，V2.0.4 分支没有 upstream，默认禁止推送。

## 一次功能批次的固定顺序

1. 先确认目标和范围，只在 V2.0.4 源码目录修改。
2. 代码完成后补充 `docs/changes/YYYY-MM-DD-windows-v2.0.4-<topic>.md`。
3. 只把用户可见变化写入 `CHANGELOG.md`；当前接手状态写入 `PROJECT_CONTEXT.md`。
4. 双击 `一键检查V2.0.4开发批次.cmd`。
5. 检查通过后提交一个完整批次，不把无关改动混在一起。

提交前 Git hook 会自动执行快速安全检查。误把 API Key、本机配置、图片、日志、EXE 或 ZIP 加入暂存区时，提交会被阻止。

## 分层检查

源码脚本也可以直接调用：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-check.ps1 -Level Fast
powershell -ExecutionPolicy Bypass -File .\scripts\dev-check.ps1 -Level Batch
powershell -ExecutionPolicy Bypass -File .\scripts\dev-check.ps1 -Level Milestone
```

`Fast` 用于提交前，`Batch` 用于功能完成后，`Milestone` 用于标签和归档前。所有检查默认离线运行，不发起真实或付费生图。

## 里程碑归档

里程碑归档位于 V2.0.4 外层的 `开发归档`，不属于源码 Git 仓库。归档包含：

- Git bundle 完整历史；
- 只含 Git 跟踪文件的源码 ZIP；
- SHA-256 校验值；
- 版本、提交、分支和检查结果清单；
- 中文恢复说明。

双击里程碑归档入口时，如果当前干净主开发线还没有里程碑标签，工具会在 Milestone 全部通过后自动创建下一个本地 `windows-v2.0.4-dev.N` 标签，不需要手动执行 Git 命令。已有当前标签时会安全复用；`windows-v2.0.4-rc.N` 需要显式指定。正式标签 `windows-v2.0.4-release` 只有在用户明确授权后才能创建，归档工具不会自动创建。

归档恢复时新建恢复目录或恢复分支，不覆盖当前正在使用的开发目录。
