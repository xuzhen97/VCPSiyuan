import { describe, expect, it } from "vitest";
import { HttpTransportError } from "../../src/kernel/http/HttpClient.js";
import { VikunjaGateway } from "../../src/kernel/vikunja/VikunjaGateway.js";
import { VikunjaService } from "../../src/kernel/vikunja/VikunjaService.js";

class SequenceHttpClient {
    readonly requests: Array<{
        url: string;
        headers?: Record<string, string>;
    }> = [];
    private readonly responses: Array<
        | { status: number; headers: Record<string, string[]>; data: unknown }
        | Error
    >;

    constructor(
        responses: Array<
            | {
                  status: number;
                  headers: Record<string, string[]>;
                  data: unknown;
              }
            | Error
        >,
    ) {
        this.responses = [...responses];
    }

    async request<T>(request: {
        url: string;
        headers?: Record<string, string>;
    }): Promise<{
        status: number;
        headers: Record<string, string[]>;
        data: T;
    }> {
        this.requests.push({ url: request.url, headers: request.headers });
        const response = this.responses.shift();
        if (!response) throw new Error("Unexpected extra HTTP request");
        if (response instanceof Error) throw response;
        return response as {
            status: number;
            headers: Record<string, string[]>;
            data: T;
        };
    }
}

describe("Vikunja v2 compatibility facade", () => {
    const credentials = {
        origin: "https://tasks.example",
        token: "test-secret-token",
    };

    it("tests connection through v2 /info without exposing the token", async () => {
        const http = new SequenceHttpClient([
            {
                status: 200,
                headers: {},
                data: {
                    version: "v2.5.0",
                    max_file_size: "20MB",
                    task_attachments_enabled: true,
                },
            },
        ]);
        const service = new VikunjaService(new VikunjaGateway(http as never));
        const result = await service.testConnection(credentials);
        expect(result).toMatchObject({
            ok: true,
            data: {
                apiVersion: "v2",
                serverVersion: "v2.5.0",
                writesAllowed: true,
            },
        });
        expect(http.requests[0].url).toBe("https://tasks.example/api/v2/info");
        expect(JSON.stringify(result)).not.toContain("test-secret-token");
    });

    it("maps a v2 paginated task response", async () => {
        const http = new SequenceHttpClient([
            {
                status: 200,
                headers: {},
                data: {
                    items: [
                        {
                            id: 1,
                            title: "Task 1",
                            project_id: 7,
                            project: { id: 7, title: "Inbox" },
                            done: false,
                            due_date: "2026-10-01T10:00:00Z",
                            priority: 2,
                        },
                        {
                            id: 2,
                            title: "Task 2",
                            project_id: 7,
                            done: false,
                            due_date: "0001-01-01T00:00:00Z",
                            priority: 1,
                        },
                    ],
                    total: 2,
                    page: 1,
                    per_page: 50,
                },
            },
        ]);
        const service = new VikunjaService(new VikunjaGateway(http as never));
        const result = await service.listOpenTasks(credentials);
        expect(result).toMatchObject({
            ok: true,
            data: [
                { id: 1, dueAt: "2026-10-01T10:00:00Z" },
                { id: 2, dueAt: null },
            ],
        });
        expect(http.requests[0].url).toContain("/api/v2/tasks");
    });

    it("maps unauthorized transport errors without leaking the token", async () => {
        const http = new SequenceHttpClient([
            new HttpTransportError("http", "401", { status: 401 }),
        ]);
        const service = new VikunjaService(new VikunjaGateway(http as never));
        const result = await service.testConnection(credentials);
        expect(result).toMatchObject({
            ok: false,
            error: { code: "UNAUTHORIZED" },
        });
        expect(JSON.stringify(result)).not.toContain("test-secret-token");
    });

    it("keeps the facade deterministic when the v2 response is malformed", async () => {
        const http = new SequenceHttpClient([
            {
                status: 200,
                headers: {},
                data: { items: [], total: "bad", page: 1, per_page: 50 },
            },
        ]);
        const service = new VikunjaService(new VikunjaGateway(http as never));
        const result = await service.listOpenTasks(credentials);
        expect(result.ok).toBe(false);
    });
});
