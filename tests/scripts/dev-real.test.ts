import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";

import {
    PLUGIN_FILES,
    OwnedProcesses,
    assertInside,
    checkPrerequisites,
    cleanDevRoot,
    mergeEnabledPlugin,
    prepareWorkspace,
    resolveDevPaths,
    syncPluginArtifacts,
    reserveLoopbackPort,
    parsePort,
    runRealHost,
    waitForKernel,
// @ts-expect-error The launcher is JavaScript and has no declaration file.
} from "../../scripts/dev-real.mjs";

const temporaryDirectories: string[] = [];

async function temporaryRepo() {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vcp-siyuan-real-"));
    temporaryDirectories.push(repoRoot);
    await fs.mkdir(path.join(repoRoot, "i18n"), { recursive: true });
    for (const file of [
        "plugin.json",
        "index.js",
        "index.css",
        "kernel.js",
        "README.md",
        "README.zh-CN.md",
        "LICENSE",
    ]) {
        await fs.writeFile(path.join(repoRoot, file), file, "utf8");
    }
    await fs.writeFile(path.join(repoRoot, "i18n", "en_US.json"), "{}", "utf8");
    return resolveDevPaths(repoRoot);
}

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
        fs.rm(directory, { recursive: true, force: true })));
});

describe("real SiYuan launcher workspace", () => {
    it("exposes only the approved plugin artifact whitelist", () => {
        expect(PLUGIN_FILES).toEqual([
            "plugin.json",
            "index.js",
            "index.css",
            "kernel.js",
            "i18n",
            "icon.png",
            "icon.svg",
            "preview.png",
            "README.md",
            "README.zh-CN.md",
            "LICENSE",
        ]);
        expect(PLUGIN_FILES).not.toContain("src");
        expect(PLUGIN_FILES).not.toContain("node_modules");
    });

    it("creates and merges the enabled plugin without removing other records", () => {
        expect(mergeEnabledPlugin([], "VCPSiyuan")).toEqual([
            { name: "VCPSiyuan", enabled: true },
        ]);
        expect(mergeEnabledPlugin([
            { name: "other", enabled: true, version: "1" },
            { name: "VCPSiyuan", enabled: false, version: "0.4.1" },
        ], "VCPSiyuan")).toEqual([
            { name: "other", enabled: true, version: "1" },
            { name: "VCPSiyuan", enabled: true, version: "0.4.1" },
        ]);
    });

    it("rejects a target outside the isolated development root", () => {
        expect(() => assertInside("C:/repo/.tmp/siyuan-real", "C:/repo/data"))
            .toThrow(/outside/i);
    });

    it("prepares an isolated workspace and preserves petal fields", async () => {
        const paths = await temporaryRepo();
        await fs.mkdir(path.dirname(paths.petalsFile), { recursive: true });
        await fs.writeFile(paths.petalsFile, JSON.stringify([
            { name: "other", enabled: false, custom: { keep: true } },
            { name: "VCPSiyuan", enabled: false, version: "0.4.1", custom: "keep" },
        ]), "utf8");

        await prepareWorkspace(paths);

        const petals = JSON.parse(await fs.readFile(paths.petalsFile, "utf8"));
        expect(petals).toEqual([
            { name: "other", enabled: false, custom: { keep: true } },
            { name: "VCPSiyuan", enabled: true, version: "0.4.1", custom: "keep" },
        ]);
        expect(await fs.stat(paths.pluginDir)).toBeTruthy();
        expect((await fs.readFile(paths.petalsFile, "utf8")).startsWith("[\n\t")).toBe(true);
    });

    it("copies only approved files and never copies source or secret files", async () => {
        const paths = await temporaryRepo();
        await fs.mkdir(path.join(paths.repoRoot, "src"), { recursive: true });
        await fs.writeFile(path.join(paths.repoRoot, "src", "secret.ts"), "secret", "utf8");
        await fs.writeFile(path.join(paths.repoRoot, ".env"), "TOKEN=secret", "utf8");
        await fs.writeFile(path.join(paths.repoRoot, "icon.png"), "icon", "utf8");

        await syncPluginArtifacts(paths);

        expect(await fs.readFile(path.join(paths.pluginDir, "plugin.json"), "utf8")).toBe("plugin.json");
        expect(await fs.readFile(path.join(paths.pluginDir, "icon.png"), "utf8")).toBe("icon");
        await expect(fs.stat(path.join(paths.pluginDir, "src"))).rejects.toMatchObject({ code: "ENOENT" });
        await expect(fs.stat(path.join(paths.pluginDir, ".env"))).rejects.toMatchObject({ code: "ENOENT" });
        await expect(fs.stat(path.join(paths.pluginDir, "icon.svg"))).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("rejects symlinks in the plugin artifact tree", async () => {
        const paths = await temporaryRepo();
        try {
            await fs.symlink(path.join(paths.repoRoot, "README.md"), path.join(paths.repoRoot, "i18n", "escape.json"));
        } catch (error) {
            if (error && typeof error === "object" && "code" in error &&
                (error.code === "EPERM" || error.code === "EACCES")) {
                return;
            }
            throw error;
        }

        await expect(syncPluginArtifacts(paths)).rejects.toThrow(/symbolic link|symlink/i);
    });

    it("cleans only the resolved real-host directory", async () => {
        const paths = await temporaryRepo();
        await fs.mkdir(paths.devRoot, { recursive: true });
        await fs.writeFile(path.join(paths.devRoot, "marker"), "owned", "utf8");

        await cleanDevRoot(paths);

        await expect(fs.stat(paths.devRoot)).rejects.toMatchObject({ code: "ENOENT" });
        await fs.mkdir(paths.devRoot, { recursive: true });
        await fs.writeFile(paths.lockFile, JSON.stringify({ pid: process.pid }), "utf8");
        await expect(cleanDevRoot(paths)).rejects.toMatchObject({ code: "REAL_HOST_ALREADY_RUNNING" });
        await fs.rm(paths.lockFile);
        await cleanDevRoot(paths);
        await expect(cleanDevRoot({ ...paths, devRoot: paths.repoRoot })).rejects.toThrow(/outside|refuse|refusing/i);
        await expect(cleanDevRoot({ ...paths, devRoot: path.dirname(paths.devRoot) })).rejects.toThrow(/outside|refuse|refusing/i);
    });
});

class FakeChild extends EventEmitter {
    exitCode: number | null = null;
    signalCode: string | null = null;
    readonly pid: number;
    readonly stdout = new EventEmitter();
    readonly stderr = new EventEmitter();
    killCalls = 0;

    constructor(pid: number) {
        super();
        this.pid = pid;
    }

    kill() {
        this.killCalls += 1;
        this.exitCode = 0;
        this.emit("exit", 0, null);
        return true;
    }
}

async function prepareHostRepo() {
    const paths = await temporaryRepo();
    await fs.mkdir(path.join(paths.repoRoot, "node_modules", "webpack-cli", "bin"), { recursive: true });
    await fs.writeFile(path.join(paths.repoRoot, "node_modules", "webpack-cli", "bin", "cli.js"), "webpack", "utf8");
    if (process.platform === "win32") {
        await fs.mkdir(path.join(paths.appRoot, "node_modules", "electron", "dist"), { recursive: true });
        await fs.writeFile(path.join(paths.appRoot, "node_modules", "electron", "dist", "electron.exe"), "electron", "utf8");
    } else {
        await fs.mkdir(path.join(paths.appRoot, "node_modules", ".bin"), { recursive: true });
        await fs.writeFile(path.join(paths.appRoot, "node_modules", ".bin", "electron"), "electron", "utf8");
    }
    await fs.mkdir(path.join(paths.appRoot, "stage", "build", "app"), { recursive: true });
    await fs.writeFile(paths.siyuanUi, "ui", "utf8");
    await fs.writeFile(path.join(paths.appRoot, "package.json"), "{}", "utf8");
    await fs.mkdir(path.dirname(paths.electronMain), { recursive: true });
    await fs.writeFile(paths.electronMain, "main", "utf8");
    await fs.mkdir(path.join(paths.appRoot, "kernel"), { recursive: true });
    await fs.writeFile(path.join(paths.appRoot, "kernel", process.platform === "win32" ? "SiYuan-Kernel.exe" : "SiYuan-Kernel"), "kernel", "utf8");
    return paths;
}

describe("real SiYuan launcher prerequisites", () => {
    it.each([
        ["submodule", "MISSING_SUBMODULE", (paths: ReturnType<typeof resolveDevPaths>) => path.join(paths.appRoot, "package.json"), /git submodule update --init --recursive/],
        ["project dependencies", "MISSING_PROJECT_DEPS", (paths: ReturnType<typeof resolveDevPaths>) => path.join(paths.repoRoot, "node_modules", "webpack-cli", "bin", "cli.js"), /pnpm install/],
        ["Electron", "MISSING_ELECTRON", (paths: ReturnType<typeof resolveDevPaths>) => process.platform === "win32"
            ? path.join(paths.appRoot, "node_modules", "electron", "dist", "electron.exe")
            : path.join(paths.appRoot, "node_modules", ".bin", "electron"), /pnpm run install:electron/],
        ["SiYuan UI", "MISSING_SIYUAN_UI", (paths: ReturnType<typeof resolveDevPaths>) => paths.siyuanUi, /pnpm run dev/],
        ["Kernel", "MISSING_KERNEL", (paths: ReturnType<typeof resolveDevPaths>) => [
            path.join(paths.appRoot, "kernel", "SiYuan-Kernel.exe"),
            path.join(paths.appRoot, "kernel", "SiYuan-Kernel"),
        ], /go build -tags "fts5 sqlcipher"/],
    ])("reports an actionable command for missing %s", async (_name, code, missingPath, expected) => {
        const paths = resolveDevPaths(await fs.mkdtemp(path.join(os.tmpdir(), "vcp-siyuan-prereq-")));
        temporaryDirectories.push(paths.repoRoot);
        const missing = new Set([missingPath(paths)].flat());
        await expect(checkPrerequisites(paths, {
            exists: async (filePath: string) => {
                if (missing.has(filePath)) {
                    throw Object.assign(new Error("missing"), { code: "ENOENT" });
                }
            },
        })).rejects.toMatchObject({ code, message: expect.stringMatching(expected) });
    });

    it("allocates an ephemeral loopback port and closes the probe", async () => {
        const events = new EventEmitter();
        let listenOptions: unknown;
        let closed = false;
        const server = {
            once: events.once.bind(events),
            listen(options: unknown, callback: () => void) {
                listenOptions = options;
                callback();
            },
            address: () => ({ port: 43127 }),
            close(callback: (error?: Error) => void) {
                closed = true;
                callback();
            },
        };
        const port = await reserveLoopbackPort({ createServer: () => server });
        expect(port).toBe(43127);
        expect(listenOptions).toEqual({ host: "127.0.0.1", port: 0 });
        expect(closed).toBe(true);
    });

    it("waits for Kernel retries and reports bounded timeout", async () => {
        let calls = 0;
        const response = { status: 200 };
        await expect(waitForKernel({
            port: 43127,
            timeoutMs: 100,
            intervalMs: 1,
            fetchImpl: async () => {
                calls += 1;
                if (calls < 3) {
                    throw new Error("not ready");
                }
                return response;
            },
        })).resolves.toBe(response);
        expect(calls).toBe(3);

        await expect(waitForKernel({
            port: 43128,
            timeoutMs: 5,
            intervalMs: 1,
            fetchImpl: async () => {
                throw new Error("not ready");
            },
        })).rejects.toMatchObject({ code: "KERNEL_TIMEOUT", message: expect.stringContaining("43128") });
    });
});

describe("real SiYuan launcher process ownership", () => {
    it("stops owned children in reverse order and never touches unrelated children", async () => {
        const owned = new OwnedProcesses();
        const first = new FakeChild(1);
        const second = new FakeChild(2);
        const unrelated = new FakeChild(3);
        owned.add("first", first);
        owned.add("second", second);

        await owned.stopAll();

        expect(second.killCalls).toBe(1);
        expect(first.killCalls).toBe(1);
        expect(unrelated.killCalls).toBe(0);
        await owned.stopAll();
        expect(first.killCalls).toBe(1);
    });

    it("starts builders, Kernel, then Electron with the isolated workspace", async () => {
        const paths = await prepareHostRepo();
        const calls: Array<{ executable: string; args: string[]; role: string }> = [];
        let pid = 10;
        const children: FakeChild[] = [];
        const result = await runRealHost({
            repoRoot: paths.repoRoot,
            adapters: {
                spawn: (executable: string, args: string[]) => {
                    const child = new FakeChild(++pid);
                    children.push(child);
                    calls.push({ executable, args, role: calls.length < 2 ? "builder" : calls.length === 2 ? "kernel" : "electron" });
                    return child;
                },
                fetch: async () => ({ status: 200 }),
                kernelPollMs: 1,
                net: {
                    createServer: () => {
                        const events = new EventEmitter();
                        return {
                            once: events.once.bind(events),
                            listen: (_options: unknown, callback: () => void) => callback(),
                            address: () => ({ port: 43127 }),
                            close: (callback: (error?: Error) => void) => callback(),
                        };
                    },
                },
            },
        });

        expect(calls.map((call) => call.role)).toEqual(["builder", "builder", "kernel", "electron"]);
        expect(calls[2].args).toContain("--workspace");
        expect(calls[2].args).toContain(paths.workspace);
        expect(calls[2].args).toContain("--port");
        expect(calls[3].args).toContain(`--workspace=${paths.workspace}`);
        expect(calls[3].args).toContain("--port=43127");
        await result.shutdown();
        expect(children.every((child) => child.killCalls === 1)).toBe(true);
    });

    it("retries Kernel once with a newly reserved port when the first process exits", async () => {
        const paths = await prepareHostRepo();
        const ports = [43127, 43128];
        let portIndex = 0;
        let spawnCount = 0;
        const calls: string[][] = [];
        await expect(runRealHost({
            repoRoot: paths.repoRoot,
            adapters: {
                spawn: (_executable: string, args: string[]) => {
                    spawnCount += 1;
                    calls.push(args);
                    const child = new FakeChild(spawnCount);
                    if (spawnCount === 3) {
                        queueMicrotask(() => {
                            child.exitCode = 21;
                            child.emit("exit", 21, null);
                        });
                    }
                    return child;
                },
                fetch: async () => {
                    throw new Error("not ready");
                },
                kernelTimeoutMs: 5,
                kernelPollMs: 1,
                net: {
                    createServer: () => {
                        const events = new EventEmitter();
                        return {
                            once: events.once.bind(events),
                            listen: (_options: unknown, callback: () => void) => callback(),
                            address: () => ({ port: ports[portIndex++] }),
                            close: (callback: (error?: Error) => void) => callback(),
                        };
                    },
                },
            },
        })).rejects.toMatchObject({ code: "KERNEL_TIMEOUT" });
        expect(calls.filter((args) => args[0] === "serve")).toHaveLength(2);
        expect(calls[2]).toContain("43127");
        expect(calls[3]).toContain("43128");
    });

    it("does not start Electron when Kernel readiness fails", async () => {
        const paths = await prepareHostRepo();
        const calls: string[] = [];
        await expect(runRealHost({
            repoRoot: paths.repoRoot,
            adapters: {
                spawn: (executable: string) => {
                    calls.push(executable);
                    return new FakeChild(calls.length);
                },
                fetch: async () => {
                    throw new Error("not ready");
                },
                kernelTimeoutMs: 5,
                kernelPollMs: 1,
                net: {
                    createServer: () => {
                        const events = new EventEmitter();
                        return {
                            once: events.once.bind(events),
                            listen: (_options: unknown, callback: () => void) => callback(),
                            address: () => ({ port: 43128 }),
                            close: (callback: (error?: Error) => void) => callback(),
                        };
                    },
                },
            },
        })).rejects.toMatchObject({ code: "KERNEL_TIMEOUT" });
        expect(calls).toHaveLength(3);
    });
});

describe("dev-real port selection", () => {
    it("parsePort parses valid values and rejects unset/invalid ones", () => {
        expect(parsePort("43210")).toBe(43210);
        expect(parsePort(6806)).toBe(6806);
        expect(parsePort("  1234  ")).toBe(1234);
        expect(parsePort(undefined)).toBeNull();
        expect(parsePort("")).toBeNull();
        expect(parsePort("abc")).toBeNull();
        expect(parsePort("0")).toBeNull();
        expect(parsePort("70000")).toBeNull();
    });

    it("binds to the preferred port when one is supplied", async () => {
        const events = new EventEmitter();
        let listenOptions: unknown;
        const server = {
            once: events.once.bind(events),
            listen(options: unknown, callback: () => void) {
                listenOptions = options;
                callback();
            },
            address: () => ({ port: 40000 }),
            close(callback: (error?: Error) => void) {
                callback();
            },
        };
        const port = await reserveLoopbackPort({ createServer: () => server }, 40000);
        expect(port).toBe(40000);
        expect(listenOptions).toEqual({ host: "127.0.0.1", port: 40000 });
    });

    it("reports PORT_IN_USE when the preferred port is already taken", async () => {
        const events = new EventEmitter();
        const server = {
            once: events.once.bind(events),
            listen() {
                events.emit("error", Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" }));
            },
            address: () => ({ port: 40000 }),
            close() {},
        };
        await expect(reserveLoopbackPort({ createServer: () => server }, 40000)).rejects.toMatchObject({
            code: "PORT_IN_USE",
        });
    });
});
