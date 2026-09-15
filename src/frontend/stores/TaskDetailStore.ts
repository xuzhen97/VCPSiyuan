import { RpcResult } from "../../shared/contracts.js";
import { RpcRequest, RpcResponse, VikunjaRpcMethod } from "../../shared/rpc.js";
import { PublicError, publicError } from "../../shared/errors.js";
import { TaskDetail, TaskSummary } from "../../shared/task.js";

interface ControllerLike {
    call: <K extends VikunjaRpcMethod>(
        method: K,
        request: RpcRequest<K>,
    ) => Promise<RpcResult<RpcResponse<K>>>;
}

export interface TaskDetailStoreOptions {
    controller: ControllerLike;
    getOfflineSnapshot?: (taskId: number) => TaskSummary | undefined;
}

export interface TaskDetailState {
    status: "idle" | "loading" | "ready" | "saving" | "offline" | "error";
    error?: PublicError;
}

export class TaskDetailStore {
    private readonly controller: ControllerLike;
    private readonly getOfflineSnapshot?: TaskDetailStoreOptions["getOfflineSnapshot"];
    private detail?: TaskDetail;
    private state: TaskDetailState = { status: "idle" };
    private destroyed = false;
    private currentTaskId?: number;
    private generation = 0;
    private readonly listeners = new Set<() => void>();
    private toggleQueue: Promise<void> = Promise.resolve();

    constructor(options: TaskDetailStoreOptions) {
        this.controller = options.controller;
        this.getOfflineSnapshot = options.getOfflineSnapshot;
    }

    setDetail(detail: TaskDetail): void {
        if (this.destroyed) return;
        this.currentTaskId = detail.id;
        this.detail = detail;
        this.state = { status: "ready" };
    }

    getDetail(): TaskDetail | undefined {
        return this.detail;
    }

    getState(): TaskDetailState {
        return { ...this.state };
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async open(taskId: number): Promise<void> {
        if (this.destroyed) return;
        this.currentTaskId = taskId;
        const generation = ++this.generation;
        this.state = { status: "loading", error: undefined };
        this.notify();
        let result: Awaited<ReturnType<ControllerLike["call"]>>;
        try {
            result = await this.controller.call("vikunja.tasks.get", {
                taskId,
            });
        } catch {
            if (this.isStale(generation)) return;
            const snapshot = this.getOfflineSnapshot?.(taskId);
            if (snapshot) this.detail = offlineDetail(snapshot);
            this.state = {
                status: "offline",
                error: publicError(
                    "NETWORK_ERROR",
                    "Unable to load task",
                    true,
                    "retry",
                ),
            };
            this.notify();
            return;
        }
        if (this.isStale(generation)) return;
        if (!result.ok) {
            const snapshot = result.error.retryable
                ? this.getOfflineSnapshot?.(taskId)
                : undefined;
            if (snapshot) this.detail = offlineDetail(snapshot);
            this.state = {
                status: result.error.retryable ? "offline" : "error",
                error: result.error,
            };
            this.notify();
            return;
        }
        const loaded = result.data as { value?: TaskDetail };
        if (!loaded.value) {
            this.state = {
                status: "error",
                error: publicError(
                    "INVALID_RESPONSE",
                    "Task detail response was invalid",
                    false,
                    "review",
                ),
            };
            this.notify();
            return;
        }
        this.detail = loaded.value;
        this.state = { status: "ready", error: undefined };
        this.notify();
    }

    async refresh(): Promise<void> {
        if (this.currentTaskId === undefined) return;
        await this.open(this.currentTaskId);
    }

    async retry(): Promise<void> {
        await this.refresh();
    }

    close(): void {
        if (this.destroyed) return;
        ++this.generation;
        this.currentTaskId = undefined;
        this.detail = undefined;
        this.state = { status: "idle" };
        this.notify();
    }

    async toggleDone(done: boolean): Promise<void> {
        this.toggleQueue = this.toggleQueue.then(
            () => this.performToggle(done),
            () => this.performToggle(done),
        );
        return this.toggleQueue;
    }

    async toggleDoneForTask(taskId: number, done: boolean): Promise<void> {
        if (this.currentTaskId !== undefined && this.currentTaskId !== taskId)
            return;
        await this.toggleDone(done);
    }

    destroy(): void {
        this.destroyed = true;
        ++this.generation;
        this.listeners.clear();
    }

    private async performToggle(done: boolean): Promise<void> {
        if (this.destroyed || !this.detail || this.state.status === "offline")
            return;
        const previous = this.detail;
        const operationGeneration = this.generation;
        this.detail = { ...previous, done };
        this.state = { status: "saving", error: undefined };
        this.notify();

        let result: Awaited<ReturnType<ControllerLike["call"]>>;
        try {
            const expected: { etag?: string; updatedAt?: string } = {};
            if (previous.etag) expected.etag = previous.etag;
            if (previous.updatedAt) expected.updatedAt = previous.updatedAt;
            result = await this.controller.call("vikunja.tasks.patch", {
                taskId: previous.id,
                patch: { done },
                expected,
            });
        } catch {
            result = {
                ok: false,
                error: publicError(
                    "NETWORK_ERROR",
                    "Unable to save task",
                    true,
                    "retry",
                ),
            };
        }
        if (this.destroyed) {
            this.detail = previous;
            return;
        }
        if (
            operationGeneration !== this.generation ||
            this.currentTaskId !== previous.id
        )
            return;
        if (!result.ok) {
            this.detail = previous;
            this.state = {
                status: result.error.retryable ? "offline" : "error",
                error: result.error,
            };
            this.notify();
            if (result.error.code === "CONFLICT") {
                await this.refresh();
                if (!this.destroyed) {
                    this.state = { status: "ready", error: result.error };
                    this.notify();
                }
            }
            return;
        }
        // SAFETY: the tasks.patch RPC contract returns the authoritative TaskDetail
        // for this method; the generic union cannot narrow by the selected RPC key.
        const saved = result.data as unknown as TaskDetail;
        this.detail = saved;
        this.state = { status: "ready", error: undefined };
        this.notify();
    }

    private isStale(generation: number): boolean {
        return this.destroyed || generation !== this.generation;
    }

    private notify(): void {
        for (const listener of this.listeners) listener();
    }
}

function offlineDetail(snapshot: TaskSummary): TaskDetail {
    return {
        ...snapshot,
        done: snapshot.done === true,
        descriptionMarkdown: "",
        reminders: [],
        repeat: { kind: "none" },
        attachments: [],
        maxPermission: "read",
    };
}
