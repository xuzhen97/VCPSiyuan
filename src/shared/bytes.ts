/**
 * Byte helpers shared by the frontend and the Kernel plugin.
 *
 * Neither leg of the plugin RPC preserves a typed array: the frontend -> Kernel
 * leg is JSON-RPC, so a `Uint8Array` arrives as `{"0":104,...}`; the Kernel ->
 * frontend leg marshals `[]byte` through Go's JSON encoder, which yields a
 * Base64 string. `toBytes` accepts every shape that has been observed so the
 * callers never depend on which side they are on.
 *
 * Base64 is hand-rolled on purpose: the Kernel runs plugin code in goja, which
 * exposes ECMAScript built-ins only -- there is no btoa, atob or TextEncoder.
 */
const BASE64_ALPHABET =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function encodeBase64(bytes: Uint8Array): string {
    let result = "";
    for (let index = 0; index < bytes.length; index += 3) {
        const first = bytes[index];
        const hasSecond = index + 1 < bytes.length;
        const hasThird = index + 2 < bytes.length;
        const second = hasSecond ? bytes[index + 1] : 0;
        const third = hasThird ? bytes[index + 2] : 0;
        result += BASE64_ALPHABET[first >> 2];
        result += BASE64_ALPHABET[((first & 0x03) << 4) | (second >> 4)];
        result += hasSecond
            ? BASE64_ALPHABET[((second & 0x0f) << 2) | (third >> 6)]
            : "=";
        result += hasThird ? BASE64_ALPHABET[third & 0x3f] : "=";
    }
    return result;
}

export function decodeBase64(value: string): Uint8Array {
    const compact = value.replace(/[^A-Za-z0-9+/]/g, "");
    const result = new Uint8Array(Math.floor((compact.length * 3) / 4));
    let buffer = 0;
    let bits = 0;
    let offset = 0;
    for (let index = 0; index < compact.length; index += 1) {
        const digit = BASE64_ALPHABET.indexOf(compact[index]);
        if (digit < 0) throw new Error("Invalid Base64");
        buffer = (buffer << 6) | digit;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            result[offset] = (buffer >> bits) & 0xff;
            offset += 1;
        }
    }
    return result.subarray(0, offset);
}

/** Rebuilds bytes that crossed the plugin RPC into a real `Uint8Array`. */
export function toBytes(value: unknown): Uint8Array {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (Array.isArray(value)) return new Uint8Array(value.map(Number));
    // Kernel -> frontend: Go marshals []byte to a Base64 string.
    if (typeof value === "string") return decodeBase64(value);
    if (value && typeof value === "object") {
        // frontend -> Kernel: JSON-RPC turns a Uint8Array into {"0":..,"1":..}.
        const source = value as Record<string, unknown>;
        const keys = Object.keys(source).filter((key) =>
            Number.isSafeInteger(Number(key)),
        );
        const bytes = new Uint8Array(keys.length);
        for (const key of keys) {
            bytes[Number(key)] = Number(source[key]) & 0xff;
        }
        return bytes;
    }
    return new Uint8Array(0);
}
