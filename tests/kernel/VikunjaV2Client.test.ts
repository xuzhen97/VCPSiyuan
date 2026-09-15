import { describe, expect, it } from "vitest";
import { HttpClient, HttpRequest } from "../../src/kernel/http/HttpClient.js";
import { VikunjaV2Client } from "../../src/kernel/vikunja/VikunjaV2Client.js";

class FakeHttp implements HttpClient {
    requests: HttpRequest[] = [];
    response: {
        status: number;
        headers: Record<string, string[]>;
        data: unknown;
    } = {
        status: 200,
        headers: {},
        data: {},
    };
    async request<T>(request: HttpRequest) {
        this.requests.push(request);
        return this.response as {
            status: number;
            headers: Record<string, string[]>;
            data: T;
        };
    }
}

const credentials = {
    origin: "https://tasks.example",
    token: "secret",
};

describe("VikunjaV2Client", () => {
    it("builds only v2 URLs from a root Origin", () => {
        expect(
            VikunjaV2Client.buildUrl("https://tasks.example", "/tasks"),
        ).toBe("https://tasks.example/api/v2/tasks");
        expect(
            VikunjaV2Client.buildUrl("https://tasks.example/", "tasks", {
                page: 2,
                filter: "done = false",
            }),
        ).toBe(
            "https://tasks.example/api/v2/tasks?page=2&filter=done+%3D+false",
        );
    });

    it("validates a v2 page Envelope and forwards ETag", async () => {
        const http = new FakeHttp();
        http.response = {
            status: 200,
            headers: { etag: ['"v2"'] },
            data: { items: [{ id: 1 }], total: 1, page: 1, per_page: 50 },
        };
        const client = new VikunjaV2Client(http);
        const result = await client.requestPage(
            credentials,
            "/tasks",
            { page: 1, per_page: 50 },
            (value) => value as { id: number },
        );
        expect(result.data).toEqual({
            items: [{ id: 1 }],
            total: 1,
            page: 1,
            perPage: 50,
        });
        expect(result.headers.etag).toEqual(['"v2"']);
        expect(http.requests[0].url).toBe(
            "https://tasks.example/api/v2/tasks?page=1&per_page=50",
        );
        expect(http.requests[0].headers?.Authorization).toBe("Bearer secret");
    });

    it("maps remote status codes to stable transport errors", async () => {
        const http = new FakeHttp();
        http.response = { status: 409, headers: {}, data: {} };
        const client = new VikunjaV2Client(http);
        await expect(
            client.requestJson(credentials, "PATCH", "/tasks/1", {
                body: { kind: "json", value: {} },
            }),
        ).rejects.toMatchObject({ kind: "http", status: 409 });
    });

    it("builds repeated query parameters for multi-value options", () => {
        // Vikunja rejects "sort_by=a,b" with HTTP 400; each value needs its own
        // key=value pair.
        expect(
            VikunjaV2Client.buildUrl("https://tasks.example", "/tasks", {
                sort_by: ["priority", "updated"],
                order_by: ["desc", "desc"],
            }),
        ).toBe(
            "https://tasks.example/api/v2/tasks?sort_by=priority&sort_by=updated&order_by=desc&order_by=desc",
        );
    });

    it("accepts a 304 no-op response instead of throwing", async () => {
        const http = new FakeHttp();
        http.response = { status: 304, headers: {}, data: undefined };
        const client = new VikunjaV2Client(http);
        const result = await client.requestJson<unknown>(
            credentials,
            "PATCH",
            "/tasks/1",
            { body: { kind: "json", value: {} } },
        );
        expect(result.status).toBe(304);
        expect(result.data).toBeUndefined();
    });

    it("uses binary mode for downloads and rejects unsafe attachment IDs", async () => {
        const http = new FakeHttp();
        http.response = {
            status: 200,
            headers: { "content-type": ["text/plain"] },
            data: new Uint8Array([1, 2]),
        };
        const client = new VikunjaV2Client(http);
        const result = await client.downloadFile(credentials, 9, 2);
        expect([...result.data]).toEqual([1, 2]);
        expect(http.requests[0].responseMode).toBe("binary");
        await expect(
            client.downloadFile(credentials, 0, 2),
        ).rejects.toMatchObject({ kind: "invalid-response" });
    });
});
