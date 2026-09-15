import { parseBlockTaskLinks } from "../../shared/block-link.js";

export interface TaskLinkIndexEntry {
    taskId: number;
    blockId: string;
    documentId: string;
    notebookId?: string;
    updatedAt: number;
}

interface StoredTaskLinkIndex {
    schemaVersion: 1;
    entries: TaskLinkIndexEntry[];
    scannedDocuments: string[];
    needsRepair?: boolean;
}

export interface TaskLinkIndexStorage {
    load: (name: string) => Promise<unknown>;
    save: (name: string, value: unknown) => Promise<void>;
}

export interface TaskLinkIndexRebuildContext {
    listNotebooks: () => Promise<
        readonly {
            id: string;
            closed: boolean;
            encrypted: boolean;
            unlocked: boolean;
        }[]
    >;
    listNotebookDocuments: (notebookId: string) => Promise<
        readonly {
            documentId: string;
            notebookId: string;
            path: string;
        }[]
    >;
    listDocumentBlocks: (documentId: string) => Promise<
        readonly {
            blockId: string;
            documentId: string;
            notebookId?: string;
            updatedAt?: number;
        }[]
    >;
    getBlockAttrs: (blockId: string) => Promise<Record<string, string>>;
}

const ATTRIBUTE_NAME = "custom-vikunja-task-links";
const STORAGE_NAME = "task-link-index-v1.json";

export class TaskLinkIndex {
    constructor(private readonly storage: TaskLinkIndexStorage) {}

    async list(): Promise<TaskLinkIndexEntry[]> {
        const stored = parse(await this.storage.load(STORAGE_NAME));
        return stored ? stored.entries.map((entry) => ({ ...entry })) : [];
    }

    async needsRepair(): Promise<boolean> {
        return (await this.load())?.needsRepair === true;
    }

    async upsert(entry: TaskLinkIndexEntry): Promise<void> {
        assertEntry(entry);
        const stored = (await this.load()) ?? emptyIndex();
        const entries = stored.entries.filter(
            (candidate) =>
                candidate.taskId !== entry.taskId ||
                candidate.blockId !== entry.blockId,
        );
        entries.push({ ...entry });
        await this.save({ ...stored, entries });
    }

    async remove(taskId: number, blockId: string): Promise<void> {
        const stored = await this.load();
        if (!stored) return;
        await this.save({
            ...stored,
            entries: stored.entries.filter(
                (entry) => entry.taskId !== taskId || entry.blockId !== blockId,
            ),
        });
    }

    async taskIdsForDocument(documentId: string): Promise<Set<number>> {
        const entries = await this.list();
        return new Set(
            entries
                .filter((entry) => entry.documentId === documentId)
                .map((entry) => entry.taskId),
        );
    }

    async blocksForTask(taskId: number): Promise<string[]> {
        const entries = await this.list();
        return [
            ...new Set(
                entries
                    .filter((entry) => entry.taskId === taskId)
                    .map((entry) => entry.blockId),
            ),
        ];
    }

    async taskIdsForDocumentOrScan(
        documentId: string,
        scan: () => Promise<TaskLinkIndexEntry[]>,
    ): Promise<Set<number>> {
        const stored = (await this.load()) ?? emptyIndex();
        const segment = stored.entries.filter(
            (entry) => entry.documentId === documentId,
        );
        if (
            segment.length > 0 ||
            stored.scannedDocuments.includes(documentId)
        ) {
            return new Set(segment.map((entry) => entry.taskId));
        }

        let scanned: TaskLinkIndexEntry[];
        try {
            scanned = await scan();
            for (const entry of scanned) assertEntry(entry);
        } catch (error) {
            await this.save({ ...stored, needsRepair: true });
            throw error;
        }

        const current = (await this.load()) ?? stored;
        for (const entry of scanned) {
            const entries = current.entries.filter(
                (candidate) =>
                    candidate.taskId !== entry.taskId ||
                    candidate.blockId !== entry.blockId,
            );
            entries.push({ ...entry });
            current.entries = entries;
        }
        current.scannedDocuments = [
            ...new Set([...current.scannedDocuments, documentId]),
        ];
        await this.save(current);
        return new Set(scanned.map((entry) => entry.taskId));
    }

    async pruneMissingBlocks(existingBlockIds: Set<string>): Promise<void> {
        const stored = await this.load();
        if (!stored) return;
        await this.save({
            ...stored,
            entries: stored.entries.filter((entry) =>
                existingBlockIds.has(entry.blockId),
            ),
        });
    }

    async markNeedsRepair(): Promise<void> {
        const stored = (await this.load()) ?? emptyIndex();
        await this.save({ ...stored, needsRepair: true });
    }

    async rebuildWorkspace(
        context: TaskLinkIndexRebuildContext,
    ): Promise<void> {
        await this.rebuild(async () => {
            const entries: TaskLinkIndexEntry[] = [];
            const notebooks = await context.listNotebooks();
            for (const notebook of notebooks) {
                if (
                    notebook.closed ||
                    (notebook.encrypted && !notebook.unlocked)
                ) {
                    continue;
                }
                const documents = await context.listNotebookDocuments(
                    notebook.id,
                );
                for (const document of documents) {
                    const blocks = await context.listDocumentBlocks(
                        document.documentId,
                    );
                    for (const block of blocks) {
                        const attrs = await context.getBlockAttrs(
                            block.blockId,
                        );
                        const taskIds = parseBlockTaskLinks(
                            attrs[ATTRIBUTE_NAME],
                        ).taskIds;
                        for (const taskId of taskIds) {
                            entries.push({
                                taskId,
                                blockId: block.blockId,
                                documentId: block.documentId,
                                ...((block.notebookId ?? document.notebookId)
                                    ? {
                                          notebookId:
                                              block.notebookId ??
                                              document.notebookId,
                                      }
                                    : {}),
                                updatedAt: block.updatedAt ?? Date.now(),
                            });
                        }
                    }
                }
            }
            return entries;
        });
    }

    async rebuild(
        rebuildCallback: () => Promise<readonly TaskLinkIndexEntry[] | void>,
    ): Promise<void> {
        try {
            const entries = await rebuildCallback();
            if (entries === undefined) return;
            for (const entry of entries) assertEntry(entry);
            const deduplicated = new Map<string, TaskLinkIndexEntry>();
            for (const entry of entries) {
                deduplicated.set(`${entry.taskId}:${entry.blockId}`, {
                    ...entry,
                });
            }
            await this.save({
                schemaVersion: 1,
                entries: [...deduplicated.values()],
                scannedDocuments: [],
                needsRepair: false,
            });
        } catch (error) {
            await this.markNeedsRepair();
            throw error;
        }
    }

    private async load(): Promise<StoredTaskLinkIndex | null> {
        return parse(await this.storage.load(STORAGE_NAME));
    }

    private async save(value: StoredTaskLinkIndex): Promise<void> {
        await this.storage.save(STORAGE_NAME, value);
    }
}

function emptyIndex(): StoredTaskLinkIndex {
    return { schemaVersion: 1, entries: [], scannedDocuments: [] };
}

function parse(value: unknown): StoredTaskLinkIndex | null {
    if (typeof value !== "object" || value === null) return null;
    const raw = value as Record<string, unknown>;
    if (raw.schemaVersion !== 1 || !Array.isArray(raw.entries)) return null;
    const entries = raw.entries.filter(isEntry);
    const scannedDocuments = Array.isArray(raw.scannedDocuments)
        ? raw.scannedDocuments.filter(
              (item): item is string =>
                  typeof item === "string" && item.length > 0,
          )
        : [];
    return {
        schemaVersion: 1,
        entries,
        scannedDocuments: [...new Set(scannedDocuments)],
        needsRepair: raw.needsRepair === true,
    };
}

function isEntry(value: unknown): value is TaskLinkIndexEntry {
    if (typeof value !== "object" || value === null) return false;
    const raw = value as Record<string, unknown>;
    return (
        Number.isSafeInteger(raw.taskId) &&
        Number(raw.taskId) > 0 &&
        typeof raw.blockId === "string" &&
        raw.blockId.length > 0 &&
        typeof raw.documentId === "string" &&
        raw.documentId.length > 0 &&
        (raw.notebookId === undefined || typeof raw.notebookId === "string") &&
        typeof raw.updatedAt === "number" &&
        Number.isFinite(raw.updatedAt)
    );
}

function assertEntry(entry: TaskLinkIndexEntry): void {
    if (!isEntry(entry)) throw new Error("Invalid task link index entry");
}
