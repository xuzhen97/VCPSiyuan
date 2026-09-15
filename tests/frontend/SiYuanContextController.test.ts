import { describe, expect, it, vi } from "vitest";
import { DefaultSiYuanContextController } from "../../src/frontend/controller/SiYuanContextController.js";

describe("DefaultSiYuanContextController", () => {
    it("maps SiYuan block info and document block order without SQL interpolation", async () => {
        const request = vi
            .fn()
            .mockResolvedValueOnce({
                rootID: "doc-1",
                box: "nb-1",
                rootTitle: "Document",
            })
            .mockResolvedValueOnce(["block-1", "block-2"])
            .mockResolvedValueOnce({
                rootID: "doc-1",
                box: "nb-1",
                rootTitle: "Document",
            })
            .mockResolvedValueOnce({
                rootID: "doc-1",
                box: "nb-1",
                rootTitle: "Document",
            });
        const controller = new DefaultSiYuanContextController({ request });

        const blocks = await controller.listDocumentBlocks("doc-1");

        expect(request.mock.calls.map(([path]) => path)).toEqual([
            "/api/block/getBlockInfo",
            "/api/block/getDocBlocksOrders",
            "/api/block/getBlockInfo",
            "/api/block/getBlockInfo",
        ]);
        expect(request.mock.calls.some(([, body]) => "stmt" in body)).toBe(
            false,
        );
        expect(blocks).toEqual([
            {
                blockId: "doc-1",
                documentId: "doc-1",
                notebookId: "nb-1",
                title: "Document",
            },
            {
                blockId: "block-1",
                documentId: "doc-1",
                notebookId: "nb-1",
                title: "Document",
            },
            {
                blockId: "block-2",
                documentId: "doc-1",
                notebookId: "nb-1",
                title: "Document",
            },
        ]);
    });

    it("enumerates accessible notebook documents through the file-tree API", async () => {
        const request = vi
            .fn()
            .mockResolvedValueOnce({
                notebooks: [
                    { id: "nb-1", closed: false },
                    { id: "nb-closed", closed: true },
                    {
                        id: "nb-locked",
                        closed: false,
                        encrypted: true,
                        unlocked: false,
                    },
                ],
            })
            .mockResolvedValueOnce({
                box: "nb-1",
                path: "/",
                files: [{ id: "doc-1", path: "/doc-1.sy", subFileCount: 1 }],
            })
            .mockResolvedValueOnce({
                box: "nb-1",
                path: "/doc-1.sy",
                files: [
                    {
                        id: "doc-2",
                        path: "/doc-1.sy/doc-2.sy",
                        subFileCount: 0,
                    },
                ],
            });
        const controller = new DefaultSiYuanContextController({ request });

        const notebooks = await controller.listNotebooks();
        const documents = await controller.listNotebookDocuments("nb-1");

        expect(notebooks).toEqual([
            { id: "nb-1", closed: false, encrypted: false, unlocked: true },
            { id: "nb-closed", closed: true, encrypted: false, unlocked: true },
            {
                id: "nb-locked",
                closed: false,
                encrypted: true,
                unlocked: false,
            },
        ]);
        expect(documents).toEqual([
            { documentId: "doc-1", notebookId: "nb-1", path: "/doc-1.sy" },
            {
                documentId: "doc-2",
                notebookId: "nb-1",
                path: "/doc-1.sy/doc-2.sy",
            },
        ]);
        expect(request.mock.calls.map(([path]) => path)).toEqual([
            "/api/notebook/lsNotebooks",
            "/api/filetree/listDocsByPath",
            "/api/filetree/listDocsByPath",
        ]);
        expect(request.mock.calls[1][1]).toMatchObject({
            notebook: "nb-1",
            path: "/",
            maxListCount: 0,
            ignoreMaxListHint: true,
        });
    });

    it("uses the host open-block adapter when supplied", async () => {
        const openBlock = vi.fn().mockResolvedValue(undefined);
        const controller = new DefaultSiYuanContextController({
            request: vi.fn(),
            openBlock,
        });

        await controller.openBlock("block-9");

        expect(openBlock).toHaveBeenCalledWith("block-9");
    });
});
