import { describe, expect, it, vi } from "vitest";
import { ProjectService } from "../../src/kernel/services/ProjectService.js";
import { LabelService } from "../../src/kernel/services/LabelService.js";

const credentials = { origin: "https://tasks.example", token: "secret" };

describe("resource impact services", () => {
    it("marks project deletion incomplete when a descendant cannot be inspected", async () => {
        const projectGateway = {
            list: vi.fn().mockResolvedValue({
                data: {
                    items: [
                        { id: 1, title: "Root", parentProjectId: null },
                        { id: 2, title: "Child", parentProjectId: 1 },
                    ],
                },
            }),
        };
        const taskGateway = {
            query: vi.fn().mockRejectedValue(new Error("forbidden")),
        };
        const service = new ProjectService(
            projectGateway as never,
            taskGateway as never,
        );
        const result = await service.getDeleteImpact(credentials, 1, false);
        expect(result.complete).toBe(false);
        expect(result.openTaskCount).toBe(0);
    });

    it("scopes label impact to accessible tasks and uses the remote title", async () => {
        const service = new LabelService(
            {
                get: vi
                    .fn()
                    .mockResolvedValue({
                        id: 7,
                        title: "Remote",
                        descriptionMarkdown: "",
                        color: null,
                        maxPermission: "owner",
                    }),
            } as never,
            {
                query: vi.fn().mockResolvedValue({ data: { total: 3 } }),
            } as never,
        );
        const result = await service.getDeleteImpact(credentials, 7);
        expect(result.complete).toBe(true);
        expect(result.accessibleTaskCount).toBe(3);
        expect(result.label.title).toBe("Remote");
    });

    it("does not allow a label deletion preview without a remote label read", async () => {
        const service = new LabelService({
            query: vi.fn().mockResolvedValue({ data: { total: 3 } }),
        } as never);
        const result = await service.getDeleteImpact(credentials, 7);
        expect(result.complete).toBe(false);
    });
});
