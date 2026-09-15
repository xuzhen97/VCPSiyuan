import { describe, expect, it, vi } from "vitest";
import { BlockLinkRepository } from "../../src/frontend/context/BlockLinkRepository.js";

describe("BlockLinkRepository", () => {
    it("links and unlinks with canonical read-modify-write and read-back verification", async () => {
        let value = JSON.stringify({ v: 1, taskIds: [12] });
        const context = {
            getBlockAttrs: vi.fn().mockImplementation(async () => ({
                "custom-vikunja-task-links": value,
            })),
            setBlockAttrs: vi
                .fn()
                .mockImplementation(
                    async (_blockId: string, attrs: Record<string, string>) => {
                        value = attrs["custom-vikunja-task-links"];
                    },
                ),
        };
        const repository = new BlockLinkRepository(context as never);
        await repository.link("block-1", 34);
        expect(JSON.parse(value)).toEqual({ v: 1, taskIds: [12, 34] });
        await repository.unlink("block-1", 12);
        expect(JSON.parse(value)).toEqual({ v: 1, taskIds: [34] });
    });

    it("uses the latest read so an unrelated concurrent link is preserved", async () => {
        let value = '{"v":1,"taskIds":[]}';
        let reads = 0;
        const context = {
            getBlockAttrs: vi.fn().mockImplementation(async () => {
                reads += 1;
                return {
                    "custom-vikunja-task-links":
                        reads === 2 ? '{"v":1,"taskIds":[99]}' : value,
                };
            }),
            setBlockAttrs: vi
                .fn()
                .mockImplementation(
                    async (_blockId: string, attrs: Record<string, string>) => {
                        value = attrs["custom-vikunja-task-links"];
                    },
                ),
        };
        await new BlockLinkRepository(context as never).link("block-1", 34);
        expect(JSON.parse(value)).toEqual({ v: 1, taskIds: [34, 99] });
    });

    it("reports a conflict when unlinking a task that is not currently linked", async () => {
        const context = {
            getBlockAttrs: vi.fn().mockResolvedValue({
                "custom-vikunja-task-links": '{"v":1,"taskIds":[12]}',
            }),
            setBlockAttrs: vi.fn(),
        };
        const repository = new BlockLinkRepository(context as never);

        await expect(repository.unlink("block-1", 34)).rejects.toMatchObject({
            code: "CONFLICT",
            action: "retry",
        });
        expect(context.setBlockAttrs).not.toHaveBeenCalled();
    });

    it("does not overwrite unknown versions and reports read-back conflict", async () => {
        const context = {
            getBlockAttrs: vi.fn().mockResolvedValue({
                "custom-vikunja-task-links": '{"v":2,"taskIds":[12]}',
            }),
            setBlockAttrs: vi.fn(),
        };
        const repository = new BlockLinkRepository(context as never);
        await expect(repository.link("block-1", 34)).rejects.toMatchObject({
            code: "INVALID_RESPONSE",
        });
        expect(context.setBlockAttrs).not.toHaveBeenCalled();

        let reads = 0;
        const conflictContext = {
            getBlockAttrs: vi.fn().mockImplementation(async () => ({
                "custom-vikunja-task-links":
                    reads++ === 0
                        ? '{"v":1,"taskIds":[]}'
                        : '{"v":1,"taskIds":[]}',
            })),
            setBlockAttrs: vi.fn(),
        };
        const conflict = new BlockLinkRepository(conflictContext as never);
        await expect(conflict.link("block-1", 34)).rejects.toMatchObject({
            code: "CONFLICT",
        });
    });
});
