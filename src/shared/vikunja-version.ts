type Triple = [number, number, number];

/**
 * Parse a Vikunja server version string such as "v2.5.0" or "2.6.1" into a
 * [major, minor, patch] triple. Returns null when the value is not a plain
 * three-part numeric version (e.g. the "dev" marker of a local build).
 */
export function parseVikunjaVersion(
    value: string | undefined,
): Triple | null {
    if (typeof value !== "string") return null;
    const match = value
        .trim()
        .replace(/^v/i, "")
        .match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// Task/project/label write semantics were validated against Vikunja v2.5.0;
// anything at or above this floor is accepted so minor bumps keep working.
const MINIMUM_WRITE_VERSION: Triple = [2, 5, 0];

function compareTriple(a: Triple, b: Triple): number {
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    }
    return 0;
}

/**
 * Whether a connected Vikunja is new enough to allow task/project/label writes.
 * A local, non-release build reports the "dev" marker and is trusted because you
 * only ever reach it against a server you built and control yourself.
 */
export function isWriteCapableVersion(
    value: string | undefined,
): boolean {
    if (typeof value === "string" && value.trim().toLowerCase() === "dev") {
        return true;
    }
    const parsed = parseVikunjaVersion(value);
    if (!parsed) return false;
    return compareTriple(parsed, MINIMUM_WRITE_VERSION) >= 0;
}
