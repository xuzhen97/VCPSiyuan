import { Page } from "../../shared/pagination.js";
import { RpcResult, VikunjaCredentials } from "../../shared/contracts.js";
import { TaskQuery, TaskSummary } from "../../shared/task.js";
import { publicError } from "../../shared/errors.js";
import { TaskGateway } from "../vikunja/TaskGateway.js";

export class TaskQueryService {
    constructor(private readonly gateway: TaskGateway) {}

    async query(
        credentials: VikunjaCredentials,
        request: TaskQuery,
    ): Promise<RpcResult<Page<TaskSummary>>> {
        try {
            if (
                !Number.isSafeInteger(request.page) ||
                request.page < 1 ||
                !Number.isSafeInteger(request.perPage) ||
                request.perPage < 1
            ) {
                return {
                    ok: false,
                    error: publicError(
                        "VALIDATION_ERROR",
                        "Page values must be positive safe integers",
                    ),
                };
            }
            if (
                !validIds(request.projectIds) ||
                !validIds(request.labelIds)
            ) {
                return {
                    ok: false,
                    error: publicError(
                        "VALIDATION_ERROR",
                        "Task filter IDs must be positive safe integers",
                    ),
                };
            }
            if (request.view === "inbox" && request.projectIds.length > 0) {
                return {
                    ok: false,
                    error: publicError(
                        "VALIDATION_ERROR",
                        "Inbox does not accept project filters",
                    ),
                };
            }
            if (
                request.view === "inbox" &&
                (!request.inboxProjectId || request.inboxProjectId <= 0)
            ) {
                return {
                    ok: false,
                    error: publicError(
                        "CONFIG_INVALID",
                        "Inbox project is not configured",
                    ),
                };
            }
            return {
                ok: true,
                data: (await this.gateway.query(credentials, request)).data,
            };
        } catch (error) {
            return {
                ok: false,
                error: publicError(
                    "REMOTE_ERROR",
                    error instanceof Error
                        ? error.message
                        : "Task query failed",
                    true,
                ),
            };
        }
    }
}

function validIds(ids: number[]): boolean {
    return ids.every((id) => Number.isSafeInteger(id) && id > 0);
}
