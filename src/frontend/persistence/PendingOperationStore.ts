export type PendingOperation =
    | {
          kind: "attachment-upload";
          taskId: number;
          localDraftRef: string;
          fileName: string;
      }
    | {
          kind: "block-link";
          taskId: number;
          blockId: string;
      };

interface StoredPendingOperations {
    schemaVersion: 1;
    operations: PendingOperation[];
}

export interface PendingOperationStorage {
    load: (name: string) => Promise<unknown>;
    save: (name: string, value: unknown) => Promise<void>;
}

const STORAGE_NAME = "pending-operations-v1.json";

export class PendingOperationStore {
    private readonly storage: PendingOperationStorage;

    constructor(storage: PendingOperationStorage) {
        this.storage = storage;
    }

    async list(): Promise<PendingOperation[]> {
        const stored = parse(await this.storage.load(STORAGE_NAME));
        return stored
            ? stored.operations.map((operation) => ({ ...operation }))
            : [];
    }

    async add(operation: PendingOperation): Promise<void> {
        const stored =
            parse(await this.storage.load(STORAGE_NAME)) ??
            ({
                schemaVersion: 1,
                operations: [],
            } satisfies StoredPendingOperations);
        const key = operationKey(operation);
        const operations = stored.operations.filter(
            (item) => operationKey(item) !== key,
        );
        operations.push({ ...operation });
        await this.storage.save(STORAGE_NAME, { schemaVersion: 1, operations });
    }

    async remove(operation: PendingOperation): Promise<void> {
        const stored = parse(await this.storage.load(STORAGE_NAME));
        if (!stored) return;
        await this.storage.save(STORAGE_NAME, {
            schemaVersion: 1,
            operations: stored.operations.filter(
                (item) => operationKey(item) !== operationKey(operation),
            ),
        });
    }
}

function parse(value: unknown): StoredPendingOperations | null {
    if (typeof value !== "object" || value === null) return null;
    const raw = value as Record<string, unknown>;
    if (raw.schemaVersion !== 1 || !Array.isArray(raw.operations)) return null;
    const operations = raw.operations.filter(isPendingOperation);
    return { schemaVersion: 1, operations };
}

function isPendingOperation(value: unknown): value is PendingOperation {
    if (typeof value !== "object" || value === null) return false;
    const raw = value as Record<string, unknown>;
    if (raw.kind === "attachment-upload") {
        return (
            Number.isSafeInteger(raw.taskId) &&
            Number(raw.taskId) > 0 &&
            typeof raw.localDraftRef === "string" &&
            typeof raw.fileName === "string"
        );
    }
    return (
        raw.kind === "block-link" &&
        Number.isSafeInteger(raw.taskId) &&
        Number(raw.taskId) > 0 &&
        typeof raw.blockId === "string"
    );
}

function operationKey(operation: PendingOperation): string {
    return operation.kind === "attachment-upload"
        ? `${operation.kind}:${operation.taskId}:${operation.localDraftRef}`
        : `${operation.kind}:${operation.taskId}:${operation.blockId}`;
}
