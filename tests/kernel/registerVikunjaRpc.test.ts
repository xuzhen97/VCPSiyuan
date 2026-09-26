import { describe, expect, it, vi } from "vitest";
import { registerVikunjaRpc } from "../../src/kernel/rpc/registerVikunjaRpc.js";

describe("registerVikunjaRpc", () => {
    it("binds the typed v2 RPC table and unbinds every method exactly once", async () => {
        const rpc = { bind: vi.fn(), unbind: vi.fn() };
        const services = {
            connection: {
                test: vi
                    .fn()
                    .mockResolvedValue({ ok: true, data: { connected: true } }),
            },
            tasks: {
                query: vi
                    .fn()
                    .mockResolvedValue({
                        ok: true,
                        data: { items: [], total: 0, page: 1, perPage: 50 },
                    }),
                search: vi.fn().mockResolvedValue({
                    ok: true,
                    data: { items: [], total: 0, page: 1, perPage: 10 },
                }),
            },
            relations: {
                link: vi.fn().mockResolvedValue({ ok: true, data: { id: 12 } }),
                unlink: vi.fn().mockResolvedValue({ ok: true, data: { id: 12 } }),
            },
        };

        const dispose = await registerVikunjaRpc(
            rpc as never,
            services as never,
        );
        const names = rpc.bind.mock.calls.map((call: unknown[]) => call[0]);
        expect(names).toContain("vikunja.connection.test");
        expect(names).toContain("vikunja.tasks.query");
        expect(names).toContain("vikunja.tasks.search");
        expect(names).toContain("vikunja.tasks.linkChild");
        expect(names).toContain("vikunja.tasks.unlinkChild");
        expect(names).toContain("vikunja.tasks.delete");
        expect(names).not.toContain("vikunja.testConnection");

        const connectionBinding = rpc.bind.mock.calls.find(
            (call: unknown[]) => call[0] === "vikunja.connection.test",
        );
        expect(connectionBinding).toBeDefined();
        const connectionHandler = connectionBinding![1] as (
            value: unknown,
        ) => Promise<unknown>;
        await connectionHandler({
            credentials: { origin: "https://tasks.example", token: "secret" },
            request: {},
        });
        expect(services.connection.test).toHaveBeenCalledWith(
            { origin: "https://tasks.example", token: "secret" },
            {},
        );

        const searchBinding = rpc.bind.mock.calls.find(
            (call: unknown[]) => call[0] === "vikunja.tasks.search",
        );
        const searchHandler = searchBinding![1] as (value: unknown) => Promise<unknown>;
        await searchHandler({
            credentials: { origin: "https://tasks.example", token: "secret" },
            request: { query: "needle", page: 2, perPage: 10 },
        });
        expect(services.tasks.search).toHaveBeenCalledWith(
            { origin: "https://tasks.example", token: "secret" },
            { query: "needle", page: 2, perPage: 10 },
        );

        const linkBinding = rpc.bind.mock.calls.find(
            (call: unknown[]) => call[0] === "vikunja.tasks.linkChild",
        );
        const linkHandler = linkBinding![1] as (value: unknown) => Promise<unknown>;
        await linkHandler({
            credentials: { origin: "https://tasks.example", token: "secret" },
            request: { parentTaskId: 12, childTaskId: 33 },
        });
        expect(services.relations.link).toHaveBeenCalledWith(
            { origin: "https://tasks.example", token: "secret" },
            { parentTaskId: 12, childTaskId: 33 },
        );

        await dispose();
        await dispose();
        expect(rpc.unbind).toHaveBeenCalledTimes(names.length);
        expect(
            new Set(rpc.unbind.mock.calls.map((call: unknown[]) => call[0]))
                .size,
        ).toBe(names.length);
    });
});
