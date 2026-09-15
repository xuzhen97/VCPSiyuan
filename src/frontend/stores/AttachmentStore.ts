import {
    AttachmentMeta,
    BinaryDownload,
    UploadFailure,
    UploadFilePayload,
} from "../../shared/attachment.js";
import { PublicError, publicError } from "../../shared/errors.js";
import { RpcResult } from "../../shared/contracts.js";
import { RpcRequest, RpcResponse, VikunjaRpcMethod } from "../../shared/rpc.js";
import { PendingOperationStore } from "../persistence/PendingOperationStore.js";

export type AttachmentItemState =
    | "queued"
    | "uploading"
    | "succeeded"
    | "failed";

export interface AttachmentItem {
    id: string;
    file?: File;
    fileName: string;
    mimeType: string;
    size: number;
    state: AttachmentItemState;
    attachment?: AttachmentMeta;
    error?: PublicError;
}

interface AttachmentController {
    call: <K extends VikunjaRpcMethod>(
        method: K,
        request: RpcRequest<K>,
    ) => Promise<RpcResult<RpcResponse<K>>>;
}

export interface AttachmentStoreOptions {
    controller: AttachmentController;
    effectiveLimitBytes: number;
    enabled?: boolean;
    pendingOperations?: PendingOperationStore;
}

export class AttachmentStore {
    private readonly controller: AttachmentController;
    private readonly effectiveLimitBytes: number;
    private readonly enabled: boolean;
    private readonly pendingOperations?: PendingOperationStore;
    private readonly items = new Map<string, AttachmentItem>();
    private readonly listeners = new Set<() => void>();
    private nextId = 1;

    constructor(options: AttachmentStoreOptions) {
        this.controller = options.controller;
        this.effectiveLimitBytes = Math.min(
            30 * 1024 * 1024,
            Math.max(0, options.effectiveLimitBytes),
        );
        this.enabled = options.enabled !== false;
        this.pendingOperations = options.pendingOperations;
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    hasRetryableFailures(): boolean {
        return [...this.items.values()].some(
            (item) => item.state === "failed" && item.error?.retryable === true,
        );
    }

    hasFailures(): boolean {
        return [...this.items.values()].some((item) => item.state === "failed");
    }

    hasPendingFiles(): boolean {
        return [...this.items.values()].some(
            (item) => item.state === "queued" || item.state === "uploading",
        );
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    queue(files: File[]): void {
        for (const file of files) {
            const id = `file-${this.nextId++}`;
            const item: AttachmentItem = {
                id,
                file,
                fileName: file.name,
                mimeType: file.type || "application/octet-stream",
                size: file.size,
                state: "queued",
            };
            if (!this.enabled) {
                item.state = "failed";
                item.error = publicError(
                    "ATTACHMENTS_DISABLED",
                    "Attachments are disabled by the Vikunja server",
                    false,
                    "review",
                );
            } else if (file.size > this.effectiveLimitBytes) {
                item.state = "failed";
                item.error = publicError(
                    "PAYLOAD_TOO_LARGE",
                    `${file.name} exceeds the attachment size limit`,
                    false,
                    "review",
                );
            }
            this.items.set(id, item);
        }
        this.notify();
    }

    async load(taskId: number): Promise<boolean> {
        if (!this.enabled) return false;
        const result = await this.controller.call("vikunja.attachments.list", {
            taskId,
            page: 1,
            perPage: 100,
        });
        if (!result.ok) return false;
        this.items.clear();
        for (const attachment of result.data.items) {
            const id = `remote-${attachment.id}`;
            this.items.set(id, {
                id,
                fileName: attachment.name,
                mimeType: attachment.mimeType || "application/octet-stream",
                size: attachment.size,
                state: "succeeded",
                attachment,
            });
        }
        this.notify();
        return true;
    }

    getItems(): AttachmentItem[] {
        return [...this.items.values()].map((item) => ({ ...item }));
    }

    async resumePending(taskId: number): Promise<AttachmentItem[]> {
        const pending =
            (await this.pendingOperations?.list())?.filter(
                (operation) =>
                    operation.kind === "attachment-upload" &&
                    operation.taskId === taskId,
            ) ?? [];
        for (const operation of pending) {
            if (operation.kind !== "attachment-upload") continue;
            const existing = this.items.get(operation.localDraftRef);
            if (existing) continue;
            this.items.set(operation.localDraftRef, {
                id: operation.localDraftRef,
                fileName: operation.fileName,
                mimeType: "application/octet-stream",
                size: 0,
                state: "failed",
                error: publicError(
                    "VALIDATION_ERROR",
                    `Select ${operation.fileName} again to retry this upload`,
                    false,
                    "review",
                ),
            });
        }
        if (pending.length > 0) this.notify();
        return this.getItems();
    }

    async upload(taskId: number): Promise<void> {
        if (!this.enabled) return;
        await this.uploadItems(
            taskId,
            this.getItems().filter((item) => item.state === "queued"),
        );
    }

    async retryFailed(taskId: number, itemId?: string): Promise<void> {
        if (!this.enabled) return;
        await this.uploadItems(
            taskId,
            this.getItems().filter(
                (item) =>
                    item.state === "failed" &&
                    item.error?.retryable === true &&
                    (itemId === undefined || item.id === itemId),
            ),
        );
    }

    async download(
        taskId: number,
        itemId: string,
    ): Promise<BinaryDownload | null> {
        if (!this.enabled) return null;
        const item = this.items.get(itemId);
        const attachmentId = item?.attachment?.id;
        if (!attachmentId) return null;
        const result = await this.controller.call(
            "vikunja.attachments.download",
            {
                taskId,
                attachmentId,
            },
        );
        return result.ok ? result.data : null;
    }

    async deleteRemote(taskId: number, itemId: string): Promise<boolean> {
        if (!this.enabled) return false;
        const item = this.items.get(itemId);
        const attachmentId = item?.attachment?.id;
        if (!attachmentId) {
            this.items.delete(itemId);
            this.notify();
            return true;
        }
        const result = await this.controller.call(
            "vikunja.attachments.delete",
            {
                taskId,
                attachmentId,
            },
        );
        if (!result.ok) {
            item.error = result.error;
            item.state = "failed";
            this.notify();
            return false;
        }
        this.items.delete(itemId);
        this.notify();
        return true;
    }

    remove(itemId: string): void {
        this.items.delete(itemId);
        this.notify();
    }

    destroy(): void {
        this.items.clear();
        this.listeners.clear();
    }

    private async uploadItems(
        taskId: number,
        items: AttachmentItem[],
    ): Promise<void> {
        const accepted: Array<{
            item: AttachmentItem;
            payload: UploadFilePayload;
        }> = [];
        for (const snapshot of items) {
            const item = this.items.get(snapshot.id);
            if (!item) continue;
            if (!item.file) continue;
            if (item.size > this.effectiveLimitBytes) {
                item.state = "failed";
                item.error = publicError(
                    "PAYLOAD_TOO_LARGE",
                    `${item.fileName} exceeds the attachment size limit`,
                    false,
                    "review",
                );
                continue;
            }
            item.state = "uploading";
            item.error = undefined;
            try {
                const buffer = await item.file.arrayBuffer();
                accepted.push({
                    item,
                    payload: {
                        id: item.id,
                        name: item.fileName,
                        type: item.mimeType,
                        bytes: new Uint8Array(buffer),
                    },
                });
            } catch {
                item.state = "failed";
                item.error = publicError(
                    "NETWORK_ERROR",
                    `Unable to read ${item.fileName}`,
                    true,
                );
            }
        }
        this.notify();

        if (accepted.length === 0) return;
        const result = await this.controller.call(
            "vikunja.attachments.upload",
            {
                taskId,
                files: accepted.map((entry) => entry.payload),
            },
        );
        if (!result.ok) {
            for (const entry of accepted) {
                entry.item.state = "failed";
                entry.item.error = result.error;
                await this.recordPending(taskId, entry.item);
            }
            this.notify();
            return;
        }

        const succeeded = result.data.succeeded;
        const failed = [...result.data.failed];
        const claimed = new Set<AttachmentMeta>();
        for (const entry of accepted) {
            // Vikunja's per-file failure carries neither a client file id nor a
            // file name, so a reported failure is matched by id/name when
            // available and otherwise attributed by elimination below.
            const failureIndex = failed.findIndex(
                (value) =>
                    (value.clientFileId !== "" &&
                        value.clientFileId === entry.item.id) ||
                    (value.fileName !== "" &&
                        value.fileName === entry.item.fileName),
            );
            const failure =
                failureIndex >= 0
                    ? failed.splice(failureIndex, 1)[0]
                    : undefined;
            if (failure) {
                this.applyFailure(entry.item, failure);
                await this.recordPending(taskId, entry.item);
                continue;
            }

            const attachment = succeeded.find(
                (value) =>
                    value.name === entry.item.fileName && !claimed.has(value),
            );
            if (attachment) {
                claimed.add(attachment);
                entry.item.attachment = attachment;
                entry.item.state = "succeeded";
                entry.item.error = undefined;
                entry.item.file = undefined;
                await this.clearPending(taskId, entry.item);
                continue;
            }

            // No success claimed this file. If the server reported a leftover
            // failure it belongs to this file; otherwise never claim success we
            // cannot prove, because an unproven attachment id would break
            // download and delete.
            const leftover = failed.shift();
            if (leftover) {
                this.applyFailure(entry.item, leftover);
                await this.recordPending(taskId, entry.item);
                continue;
            }
            entry.item.state = "failed";
            entry.item.error = publicError(
                "REMOTE_ERROR",
                `${entry.item.fileName} was not confirmed by the server`,
                true,
                "retry",
            );
            await this.recordPending(taskId, entry.item);
        }
        this.notify();
    }

    private applyFailure(item: AttachmentItem, failure: UploadFailure): void {
        item.state = "failed";
        item.error = publicError(
            failure.code === "PAYLOAD_TOO_LARGE"
                ? "PAYLOAD_TOO_LARGE"
                : "REMOTE_ERROR",
            failure.message,
            failure.retryable,
        );
    }

    private async recordPending(
        taskId: number,
        item: AttachmentItem,
    ): Promise<void> {
        try {
            await this.pendingOperations?.add({
                kind: "attachment-upload",
                taskId,
                localDraftRef: item.id,
                fileName: item.fileName,
            });
        } catch {
            // Recovery metadata is best effort and must not hide the upload error.
        }
    }

    private async clearPending(
        taskId: number,
        item: AttachmentItem,
    ): Promise<void> {
        try {
            await this.pendingOperations?.remove({
                kind: "attachment-upload",
                taskId,
                localDraftRef: item.id,
                fileName: item.fileName,
            });
        } catch {
            // A stale recovery marker is safer than failing an acknowledged upload.
        }
    }

    private notify(): void {
        for (const listener of this.listeners) listener();
    }
}
