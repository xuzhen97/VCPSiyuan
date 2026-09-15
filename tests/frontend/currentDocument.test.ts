import { describe, expect, it } from "vitest";
import { createCurrentDocumentSource } from "../../src/frontend/context/currentDocument.js";

describe("createCurrentDocumentSource", () => {
    it("returns the first active editor root id", () => {
        const source = createCurrentDocumentSource(() => [
            {},
            { block: { rootID: "doc-42" } },
            { block: { rootID: "doc-ignored" } },
        ]);

        expect(source.getCurrentDocumentId()).toBe("doc-42");
    });

    it("returns null when no editor has a usable root id", () => {
        const source = createCurrentDocumentSource(() => [
            { block: {} },
            { block: { rootID: "  " } },
            {},
        ]);

        expect(source.getCurrentDocumentId()).toBeNull();
    });
});
