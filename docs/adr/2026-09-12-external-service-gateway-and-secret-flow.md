# 使用前端密钥解析与内核外部服务网关

- Status: Accepted
- Date: 2026-09-12

## Context

VCPSiyuan 需要从思源插件中连接 Vikunja，后续还将接入 VCP AI。外部服务调用需要同时满足以下约束：

- Vikunja Token 不应明文保存在插件配置中；
- 思源的密钥库通过前端 `Plugin.getSecret(name)` 提供运行时读取能力，但当前内核插件 API 没有等价的密钥读取接口；
- 思源内核插件运行于 Goja 环境，提供 `siyuan.client.fetch()`，并不等同于具备完整标准 Web API 的 Node.js 运行时；
- `vikunja-sdk` 默认依赖标准 `fetch`、`Response`、`Headers`、`URL` 和 `AbortSignal` 等能力，不能假设其运行时代码可直接在 Goja 中稳定工作；
- Vikunja 和未来的 VCP AI 应共享基础网络能力，但各自的业务协议、错误和数据模型必须保持隔离。

这些约束共同决定了凭据流、前后端职责以及外部服务适配层的长期边界。

## Decision

采用“前端按请求解析密钥、内核通过独立网关访问外部服务”的架构。

1. 外部服务 Token 由用户保存在思源“设置 → 密钥和变量”中。插件配置仅保存 Base URL 和密钥名称，不保存密钥值。
2. 前端在每次外部服务操作前调用 `Plugin.getSecret(name)` 获取运行时明文，并只在当前本地插件 RPC 请求中将 Token 传给内核。
3. 内核不得持久化、回显或记录 Token，也不得提供读取 Token 的 RPC。请求完成后不保留包含 Token 的长期客户端引用。
4. 内核建立与具体业务无关的 `SiYuanHttpClient`。由于 `siyuan.client.fetch()` 只接受以 `/` 开头的思源本地路径，所有外部服务请求必须由它调用 `/api/network/forwardProxy` 转发；不得把外部 `https://` URL 直接传给 `client.fetch()`。该层统一封装代理 Envelope、JSON 与二进制编解码、状态码、响应头、安全日志和基础错误转换。
5. 每个外部系统拥有独立的 Gateway 和 Service。Vikunja 使用 `VikunjaGateway` 与 `VikunjaService`；未来 VCP AI 使用独立模块，并仅复用公共 HTTP 层与通用错误约定。
6. 前后端只交换 VCPSiyuan 自己定义的稳定 RPC DTO，不直接暴露 Vikunja 或其他外部服务的原始响应。
7. 不在 Goja 中直接运行完整 `vikunja-sdk`。Vikunja Gateway 依据锁定的 Vikunja v2.5.0 源码与 API 契约，自行封装 API v2 的端点、分页、字段转换、条件请求和附件传输。若未来需要大范围使用生成式 SDK，应先实现并验证标准 Web API 兼容层，再评估替换 Gateway 内部实现；该替换不得改变前端 RPC 契约。
8. Vikunja 集成仅支持 v2.5.0 API v2。用户配置实例 Origin，Gateway 内部固定拼接 `/api/v2`；不探测、不降级或兼容 API v1，也不承诺其他服务端版本可写。官方 Vikunja 源码不作为 Git 子模块或运行时依赖加入本仓库，契约回归由锁定版本的脱敏夹具和测试承担。
9. 公共 HTTP 层通过 `/api/network/forwardProxy` 提供 JSON、multipart 和有界 binary 传输能力，但不得包含 Vikunja 的任务、项目、标签或附件业务规则。JSON 响应继续受较小的插件级安全限制；附件请求在内核中编码 multipart，二进制响应由代理以 Base64 返回并解码。当前代理会把响应完整读入内存且硬限制为 32 MiB，因此不宣称流式传输。
10. 插件将单个附件的原始上传或下载大小限制为 30 MiB，为代理响应 Envelope 与编码处理保留 2 MiB 余量。实际允许上传大小取 Vikunja `/info` 返回的 `max_file_size` 与 30 MiB 的较小值，并在发起传输前拒绝超限文件。若未来 SiYuan 提供真正的外部流式请求接口，可在不改变 Gateway 和 RPC 契约的前提下重新评估该上限。
11. Token、Authorization、Secret、附件内容、查询参数和文件名等敏感字段必须从日志、公共错误、测试快照和构建产物中排除。

## Consequences

### Benefits

- 用户凭据由思源密钥库管理，不进入普通插件配置或磁盘缓存。
- 前端 UI、应用用例、外部协议和底层网络传输之间具有明确边界。
- Goja 环境只依赖思源正式提供的内核网络 API，降低运行时兼容风险。
- Vikunja 和 VCP AI 可以独立演进，且能够复用安全、可测试的 HTTP 基础层。
- 外部 SDK 或传输实现未来可以在 Gateway 内替换，而不迫使 Dock 和 RPC 消费方重构。
- 单元测试可以注入 Fake HTTP Client，无需真实 Token 或私人服务实例。

### Costs and constraints

- Token 会以明文短暂存在于前端运行时和本地插件 RPC 请求中，不能实现内核独占凭据；这是当前思源密钥 API 边界下的折中。
- 每次外部操作都需要前端重新解析密钥，调用链比直接在前端请求外部服务更长。
- 插件需要维护 Vikunja v2.5.0 API v2 的任务、项目、标签、用户和附件端点、分页、条件请求及字段映射，不能直接复用完整 SDK 的全部能力。
- 仅支持一个锁定服务端版本降低了首期兼容复杂度，但升级 Vikunja 前必须先更新契约夹具并完成回归验证；未验证版本默认禁止写操作。
- `/api/network/forwardProxy` 的 32 MiB 响应上限和全量内存读取决定了插件不能提供真正的附件流式传输；插件以 30 MiB 原始附件上限换取确定的内存与封装余量。
- multipart、Base64 和有界 binary 扩大了公共 HTTP 层的测试面，同时不得把资源业务语义下沉到传输层。
- 新增外部系统时必须建立独立 Gateway/Service，不允许把协议判断堆入公共 HTTP 层。
- 若思源未来提供内核密钥读取 API，应重新评估并优先将密钥解析移入内核，同时保持上层用例和 UI 契约稳定。

## Alternatives considered

### 在前端直接调用 Vikunja

未采用。虽然实现最少，但会把鉴权、分页、外部错误和协议细节暴露给 UI，也会削弱未来接入 VCP AI 时的模块边界。

### 将 Token 保存到内核插件私有存储

未采用。这样可让内核独占凭据，但绕过了用户已选择的思源密钥库，并引入另一套密钥生命周期和管理界面。

### 将 Token 保存到前端插件配置

未采用。实现简单，但会将敏感值写入普通插件数据，不符合凭据管理要求。

### 通过环境变量向内核提供 Token

未采用。适合服务器部署，但不便于普通桌面用户配置，也与思源内置密钥管理体验割裂。

### 将完整 `vikunja-sdk` 直接打包进 `kernel.js`

未采用。SDK 默认假设标准 Web API/Node.js 18+ 环境，而思源内核插件运行于 Goja，并提供不同形态的 `siyuan.client.fetch()`。在没有兼容层和完整验证前直接运行会引入不必要的首版风险。

### 为 `vikunja-sdk` 立即实现完整 Goja Web API 兼容层

暂不采用。它能提高 SDK 复用度，但兼容 `Response`、`Headers`、`AbortSignal`、multipart 和 binary 等完整语义的成本和风险高于维护本插件实际使用的 v2.5.0 端点；并且 SDK 不能绕过 `client.fetch()` 只能访问思源本地路径的限制。若未来 Vikunja 调用面继续扩大，可在保持 Gateway 与 RPC 契约不变的前提下重新评估。

### 同时支持 Vikunja API v1 与 v2

未采用。双版本探测、数据映射和错误语义会显著扩大测试矩阵，并削弱对写操作行为的确定性。本插件只面向用户当前部署的 v2.5.0；升级必须先经过契约验证。

### 将官方 Vikunja 仓库作为 Git 子模块

未采用。实现和运行不依赖上游源码常驻，永久子模块会增加仓库体积和维护成本。开发时可以临时读取锁定 Tag，长期兼容证据由本仓库内的脱敏夹具和契约测试保存。
