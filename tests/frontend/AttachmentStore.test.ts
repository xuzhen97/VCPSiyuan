// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { AttachmentStore } from "../../src/frontend/stores/AttachmentStore.js";

describe("AttachmentStore", () => {
    it("rejects files above the effective limit before reading bytes", async () => {
        const read = vi.fn();
        const file = new File([new Uint8Array([1])], "large.bin", {
            type: "application/octet-stream",
        });
        Object.defineProperty(file, "size", { value: 31 * 1024 * 1024 });
        Object.defineProperty(file, "arrayBuffer", { value: read });
        const controller = { call: vi.fn() };
        const store = new AttachmentStore({
            controller: controller as never,
            effectiveLimitBytes: 30 * 1024 * 1024,
        });
        store.queue([file]);
        await store.upload(1);
        expect(read).not.toHaveBeenCalled();
        expect(controller.call).not.toHaveBeenCalled();
        expect(store.getItems()[0].state).toBe("failed");
    });

    it("keeps successful files and retries only failed files", async () => {
        const first = new File(["a"], "a.txt", { type: "text/plain" });
        const second = new File(["b"], "b.txt", { type: "text/plain" });
        Object.defineProperty(first, "arrayBuffer", {
            value: async () => new TextEncoder().encode("a").buffer,
        });
        Object.defineProperty(second, "arrayBuffer", {
            value: async () => new TextEncoder().encode("b").buffer,
        });
        const controller = {
            call: vi
                .fn()
                .mockResolvedValueOnce({
                    ok: true,
                    data: {
                        succeeded: [
                            {
                                id: 1,
                                name: "a.txt",
                                size: 1,
                                mimeType: "text/plain",
                            },
                        ],
                        failed: [
                            {
                                clientFileId: "file-2",
                                fileName: "b.txt",
                                code: "TEMP",
                                message: "retry",
                                retryable: true,
                            },
                        ],
                    },
                })
                .mockResolvedValueOnce({
                    ok: true,
                    data: {
                        succeeded: [
                            {
                                id: 2,
                                name: "b.txt",
                                size: 1,
                                mimeType: "text/plain",
                            },
                        ],
                        failed: [],
                    },
                }),
        };
        const store = new AttachmentStore({
            controller: controller as never,
            effectiveLimitBytes: 30 * 1024 * 1024,
        });
        store.queue([first, second]);
        await store.upload(10);
        expect(
            store.getItems().filter((item) => item.state === "succeeded"),
        ).toHaveLength(1);
        expect(
            store.getItems().filter((item) => item.state === "failed"),
        ).toHaveLength(1);
        await store.retryFailed(10);
        expect(controller.call).toHaveBeenCalledTimes(2);
        expect(controller.call.mock.calls[1][1].files).toHaveLength(1);
        expect(
            store.getItems().every((item) => item.state === "succeeded"),
        ).toBe(true);
    });
});
