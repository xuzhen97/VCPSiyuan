import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
// @ts-expect-error The launcher is JavaScript and has no declaration file.
import { DevAllError, buildPluginConfig, createInboxProject, extractProjectId, parseSiYuanPort, parseVikunjaReady, webEntryUrl, writePluginConfig, runAll } from "../../scripts/dev-all.mjs";

class FakeProcess extends EventEmitter {
    pid: number;
    exitCode: number | null = null;
    signalCode: NodeJS.Signals | null = null;
    private readonly stdout: EventEmitter;
    private readonly stderr: EventEmitter;

    constructor(private readonly exitDelayMs = 0) {
        super();
        this.pid = Math.floor(Math.random() * 1_000_000);
        this.stdout = new EventEmitter();
        this.stderr = new EventEmitter();
    }

    kill(signal?: NodeJS.Signals): boolean {
        if (this.exitCode !== null || this.signalCode !== null) return false;
        if (signal) this.signalCode = signal;
        this.exitCode = 0;
        if (this.exitDelayMs > 0) {
            setTimeout(() => this.emit("exit", this.exitCode, this.signalCode), this.exitDelayMs);
        } else {
            this.emit("exit", this.exitCode, this.signalCode);
        }
        return true;
    }

    writeStdout(text: string): void {
        this.stdout.emit("data", Buffer.from(text));
    }
}

async function tempRoot(): Promise<string> {
    return await fs.mkdtemp(path.join(os.tmpdir(), "dev-all-test-"));
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("dev-all plugin configuration", () => {
    it("builds a config that points at the local Vikunja and inlines the token", () => {
        const config = buildPluginConfig({
            origin: "http://127.0.0.1:43210",
            token: "eyJhbGci.local-jwt",
        });
        expect(config).toEqual({
            schemaVersion: 2,
            vikunjaOrigin: "http://127.0.0.1:43210",
            vikunjaTokenSecretName: "VIKUNJA_API_TOKEN",
            inlineToken: "eyJhbGci.local-jwt",
            inboxProjectId: null,
            snapshotEnabled: true,
        });
    });

    it("persists the config into the plugin directory", async () => {
        const dir = await tempRoot();
        const config = buildPluginConfig({ origin: "http://127.0.0.1:1", token: "t" });
        const file = await writePluginConfig(path.join(dir, "VCPSiyuan"), config);
        expect(file).toBe(path.join(dir, "VCPSiyuan", "config.json"));
        const parsed = JSON.parse(await fs.readFile(file, "utf8"));
        expect(parsed.vikunjaOrigin).toBe("http://127.0.0.1:1");
        expect(parsed.inlineToken).toBe("t");
    });
});

describe("dev-all output parsing", () => {
    const vikunjaReady = [
        "Vikunja test environment ready",
        "",
        "SiYuan plugin configuration:",
        "  Origin: http://127.0.0.1:43210",
        "  Token:  eyJhbGci.local-jwt",
        "",
        "Press Ctrl+C to stop. Data is retained until cleanup.",
    ].join("\n");

    it("extracts origin and token from the Vikunja ready block", () => {
        expect(parseVikunjaReady(vikunjaReady)).toEqual({
            origin: "http://127.0.0.1:43210",
            token: "eyJhbGci.local-jwt",
        });
    });

    it("returns null until the ready block is present", () => {
        expect(parseVikunjaReady("Vikunja test environment\nstarting...")).toBeNull();
    });

    it("extracts the Kernel port from the SiYuan launcher output", () => {
        expect(parseSiYuanPort("Workspace: /x\nPlugin: /y\nKernel port: 52538\n")).toBe(52538);
        expect(parseSiYuanPort("nothing here yet")).toBeNull();
    });

    it("builds the web entry URL at the loopback root path", () => {
        expect(webEntryUrl(52538)).toBe("http://127.0.0.1:52538/");
    });
});

describe("dev-all inbox project", () => {
    it("extracts the project id from any common v2 envelope", () => {
        expect(extractProjectId({ id: 5 })).toBe(5);
        expect(extractProjectId({ data: { id: 6 } })).toBe(6);
        expect(extractProjectId({ body: { id: 7 } })).toBe(7);
        expect(extractProjectId({ Body: { id: 8 } })).toBe(8);
        expect(extractProjectId({})).toBeNull();
        expect(extractProjectId(null)).toBeNull();
    });

    it("creates the inbox project and returns its id", async () => {
        let captured: { url: string; init: { method: string; body: string; headers: Record<string, string> } } | undefined;
        const fakeFetch = async (
            url: string,
            init: { method: string; body: string; headers: Record<string, string> },
        ) => {
            captured = { url, init };
            return { ok: true, status: 200, json: async () => ({ data: { id: 42, title: "VCP Inbox" } }) };
        };
        const id = await createInboxProject("http://127.0.0.1:1", "tok", { fetchImpl: fakeFetch });
        expect(id).toBe(42);
        expect(captured?.url).toBe("http://127.0.0.1:1/api/v2/projects");
        expect(captured?.init.method).toBe("POST");
        expect(JSON.parse(captured?.init.body ?? "{}")).toEqual({ title: "VCP Inbox" });
        expect(captured?.init.headers.Authorization).toBe("Bearer tok");
    });

    it("surfaces a typed error when the API rejects the create", async () => {
        const fakeFetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
        await expect(
            createInboxProject("http://127.0.0.1:1", "tok", { fetchImpl: fakeFetch }),
        ).rejects.toMatchObject({ code: "INBOX_CREATE_FAILED" });
    });
});

describe("dev-all orchestration", () => {
    it(
        "writes the plugin config once both hosts are ready and prints the entry URL",
        async () => {
            const repoRoot = await tempRoot();
            const pluginDir = path.join(
                repoRoot,
                ".tmp",
                "siyuan-real",
                "workspace",
                "data",
                "plugins",
                "VCPSiyuan",
            );
            const vikunja = new FakeProcess();
            const siyuan = new FakeProcess();
            const spawned: Array<{ cmd: string; args: string[]; options?: { env?: Record<string, string> } }> = [];
            const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
            const isVikunja = (args: string[]) => args.join(" ").includes("dev-vikunja.mjs");
            const fakeFetch = async () => ({
                ok: true,
                status: 200,
                json: async () => ({ data: { id: 7, title: "VCP Inbox" } }),
            });

            const run = runAll({
                repoRoot,
                adapters: {
                    spawn: (cmd: string, args: string[], options?: { env?: Record<string, string> }) => {
                        spawned.push({ cmd, args, options });
                        return isVikunja(args) ? vikunja : siyuan;
                    },
                    fetch: fakeFetch,
                },
                // Point the plugin dir at the temp workspace without importing dev-real paths.
                resolvePluginDir: () => pluginDir,
            });

            // Vikunja announces readiness.
            vikunja.writeStdout(
                [
                    "SiYuan plugin configuration:",
                    "  Origin: http://127.0.0.1:43210",
                    "  Token:  eyJhbGci.local-jwt",
                ].join("\n"),
            );
            // SiYuan kernel becomes ready on a dynamic port.
            siyuan.writeStdout("Workspace: x\nKernel port: 52538\n");

            await vi.waitFor(
                async () => {
                    const file = path.join(pluginDir, "config.json");
                    const written = JSON.parse(await fs.readFile(file, "utf8"));
                    expect(written.vikunjaOrigin).toBe("http://127.0.0.1:43210");
                    expect(written.inlineToken).toBe("eyJhbGci.local-jwt");
                    expect(written.inboxProjectId).toBe(7);
                },
                { timeout: 2000 },
            );

            await vi.waitFor(
                () => {
                    expect(stdoutSpy).toHaveBeenCalledWith(
                        expect.stringContaining("http://127.0.0.1:52538/"),
                    );
                },
                { timeout: 2000 },
            );

            expect(spawned.some((s) => isVikunja(s.args))).toBe(true);
            expect(spawned.some((s) => s.args.join(" ").includes("dev-real.mjs"))).toBe(true);
            const siyuanSpawn = spawned.find((s) => s.args.join(" ").includes("dev-real.mjs"));
            const vikunjaSpawn = spawned.find((s) => isVikunja(s.args));
            expect(siyuanSpawn?.options?.env?.SIYUAN_PORT).toBe("16806");
            expect(vikunjaSpawn?.options?.env?.VIKUNJA_PORT).toBe("13456");

            run.stop();
            await vi.waitFor(
                () => {
                    expect(vikunja.exitCode ?? vikunja.signalCode).not.toBeNull();
                    expect(siyuan.exitCode ?? siyuan.signalCode).not.toBeNull();
                },
                { timeout: 2000 },
            );
        },
    );

    it("surfaces a distinct error when a host fails before becoming ready", async () => {
        const repoRoot = await tempRoot();
        const pluginDir = path.join(repoRoot, "x");
        const failing = new FakeProcess();
        const ok = new FakeProcess();
        failing.exitCode = 7;
        failing.emit("exit", 7, null);

        const promise = runAll({
            repoRoot,
            adapters: {
                spawn: (_cmd: string, args: string[]) =>
                    args.join(" ").includes("dev-vikunja.mjs") ? failing : ok,
            },
            resolvePluginDir: () => pluginDir,
        });

        await expect(promise).rejects.toMatchObject({ code: "HOST_EXITED" });
    });

    it("exposes a typed error with a stable code", () => {
        expect(new DevAllError("HOST_EXITED", "boom").code).toBe("HOST_EXITED");
    });
});
