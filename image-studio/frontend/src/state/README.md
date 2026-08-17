# State Layer

这里保存全局状态和运行时镜像。

## 文件职责

- `studioStore.ts`
  - `useStudioStore` 兼容入口、跨领域编排和仍待迁移的任务生命周期。

- `studioStore.workspaces.ts`
  - 工作区新建、切换、关闭和重命名动作。
  - 宿主取消、事件解绑和活动快照通过运行时依赖注入。

- `studioStore.media.ts`
  - 历史分页、预览水合、画布媒体动作和历史导入导出。
  - 分页使用实时状态合并，并受应用重置 epoch 隔离。

- `studioStore.materials.ts`
  - 素材组增删改、参考图组应用和 output 同步。
  - 继续复用 `materialLibrary.ts` 的原存储键与规范化策略。

- `workspaceRuntime.ts`
  - 工作区运行态的纯辅助逻辑。
  - 用来约束运行中 job、批处理、活跃 tab 的派生行为。

- `studioStore.settings.ts`
  - 普通设置的单一默认值、存储键、读取校验和写入策略。
  - 提供主题、字号、代理和通用设置持久化动作，保持 `useStudioStore` 为兼容门面。

## 维护规则

- store 可以调用 `platform/runtime/*` 暴露的统一接口。
- store 不应重新实现宿主桥接。
- `workspaceRuntime.ts` 优先保持纯函数化，方便测试与复用。

## 改动建议

- 如果改动涉及“平台差异”：
  - 先改 `platform/`
  - 再让 store 消费平台层能力

- 如果改动涉及“状态结构演进”：
  - 先看 `workspaceRuntime.ts` 是否已经有对应归一化逻辑
  - 不要把归一化规则散落进多个组件
