import { describe, expect, it } from "vitest";
import {
    isWriteCapableVersion,
    parseVikunjaVersion,
} from "../../src/shared/vikunja-version.js";

describe("parseVikunjaVersion", () => {
    it("parses dotted versions with or without a leading v", () => {
        expect(parseVikunjaVersion("v2.5.0")).toEqual([2, 5, 0]);
        expect(parseVikunjaVersion("2.5.0")).toEqual([2, 5, 0]);
        expect(parseVikunjaVersion("v2.6.1")).toEqual([2, 6, 1]);
    });

    it("returns null for non-numeric or missing values", () => {
        expect(parseVikunjaVersion("dev")).toBeNull();
        expect(parseVikunjaVersion("")).toBeNull();
        expect(parseVikunjaVersion(undefined)).toBeNull();
        expect(parseVikunjaVersion("v2")).toBeNull();
    });
});

describe("isWriteCapableVersion", () => {
    it("allows the exact floor and anything newer", () => {
        expect(isWriteCapableVersion("v2.5.0")).toBe(true);
        expect(isWriteCapableVersion("v2.5.1")).toBe(true);
        expect(isWriteCapableVersion("v2.6.0")).toBe(true);
        expect(isWriteCapableVersion("v2.99.99")).toBe(true);
        expect(isWriteCapableVersion("v3.0.0")).toBe(false);
    });

    it("rejects older versions", () => {
        expect(isWriteCapableVersion("v2.4.0")).toBe(false);
        expect(isWriteCapableVersion("v2.4.9")).toBe(false);
        expect(isWriteCapableVersion("v1.9.9")).toBe(false);
    });

    it("trusts a local dev build and denies unknown values", () => {
        expect(isWriteCapableVersion("dev")).toBe(true);
        expect(isWriteCapableVersion("DEV")).toBe(true);
        expect(isWriteCapableVersion("devil")).toBe(false);
        expect(isWriteCapableVersion("")).toBe(false);
        expect(isWriteCapableVersion(undefined)).toBe(false);
        expect(isWriteCapableVersion("1.2")).toBe(false);
    });
});
