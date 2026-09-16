import fs from "node:fs/promises";
import fsNative from "node:fs";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const PLUGIN_FILES = Object.freeze([
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

const REQUIRED_PLUGIN_FILES = Object.freeze([
    "plugin.json",
    "index.js",
    "index.css",
    "kernel.js",
    "i18n",
    "README.md",
    "README.zh-CN.md",
    "LICENSE",
]);
const OPTIONAL_PLUGIN_FILES = new Set(["icon.png", "icon.svg", "preview.png"]);
const BUILD_ARTIFACTS = new Set(["index.js", "index.css", "kernel.js"]);
const PREPARE_COMMANDS = Object.freeze([
    "git submodule update --init --recursive",
    'cd "examples/siyuan/app" && pnpm install --registry https://registry.npmmirror.com',
    'cd "examples/siyuan/app" && pnpm run install:electron',
    'cd "examples/siyuan/app" && pnpm run dev',
    'cd "examples/siyuan/kernel" && go build -tags "fts5 sqlcipher" -o "../app/kernel/SiYuan-Kernel.exe"',
]);
let temporaryFileSequence = 0;

export class DevRealError extends Error {
    constructor(code, message, cause) {
        super(message, { cause });
        this.name = "DevRealError";
        this.code = code;
    }
}

export function resolveDevPaths(repoRoot) {
    const root = path.resolve(repoRoot);
    const devRoot = path.join(root, ".tmp", "siyuan-real");
    const workspace = path.join(devRoot, "workspace");
    const appRoot = path.join(root, "examples", "siyuan", "app");
    const kernelRoot = path.join(root, "examples", "siyuan", "kernel");
    return {
        repoRoot: root,
        devRoot,
        workspace,
        pluginDir: path.join(workspace, "data", "plugins", "VCPSiyuan"),
        petalsFile: path.join(workspace, "data", "storage", "petal", "petals.json"),
        logsDir: path.join(devRoot, "logs"),
        lockFile: path.join(devRoot, ".launcher.lock"),
        appRoot,
        kernelRoot,
        electronMain: path.join(appRoot, "electron", "main.js"),
        frontendOutput: path.join(root, "index.js"),
        frontendCssOutput: path.join(root, "index.css"),
        kernelOutput: path.join(root, "kernel.js"),
        siyuanUi: path.join(appRoot, "stage", "build", "app", "index.html"),
    };
}

function relativePath(parent, target) {
    return path.relative(path.resolve(parent), path.resolve(target));
}

export function assertInside(parent, target) {
    const relative = relativePath(parent, target);
    if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
        throw new Error(`Refusing target outside ${path.resolve(parent)}: ${path.resolve(target)}`);
    }
    return path.resolve(target);
}

function assertExactDevRoot(paths) {
    const expected = path.join(path.resolve(paths.repoRoot), ".tmp", "siyuan-real");
    if (path.resolve(paths.devRoot) !== expected) {
        throw new Error(`Refusing to operate on unexpected real-host directory: ${path.resolve(paths.devRoot)}`);
    }
}

async function assertNoSymlinkPath(root, target) {
    const relative = relativePath(root, target);
    if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
        throw new Error(`Refusing path outside ${path.resolve(root)}: ${path.resolve(target)}`);
    }
    let current = path.resolve(root);
    for (const segment of relative.split(path.sep)) {
        current = path.join(current, segment);
        try {
            const info = await fs.lstat(current);
            if (info.isSymbolicLink()) {
                throw new Error(`Refusing symbolic link path: ${current}`);
            }
        } catch (error) {
            if (error.code === "ENOENT") {
                return;
            }
            throw error;
        }
    }
}

async function launcherPid(lockFile) {
    try {
        const info = await fs.lstat(lockFile);
        if (info.isSymbolicLink()) {
            throw new Error(`Refusing symbolic link launcher lock: ${lockFile}`);
        }
        const data = JSON.parse(await fs.readFile(lockFile, "utf8"));
        return Number.isInteger(data.pid) && data.pid > 0 ? data.pid : undefined;
    } catch (error) {
        if (error.code === "ENOENT") {
            return undefined;
        }
        throw error;
    }
}

function processIsAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if (error.code === "ESRCH") {
            return false;
        }
        return true;
    }
}

async function acquireLauncherLock(paths) {
    assertExactDevRoot(paths);
    await assertNoSymlinkPath(paths.repoRoot, paths.devRoot);
    await fs.mkdir(paths.devRoot, { recursive: true });
    const existingPid = await launcherPid(paths.lockFile);
    if (existingPid && processIsAlive(existingPid)) {
        throw new DevRealError("REAL_HOST_ALREADY_RUNNING", `Real SiYuan host launcher is already running with PID ${existingPid}.`);
    }
    if (existingPid) {
        await fs.rm(paths.lockFile, { force: true });
    }
    try {
        const handle = await fs.open(paths.lockFile, "wx");
        await handle.writeFile(JSON.stringify({ pid: process.pid }), "utf8");
        await handle.close();
    } catch (error) {
        if (error.code === "EEXIST") {
            throw new DevRealError("REAL_HOST_ALREADY_RUNNING", "Real SiYuan host launcher lock was acquired by another process.", error);
        }
        throw error;
    }
}

async function releaseLauncherLock(paths) {
    try {
        const pid = await launcherPid(paths.lockFile);
        if (pid === process.pid) {
            await fs.rm(paths.lockFile, { force: true });
        }
    } catch {
        // Shutdown must not mask the original launcher result.
    }
}

export function mergeEnabledPlugin(records, pluginName) {
    if (!Array.isArray(records)) {
        throw new TypeError("petals.json must contain an array");
    }
    let found = false;
    const merged = records.map((record) => {
        if (!record || typeof record !== "object" || Array.isArray(record) || record.name !== pluginName) {
            return record;
        }
        found = true;
        return { ...record, enabled: true };
    });
    if (!found) {
        merged.push({ name: pluginName, enabled: true });
    }
    return merged;
}

async function removeIfPresent(filePath) {
    try {
        await fs.rm(filePath, { force: true });
    } catch {
        // The original error is reported by the caller's operation.
    }
}

async function atomicWrite(filePath, data) {
    const directory = path.dirname(filePath);
    await fs.mkdir(directory, { recursive: true });
    const temporary = path.join(
        directory,
        `.${path.basename(filePath)}.${process.pid}.${temporaryFileSequence++}.tmp`,
    );
    try {
        await fs.writeFile(temporary, data, "utf8");
        await fs.rename(temporary, filePath);
    } catch (error) {
        await removeIfPresent(temporary);
        throw error;
    }
}

async function copyAtomic(source, target) {
    const sourceInfo = await fs.lstat(source);
    if (sourceInfo.isSymbolicLink()) {
        throw new Error(`Refusing symbolic link artifact: ${source}`);
    }
    if (!sourceInfo.isFile()) {
        throw new Error(`Expected a regular file artifact: ${source}`);
    }
    const targetDirectory = path.dirname(target);
    await fs.mkdir(targetDirectory, { recursive: true });
    const temporary = path.join(
        targetDirectory,
        `.${path.basename(target)}.${process.pid}.${temporaryFileSequence++}.tmp`,
    );
    try {
        await fs.copyFile(source, temporary);
        await fs.rename(temporary, target);
    } catch (error) {
        await removeIfPresent(temporary);
        throw error;
    }
}

async function copyArtifactTree(source, target) {
    const targetInfo = await fs.lstat(target).catch((error) => {
        if (error.code === "ENOENT") {
            return undefined;
        }
        throw error;
    });
    if (targetInfo?.isSymbolicLink()) {
        throw new Error(`Refusing symbolic link artifact target: ${target}`);
    }
    if (targetInfo && !targetInfo.isDirectory()) {
        throw new Error(`Expected an artifact directory target: ${target}`);
    }
    const info = await fs.lstat(source);
    if (info.isSymbolicLink()) {
        throw new Error(`Refusing symbolic link artifact: ${source}`);
    }
    if (!info.isDirectory()) {
        throw new Error(`Expected an artifact directory: ${source}`);
    }
    await fs.mkdir(target, { recursive: true });
    for (const entry of await fs.readdir(source, { withFileTypes: true })) {
        const entrySource = path.join(source, entry.name);
        const entryTarget = path.join(target, entry.name);
        if (entry.isDirectory()) {
            await copyArtifactTree(entrySource, entryTarget);
        } else {
            await copyAtomic(entrySource, entryTarget);
        }
    }
}

export async function prepareWorkspace(paths) {
    assertExactDevRoot(paths);
    assertInside(paths.devRoot, paths.workspace);
    await assertNoSymlinkPath(paths.devRoot, paths.workspace);
    await assertNoSymlinkPath(paths.devRoot, paths.pluginDir);
    await assertNoSymlinkPath(paths.devRoot, paths.logsDir);
    await assertNoSymlinkPath(paths.devRoot, paths.petalsFile);
    await fs.mkdir(paths.pluginDir, { recursive: true });
    await fs.mkdir(paths.logsDir, { recursive: true });
    await fs.mkdir(path.dirname(paths.petalsFile), { recursive: true });

    const confDir = path.join(paths.workspace, "conf");
    const confFile = path.join(confDir, "conf.json");
    await fs.mkdir(confDir, { recursive: true });
    let conf = {};
    try {
        conf = JSON.parse(await fs.readFile(confFile, "utf8"));
    } catch {
        // file doesn't exist yet
    }
    conf.bazaar = { ...conf.bazaar, trust: true, petalDisabled: false };
    await atomicWrite(confFile, `${JSON.stringify(conf, null, "\t")}\n`);

    let records = [];
    try {
        records = JSON.parse(await fs.readFile(paths.petalsFile, "utf8"));
    } catch (error) {
        if (error.code !== "ENOENT") {
            throw new Error(`Unable to read ${paths.petalsFile}`, { cause: error });
        }
    }
    const petals = mergeEnabledPlugin(records, "VCPSiyuan");
    await atomicWrite(paths.petalsFile, `${JSON.stringify(petals, null, "\t")}\n`);
}

export async function syncPluginArtifacts(paths) {
    assertExactDevRoot(paths);
    assertInside(paths.workspace, paths.pluginDir);
    await assertNoSymlinkPath(paths.devRoot, paths.pluginDir);
    await fs.mkdir(paths.pluginDir, { recursive: true });

    for (const name of REQUIRED_PLUGIN_FILES) {
        const source = path.join(paths.repoRoot, name);
        try {
            const info = await fs.lstat(source);
            if (name === "i18n") {
                if (!info.isDirectory()) {
                    throw new Error(`Expected i18n directory: ${source}`);
                }
            } else if (!info.isFile() || info.isSymbolicLink()) {
                throw new Error(`Expected regular required artifact: ${source}`);
            }
        } catch (error) {
            throw new DevRealError("MISSING_PLUGIN_ARTIFACT", `Missing or invalid required plugin artifact: ${source}`, error);
        }
    }

    for (const name of PLUGIN_FILES) {
        const source = path.join(paths.repoRoot, name);
        const target = path.join(paths.pluginDir, name);
        let info;
        try {
            info = await fs.lstat(source);
        } catch (error) {
            if (error.code === "ENOENT" && OPTIONAL_PLUGIN_FILES.has(name)) {
                continue;
            }
            throw error;
        }
        if (info.isSymbolicLink()) {
            throw new Error(`Refusing symbolic link artifact: ${source}`);
        }
        if (name === "i18n") {
            await copyArtifactTree(source, target);
        } else {
            await copyAtomic(source, target);
        }
    }
}

export async function cleanDevRoot(paths) {
    assertExactDevRoot(paths);
    await assertNoSymlinkPath(paths.repoRoot, paths.devRoot);
    const existingPid = await launcherPid(paths.lockFile);
    if (existingPid && processIsAlive(existingPid)) {
        throw new DevRealError("REAL_HOST_ALREADY_RUNNING", `Refusing to clean while launcher PID ${existingPid} is alive.`);
    }
    const info = await fs.lstat(paths.devRoot).catch((error) => {
        if (error.code === "ENOENT") {
            return undefined;
        }
        throw error;
    });
    if (info?.isSymbolicLink()) {
        throw new Error(`Refusing to remove symbolic link real-host directory: ${paths.devRoot}`);
    }
    if (info && !info.isDirectory()) {
        throw new Error(`Refusing to remove non-directory real-host path: ${paths.devRoot}`);
    }
    await fs.rm(paths.devRoot, { recursive: true, force: true });
}

function executableCandidates(paths) {
    const kernelNames = process.platform === "win32"
        ? ["SiYuan-Kernel.exe", "SiYuan-Kernel"]
        : ["SiYuan-Kernel", "SiYuan-Kernel.exe"];
    return {
        webpack: path.join(paths.repoRoot, "node_modules", "webpack-cli", "bin", "cli.js"),
        electron: process.platform === "win32"
            ? path.join(paths.appRoot, "node_modules", "electron", "dist", "electron.exe")
            : path.join(paths.appRoot, "node_modules", ".bin", "electron"),
        kernel: kernelNames.map((name) => path.join(paths.appRoot, "kernel", name)),
    };
}

async function pathExists(filePath, exists = fs.access) {
    try {
        await exists(filePath);
        return true;
    } catch {
        return false;
    }
}

function prerequisiteError(code, description, commandIndexes) {
    const commands = commandIndexes.map((index) => PREPARE_COMMANDS[index]).join("\n");
    return new DevRealError(code, `${description}\n\nPrepare the real host with:\n${commands}`);
}

export async function checkPrerequisites(paths, adapters = {}) {
    const exists = adapters.exists ?? ((filePath) => fs.access(filePath));
    const commands = executableCandidates(paths);
    if (!await pathExists(path.join(paths.appRoot, "package.json"), exists)) {
        throw prerequisiteError("MISSING_SUBMODULE", "The SiYuan app submodule is not initialized.", [0]);
    }
    if (!await pathExists(commands.webpack, exists)) {
        throw prerequisiteError("MISSING_PROJECT_DEPS", "The VCPSiyuan dependencies are not installed.", [1]);
    }
    if (!await pathExists(commands.electron, exists)) {
        throw prerequisiteError("MISSING_ELECTRON", "The SiYuan Electron dependency is not installed.", [1, 2]);
    }
    if (!await pathExists(paths.siyuanUi, exists)) {
        throw prerequisiteError("MISSING_SIYUAN_UI", "The SiYuan frontend build is missing.", [3]);
    }
    let kernelPath;
    for (const candidate of commands.kernel) {
        if (await pathExists(candidate, exists)) {
            kernelPath = candidate;
            break;
        }
    }
    if (!kernelPath) {
        throw prerequisiteError("MISSING_KERNEL", "The SiYuan Kernel executable is missing.", [4]);
    }
    if (!await pathExists(paths.electronMain, exists)) {
        throw prerequisiteError("MISSING_ELECTRON", "The SiYuan Electron entry point is missing.", [1]);
    }
    return {
        webpackPath: commands.webpack,
        electronPath: commands.electron,
        electronViaNode: false,
        kernelPath,
    };
}

function requestLocalHttps(url, signal) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, { rejectUnauthorized: false }, (response) => {
            response.resume();
            resolve(response);
        });
        request.once("error", reject);
        signal?.addEventListener("abort", () => request.destroy(), { once: true });
    });
}

async function fetchKernel(url, options) {
    try {
        return await fetch(url, options);
    } catch (error) {
        if (url.startsWith("http://")) {
            return requestLocalHttps(`https://${url.slice("http://".length)}`, options?.signal);
        }
        throw error;
    }
}

export function reserveLoopbackPort(netAdapter = net) {
    return new Promise((resolve, reject) => {
        const server = netAdapter.createServer();
        let settled = false;
        const fail = (error) => {
            if (!settled) {
                settled = true;
                reject(new DevRealError("PORT_ALLOCATION_FAILED", "Unable to allocate a loopback port.", error));
            }
        };
        server.once("error", fail);
        server.listen({ host: "127.0.0.1", port: 0 }, () => {
            const address = server.address();
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

export async function waitForKernel({ port, timeoutMs = 60_000, fetchImpl = fetch, signal, intervalMs = 250 }) {
    const deadline = Date.now() + timeoutMs;
    const requestUrl = `http://127.0.0.1:${port}/api/system/version`;
    let lastError;
    while (Date.now() < deadline) {
        if (signal?.aborted) {
            throw new DevRealError("KERNEL_ABORTED", "Kernel readiness wait was aborted.");
        }
        try {
            const response = await fetchImpl(requestUrl, {
                signal,
            });
            if (response) {
                return response;
            }
        } catch (error) {
            lastError = error;
        }
        const remaining = Math.max(0, Math.min(intervalMs, deadline - Date.now()));
        if (remaining) {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(resolve, remaining);
                signal?.addEventListener("abort", () => {
                    clearTimeout(timer);
                    reject(new DevRealError("KERNEL_ABORTED", "Kernel readiness wait was aborted."));
                }, { once: true });
            });
        }
    }
    throw new DevRealError(
        "KERNEL_TIMEOUT",
        `Kernel did not become ready on port ${port} within ${timeoutMs}ms. Check logs/kernel.log.`,
        lastError,
    );
}

function isDirectExecution() {
    return process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

function childRunning(child) {
    return child.exitCode === null && child.signalCode === null;
}

function waitForChildExit(child, timeoutMs) {
    if (!childRunning(child)) {
        return Promise.resolve(true);
    }
    return new Promise((resolve) => {
        let timer;
        const done = () => {
            clearTimeout(timer);
            resolve(true);
        };
        child.once?.("exit", done);
        timer = setTimeout(() => resolve(false), timeoutMs);
    });
}

async function terminateOwnedChild(child, platform) {
    if (!childRunning(child)) {
        return;
    }
    try {
        child.kill(platform === "win32" ? undefined : "SIGTERM");
    } catch {
        return;
    }
    if (await waitForChildExit(child, 5_000) || !childRunning(child)) {
        return;
    }
    if (platform === "win32" && Number.isInteger(child.pid)) {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
        try {
            child.kill("SIGKILL");
        } catch {
            // The process may have exited between the status check and the signal.
        }
    }
}

export class OwnedProcesses {
    constructor({ platform = process.platform, spawnFn = spawn, killTree = terminateOwnedChild } = {}) {
        this.platform = platform;
        this.spawnFn = spawnFn;
        this.killTree = killTree;
        this.children = [];
        this.stopping = false;
    }

    add(role, child) {
        this.children.push({ role, child });
        return child;
    }

    async stopAll() {
        if (this.stopping) {
            return;
        }
        this.stopping = true;
        for (const { child } of [...this.children].reverse()) {
            if (!childRunning(child)) {
                continue;
            }
            await this.killTree(child, this.platform);
        }
    }
}

function appendChildOutput(child, logStream, prefix, onExit) {
    child.once?.("error", onExit);
    for (const stream of [child.stdout, child.stderr]) {
        stream?.on("data", (chunk) => {
            logStream.write(chunk);
            const text = String(chunk).trim();
            if (text) {
                process.stdout.write(`${prefix} ${text}\n`);
            }
        });
    }
    child.once?.("exit", onExit);
}

async function waitForArtifacts(paths, { timeoutMs = 60_000, signal } = {}) {
    const required = [paths.frontendOutput, paths.frontendCssOutput, paths.kernelOutput];
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (signal?.aborted) {
            throw new DevRealError("PLUGIN_BUILD_EXITED", "A plugin webpack watcher exited before the initial build completed.");
        }
        if (await Promise.all(required.map((filePath) => pathExists(filePath)))) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new DevRealError("PLUGIN_BUILD_TIMEOUT", "Plugin build did not produce index.js, index.css, and kernel.js within 60 seconds.");
}

function watchBuildArtifacts(paths, onChange) {
    const timers = new Map();
    const sources = new Map([
        ["index.js", paths.frontendOutput],
        ["index.css", paths.frontendCssOutput],
        ["kernel.js", paths.kernelOutput],
    ]);
    const watcher = fsNative.watch(paths.repoRoot, { persistent: false }, (eventType, filename) => {
        const name = filename?.toString();
        if ((eventType !== "change" && eventType !== "rename") || !BUILD_ARTIFACTS.has(name)) {
            return;
        }
        const source = sources.get(name);
        clearTimeout(timers.get(name));
        timers.set(name, setTimeout(() => {
            void onChange(name, source).catch((error) => {
                process.stderr.write(`[plugin] artifact sync failed: ${error.message}\n`);
            });
        }, 100));
    });
    return () => {
        for (const timer of timers.values()) {
            clearTimeout(timer);
        }
        watcher.close();
    };
}

function spawnOwned(owned, executable, args, options, role) {
    return owned.add(role, owned.spawnFn(executable, args, options));
}

export async function runRealHost({
    repoRoot = process.cwd(),
    adapters = {},
    signal = undefined,
    webOnly = false,
} = {}) {
    const paths = resolveDevPaths(repoRoot);
    const prerequisites = await checkPrerequisites(paths, adapters);
    await acquireLauncherLock(paths);
    let lockReleased = false;
    const releaseLock = async () => {
        if (!lockReleased) {
            lockReleased = true;
            await releaseLauncherLock(paths);
        }
    };
    const logStreams = new Map();
    const owned = new OwnedProcesses({
        platform: adapters.platform ?? process.platform,
        spawnFn: adapters.spawn ?? spawn,
        killTree: adapters.killTree,
    });
    let shutdownPromise;
    let stopArtifactWatch = () => {};
    const lifecycleAbort = new AbortController();
    const shutdown = () => {
        if (!lifecycleAbort.signal.aborted) {
            lifecycleAbort.abort();
        }
        shutdownPromise ??= Promise.resolve()
            .then(() => stopArtifactWatch())
            .then(() => owned.stopAll())
            .finally(() => {
                process.removeListener("SIGINT", onSignal);
                process.removeListener("SIGTERM", onSignal);
                for (const stream of logStreams.values()) {
                    stream.end();
                }
                return releaseLock();
            });
        return shutdownPromise;
    };
    const onSignal = () => {
        void shutdown();
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    signal?.addEventListener("abort", onSignal, { once: true });
    try {
        await prepareWorkspace(paths);
        await fs.mkdir(paths.logsDir, { recursive: true });
        const buildLog = await fs.open(path.join(paths.logsDir, "plugin-build.log"), "a");
        const kernelLog = await fs.open(path.join(paths.logsDir, "kernel.log"), "a");
        const electronLog = await fs.open(path.join(paths.logsDir, "electron.log"), "a");
        logStreams.set("build", buildLog.createWriteStream());
        logStreams.set("kernel", kernelLog.createWriteStream());
        logStreams.set("electron", electronLog.createWriteStream());

        const webpackArgs = ["--config", path.join(paths.repoRoot, "webpack.config.cjs"), "--mode", "development"];
        const kernelWebpackArgs = ["--config", path.join(paths.repoRoot, "webpack.kernel.config.cjs"), "--mode", "development"];
        const frontendBuilder = spawnOwned(owned, process.execPath, [prerequisites.webpackPath, ...webpackArgs], {
            cwd: paths.repoRoot,
            stdio: ["ignore", "pipe", "pipe"],
        }, "frontend-webpack");
        const kernelBuilder = spawnOwned(owned, process.execPath, [prerequisites.webpackPath, ...kernelWebpackArgs], {
            cwd: paths.repoRoot,
            stdio: ["ignore", "pipe", "pipe"],
        }, "kernel-webpack");
        const onBuilderExit = () => {
            lifecycleAbort.abort();
            void shutdown();
        };
        appendChildOutput(frontendBuilder, logStreams.get("build"), "[plugin]", onBuilderExit);
        appendChildOutput(kernelBuilder, logStreams.get("build"), "[plugin]", onBuilderExit);
        await waitForArtifacts(paths, { signal: lifecycleAbort.signal });
        await syncPluginArtifacts(paths);
        stopArtifactWatch = watchBuildArtifacts(paths, async (name, source) => {
            await copyAtomic(source, path.join(paths.pluginDir, name));
            process.stdout.write(`[plugin] synchronized ${name}; refresh or disable/enable the plugin in SiYuan if needed\n`);
        });

        let port;
        for (let attempt = 0; attempt < 2; attempt += 1) {
            port = await reserveLoopbackPort(adapters.net ?? net);
            const kernelArgs = [
                "serve",
                "--mode=dev",
                "--workspace", paths.workspace,
                "--port", String(port),
                "--wd", paths.appRoot,
            ];
            const kernel = spawnOwned(owned, prerequisites.kernelPath, kernelArgs, {
                cwd: paths.appRoot,
                stdio: ["ignore", "pipe", "pipe"],
            }, "siyuan-kernel");
            let resolveExit;
            let kernelReady = false;
            const exited = new Promise((resolve) => {
                resolveExit = resolve;
            });
            appendChildOutput(kernel, logStreams.get("kernel"), "[kernel]", (code) => {
                resolveExit(code);
                if (kernelReady) {
                    lifecycleAbort.abort();
                    void shutdown();
                }
            });
            try {
                await Promise.race([
                    waitForKernel({
                        port,
                        fetchImpl: adapters.fetch ?? fetchKernel,
                        signal: lifecycleAbort.signal,
                        timeoutMs: adapters.kernelTimeoutMs ?? 60_000,
                        intervalMs: adapters.kernelPollMs ?? 250,
                    }),
                    exited.then((code) => {
                        if (code === 21) {
                            throw new DevRealError("KERNEL_PORT_IN_USE", `Kernel could not bind port ${port}.`);
                        }
                        throw new DevRealError("KERNEL_EXITED", `Kernel exited before becoming ready with code ${code ?? "unknown"}.`);
                    }),
                ]);
                kernelReady = true;
                break;
            } catch (error) {
                if (!(error instanceof DevRealError) || error.code !== "KERNEL_PORT_IN_USE" || attempt === 1) {
                    throw error;
                }
                process.stderr.write(`[kernel] port ${port} was occupied; retrying once\n`);
            }
        }
        process.stdout.write(`Workspace: ${paths.workspace}\nPlugin: ${paths.pluginDir}\nKernel port: ${port}\n`);
        process.stdout.write(`Logs: ${paths.logsDir}/plugin-build.log, ${paths.logsDir}/kernel.log, ${paths.logsDir}/electron.log\n`);
        if (webOnly) {
            process.stdout.write(`\n>>> SiYuan Web ready at: http://127.0.0.1:${port}/ <<<\n\n`);
            return { paths, port, owned, shutdown };
        }
        const electronArgs = [paths.electronMain, `--workspace=${paths.workspace}`, `--port=${port}`];
        const electron = prerequisites.electronViaNode
            ? spawnOwned(owned, process.execPath, [prerequisites.electronPath, ...electronArgs], {
                cwd: paths.appRoot,
                env: { ...process.env, NODE_ENV: "development" },
                stdio: ["ignore", "pipe", "pipe"],
            }, "electron")
            : spawnOwned(owned, prerequisites.electronPath, electronArgs, {
                cwd: paths.appRoot,
                env: { ...process.env, NODE_ENV: "development" },
                stdio: ["ignore", "pipe", "pipe"],
            }, "electron");
        appendChildOutput(electron, logStreams.get("electron"), "[electron]", () => {
            void shutdown();
        });
        return { paths, port, owned, shutdown };
    } catch (error) {
        await shutdown();
        throw error;
    }
}

export async function main(argv = process.argv.slice(2)) {
    const isClean = argv.includes("--clean");
    const isWeb = argv.includes("--web");
    if (isClean) {
        try {
            await cleanDevRoot(resolveDevPaths(process.cwd()));
            return 0;
        } catch (error) {
            process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
            return 1;
        }
    }
    try {
        const run = await runRealHost({ webOnly: isWeb });
        return await new Promise((resolve) => {
            if (isWeb) {
                // In web mode, run until process SIGINT/SIGTERM
                process.once("SIGINT", () => resolve(0));
                process.once("SIGTERM", () => resolve(0));
                return;
            }
            const electron = run.owned.children.find(({ role }) => role === "electron")?.child;
            if (!electron) {
                resolve(1);
                return;
            }
            electron.once("exit", async (code) => {
                await run.shutdown();
                resolve(code ?? 1);
            });
        });
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }
}

if (isDirectExecution()) {
    main().then((code) => {
        process.exitCode = code;
    });
}
