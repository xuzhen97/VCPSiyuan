import { describe, expect, it } from "vitest";
import {
    decodeBase64,
    encodeBase64,
    toBytes,
} from "../../src/shared/bytes.js";

describe("shared bytes", () => {
    it("round-trips Base64 without btoa/atob", () => {
        // goja (the Kernel runtime) has neither, so both are hand-rolled.
        const bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
        expect([...decodeBase64(encodeBase64(bytes))]).toEqual([...bytes]);
        expect(encodeBase64(new TextEncoder().encode("hello"))).toBe(
            "aGVsbG8=",
        );
    });

    it("throws on invalid Base64 instead of returning garbage", () => {
        // @ts-expect-error deliberately malformed input
        expect(() => decodeBase64(undefined)).toThrow();
    });

    it("rebuilds the JSON-RPC object form the Kernel receives", () => {
        // frontend -> Kernel: JSON-RPC turns a Uint8Array into numeric keys.
        const wire = JSON.parse(
            JSON.stringify(new Uint8Array([104, 105])),
        ) as unknown;
        expect([...toBytes(wire)]).toEqual([104, 105]);
    });

    it("rebuilds the Base64 form the frontend receives", () => {
        // Kernel -> frontend: Go marshals []byte to a Base64 string.
        expect([...toBytes("aGk=")]).toEqual([104, 105]);
    });

    it("passes through real byte-like values", () => {
        const typed = new Uint8Array([1, 2, 3]);
        expect(toBytes(typed)).toBe(typed);
        expect([...toBytes([4, 5])]).toEqual([4, 5]);
        const buffer = new ArrayBuffer(2);
        new Uint8Array(buffer).set([9, 8]);
        expect([...toBytes(buffer)]).toEqual([9, 8]);
        expect([...toBytes(null)]).toEqual([]);
    });
});
