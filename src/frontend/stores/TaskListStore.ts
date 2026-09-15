import { RpcResult } from "../../shared/contracts.js";
import { Page } from "../../shared/pagination.js";
import { RpcRequest, RpcResponse, VikunjaRpcMethod } from "../../shared/rpc.js";
import {
    FocusGroups,
    PlannedGroups,
    TaskDetail,
    TaskQuery,
    TaskSummary,
    groupFocusTasks,
    groupPlannedTasks,
} from "../../shared/task.js";
import { SummaryCache } from "../persistence/SummaryCache.js";

export type TaskView = "focus" | "inbox" | "planned";
export type TaskListStatus =
    | "idle"
    | "loading"
    | "ready"
    | "refreshing"
    | "offline"
    | "error";

export interface TaskListState {
    view: TaskView;
    items: TaskSummary[];
    page: number;
    perPage: number;
    total: number;
    status: TaskListStatus;
    error?: string;
    snapshotAt?: number;
}

interface ControllerLike {
    call: <K extends VikunjaRpcMethod>(
        method: K,
        request: RpcRequest<K>,
    ) => Promise<RpcResult<RpcResponse<K>>>;
}

export interface TaskListStoreOptions {
    controller: ControllerLike;
    origin: string;
    timeZone: string;
    inboxProjectId?: number | null;
    currentDocumentTaskIds?: Set<number>;
    currentUserId?: number;
    summaryCache?: SummaryCache;
}

const VIEWS: TaskView[] = ["focus", "inbox", "planned"];

export class TaskListStore {
    private readonly controller: ControllerLike;
    private origin: string;
    private readonly timeZone: string;
    private inboxProjectId: number | null | undefined;
    private readonly summaryCache?: SummaryCache;
    private currentDocumentTaskIds: Set<number>;
    private currentDocumentFilter: boolean;
    private currentUserId?: number;
    private readonly states = new Map<TaskView, TaskListState>();
    private readonly generations = new Map<TaskView, number>();
    private readonly listeners = new Set<() => void>();
    private activeView: TaskView = "focus";
    private assignedToMe = false;
    private readonly pendingDone = new Set<number>();
    private readonly doneQueues = new Map<number, Promise<void>>();
    private loadingMore = false;
    private destroyed = false;

    constructor(options: TaskListStoreOptions) {
        this.controller = options.controller;
        this.origin = options.origin;
        this.timeZone = options.timeZone;
        this.inboxProjectId = options.inboxProjectId;
        this.summaryCache = options.summaryCache;
        this.currentDocumentTaskIds =
            options.currentDocumentTaskIds ?? new Set();
        this.currentDocumentFilter =
            options.currentDocumentTaskIds !== undefined;
        this.currentUserId = options.currentUserId;
        for (const view of VIEWS) {
            this.states.set(view, {
                view,
                items: [],
                page: 0,
                perPage: 50,
                total: 0,
                status: "idle",
            });
            this.generations.set(view, 0);
        }
    }

    updateConfig(origin: string, inboxProjectId: number | null): void {
        this.origin = origin;
        this.inboxProjectId = inboxProjectId;
    }

    needsConfiguration(): boolean {
        return this.origin.trim().length === 0;
    }

    getState(view: TaskView): TaskListState {
        return {
            ...this.states.get(view)!,
            items: [...this.states.get(view)!.items],
        };
    }

    getTimeZone(): string {
        return this.timeZone;
    }

    getTask(taskId: number): TaskSummary | undefined {
        for (const view of VIEWS) {
            const task = this.states
                .get(view)
                ?.items.find((candidate) => candidate.id === taskId);
            if (task) return { ...task };
        }
        return undefined;
    }

    isLoadingMore(): boolean {
        return this.loadingMore;
    }

    getVisibleItems(view: TaskView): TaskSummary[] {
        const state = this.states.get(view)!;
        return state.items.filter((task) => {
            const documentMatch =
                !this.currentDocumentFilter ||
                this.currentDocumentTaskIds.has(task.id);
            const assignedMatch =
                !this.assignedToMe ||
                (this.currentUserId !== undefined &&
                    (task.assignees ?? []).some(
                        (user) => user.id === this.currentUserId,
                    ));
            return documentMatch && assignedMatch;
        });
    }

    setCurrentDocumentFilter(enabled: boolean): void {
        this.currentDocumentFilter = enabled;
        this.notify();
    }

    setCurrentDocumentTaskIds(ids: Set<number>): void {
        this.currentDocumentTaskIds = new Set(ids);
        this.notify();
    }

    setAssignedToMe(enabled: boolean, currentUserId?: number): void {
        this.assignedToMe = enabled;
        if (currentUserId !== undefined) this.currentUserId = currentUserId;
        this.notify();
    }

    getFilterState(): { currentDocument: boolean; assignedToMe: boolean } {
        return {
            currentDocument: this.currentDocumentFilter,
            assignedToMe: this.assignedToMe,
        };
    }

    getGroups(
        view: TaskView,
        now = new Date(),
    ): Array<{
        key:
            | "overdue"
            | "today"
            | "next"
            | "tomorrow"
            | "thisWeek"
            | "nextWeek"
            | "later"
            | "all";
        items: TaskSummary[];
    }> {
        const items = this.getVisibleItems(view);
        if (view === "focus") {
            const groups: FocusGroups = groupFocusTasks(
                items,
                now,
                this.timeZone,
            );
            return [
                { key: "overdue", items: groups.overdue },
                { key: "today", items: groups.today },
                { key: "next", items: groups.next },
            ];
        }
        if (view === "planned") {
            const groups: PlannedGroups = groupPlannedTasks(
                items,
                now,
                this.timeZone,
            );
            return [
                { key: "tomorrow", items: groups.tomorrow },
                { key: "thisWeek", items: groups.thisWeek },
                { key: "nextWeek", items: groups.nextWeek },
                { key: "later", items: groups.later },
            ];
        }
        return [{ key: "all", items }];
    }

    async toggleDone(taskId: number, done: boolean): Promise<void> {
        if (this.destroyed || this.needsConfiguration()) return;
        const queued = this.doneQueues.get(taskId);
        const operation = queued
            ? queued.then(
                  () => this.performToggleDone(taskId, done),
                  () => this.performToggleDone(taskId, done),
              )
            : this.performToggleDone(taskId, done);
        this.doneQueues.set(taskId, operation);
        try {
            await operation;
        } finally {
            if (this.doneQueues.get(taskId) === operation)
                this.doneQueues.delete(taskId);
        }
    }

    private async performToggleDone(
        taskId: number,
        done: boolean,
    ): Promise<void> {
        if (
            this.destroyed ||
            this.states.get(this.activeView)?.status === "offline" ||
            this.pendingDone.has(taskId)
        )
            return;
        const previous = new Map<TaskView, TaskSummary>();
        for (const view of VIEWS) {
            const item = this.states
                .get(view)!
                .items.find((candidate) => candidate.id === taskId);
            if (item) previous.set(view, item);
        }
        if (previous.size === 0) return;
        this.pendingDone.add(taskId);
        for (const [view, item] of previous) {
            this.replaceTaskInView(view, { ...item, done });
        }
        this.notify();

        try {
            const expected = previous.values().next().value?.updatedAt;
            const result = await this.controller.call("vikunja.tasks.patch", {
                taskId,
                patch: { done },
                ...(expected === undefined
                    ? {}
                    : { expected: { updatedAt: expected } }),
            });
            if (this.destroyed) {
                for (const [view, item] of previous)
                    this.replaceTaskInView(view, item);
                return;
            }
            if (!result.ok) {
                for (const [view, item] of previous)
                    this.replaceTaskInView(view, item);
                this.notify();
                return;
            }
            const authoritative = result.data as TaskDetail;
            for (const view of previous.keys())
                this.replaceTaskInView(view, authoritative);
            this.notify();
        } finally {
            this.pendingDone.delete(taskId);
        }
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async activate(view: TaskView): Promise<void> {
        this.activeView = view;
        if (this.states.get(view)!.status === "idle") await this.refresh(view);
        else this.notify();
    }

    async refresh(view: TaskView = this.activeView): Promise<void> {
        if (this.destroyed) return;
        const previous = this.states.get(view)!;
        const generation = (this.generations.get(view) ?? 0) + 1;
        this.generations.set(view, generation);
        this.states.set(view, {
            ...previous,
            status: previous.items.length > 0 ? "refreshing" : "loading",
            error: undefined,
        });
        this.notify();

        const request: TaskQuery = {
            view,
            inboxProjectId: this.inboxProjectId,
            page: 1,
            perPage: previous.perPage,
            timeZone: this.timeZone,
        };
        const result = await this.controller.call(
            "vikunja.tasks.query",
            request,
        );
        if (generation !== this.generations.get(view)) return;
        if (!result.ok) {
            if (result.error.retryable && this.summaryCache && this.origin) {
                const snapshot = await this.summaryCache.load(
                    this.origin,
                    view,
                );
                if (generation !== this.generations.get(view)) return;
                if (snapshot) {
                    this.states.set(view, {
                        ...previous,
                        items: snapshot.items,
                        page: snapshot.page,
                        perPage: snapshot.perPage,
                        total: snapshot.total,
                        status: "offline",
                        error: result.error.message || result.error.code,
                        snapshotAt: snapshot.savedAt,
                    });
                    this.notify();
                    return;
                }
            }
            this.states.set(view, {
                ...previous,
                status: result.error.retryable ? "offline" : "error",
                error: result.error.message || result.error.code,
            });
            this.notify();
            return;
        }
        const page = result.data as Page<TaskSummary>;
        const items = uniqueTasks(page.items);
        this.states.set(view, {
            ...previous,
            items,
            page: page.page,
            perPage: page.perPage,
            total: page.total,
            status: "ready",
            error: undefined,
            snapshotAt: undefined,
        });
        await this.saveSnapshot(view, {
            page: page.page,
            perPage: page.perPage,
            items,
            total: page.total,
        });
        this.notify();
    }

    async loadNextPage(): Promise<void> {
        if (this.destroyed || this.loadingMore) return;
        const view = this.activeView;
        const state = this.states.get(view)!;
        if (state.page > 0 && state.items.length >= state.total) return;
        this.loadingMore = true;
        const generation = this.generations.get(view) ?? 0;
        const request: TaskQuery = {
            view,
            inboxProjectId: this.inboxProjectId,
            page: state.page + 1,
            perPage: state.perPage,
            timeZone: this.timeZone,
        };
        try {
            const result = await this.controller.call(
                "vikunja.tasks.query",
                request,
            );
            if (generation !== this.generations.get(view) || !result.ok) return;
            const page = result.data as Page<TaskSummary>;
            const merged = uniqueTasks([...state.items, ...page.items]);
            this.states.set(view, {
                ...state,
                items: merged,
                page: page.page,
                perPage: page.perPage,
                total: page.total,
                status: "ready",
                snapshotAt: undefined,
            });
            await this.saveSnapshot(view, {
                page: page.page,
                perPage: page.perPage,
                items: merged,
                total: page.total,
            });
            this.notify();
        } finally {
            this.loadingMore = false;
        }
    }

    replaceTask(summary: TaskSummary): void {
        for (const view of VIEWS) {
            const state = this.states.get(view)!;
            const items = state.items.some((item) => item.id === summary.id)
                ? state.items.map((item) =>
                      item.id === summary.id ? summary : item,
                  )
                : state.items;
            this.states.set(view, { ...state, items });
        }
        this.notify();
    }

    removeTask(taskId: number): void {
        for (const view of VIEWS) {
            const state = this.states.get(view)!;
            this.states.set(view, {
                ...state,
                items: state.items.filter((item) => item.id !== taskId),
            });
        }
        this.notify();
    }

    destroy(): void {
        this.destroyed = true;
        this.listeners.clear();
    }

    private replaceTaskInView(view: TaskView, summary: TaskSummary): void {
        const state = this.states.get(view)!;
        this.states.set(view, {
            ...state,
            items: state.items.map((item) =>
                item.id === summary.id ? summary : item,
            ),
        });
    }

    private async saveSnapshot(
        view: TaskView,
        snapshot: {
            page: number;
            perPage: number;
            items: TaskSummary[];
            total: number;
        },
    ): Promise<void> {
        if (!this.summaryCache || !this.origin) return;
        await this.summaryCache
            .save(this.origin, view, snapshot)
            .catch(() => {});
    }

    private notify(): void {
        for (const listener of this.listeners) listener();
    }
}

function uniqueTasks(items: TaskSummary[]): TaskSummary[] {
    const byId = new Map<number, TaskSummary>();
    for (const item of items) byId.set(item.id, item);
    return [...byId.values()];
}
