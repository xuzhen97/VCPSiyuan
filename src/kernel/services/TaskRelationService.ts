import { RpcResult, VikunjaCredentials } from "../../shared/contracts.js";
import { publicError } from "../../shared/errors.js";
import { TaskRelationRequest } from "../../shared/rpc.js";
import { TaskDetail } from "../../shared/task.js";
import { TaskGateway } from "../vikunja/TaskGateway.js";
import { toServiceError } from "./serviceError.js";

export interface TaskRelationServiceOptions {
    writesAllowed:
        | boolean
        | ((credentials: VikunjaCredentials) => Promise<boolean>);
}

export class TaskRelationService {
    constructor(
        private readonly gateway: TaskGateway,
        private readonly options: TaskRelationServiceOptions,
    ) {}

    async link(
        credentials: VikunjaCredentials,
        request: TaskRelationRequest,
    ): Promise<RpcResult<TaskDetail>> {
        return this.change(credentials, request, "link");
    }

    async unlink(
        credentials: VikunjaCredentials,
        request: TaskRelationRequest,
    ): Promise<RpcResult<TaskDetail>> {
        return this.change(credentials, request, "unlink");
    }

    private async change(
        credentials: VikunjaCredentials,
        request: TaskRelationRequest,
        operation: "link" | "unlink",
    ): Promise<RpcResult<TaskDetail>> {
        if (!validId(request.parentTaskId) || !validId(request.childTaskId))
            return {
                ok: false,
                error: publicError(
                    "VALIDATION_ERROR",
                    "Parent and child task IDs must be positive safe integers",
                ),
            };
        if (request.parentTaskId === request.childTaskId)
            return {
                ok: false,
                error: publicError(
                    "VALIDATION_ERROR",
                    "A task cannot be its own subtask",
                ),
            };
        if (!(await this.writesEnabled(credentials)))
            return {
                ok: false,
                error: publicError(
                    "FORBIDDEN",
                    "Task writes are disabled by the Vikunja server",
                ),
            };

        try {
            if (operation === "link")
                await this.gateway.linkChild(
                    credentials,
                    request.parentTaskId,
                    request.childTaskId,
                );
            else
                await this.gateway.unlinkChild(
                    credentials,
                    request.parentTaskId,
                    request.childTaskId,
                );
            const refreshed = await this.gateway.get(
                credentials,
                request.parentTaskId,
            );
            return { ok: true, data: refreshed.value };
        } catch (error) {
            return {
                ok: false,
                error: toServiceError(error, "Task relation update failed"),
            };
        }
    }

    private async writesEnabled(
        credentials: VikunjaCredentials,
    ): Promise<boolean> {
        return typeof this.options.writesAllowed === "function"
            ? this.options.writesAllowed(credentials)
            : this.options.writesAllowed;
    }
}

function validId(value: number): boolean {
    return Number.isSafeInteger(value) && value > 0;
}
