import { UserRef } from "../../../shared/task.js";
import { HttpTransportError } from "../../http/HttpClient.js";

export function mapUser(value: unknown): UserRef {
    if (typeof value !== "object" || value === null)
        throw new HttpTransportError(
            "invalid-response",
            "User must be an object",
        );
    const raw = value as Record<string, unknown>;
    const parsedId = typeof raw.id === "number" ? raw.id : Number(raw.id);
    if (!Number.isSafeInteger(parsedId) || parsedId <= 0)
        throw new HttpTransportError(
            "invalid-response",
            "User id must be a positive safe integer",
        );
    const username = typeof raw.username === "string" ? raw.username : "";
    return {
        id: parsedId,
        username,
        displayName: typeof raw.name === "string" ? raw.name : username,
        ...(typeof raw.avatar_url === "string"
            ? { avatarUrl: raw.avatar_url }
            : {}),
    };
}
