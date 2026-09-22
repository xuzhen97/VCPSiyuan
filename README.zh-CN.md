# VCPSiyuan（VCP 思源助手）

VCPSiyuan 将思源笔记连接到 **Vikunja v2.5.0 API v2**。插件提供原生 `RightTop` 任务工作台，提供「收件箱、全部任务、项目标签」页签，以及任务详情、创建/编辑/完成/删除和思源 Block 关联。

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
6. 打开右侧 Vikunja Dock，即可在「收件箱、全部任务、项目标签」页签间浏览任务、筛选资源并打开任务详情。收件箱支持未完成和标签筛选；全部任务支持未完成、项目和标签筛选。

## 任务与资源行为

- 任务写入使用乐观版本检查；发生冲突时会阻止覆盖更新的远端任务并提示处理。Vikunja v2.5.0 的 `/info` 声明 `concurrent_writes: false`，且 `updated` 及其派生的 ETag 只有**秒级精度**，因此当远端任务在至少一秒前被修改过时，本地保存会被可靠地判定为过期；同一秒内的两次写入连服务端自身也无法区分。
- Block 关联写入 `custom-vikunja-task-links` Attribute，格式为版本化 JSON（`{"v":1,"taskIds":[...]}`）。本地任务到 Block 反向索引是可删除、可重建的派生数据，完整重建只能通过显式的「修复关联」操作触发。插件不改写 Block 正文，卸载时保留 Block Attribute。
- 离线时展示带时间戳的摘要快照，并禁用远程写入。

## 尚未接入插件界面

以下能力已有 Gateway、Store 和测试，但还没有生产调用链：

- **附件。** 未挂载上传、下载或删除控件，「测试连接」报告的有效附件上限也尚未在运行时生效。设计上使用有界内存传输：插件原始文件上限为 **30 MiB**，有效上限取 30 MiB 与 Vikunja `max_file_size` 中较小者，不宣称支持真正流式传输，失败文件可逐项重试。
- **项目与标签管理。** 影响预览与标题精确匹配的二次确认门禁已实现并有测试，但从未被构造，因此无法创建、编辑或删除项目和标签。
- **提醒、重复规则、标签与负责人。** 任务创建与编辑目前只覆盖标题和描述。

## 本地端到端插件测试（推荐流程）

要在**真实思源宿主**里完整验证插件（加载、Dock、设置、任务读取/创建、Block 关联、状态同步），只需同时启动 Vikunja 与 SiYuan 两个进程。所有凭据只打印在终端，不写入任何文件。

> **只测功能、不想手动配置？** 用一条命令 `pnpm dev:all`：它同时拉起 Vikunja 与真实 SiYuan Web 宿主，**自动把 Origin + Token 写进插件配置**，然后打印入口 URL，你打开浏览器就能测；一次 `Ctrl+C` 全停，`pnpm dev:all:clean` 清理。下面是它展开后的手动流程。

1. 终端 A —— 启动隔离的本地 Vikunja：

   ```bash
   cd "D:/VCPHub/VCPSiyuan"
   pnpm dev:vikunja
   ```

   就绪后打印访问地址与凭据：

   ```text
   Web:    http://127.0.0.1:<动态端口>/
   Origin: http://127.0.0.1:<动态端口>
   Username: vcp-test-<run-id>
   Password: <仅打印在终端>
   Token:  <本地登录 JWT，约 1 天有效，仅打印在终端>
   Data:   D:/VCPHub/VCPSiyuan/.tmp/vikunja-test/<run-id>
   ```

   记下 `Origin` 与 `Token`，保持该终端不关闭。

2. 终端 B —— 启动真实 SiYuan 宿主（隔离工作空间 + 真实 Go Kernel）：

   ```bash
   cd "D:/VCPHub/VCPSiyuan"
   pnpm dev:real
   ```

   首次运行若提示缺少宿主依赖，按下方「开发与沙箱」中的命令显式准备。启动后按终端提示打开 SiYuan Web 地址。

3. 在 SiYuan 中配置插件：
   - 「设置 → 插件 → VCP 思源助手」：Origin 填入第 1 步的 `Origin`（**不要**带 `/api/v2`）。
   - 「设置 → 密钥和变量」：新增密钥 `VIKUNJA_API_TOKEN`，内容填入第 1 步的 `Token`。本地测试用打印的登录 JWT 即可（约 1 天有效）；长期接入请在 Vikunja 创建 API Token 再填入。
   - 点击「测试连接」，能力报告出现即表示连通——该检查同时校验了需鉴权的 `/api/v2/user`，而不只是公开 `/info`。

4. 打开右侧 Vikunja Dock，在「收件箱 / 全部任务 / 项目标签」页签验证任务读取、筛选、创建、完成、删除与 Block 关联；改动后按下方「开发与沙箱」的验证命令回归。

5. 结束测试：分别在两个终端按 `Ctrl+C` 停止。数据保留在 `.tmp/vikunja-test/<run-id>/` 与 `.tmp/siyuan-real/`，确认不再需要后分别用 `pnpm dev:vikunja:clean` 与 `pnpm dev:real:clean` 清理。

> 说明：`dev:vikunja` 不固定占用 `3456` 等端口，每次使用新的动态回环端口和独立数据库；缺少构建产物（`examples/vikunja-server/vikunja-server.exe` 或 `examples/vikunja/frontend/dist/`）时会打印构建命令并退出，不会自动重编。

## 开发与沙箱

插件通过思源 Kernel 访问 Vikunja，因此普通浏览器页面无法直接调用 API。请根据需要验证的行为选择最轻量的夹具：

- **真实集成测试。** `tests/integration/vikunjaLive.test.ts` 通过忠实复刻的 `/api/network/forwardProxy`（`dev/forwardProxyShim.ts`）把真实的 Kernel 调用链（client、gateway、service）打到隔离的 Vikunja v2.5.0 实例上。只有设置了以下两个环境变量才会运行，否则自动跳过：

  ```bash
  VIKUNJA_LIVE_URL=http://127.0.0.1:3456 \
  VIKUNJA_LIVE_TOKEN=<长期 API Token> \
  pnpm vitest run tests/integration/vikunjaLive.test.ts
  ```

- **组件 Playground。** `pnpm dev:play` 使用同一个 shim 和真实的生产 RPC 分发表来托管 `dev/`，可以在浏览器中对真实服务端调试 Dock、Store 和传输层。由于此时是浏览器直接发起 HTTP 请求，本地 Vikunja 实例需要为 Playground 来源开启 CORS（`cors.enable: true` 并包含 `http://localhost:*`）。它不是完整的思源宿主，不经过 Plugin loader、真实 Dock layout、块编辑器、插件持久化和 Go Kernel 插件运行时。正式插件始终经由 Kernel 请求，不需要 CORS。

- **真实思源宿主。** `pnpm dev:real` 构建插件，并使用已检出的真实 SiYuan Electron 与 Go Kernel 启动。它只使用隔离的 `.tmp/siyuan-real/workspace`，不会修改正式工作空间，也不会终止无关进程。启动器动态选择回环端口，不固定占用 `5173`、`5174` 或 `6806`；日志保存在 `.tmp/siyuan-real/logs/` 下的 `plugin-build.log`、`kernel.log` 和 `electron.log`。

  如果启动器报告大型宿主依赖缺失，请显式准备：

  ```bash
  git submodule update --init --recursive
  cd "examples/siyuan/app" && pnpm install --registry https://registry.npmmirror.com
  cd "examples/siyuan/app" && pnpm run install:electron
  cd "examples/siyuan/app" && pnpm run dev
  cd "examples/siyuan/kernel" && go build -tags "fts5 sqlcipher" -o "../app/kernel/SiYuan-Kernel.exe"
  ```

  使用 `pnpm dev:real` 启动真实宿主，按 Ctrl+C 停止；隔离工作空间和日志会保留。使用 `pnpm dev:real:clean` 只删除启动器创建的 `.tmp/siyuan-real/`。启动器不会自动安装 Go 或 Electron，也不会静默回退到组件 Playground。

## 卸载与隐私

卸载会删除插件配置、任务摘要缓存、反向索引和待处理操作元数据，但不会修改或删除 `custom-vikunja-task-links` Attribute。任务描述、附件字节、下载地址、完整用户资料和 Token 不会进入插件持久化数据。
