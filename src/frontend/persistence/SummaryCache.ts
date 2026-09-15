import { TaskSummary } from "../../shared/task.js";

export interface SummaryPageSnapshot {
    page: number;
    perPage: number;
    items: TaskSummary[];
    total: number;
}

interface StoredSnapshot extends SummaryPageSnapshot {
    savedAt: number;
}

interface StoredCache {
    schemaVersion: 1;
    origins: Record<
        string,
        Partial<Record<"focus" | "inbox" | "planned", StoredSnapshot>>
    >;
}

export interface SummaryCacheStorage {
    load: (name: string) => Promise<unknown>;
    save: (name: string, value: unknown) => Promise<void>;
}

const STORAGE_NAME = "task-summary-cache-v1.json";

export class SummaryCache {
    private readonly storage: SummaryCacheStorage;

    constructor(storage: SummaryCacheStorage) {
        this.storage = storage;
    }

    async load(
        origin: string,
        view: "focus" | "inbox" | "planned",
    ): Promise<(SummaryPageSnapshot & { savedAt: number }) | null> {
        const value = await this.storage.load(STORAGE_NAME);
        const parsed = parseStoredCache(value);
        if (!parsed) return null;
        const snapshot = parsed.origins[origin]?.[view];
        return snapshot ? cloneSnapshot(snapshot) : null;
    }

    async save(
        origin: string,
        view: "focus" | "inbox" | "planned",
        snapshot: SummaryPageSnapshot,
    ): Promise<void> {
        const current =
            parseStoredCache(await this.storage.load(STORAGE_NAME)) ??
            ({
                schemaVersion: 1,
                origins: {},
            } satisfies StoredCache);
        const originSnapshots = current.origins[origin] ?? {};
        current.origins[origin] = {
            ...originSnapshots,
            [view]: {
                page: snapshot.page,
                perPage: snapshot.perPage,
                items: snapshot.items.map(toCachedSummary),
                total: snapshot.total,
                savedAt: Date.now(),
            },
        };
        await this.storage.save(STORAGE_NAME, current);
    }
}

function parseStoredCache(value: unknown): StoredCache | null {
    if (typeof value !== "object" || value === null) return null;
    const raw = value as Record<string, unknown>;
    if (
        raw.schemaVersion !== 1 ||
        typeof raw.origins !== "object" ||
        raw.origins === null
    )
        return null;
    // SAFETY: parseStoredCache has checked the top-level schemaVersion and origins object;
    // stored snapshots are revalidated when read and sanitized before persistence.
    return raw as unknown as StoredCache;
}

function toCachedSummary(task: TaskSummary): TaskSummary {
    return {
        id: task.id,
        title: task.title,
        done: task.done === true,
        project: task.project
            ? { id: task.project.id, title: task.project.title }
            : { id: task.projectId ?? 0, title: "" },
        labels: (task.labels ?? []).map((label) => ({
            id: label.id,
            title: label.title,
            color: label.color ?? null,
        })),
        assignees: (task.assignees ?? []).map((user) => ({
            id: user.id,
            username: user.username,
            displayName: user.displayName,
        })),
        startAt: task.startAt ?? null,
        dueAt: task.dueAt ?? null,
        priority: task.priority ?? 0,
        attachmentCount: task.attachmentCount ?? 0,
        linkedBlockCount: task.linkedBlockCount ?? 0,
        updatedAt: task.updatedAt ?? "",
    };
}

function cloneSnapshot(
    snapshot: StoredSnapshot,
): SummaryPageSnapshot & { savedAt: number } {
    return {
        page: snapshot.page,
        perPage: snapshot.perPage,
        total: snapshot.total,
        savedAt: snapshot.savedAt,
        items: snapshot.items.map(toCachedSummary),
    };
}
