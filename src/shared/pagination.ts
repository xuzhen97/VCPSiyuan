export interface Page<T> {
    items: T[];
    total: number;
    page: number;
    perPage: number;
}

function positiveInteger(value: unknown, field: string): number {
    if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 1
    ) {
        throw new Error(`${field} must be a positive safe integer`);
    }
    return value;
}

function nonNegativeInteger(value: unknown, field: string): number {
    if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 0
    ) {
        throw new Error(`${field} must be a non-negative safe integer`);
    }
    return value;
}

export function parsePage<T>(
    value: unknown,
    parseItem: (item: unknown) => T,
): Page<T> {
    if (typeof value !== "object" || value === null) {
        throw new Error("Page response must be an object");
    }
    const raw = value as Record<string, unknown>;
    if (!Array.isArray(raw.items)) {
        throw new Error("Page response must contain items");
    }

    const perPageValue = raw.perPage ?? raw.per_page;
    const page = positiveInteger(raw.page, "page");
    const perPage = positiveInteger(perPageValue, "perPage");
    const total = nonNegativeInteger(raw.total, "total");

    return {
        items: raw.items.map(parseItem),
        total,
        page,
        perPage,
    };
}
