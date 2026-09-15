# 使用 SiYuan Block Attribute 保存任务关联

- Status: Accepted
- Date: 2026-09-13

## Context

VCPSiyuan 需要让用户从 SiYuan Block 创建或关联 Vikunja Task，并支持从任务反向找到一个或多个上下文 Block。关系必须满足以下约束：

- 一个 Block 可能产生多个行动项，一个 Task 也可能引用多个 Block，因此关系是多对多；
- Vikunja 是任务事实源，不应保存或理解 SiYuan Block 标识；
- 关联需要随 SiYuan 数据同步到其他设备，不能只存在于某台设备的插件私有存储；
- Task 到 Block 的反向查询需要索引，但该索引可能损坏、丢失或与已同步的 Block 数据暂时不一致；
- 插件不得为维护关系而自动改写 Block 正文，也不得在每次启动时阻塞扫描整个知识库；
- 插件卸载不应破坏已经随笔记同步的上下文元数据。

这些约束要求明确区分关联事实与查询加速数据，并为未来格式迁移保留版本边界。

## Decision

1. 使用 SiYuan Block Attribute `custom-vikunja-task-links` 保存 Block 到 Vikunja Task 的关联事实。
2. Attribute 值采用版本化 JSON：

   ```json
   {"v":1,"taskIds":[12,34]}
   ```

3. 一个 Block 可以包含多个 Task ID，同一个 Task ID 可以出现在多个 Block 的 Attribute 中，从而形成多对多关系。
4. `taskIds` 只接受正安全整数；写入前去重并稳定升序。未知版本只读报告，不得擅自覆盖或降级。
5. 关联和解除关联采用“读取 Attribute → 验证与合并 → 写入 → 复读验证”的流程。SiYuan 当前接口不提供严格的跨客户端 CAS，因此复读结果不含预期修改时必须报告冲突并允许重试，不能假装成功。
6. 插件私有存储可以维护 Task 到 Block 的反向索引，用于任务详情、当前笔记筛选和跳转。该索引是可删除、可重建的派生数据，不是关联事实源。
7. Attribute 写入成功但索引更新失败时，不回滚 Attribute；将索引标记为需要修复，并以 Attribute 为准重建。
8. 索引修复优先扫描当前文档。全库重建只由用户显式触发，插件启动时不执行阻塞式全库扫描。
9. Block 摘要和正文不写入反向索引；展示时通过 SiYuan 查询。Block 删除或移动造成的失效索引在访问时惰性校正。
10. 关联任务不会自动插入 Inline Task，也不会修改 Block 正文。MVP 通过 Block Menu 和任务详情提供创建、关联、查看与解除入口。
11. 卸载插件时删除本地反向索引，但保留所有 `custom-vikunja-task-links` Attribute。用户如需清理关联元数据，应执行单独、明确确认的操作。

## Consequences

### Benefits

- 关联随 SiYuan Block 数据同步，换设备后仍可恢复。
- 多对多模型覆盖一个上下文对应多个行动项及一个任务引用多处知识的实际场景。
- 本地索引损坏不会丢失关联事实，可以从 Block Attribute 重建。
- Vikunja 不需要保存 SiYuan 专有标识，任务系统与知识系统保持清晰边界。
- 版本字段为未来扩展关联元数据或迁移格式提供安全入口。
- 不改写正文，避免影响 Markdown 导出、编辑器节点生命周期和用户内容语义。

### Costs and constraints

- SiYuan Attribute 写入没有严格跨客户端 CAS；并发修改只能通过复读检测和用户重试降低覆盖风险，不能提供数据库事务级保证。
- Task 到 Block 的高效反查依赖本地派生索引；新设备首次使用或索引损坏后需要按文档或显式全库扫描重建。
- Task 在 Vikunja 中被删除后，Block Attribute 可能暂时保留失效 ID，需要在访问时识别并由用户确认清理。
- 未知格式版本必须停止写入，这会牺牲部分可用性以避免新格式数据被旧插件破坏。
- 卸载默认保留 Attribute，意味着用户笔记中会继续存在不可见于正文的插件元数据。

## Alternatives considered

### 只使用插件私有映射表

未采用。虽然反向查询直接且实现简单，但映射通常局限于单台设备；切换设备、清理插件数据或恢复工作空间后容易丢失关联，无法满足关联随 SiYuan 数据迁移的要求。

### 将关联保存到 Vikunja Task 描述或自定义字段

未采用。这样会把 SiYuan 专有上下文写入任务事实源，污染任务内容，并要求 Vikunja 理解或长期保留外部系统标识。多个 SiYuan 工作空间还会增加命名和权限冲突。

### 使用逗号分隔的 Task ID 字符串

未采用。格式直观，但严格校验、版本迁移及未来扩展元数据的能力较弱，容易产生空值、重复值和歧义。

### 每个 Task 使用一个独立 Attribute

未采用。例如 `custom-vikunja-task-12=true` 会让枚举、批量读取、迁移和清理更复杂，也难以携带统一格式版本。

### 自动在正文插入 Inline Task

未采用。正文节点会引入编辑器生命周期、重复渲染、导出语义和用户内容修改风险。MVP 使用 Block Attribute 保存不可侵入的关联，并把可视交互放在 Block Menu 和 Task Detail。

### 启动时扫描全库重建索引

未采用。大型知识库中会显著延长启动时间，并使普通插件加载承担与当前操作无关的全库成本。采用当前文档优先和用户显式全库修复。
