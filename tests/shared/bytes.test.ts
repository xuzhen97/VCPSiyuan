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

    it("round-trips payloads large enough to expose quadratic encoding", () => {
        // A 1.3 MB attachment hung for minutes because `result +=` copies the
        // whole string per character in goja (the Kernel runtime). Sizes here
        // are deliberately not multiples of three, so the tail padding stays
        // covered at every scale.
        for (const size of [1, 2, 3, 4, 65536, 1300001]) {
            const bytes = new Uint8Array(size);
            for (let index = 0; index < size; index += 1) {
                bytes[index] = (index * 31) & 0xff;
            }
            const encoded = encodeBase64(bytes);
            expect(encoded.length).toBe(Math.ceil(size / 3) * 4);
            const decoded = decodeBase64(encoded);
            expect(decoded.byteLength).toBe(size);
            let mismatch = -1;
            for (let index = 0; index < size; index += 1) {
                if (decoded[index] !== bytes[index]) {
                    mismatch = index;
                    break;
                }
            }
            expect(mismatch).toBe(-1);
        }
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
