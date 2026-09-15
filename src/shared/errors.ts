export type PublicErrorCode =
    | "CONFIG_INVALID"
    | "SECRET_NOT_FOUND"
    | "UNAUTHORIZED"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "RATE_LIMITED"
    | "NETWORK_ERROR"
    | "TIMEOUT"
    | "LIMIT_EXCEEDED"
    | "PAYLOAD_TOO_LARGE"
    | "ATTACHMENTS_DISABLED"
    | "CONFLICT"
    | "VALIDATION_ERROR"
    | "REMOTE_ERROR"
    | "INVALID_RESPONSE"
    | "INTERNAL_ERROR";

export interface PublicError {
    code: PublicErrorCode;
    message: string;
    retryable: boolean;
    status?: number;
    fieldErrors?: Record<string, string>;
    action?: "retry" | "reload" | "review" | "configure";
}

export function publicError(
    code: PublicErrorCode,
    message = "",
    retryable = false,
    action?: PublicError["action"],
): PublicError {
    return {
        code,
        message,
        retryable,
        ...(action ? { action } : {}),
    };
}
