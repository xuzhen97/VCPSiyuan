# 使用真实 SiYuan 宿主进行插件集成开发

- Status: Accepted
- Date: 2026-09-15

## Context

VCPSiyuan 需要验证右侧 Dock、插件设置、块菜单、当前文档、插件存储、Kernel RPC 和前后端生命周期。现有 `dev/` 浏览器页面直接构造并挂载 `VikunjaDock`，使用 `forwardProxyShim` 连接 Vikunja，适合快速验证组件、Store、Gateway、Service 和传输逻辑，但没有经过 SiYuan 的 `Plugin` 基类、插件加载器、生命周期协调器、真实布局、`window.siyuan`、块编辑器和 Go Kernel 插件运行时。

继续扩充自制 HTML 外壳需要复制 SiYuan 的 DOM、CSS、状态、事件和 API 行为，而且会随着上游变化持续漂移。即使外观接近，也不能证明插件在真实宿主中正确工作。因此需要明确快速组件测试与真实宿主集成验证的边界。

## Decision

1. 完整插件集成开发和人工冒烟验证使用真实 SiYuan Electron、真实 SiYuan Go Kernel 和独立测试工作空间。
2. 插件以正常发布布局同步到独立工作空间的 `data/plugins/VCPSiyuan/`，由 SiYuan 的 `/api/petal/loadPetals`、前端插件 loader 和 Kernel 插件管理器加载；不在开发工具中重新实现这些宿主能力。
3. 独立测试工作空间放在项目 `.tmp/` 下，与用户正式工作空间、插件配置和笔记数据隔离。开发启动器只管理自己创建的进程和文件，不扫描或终止其他 SiYuan、Electron、Node 或 Vite 进程。
4. `pnpm dev:play` 保留为组件 Playground，用于快速验证 Dock、Store、Gateway、Service、`forwardProxyShim` 和 Vikunja API；它不作为真实 Plugin、Dock layout、块编辑器、插件持久化或 Kernel 插件运行时的验证证据。
5. 项目只维护插件构建、白名单产物同步、隔离工作空间初始化和真实宿主启动编排。SiYuan 源码子模块保持只读，不复制、分叉或嵌入当前项目的宿主实现。
6. 开发编排使用 Node.js 标准库和现有 webpack 配置，不为文件监听或进程管理新增依赖。缺少 Go、Electron、Kernel 可执行文件或 SiYuan 前端构建时，启动器应给出明确准备命令，不静默退回模拟环境。
7. 自动化测试覆盖启动器的路径边界、同步白名单、插件启用状态合并、清理范围和进程所有权；真实 Electron 中的视觉、布局和生命周期仍通过真实宿主冒烟验证完成。

## Consequences

### Benefits

- 插件经过与正式运行一致的 Plugin、布局、Kernel、存储、事件和生命周期路径。
- Dock 的位置、尺寸、图标、主题和交互由真实 SiYuan 决定，不依赖易漂移的 HTML 模拟。
- 块菜单、当前文档、`openTab`、Block Attribute 和插件数据可以在真实文档环境验证。
- 独立工作空间防止开发测试污染用户正式笔记和插件配置。
- 组件 Playground 仍保留快速反馈价值，不必为每次纯业务 UI 修改启动完整宿主。
- 不复制 SiYuan 内部实现，减少跟随上游升级的维护成本。

### Costs and constraints

- 首次准备需要 SiYuan 前端依赖、Electron、Go、CGO 和 Kernel 构建，下载和编译成本明显高于浏览器 Playground。
- 真实宿主调试启动更慢，不能完全替代组件级测试。
- 文件覆盖是否自动触发前端插件重载取决于对应 SiYuan 版本；必要时需要刷新 UI 或在真实界面重新启用插件。
- 自动化测试不能完全覆盖 Electron 视觉、Dock 布局和真实编辑器交互，仍需保留人工冒烟步骤。
- SiYuan 宿主升级可能要求更新开发工具链和启动参数，但不应通过在本项目复制宿主代码来规避升级。

## Alternatives considered

### 继续扩充 `dev/index.html` 仿真完整 SiYuan

未采用。它需要复制 SiYuan 的布局、主题、DOM、事件、插件生命周期和 API 状态，维护成本高且不能证明真实宿主兼容性。

### 在本项目实现精简版 Plugin loader 和 `window.siyuan`

未采用。即使接口形状一致，也难以复现生命周期时序、布局持久化、WebSocket、编辑器模型和 Kernel 行为，会形成第二套不可靠的宿主实现。

### 只把插件安装到用户正式 SiYuan 工作空间

未采用。虽然最接近生产环境，但开发过程会污染正式插件状态、存储和笔记数据，并可能与用户已有 SiYuan 进程发生冲突。

### 复制或修改 `examples/siyuan` 形成定制测试壳

未采用。这会扩大仓库体积和分叉维护成本，还会让测试结果依赖本地改造后的宿主，而不是上游真实行为。

### 删除浏览器 Playground，只保留真实宿主

未采用。完整宿主启动成本较高，而 Playground 对 Dock、Store、Gateway、Service 和 Vikunja API 的快速反馈仍有价值；两者承担不同测试层级。
