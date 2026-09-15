import { describe, expect, it } from "vitest";
import {
    parseBlockTaskLinks,
    serializeBlockTaskLinks,
} from "../../src/shared/block-link.js";

describe("Block task links", () => {
    it("parses, deduplicates, and sorts version 1 links", () => {
        expect(parseBlockTaskLinks('{"v":1,"taskIds":[34,12,34]}')).toEqual({
            v: 1,
            taskIds: [12, 34],
        });
        expect(parseBlockTaskLinks(null)).toEqual({ v: 1, taskIds: [] });
    });

    it("rejects unknown versions and unsafe IDs", () => {
        expect(() => parseBlockTaskLinks('{"v":2,"taskIds":[12]}')).toThrow(
            /version/i,
        );
        expect(() => serializeBlockTaskLinks([1, 0, 2])).toThrow(
            /positive safe integer/i,
        );
        expect(() =>
            serializeBlockTaskLinks([Number.MAX_SAFE_INTEGER + 1]),
        ).toThrow(/positive safe integer/i);
    });
});
