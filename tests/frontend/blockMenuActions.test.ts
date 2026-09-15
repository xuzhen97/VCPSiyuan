import { describe, expect, it, vi } from "vitest";
import { BlockLinkRepository } from "../../src/frontend/context/BlockLinkRepository.js";
import { createBlockMenuActions } from "../../src/frontend/context/blockMenuActions.js";
import { blockMenuWorkflowI18n } from "../helpers/pluginI18n.js";

describe("Block menu workflows", () => {
    it("opens creation with reliable summaries and links every selected block after creation", async () => {
        const attributes = new Map<string, string>();
        const context = {
            getBlockAttrs: vi.fn(async (blockId: string) => ({
                "custom-vikunja-task-links": attributes.get(blockId) ?? "",
            })),
            setBlockAttrs: vi.fn(
                async (blockId: string, attrs: Record<string, string>) => {
                    attributes.set(blockId, attrs["custom-vikunja-task-links"]);
                },
            ),
            getBlockSummary: vi.fn(async (blockId: string) => ({
                blockId,
                documentId: "doc-1",
                notebookId: "nb-1",
                title: blockId === "b1" ? "First block" : "Second block",
            })),
        };
        const index = {
            upsert: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn(),
        };
        const openCreateDialog = vi
            .fn()
            .mockImplementation(
                async (request: {
                    onCreated: (taskId: number) => Promise<void>;
                }) => request.onCreated(42),
            );
        const actions = createBlockMenuActions({
            context: context as never,
            links: new BlockLinkRepository(context as never),
            index,
            getProjectId: () => 7,
            promptTaskId: vi.fn(),
            notify: vi.fn(),
            openCreateDialog,
            openTask: vi.fn(),
            getTask: vi.fn(),
            i18n: blockMenuWorkflowI18n,
        });

        await actions.onCreate(["b1", "b2"]);

        expect(openCreateDialog).toHaveBeenCalledWith(
            expect.objectContaining({
                blockIds: ["b1", "b2"],
                projectId: 7,
                initialTitle: "First block",
            }),
        );
        expect(JSON.parse(attributes.get("b1")!)).toEqual({
            v: 1,
            taskIds: [42],
        });
        expect(JSON.parse(attributes.get("b2")!)).toEqual({
            v: 1,
            taskIds: [42],
        });
        expect(index.upsert).toHaveBeenCalledTimes(2);
    });

    it("reports the localized message when no Inbox project is configured", async () => {
        const notify = vi.fn();
        const openCreateDialog = vi.fn();
        const actions = createBlockMenuActions({
            context: {
                getBlockAttrs: vi.fn(),
                setBlockAttrs: vi.fn(),
                getBlockSummary: vi.fn(),
            } as never,
            links: new BlockLinkRepository({
                getBlockAttrs: vi.fn(),
                setBlockAttrs: vi.fn(),
            } as never),
            index: { upsert: vi.fn(), remove: vi.fn() },
            getProjectId: () => null,
            promptTaskId: vi.fn(),
            notify,
            openCreateDialog,
            openTask: vi.fn(),
            getTask: vi.fn(),
            i18n: blockMenuWorkflowI18n,
        });

        await actions.onCreate(["b1"]);

        expect(notify).toHaveBeenCalledWith(
            blockMenuWorkflowI18n.missingInboxProject,
        );
        expect(openCreateDialog).not.toHaveBeenCalled();
    });

    it("reports a safe notification when a selected Block action fails", async () => {
        const notify = vi.fn();
        const context = {
            getBlockAttrs: vi.fn(async () => ({
                "custom-vikunja-task-links": "",
            })),
            setBlockAttrs: vi.fn(async () => {
                throw new Error("Block write failed");
            }),
            getBlockSummary: vi.fn(async (blockId: string) => ({
                blockId,
                documentId: "doc-1",
                title: "Block",
            })),
        };
        const actions = createBlockMenuActions({
            context: context as never,
            links: new BlockLinkRepository(context as never),
            index: { upsert: vi.fn(), remove: vi.fn() },
            getProjectId: () => 7,
            promptTaskId: vi.fn().mockReturnValue("9"),
            notify,
            openCreateDialog: vi.fn(),
            openTask: vi.fn(),
            getTask: vi.fn().mockResolvedValue({
                ok: true,
                data: { value: { id: 9, title: "Existing" } },
            }),
            i18n: blockMenuWorkflowI18n,
        });

        await actions.onLink(["b1"]);

        expect(notify).toHaveBeenCalledWith(
            blockMenuWorkflowI18n.blockActionFailed,
        );
    });

    it("validates an existing task before linking and only unlinks memberships that exist", async () => {
        const attributes = new Map<string, string>([
            ["b1", '{"v":1,"taskIds":[9]}'],
        ]);
        const context = {
            getBlockAttrs: vi.fn(async (blockId: string) => ({
                "custom-vikunja-task-links": attributes.get(blockId) ?? "",
            })),
            setBlockAttrs: vi.fn(
                async (blockId: string, attrs: Record<string, string>) => {
                    attributes.set(blockId, attrs["custom-vikunja-task-links"]);
                },
            ),
            getBlockSummary: vi.fn(async (blockId: string) => ({
                blockId,
                documentId: "doc-1",
                title: "Block",
            })),
        };
        const controller = {
            call: vi.fn().mockResolvedValue({
                ok: true,
                data: { value: { id: 9, title: "Existing" } },
            }),
        };
        const promptTaskId = vi.fn().mockReturnValue("9");
        const actions = createBlockMenuActions({
            context: context as never,
            links: new BlockLinkRepository(context as never),
            index: {
                upsert: vi.fn(),
                remove: vi.fn().mockResolvedValue(undefined),
            },
            getProjectId: () => 7,
            promptTaskId,
            notify: vi.fn(),
            openCreateDialog: vi.fn(),
            openTask: vi.fn(),
            getTask: (taskId) =>
                controller.call("vikunja.tasks.get", { taskId }),
            i18n: blockMenuWorkflowI18n,
        });

        await actions.onLink(["b1"]);
        await actions.onUnlink(["b1"]);

        expect(controller.call).toHaveBeenCalledWith("vikunja.tasks.get", {
            taskId: 9,
        });
        expect(JSON.parse(attributes.get("b1")!)).toEqual({
            v: 1,
            taskIds: [],
        });
    });
});
