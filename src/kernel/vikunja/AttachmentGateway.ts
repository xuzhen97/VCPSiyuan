import {
    AttachmentMeta,
    BinaryDownload,
    DeleteAttachmentRequest,
    DownloadRequest,
    UploadBatchResult,
    UploadFilePayload,
} from "../../shared/attachment.js";
import { Page } from "../../shared/pagination.js";
import { VikunjaCredentials } from "../../shared/contracts.js";
import { VikunjaV2Client } from "./VikunjaV2Client.js";
import { mapAttachment, mapUploadBatch } from "./mappers/attachmentMapper.js";

export class AttachmentGateway {
    constructor(private readonly client: VikunjaV2Client) {}

    async list(
        credentials: VikunjaCredentials,
        taskId: number,
        page = 1,
        perPage = 50,
    ): Promise<{ data: Page<AttachmentMeta> }> {
        assertId(taskId, "taskId");
        const response = await this.client.requestPage(
            credentials,
            `/tasks/${taskId}/attachments`,
            {
                page,
                per_page: perPage,
            },
            mapAttachment,
        );
        return { data: response.data };
    }

    async upload(
        credentials: VikunjaCredentials,
        taskId: number,
        files: UploadFilePayload[],
    ): Promise<UploadBatchResult> {
        assertId(taskId, "taskId");
        const response = await this.client.uploadFiles(
            credentials,
            taskId,
            files,
        );
        return mapUploadBatch(response.data);
    }

    async download(
        credentials: VikunjaCredentials,
        request: DownloadRequest,
    ): Promise<BinaryDownload> {
        assertId(request.taskId, "taskId");
        assertId(request.attachmentId, "attachmentId");
        const response = await this.client.downloadFile(
            credentials,
            request.taskId,
            request.attachmentId,
            request.previewSize,
        );
        return {
            bytes: response.data,
            mimeType:
                response.headers["content-type"]?.[0] ??
                "application/octet-stream",
            fileName: "attachment",
        };
    }

    async delete(
        credentials: VikunjaCredentials,
        request: DeleteAttachmentRequest,
    ): Promise<void> {
        assertId(request.taskId, "taskId");
        assertId(request.attachmentId, "attachmentId");
        await this.client.requestJson<void>(
            credentials,
            "DELETE",
            `/tasks/${request.taskId}/attachments/${request.attachmentId}`,
            {
                responseMode: "empty",
            },
        );
    }
}

function assertId(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value <= 0)
        throw new Error(`${name} must be a positive safe integer`);
}
