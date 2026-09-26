import { Page } from "../../shared/pagination.js";
import {
    TaskDetail,
    TaskDraft,
    TaskPatch,
    TaskQuery,
    TaskSearchQuery,
    TaskSummary,
    Versioned,
    repeatToWire,
} from "../../shared/task.js";
import { VikunjaCredentials } from "../../shared/contracts.js";
import { HttpTransportError } from "../http/HttpClient.js";
import { VikunjaV2Client } from "./VikunjaV2Client.js";
import { mapTaskDetail, mapTaskSummary } from "./mappers/taskMapper.js";

export interface PartialRelationError {
    kind: "partial-relation";
    completedIds: number[];
    failedId: number;
    cause: unknown;
}

export class TaskGateway {
    constructor(private readonly client: VikunjaV2Client) {}

    async query(
        credentials: VikunjaCredentials,
        query: TaskQuery,
    ): Promise<{ data: Page<TaskSummary> }> {
        const base: Record<string, string | number | string[] | undefined> = {
            page: query.page,
            per_page: query.perPage,
            filter_timezone: query.timeZone,
            // Vikunja requires repeated parameters here; "a,b" is rejected with
            // HTTP 400 by the v2 task collection endpoint.
            sort_by: ["due_date", "priority"],
            order_by: ["desc", "desc"],
            filter: buildTaskFilter(query) || undefined,
            format: "markdown",
        };
        const path =
            query.view === "inbox"
                ? `/projects/${this.assertId(query.inboxProjectId, "inboxProjectId")}/tasks`
                : "/tasks";
        const response = await this.client.requestPage(
            credentials,
            path,
            base,
            mapTaskSummary,
        );
        return { data: response.data };
    }

    async search(
        credentials: VikunjaCredentials,
        query: TaskSearchQuery,
    ): Promise<Page<TaskSummary>> {
        const response = await this.client.requestPage(
            credentials,
            "/tasks",
            {
                s: query.query,
                page: query.page,
                per_page: query.perPage,
                format: "markdown",
            },
            mapTaskSummary,
        );
        return response.data;
    }

    async linkChild(
        credentials: VikunjaCredentials,
        parentTaskId: number,
        childTaskId: number,
    ): Promise<void> {
        this.assertId(parentTaskId, "parentTaskId");
        this.assertId(childTaskId, "childTaskId");
        if (parentTaskId === childTaskId)
            throw new HttpTransportError(
                "invalid-response",
                "A task cannot be its own subtask",
            );
        await this.client.requestJson<void>(
            credentials,
            "POST",
            `/tasks/${parentTaskId}/relations`,
            {
                body: {
                    kind: "json",
                    value: {
                        other_task_id: childTaskId,
                        relation_kind: "subtask",
                    },
                },
                responseMode: "empty",
            },
        );
    }

    async unlinkChild(
        credentials: VikunjaCredentials,
        parentTaskId: number,
        childTaskId: number,
    ): Promise<void> {
        this.assertId(parentTaskId, "parentTaskId");
        this.assertId(childTaskId, "childTaskId");
        if (parentTaskId === childTaskId)
            throw new HttpTransportError(
                "invalid-response",
                "A task cannot be its own subtask",
            );
        await this.client.requestJson<void>(
            credentials,
            "DELETE",
            `/tasks/${parentTaskId}/relations/subtask/${childTaskId}`,
            { responseMode: "empty" },
        );
    }

    async get(
        credentials: VikunjaCredentials,
        taskId: number,
    ): Promise<Versioned<TaskDetail>> {
        this.assertId(taskId, "taskId");
        const response = await this.client.requestJson<unknown>(
            credentials,
            "GET",
            `/tasks/${taskId}`,
            {
                query: { format: "markdown" },
            },
        );
        const value = mapTaskDetail(response.data);
        // The ETag travels in a header, not the body, but it is the only
        // fine-grained concurrency token Vikunja offers (`updated` has second
        // granularity). Embed it on the detail so callers that only receive the
        // mapped value can still send it back as the expected version.
        const etag = response.headers.etag?.[0];
        if (etag) value.etag = etag;
        return {
            value,
            etag,
            updatedAt: value.updatedAt ?? "",
        };
    }

    async create(
        credentials: VikunjaCredentials,
        draft: TaskDraft,
    ): Promise<TaskDetail> {
        this.assertId(draft.projectId, "projectId");
        const response = await this.client.requestJson<unknown>(
            credentials,
            "POST",
            `/projects/${draft.projectId}/tasks`,
            {
                query: { format: "markdown" },
                body: { kind: "json", value: draftToWire(draft) },
            },
        );
        return mapTaskDetail(response.data);
    }

    async patchScalars(
        credentials: VikunjaCredentials,
        taskId: number,
        patch: TaskPatch,
        version?: { etag?: string; updatedAt?: string },
    ): Promise<TaskDetail> {
        this.assertId(taskId, "taskId");
        const headers: Record<string, string> = {};
        if (version?.etag) headers["If-Match"] = version.etag;
        const response = await this.client.requestJson<unknown>(
            credentials,
            "PATCH",
            `/tasks/${taskId}`,
            {
                query: { format: "markdown" },
                headers,
                body: { kind: "json", value: patchToWire(patch) },
            },
        );
        // Vikunja's AutoPatch answers a patch that changes nothing with
        // 304 Not Modified and no body, which is a successful no-op.
        if (response.status === 304 || response.data === undefined)
            return (await this.get(credentials, taskId)).value;
        return mapTaskDetail(response.data);
    }

    async delete(
        credentials: VikunjaCredentials,
        taskId: number,
    ): Promise<void> {
        await this.client.requestJson<void>(
            credentials,
            "DELETE",
            `/tasks/${this.assertId(taskId, "taskId")}`,
            { responseMode: "empty" },
        );
    }

    async setLabels(
        credentials: VikunjaCredentials,
        taskId: number,
        beforeIds: number[],
        afterIds: number[],
    ): Promise<void> {
        await this.reconcile(
            credentials,
            taskId,
            beforeIds,
            afterIds,
            "labels",
            "label_id",
        );
    }

    async setAssignees(
        credentials: VikunjaCredentials,
        taskId: number,
        beforeIds: number[],
        afterIds: number[],
    ): Promise<void> {
        await this.reconcile(
            credentials,
            taskId,
            beforeIds,
            afterIds,
            "assignees",
            "user_id",
        );
    }

    private async reconcile(
        credentials: VikunjaCredentials,
        taskId: number,
        beforeIds: number[],
        afterIds: number[],
        relation: "labels" | "assignees",
        bodyKey: string,
    ): Promise<void> {
        this.assertId(taskId, "taskId");
        const before = [...new Set(beforeIds)].sort((a, b) => a - b);
        const after = [...new Set(afterIds)].sort((a, b) => a - b);
        const remove = before.filter((id) => !after.includes(id));
        const add = after.filter((id) => !before.includes(id));
        const completedIds: number[] = [];
        for (const id of remove) {
            try {
                this.assertId(id, `${relation} id`);
                await this.client.requestJson<void>(
                    credentials,
                    "DELETE",
                    `/tasks/${taskId}/${relation}/${id}`,
                    { responseMode: "empty" },
                );
                completedIds.push(id);
            } catch (cause) {
                throw this.partialError(completedIds, id, cause);
            }
        }
        for (const id of add) {
            try {
                this.assertId(id, `${relation} id`);
                await this.client.requestJson<void>(
                    credentials,
                    "POST",
                    `/tasks/${taskId}/${relation}`,
                    {
                        body: { kind: "json", value: { [bodyKey]: id } },
                    },
                );
                completedIds.push(id);
            } catch (cause) {
                throw this.partialError(completedIds, id, cause);
            }
        }
    }

    private partialError(
        completedIds: number[],
        failedId: number,
        cause: unknown,
    ): PartialRelationError {
        return { kind: "partial-relation", completedIds, failedId, cause };
    }

    private assertId(value: number | null | undefined, name: string): number {
        if (!Number.isSafeInteger(value) || (value as number) <= 0)
            throw new HttpTransportError(
                "invalid-response",
                `${name} must be a positive safe integer`,
            );
        return value as number;
    }
}

function buildTaskFilter(query: TaskQuery): string {
    const uniqueIds = (values: number[]) =>
        [...new Set(values)].sort((a, b) => a - b).join(",");
    return [
        query.doneFilter === "open" ? "done = false" : "",
        query.projectIds.length
            ? `project_id in ${uniqueIds(query.projectIds)}`
            : "",
        query.labelIds.length ? `labels in ${uniqueIds(query.labelIds)}` : "",
    ]
        .filter(Boolean)
        // Vikunja's filter grammar separates conditions with `&&`; the word
        // `AND` is parsed as part of the value and rejected with HTTP 400.
        .join(" && ");
}

function draftToWire(draft: TaskDraft): Record<string, unknown> {
    const wire: Record<string, unknown> = {
        title: draft.title,
        project_id: draft.projectId,
        start_date: draft.startAt,
        due_date: draft.dueAt,
        priority: draft.priority,
        description: draft.descriptionMarkdown,
        reminders: draft.reminders.map((reminder) => ({
            reminder_date: reminder.at,
        })),
    };
    const repeat = repeatToWire(draft.repeat);
    if (repeat) {
        if (repeat.repeatAfter !== null) wire.repeat_after = repeat.repeatAfter;
        if (repeat.repeatMode !== null) wire.repeat_mode = repeat.repeatMode;
    }
    return wire;
}

function patchToWire(patch: TaskPatch): Record<string, unknown> {
    const wire: Record<string, unknown> = {};
    if (patch.title !== undefined) wire.title = patch.title;
    if (patch.projectId !== undefined) wire.project_id = patch.projectId;
    if (patch.startAt !== undefined) wire.start_date = patch.startAt;
    if (patch.dueAt !== undefined) wire.due_date = patch.dueAt;
    if (patch.priority !== undefined) wire.priority = patch.priority;
    if (patch.descriptionMarkdown !== undefined)
        wire.description = patch.descriptionMarkdown;
    if (patch.reminders !== undefined)
        wire.reminders = patch.reminders.map((item) => ({
            reminder_date: item.at,
        }));
    if (patch.repeatAfter !== undefined) wire.repeat_after = patch.repeatAfter;
    if (patch.repeatMode !== undefined) wire.repeat_mode = patch.repeatMode;
    if (patch.done !== undefined) wire.done = patch.done;
    return wire;
}
