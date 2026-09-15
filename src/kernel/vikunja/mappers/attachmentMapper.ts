import {
    AttachmentMeta,
    UploadBatchResult,
} from "../../../shared/attachment.js";
import { HttpTransportError } from "../../http/HttpClient.js";

function object(value: unknown, name: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null) {
        throw new HttpTransportError(
            "invalid-response",
            `${name} must be an object`,
        );
    }
    return value as Record<string, unknown>;
}

function positiveId(value: unknown, name: string): number {
    const id = typeof value === "number" ? value : Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new HttpTransportError(
            "invalid-response",
            `${name} must be a positive safe integer`,
        );
    }
    return id;
}

function firstString(...values: unknown[]): string | null {
    for (const value of values) {
        if (typeof value === "string" && value.length > 0) return value;
    }
    return null;
}

function firstNumber(...values: unknown[]): number | null {
    for (const value of values) {
        if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    return null;
}

function firstArray(...values: unknown[]): unknown[] {
    for (const value of values) {
        if (Array.isArray(value)) return value;
    }
    return [];
}

/**
 * Vikunja nests the file's own metadata under `file` on the attachment
 * resource (`{ id, task_id, created_by, file: { name, size, mime, created } }`).
 * Reading only the flat keys silently discarded every attachment, so the nested
 * object is the primary source and the flat keys remain as a fallback.
 */
function nestedFile(raw: Record<string, unknown>): Record<string, unknown> {
    const file = raw.file;
    return typeof file === "object" && file !== null
        ? (file as Record<string, unknown>)
        : {};
}

/**
 * Maps one attachment. Shared by the attachment endpoints, the task detail
 * payload, and the upload result so the three can never drift apart.
 */
export function mapAttachment(value: unknown): AttachmentMeta {
    const raw = object(value, "attachment");
    const file = nestedFile(raw);
    const name = firstString(file.name, raw.file_name, raw.name);
    if (name === null) {
        throw new HttpTransportError(
            "invalid-response",
            "Attachment name is required",
        );
    }
    return {
        id: positiveId(raw.id, "attachment.id"),
        name,
        size: firstNumber(file.size, raw.file_size, raw.size) ?? 0,
        mimeType:
            firstString(file.mime, raw.mime_type, raw.mime) ??
            "application/octet-stream",
        createdAt: firstString(file.created, raw.created, raw.created_at),
    };
}

export function mapUploadBatch(value: unknown): UploadBatchResult {
    const raw = object(value, "attachment upload response");
    // Vikunja answers with `{ success: [...], errors: [...] }`.
    const succeeded = firstArray(raw.success, raw.succeeded, raw.attachments);
    const failed = firstArray(raw.errors, raw.failed);
    return {
        succeeded: succeeded.map(mapAttachment),
        failed: failed.map((item) => {
            const failure = object(item, "attachment failure");
            return {
                clientFileId:
                    firstString(failure.client_file_id, failure.clientFileId) ??
                    "",
                // Vikunja does not name the failed file, so this stays empty and
                // callers attribute failures by elimination (see AttachmentStore).
                fileName: firstString(failure.file_name, failure.name) ?? "",
                code:
                    firstString(failure.code) ??
                    (typeof failure.code === "number"
                        ? String(failure.code)
                        : "UPLOAD_FAILED"),
                message:
                    firstString(failure.message) ?? "Attachment upload failed",
                retryable: failure.retryable !== false,
            };
        }),
    };
}
