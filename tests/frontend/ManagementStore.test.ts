import { describe, expect, it, vi } from "vitest";
import { ManagementStore } from "../../src/frontend/stores/ManagementStore.js";

describe("ManagementStore", () => {
    it("requires complete impact and exact title before delete", async () => {
        const remove = vi.fn().mockResolvedValue({ ok: true, data: undefined });
        const store = new ManagementStore({ deleteResource: remove });
        store.setImpact({
            project: { id: 1, title: "Inbox" },
            descendantProjects: [],
            openTaskCount: 1,
            completedTaskCount: 0,
            isInboxProject: true,
            complete: false,
        });
        expect(await store.deleteProject(1, "Inbox")).toMatchObject({
            ok: false,
        });
        expect(remove).not.toHaveBeenCalled();
        store.setImpact({
            project: { id: 1, title: "Inbox" },
            descendantProjects: [],
            openTaskCount: 1,
            completedTaskCount: 0,
            isInboxProject: true,
            complete: true,
        });
        expect(await store.deleteProject(1, "wrong")).toMatchObject({
            ok: false,
        });
        expect(await store.deleteProject(1, "Inbox")).toMatchObject({
            ok: true,
            inboxRepairRequired: true,
        });
        expect(remove).toHaveBeenCalledTimes(1);
    });
});
