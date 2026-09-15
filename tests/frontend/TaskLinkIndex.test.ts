import { describe, expect, it, vi } from "vitest";
import { TaskLinkIndex } from "../../src/frontend/context/TaskLinkIndex.js";

describe("TaskLinkIndex", () => {
    it("stores metadata only and finds links for a document", async () => {
        let stored: unknown;
        const index = new TaskLinkIndex({
            load: async () => stored,
            save: async (_name: string, value: unknown) => {
                stored = value;
            },
        });
        await index.upsert({
            taskId: 12,
            blockId: "b1",
            documentId: "d1",
            notebookId: "n1",
            updatedAt: 1,
        });
        await index.upsert({
            taskId: 34,
            blockId: "b2",
            documentId: "d1",
            notebookId: "n1",
            updatedAt: 2,
        });
        expect(await index.taskIdsForDocument("d1")).toEqual(new Set([12, 34]));
        expect(JSON.stringify(stored)).not.toContain("text");
    });

    it("scans a missing document segment once and persists only validated metadata", async () => {
        let stored: unknown;
        const index = new TaskLinkIndex({
            load: async () => stored,
            save: async (_name: string, value: unknown) => {
                stored = value;
            },
        });
        const scan = vi.fn().mockResolvedValue([
            {
                taskId: 88,
                blockId: "b88",
                documentId: "d88",
                updatedAt: 8,
            },
        ]);
        expect(await index.taskIdsForDocumentOrScan("d88", scan)).toEqual(
            new Set([88]),
        );
        expect(await index.taskIdsForDocumentOrScan("d88", scan)).toEqual(
            new Set([88]),
        );
        expect(scan).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(stored)).not.toContain("description");
    });

    it("marks repair when an explicit rebuild fails", async () => {
        let stored: unknown;
        const index = new TaskLinkIndex({
            load: async () => stored,
            save: async (_name: string, value: unknown) => {
                stored = value;
            },
        });
        await expect(
            index.rebuild(async () => {
                throw new Error("scan failed");
            }),
        ).rejects.toThrow("scan failed");
        await index.markNeedsRepair();
        expect(stored).toMatchObject({ schemaVersion: 1, needsRepair: true });
    });

    it("runs full rebuild only through an explicit callback", async () => {
        const index = new TaskLinkIndex({
            load: async () => null,
            save: async () => {},
        });
        let count = 0;
        await index.rebuild(() => {
            count += 1;
            return Promise.resolve();
        });
        expect(count).toBe(1);
    });

    it("rebuilds the workspace from notebook, document, Block, and Attribute APIs", async () => {
        let stored: unknown;
        const index = new TaskLinkIndex({
            load: async () => stored,
            save: async (_name: string, value: unknown) => {
                stored = value;
            },
        });
        const context = {
            listNotebooks: vi.fn().mockResolvedValue([
                { id: "open", closed: false, encrypted: false, unlocked: true },
                {
                    id: "closed",
                    closed: true,
                    encrypted: false,
                    unlocked: true,
                },
                {
                    id: "locked",
                    closed: false,
                    encrypted: true,
                    unlocked: false,
                },
            ]),
            listNotebookDocuments: vi
                .fn()
                .mockResolvedValue([
                    {
                        documentId: "doc-1",
                        notebookId: "open",
                        path: "/doc-1.sy",
                    },
                ]),
            listDocumentBlocks: vi.fn().mockResolvedValue([
                {
                    blockId: "b1",
                    documentId: "doc-1",
                    notebookId: "open",
                    updatedAt: 4,
                },
                {
                    blockId: "b2",
                    documentId: "doc-1",
                    notebookId: "open",
                    updatedAt: 5,
                },
            ]),
            getBlockAttrs: vi
                .fn()
                .mockResolvedValueOnce({
                    "custom-vikunja-task-links": '{"v":1,"taskIds":[12,34]}',
                })
                .mockResolvedValueOnce({ "custom-vikunja-task-links": "" }),
        };

        await index.rebuildWorkspace(context);

        expect(context.listNotebookDocuments).toHaveBeenCalledWith("open");
        expect(context.listNotebookDocuments).not.toHaveBeenCalledWith(
            "closed",
        );
        expect(context.listNotebookDocuments).not.toHaveBeenCalledWith(
            "locked",
        );
        expect(await index.list()).toEqual([
            {
                taskId: 12,
                blockId: "b1",
                documentId: "doc-1",
                notebookId: "open",
                updatedAt: 4,
            },
            {
                taskId: 34,
                blockId: "b1",
                documentId: "doc-1",
                notebookId: "open",
                updatedAt: 4,
            },
        ]);
        expect(await index.needsRepair()).toBe(false);
    });
});
