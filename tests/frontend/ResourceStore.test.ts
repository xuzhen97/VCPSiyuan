import { describe, expect, it, vi } from "vitest";
import { ResourceStore } from "../../src/frontend/stores/ResourceStore.js";

describe("ResourceStore", () => {
    it("loads projects and labels through the typed controller and searches project members", async () => {
        const call = vi.fn(async (method: string) => {
            if (method === "vikunja.projects.list") {
                return {
                    ok: true,
                    data: {
                        items: [
                            {
                                id: 2,
                                title: "Inbox",
                                descriptionMarkdown: "",
                                color: null,
                                parentProjectId: null,
                                archived: false,
                                maxPermission: "write",
                            },
                        ],
                        total: 1,
                        page: 1,
                        perPage: 100,
                    },
                };
            }
            if (method === "vikunja.labels.list") {
                return {
                    ok: true,
                    data: {
                        items: [
                            {
                                id: 4,
                                title: "work",
                                descriptionMarkdown: "",
                                color: "#123456",
                                maxPermission: "write",
                            },
                        ],
                        total: 1,
                        page: 1,
                        perPage: 100,
                    },
                };
            }
            return {
                ok: true,
                data: {
                    items: [
                        {
                            id: 8,
                            username: "alice",
                            displayName: "Alice",
                        },
                    ],
                    total: 1,
                    page: 1,
                    perPage: 20,
                },
            };
        });
        const store = new ResourceStore({ controller: { call } as never });

        await store.refresh();
        expect(store.getProjects()).toHaveLength(1);
        expect(store.getLabels()).toEqual([
            expect.objectContaining({ id: 4, title: "work" }),
        ]);
        await expect(store.searchMembers(2, "ali")).resolves.toEqual([
            expect.objectContaining({ id: 8, username: "alice" }),
        ]);
        expect(call).toHaveBeenCalledWith(
            "vikunja.users.search",
            expect.objectContaining({
                projectId: 2,
                query: "ali",
                page: 1,
                perPage: 20,
            }),
        );
    });

    it("builds a cycle-safe project tree and preserves full paths", () => {
        const store = new ResourceStore({ controller: {} as never });
        store.setProjects([
            {
                id: 1,
                title: "Root",
                descriptionMarkdown: "",
                color: null,
                parentProjectId: null,
                archived: false,
                maxPermission: "admin",
            },
            {
                id: 2,
                title: "Child",
                descriptionMarkdown: "",
                color: null,
                parentProjectId: 1,
                archived: false,
                maxPermission: "write",
            },
            {
                id: 3,
                title: "Child",
                descriptionMarkdown: "",
                color: null,
                parentProjectId: 2,
                archived: false,
                maxPermission: "write",
            },
        ]);
        expect(store.getProjectPath(3)).toBe("Root / Child / Child");
        expect(() =>
            store.setProjects([
                {
                    id: 1,
                    title: "A",
                    descriptionMarkdown: "",
                    color: null,
                    parentProjectId: 2,
                    archived: false,
                    maxPermission: "admin",
                },
                {
                    id: 2,
                    title: "B",
                    descriptionMarkdown: "",
                    color: null,
                    parentProjectId: 1,
                    archived: false,
                    maxPermission: "admin",
                },
            ]),
        ).toThrow(/cycle/i);
    });
});
