# RPC 写操作统一使用 request 信封

- Status: Accepted
- Date: 2026-09-21

## Context

Kernel RPC 的绑定层只做一件事：校验信封后调用 `service[method](credentials, request)`。也就是说第二个实参永远是**完整的 request 对象**，而不是它的字段（见 `src/kernel/rpc/registerVikunjaRpc.ts` 的 `bind()`），契约类型也按此定义（`CreateProjectRequest = { draft }`、`PatchProjectRequest = { projectId, draft }`）。

但 `ProjectService.create/patch/delete` 与 `LabelService.create` 早期写成了位置参数：

```ts
async create(credentials, draft: ProjectDraft)          // 实际收到 { draft }
async patch(credentials, projectId, draft)              // 实际收到 ({ projectId, draft }, undefined)
async delete(credentials, projectId, expectedTitle)     // 实际收到 ({ projectId, expectedTitle }, undefined)
```

因此 `draft` 是 `{ draft: {...} }` 而不是 draft 本身，`labelToWire` / `projectToWire` 取值全部落空，向 Vikunja 发出的是空 body：

- 标签：Vikunja 未校验标题长度，**成功建出 title 为空的标签**；随后 `mapLabel` 因「Label title is required」抛错，标签列表与标签页一起失效，用户在插件内甚至无法打开页面删除这条脏数据。
- 项目：Vikunja 校验标题长度，直接返回 4xx，界面表现为 `REMOTE_ERROR: Project operation failed`。

`TaskCommandService.create(credentials, request: CreateTaskRequest)` 从一开始就是正确形状，所以任务创建一直正常——这也掩盖了同类问题，因为类型在 `bind()` 内被 `as unknown as` 断言掉了，编译器无法发现。

单元测试没能拦住该问题：服务层测试一直按位置参数直调 `service.create(credentials, draft)`，绕过了绑定层；`tests/integration/vikunjaLive.test.ts` 更把这套签名当成正确用法固化（本次一并修正）。

## Decision

1. 所有 Kernel RPC 服务方法签名的第二个参数必须是该方法的 request 类型，字段在方法内部解包。
2. 写操作（create/patch/delete）不允许把 request 的字段提升为位置参数，即使只有一个字段。
3. 服务层测试必须按信封形状调用，即 `service.create(credentials, { draft })`；断言下发给 Gateway 的也是解包后的值。

## Alternatives considered

### 让绑定层按方法名展开字段

未采用。绑定层是一张统一的类型化表，它的价值在于"信封进、信封出"；按方法特判会把契约知识复制到绑定层，并让新增方法继续依赖人工同步。

### 允许两种形状（同时兼容位置参数与信封）

未采用。运行时兼容会同时留下两套调用约定，测试与文档继续分叉，正是当前 bug 的成因。

### 依靠类型系统自动发现

部分采用：修正签名后 `tsc` 立刻报出 7 处按位置参数调用的测试代码，证明类型只有在签名正确时才具备约束力。因此在 CI 中继续保持 `pnpm typecheck` 必过。

## Consequences

- 修正后经真实 RPC 验证：`projects.create → patch → delete`（404 确认删除）与 `labels.create` 全部成功，标签标题正确落库。
- 服务层新增回归测试，断言信封解包结果，避免同类错位再次静默通过。
- 新增写操作时，签名必须照抄既有方法形状；`pnpm typecheck` 会拦住签名偏移。
