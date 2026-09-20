import { Permission } from "./task.js";

/** Vikunja's `preview_size` enum: sm=100px, md=200px, lg=400px, xl=800px. */
export type AttachmentPreviewSize = "sm" | "md" | "lg" | "xl";

/**
 * Size requested for the in-dialog viewer. `xl` is the largest preview Vikunja
 * renders, and still a fraction of a camera-sized original.
 */
export const ATTACHMENT_PREVIEW_SIZE: AttachmentPreviewSize = "xl";

/**
 * Vikunja only downscales `image/*` attachments; anything else, plus images it
 * cannot decode (e.g. SVG), comes back as the original bytes, so the preview
 * hint is safe to send for every attachment.
 */
export function isImageMimeType(mimeType: string): boolean {
    return mimeType.startsWith("image/");
}

export interface AttachmentMeta {
    id: number;
    name: string;
    size: number;
    mimeType: string;
    createdAt?: string | null;
    maxPermission?: Permission;
}

export interface UploadFilePayload {
    id: string;
    name: string;
    type: string;
    /** Base64 on the RPC wire; Uint8Array inside the Kernel. */
    bytes: Uint8Array | string;
}

export interface UploadFailure {
    clientFileId: string;
    fileName: string;
    code: string;
    message: string;
    retryable: boolean;
}

export interface UploadBatchResult {
    succeeded: AttachmentMeta[];
    failed: UploadFailure[];
}

export interface BinaryDownload {
    bytes: Uint8Array;
    mimeType: string;
    fileName: string;
}

export interface AttachmentQuery {
    taskId: number;
    page: number;
    perPage: number;
}

export interface DownloadRequest {
    taskId: number;
    attachmentId: number;
    previewSize?: AttachmentPreviewSize;
}

export interface DeleteAttachmentRequest {
    taskId: number;
    attachmentId: number;
}
