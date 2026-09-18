import {
    ConnectionInfo,
    RpcResult,
    VikunjaCredentials,
} from "../../shared/contracts.js";
import { publicError } from "../../shared/errors.js";
import { isWriteCapableVersion } from "../../shared/vikunja-version.js";
import { HttpTransportError } from "../http/HttpClient.js";
import { VikunjaV2Client } from "../vikunja/VikunjaV2Client.js";

const PLUGIN_ATTACHMENT_LIMIT_BYTES = 30 * 1024 * 1024;

export interface ConnectionServiceOptions {
    taskPatch: boolean;
    projectPermissions: boolean;
}

export class ConnectionService {
    constructor(
        private readonly client: VikunjaV2Client,
        private readonly options: ConnectionServiceOptions,
    ) {}

    async test(
        credentials: VikunjaCredentials,
        _request?: { timeZone?: string },
    ): Promise<RpcResult<ConnectionInfo>> {
        void _request;
        try {
            const origin = credentials.origin;
            if (!origin)
                return {
                    ok: false,
                    error: publicError(
                        "CONFIG_INVALID",
                        "Vikunja instance origin is required",
                    ),
                };
            const response = await this.client.requestJson<
                Record<string, unknown>
            >(credentials, "GET", "/info");
            // /info is public on Vikunja, so it proves reachability but not
            // that the configured token can read or write user data.
            await this.client.requestJson<Record<string, unknown>>(
                credentials,
                "GET",
                "/user",
            );
            const serverVersion =
                typeof response.data.version === "string"
                    ? response.data.version
                    : undefined;
            const apiVersion =
                typeof response.data.api_version === "string"
                    ? response.data.api_version
                    : "v2";
            if (apiVersion !== "v2") {
                return {
                    ok: false,
                    error: publicError(
                        "NOT_FOUND",
                        "Vikunja API v2 is unavailable",
                    ),
                };
            }
            const maxFileSize =
                typeof response.data.max_file_size === "string"
                    ? response.data.max_file_size
                    : "0";
            const effectiveAttachmentLimitBytes = Math.min(
                PLUGIN_ATTACHMENT_LIMIT_BYTES,
                parseFileSize(maxFileSize) ?? PLUGIN_ATTACHMENT_LIMIT_BYTES,
            );
            const attachments = response.data.task_attachments_enabled === true;
            const writesAllowed =
                isWriteCapableVersion(serverVersion) &&
                this.options.taskPatch;
            return {
                ok: true,
                data: {
                    connected: true,
                    version: serverVersion,
                    apiVersion: "v2",
                    serverVersion,
                    attachments,
                    maxFileSize,
                    effectiveAttachmentLimitBytes,
                    taskPatch: this.options.taskPatch,
                    projectPermissions: this.options.projectPermissions,
                    writesAllowed,
                },
            };
        } catch (error) {
            return { ok: false, error: mapConnectionError(error) };
        }
    }
}

function parseFileSize(value: string): number | null {
    const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i);
    if (!match) return null;
    const amount = Number(match[1]);
    const unit = match[2].toUpperCase();
    const multiplier =
        unit === "GB"
            ? 1024 ** 3
            : unit === "MB"
              ? 1024 ** 2
              : unit === "KB"
                ? 1024
                : 1;
    const result = Math.floor(amount * multiplier);
    return Number.isSafeInteger(result) ? result : null;
}

function mapConnectionError(error: unknown) {
    if (error instanceof HttpTransportError) {
        if (error.kind === "network")
            return publicError(
                "NETWORK_ERROR",
                "Unable to connect to Vikunja server",
                true,
            );
        if (error.status === 401)
            return publicError("UNAUTHORIZED", "Vikunja authentication failed");
        if (error.status === 403)
            return publicError("FORBIDDEN", "Permission denied by Vikunja");
        if (error.status === 404)
            return publicError("NOT_FOUND", "Vikunja v2 endpoint not found");
        if (error.kind === "invalid-response")
            return publicError(
                "INVALID_RESPONSE",
                "Vikunja returned an invalid response",
            );
    }
    return publicError("REMOTE_ERROR", "Vikunja connection test failed", true);
}
