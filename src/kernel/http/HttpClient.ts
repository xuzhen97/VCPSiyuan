export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface UploadFilePayload {
    id: string;
    name: string;
    type: string;
    bytes: Uint8Array;
}

export type HttpBody =
    | { kind: "json"; value: unknown }
    | { kind: "multipart"; files: UploadFilePayload[] }
    | { kind: "binary"; value: Uint8Array | ArrayBuffer }
    | { kind: "text"; value: string };

export type HttpResponseMode = "json" | "text" | "binary" | "empty";

export interface HttpRequest {
    method: HttpMethod;
    url: string;
    headers?: Record<string, string>;
    body?:
        | HttpBody
        | Record<string, unknown>
        | string
        | Uint8Array
        | ArrayBuffer;
    responseMode?: HttpResponseMode;
}

export interface HttpResponse<T> {
    status: number;
    headers: Record<string, string[]>;
    data: T;
}

export interface HttpClient {
    request<T>(request: HttpRequest): Promise<HttpResponse<T>>;
}

export type HttpTransportErrorKind =
    | "network"
    | "http"
    | "invalid-response"
    | "too-large";

export class HttpTransportError extends Error {
    readonly kind: HttpTransportErrorKind;
    readonly status?: number;
    readonly headers?: Record<string, string[]>;

    constructor(
        kind: HttpTransportErrorKind,
        message: string,
        options: { status?: number; headers?: Record<string, string[]> } = {},
    ) {
        super(message);
        this.name = "HttpTransportError";
        this.kind = kind;
        this.status = options.status;
        this.headers = options.headers;
    }
}
