import { describe, expect, it, vi } from "vitest";
import { HttpTransportError } from "../../src/kernel/http/HttpClient.js";
import { SiYuanHttpClient } from "../../src/kernel/http/SiYuanHttpClient.js";

function proxyResponse(target: {
    status: number;
    body: string;
    bodyEncoding?: string;
    contentType?: string;
    headers?: Record<string, string[]>;
}) {
    return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { "content-type": ["application/json"] },
        text: async () =>
            JSON.stringify({
                code: 0,
                msg: "",
                data: {
                    url: "https://tasks.example/api/v2/test",
                    status: target.status,
                    contentType: target.contentType ?? "application/json",
                    body: target.body,
                    bodyEncoding: target.bodyEncoding ?? "text",
                    headers: target.headers ?? {},
                },
            }),
    };
}

describe("SiYuanHttpClient", () => {
    it("uses only the local forwardProxy path and decodes JSON envelopes", async () => {
        const fetch = vi.fn().mockResolvedValue(
            proxyResponse({
                status: 200,
                body: '{"ok":true}',
                headers: { etag: ['"v1"'] },
            }),
        );
        const client = new SiYuanHttpClient(fetch);

        const result = await client.request<{ ok: boolean }>({
            method: "GET",
            url: "https://tasks.example/api/v2/test?secret=hidden",
            headers: { Authorization: "Bearer hidden" },
            responseMode: "json",
        });

        expect(result.data).toEqual({ ok: true });
        expect(result.headers.etag).toEqual(['"v1"']);
        expect(fetch).toHaveBeenCalledWith(
            "/api/network/forwardProxy",
            expect.objectContaining({
                method: "POST",
                headers: { "Content-Type": "application/json" },
            }),
        );
        const init = fetch.mock.calls[0][1] as { body: string };
        const envelope = JSON.parse(init.body);
        expect(envelope.url).toBe(
            "https://tasks.example/api/v2/test?secret=hidden",
        );
        expect(envelope.method).toBe("GET");
        expect(envelope.headers).toEqual([{ Authorization: "Bearer hidden" }]);
        expect(envelope.responseEncoding).toBe("text");
    });

    it("builds multipart in the Kernel and sends Base64 payload through the proxy", async () => {
        const fetch = vi
            .fn()
            .mockResolvedValue(proxyResponse({ status: 201, body: "{}" }));
        const client = new SiYuanHttpClient(fetch);
        const bytes = new TextEncoder().encode("hello");

        await client.request({
            method: "POST",
            url: "https://tasks.example/api/v2/tasks/9/attachments",
            body: {
                kind: "multipart",
                files: [{ id: "f1", name: "a.txt", type: "text/plain", bytes }],
            },
            responseMode: "json",
        });

        const init = fetch.mock.calls[0][1] as { body: string };
        const envelope = JSON.parse(init.body);
        expect(envelope.contentType).toMatch(
            /^multipart\/form-data; boundary=/,
        );
        expect(envelope.payloadEncoding).toBe("base64");
        expect(envelope.payload).toEqual(expect.any(String));
        expect(fetch.mock.calls[0][0]).toBe("/api/network/forwardProxy");
        expect(envelope.payload).not.toContain("[object Object]");
    });

    it("rebuilds bytes that crossed the JSON-RPC boundary as a plain object", async () => {
        const fetch = vi
            .fn()
            .mockResolvedValue(proxyResponse({ status: 201, body: "{}" }));
        const client = new SiYuanHttpClient(fetch);
        // The plugin RPC is JSON-RPC: a Uint8Array sent by the frontend arrives in
        // the Kernel as {"0":104,...} with no byteLength, which used to make
        // Uint8Array#set throw before any request was sent.
        const bytes = JSON.parse(
            JSON.stringify(new Uint8Array([104, 101, 108, 108, 111])),
        ) as unknown as Uint8Array;

        await client.request({
            method: "POST",
            url: "https://tasks.example/api/v2/tasks/9/attachments",
            body: {
                kind: "multipart",
                files: [{ id: "f1", name: "a.txt", type: "text/plain", bytes }],
            },
            responseMode: "json",
        });

        const envelope = JSON.parse(
            (fetch.mock.calls[0][1] as { body: string }).body,
        );
        const decoded = Buffer.from(envelope.payload, "base64");
        expect(decoded.includes(Buffer.from("hello", "utf8"))).toBe(true);
    });

    it("decodes bounded binary responses without applying the JSON limit", async () => {
        const binary = new Uint8Array([0, 1, 2, 255]);
        let binaryText = "";
        for (const byte of binary) binaryText += String.fromCharCode(byte);
        const encoded = btoa(binaryText);
        const fetch = vi.fn().mockResolvedValue(
            proxyResponse({
                status: 200,
                body: encoded,
                bodyEncoding: "base64",
                contentType: "application/octet-stream",
            }),
        );
        const client = new SiYuanHttpClient(fetch, { maxBytes: 2 });

        const result = await client.request<Uint8Array>({
            method: "GET",
            url: "https://tasks.example/api/v2/tasks/9/attachments/2",
            responseMode: "binary",
        });

        expect([...result.data]).toEqual([...binary]);
    });

    it("encodes and decodes Base64 without btoa/atob/TextEncoder", async () => {
        // The SiYuan Kernel runs plugin code in goja, which exposes ECMAScript
        // built-ins only -- btoa/atob/TextEncoder are undefined there, so relying
        // on them made every attachment upload and binary download fail. Node has
        // all three, so remove them here to reproduce the Kernel runtime.
        const saved = {
            btoa: Reflect.get(globalThis, "btoa"),
            atob: Reflect.get(globalThis, "atob"),
            TextEncoder: Reflect.get(globalThis, "TextEncoder"),
        };
        Reflect.deleteProperty(globalThis, "btoa");
        Reflect.deleteProperty(globalThis, "atob");
        Reflect.deleteProperty(globalThis, "TextEncoder");
        try {
            const fetch = vi
                .fn()
                .mockResolvedValue(proxyResponse({ status: 201, body: "{}" }));
            const client = new SiYuanHttpClient(fetch);
            // "héllo" exercises multi-byte UTF-8, not just ASCII.
            await client.request({
                method: "POST",
                url: "https://tasks.example/api/v2/tasks/9/attachments",
                body: {
                    kind: "multipart",
                    files: [
                        {
                            id: "f1",
                            name: "héllo.txt",
                            type: "text/plain",
                            bytes: new Uint8Array([0x68, 0x80, 0xff]),
                        },
                    ],
                },
                responseMode: "json",
            });

            const envelope = JSON.parse(
                (fetch.mock.calls[0][1] as { body: string }).body,
            );
            expect(envelope.payloadEncoding).toBe("base64");
            // Decode with a known-good reference independent of the client.
            const raw = Buffer.from(envelope.payload, "base64");
            await expect(raw.includes(Buffer.from("héllo.txt", "utf8"))).toBe(
                true,
            );
            const decoded = raw.toString("latin1");
            expect(decoded).toContain('name="files"; filename="h');
            expect(decoded).toContain("\r\nContent-Type: text/plain\r\n");

            const binary = Buffer.from([0, 1, 2, 255]).toString("base64");
            const binaryFetch = vi.fn().mockResolvedValue(
                proxyResponse({
                    status: 200,
                    body: binary,
                    bodyEncoding: "base64",
                    contentType: "application/octet-stream",
                }),
            );
            const binaryResult = await new SiYuanHttpClient(binaryFetch)
                .request<Uint8Array>({
                    method: "GET",
                    url: "https://tasks.example/api/v2/tasks/9/attachments/2",
                    responseMode: "binary",
                });
            expect([...binaryResult.data]).toEqual([0, 1, 2, 255]);
        } finally {
            for (const [key, value] of Object.entries(saved)) {
                if (value !== undefined)
                    Reflect.set(globalThis, key, value as unknown);
            }
        }
    });

    it("maps a proxied 204 to undefined without JSON parsing", async () => {
        const fetch = vi
            .fn()
            .mockResolvedValue(proxyResponse({ status: 204, body: "" }));
        const client = new SiYuanHttpClient(fetch);
        const result = await client.request<void>({
            method: "DELETE",
            url: "https://tasks.example/api/v2/tasks/9",
            responseMode: "empty",
        });
        expect(result.data).toBeUndefined();
    });

    it("treats a proxied 304 as a successful empty response", async () => {
        // Vikunja's AutoPatch answers a patch that changes nothing with
        // 304 Not Modified and no body; it must not surface as a failure.
        const fetch = vi
            .fn()
            .mockResolvedValue(proxyResponse({ status: 304, body: "" }));
        const client = new SiYuanHttpClient(fetch);
        const result = await client.request<unknown>({
            method: "PATCH",
            url: "https://tasks.example/api/v2/tasks/9",
            responseMode: "json",
        });
        expect(result.status).toBe(304);
        expect(result.data).toBeUndefined();
    });

    it("rejects a decoded binary response above its configured bound", async () => {
        const binary = btoa("12345");
        const fetch = vi.fn().mockResolvedValue(
            proxyResponse({
                status: 200,
                body: binary,
                bodyEncoding: "base64",
            }),
        );
        const client = new SiYuanHttpClient(fetch, { maxBinaryBytes: 4 });

        await expect(
            client.request<Uint8Array>({
                method: "GET",
                url: "https://tasks.example/api/v2/file",
                responseMode: "binary",
            }),
        ).rejects.toMatchObject({
            kind: "too-large",
        } satisfies Partial<HttpTransportError>);
    });

    it("never includes authorization values in diagnostics", async () => {
        const logger = vi.fn();
        const client = new SiYuanHttpClient(
            vi.fn().mockRejectedValue(new Error("offline")),
            { logger },
        );

        await expect(
            client.request({
                method: "GET",
                url: "https://tasks.example/api/v2/info?token=hidden",
                headers: { Authorization: "Bearer super-secret" },
            }),
        ).rejects.toBeInstanceOf(HttpTransportError);

        expect(JSON.stringify(logger.mock.calls)).not.toContain("super-secret");
        expect(JSON.stringify(logger.mock.calls)).not.toContain("token=hidden");
    });
});
