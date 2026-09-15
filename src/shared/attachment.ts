import { Permission } from "./task.js";

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
    bytes: Uint8Array;
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
    previewSize?: number;
}

export interface DeleteAttachmentRequest {
    taskId: number;
    attachmentId: number;
}
