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
