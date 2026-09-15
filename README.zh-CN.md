# VCPSiyuan（VCP 思源助手）

VCPSiyuan 将思源笔记连接到 **Vikunja v2.5.0 API v2**。插件提供原生 `RightTop` 任务工作台，支持「聚焦、收件箱、计划」视图，以及任务详情、创建/编辑/完成和思源 Block 关联。

## 支持边界

- 仅支持 Vikunja **v2.5.0** 和 API **v2**。设置中填写实例 **Origin**（例如 `https://tasks.example.com`），插件内部固定追加 `/api/v2`。新配置不支持 API v1 或自定义 API 路径；旧的 `/api/v1` 设置只在迁移时规范化。
- 每次操作从思源「密钥和变量」读取 API Token，不持久化、不缓存、不回显，也不写入日志。
- 外部请求全部留在 Kernel 中，并通过思源 `/api/network/forwardProxy` 边界；前端不会把外部 URL 直接传给 `siyuan.client.fetch()`。
- 离线时仅展示带时间戳的最小任务摘要，禁用所有远程写操作，不建立离线写队列。

## 配置与使用

1. 打开思源「设置 → 密钥和变量」。
2. 在 Vikunja 的「设置 → API Tokens」中创建令牌，并赋予插件所需权限（任务、项目、标签的读写）。然后在思源「设置 → 密钥和变量」中新增名为 `VIKUNJA_API_TOKEN`（或自定义名称）的密钥，内容填入该令牌。请使用长期有效的 **API Token**，不要使用登录 JWT：登录 JWT 有效期很短，过期后插件会持续返回 `UNAUTHORIZED`。
3. 打开「设置 → 插件 → VCP 思源助手」。
4. 填写 Vikunja 实例 Origin，不要填写 `/api/v1` 或 `/api/v2`；按需选择具体的收件箱项目。收件箱不会递归包含子项目。
5. 点击「测试连接」。能力报告会显示服务端版本、附件能力、服务端 `max_file_size` 和有效附件上限。
6. 打开右侧 Vikunja Dock，即可在「聚焦、收件箱、计划」视图间浏览任务并打开任务详情。

## 任务与资源行为

- 任务写入使用乐观版本检查；发生冲突时会阻止覆盖更新的远端任务并提示处理。Vikunja v2.5.0 的 `/info` 声明 `concurrent_writes: false`，且 `updated` 及其派生的 ETag 只有**秒级精度**，因此当远端任务在至少一秒前被修改过时，本地保存会被可靠地判定为过期；同一秒内的两次写入连服务端自身也无法区分。
- Block 关联写入 `custom-vikunja-task-links` Attribute，格式为版本化 JSON（`{"v":1,"taskIds":[...]}`）。本地任务到 Block 反向索引是可删除、可重建的派生数据，完整重建只能通过显式的「修复关联」操作触发。插件不改写 Block 正文，卸载时保留 Block Attribute。
- 离线时展示带时间戳的摘要快照，并禁用远程写入。

## 尚未接入插件界面

以下能力已有 Gateway、Store 和测试，但还没有生产调用链：

- **附件。** 未挂载上传、下载或删除控件，「测试连接」报告的有效附件上限也尚未在运行时生效。设计上使用有界内存传输：插件原始文件上限为 **30 MiB**，有效上限取 30 MiB 与 Vikunja `max_file_size` 中较小者，不宣称支持真正流式传输，失败文件可逐项重试。
- **项目与标签管理。** 影响预览与标题精确匹配的二次确认门禁已实现并有测试，但从未被构造，因此无法创建、编辑或删除项目和标签。
- **提醒、重复规则、标签与负责人。** 任务创建与编辑目前只覆盖标题和描述。

## 开发与沙箱

插件通过思源 Kernel 访问 Vikunja，因此普通浏览器页面无法直接调用 API。为此提供了两套测试夹具：

- **真实集成测试。** `tests/integration/vikunjaLive.test.ts` 通过忠实复刻的 `/api/network/forwardProxy`（`dev/forwardProxyShim.ts`）把真实的 Kernel 调用链（client、gateway、service）打到隔离的 Vikunja v2.5.0 实例上。只有设置了以下两个环境变量才会运行，否则自动跳过：

  ```bash
  VIKUNJA_LIVE_URL=http://127.0.0.1:3456 \
  VIKUNJA_LIVE_TOKEN=<长期 API Token> \
  pnpm vitest run tests/integration/vikunjaLive.test.ts
  ```

- **浏览器沙箱。** `pnpm dev:play` 使用同一个 shim 和真实的生产 RPC 分发表来托管 `dev/`，可以在浏览器中对真实服务端调试 Dock、Store 和传输层。由于此时是浏览器直接发起 HTTP 请求，本地 Vikunja 实例需要为沙箱来源开启 CORS（`cors.enable: true` 并包含 `http://localhost:*`）。这只影响沙箱：正式插件始终经由 Kernel 请求，不需要 CORS。

## 卸载与隐私

卸载会删除插件配置、任务摘要缓存、反向索引和待处理操作元数据，但不会修改或删除 `custom-vikunja-task-links` Attribute。任务描述、附件字节、下载地址、完整用户资料和 Token 不会进入插件持久化数据。
