import {
    AttachmentMeta,
    AttachmentQuery,
    BinaryDownload,
    DeleteAttachmentRequest,
    DownloadRequest,
    UploadBatchResult,
} from "../../shared/attachment.js";
import { RpcResult, VikunjaCredentials } from "../../shared/contracts.js";
import { publicError } from "../../shared/errors.js";
import { Page } from "../../shared/pagination.js";
import { UploadRequest } from "../../shared/rpc.js";
import { AttachmentGateway } from "../vikunja/AttachmentGateway.js";
import { toServiceError } from "./serviceError.js";

export interface AttachmentServiceOptions {
    attachmentsEnabled:
        | boolean
        | ((credentials: VikunjaCredentials) => Promise<boolean>);
}

export class AttachmentService {
    constructor(
        private readonly gateway: AttachmentGateway,
        private readonly options: AttachmentServiceOptions,
    ) {}

    async list(
        credentials: VikunjaCredentials,
        request: AttachmentQuery,
    ): Promise<RpcResult<Page<AttachmentMeta>>> {
        if (!(await this.attachmentsEnabled(credentials)))
            return this.disabled();
        return this.run(
            async () =>
                (
                    await this.gateway.list(
                        credentials,
                        request.taskId,
                        request.page,
                        request.perPage,
                    )
                ).data,
            "Attachment list failed",
        );
    }

    async upload(
        credentials: VikunjaCredentials,
        request: UploadRequest,
    ): Promise<RpcResult<UploadBatchResult>> {
        if (!(await this.attachmentsEnabled(credentials)))
            return {
                ok: false,
                error: publicError(
                    "ATTACHMENTS_DISABLED",
                    "Attachments are disabled by the Vikunja server",
                ),
            };
        return this.run(
            () =>
                this.gateway.upload(credentials, request.taskId, request.files),
            "Attachment upload failed",
        );
    }

    async download(
        credentials: VikunjaCredentials,
        request: DownloadRequest,
    ): Promise<RpcResult<BinaryDownload>> {
        if (!(await this.attachmentsEnabled(credentials)))
            return this.disabled();
        return this.run(
            () => this.gateway.download(credentials, request),
            "Attachment download failed",
        );
    }

    async delete(
        credentials: VikunjaCredentials,
        request: DeleteAttachmentRequest,
    ): Promise<RpcResult<void>> {
        if (!(await this.attachmentsEnabled(credentials)))
            return {
                ok: false,
                error: publicError(
                    "ATTACHMENTS_DISABLED",
                    "Attachments are disabled by the Vikunja server",
                ),
            };
        return this.run(
            () => this.gateway.delete(credentials, request),
            "Attachment delete failed",
        );
    }

    private async attachmentsEnabled(
        credentials: VikunjaCredentials,
    ): Promise<boolean> {
        return typeof this.options.attachmentsEnabled === "function"
            ? this.options.attachmentsEnabled(credentials)
            : this.options.attachmentsEnabled;
    }

    private disabled<T>(): RpcResult<T> {
        return {
            ok: false,
            error: publicError(
                "ATTACHMENTS_DISABLED",
                "Attachments are disabled by the Vikunja server",
            ),
        };
    }

    private async run<T>(
        operation: () => Promise<T>,
        fallback: string,
    ): Promise<RpcResult<T>> {
        try {
            return { ok: true, data: await operation() };
        } catch (error) {
            return { ok: false, error: toServiceError(error, fallback) };
        }
    }
}
