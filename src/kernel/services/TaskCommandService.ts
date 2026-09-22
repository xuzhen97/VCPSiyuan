import { RpcResult, VikunjaCredentials } from "../../shared/contracts.js";
import { publicError } from "../../shared/errors.js";
import {
    CreateTaskRequest,
    DeleteTaskRequest,
    GetTaskRequest,
    PatchTaskRequest,
} from "../../shared/rpc.js";
import { TaskPatch, TaskDetail, Versioned } from "../../shared/task.js";
import { TaskGateway } from "../vikunja/TaskGateway.js";
import { toServiceError } from "./serviceError.js";

export interface TaskUpdateRequest {
    taskId: number;
    patch: TaskPatch;
    expected?: { etag?: string; updatedAt?: string };
    labels?: { before: number[]; after: number[] };
    assignees?: { before: number[]; after: number[] };
}

/**
 * Vikunja v2.5.0 advertises `concurrent_writes: false` and stamps `updated` (and
 * the ETag derived from it) at one-second resolution. Conflict detection here is
 * therefore read-then-compare against that version token: it reliably blocks a
 * save that is at least one second stale, but two writes inside the same second
 * are indistinguishable to the server as well as to the client.
 */
export interface TaskCommandServiceOptions {
    writesAllowed:
        | boolean
        | ((credentials: VikunjaCredentials) => Promise<boolean>);
}

export class TaskCommandService {
    constructor(
        private readonly gateway: TaskGateway,
        private readonly options: TaskCommandServiceOptions,
    ) {}

    async get(
        credentials: VikunjaCredentials,
        request: GetTaskRequest,
    ): Promise<RpcResult<Versioned<TaskDetail>>> {
        if (!validId(request.taskId))
            return {
                ok: false,
                error: publicError(
                    "VALIDATION_ERROR",
                    "Task ID must be a positive safe integer",
                ),
            };
        try {
            return {
                ok: true,
                data: await this.gateway.get(credentials, request.taskId),
            };
        } catch (error) {
            return {
                ok: false,
                error: toServiceError(error, "Task load failed"),
            };
        }
    }

    async create(
        credentials: VikunjaCredentials,
        request: CreateTaskRequest,
    ): Promise<RpcResult<TaskDetail>> {
        if (!(await this.writesEnabled(credentials)))
            return {
                ok: false,
                error: publicError(
                    "FORBIDDEN",
                    "Task writes are disabled by the Vikunja server",
                ),
            };
        if (!validId(request.draft.projectId) || !request.draft.title.trim()) {
            return {
                ok: false,
                error: publicError(
                    "VALIDATION_ERROR",
                    "Task title and project are required",
                ),
            };
        }
        try {
            const created = await this.gateway.create(
                credentials,
                request.draft,
            );
            if (request.draft.labelIds.length > 0)
                await this.gateway.setLabels(
                    credentials,
                    created.id,
                    [],
                    request.draft.labelIds,
                );
            if (request.draft.assigneeIds.length > 0)
                await this.gateway.setAssignees(
                    credentials,
                    created.id,
                    [],
                    request.draft.assigneeIds,
                );
            return {
                ok: true,
                data: (await this.gateway.get(credentials, created.id)).value,
            };
        } catch (error) {
            return {
                ok: false,
                error: toServiceError(error, "Task creation failed"),
            };
        }
    }

    async update(
        credentials: VikunjaCredentials,
        request: PatchTaskRequest,
    ): Promise<RpcResult<TaskDetail>> {
        if (!(await this.writesEnabled(credentials))) {
            return {
                ok: false,
                error: publicError(
                    "FORBIDDEN",
                    "Task writes are disabled by the Vikunja server",
                ),
            };
        }
        if (!Number.isSafeInteger(request.taskId) || request.taskId <= 0) {
            return {
                ok: false,
                error: publicError(
                    "VALIDATION_ERROR",
                    "Task ID must be a positive safe integer",
                ),
            };
        }

        try {
            const current = await this.gateway.get(credentials, request.taskId);
            if (!matchesExpected(current, request.expected)) {
                return {
                    ok: false,
                    error: publicError(
                        "CONFLICT",
                        "Task changed remotely; reload before saving",
                        false,
                    ),
                };
            }

            let detail = current.value;
            if (Object.keys(request.patch).length > 0) {
                detail = await this.gateway.patchScalars(
                    credentials,
                    request.taskId,
                    request.patch,
                    request.expected,
                );
            }
            if (request.labels) {
                await this.gateway.setLabels(
                    credentials,
                    request.taskId,
                    request.labels.before,
                    request.labels.after,
                );
            }
            if (request.assignees) {
                await this.gateway.setAssignees(
                    credentials,
                    request.taskId,
                    request.assignees.before,
                    request.assignees.after,
                );
            }

            const refreshed = await this.gateway.get(
                credentials,
                request.taskId,
            );
            return { ok: true, data: refreshed.value ?? detail };
        } catch (error) {
            if (isPartialRelationError(error)) {
                try {
                    await this.gateway.get(credentials, request.taskId);
                } catch {
                    /* keep the original recovery error */
                }
            }
            return { ok: false, error: mapCommandError(error) };
        }
    }

    async delete(
        credentials: VikunjaCredentials,
        request: DeleteTaskRequest,
    ): Promise<RpcResult<void>> {
        if (!(await this.writesEnabled(credentials)))
            return {
                ok: false,
                error: publicError(
                    "FORBIDDEN",
                    "Task writes are disabled by the Vikunja server",
                ),
            };
        if (!validId(request.taskId))
            return {
                ok: false,
                error: publicError(
                    "VALIDATION_ERROR",
                    "Task ID must be a positive safe integer",
                ),
            };
        try {
            const current = await this.gateway.get(credentials, request.taskId);
            // Same stale-title guard as project/label deletion: a rename made
            // while the confirmation was open means the user reviewed other text.
            if (current.value.title !== request.expectedTitle)
                return {
                    ok: false,
                    error: publicError(
                        "CONFLICT",
                        "Task title changed; review before deleting",
                        false,
                        "review",
                    ),
                };
            await this.gateway.delete(credentials, request.taskId);
            return { ok: true, data: undefined };
        } catch (error) {
            return {
                ok: false,
                error: toServiceError(error, "Task deletion failed"),
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

function isPartialRelationError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        (error as { kind?: unknown }).kind === "partial-relation"
    );
}

function matchesExpected(
    current: Versioned<TaskDetail>,
    expected?: { etag?: string; updatedAt?: string },
): boolean {
    if (!expected) return true;
    if (expected.etag !== undefined && current.etag !== expected.etag)
        return false;
    if (
        expected.updatedAt !== undefined &&
        current.updatedAt !== expected.updatedAt
    )
        return false;
    return true;
}

function mapCommandError(error: unknown) {
    if (isPartialRelationError(error)) {
        return publicError(
            "REMOTE_ERROR",
            "Some task relations were not saved; retry the failed items",
            true,
            "retry",
        );
    }
    return toServiceError(error, "Task update failed");
}
