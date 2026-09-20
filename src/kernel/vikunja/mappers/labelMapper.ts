import { Label } from "../../../shared/label.js";
import { HttpTransportError } from "../../http/HttpClient.js";
import { decodePermission } from "./permission.js";

function object(value: unknown): Record<string, unknown> {
    if (typeof value !== "object" || value === null) {
        throw new HttpTransportError(
            "invalid-response",
            "Label must be an object",
        );
    }
    return value as Record<string, unknown>;
}

function positiveId(value: unknown): number {
    const id = typeof value === "number" ? value : Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new HttpTransportError(
            "invalid-response",
            "Label id must be a positive safe integer",
        );
    }
    return id;
}

export function mapLabel(value: unknown): Label {
    const raw = object(value);
    const title = typeof raw.title === "string" ? raw.title : "";
    if (!title.trim())
        throw new HttpTransportError(
            "invalid-response",
            "Label title is required",
        );
    const color =
        typeof raw.hex_color === "string"
            ? raw.hex_color
            : typeof raw.color === "string"
              ? raw.color
              : null;
    return {
        id: positiveId(raw.id),
        title,
        descriptionMarkdown:
            typeof raw.description === "string" ? raw.description : "",
        color: color === null || color.trim() === "" ? null : color,
        // Vikunja only reports `max_permission` when a single label is read; the
        // list endpoint omits it. Labels are user-scoped and the server enforces
        // writes, so an unreported permission must not disable every row (which
        // made the whole label page read-only).
        maxPermission:
            raw.max_permission === undefined || raw.max_permission === null
                ? "write"
                : decodePermission(raw.max_permission),
        usageCount:
            typeof raw.usage_count === "number" ? raw.usage_count : undefined,
    };
}
