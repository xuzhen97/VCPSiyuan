import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
    checkVikunjaPrerequisites,
    cleanVikunjaRoot,
    createPermanentAPIToken,
    createTestCredentials,
    formatReadyOutput,
    permissionsFromRoutes,
    loginToVikunja,
    reserveLoopbackPort,
    runVikunja,
    resolveVikunjaPaths,
    waitForVikunja,
// @ts-expect-error The launcher is JavaScript and has no declaration file.
} from "../../scripts/dev-vikunja.mjs";

// @ts-expect-error The launcher is JavaScript and has no declaration file.
import { OwnedProcesses } from "../../scripts/dev-real.mjs";

const temporaryDirectories: string[] = [];

function cleanupTemporaryDirectories() {
    return Promise.all(
        temporaryDirectories.splice(0).map((directory) =>
            fs.rm(directory, { recursive: true, force: true })));
}

afterEach(cleanupTemporaryDirectories);

async function temporaryRepo(): Promise<string> {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vcp-vikunja-"));
    temporaryDirectories.push(repoRoot);
    return repoRoot;
}

class FakeChild extends EventEmitter {
    exitCode: number | null = null;
    signalCode: string | null = null;
    readonly pid: number;
    readonly stdout = new EventEmitter();
    readonly stderr = new EventEmitter();
    killCalls = 0;
    private exitScheduled = false;

    constructor(pid: number, exitCode: number | null = null, delayMs = 0) {
        super();
        this.pid = pid;
        this.exitCode = exitCode;
        if (delayMs) {
            setTimeout(() => this.finishExit(), delayMs);
        }
    }

    private finishExit() {
        if (this.exitScheduled) return;
        this.exitScheduled = true;
        this.exitCode = this.exitCode ?? 0;
        this.emit("exit", this.exitCode, null);
    }

    kill() {
        this.killCalls += 1;
        this.exitCode = this.exitCode ?? 0;
        this.finishExit();
        return true;
    }
}

describe("dev-vikunja launcher", () => {
    it("resolves isolated paths under the repository test root", () => {
        const paths = resolveVikunjaPaths("C:/repo", "20260915-abc123");

        expect(paths.testRoot).toBe("C:/repo/.tmp/vikunja-test");
        expect(paths.databasePath).toBe("C:/repo/.tmp/vikunja-test/20260915-abc123/data/vikunja.db");
        expect(paths.logPath).toBe("C:/repo/.tmp/vikunja-test/20260915-abc123/logs/vikunja.log");
        expect(paths.lockFile).toBe("C:/repo/.tmp/vikunja-test/.launcher.lock");
        expect(paths.serverPath).toBe("C:/repo/examples/vikunja-server/vikunja-server.exe");
        expect(paths.frontendEntry).toBe("C:/repo/examples/vikunja/frontend/dist/index.html");
    });

    it("creates stable, unique, terminal-safe test credentials", () => {
        const first = createTestCredentials("20260915-abc123");
        const second = createTestCredentials("20260915-abc123");

        expect(first.username).toBe("vcp-test-20260915-abc123");
        expect(first.email).toBe("vcp-test-20260915-abc123@vcpsiyuan.local");
        expect(first.password).toHaveLength(32);
        expect(first.password).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(first.password).not.toBe(second.password);
    });

    it("prints the complete configuration block without altering credentials", () => {
        const token = "header.payload.signature";
        const password = "long-enough-password-0123456789";
        const output = formatReadyOutput({
            origin: "http://127.0.0.1:43127",
            apiOrigin: "http://127.0.0.1:43127/api/v2",
            username: "vcp-test-20260915-abc123",
            password,
            token,
            runDir: "C:/repo/.tmp/vikunja-test/20260915-abc123",
        });

        expect(output).toContain("Vikunja test environment ready");
        expect(output).toContain("Web:\n  http://127.0.0.1:43127/");
        expect(output).toContain("API:\n  http://127.0.0.1:43127/api/v2");
        expect(output).toContain("Origin:\n  http://127.0.0.1:43127");
        expect(output).toContain("Username:\n  vcp-test-20260915-abc123");
        expect(output).toContain(`Password:\n  ${password}`);
        expect(output).toContain(`Token:\n  ${token}`);
        expect(output).toContain("Data:\n  C:/repo/.tmp/vikunja-test/20260915-abc123");
        expect(output.match(new RegExp(token, "g"))).toHaveLength(2);
    });

    it("reserves a loopback port from the injected socket", async () => {
        const closeSpy = vi.fn().mockImplementation((callback) => {
            if (callback) callback();
            return Promise.resolve();
        });
        const listenSpy = vi.fn().mockImplementation((options, callback) => {
            callback(undefined, {});
        });
        const net = {
            createServer: () => ({
                listen: listenSpy,
                once: vi.fn(),
                address: () => ({ address: "127.0.0.1", port: 43127 }),
                close: closeSpy,
            }),
        };

        await expect(reserveLoopbackPort(net)).resolves.toBe(43127);
        expect(closeSpy).toHaveBeenCalled();
    });

    it("binds to the preferred port when one is supplied", async () => {
        const listenSpy = vi.fn((_options: unknown, callback: () => void) => callback());
        const net = {
            createServer: () => ({
                listen: listenSpy,
                once: vi.fn(),
                address: () => ({ address: "127.0.0.1", port: 40000 }),
                close: (callback?: (error?: unknown) => void) => callback?.(),
            }),
        };
        await expect(reserveLoopbackPort(net, 40000)).resolves.toBe(40000);
        expect(listenSpy).toHaveBeenCalledWith(expect.objectContaining({ port: 40000 }), expect.any(Function));
    });

    it("reports PORT_IN_USE when the preferred port is already taken", async () => {
        const events = new EventEmitter();
        const net = {
            createServer: () => ({
                listen: () => {
                    events.emit("error", Object.assign(new Error("EADDRINUSE"), { code: "EADDRINUSE" }));
                },
                once: events.once.bind(events),
                address: () => ({ port: 40000 }),
                close: () => {},
            }),
        };
        await expect(reserveLoopbackPort(net, 40000)).rejects.toMatchObject({ code: "PORT_IN_USE" });
    });

    it("reports actionable errors when required artifacts are missing", async () => {
        const repoRoot = await temporaryRepo();
        await fs.mkdir(path.join(repoRoot, "examples", "vikunja-server"), { recursive: true });
        await fs.writeFile(
            path.join(repoRoot, "examples", "vikunja-server", "vikunja-server.exe"),
            "server", "utf8");
        const paths = resolveVikunjaPaths(repoRoot, "20260915-abc123");

        await expect(checkVikunjaPrerequisites(paths)).rejects.toMatchObject({
            code: "MISSING_VIKUNJA_FRONTEND",
            message: expect.stringMatching(/cd ".*examples[\\/]vikunja[\\/]frontend"[\s\S]*pnpm run build/),
        });

        await fs.mkdir(path.join(paths.frontendDist), { recursive: true });
        await fs.writeFile(paths.frontendEntry, "<html></html>", "utf8");
        await expect(checkVikunjaPrerequisites(paths)).resolves.toBeUndefined();
    });

    it("verifies an authenticated instance instead of relying on public info alone", async () => {
        const calls: string[] = [];
        const fetchImpl = async (url: string, init?: { method?: string, body?: string, headers?: Record<string, string> }) => {
            calls.push(`${init?.method ?? "GET"} ${url}`);
            if (url.endsWith("/api/v1/login")) {
                return { ok: true, status: 200, text: async () => "{}", json: async () => ({ token: "long-lived-jwt" }) };
            }
            if (url.endsWith("/api/v2/user")) {
                return { ok: true, status: 200, text: async () => "{}", json: async () => ({ id: 1, username: "vcp-test-20260915-abc123" }) };
            }
            return { ok: true, status: 200, text: async () => "{}", json: async () => ({}) };
        };

        const result = await loginToVikunja({
            origin: "http://127.0.0.1:43127",
            username: "vcp-test-20260915-abc123",
            password: "password",
            fetchImpl,
        });

        expect(result).toEqual({
            token: "long-lived-jwt",
            user: { id: 1, username: "vcp-test-20260915-abc123" },
        });
        expect(calls).toEqual([
            "POST http://127.0.0.1:43127/api/v1/login",
            "GET http://127.0.0.1:43127/api/v2/user",
        ]);
    });

    it("maps login and authenticated user failures to distinct errors", async () => {
        const login = vi.fn(async () => ({ ok: false, status: 401, text: async () => "unauthorized", json: async () => ({}) }));
        await expect(loginToVikunja({
            origin: "http://127.0.0.1:43127",
            username: "user",
            password: "password",
            fetchImpl: login,
        })).rejects.toMatchObject({ code: "LOGIN_FAILED", message: "Login returned HTTP 401" });

        const auth = vi.fn(async (url: string) => {
            if (url.endsWith("/api/v1/login")) {
                return { ok: true, status: 200, text: async () => "{}", json: async () => ({ token: "token" }) };
            }
            return { ok: false, status: 401, text: async () => "unauthorized", json: async () => ({}) };
        });
        await expect(loginToVikunja({
            origin: "http://127.0.0.1:43127",
            username: "user",
            password: "password",
            fetchImpl: auth,
        })).rejects.toMatchObject({ code: "AUTH_CHECK_FAILED", message: "Authenticated user check returned HTTP 401" });
    });

    it("polls readiness until the public endpoint returns HTTP 200", async () => {
        let attempts = 0;
        const fetchImpl = async () => {
            attempts += 1;
            return { ok: attempts >= 2, status: attempts >= 2 ? 200 : 503, text: async () => "{}", json: async () => ({}) };
        };

        await expect(waitForVikunja("http://127.0.0.1:43127", {
            fetchImpl,
            timeoutMs: 100,
            delayMs: 5,
            signal: new AbortController().signal,
        })).resolves.toBe("ready");
        expect(attempts).toBe(2);

        const slow = vi.fn(async () => ({ ok: false, status: 503, text: async () => "{}", json: async () => ({}) }));
        await expect(waitForVikunja("http://127.0.0.1:43127", {
            fetchImpl: slow,
            timeoutMs: 60,
            delayMs: 5,
            signal: new AbortController().signal,
        })).rejects.toMatchObject({ code: "VIKUNJA_START_TIMEOUT" });
        expect(slow.mock.calls.length).toBeGreaterThan(1);

        const controller = new AbortController();
        const aborting = vi.fn(async (_url, init) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return init?.signal?.aborted ? { ok: false, status: 503, text: async () => "{}", json: async () => ({}) } : { ok: false, status: 503, text: async () => "{}", json: async () => ({}) };
        });
        const abortingCall = waitForVikunja("http://127.0.0.1:43127", {
            fetchImpl: aborting,
            timeoutMs: 10_000,
            delayMs: 5,
            signal: controller.signal,
        });
        setTimeout(() => controller.abort(), 20);
        await expect(abortingCall).rejects.toMatchObject({ code: "VIKUNJA_START_TIMEOUT" });
    });

    it("refuses to clean a path outside the owned test root", async () => {
        const repoRoot = await temporaryRepo();
        await fs.mkdir(path.join(repoRoot, "data"), { recursive: true });
        const paths = resolveVikunjaPaths(repoRoot, "20260915-abc123");

        await expect(cleanVikunjaRoot({
            ...paths,
            testRoot: path.join(repoRoot, "data"),
        })).rejects.toThrow(/outside|refuse|refusing/i);
    });

    it("refuses cleanup while a valid launcher lock is active", async () => {
        const repoRoot = await temporaryRepo();
        const paths = resolveVikunjaPaths(repoRoot, "20260915-abc123");
        await fs.mkdir(paths.testRoot, { recursive: true });
        await fs.writeFile(paths.lockFile, JSON.stringify({ pid: process.pid, port: 43127 }), "utf8");

        await expect(cleanVikunjaRoot(paths)).rejects.toMatchObject({ code: "VIKUNJA_ALREADY_RUNNING" });
        await fs.rm(paths.lockFile);
        await expect(cleanVikunjaRoot(paths)).resolves.toBeUndefined();
    });

    it("runs the complete isolated startup sequence and verifies the printed token", async () => {
        const repoRoot = await temporaryRepo();
        const spawned: Array<{ file: string, args: string[] }> = [];
        let webChild: FakeChild;
        const spawnFn = (file: string, args: string[]) => {
            spawned.push({ file, args });
            if (args[0] === "web") {
                webChild = new FakeChild(4210, null, 20);
                return webChild;
            }
            const child = new FakeChild(4200 + spawned.length, 0, 10);
            child.once = child.on?.bind(child);
            return child;
        };
        const fetchImpl = async (url: string, init?: { method?: string, body?: string, headers?: Record<string, string> }) => {
            if (url.endsWith("/api/v2/user")) {
                return { ok: true, status: 200, text: async () => "{}", json: async () => ({ id: 7, username: "vcp-test-20260915-abc123" }) };
            }
            return {
                ok: true,
                status: 200,
                text: async () => "{}",
                json: async () => init?.method === "POST" ? { token: "long-lived-jwt" } : {},
            };
        };
        const shutdownSpy = vi.fn();
        let handedOff: unknown;
        const result = await runVikunja({
            repoRoot,
            runId: "20260915-abc123",
            net: { createServer: () => ({ once: vi.fn(), address: () => ({ address: "127.0.0.1", port: 43127 }), close: (callback?: () => void) => callback?.(), listen: (_options: unknown, callback: (error?: unknown) => void) => callback(undefined) }) },
            spawnFn,
            fetchImpl,
            delayMs: 1,
            timeoutMs: 1000,
            writeLine: () => undefined,
            shutdownSpy: (fn: unknown) => { shutdownSpy(fn); handedOff = fn; },
        });

        expect(result.port).toBe(43127);
        expect(result.origin).toBe("http://127.0.0.1:43127");
        expect(result.token).toBe("long-lived-jwt");
        expect(result.credentials.username).toBe("vcp-test-20260915-abc123");
        expect(spawned).toEqual([
            { file: pathsFor(repoRoot, "20260915-abc123").serverPath, args: ["migrate"] },
            { file: pathsFor(repoRoot, "20260915-abc123").serverPath, args: expect.arrayContaining(["user", "create", "--username", "vcp-test-20260915-abc123", "--password", result.credentials.password, "--email", result.credentials.email]) },
            { file: pathsFor(repoRoot, "20260915-abc123").serverPath, args: ["web"] },
        ]);
        expect(result.credentials.password).toMatch(/^[A-Za-z0-9_-]{32}$/);
        await expect(fs.stat(result.paths.dataDir)).resolves.toBeTruthy();
        await expect(fs.stat(result.paths.logPath)).resolves.toBeTruthy();
        expect(shutdownSpy).toHaveBeenCalledTimes(1);
        expect(handedOff).toBe(result.shutdown);
        await result.shutdown();
    });

    it("stops only the children owned by this launcher in reverse order", async () => {
        const manager = new OwnedProcesses({
            platform: "linux",
            spawnFn: () => new FakeChild(4200 + manager.children.length, 0, 10),
            killTree: (child: { pid: number, kill: () => boolean, emit: (event: string, ...args: unknown[]) => unknown }) => {
                child.kill();
                child.emit("exit", 0, null);
            },
        });
        const migrate = manager.add("migrate", new FakeChild(4201));
        const web = manager.add("web", new FakeChild(4210));

        await manager.stopAll();
        await manager.stopAll();

        expect(migrate).toBeInstanceOf(FakeChild);
        expect(web).toBeInstanceOf(FakeChild);
        expect(web.killCalls).toBe(1);
        expect(migrate.killCalls).toBe(1);
    });

    function pathsFor(repoRoot: string, runId: string) {
        return resolveVikunjaPaths(repoRoot, runId);
    }
});

describe("permanent API token", () => {
    const routesJson = {
        Body: {
            tasks: { read_all: { path: "/tasks", method: "GET" }, create: { path: "/tasks", method: "POST" } },
            projects: { read_all: { path: "/projects", method: "GET" } },
        },
    };
    const tokenJson = { Body: { id: 7, title: "vcp-siyuan-dev", token: "cleartext-api-token", expires_at: "2100-01-01T00:00:00.000Z" } };

    function ok(body: unknown) {
        return { ok: true, status: 200, json: async () => body } as Response;
    }
    function bad(status: number) {
        return { ok: false, status, json: async () => ({}) } as Response;
    }

    it("derives permissions from /routes and mints a permanent token", async () => {
        const fetchImpl = vi.fn(async (url: string) => {
            if (url.endsWith("/api/v2/routes")) return ok(routesJson);
            if (url.endsWith("/api/v2/tokens")) return ok(tokenJson);
            return bad(404);
        });
        const result = await createPermanentAPIToken({ origin: "http://127.0.0.1:13456", authToken: "login-jwt", fetchImpl: fetchImpl as never });
        expect(result.token).toBe("cleartext-api-token");
        expect(result.expiresAt).toBe("2100-01-01T00:00:00.000Z");
        const tokenCall = (fetchImpl.mock.calls as unknown[][]).find(([url]) => String(url).endsWith("/api/v2/tokens")) as [string, { body: string }];
        const sent = JSON.parse(tokenCall[1].body);
        expect(sent.title).toBe("vcp-siyuan-dev");
        expect(sent.expires_at).toBe("2100-01-01T00:00:00.000Z");
        expect(sent.permissions.tasks).toEqual(["read_all", "create"]);
        expect(sent.permissions.projects).toEqual(["read_all"]);
    });

    it("falls back to a broad permission set when /routes is unavailable", async () => {
        const fetchImpl = vi.fn(async (url: string) => {
            if (url.endsWith("/api/v2/routes")) return bad(500);
            if (url.endsWith("/api/v2/tokens")) return ok(tokenJson);
            return bad(404);
        });
        const result = await createPermanentAPIToken({ origin: "http://x", authToken: "t", fetchImpl: fetchImpl as never });
        expect(result.token).toBe("cleartext-api-token");
        const tokenCall = (fetchImpl.mock.calls as unknown[][]).find(([url]) => String(url).endsWith("/api/v2/tokens")) as [string, { body: string }];
        const sent = JSON.parse(tokenCall[1].body);
        expect(sent.permissions.tasks).toContain("read_all");
        expect(sent.permissions.tasks_attachments).toContain("create");
    });

    it("throws API_TOKEN_FAILED when the token endpoint rejects the request", async () => {
        const fetchImpl = vi.fn(async (url: string) => {
            if (url.endsWith("/api/v2/routes")) return ok(routesJson);
            if (url.endsWith("/api/v2/tokens")) return bad(400);
            return bad(404);
        });
        await expect(createPermanentAPIToken({ origin: "http://x", authToken: "t", fetchImpl: fetchImpl as never }))
            .rejects.toMatchObject({ code: "API_TOKEN_FAILED" });
    });

    it("permissionsFromRoutes unwraps the v2 envelope into group->permission lists", () => {
        expect(permissionsFromRoutes(routesJson)).toEqual({ tasks: ["read_all", "create"], projects: ["read_all"] });
    });

    it("permissionsFromRoutes returns null for non-routes payloads", () => {
        expect(permissionsFromRoutes({ foo: "bar" })).toBeNull();
        expect(permissionsFromRoutes(null)).toBeNull();
    });
});
