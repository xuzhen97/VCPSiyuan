import {
    ConnectionInfo,
    TaskSummary,
    VikunjaCredentials,
} from "../../shared/contracts.js";
import { HttpClient, HttpTransportError } from "../http/HttpClient.js";
import { VikunjaV2Client } from "./VikunjaV2Client.js";
import { mapTaskSummary } from "./mappers/taskMapper.js";

/**
 * Compatibility facade retained for callers that have not moved to the
 * resource services yet. It is V2-only and deliberately does not implement
 * the former /user or array-shaped V1 contract.
 */
export class VikunjaGateway {
    private readonly client: VikunjaV2Client;

    constructor(http: HttpClient) {
        this.client = new VikunjaV2Client(http);
    }

    async testConnection(
        credentials: VikunjaCredentials,
    ): Promise<ConnectionInfo> {
        const response = await this.client.requestJson<Record<string, unknown>>(
            credentials,
            "GET",
            "/info",
        );
        const version =
            typeof response.data.version === "string"
                ? response.data.version
                : undefined;
        return {
            connected: true,
            version,
            apiVersion: "v2",
            serverVersion: version,
            attachments: response.data.task_attachments_enabled === true,
            maxFileSize:
                typeof response.data.max_file_size === "string"
                    ? response.data.max_file_size
                    : "0",
            taskPatch: true,
            projectPermissions: true,
            writesAllowed: version === "v2.5.0",
        };
    }

    async listOpenTasks(
        credentials: VikunjaCredentials,
    ): Promise<TaskSummary[]> {
        const response = await this.client.requestPage(
            credentials,
            "/tasks",
            {
                page: 1,
                per_page: 50,
                filter: "done = false",
                filter_timezone: "UTC",
                format: "markdown",
            },
            mapTaskSummary,
        );
        return response.data.items;
    }
}

export function isVikunjaTransportError(
    error: unknown,
): error is HttpTransportError {
    return error instanceof HttpTransportError;
}
