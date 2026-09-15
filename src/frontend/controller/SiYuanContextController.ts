export interface BlockSummary {
    blockId: string;
    documentId: string;
    notebookId?: string;
    title?: string;
    updatedAt?: number;
}

export interface NotebookSummary {
    id: string;
    closed: boolean;
    encrypted: boolean;
    unlocked: boolean;
}

export interface DocumentSummary {
    documentId: string;
    notebookId: string;
    path: string;
}

export interface SiYuanContextController {
    getBlockAttrs(blockId: string): Promise<Record<string, string>>;
    setBlockAttrs(
        blockId: string,
        attrs: Record<string, string | null>,
    ): Promise<void>;
    getBlockSummary(blockId: string): Promise<BlockSummary | null>;
    listDocumentBlocks(documentId: string): Promise<BlockSummary[]>;
    listNotebooks(): Promise<NotebookSummary[]>;
    listNotebookDocuments(notebookId: string): Promise<DocumentSummary[]>;
    openBlock(blockId: string): Promise<void>;
}

export interface SiYuanApi {
    request: <T>(path: string, body: Record<string, unknown>) => Promise<T>;
    openBlock?: (blockId: string) => Promise<void>;
}

export class DefaultSiYuanContextController implements SiYuanContextController {
    private readonly api: SiYuanApi;

    constructor(api: SiYuanApi) {
        this.api = api;
    }

    getBlockAttrs(blockId: string): Promise<Record<string, string>> {
        return this.api.request<Record<string, string>>(
            "/api/attr/getBlockAttrs",
            { id: blockId },
        );
    }

    async setBlockAttrs(
        blockId: string,
        attrs: Record<string, string | null>,
    ): Promise<void> {
        await this.api.request("/api/attr/setBlockAttrs", {
            id: blockId,
            attrs,
        });
    }

    async getBlockSummary(blockId: string): Promise<BlockSummary | null> {
        const value = await this.api.request<Record<string, unknown> | null>(
            "/api/block/getBlockInfo",
            { id: blockId },
        );
        return value ? toBlockSummary(blockId, value) : null;
    }

    async listDocumentBlocks(documentId: string): Promise<BlockSummary[]> {
        const rootInfo = await this.api.request<Record<string, unknown>>(
            "/api/block/getBlockInfo",
            { id: documentId },
        );
        const root = toBlockSummary(documentId, rootInfo);
        if (!root) return [];
        const blockIds = await this.api.request<string[]>(
            "/api/block/getDocBlocksOrders",
            { id: documentId },
        );
        const summaries = await Promise.all(
            blockIds
                .filter((blockId) => blockId !== documentId)
                .map(async (blockId) => {
                    const info = await this.api.request<
                        Record<string, unknown>
                    >("/api/block/getBlockInfo", { id: blockId });
                    return toBlockSummary(blockId, info);
                }),
        );
        return [
            root,
            ...summaries.filter(
                (summary): summary is BlockSummary => summary !== null,
            ),
        ];
    }

    async listNotebooks(): Promise<NotebookSummary[]> {
        const value = await this.api.request<{ notebooks?: unknown }>(
            "/api/notebook/lsNotebooks",
            {},
        );
        if (!Array.isArray(value.notebooks)) {
            throw new Error("SiYuan returned an invalid notebook list");
        }
        return value.notebooks.flatMap((item) => toNotebookSummary(item));
    }

    async listNotebookDocuments(
        notebookId: string,
    ): Promise<DocumentSummary[]> {
        if (!isNonEmptyString(notebookId)) {
            throw new Error("SiYuan notebook ID is required");
        }

        const documents: DocumentSummary[] = [];
        const pending = ["/"];
        const visitedPaths = new Set<string>();
        while (pending.length > 0) {
            const path = pending.shift()!;
            if (visitedPaths.has(path)) continue;
            visitedPaths.add(path);
            const value = await this.api.request<{
                box?: unknown;
                path?: unknown;
                files?: unknown;
            }>("/api/filetree/listDocsByPath", {
                notebook: notebookId,
                path,
                maxListCount: 0,
                ignoreMaxListHint: true,
            });
            if (
                value.box !== notebookId ||
                value.path !== path ||
                !Array.isArray(value.files)
            ) {
                throw new Error("SiYuan returned an invalid document list");
            }
            for (const item of value.files) {
                const document = toDocumentSummary(item, notebookId);
                if (!document) continue;
                documents.push(document);
                if (hasChildDocuments(item)) pending.push(document.path);
            }
        }
        return documents;
    }

    async openBlock(blockId: string): Promise<void> {
        if (!this.api.openBlock)
            throw new Error("SiYuan open-block adapter is unavailable");
        await this.api.openBlock(blockId);
    }
}

function toBlockSummary(
    blockId: string,
    value: Record<string, unknown>,
): BlockSummary | null {
    const documentId =
        typeof value.rootID === "string" ? value.rootID : blockId;
    const notebookId = typeof value.box === "string" ? value.box : undefined;
    const title =
        typeof value.rootTitle === "string" ? value.rootTitle : undefined;
    return {
        blockId,
        documentId,
        ...(notebookId ? { notebookId } : {}),
        ...(title ? { title } : {}),
    };
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function toNotebookSummary(value: unknown): NotebookSummary[] {
    if (typeof value !== "object" || value === null) return [];
    const raw = value as Record<string, unknown>;
    if (!isNonEmptyString(raw.id)) return [];
    const encrypted = raw.encrypted === true;
    return [
        {
            id: raw.id,
            closed: raw.closed === true,
            encrypted,
            unlocked: !encrypted || raw.unlocked === true,
        },
    ];
}

function toDocumentSummary(
    value: unknown,
    notebookId: string,
): DocumentSummary | null {
    if (typeof value !== "object" || value === null) return null;
    const raw = value as Record<string, unknown>;
    if (!isNonEmptyString(raw.id) || !isNonEmptyString(raw.path)) return null;
    return {
        documentId: raw.id,
        notebookId,
        path: raw.path,
    };
}

function hasChildDocuments(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const raw = value as Record<string, unknown>;
    return (
        typeof raw.subFileCount === "number" &&
        Number.isSafeInteger(raw.subFileCount) &&
        raw.subFileCount > 0
    );
}
