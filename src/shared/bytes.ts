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

// 255 marks "not a Base64 digit". Decoding scans a string per character, so a
// 256-entry table keeps it O(n) instead of an `indexOf` rescan per character.
const BASE64_DIGITS = (() => {
    const table = new Uint8Array(256);
    table.fill(255);
    for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
        table[BASE64_ALPHABET.charCodeAt(index)] = index;
    }
    return table;
})();

export function encodeBase64(bytes: Uint8Array): string {
    // Collect 4-character groups and join once. Appending with `result += c`
    // inside the loop copies the entire string every iteration: V8 papers over
    // that with rope strings, but the Kernel runs in goja, so a 1.3 MB
    // attachment grew quadratically and stalled the upload for minutes.
    const groups = new Array<string>(Math.ceil(bytes.length / 3));
    let offset = 0;
    for (let index = 0; index < bytes.length; index += 3) {
        const first = bytes[index];
        const hasSecond = index + 1 < bytes.length;
        const hasThird = index + 2 < bytes.length;
        const second = hasSecond ? bytes[index + 1] : 0;
        const third = hasThird ? bytes[index + 2] : 0;
        groups[offset] =
            BASE64_ALPHABET[first >> 2] +
            BASE64_ALPHABET[((first & 0x03) << 4) | (second >> 4)] +
            (hasSecond
                ? BASE64_ALPHABET[((second & 0x0f) << 2) | (third >> 6)]
                : "=") +
            (hasThird ? BASE64_ALPHABET[third & 0x3f] : "=");
        offset += 1;
    }
    return groups.join("");
}

export function decodeBase64(value: string): Uint8Array {
    const compact = value.replace(/[^A-Za-z0-9+/]/g, "");
    const result = new Uint8Array(Math.floor((compact.length * 3) / 4));
    let buffer = 0;
    let bits = 0;
    let offset = 0;
    for (let index = 0; index < compact.length; index += 1) {
        const digit = BASE64_DIGITS[compact.charCodeAt(index)];
        if (digit > 63) throw new Error("Invalid Base64");
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
