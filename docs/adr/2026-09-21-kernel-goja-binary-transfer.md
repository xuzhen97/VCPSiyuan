# Kernel 侧二进制传输：避免 goja 中的逐字符字符串拼接

- Status: Accepted
- Date: 2026-09-21

## Context

附件上传链路为：前端读取 `File` → Base64 → 插件 JSON-RPC → Kernel（goja）组装 multipart → Base64 → SiYuan `forwardProxy` → Vikunja。

Kernel 插件代码运行在 goja——一个纯 Go 实现的 JS 解释器，没有 V8 的 rope 字符串优化。`encodeBase64` 早期按字符 `result += ...` 拼接，在浏览器里毫无问题（V8 下 1.3 MB 约 74 ms），但在 goja 中每次 `+=` 都整体拷贝字符串，复杂度为 O(n²)。

实测（同一 RPC 方法，载荷为 Base64 字符串）：

| 载荷 | 修复前 | 修复后 |
| --- | --- | --- |
| 50 KB | 430 ms | 125 ms |
| 200 KB | 4.9 s | 341 ms |
| 500 KB | 23.6 s | 775 ms |
| 1 MB | > 30 s（超时） | 1.5 s |
| 1.5 MB | 约 163 s | 2.2 s |
| 真实 1.29 MB PNG | 120 s 未完成 | 1.9 s |

日志证据：`19:25:35` 发起的 1.5 MB 上传直到 `19:28:18` 才出现 `[HTTP] POST .../attachments`，而 Vikunja 的响应是毫秒级——时间全部耗在发出请求之前，即 Kernel 侧的编码。

## Decision

1. Kernel 侧处理二进制时，禁止用 `result +=` 在循环中累积大字符串；改为收集分片并一次 `join('')`（`src/shared/bytes.ts` 的 `encodeBase64`）。
2. Base64 解码使用 256 项查表而非逐字符 `indexOf`：`decodeBase64` 同时服务上传（前端 → Kernel）与二进制下载（Kernel → 前端，单文件上限 30 MiB）。
3. 前端与 Kernel 共用 `src/shared/bytes.ts`，编码方式对两侧一致，不引入运行时分支。

## Alternatives considered

### 依赖 `btoa` / `atob` / `TextEncoder`

未采用。Kernel 的 goja 运行时只注册了 `console`、`url`、`buffer` 与 `require`，没有这些浏览器全局（`Buffer` 虽可用，但前端不可用，仍需一份共享实现）。

### 用 `Buffer` 替换手写实现并加环境分支

未采用。可省去约 15%～20%（实测 JS 编解码循环仅占约 400 ms / 1835 ms），却要在共享模块内引入两套分支；剩余耗时属于 Go ↔ goja 的字符串/JSON 传递，改 JS 无法消除。

### 去掉 Base64，前端直传 Vikunja

未采用。Vikunja 对 SiYuan 源的 CORS 预检返回 204 但不含 `Access-Control-Allow-Origin`，浏览器无法直传；这也正是链路必须经过 Kernel `forwardProxy` 的原因。若要改，需先调整 Vikunja 的 CORS 配置，并把令牌暴露给浏览器，属于安全模型变更。

## Consequences

- 附件上传从"卡死数分钟"变为线性可预期：约 1.4 s/MB，其中大部分是 Go ↔ goja 传递，与载荷成正比。
- 单文件仍受 Vikunja `max_file_size`（本环境 20 MB）与插件 30 MiB 上限约束；20 MB 附件约需 28 s。
- 后续若需进一步提升大附件体验，应走"避免 Base64 往返"而不是继续优化 JS 循环。
