import {
    HttpBody,
    HttpClient,
    HttpRequest,
    HttpResponse,
    HttpTransportError,
    UploadFilePayload,
} from "./HttpClient.js";
import { decodeBase64, encodeBase64, toBytes } from "../../shared/bytes.js";

export type KernelFetchInit = {
    method?: string;
    headers?: Record<string, string>;
    body?: string | ArrayBuffer;
};

export type KernelFetchResponse = {
    ok: boolean;
    status: number;
    statusText: string;
    headers?: Record<string, string | string[]>;
    text: () => Promise<string>;
};

export type KernelFetch = (
    url: string,
    init: KernelFetchInit,
) => Promise<KernelFetchResponse>;

interface ProxyResponseData {
    status: number;
    contentType?: string;
    body: string;
    bodyEncoding?: string;
    headers?: Record<string, string | string[]>;
}

interface ProxyEnvelope {
    code?: number;
    msg?: string;
    data?: ProxyResponseData;
}

interface EncodedBody {
    contentType?: string;
    payloadEncoding?: string;
    payload?: unknown;
}

export interface SiYuanHttpClientOptions {
    logger?: (entry: {
        level: string;
        method: string;
        url: string;
        status?: number;
    }) => void;
    /** Maximum decoded JSON/text response size. */
    maxBytes?: number;
    /** Maximum decoded binary response size. */
    maxBinaryBytes?: number;
}

const FORWARD_PROXY_PATH = "/api/network/forwardProxy";
const DEFAULT_JSON_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_BINARY_MAX_BYTES = 30 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024;

export class SiYuanHttpClient implements HttpClient {
    private readonly fetchImpl: KernelFetch;
    private readonly logger?: SiYuanHttpClientOptions["logger"];
    private readonly maxBytes: number;
    private readonly maxBinaryBytes: number;

    constructor(fetchImpl: KernelFetch, options: SiYuanHttpClientOptions = {}) {
        this.fetchImpl = fetchImpl;
        this.logger = options.logger;
        this.maxBytes = options.maxBytes ?? DEFAULT_JSON_MAX_BYTES;
        this.maxBinaryBytes =
            options.maxBinaryBytes ?? DEFAULT_BINARY_MAX_BYTES;
    }

    async request<T>(request: HttpRequest): Promise<HttpResponse<T>> {
        const targetBody = this.encodeBody(request.body);
        const targetHeaders = { ...(request.headers ?? {}) };
        if (
            targetBody.contentType &&
            !this.hasHeader(targetHeaders, "content-type")
        ) {
            targetHeaders["Content-Type"] = targetBody.contentType;
        }

        const envelope: Record<string, unknown> = {
            url: request.url,
            method: request.method,
            headers: Object.entries(targetHeaders).map(([key, value]) => ({
                [key]: value,
            })),
            timeout: 7000,
            responseEncoding:
                request.responseMode === "binary" ? "base64" : "text",
        };
        if (targetBody.contentType)
            envelope.contentType = targetBody.contentType;
        if (targetBody.payloadEncoding)
            envelope.payloadEncoding = targetBody.payloadEncoding;
        if (targetBody.payload !== undefined)
            envelope.payload = targetBody.payload;

        let response: KernelFetchResponse;
        try {
            response = await this.fetchImpl(FORWARD_PROXY_PATH, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(envelope),
            });
        } catch (error) {
            this.log("warn", request.method, request.url);
            throw new HttpTransportError(
                "network",
                `Network error requesting ${request.method} ${this.safeLogUrl(request.url)}: ${this.errorMessage(error)}`,
            );
        }

        const outerHeaders = this.normalizeHeaders(response.headers);
        let outerText: string;
        try {
            outerText = await response.text();
        } catch (error) {
            throw new HttpTransportError(
                "network",
                `Unable to read proxy response: ${this.errorMessage(error)}`,
                { status: response.status, headers: outerHeaders },
            );
        }

        let outer: ProxyEnvelope;
        try {
            outer = JSON.parse(outerText) as ProxyEnvelope;
        } catch {
            throw new HttpTransportError(
                "invalid-response",
                "SiYuan forwardProxy returned invalid JSON",
                { status: response.status, headers: outerHeaders },
            );
        }
        if (outer.code !== undefined && outer.code !== 0) {
            throw new HttpTransportError(
                outer.code === 10 ? "too-large" : "network",
                outer.code === 10
                    ? "SiYuan forwardProxy response exceeded 32 MiB"
                    : "SiYuan forwardProxy failed",
                { status: response.status, headers: outerHeaders },
            );
        }
        if (
            !outer.data ||
            typeof outer.data.body !== "string" ||
            !Number.isInteger(outer.data.status)
        ) {
            throw new HttpTransportError(
                "invalid-response",
                "SiYuan forwardProxy returned an invalid response envelope",
                { status: response.status, headers: outerHeaders },
            );
        }

        const target = outer.data;
        const normalizedHeaders = this.normalizeHeaders(target.headers);
        if (target.contentType && !normalizedHeaders["content-type"]) {
            normalizedHeaders["content-type"] = [target.contentType];
        }

        // 304 is a successful empty response for Vikunja's AutoPatch, which
        // answers "nothing changed" with 304 Not Modified instead of a body.
        const successful =
            (target.status >= 200 && target.status < 300) ||
            target.status === 304;
        if (!successful) {
            this.log("warn", request.method, request.url, target.status);
            throw new HttpTransportError(
                "http",
                `HTTP ${target.status} from ${request.method} ${this.safeLogUrl(request.url)}`,
                { status: target.status, headers: normalizedHeaders },
            );
        }

        const responseMode = request.responseMode ?? "json";
        let data: unknown;
        if (
            responseMode === "empty" ||
            target.status === 204 ||
            target.status === 304 ||
            target.body.length === 0
        ) {
            data = undefined;
        } else if (responseMode === "binary") {
            let bytes: Uint8Array;
            try {
                bytes = decodeBase64(target.body);
            } catch {
                throw new HttpTransportError(
                    "invalid-response",
                    "Proxy returned invalid Base64",
                );
            }
            if (bytes.byteLength > this.maxBinaryBytes) {
                throw new HttpTransportError(
                    "too-large",
                    `Binary response exceeded ${this.maxBinaryBytes} bytes`,
                    { status: target.status, headers: normalizedHeaders },
                );
            }
            data = bytes;
        } else {
            if (target.body.length > this.maxBytes) {
                throw new HttpTransportError(
                    "too-large",
                    `Response exceeded ${this.maxBytes} bytes`,
                    { status: target.status, headers: normalizedHeaders },
                );
            }
            if (responseMode === "text") {
                data = target.body;
            } else {
                try {
                    data = JSON.parse(target.body);
                } catch {
                    throw new HttpTransportError(
                        "invalid-response",
                        "Vikunja returned invalid JSON",
                        { status: target.status, headers: normalizedHeaders },
                    );
                }
            }
        }

        this.log("info", request.method, request.url, target.status);
        return {
            status: target.status,
            headers: normalizedHeaders,
            data: data as T,
        };
    }

    private encodeBody(body: HttpRequest["body"]): EncodedBody {
        if (body === undefined || body === null) return {};
        if (typeof body === "string") {
            return {
                contentType: "text/plain",
                payloadEncoding: "text",
                payload: body,
            };
        }
        if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
            const bytes =
                body instanceof Uint8Array ? body : new Uint8Array(body);
            return {
                contentType: "application/octet-stream",
                payloadEncoding: "base64",
                payload: encodeBase64(bytes),
            };
        }
        if (this.isHttpBody(body)) {
            return this.encodeTypedBody(body);
        }
        return {
            contentType: "application/json",
            payloadEncoding: "json",
            payload: body,
        };
    }

    private encodeTypedBody(body: HttpBody): EncodedBody {
        switch (body.kind) {
            case "json":
                return {
                    contentType: "application/json",
                    payloadEncoding: "json",
                    payload: body.value,
                };
            case "text":
                return {
                    contentType: "text/plain",
                    payloadEncoding: "text",
                    payload: body.value,
                };
            case "binary": {
                return {
                    contentType: "application/octet-stream",
                    payloadEncoding: "base64",
                    payload: encodeBase64(toBytes(body.value)),
                };
            }
            case "multipart": {
                const encoded = encodeMultipart(body.files);
                return {
                    contentType: encoded.contentType,
                    payloadEncoding: "base64",
                    payload: encodeBase64(encoded.bytes),
                };
            }
        }
    }

    private isHttpBody(body: HttpRequest["body"]): body is HttpBody {
        return (
            typeof body === "object" &&
            body !== null &&
            "kind" in body &&
            ["json", "multipart", "binary", "text"].includes(
                String((body as { kind?: unknown }).kind),
            )
        );
    }

    private hasHeader(
        headers: Record<string, string>,
        expected: string,
    ): boolean {
        return Object.keys(headers).some(
            (key) => key.toLowerCase() === expected,
        );
    }

    private normalizeHeaders(
        raw?: Record<string, string | string[]>,
    ): Record<string, string[]> {
        if (!raw) return {};
        const result: Record<string, string[]> = {};
        for (const [key, value] of Object.entries(raw)) {
            result[key.toLowerCase()] = Array.isArray(value)
                ? value.map(String)
                : [String(value)];
        }
        return result;
    }

    private safeLogUrl(url: string): string {
        try {
            const parsed = new URL(url);
            return `${parsed.origin}${parsed.pathname}`;
        } catch {
            return "[invalid-url]";
        }
    }

    private log(
        level: string,
        method: string,
        url: string,
        status?: number,
    ): void {
        this.logger?.({ level, method, url: this.safeLogUrl(url), status });
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : "unknown error";
    }
}

function encodeMultipart(files: UploadFilePayload[]): {
    bytes: Uint8Array;
    contentType: string;
} {
    // Bytes must be rebuilt first: see toBytes for why they arrive JSON-shaped.
    const attachments = files.map((file) => ({
        ...file,
        bytes: toBytes(file.bytes),
    }));
    for (const file of attachments) {
        if (file.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
            throw new HttpTransportError(
                "too-large",
                `Attachment ${file.id} exceeds the 30 MiB raw-file limit`,
            );
        }
    }
    const boundary = `----vcpsiyuan-${Math.random().toString(16).slice(2)}`;
    const chunks: Uint8Array[] = [];
    for (const file of attachments) {
        chunks.push(utf8(`--${boundary}\r\n`));
        chunks.push(
            utf8(
                `Content-Disposition: form-data; name="files"; filename="${sanitizeFileName(file.name)}"\r\n`,
            ),
        );
        chunks.push(
            utf8(
                `Content-Type: ${file.type || "application/octet-stream"}\r\n\r\n`,
            ),
        );
        chunks.push(file.bytes);
        chunks.push(utf8("\r\n"));
    }
    chunks.push(utf8(`--${boundary}--\r\n`));
    return {
        bytes: concat(chunks),
        contentType: `multipart/form-data; boundary=${boundary}`,
    };
}

function sanitizeFileName(value: string): string {
    return value.replace(/[\r\n"\\]/g, "_").slice(0, 255) || "attachment";
}

function utf8(value: string): Uint8Array {
    const bytes: number[] = [];
    for (let index = 0; index < value.length; index += 1) {
        let code = value.charCodeAt(index);
        // Fold a surrogate pair into one code point before encoding.
        if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
            const low = value.charCodeAt(index + 1);
            if (low >= 0xdc00 && low <= 0xdfff) {
                code = ((code - 0xd800) << 10) + (low - 0xdc00) + 0x10000;
                index += 1;
            }
        }
        if (code < 0x80) {
            bytes.push(code);
        } else if (code < 0x800) {
            bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        } else if (code < 0x10000) {
            bytes.push(
                0xe0 | (code >> 12),
                0x80 | ((code >> 6) & 0x3f),
                0x80 | (code & 0x3f),
            );
        } else {
            bytes.push(
                0xf0 | (code >> 18),
                0x80 | ((code >> 12) & 0x3f),
                0x80 | ((code >> 6) & 0x3f),
                0x80 | (code & 0x3f),
            );
        }
    }
    return new Uint8Array(bytes);
}

function concat(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result;
}

