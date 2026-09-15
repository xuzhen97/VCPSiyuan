import { publicError } from "../../shared/errors.js";
import { HttpTransportError } from "../http/HttpClient.js";

export function toServiceError(error: unknown, fallback: string) {
    if (error instanceof HttpTransportError) {
        if (error.kind === "network")
            return publicError(
                "NETWORK_ERROR",
                "Unable to connect to Vikunja server",
                true,
                "retry",
            );
        if (error.kind === "too-large")
            return publicError(
                "PAYLOAD_TOO_LARGE",
                "The response exceeds the allowed size",
                false,
                "review",
            );
        if (error.status === 401)
            return publicError("UNAUTHORIZED", "Vikunja authentication failed");
        if (error.status === 403)
            return publicError("FORBIDDEN", "Permission denied by Vikunja");
        if (error.status === 404)
            return publicError("NOT_FOUND", "Vikunja resource was not found");
        if (error.status === 409)
            return publicError(
                "CONFLICT",
                "Vikunja reported a conflict",
                false,
                "review",
            );
        if (error.status === 413)
            return publicError("PAYLOAD_TOO_LARGE", "The payload is too large");
        if (error.status === 422)
            return publicError(
                "VALIDATION_ERROR",
                "Vikunja rejected the request",
            );
        if (error.status === 429)
            return publicError(
                "RATE_LIMITED",
                "Vikunja rate limit reached",
                true,
                "retry",
            );
        if (error.status !== undefined && error.status >= 500)
            return publicError(
                "REMOTE_ERROR",
                "Vikunja server error",
                true,
                "retry",
            );
        if (error.kind === "invalid-response")
            return publicError(
                "INVALID_RESPONSE",
                "Vikunja returned an invalid response",
            );
    }
    if (isPublicError(error)) return error;
    return publicError("REMOTE_ERROR", fallback, true, "retry");
}

function isPublicError(
    value: unknown,
): value is ReturnType<typeof publicError> {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as { code?: unknown }).code === "string" &&
        typeof (value as { message?: unknown }).message === "string" &&
        typeof (value as { retryable?: unknown }).retryable === "boolean"
    );
}
