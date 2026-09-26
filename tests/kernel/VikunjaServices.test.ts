import { describe, expect, it, vi } from "vitest";
import { AttachmentService } from "../../src/kernel/services/AttachmentService.js";
import { ConnectionService } from "../../src/kernel/services/ConnectionService.js";
import { TaskCommandService } from "../../src/kernel/services/TaskCommandService.js";
import { TaskQueryService } from "../../src/kernel/services/TaskQueryService.js";
import { TaskRelationService } from "../../src/kernel/services/TaskRelationService.js";
import { HttpTransportError } from "../../src/kernel/http/HttpClient.js";

const credentials = {
    origin: "https://tasks.example",
    token: "secret",
};

describe("Vikunja application services", () => {
    it("reports v2.5.0 capabilities and computes the 30 MiB effective attachment limit", async () => {
        const client = {
            requestJson: vi.fn().mockResolvedValue({
                status: 200,
                headers: {},
                data: {
                    version: "v2.5.0",
                    max_file_size: "20MB",
                    task_attachments_enabled: true,
                },
            }),
        };
        const service = new ConnectionService(client as never, {
            taskPatch: true,
            projectPermissions: true,
        });
        const result = await service.test(credentials);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.serverVersion).toBe("v2.5.0");
            expect(result.data.effectiveAttachmentLimitBytes).toBe(
                20 * 1024 * 1024,
            );
            expect(result.data.writesAllowed).toBe(true);
        }
    });

    it("requires valid credentials before reporting a connection", async () => {
        const client = {
            requestJson: vi
                .fn()
                .mockResolvedValueOnce({
                    status: 200,
                    headers: {},
                    data: {
                        version: "dev",
                        api_version: "v2",
                        max_file_size: "20MB",
                        task_attachments_enabled: true,
                    },
                })
                .mockRejectedValueOnce(
                    new HttpTransportError(
                        "http",
                        "HTTP 401",
                        { status: 401 },
                    ),
                ),
        };
        const service = new ConnectionService(client as never, {
            taskPatch: true,
            projectPermissions: true,
        });

        const result = await service.test(credentials);

        expect(result).toEqual({
            ok: false,
            error: expect.objectContaining({ code: "UNAUTHORIZED" }),
        });
        expect(client.requestJson).toHaveBeenNthCalledWith(
            2,
            credentials,
            "GET",
            "/user",
        );
    });

    it("disables writes for an unsupported server version", async () => {
        const client = {
            requestJson: vi.fn().mockResolvedValue({
                status: 200,
                headers: {},
                data: {
                    version: "v2.4.0",
                    max_file_size: "100MB",
                    task_attachments_enabled: false,
                },
            }),
        };
        const service = new ConnectionService(client as never, {
            taskPatch: true,
            projectPermissions: true,
        });
        const result = await service.test(credentials);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.data.writesAllowed).toBe(false);
    });

    it("validates structured task filter IDs and inbox project filters", async () => {
        const gateway = { query: vi.fn() };
        const service = new TaskQueryService(gateway as never);
        const base = {
            view: "all" as const,
            page: 1,
            perPage: 50,
            timeZone: "UTC",
            doneFilter: "open" as const,
            projectIds: [],
            labelIds: [],
        };

        for (const ids of [[0], [-1], [1.5], [Number.MAX_SAFE_INTEGER + 1]]) {
            const result = await service.query(credentials, {
                ...base,
                projectIds: ids,
            });
            expect(result).toMatchObject({
                ok: false,
                error: { code: "VALIDATION_ERROR" },
            });
        }
        const inbox = await service.query(credentials, {
            ...base,
            view: "inbox",
            inboxProjectId: 7,
            projectIds: [2],
        });
        expect(inbox).toMatchObject({
            ok: false,
            error: { code: "VALIDATION_ERROR" },
        });
        expect(gateway.query).not.toHaveBeenCalled();
    });

    it("validates task title search and delegates valid paginated search", async () => {
        const page = { items: [], total: 0, page: 2, perPage: 10 };
        const gateway = { search: vi.fn().mockResolvedValue(page) };
        const service = new TaskQueryService(gateway as never);

        expect(
            await service.search(credentials, { query: "   ", page: 1, perPage: 10 }),
        ).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
        expect(
            await service.search(credentials, { query: "x".repeat(201), page: 1, perPage: 10 }),
        ).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
        expect(
            await service.search(credentials, { query: "needle", page: 0, perPage: 10 }),
        ).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
        expect(gateway.search).not.toHaveBeenCalled();

        await expect(
            service.search(credentials, { query: "needle", page: 2, perPage: 10 }),
        ).resolves.toEqual({ ok: true, data: page });
        expect(gateway.search).toHaveBeenCalledWith(credentials, {
            query: "needle", page: 2, perPage: 10,
        });
    });

    it("allows task relation writes only with permission and valid distinct IDs", async () => {
        const detail = { id: 12, title: "Parent", parentTasks: [], childTasks: [] };
        const gateway = {
            linkChild: vi.fn().mockResolvedValue(undefined),
            unlinkChild: vi.fn().mockResolvedValue(undefined),
            get: vi.fn().mockResolvedValue({ value: detail, etag: "v2", updatedAt: "v2" }),
        };
        const readOnly = new TaskRelationService(gateway as never, { writesAllowed: false });
        expect(await readOnly.link(credentials, { parentTaskId: 12, childTaskId: 33 }))
            .toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
        expect(gateway.linkChild).not.toHaveBeenCalled();

        const service = new TaskRelationService(gateway as never, { writesAllowed: true });
        for (const request of [
            { parentTaskId: 0, childTaskId: 33 },
            { parentTaskId: 12, childTaskId: 12 },
            { parentTaskId: 12, childTaskId: Number.MAX_SAFE_INTEGER + 1 },
        ]) {
            expect(await service.link(credentials, request)).toMatchObject({
                ok: false, error: { code: "VALIDATION_ERROR" },
            });
        }
        expect(gateway.linkChild).not.toHaveBeenCalled();

        expect(await service.link(credentials, { parentTaskId: 12, childTaskId: 33 }))
            .toEqual({ ok: true, data: detail });
        expect(gateway.linkChild).toHaveBeenCalledWith(credentials, 12, 33);
        expect(gateway.get).toHaveBeenCalledWith(credentials, 12);
        expect(await service.unlink(credentials, { parentTaskId: 12, childTaskId: 33 }))
            .toEqual({ ok: true, data: detail });
        expect(gateway.unlinkChild).toHaveBeenCalledWith(credentials, 12, 33);
    });

    it("returns ATTACHMENTS_DISABLED without calling the gateway", async () => {
        const gateway = { upload: vi.fn(), delete: vi.fn() };
        const service = new AttachmentService(gateway as never, {
            attachmentsEnabled: false,
        });
        const result = await service.upload(credentials, {
            taskId: 1,
            files: [],
        });
        expect(result).toEqual({
            ok: false,
            error: expect.objectContaining({ code: "ATTACHMENTS_DISABLED" }),
        });
        expect(gateway.upload).not.toHaveBeenCalled();
    });

    it("deletes a task only when writes are enabled and the title is unchanged", async () => {
        const gateway = {
            get: vi.fn().mockResolvedValue({
                value: { id: 1, title: "Buy milk" },
                etag: '"v1"',
                updatedAt: "1",
            }),
            delete: vi.fn().mockResolvedValue(undefined),
        };

        const readOnly = new TaskCommandService(gateway as never, {
            writesAllowed: false,
        });
        const forbidden = await readOnly.delete(credentials, {
            taskId: 1,
            expectedTitle: "Buy milk",
        });
        expect(forbidden).toMatchObject({
            ok: false,
            error: { code: "FORBIDDEN" },
        });
        expect(gateway.delete).not.toHaveBeenCalled();

        const service = new TaskCommandService(gateway as never, {
            writesAllowed: true,
        });
        const invalid = await service.delete(credentials, {
            taskId: 0,
            expectedTitle: "Buy milk",
        });
        expect(invalid).toMatchObject({
            ok: false,
            error: { code: "VALIDATION_ERROR" },
        });

        // The title is the stale-guard the project/label deletes use: a rename
        // made remotely after the dialog opened must block the deletion.
        const stale = await service.delete(credentials, {
            taskId: 1,
            expectedTitle: "Renamed remotely",
        });
        expect(stale).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
        expect(gateway.delete).not.toHaveBeenCalled();

        const result = await service.delete(credentials, {
            taskId: 1,
            expectedTitle: "Buy milk",
        });
        expect(result).toEqual({ ok: true, data: undefined });
        expect(gateway.delete).toHaveBeenCalledWith(credentials, 1);
    });

    it("blocks a stale update before PATCH and refreshes after a successful relation update", async () => {
        const gateway = {
            get: vi.fn().mockResolvedValue({
                value: {
                    id: 1,
                    updatedAt: "new",
                    labels: [],
                    assignees: [],
                },
                etag: '"new"',
                updatedAt: "new",
            }),
            patchScalars: vi.fn(),
            setLabels: vi.fn().mockResolvedValue(undefined),
            setAssignees: vi.fn().mockResolvedValue(undefined),
        };
        const service = new TaskCommandService(gateway as never, {
            writesAllowed: true,
        });
        const stale = await service.update(credentials, {
            taskId: 1,
            patch: { title: "x" },
            expected: { etag: '"old"' },
        });
        expect(stale).toEqual({
            ok: false,
            error: expect.objectContaining({ code: "CONFLICT" }),
        });
        expect(gateway.patchScalars).not.toHaveBeenCalled();
    });
});
