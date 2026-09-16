# 本地 Vikunja + 真实 SiYuan 插件集成测试指南

本文记录如何在 Windows Git Bash 中运行本地 Vikunja、启动隔离的真实 SiYuan Web 宿主、加载 VCPSiyuan 插件，并通过浏览器或 Playwright MCP 完成端到端验证。

> 本项目的 `pnpm dev:real:web` 使用真实 SiYuan 前端和 Go Kernel，只是不启动 Electron 窗口。它不是自制的 SiYuan 模拟器。工作空间固定隔离在 `.tmp/siyuan-real/workspace`，不会使用正式 SiYuan 工作空间。

## 1. 环境与目录

从仓库根目录 `D:/VCPHub/VCPSiyuan` 执行本文命令。

主要地址和目录：

| 项目 | 默认值 |
| --- | --- |
| Vikunja | `http://localhost:3456` |
| Vikunja 数据库 | `.tmp/vikunja/data/vikunja.db` |
| Vikunja 日志 | `.tmp/vikunja/logs/server.log`（后台运行时） |
| SiYuan 工作空间 | `.tmp/siyuan-real/workspace` |
| SiYuan 日志 | `.tmp/siyuan-real/logs/` |
| 插件部署目录 | `.tmp/siyuan-real/workspace/data/plugins/VCPSiyuan/` |
| SiYuan Web 端口 | 启动时动态分配，以终端输出为准 |

Windows Git Bash 中始终使用正斜杠路径并给路径加双引号。

## 2. 首次准备

### 2.1 初始化项目和子模块

```bash
cd "D:/VCPHub/VCPSiyuan"
git submodule update --init --recursive
pnpm install
```

### 2.2 准备 Go 和 MinGW

当前机器使用：

```bash
export GO_ROOT="$HOME/.local/go"
export MINGW_ROOT="/c/Users/xuzhe/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.MCF.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64"
export PATH="$GO_ROOT/bin:$MINGW_ROOT/bin:$PATH"
export CGO_ENABLED=1
export GOPROXY="https://goproxy.cn,direct"
```

每个新的 Git Bash 会话都需要重新执行这些 `export`。

### 2.3 构建本地 Vikunja

Vikunja 源码位于 `examples/vikunja`，当前检出版本为 `v2.5.0`。

先构建前端：

```bash
cd "D:/VCPHub/VCPSiyuan/examples/vikunja/frontend"
pnpm install --registry https://registry.npmmirror.com
pnpm run build
```

再构建 Windows 服务端。必须写入 `v2.5.0` 版本号；如果直接 `go build`，服务会报告 `dev`，而当前插件会为未知版本禁用写操作。

```bash
cd "D:/VCPHub/VCPSiyuan/examples/vikunja"
mkdir -p "../vikunja-server"
go build \
  -tags "fts5 sqlite" \
  -ldflags '-X code.vikunja.io/api/pkg/version.Version=v2.5.0' \
  -o "../vikunja-server/vikunja-server.exe" \
  .
```

验证：

```bash
"D:/VCPHub/VCPSiyuan/examples/vikunja-server/vikunja-server.exe" version
```

预期包含 `Vikunja api version v2.5.0`。

### 2.4 准备真实 SiYuan 宿主

```bash
cd "D:/VCPHub/VCPSiyuan/examples/siyuan/app"
pnpm install --registry https://registry.npmmirror.com
pnpm run install:electron
pnpm run build:app
pnpm run build:desktop
```

构建 SiYuan Kernel，版本号必须和当前 SiYuan app 匹配；当前为 `3.8.2`：

```bash
cd "D:/VCPHub/VCPSiyuan/examples/siyuan/kernel"
go build \
  -tags "fts5 sqlcipher" \
  -ldflags "-X 'github.com/siyuan-note/siyuan/kernel/util.Ver=3.8.2'" \
  -o "../app/kernel/SiYuan-Kernel.exe"
```

## 3. 启动 Vikunja

### 3.0 一键启动（推荐）

`pnpm dev:vikunja` 使用已构建的本地 `examples/vikunja-server/vikunja-server.exe` 与 `examples/vikunja/frontend/dist/` 前端，启动一个隔离、可销毁的本地 Vikunja 测试环境。它自动处理动态回环端口、隔离工作空间、用户创建和 JWT 获取，并在终端直接打印访问地址、账号、密码和 Token。

```bash
cd "D:/VCPHub/VCPSiyuan"
pnpm dev:vikunja
```

输出示例：

```text
Vikunja test environment ready
Web:   http://127.0.0.1:<动态端口>/
API:   http://127.0.0.1:<动态端口>/api/v2
Username: vcp-test-<run-id>
Password: <随机生成，仅打印到终端>
Token:  <长期 JWT，仅打印到终端>
Data:  D:/VCPHub/VCPSiyuan/.tmp/vikunja-test/<run-id>
```

- 每次运行使用 `.tmp/vikunja-test/<run-id>/` 下独立的 SQLite 数据库，退出后保留。
- 账号、密码和 Token 只打印到终端，不写入源码、Git 跟踪文件、项目文档或持久化配置。
- 缺少 `vikunja-server.exe` 或前端 `dist/` 时，打印准确的构建命令并退出，不自动重新编译 Go 服务端或前端。
- 按 `Ctrl+C` 停止；只清理启动器自己拉起的进程，不动无关进程。
- 连接校验同时检查公开 `/api/v2/info` 和需鉴权的 `/api/v2/user`，避免把未鉴权的公开接口当成“已连接”。

清理全部测试数据：

```bash
pnpm dev:vikunja:clean
```

下面的手动步骤（3.1–3.5）是回退方案，用于需要手动控制端口或环境变量时。

### 3.1 创建本地数据目录

```bash
cd "D:/VCPHub/VCPSiyuan"
mkdir -p ".tmp/vikunja/data" ".tmp/vikunja/logs"
```

### 3.2 定义本地开发配置

在当前 Git Bash 会话中执行：

```bash
export VIKUNJA_DATABASE_TYPE="sqlite"
export VIKUNJA_DATABASE_PATH="D:/VCPHub/VCPSiyuan/.tmp/vikunja/data/vikunja.db"
export VIKUNJA_SERVICE_INTERFACE="127.0.0.1:3456"
export VIKUNJA_SERVICE_PUBLICURL="http://localhost:3456"
export VIKUNJA_SERVICE_ROOTPATH="D:/VCPHub/VCPSiyuan/examples/vikunja/frontend/dist"
export VIKUNJA_SERVICE_JWTTLSHORT="86400"
export VIKUNJA_CORS_ENABLE="true"
export VIKUNJA_CORS_ALLOWCREDENTIALS="true"
export VIKUNJA_CORS_ALLOWEDORIGINS="http://127.0.0.1:*,http://localhost:*"
export VIKUNJA_SERVICE_ENABLEREGISTRATION="true"
```

`VIKUNJA_SERVICE_JWTTLSHORT=86400` 仅用于本地开发，把登录 JWT 有效期设为一天。生产环境应使用 Vikunja 长期 API Token，而不是扩大登录 JWT 有效期。

### 3.3 首次创建用户

迁移数据库：

```bash
cd "D:/VCPHub/VCPSiyuan/examples/vikunja-server"
./vikunja-server.exe migrate
```

只在用户尚不存在时创建：

```bash
./vikunja-server.exe user create \
  --username "vcpadmin" \
  --password "<本地开发密码>" \
  --email "admin@vcpsiyuan.local"
```

不要把真实密码或 Token 写入 Git、文档、截图或日志。

### 3.4 前台运行（推荐）

在独立终端 A 中：

```bash
cd "D:/VCPHub/VCPSiyuan/examples/vikunja-server"
./vikunja-server.exe web
```

看到以下内容即表示服务已启动：

```text
HTTP server listening on 127.0.0.1:3456
```

健康检查：

```bash
curl -fsS "http://localhost:3456/api/v2/info"
```

### 3.5 获取开发 JWT

在终端 B 中执行；该 Token 受 `VIKUNJA_SERVICE_JWTTLSHORT` 控制：

```bash
VIKUNJA_TOKEN="$(curl -fsS \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"username":"vcpadmin","password":"<本地开发密码>"}' \
  "http://localhost:3456/api/v1/login" \
  | python -c 'import json,sys; print(json.load(sys.stdin)["token"])')"
```

验证 Token，不能只检查公开的 `/info`：

```bash
curl -fsS \
  -H "Authorization: Bearer $VIKUNJA_TOKEN" \
  "http://localhost:3456/api/v2/user"
```

> 推荐长期方案：登录 `http://localhost:3456`，在 Vikunja 用户设置中创建有明确权限和过期时间的 API Token。插件需要任务、项目、标签、用户查询及任务附件相关权限。API Token 只在创建时显示一次。

## 4. 启动真实 SiYuan Web 宿主

在独立终端 C 中：

```bash
cd "D:/VCPHub/VCPSiyuan"
pnpm dev:real:web
```

启动器会自动：

1. 启动插件前端和 Kernel webpack watcher；
2. 将发布白名单产物同步到隔离工作空间；
3. 写入插件启用状态及 `bazaar.trust=true`；
4. 启动真实 SiYuan Go Kernel；
5. 动态分配回环端口。

记下终端输出：

```text
>>> SiYuan Web ready at: http://127.0.0.1:<动态端口>/ <<<
```

浏览器打开：

```text
http://127.0.0.1:<动态端口>/stage/build/desktop/
```

不要假定端口一直是 `65238`；每次启动都可能不同。

如果希望测试真实 Electron 窗口，则改用：

```bash
pnpm dev:real
```

按 `Ctrl+C` 只会停止本启动器拥有的进程。工作空间和日志默认保留。

## 5. 在 SiYuan 中配置插件

1. 打开右侧 Dock 的 **Vikunja 任务**。
2. 点击 **设置**。
3. 填写：
   - Vikunja 实例 Origin：`http://localhost:3456`
   - Vikunja API Token：`$VIKUNJA_TOKEN` 的值，或长期 API Token
   - 收件箱项目：本地 Inbox 通常为 `1`
4. 点击 **测试连接**。
5. 确认显示连接成功后，必须继续点击 **保存**。
6. 回到 Dock 点击 **刷新**，再切换到 **收件箱**。

重要区别：

- **测试连接**只验证设置面板中的草稿，不会应用到 Dock；
- **保存**才会更新插件运行配置并持久化；
- 因此“测试成功但 Dock 仍显示离线”时，首先确认是否点击了保存。

当前连接测试会同时访问：

```text
GET /api/v2/info   # 服务版本和能力
GET /api/v2/user   # 验证 Token 确实可用
```

旧构建只检查公开的 `/info`，过期 Token 也可能误报连接成功。出现异常时先确认已部署最新的 `kernel.js`，再刷新页面或禁用后重新启用插件。

## 6. Playwright MCP 浏览器验证流程

在 Pi 中使用 Playwright MCP 时，按以下顺序操作：

1. 导航到 `http://127.0.0.1:<动态端口>/stage/build/desktop/`。
2. 等待文本 `Vikunja` 出现，确保 Plugin loader 已完成。
3. 点击右侧 Dock 的 **设置**。
4. 填入 Origin、Token 和 Inbox 项目 ID。
5. 点击 **测试连接**，等待 `✓ 已连接 Vikunja`。
6. 点击 **保存**。
7. 点击 Dock 的 **刷新**。
8. 点击 **收件箱**，确认任务标题可见。
9. 点击 **新建任务**，创建唯一标题，例如：
   `E2E smoke 2026-09-15 21:30`。
10. 刷新收件箱并确认新任务出现。
11. 在 SiYuan 文档中创建或选中一个块，通过块菜单创建/关联 Vikunja 任务。
12. 打开任务详情，确认反向关联块可见。
13. 完成任务后再次刷新，确认状态同步。

不要在 Playwright 输出、截图文件名或最终回复中回显完整 Token。

### 最小冒烟断言

一次完整开发验证至少应确认：

- SiYuan 标题和版本正常显示；
- `window.siyuan.ws.app.plugins` 包含 `VCPSiyuan`；
- 右侧 Dock 图标和 `Vikunja 任务` 面板存在；
- 测试连接验证真实鉴权；
- 收件箱能读取已有任务；
- 插件能创建一个新任务；
- 新任务能关联 SiYuan Block；
- 任务详情能回到关联 Block；
- 完成状态能够写回 Vikunja。

## 7. 开发修改后的验证

`pnpm dev:real:web` 会监听并同步：

```text
index.js
index.css
kernel.js
```

修改代码后的最短流程：

1. 等待终端显示 webpack 编译成功；
2. 等待 `[plugin] synchronized ...`；
3. 前端改动：刷新浏览器；
4. Kernel 改动：观察 `kernel.log` 中插件重载记录；必要时在 SiYuan 中禁用后重新启用插件；
5. 重复对应的浏览器冒烟步骤。

提交前运行：

```bash
cd "D:/VCPHub/VCPSiyuan"
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

若要直接跑真实 Vikunja 集成测试：

```bash
VIKUNJA_LIVE_URL="http://localhost:3456" \
VIKUNJA_LIVE_TOKEN="$VIKUNJA_TOKEN" \
pnpm exec vitest run "tests/integration/vikunjaLive.test.ts"
```

## 8. 常见问题

### 测试连接成功，但 Dock 显示离线

依次检查：

1. 测试后是否点击了 **保存**；
2. Token 是否过期；登录 JWT 默认是短期 Token；
3. 用 `/api/v2/user` 验证 Token，而不是只访问公开的 `/api/v2/info`；
4. 打开 `.tmp/siyuan-real/logs/kernel.log`，查找任务请求是否返回 `401`；
5. 确认最新 `kernel.js` 已同步并被 Kernel 插件管理器重载。

### 收件箱提示未配置

在设置中填写正整数项目 ID。默认本地用户的 Inbox 通常为 `1`，但应以 Vikunja 实际项目为准。

### 可以读取任务，但不能新建或修改

检查：

1. Vikunja API Token 是否包含写权限；
2. `curl http://localhost:3456/api/v2/info` 的 `version` 是否为 `v2.5.0`；
3. 若显示 `dev`，按 2.3 节使用 ldflags 重新构建并重启 Vikunja。

### 端口 3456 已占用

只检查该端口对应进程，不要批量结束所有 Node、Electron 或 SiYuan 进程：

```bash
powershell.exe -NoProfile -Command \
  'Get-NetTCPConnection -LocalPort 3456 -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess'
```

确认是本项目的旧 Vikunja 进程后，再只结束该 PID。

### SiYuan 页面没有插件 Dock

检查：

```bash
curl -fsS \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"frontend":"browser-desktop"}' \
  "http://127.0.0.1:<动态端口>/api/petal/loadPetals"
```

返回数据应包含 `VCPSiyuan`。同时检查：

- `.tmp/siyuan-real/workspace/data/plugins/VCPSiyuan/plugin.json`
- `.tmp/siyuan-real/workspace/data/storage/petal/petals.json`
- `.tmp/siyuan-real/logs/kernel.log`
- 浏览器控制台

### Kernel 版本不匹配

`plugin.json` 的 `minAppVersion` 不能高于当前 SiYuan app。当前环境为 SiYuan `3.8.2`，Kernel 也必须通过 ldflags 构建成 `3.8.2`。

## 9. 停止与清理

分别在 Vikunja 和 SiYuan 终端按 `Ctrl+C`。

保留 `.tmp/` 可以复用数据库、用户、测试笔记和插件设置。确定不再需要时，清理 SiYuan 隔离工作空间：

```bash
cd "D:/VCPHub/VCPSiyuan"
pnpm dev:real:clean
```

Vikunja 测试数据用一键命令清理：

```bash
pnpm dev:vikunja:clean
```

它删除 `.tmp/vikunja-test/` 下全部隔离测试数据，仅在对应 `dev:vikunja` 未运行时生效。如果之前使用第 3 节手动方式，也可以手动删除：

```bash
rm -rf "D:/VCPHub/VCPSiyuan/.tmp/vikunja"
```

这些命令会永久删除本地 Vikunja 测试数据，只应在确认不需要测试数据后执行。
