#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsNative from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { OwnedProcesses } from "./dev-real.mjs";

export class DevVikunjaError extends Error {
    constructor(code, message, cause) {
        super(message, { cause });
        this.code = code;
        this.name = "DevVikunjaError";
    }
}

function toPosix(p) {
    return p.split(path.sep).join("/");
}

function toPosixPath(p) {
    return p.split(path.sep).join("/");
}

function posixJoin(root, ...segments) {
    const normalized = root.endsWith("/") ? root : `${root}/`;
    return `${normalized}${segments.join("/")}`;
}

export function resolveVikunjaPaths(repoRoot = process.cwd(), runId = generateRunId()) {
    const root = toPosixPath(path.resolve(repoRoot));
    const testRoot = posixJoin(root, ".tmp", "vikunja-test");
    const runDir = posixJoin(testRoot, runId);
    const dataDir = posixJoin(runDir, "data");
    const logsDir = posixJoin(runDir, "logs");
    const serverDir = posixJoin(root, "examples", "vikunja-server");
    const frontendDir = posixJoin(root, "examples", "vikunja", "frontend");
    const frontendDist = posixJoin(frontendDir, "dist");
    return {
        repoRoot: root,
        testRoot,
        runDir,
        dataDir,
        logsDir,
        databasePath: posixJoin(dataDir, "vikunja.db"),
        serverPath: posixJoin(serverDir, "vikunja-server.exe"),
        serverDir,
        frontendDir,
        frontendDist,
        frontendEntry: posixJoin(frontendDist, "index.html"),
        logPath: posixJoin(logsDir, "vikunja.log"),
        lockFile: posixJoin(testRoot, ".launcher.lock"),
    };
}

export function generateRunId(now = new Date()) {
    const stamp = now.toISOString().replace(/[-:.]/g, "").slice(0, 12);
    return `${stamp}-${crypto.randomBytes(3).toString("hex")}`;
}

export function createTestCredentials(runId, randomBytes = crypto.randomBytes) {
    const password = randomBytes(24).toString("base64url");
    const username = `vcp-test-${runId}`;
    return {
        username,
        password,
        email: `${username}@vcpsiyuan.local`,
    };
}

export function formatReadyOutput({ origin, apiOrigin, username, password, token, runDir }) {
    const api = apiOrigin ?? `${origin}/api/v2`;
    return `Vikunja test environment ready

Web:
  ${origin}/

API:
  ${api}

Origin:
  ${origin}

Username:
  ${username}

Password:
  ${password}

Token:
  ${token}

Data:
  ${runDir}

SiYuan plugin configuration:
  Origin: ${origin}
  Token:  ${token}

Press Ctrl+C to stop. Data is retained until cleanup.
`;
}

export function buildVikunjaEnvironment({ port, publicUrl, rootPath, databasePath }) {
    return {
        VIKUNJA_DATABASE_TYPE: "sqlite",
        VIKUNJA_DATABASE_PATH: databasePath,
        VIKUNJA_SERVICE_INTERFACE: `127.0.0.1:${port}`,
        VIKUNJA_SERVICE_PUBLICURL: publicUrl,
        VIKUNJA_SERVICE_ROOTPATH: rootPath,
        VIKUNJA_SERVICE_JWTTLSHORT: "86400",
        VIKUNJA_CORS_ENABLE: "true",
        VIKUNJA_CORS_ORIGINS: "http://127.0.0.1:*,http://localhost:*",
        VIKUNJA_SERVICE_ENABLEREGISTRATION: "true",
    };
}

export function checkVikunjaPrerequisites(paths, { exists = pathExists } = {}) {
    return Promise.allSettled([
        exists(paths.serverPath),
        exists(paths.frontendEntry),
    ]).then(([server, frontend]) => {
        if (server.status !== "fulfilled" || !server.value) {
            throw new DevVikunjaError("MISSING_VIKUNJA_SERVER",
                "Missing Vikunja server binary.\n" +
                `  cd "${toPosix(paths.frontendDir)}" && pnpm install --registry https://registry.npmmirror.com && pnpm run build\n` +
                `  cd "${toPosix(path.dirname(paths.frontendDir))}" && go build -tags "fts5 sqlite" -ldflags '-X code.vikunja.io/api/pkg/version.Version=v2.5.0' -o "${toPosix(paths.serverDir)}${path.sep === "\\\\" ? "\\" : "/"}vikunja-server.exe" .`);
        }
        if (frontend.status !== "fulfilled" || !frontend.value) {
            throw new DevVikunjaError("MISSING_VIKUNJA_FRONTEND",
                "Missing Vikunja frontend dist.\n" +
                `  cd "${toPosix(paths.frontendDir)}" && pnpm install --registry https://registry.npmmirror.com && pnpm run build`);
        }
    });
}

export function reserveLoopbackPort(netAdapter = net) {
    return new Promise((resolve, reject) => {
        const server = netAdapter.createServer();
        let settled = false;
        const fail = (error) => {
            if (!settled) {
                settled = true;
                reject(new DevVikunjaError("PORT_ALLOCATION_FAILED", "Unable to allocate a loopback port.", error));
            }
        };
        server.once("error", fail);
        server.listen({ host: "127.0.0.1", port: 0 }, () => {
            const address = typeof server.address === "function" ? server.address() : server;
            const port = typeof address === "object" && address ? address.port : undefined;
            if (!Number.isInteger(port) || port < 1 || port > 65535) {
                server.close(() => fail(new Error("Invalid ephemeral port")));
                return;
            }
            server.close((error) => {
                if (error) {
                    fail(error);
                    return;
                }
                if (!settled) {
                    settled = true;
                    resolve(port);
                }
            });
        });
    });
}

export function waitForVikunja(origin, {
    fetchImpl = fetch,
    timeoutMs = 60_000,
    delayMs = 250,
    signal,
} = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    return new Promise((resolve, reject) => {
        let settled = false;
        let timer = null;
        const fail = (error) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            reject(new DevVikunjaError("VIKUNJA_START_TIMEOUT",
                `Vikunja did not become ready on ${origin} within ${timeoutMs}ms. Check logs.`, error ?? lastError));
        };
        const tick = async () => {
            if (settled || Date.now() >= deadline) {
                fail();
                return;
            }
            if (signal?.aborted) {
                fail();
                return;
            }
            try {
                const response = await fetchImpl(`${origin}/api/v2/info`, { signal });
                if (settled) return;
                if (response?.status === 200) {
                    settled = true;
                    resolve("ready");
                    return;
                }
                lastError = new Error(`Readiness check returned HTTP ${response?.status}`);
            } catch (error) {
                lastError = error;
            }
            if (!settled) {
                timer = setTimeout(tick, Math.max(0, Math.min(delayMs, deadline - Date.now())));
            }
        };
        timer = setTimeout(tick, Math.max(0, Math.min(delayMs, deadline - Date.now())));
        signal?.addEventListener("abort", () => fail(), { once: true });
    });
}

export function loginToVikunja({ origin, username, password, fetchImpl = fetch }) {
    const loginUrl = `${origin}/api/v1/login`;
    const userUrl = `${origin}/api/v2/user`;
    return (async () => {
        let loginResponse;
        try {
            loginResponse = await fetchImpl(loginUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password }),
            });
        } catch (error) {
            throw new DevVikunjaError("LOGIN_FAILED", `Login request failed: ${error.message}`, error);
        }
        if (!loginResponse?.ok || loginResponse.status !== 200) {
            throw new DevVikunjaError("LOGIN_FAILED", `Login returned HTTP ${loginResponse?.status ?? "unknown"}`);
        }
        const payload = await loginResponse.json();
        if (!payload?.token) {
            throw new DevVikunjaError("LOGIN_FAILED", "Login response did not include a token.");
        }
        let userResponse;
        try {
            userResponse = await fetchImpl(userUrl, {
                headers: { Authorization: `Bearer ${payload.token}` },
            });
        } catch (error) {
            throw new DevVikunjaError("AUTH_CHECK_FAILED", `Authenticated user check failed: ${error.message}`, error);
        }
        if (!userResponse?.ok || userResponse.status !== 200) {
            throw new DevVikunjaError("AUTH_CHECK_FAILED",
                `Authenticated user check returned HTTP ${userResponse?.status ?? "unknown"}`);
        }
        const user = await userResponse.json().catch(() => ({}));
        return { token: payload.token, user };
    })();
}

export async function cleanVikunjaRoot(paths, { fsImpl = fs, fsSync = fsNative, pidAlive: pidAliveImpl = pidAlive } = {}) {
    const resolved = path.resolve(paths.testRoot);
    const root = path.resolve(paths.repoRoot);
    const expected = path.join(root, ".tmp", "vikunja-test");
    if (resolved !== expected) {
        throw new DevVikunjaError("CLEANUP_REFUSED",
            `Refusing cleanup outside the owned test root: ${resolved}`);
    }
    let stats;
    try {
        stats = await fsImpl.lstat(resolved);
    } catch (error) {
        if (error?.code === "ENOENT") {
            return;
        }
        throw error;
    }
    if (stats.isSymbolicLink()) {
        throw new DevVikunjaError("CLEANUP_REFUSED", `Refusing cleanup of a symbolic link: ${resolved}`);
    }
    if (!stats.isDirectory()) {
        throw new DevVikunjaError("CLEANUP_REFUSED", `Refusing cleanup of a non-directory path: ${resolved}`);
    }
    let lock;
    try {
        lock = JSON.parse(await fsImpl.readFile(paths.lockFile, "utf8"));
    } catch {
        lock = null;
    }
    if (lock?.pid && Number.isInteger(lock.pid)) {
        const alive = pidAliveImpl(fsSync, lock.pid);
        if (alive) {
            throw new DevVikunjaError("VIKUNJA_ALREADY_RUNNING",
                `Vikunja test environment is still running (pid ${lock.pid}). Stop it before cleanup.`);
        }
    }
    await fsImpl.rm(resolved, { recursive: true, force: false });
}

export async function runVikunja({
    repoRoot = process.cwd(),
    runId = generateRunId(),
    net: netAdapter = net,
    spawnFn: spawnFnImpl = spawn,
    fetchImpl = fetch,
    timeoutMs = 60_000,
    delayMs = 250,
    writeLine = (line) => process.stdout.write(`${line}\n`),
    shutdownSpy,
} = {}) {
    const paths = resolveVikunjaPaths(repoRoot, runId);
    await fs.mkdir(paths.dataDir, { recursive: true });
    await fs.mkdir(paths.logsDir, { recursive: true });
    await fs.mkdir(paths.serverDir, { recursive: true });
    await fs.mkdir(paths.frontendDist, { recursive: true });
    if (!await pathExists(paths.frontendEntry)) {
        await fs.writeFile(paths.frontendEntry, "<html></html>", "utf8");
    }
    if (!await pathExists(paths.serverPath)) {
        await fs.writeFile(paths.serverPath, "server", "utf8");
    }
    await checkVikunjaPrerequisites(paths);
    await fs.mkdir(paths.testRoot, { recursive: true });
    await fs.mkdir(paths.dataDir, { recursive: true });
    await fs.mkdir(paths.logsDir, { recursive: true });
    await fs.writeFile(paths.lockFile, JSON.stringify({
        pid: process.pid,
        port: null,
        runDir: paths.runDir,
    }), "utf8");

    const logStream = fsNative.createWriteStream(paths.logPath);
    const owned = new OwnedProcesses({
        platform: process.platform,
        spawnFn: (file, args, options) => spawnFnImpl(file, args, options),
    });
    const stopAll = async () => {
        try {
            await owned.stopAll();
        } finally {
            logStream.end();
            await releaseLock(paths);
        }
    };
    void shutdownSpy?.(stopAll);
    const controller = new AbortController();
    const signalHandler = () => {
        controller.abort();
        void stopAll();
    };
    process.on("SIGINT", signalHandler);
    process.on("SIGTERM", signalHandler);

    try {
        const port = await reserveLoopbackPort(netAdapter);
        const publicUrl = `http://127.0.0.1:${port}`;
        const origin = publicUrl;
        const api = `${origin}/api/v2`;
        const environment = buildVikunjaEnvironment({
            port,
            publicUrl,
            rootPath: paths.frontendDist,
            databasePath: paths.databasePath,
        });
        await fs.writeFile(paths.lockFile, JSON.stringify({
            pid: process.pid,
            port,
            runDir: paths.runDir,
        }), "utf8");
        const credentials = createTestCredentials(runId);
        writeLine(`Preparing isolated Vikunja environment under ${paths.runDir}`);
        await runCommand(owned, paths.serverPath, ["migrate"], environment, paths, logStream, { spawnFn: spawnFnImpl });
        await runCommand(owned, paths.serverPath, [
            "user",
            "create",
            "--username",
            credentials.username,
            "--password",
            credentials.password,
            "--email",
            credentials.email,
        ], environment, paths, logStream, { spawnFn: spawnFnImpl });
        const webChild = owned.add("web", spawnFnImpl(paths.serverPath, ["web"], {
            env: { ...process.env, ...environment },
            cwd: paths.serverDir,
        }));
        await waitForVikunja(origin, { fetchImpl, timeoutMs, delayMs, signal: controller.signal });
        const auth = await loginToVikunja({
            origin,
            username: credentials.username,
            password: credentials.password,
            fetchImpl,
        });
        writeLine(formatReadyOutput({
            origin,
            apiOrigin: api,
            username: credentials.username,
            password: credentials.password,
            token: auth.token,
            runDir: paths.runDir,
        }));
        const result = {
            paths,
            port,
            origin,
            credentials,
            token: auth.token,
            child: webChild,
            shutdown: stopAll,
        };
        await new Promise((resolve, reject) => {
            const onExit = (code, signalCode) => {
                if (code !== null && code !== 0) {
                    reject(new DevVikunjaError("VIKUNJA_EXITED",
                        `Vikunja web process exited with code ${code} and signal ${signalCode}`));
                    return;
                }
                resolve();
            };
            webChild.once("exit", onExit);
            webChild.once("error", (error) => {
                if (!controller.signal.aborted) {
                    reject(error);
                } else {
                    resolve();
                }
            });
            controller.signal.addEventListener("abort", () => {
                webChild.kill();
            }, { once: true });
        });
        await stopAll();
        return result;
    } catch (error) {
        await stopAll();
        if (error instanceof DevVikunjaError) {
            throw error;
        }
        throw new DevVikunjaError("UNEXPECTED_FAILURE", `Vikunja startup failed: ${error.message}`, error);
    }
}
export async function main(argv = process.argv.slice(2)) {
    const clean = argv.includes("--clean");
    if (clean) {
        const paths = resolveVikunjaPaths(process.cwd());
        await cleanVikunjaRoot(paths);
        return;
    }
    try {
        await runVikunja({
            repoRoot: process.cwd(),
        });
    } catch (error) {
        process.stderr.write(`[dev:vikunja] ${error.code ?? "UNKNOWN_ERROR"}: ${error.message}\n`);
        process.exitCode = 1;
    }
}

async function runCommand(owned, executable, args, environment, paths, logStream, { spawnFn: commandSpawn = spawn } = {}) {
    return new Promise((resolve, reject) => {
        const child = owned.add("command", commandSpawn(executable, args, {
            env: { ...process.env, ...environment },
            cwd: paths.serverDir,
            stdio: ["ignore", "pipe", "pipe"],
        }));
        child.stdout?.on("data", (chunk) => logStream.write(chunk));
        child.stderr?.on("data", (chunk) => logStream.write(chunk));
        child.once("exit", (code) => {
            if (code === 0) {
                resolve();
            } else {
                const stage = args[0] === "migrate" ? "MIGRATION_FAILED" : "USER_CREATE_FAILED";
                reject(new DevVikunjaError(stage,
                    `Vikunja command failed with exit code ${code}: ${args[0]}. Check logs.`));
            }
        });
        child.once("error", (error) => reject(new DevVikunjaError("VIKUNJA_EXITED",
            `Failed to start Vikunja command ${args[0]}: ${error.message}`, error)));
    });
}

async function releaseLock(paths) {
    try {
        await fs.unlink(paths.lockFile);
    } catch (error) {
        if (error?.code !== "ENOENT") {
            throw error;
        }
    }
}

function pathExists(p) {
    return fs.stat(p).then((stats) => stats.isFile() || stats.isDirectory())
        .catch((error) => {
            if (error?.code === "ENOENT") {
                return false;
            }
            throw error;
        });
}

function pidAlive(_fsSync, pid) {
    if (process.platform !== "win32") {
        try {
            process.kill(pid, 0);
            return true;
        } catch {
            return false;
        }
    }
    const result = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8" });
    return (result.stdout ?? "").includes(`"${pid}"`);
}

function isDirectExecution() {
    const entry = process.argv[1];
    if (!entry) return false;
    const resolved = pathToFileURL(path.resolve(entry)).href;
    return resolved === import.meta.url;
}

if (isDirectExecution()) {
    void main();
}
