import {
    TaskDetail,
    TaskSummary,
    EntityRef,
    LabelRef,
    UserRef,
    Reminder,
    TaskRelationRef,
    repeatFromWire,
} from "../../../shared/task.js";
import { HttpTransportError } from "../../http/HttpClient.js";
import { mapAttachment } from "./attachmentMapper.js";
import { decodePermission } from "./permission.js";

const ZERO_DATE_PREFIX = "0001-01-01";

type RawRecord = Record<string, unknown>;

function record(value: unknown, name: string): RawRecord {
    if (typeof value !== "object" || value === null)
        throw new HttpTransportError(
            "invalid-response",
            `${name} must be an object`,
        );
    return value as RawRecord;
}

function id(value: unknown, name: string): number {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0)
        throw new HttpTransportError(
            "invalid-response",
            `${name} must be a positive safe integer`,
        );
    return parsed;
}

function date(value: unknown): string | null {
    if (
        typeof value !== "string" ||
        !value ||
        value.startsWith(ZERO_DATE_PREFIX)
    )
        return null;
    return value;
}

function title(value: unknown, name: string): string {
    if (typeof value !== "string" || !value.trim())
        throw new HttpTransportError(
            "invalid-response",
            `${name} must be a non-empty string`,
        );
    return value;
}

function ref(value: unknown, name: string): EntityRef {
    const raw = record(value, name);
    return {
        id: id(raw.id, `${name}.id`),
        title: title(raw.title, `${name}.title`),
    };
}

function labels(value: unknown): LabelRef[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
        const raw = record(item, "label");
        return {
            id: id(raw.id, "label.id"),
            title: title(raw.title, "label.title"),
            color: typeof raw.hex_color === "string" ? raw.hex_color : null,
        };
    });
}

function assignees(value: unknown): UserRef[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
        const raw = record(item, "assignee");
        return {
            id: id(raw.id, "assignee.id"),
            username: typeof raw.username === "string" ? raw.username : "",
            displayName:
                typeof raw.name === "string"
                    ? raw.name
                    : typeof raw.username === "string"
                      ? raw.username
                      : "",
            ...(typeof raw.avatar_url === "string"
                ? { avatarUrl: raw.avatar_url }
                : {}),
        };
    });
}

function repeat(raw: RawRecord) {
    return repeatFromWire(raw.repeat_after, raw.repeat_mode);
}

function reminders(value: unknown): Reminder[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
        if (typeof item === "string") return [{ at: item }];
        if (
            typeof item === "object" &&
            item !== null &&
            typeof (item as RawRecord).reminder_date === "string"
        )
            return [{ at: (item as RawRecord).reminder_date as string }];
        return [];
    });
}

function directTaskRelations(
    raw: RawRecord,
    relation: "parenttask" | "subtask",
): TaskRelationRef[] {
    if (raw.related_tasks === null || raw.related_tasks === undefined) return [];
    const relations = record(raw.related_tasks, "related_tasks");
    const tasks = relations[relation];
    if (tasks === undefined || tasks === null) return [];
    if (!Array.isArray(tasks))
        throw new HttpTransportError(
            "invalid-response",
            `related_tasks.${relation} must be an array`,
        );
    return tasks.map((value) => {
        const task = record(value, `related_tasks.${relation} task`);
        const projectId =
            task.project_id === undefined || task.project_id === null
                ? null
                : id(task.project_id, `related_tasks.${relation}.project_id`);
        return {
            id: id(task.id, `related_tasks.${relation}.id`),
            title: title(task.title, `related_tasks.${relation}.title`),
            done: task.done === true,
            projectId,
        };
    });
}

function summaryFromRaw(value: unknown): TaskSummary {
    const raw = record(value, "task");
    const parentTasks = directTaskRelations(raw, "parenttask");
    const childTasks = directTaskRelations(raw, "subtask");
    const projectId =
        raw.project_id === null || raw.project_id === undefined
            ? null
            : id(raw.project_id, "project_id");
    const project = raw.project
        ? ref(raw.project, "project")
        : projectId === null
          ? undefined
          : {
                id: projectId,
                title:
                    typeof raw.project_title === "string"
                        ? raw.project_title
                        : "",
            };
    return {
        id: id(raw.id, "task.id"),
        title: title(raw.title, "task.title"),
        done: raw.done === true,
        project,
        labels: labels(raw.labels),
        assignees: assignees(raw.assignees),
        startAt: date(raw.start_date),
        dueAt: date(raw.due_date),
        priority: typeof raw.priority === "number" ? raw.priority : 0,
        attachmentCount: Array.isArray(raw.attachments)
            ? raw.attachments.length
            : typeof raw.attachment_count === "number"
              ? raw.attachment_count
              : 0,
        linkedBlockCount: 0,
        updatedAt:
            typeof raw.updated === "string"
                ? raw.updated
                : typeof raw.updated_at === "string"
                  ? raw.updated_at
                  : "",
        projectId,
        parentTaskIds: parentTasks.map((task) => task.id),
        childTaskIds: childTasks.map((task) => task.id),
        description:
            typeof raw.description === "string" ? raw.description : undefined,
    };
}

export function mapTaskSummary(value: unknown): TaskSummary {
    return summaryFromRaw(value);
}

export function mapTaskDetail(value: unknown): TaskDetail {
    const raw = record(value, "task");
    const summary = summaryFromRaw(raw);
    return {
        ...summary,
        parentTasks: directTaskRelations(raw, "parenttask"),
        childTasks: directTaskRelations(raw, "subtask"),
        descriptionMarkdown:
            typeof raw.description === "string" ? raw.description : "",
        reminders: reminders(raw.reminders),
        repeat: repeat(raw),
        attachments: Array.isArray(raw.attachments)
            ? raw.attachments.map(mapAttachment)
            : [],
        maxPermission: decodePermission(raw.max_permission),
        etag: typeof raw.etag === "string" ? raw.etag : undefined,
    };
}
