import { describe, expect, it, vi } from "vitest";
import { VikunjaController } from "../../src/frontend/controller/VikunjaController.js";

describe("VikunjaController", () => {
    it("resolves the secret for every typed call and sends a request-scoped envelope", async () => {
        const getSecret = vi.fn().mockReturnValue("token-value");
        const call = vi
            .fn()
            .mockResolvedValue({ ok: true, data: { items: [] } });
        const controller = new VikunjaController({
            getConfig: () => ({
                schemaVersion: 2,
                vikunjaOrigin: "https://tasks.example",
                vikunjaTokenSecretName: "VIKUNJA_API_TOKEN",
                inboxProjectId: null,
                snapshotEnabled: true,
            }),
            getSecret,
            call,
        });

        await controller.call("vikunja.tasks.query", {
            view: "focus",
            page: 1,
            perPage: 50,
            timeZone: "Asia/Shanghai",
        });

        expect(getSecret).toHaveBeenCalledWith("VIKUNJA_API_TOKEN");
        expect(call).toHaveBeenCalledWith("vikunja.tasks.query", {
            credentials: {
                origin: "https://tasks.example",
                token: "token-value",
            },
            request: {
                view: "focus",
                page: 1,
                perPage: 50,
                timeZone: "Asia/Shanghai",
            },
        });
    });

    it("uses the inline token without reading the SiYuan secret repository", async () => {
        const getSecret = vi.fn().mockReturnValue("");
        const call = vi.fn().mockResolvedValue({ ok: true, data: {} });
        const controller = new VikunjaController({
            getConfig: () => ({
                schemaVersion: 2,
                vikunjaOrigin: "http://82.156.198.226:3456",
                vikunjaTokenSecretName: "VIKUNJA_API_TOKEN",
                inlineToken: "tk_inline",
                inboxProjectId: null,
                snapshotEnabled: true,
            }),
            getSecret,
            call,
        });

        await controller.call("vikunja.connection.test", {});

        expect(getSecret).not.toHaveBeenCalled();
        expect(call).toHaveBeenCalledWith("vikunja.connection.test", {
            credentials: {
                origin: "http://82.156.198.226:3456",
                token: "tk_inline",
            },
            request: {},
        });
    });

    it("does not call RPC when the configured secret is unavailable", async () => {
        const call = vi.fn();
        const controller = new VikunjaController({
            getConfig: () => ({
                schemaVersion: 2,
                vikunjaOrigin: "https://tasks.example",
                vikunjaTokenSecretName: "VIKUNJA_API_TOKEN",
                inboxProjectId: null,
                snapshotEnabled: true,
            }),
            getSecret: () => "",
            call,
        });

        const result = await controller.call("vikunja.connection.test", {});
        expect(result).toEqual({
            ok: false,
            error: {
                code: "SECRET_NOT_FOUND",
                message:
                    "Secret 'VIKUNJA_API_TOKEN' not found in SiYuan secrets repository",
                retryable: false,
            },
        });
        expect(call).not.toHaveBeenCalled();
    });

    it("rejects an invalid origin before RPC", async () => {
        const call = vi.fn();
        const controller = new VikunjaController({
            getConfig: () => ({
                schemaVersion: 2,
                vikunjaOrigin: "https://tasks.example/custom",
                vikunjaTokenSecretName: "TOKEN",
                inboxProjectId: null,
                snapshotEnabled: true,
            }),
            getSecret: () => "valid-token",
            call,
        });

        const result = await controller.call("vikunja.connection.test", {});
        expect(result).toMatchObject({
            ok: false,
            error: { code: "CONFIG_INVALID" },
        });
        expect(call).not.toHaveBeenCalled();
    });
});
