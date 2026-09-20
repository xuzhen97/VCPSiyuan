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

    // The RPC binding passes one `request` object, so a service that destructured
    // its arguments positionally received `{ draft }` as the draft itself and sent
    // an empty body: Vikunja then stored a title-less row.
    it("unwraps the RPC envelope for label and project writes", async () => {
        const labelGateway = {
            create: vi.fn().mockResolvedValue({
                id: 1,
                title: "Label",
                descriptionMarkdown: "",
                color: null,
                maxPermission: "owner",
            }),
        };
        const labels = new LabelService(labelGateway as never);
        await labels.create(credentials, {
            draft: {
                title: "Label",
                descriptionMarkdown: "body",
                color: "00ff00",
            },
        });
        expect(labelGateway.create).toHaveBeenCalledWith(credentials, {
            title: "Label",
            descriptionMarkdown: "body",
            color: "00ff00",
        });

        const projectGateway = {
            create: vi.fn().mockResolvedValue({ id: 2, title: "Project" }),
            patch: vi.fn().mockResolvedValue({ id: 2, title: "Renamed" }),
            get: vi.fn().mockResolvedValue({ id: 2, title: "Renamed" }),
            delete: vi.fn().mockResolvedValue(undefined),
        };
        const projects = new ProjectService(
            projectGateway as never,
            {} as never,
        );
        await projects.create(credentials, {
            draft: {
                title: "Project",
                descriptionMarkdown: "",
                color: null,
                parentProjectId: null,
            },
        });
        expect(projectGateway.create).toHaveBeenCalledWith(credentials, {
            title: "Project",
            descriptionMarkdown: "",
            color: null,
            parentProjectId: null,
        });

        await projects.patch(credentials, {
            projectId: 2,
            draft: { title: "Renamed" },
        });
        expect(projectGateway.patch).toHaveBeenCalledWith(credentials, 2, {
            title: "Renamed",
        });

        await projects.delete(credentials, {
            projectId: 2,
            expectedTitle: "Renamed",
        });
        expect(projectGateway.delete).toHaveBeenCalledWith(credentials, 2);
    });
});
