import { Project } from "../../../shared/project.js";
import { HttpTransportError } from "../../http/HttpClient.js";
import { decodePermission } from "./permission.js";

function object(value: unknown): Record<string, unknown> {
    if (typeof value !== "object" || value === null) {
        throw new HttpTransportError(
            "invalid-response",
            "Project must be an object",
        );
    }
    return value as Record<string, unknown>;
}

function positiveId(value: unknown): number {
    const id = typeof value === "number" ? value : Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new HttpTransportError(
            "invalid-response",
            "Project id must be a positive safe integer",
        );
    }
    return id;
}

export function mapProject(value: unknown): Project {
    const raw = object(value);
    const title = typeof raw.title === "string" ? raw.title : "";
    if (!title.trim())
        throw new HttpTransportError(
            "invalid-response",
            "Project title is required",
        );
    const color = pickColor(raw);
    return {
        id: positiveId(raw.id),
        title,
        descriptionMarkdown:
            typeof raw.description === "string" ? raw.description : "",
        color,
        parentProjectId: optionalId(raw.parent_project_id),
        archived: raw.is_archived === true || raw.archived === true,
        maxPermission: decodePermission(raw.max_permission),
        parent: parentRef(raw.parent_project),
    };
}

/** Vikunja reports "no parent" as `0`, not `null`. */
function optionalId(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
    return parsed;
}

/** Vikunja uses an empty string to mean "no colour". */
function pickColor(raw: Record<string, unknown>): string | null {
    const value =
        typeof raw.hex_color === "string"
            ? raw.hex_color
            : typeof raw.color === "string"
              ? raw.color
              : null;
    if (value === null || value.trim() === "") return null;
    return value;
}

function parentRef(value: unknown): Project["parent"] {
    if (typeof value !== "object" || value === null) return null;
    const raw = value as Record<string, unknown>;
    const id = optionalId(raw.id);
    if (id === null) return null;
    return { id, title: typeof raw.title === "string" ? raw.title : "" };
}
