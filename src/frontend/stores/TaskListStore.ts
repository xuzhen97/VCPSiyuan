import { RpcResult } from "../../shared/contracts.js";
import { Page } from "../../shared/pagination.js";
import { RpcRequest, RpcResponse, VikunjaRpcMethod } from "../../shared/rpc.js";
import { TaskQuery, TaskDetail, TaskSummary } from "../../shared/task.js";
import { SummaryCache } from "../persistence/SummaryCache.js";

export type TaskView = "inbox" | "all";
export type TaskListStatus =
    | "idle"
    | "loading"
    | "ready"
    | "refreshing"
    | "offline"
    | "error";

export interface TaskFilterState {
    incompleteOnly: boolean;
    projectIds: number[];
    labelIds: number[];
}

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
    summaryCache?: SummaryCache;
}

const VIEWS: TaskView[] = ["inbox", "all"];
const DEFAULT_FILTERS: TaskFilterState = {
    incompleteOnly: true,
    projectIds: [],
    labelIds: [],
};

export class TaskListStore {
    private readonly controller: ControllerLike;
    private origin: string;
    private readonly timeZone: string;
    private inboxProjectId: number | null | undefined;
    private readonly summaryCache?: SummaryCache;
    private readonly states = new Map<TaskView, TaskListState>();
    private readonly filters = new Map<TaskView, TaskFilterState>();
    private readonly generations = new Map<TaskView, number>();
    private readonly listeners = new Set<() => void>();
    private activeView: TaskView = "inbox";
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
        for (const view of VIEWS) {
            this.states.set(view, {
                view,
                items: [],
                page: 0,
                perPage: 50,
                total: 0,
                status: "idle",
            });
            this.filters.set(view, cloneFilters(DEFAULT_FILTERS));
            this.generations.set(view, 0);
        }
    }

    updateConfig(origin: string, inboxProjectId: number | null): void {
        this.origin = origin;
        this.inboxProjectId = inboxProjectId;
    }

    needsConfiguration(view: TaskView = this.activeView): boolean {
        return (
            this.origin.trim().length === 0 ||
            (view === "inbox" &&
                (!this.inboxProjectId || this.inboxProjectId <= 0))
        );
    }

    getConfigurationError(view: TaskView = this.activeView):
        | "origin"
        | "inbox"
        | undefined {
        if (this.origin.trim().length === 0) return "origin";
        if (
            view === "inbox" &&
            (!this.inboxProjectId || this.inboxProjectId <= 0)
        )
            return "inbox";
        return undefined;
    }

    getState(view: TaskView): TaskListState {
        const state = this.states.get(view)!;
        return { ...state, items: [...state.items] };
    }

    getFilters(view: TaskView): TaskFilterState {
        return cloneFilters(this.filters.get(view)!);
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
        if (state.status !== "offline") return [...state.items];
        const filters = this.filters.get(view)!;
        return state.items.filter((task) => {
            if (filters.incompleteOnly && task.done === true) return false;
            if (
                view === "all" &&
                filters.projectIds.length > 0 &&
                !filters.projectIds.includes(task.project?.id ?? task.projectId ?? 0)
            )
                return false;
            if (
                filters.labelIds.length > 0 &&
                !(task.labels ?? []).some((label) =>
                    filters.labelIds.includes(label.id),
                )
            )
                return false;
            return true;
        });
    }

    async setIncompleteOnly(
        view: TaskView,
        enabled: boolean,
    ): Promise<void> {
        this.filters.set(view, {
            ...this.filters.get(view)!,
            incompleteOnly: enabled,
        });
        await this.refresh(view);
    }

    async setProjectIds(view: TaskView, ids: number[]): Promise<void> {
        this.filters.set(view, {
            ...this.filters.get(view)!,
            projectIds: normalizeIds(ids),
        });
        await this.refresh(view);
    }

    async setLabelIds(view: TaskView, ids: number[]): Promise<void> {
        this.filters.set(view, {
            ...this.filters.get(view)!,
            labelIds: normalizeIds(ids),
        });
        await this.refresh(view);
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async activate(view: TaskView): Promise<void> {
        this.activeView = view;
        // Always re-query: the tab badge and rows of a previously loaded view
        // would otherwise stay stale forever (refresh only ran for "idle").
        await this.refresh(view);
    }

    async refreshAll(): Promise<void> {
        await Promise.all(VIEWS.map((view) => this.refresh(view)));
    }

    async refresh(view: TaskView = this.activeView): Promise<void> {
        if (this.destroyed || this.needsConfiguration(view)) {
            this.notify();
            return;
        }
        const previous = this.states.get(view)!;
        const generation = (this.generations.get(view) ?? 0) + 1;
        this.generations.set(view, generation);
        this.states.set(view, {
            ...previous,
            status: previous.items.length > 0 ? "refreshing" : "loading",
            error: undefined,
        });
        this.notify();

        const result = await this.controller.call(
            "vikunja.tasks.query",
            this.requestFor(view, 1, previous.perPage),
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
        try {
            const result = await this.controller.call(
                "vikunja.tasks.query",
                this.requestFor(view, state.page + 1, state.perPage),
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

    async toggleDone(taskId: number, done: boolean): Promise<void> {
        if (this.destroyed || this.needsConfiguration(this.activeView)) return;
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
        for (const [view, item] of previous)
            this.replaceTaskInView(view, { ...item, done });
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
                this.replaceOrRemove(view, authoritative);
            this.notify();
        } finally {
            this.pendingDone.delete(taskId);
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
            if (!state.items.some((item) => item.id === taskId)) continue;
            this.states.set(view, {
                ...state,
                items: state.items.filter((item) => item.id !== taskId),
                // Tab badges and the footer read `total`; a local removal has
                // to move it or the count freezes at the last server answer.
                total: Math.max(0, state.total - 1),
            });
        }
        this.notify();
    }

    destroy(): void {
        this.destroyed = true;
        this.listeners.clear();
    }

    private requestFor(
        view: TaskView,
        page: number,
        perPage: number,
    ): TaskQuery {
        const filters = this.filters.get(view)!;
        return {
            view,
            inboxProjectId: this.inboxProjectId,
            page,
            perPage,
            timeZone: this.timeZone,
            doneFilter: filters.incompleteOnly ? "open" : "all",
            projectIds: view === "all" ? [...filters.projectIds] : [],
            labelIds: [...filters.labelIds],
        };
    }

    private replaceOrRemove(view: TaskView, summary: TaskSummary): void {
        const state = this.states.get(view)!;
        if (summary.done === true && this.filters.get(view)!.incompleteOnly) {
            if (!state.items.some((item) => item.id === summary.id)) return;
            this.states.set(view, {
                ...state,
                items: state.items.filter((item) => item.id !== summary.id),
                total: Math.max(0, state.total - 1),
            });
            return;
        }
        this.replaceTaskInView(view, summary);
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

function normalizeIds(ids: number[]): number[] {
    return [...new Set(ids)].filter(
        (id) => Number.isSafeInteger(id) && id > 0,
    );
}

function cloneFilters(filters: TaskFilterState): TaskFilterState {
    return {
        incompleteOnly: filters.incompleteOnly,
        projectIds: [...filters.projectIds],
        labelIds: [...filters.labelIds],
    };
}

function uniqueTasks(items: TaskSummary[]): TaskSummary[] {
    const byId = new Map<number, TaskSummary>();
    for (const item of items) byId.set(item.id, item);
    return [...byId.values()];
}
