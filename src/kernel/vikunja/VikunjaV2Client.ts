import {
    AttachmentMeta,
    UploadBatchResult,
    UploadFilePayload,
} from "../../shared/attachment.js";
import { Page, parsePage } from "../../shared/pagination.js";
import { VikunjaCredentials } from "../../shared/contracts.js";
import {
    HttpBody,
    HttpClient,
    HttpRequest,
    HttpResponse,
    HttpTransportError,
} from "../http/HttpClient.js";

export type VikunjaQueryValue =
    | string
    | number
    | boolean
    | undefined
    | string[];
export type VikunjaQuery = Record<string, VikunjaQueryValue>;

export interface VikunjaRequestOptions {
    query?: VikunjaQuery;
    body?:
        | HttpBody
        | Record<string, unknown>
        | string
        | Uint8Array
        | ArrayBuffer;
    responseMode?: "json" | "text" | "binary" | "empty";
    headers?: Record<string, string>;
}

export class VikunjaV2Client {
    private readonly http: HttpClient;

    constructor(http: HttpClient) {
        this.http = http;
    }

    /**
     * Vikunja expects repeated query parameters for multi-value options such as
     * `sort_by` and `order_by`. Sending `sort_by=a,b` is rejected with HTTP 400,
     * so array values become one `key=value` pair each.
     */
    static buildUrl(
        origin: string,
        path: string,
        query?: VikunjaQuery,
    ): string {
        const cleanOrigin = origin.trim().replace(/\/+$/, "");
        const cleanPath = `/${path.replace(/^\/+/, "")}`;
        let url: URL;
        try {
            url = new URL(`${cleanOrigin}/api/v2${cleanPath}`);
        } catch {
            throw new HttpTransportError(
                "invalid-response",
                "Invalid Vikunja instance origin",
            );
        }
        for (const [key, value] of Object.entries(query ?? {})) {
            if (value === undefined) continue;
            if (Array.isArray(value)) {
                url.searchParams.delete(key);
                for (const item of value)
                    url.searchParams.append(key, String(item));
                continue;
            }
            url.searchParams.set(key, String(value));
        }
        return url.toString();
    }

    async requestJson<T>(
        credentials: VikunjaCredentials,
        method: HttpRequest["method"],
        path: string,
        options: VikunjaRequestOptions = {},
    ): Promise<HttpResponse<T>> {
        const origin = credentials.origin;
        if (!origin) {
            throw new HttpTransportError(
                "invalid-response",
                "Vikunja instance origin is required",
            );
        }
        const response = await this.http.request<T>({
            method,
            url: VikunjaV2Client.buildUrl(origin, path, options.query),
            headers: {
                Authorization: `Bearer ${credentials.token}`,
                ...(options.headers ?? {}),
            },
            body: options.body,
            responseMode: options.responseMode ?? "json",
        });
        if (
            response.status !== 304 &&
            (response.status < 200 || response.status >= 300)
        ) {
            throw new HttpTransportError(
                "http",
                `Vikunja request failed with status ${response.status}`,
                {
                    status: response.status,
                    headers: response.headers,
                },
            );
        }
        return response;
    }

    async requestPage<T>(
        credentials: VikunjaCredentials,
        path: string,
        query: VikunjaQuery,
        parseItem: (item: unknown) => T,
    ): Promise<HttpResponse<Page<T>>> {
        const response = await this.requestJson<unknown>(
            credentials,
            "GET",
            path,
            { query },
        );
        return {
            ...response,
            data: parsePage(response.data, parseItem),
        };
    }

    async uploadFiles(
        credentials: VikunjaCredentials,
        taskId: number,
        files: UploadFilePayload[],
    ): Promise<HttpResponse<UploadBatchResult>> {
        this.assertId(taskId, "taskId");
        return this.requestJson<UploadBatchResult>(
            credentials,
            "POST",
            `/tasks/${taskId}/attachments`,
            {
                body: { kind: "multipart", files },
            },
        );
    }

    async downloadFile(
        credentials: VikunjaCredentials,
        taskId: number,
        attachmentId: number,
        previewSize?: number,
    ): Promise<HttpResponse<Uint8Array>> {
        this.assertId(taskId, "taskId");
        this.assertId(attachmentId, "attachmentId");
        return this.requestJson<Uint8Array>(
            credentials,
            "GET",
            `/tasks/${taskId}/attachments/${attachmentId}`,
            {
                query:
                    previewSize === undefined
                        ? undefined
                        : { preview_size: previewSize },
                responseMode: "binary",
            },
        );
    }

    async listAttachments(
        credentials: VikunjaCredentials,
        taskId: number,
        query: VikunjaQuery = {},
    ): Promise<HttpResponse<Page<AttachmentMeta>>> {
        this.assertId(taskId, "taskId");
        return this.requestPage(
            credentials,
            `/tasks/${taskId}/attachments`,
            query,
            (item) => item as AttachmentMeta,
        );
    }

    private assertId(value: number, field: string): void {
        if (!Number.isSafeInteger(value) || value <= 0) {
            throw new HttpTransportError(
                "invalid-response",
                `${field} must be a positive safe integer`,
            );
        }
    }
}
