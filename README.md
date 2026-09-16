# VCPSiyuan (VCP for SiYuan)

VCPSiyuan connects SiYuan Note with **Vikunja v2.5.0 API v2**. It provides a native RightTop task workbench for Focus, Inbox, and Planned views, task details and editing, completion, and SiYuan Block links.

## Supported boundary

- Only Vikunja **v2.5.0** and API **v2** are supported. The plugin accepts the instance **Origin** (for example `https://tasks.example.com`) and appends `/api/v2` internally. API v1 and custom API paths are not supported for new configuration; the old `/api/v1` setting is normalized only during migration.
- The API token is read from SiYuan Secrets for each operation. It is not persisted, cached, echoed, or written to logs.
- External requests stay inside the Kernel and use SiYuan's `/api/network/forwardProxy` boundary. The frontend never sends an external URL directly to `siyuan.client.fetch()`.
- Offline mode exposes only timestamped minimum task summaries. Remote writes are disabled and no offline write queue is created.

## Setup

1. Open SiYuan **Settings -> Secrets and Variables**.
2. In Vikunja, open **Settings -> API Tokens** and create a token with the permissions the plugin needs (read/write on tasks, projects, and labels). Then create a SiYuan Secret named `VIKUNJA_API_TOKEN` (or another name you configure) containing that token. Use a long-lived **API token** rather than a login JWT: login JWTs are short-lived, and the plugin would start failing with `UNAUTHORIZED` once one expires.
3. Open **Settings -> Plugins -> VCP for SiYuan**.
4. Enter the Vikunja instance Origin, without `/api/v1` or `/api/v2`, and select the concrete Inbox project if desired. Inbox does not recursively include child projects.
5. Run **Test Connection**. The capability report shows the server version, attachment availability, server `max_file_size`, and the effective attachment limit.
6. Open the Vikunja Dock to browse tasks across the Focus, Inbox, and Planned views, and to open a task's detail.

## Task and resource behavior

- Task writes use optimistic version checks and report conflicts rather than overwriting a newer remote task. Vikunja v2.5.0 advertises `concurrent_writes: false` and stamps `updated` — and the ETag derived from it — at one-second resolution, so a save is reliably rejected as stale when the remote task changed at least a second earlier; two writes inside the same second are indistinguishable to the server itself.
- Block links are stored in the `custom-vikunja-task-links` Attribute as versioned JSON (`{"v":1,"taskIds":[...]}`). The local Task-to-Block reverse index is disposable and rebuildable, and a full rebuild runs only from the explicit **Repair Links** action. The plugin does not rewrite Block body content, and uninstall preserves Block Attributes.
- Offline mode shows the timestamped summary snapshot and disables remote writes.

## Not yet reachable from the plugin UI

These capabilities have gateways, stores, and tests in place, but no production call path yet:

- **Attachments.** No upload, download, or delete control is mounted, and the effective attachment limit reported by *Test Connection* is not yet applied at runtime. The intended design uses bounded in-memory transfer: the plugin raw-file limit is **30 MiB**, the effective limit is the smaller of 30 MiB and Vikunja's advertised `max_file_size`, streaming is not claimed, and failed files stay individually retryable.
- **Project and label management.** The impact preview and exact-title confirmation gate are implemented and tested but never constructed, so creating, editing, or deleting projects and labels is unavailable.
- **Reminders, repeat rules, labels, and assignees.** Task creation and editing currently cover the title and description only.

## Development

The plugin reaches Vikunja through SiYuan's Kernel, so a plain browser page cannot call the API directly. Use the lightest harness that proves the behavior you are changing:

- **Live integration tests.** `tests/integration/vikunjaLive.test.ts` drives the real Kernel stack (client, gateways, services) against an isolated Vikunja v2.5.0 instance through a faithful reimplementation of `/api/network/forwardProxy` (`dev/forwardProxyShim.ts`). They are skipped unless both variables are set:

  ```bash
  VIKUNJA_LIVE_URL=http://127.0.0.1:3456 \
  VIKUNJA_LIVE_TOKEN=<long-lived API token> \
  pnpm vitest run tests/integration/vikunjaLive.test.ts
  ```

- **Component Playground.** `pnpm dev:play` serves `dev/` using the same shim plus the production RPC dispatch table, so the Dock, stores, and transport can be exercised in a browser against a real server. Because the browser then makes the HTTP call itself, a local Vikunja instance needs CORS enabled for the sandbox origin (`cors.enable: true` with `http://localhost:*`). This is not a full SiYuan host: it bypasses the Plugin loader, real Dock layout, block editor, persistence, and Go Kernel plugin runtime. The shipped plugin always goes through the Kernel and needs no CORS.

- **Real SiYuan host.** `pnpm dev:real` builds the plugin and starts the checked-out SiYuan Electron app with the real Go Kernel. It uses only the isolated `.tmp/siyuan-real/workspace` and never changes a production workspace or terminates unrelated processes. The launcher chooses an available loopback port instead of reserving `5173`, `5174`, or `6806`, and keeps logs in `.tmp/siyuan-real/logs/` (`plugin-build.log`, `kernel.log`, and `electron.log`).

  Prepare the large host dependencies explicitly when the launcher reports them as missing:

  ```bash
  git submodule update --init --recursive
  cd "examples/siyuan/app" && pnpm install --registry https://registry.npmmirror.com
  cd "examples/siyuan/app" && pnpm run install:electron
  cd "examples/siyuan/app" && pnpm run dev
  cd "examples/siyuan/kernel" && go build -tags "fts5 sqlcipher" -o "../app/kernel/SiYuan-Kernel.exe"
  ```

  Start the real host with `pnpm dev:real`. Stop it with Ctrl+C; the isolated workspace and logs are intentionally preserved. Remove only the launcher-owned directory with `pnpm dev:real:clean`. The launcher never installs Go or Electron automatically and never falls back to the Component Playground.

## Uninstall and privacy

Uninstall removes the plugin's configuration, summary cache, reverse index, and pending-operation metadata. It does not mutate or remove `custom-vikunja-task-links` Attributes. Task descriptions, attachment bytes, download URLs, full user objects, and tokens are not stored in plugin persistence.
