import { describe, expect, it, vi } from "vitest";
import { UserGateway } from "../../src/kernel/vikunja/UserGateway.js";
import { UserService } from "../../src/kernel/services/UserService.js";

const credentials = {
    origin: "https://tasks.example",
    token: "secret",
};

describe("UserService", () => {
    it("loads only the safe current-user reference from the v2 endpoint", async () => {
        const gateway = {
            current: vi.fn().mockResolvedValue({
                data: {
                    id: 42,
                    username: "alice",
                    displayName: "Alice",
                },
            }),
        };
        const service = new UserService(gateway as never);

        const result = await service.current(credentials, {});

        expect(result).toEqual({
            ok: true,
            data: { id: 42, username: "alice", displayName: "Alice" },
        });
        expect(gateway.current).toHaveBeenCalledWith(credentials);
    });

    it("maps the v2 current-user wire object without exposing unrelated fields", async () => {
        const requestJson = vi.fn().mockResolvedValue({
            status: 200,
            headers: {},
            data: {
                id: 7,
                username: "bob",
                name: "Bob",
                email: "private@example.test",
                avatar_url: "/avatar",
                password: "must-not-cross-boundary",
            },
        });
        const gateway = new UserGateway({ requestJson } as never);

        const result = await gateway.current(credentials);

        expect(result.data).toEqual({
            id: 7,
            username: "bob",
            displayName: "Bob",
            avatarUrl: "/avatar",
        });
        expect(result.data).not.toHaveProperty("email");
        expect(result.data).not.toHaveProperty("password");
        expect(requestJson).toHaveBeenCalledWith(credentials, "GET", "/user");
    });
});
