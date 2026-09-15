import { describe, expect, it, vi } from "vitest";
import { createTaskSaveOnce } from "../../src/frontend/dialogs/taskCreateWorkflow.js";

describe("createTaskSaveOnce", () => {
    it("does not create a second task when the follow-up must be retried", async () => {
        const create = vi.fn().mockResolvedValue(42);
        const followUp = vi
            .fn()
            .mockRejectedValueOnce(new Error("link failed"))
            .mockResolvedValueOnce(undefined);
        const save = createTaskSaveOnce(create, followUp);

        await expect(save()).rejects.toThrow("link failed");
        await expect(save()).resolves.toBe(42);

        expect(create).toHaveBeenCalledTimes(1);
        expect(followUp).toHaveBeenNthCalledWith(1, 42);
        expect(followUp).toHaveBeenNthCalledWith(2, 42);
    });
});
