import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import { OwnedProcesses, resolveDevPaths } from "./dev-real.mjs";

const DEFAULT_SECRET_NAME = "VIKUNJA_API_TOKEN";
export const DEFAULT_SIYUAN_PORT = "16806";
export const DEFAULT_VIKUNJA_PORT = "13456";

export class DevAllError extends Error {
    code;

    constructor(code, message, cause) {
        super(message, cause ? { cause } : undefined);
        this.name = "DevAllError";
        this.code = code;
    }
}

/**
 * Build the plugin config that points the plugin at the local Vikunja.
 * The token travels as `inlineToken`, the plugin's intended path for simple
 * local setups, so we never have to touch SiYuan's encrypted secrets.
 */
export function buildPluginConfig({
    origin,
    token,
    inboxProjectId = null,
    secretName = DEFAULT_SECRET_NAME,
}) {
    return {
        schemaVersion: 2,
        vikunjaOrigin: origin,
        vikunjaTokenSecretName: secretName,
        inlineToken: token,
        inboxProjectId,
        snapshotEnabled: true,
    };
}

/**
 * Vikunja v2 wraps single-resource responses in an envelope. Read the created
 * project id tolerantly so we do not depend on the exact wrapper shape.
 */
export function extractProjectId(json) {
    if (!json || typeof json !== "object") return null;
    for (const candidate of [json, json.data, json.body, json.Body]) {
        if (candidate && typeof candidate === "object" && Number.isFinite(candidate.id)) {
            return Number(candidate.id);
        }
    }
    return null;
}

const DEFAULT_INBOX_NAME = "VCP Inbox";

/**
 * Create the Inbox project in the local Vikunja so the plugin's Inbox tab works
 * out of the box. Returns the project id; throws DevAllError on failure.
 */
export async function createInboxProject(
    origin,
    token,
    { name = DEFAULT_INBOX_NAME, fetchImpl = fetch } = {},
) {
    const response = await fetchImpl(`${origin}/api/v2/projects`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title: name }),
    });
    if (!response.ok) {
        throw new DevAllError(
            "INBOX_CREATE_FAILED",
            `Failed to create inbox project (HTTP ${response.status}).`,
        );
    }
    const json = await response.json().catch(() => null);
    const id = extractProjectId(json);
    if (id === null) {
        throw new DevAllError("INBOX_CREATE_FAILED", "Could not read the created inbox project id.");
    }
    return id;
}

export async function writePluginConfig(pluginDir, config, fsAdapter = fs) {
    await fsAdapter.mkdir(pluginDir, { recursive: true });
    const file = path.join(pluginDir, "config.json");
    await fsAdapter.writeFile(file, JSON.stringify(config, null, 2), "utf8");
    return file;
}

/**
 * dev-vikunja prints a stable "SiYuan plugin configuration:" block when it is
 * ready. Parse the Origin/Token from it; null until that block is present.
 */
export function parseVikunjaReady(text) {
    if (!text.includes("SiYuan plugin configuration:")) return null;
    const origin = text.match(/Origin:\s*(\S+)/);
    const token = text.match(/Token:\s*(\S+)/);
    if (!origin || !token) return null;
    return { origin: origin[1], token: token[1] };
}

export function parseSiYuanPort(text) {
    const match = text.match(/Kernel port:\s*(\d+)/);
    return match ? Number(match[1]) : null;
}

export function webEntryUrl(port) {
    return `http://127.0.0.1:${port}/`;
}

/**
 * One-command local integration test: boots the local Vikunja and the real
 * SiYuan web host as owned children, auto-writes the plugin config when both
 * are ready, prints the single entry URL, and stops both on Ctrl+C.
 *
 * Returns a Promise that resolves on clean shutdown and exposes `.stop()`.
 */
export function runAll({
    repoRoot = process.cwd(),
    adapters = {},
    resolvePluginDir,
    log = process.stdout,
} = {}) {
    const spawnFn = adapters.spawn ?? spawn;
    const platform = adapters.platform ?? process.platform;
    const writeFs = adapters.fs ?? fs;
    const owned = new OwnedProcesses({
        platform,
        spawnFn,
        killTree: adapters.killTree,
    });

    // SiYuan reads plugin *data* from /data/storage/petal/<name>/<file>, not from
    // the plugin's code dir (data/plugins/<name>). Derive <name> from the code dir.
    const defaultConfigDir = (root) => {
        const p = resolveDevPaths(root);
        const pluginName = path.basename(p.pluginDir);
        return path.join(p.workspace, "data", "storage", "petal", pluginName);
    };
    const pluginDir = (resolvePluginDir ?? defaultConfigDir)(repoRoot);

    const repoVikunja = path.join(repoRoot, "scripts", "dev-vikunja.mjs");
    const repoReal = path.join(repoRoot, "scripts", "dev-real.mjs");

    // Stable loopback defaults so a plain `pnpm dev:all` opens the same URL each
    // time; an explicitly exported SIYUAN_PORT / VIKUNJA_PORT is passed through.
    const siyuanPortOverride = process.env.SIYUAN_PORT || DEFAULT_SIYUAN_PORT;
    const vikunjaPortOverride = process.env.VIKUNJA_PORT || DEFAULT_VIKUNJA_PORT;

    const spawnChild = (scriptArgs, extraEnv = {}) =>
        spawnFn(process.execPath, scriptArgs, {
            cwd: repoRoot,
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, ...extraEnv },
        });

    const vikunja = owned.add("vikunja", spawnChild([repoVikunja], { VIKUNJA_PORT: vikunjaPortOverride }));
    const siyuan = owned.add("siyuan", spawnChild([repoReal, "--web"], { SIYUAN_PORT: siyuanPortOverride }));

    let shuttingDown = false;
    let configured = false;
    let vikunjaReady = false;
    let siyuanReady = false;
    let vikunjaInfo = null;
    let siyuanPort = null;
    let vikunjaText = "";
    let siyuanText = "";

    let resolveDone;
    let rejectDone;
    const done = new Promise((resolve, reject) => {
        resolveDone = resolve;
        rejectDone = reject;
    });

    const write = (text) => {
        log.write(text);
    };

    async function configure() {
        if (configured || !vikunjaReady || !siyuanReady || !vikunjaInfo || !siyuanPort) return;
        configured = true;
        let inboxProjectId = null;
        try {
            inboxProjectId = await createInboxProject(vikunjaInfo.origin, vikunjaInfo.token, {
                fetchImpl: adapters.fetch,
            });
            write(`[dev:all] inbox project created (id=${inboxProjectId})\n`);
        } catch (error) {
            write(`[dev:all] inbox project not configured: ${error instanceof Error ? error.message : String(error)}\n`);
        }
        try {
            const config = buildPluginConfig({
                origin: vikunjaInfo.origin,
                token: vikunjaInfo.token,
                inboxProjectId,
            });
            const file = await writePluginConfig(pluginDir, config, writeFs);
            write(`\n[dev:all] plugin configured: ${file}\n`);
            write(`\n>>> Open ${webEntryUrl(siyuanPort)} in a real browser (Chrome/Edge). <<<\n`);
            write("Press Ctrl+C to stop both. Data is retained until `pnpm dev:all:clean`.\n");
        } catch (error) {
            write(
                `[dev:all] failed to write plugin config: ${
                    error instanceof Error ? error.message : String(error)
                }\n`,
            );
        }
    }

    function failIfHostDied(host, child) {
        if (shuttingDown) return;
        if (child.exitCode === null && child.signalCode === null) return; // still running
        if (child.exitCode !== null && child.exitCode !== 0) {
            rejectDone(
                new DevAllError(
                    "HOST_EXITED",
                    `The ${host} host exited before becoming ready (code ${child.exitCode}). Check the logs above.`,
                ),
            );
        }
    }

    function attachHost(host, child, prefix) {
        const onStdout = (chunk) => {
            const text = String(chunk);
            write(`${prefix}${text}`);
            if (host === "vikunja") {
                vikunjaText += text;
                if (!vikunjaReady) {
                    const info = parseVikunjaReady(vikunjaText);
                    if (info) {
                        vikunjaInfo = info;
                        vikunjaReady = true;
                        void configure();
                    }
                }
            } else {
                siyuanText += text;
                if (!siyuanReady) {
                    const port = parseSiYuanPort(siyuanText);
                    if (port) {
                        siyuanPort = port;
                        siyuanReady = true;
                        void configure();
                    }
                }
            }
        };
        child.stdout?.on?.("data", onStdout);
        child.stderr?.on?.("data", (chunk) => write(`${prefix}${String(chunk)}`));
        child.once?.("exit", () => failIfHostDied(host, child));
        failIfHostDied(host, child);
    }

    attachHost("vikunja", vikunja, "[vikunja] ");
    attachHost("siyuan", siyuan, "[siyuan] ");

    write("[dev:all] starting local Vikunja and the real SiYuan web host...\n");

    const result = done;
    result.stop = async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        await owned.stopAll();
        resolveDone();
    };
    process.once("SIGINT", () => void result.stop());
    process.once("SIGTERM", () => void result.stop());

    return result;
}

export async function main(argv = process.argv.slice(2)) {
    const isClean = argv.includes("--clean");
    if (isClean) {
        const clean = (script) => spawn(process.execPath, [path.join(process.cwd(), "scripts", script), "--clean"], { stdio: "inherit" });
        await new Promise((resolve) => {
            const a = clean("dev-vikunja.mjs");
            a.on("exit", () => {
                const b = clean("dev-real.mjs");
                b.on("exit", () => resolve());
            });
        });
        return 0;
    }

    try {
        const run = runAll({ repoRoot: process.cwd() });
        await run;
        return 0;
    } catch (error) {
        process.stderr.write(`[dev:all] ${error.code ?? "UNKNOWN_ERROR"}: ${error.message}\n`);
        return 1;
    }
}

function isDirectExecution() {
    return process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectExecution()) {
    main().then((code) => {
        process.exitCode = code;
    });
}
