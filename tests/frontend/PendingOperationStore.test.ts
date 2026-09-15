import { describe, expect, it } from "vitest";
import { PendingOperationStore } from "../../src/frontend/persistence/PendingOperationStore.js";

describe("PendingOperationStore", () => {
    it("persists metadata-only recovery markers", async () => {
        let stored: unknown;
        const store = new PendingOperationStore({
            load: async () => stored,
            save: async (_name: string, value: unknown) => {
                stored = value;
            },
        });
        await store.add({
            kind: "attachment-upload",
            taskId: 1,
            localDraftRef: "file-1",
            fileName: "a.txt",
        });
        expect(JSON.stringify(stored)).not.toContain("bytes");
        expect(await store.list()).toHaveLength(1);
    });
});
