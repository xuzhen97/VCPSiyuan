import type {
    KernelFetch,
    KernelFetchInit,
    KernelFetchResponse,
} from "../src/kernel/http/SiYuanHttpClient.js";

/**
 * An environment-neutral reimplementation of SiYuan's kernel handler
 * `POST /api/network/forwardProxy` (see `examples/siyuan/kernel/api/network.go`).
 *
 * It exists so the plugin's real `SiYuanHttpClient` can run outside SiYuan — in
 * the browser dev sandbox and in the live integration tests — while still
 * exercising the production transport path. It mirrors:
 *
 * - the request envelope (`url`, `method`, `headers`, `timeout`, `contentType`,
 *   `payloadEncoding`, `payload`, `responseEncoding`);
 * - `Content-Type` defaulting to `application/json`;
 * - `payloadEncoding` decoding for `json`, `text` and `base64`;
 * - the always-HTTP-200 response envelope `{ code, msg, data }`;
 * - `responseEncoding: "base64"` encoding of the response body;
 * - the 32 MiB response cap reported as `code: 10`;
 * - transport failures reported as `code: 8`.
 *
 * Deliberately free of Node APIs so the same shim serves the browser sandbox and
 * the Node integration tests; a second copy would be free to drift from this
 * contract.
 */
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const FORWARD_PROXY_PATH = "/api/network/forwardProxy";

interface ForwardProxyRequest {
    url?: unknown;
    method?: unknown;
    headers?: unknown;
    responseEncoding?: unknown;
    contentType?: unknown;
    payloadEncoding?: unknown;
    payload?: unknown;
}

export interface ForwardProxyLogEntry {
    url: string;
    method: string;
    contentType: string;
    status: number;
    bodyBytes: number;
}

export interface ForwardProxyShim {
    fetch: KernelFetch;
    log: ForwardProxyLogEntry[];
}

export function createForwardProxyShim(): ForwardProxyShim {
    const log: ForwardProxyLogEntry[] = [];

    const forwardProxy = async (
        path: string,
        init: KernelFetchInit,
    ): Promise<KernelFetchResponse> => {
        if (path !== FORWARD_PROXY_PATH) {
            throw new Error(
                `forwardProxy shim received an unexpected path: ${path}`,
            );
        }
        const envelope = JSON.parse(
            String(init.body ?? "{}"),
        ) as ForwardProxyRequest;
        const destUrl = envelope.url;
        if (typeof destUrl !== "string") {
            return envelope200({ code: 1, msg: "invalid [url]" });
        }
        let parsed: URL;
        try {
            parsed = new URL(destUrl);
        } catch {
            return envelope200({ code: 1, msg: "invalid [url]" });
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return envelope200({ code: 2, msg: "only http/https is allowed" });
        }

        const method = (
            typeof envelope.method === "string" ? envelope.method : "POST"
        ).toUpperCase();
        const headers: Record<string, string> = {};
        if (Array.isArray(envelope.headers)) {
            for (const pair of envelope.headers) {
                if (typeof pair !== "object" || pair === null) continue;
                for (const [key, value] of Object.entries(
                    pair as Record<string, unknown>,
                )) {
                    headers[key] = String(value);
                }
            }
        }
        const contentType =
            typeof envelope.contentType === "string"
                ? envelope.contentType
                : "application/json";
        headers["Content-Type"] = contentType;

        let response: Response;
        let bodyBytes: Uint8Array;
        try {
            response = await globalThis.fetch(destUrl, {
                method,
                headers,
                body: decodePayload(envelope),
                redirect: "follow",
            });
            bodyBytes = new Uint8Array(await response.arrayBuffer());
        } catch (cause) {
            return envelope200({
                code: 8,
                msg: `forward request failed: ${
                    cause instanceof Error ? cause.message : String(cause)
                }`,
            });
        }

        if (bodyBytes.byteLength > MAX_RESPONSE_BYTES) {
            return envelope200({
                code: 10,
                msg: `response body too large: limit is ${MAX_RESPONSE_BYTES} bytes`,
            });
        }

        const responseEncoding =
            envelope.responseEncoding === "base64" ||
            envelope.responseEncoding === "base64-std"
                ? "base64"
                : "text";
        const outHeaders: Record<string, string | string[]> = {};
        response.headers.forEach((value, key) => {
            outHeaders[key] = value;
        });
        log.push({
            url: destUrl,
            method,
            contentType,
            status: response.status,
            bodyBytes: bodyBytes.byteLength,
        });

        return envelope200({
            code: 0,
            msg: "",
            data: {
                url: destUrl,
                status: response.status,
                contentType: response.headers.get("content-type") ?? "",
                body:
                    responseEncoding === "base64"
                        ? encodeBase64(bodyBytes)
                        : decodeUtf8(bodyBytes),
                bodyEncoding: responseEncoding,
                headers: outHeaders,
                elapsed: 0,
            },
        });
    };

    return { fetch: forwardProxy, log };
}

function decodePayload(
    envelope: ForwardProxyRequest,
): string | ArrayBuffer | undefined {
    if (envelope.payload === undefined || envelope.payload === null) {
        return undefined;
    }
    if (envelope.payloadEncoding === "text") return String(envelope.payload);
    if (
        envelope.payloadEncoding === "base64" ||
        envelope.payloadEncoding === "base64-std"
    ) {
        const bytes = decodeBase64(String(envelope.payload));
        return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
    }
    return JSON.stringify(envelope.payload);
}

function encodeBase64(bytes: Uint8Array): string {
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(
            ...bytes.subarray(index, index + chunkSize),
        );
    }
    return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

function decodeUtf8(bytes: Uint8Array): string {
    return new TextDecoder().decode(bytes);
}

function envelope200(body: unknown): KernelFetchResponse {
    const text = JSON.stringify(body);
    return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        text: async () => text,
    };
}
