export interface BlockTaskLinksV1 {
    v: 1;
    taskIds: number[];
}

function isPositiveSafeInteger(value: unknown): value is number {
    return (
        typeof value === "number" && Number.isSafeInteger(value) && value > 0
    );
}

function canonicalTaskIds(value: unknown): number[] {
    if (!Array.isArray(value) || !value.every(isPositiveSafeInteger)) {
        throw new Error("taskIds must contain only positive safe integers");
    }
    return [...new Set(value)].sort((a, b) => a - b);
}

export function parseBlockTaskLinks(
    value: string | null | undefined,
): BlockTaskLinksV1 {
    if (value === null || value === undefined || value.trim() === "") {
        return { v: 1, taskIds: [] };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new Error("Block task links must be valid JSON");
    }

    if (typeof parsed !== "object" || parsed === null) {
        throw new Error("Block task links must be an object");
    }
    const raw = parsed as Record<string, unknown>;
    if (raw.v !== 1) {
        throw new Error("Unsupported Block task links version");
    }

    return { v: 1, taskIds: canonicalTaskIds(raw.taskIds) };
}

export function serializeBlockTaskLinks(taskIds: number[]): string {
    return JSON.stringify({ v: 1, taskIds: canonicalTaskIds(taskIds) });
}
