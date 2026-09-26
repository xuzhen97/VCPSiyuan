import { Page } from "./pagination.js";
import type { AttachmentMeta } from "./attachment.js";

export interface EntityRef {
    id: number;
    title: string;
}

export interface LabelRef extends EntityRef {
    color?: string | null;
}

export interface UserRef {
    id: number;
    username: string;
    displayName: string;
    avatarUrl?: string;
}

export interface Reminder {
    at: string;
}

export interface ReminderDraft {
    at: string;
}

export type RepeatUnit = "day" | "week" | "month";

export interface EditableRepeatRule {
    kind: "editable";
    every: number;
    unit: RepeatUnit;
}

export interface PreservedRepeatRule {
    kind: "preserved";
    summary: string;
    raw: unknown;
}

export type RepeatRule =
    | { kind: "none" }
    | EditableRepeatRule
    | PreservedRepeatRule;

export type Permission = "read" | "write" | "admin" | "owner" | "unknown";

/**
 * The legacy fields remain optional during the vertical migration. New code
 * should use project, labels, assignees, and updatedAt.
 */
export interface TaskSummary {
    id: number;
    title: string;
    /** Optional while legacy v1 callers are migrated. */
    done?: boolean;
    project?: EntityRef;
    labels?: LabelRef[];
    assignees?: UserRef[];
    startAt?: string | null;
    dueAt?: string | null;
    priority?: number;
    attachmentCount?: number;
    linkedBlockCount?: number;
    updatedAt?: string;
    /** @deprecated Legacy v1 field. */
    projectId?: number | null;
    /** @deprecated Legacy v1 field. */
    description?: string;
    /** Direct relationship IDs as reported by Vikunja; omitted by legacy callers. */
    parentTaskIds?: number[];
    childTaskIds?: number[];
}

export interface TaskRelationRef {
    id: number;
    title: string;
    done: boolean;
    projectId: number | null;
}

export interface TaskDetail extends TaskSummary {
    parentTasks: TaskRelationRef[];
    childTasks: TaskRelationRef[];
    descriptionMarkdown: string;
    reminders: Reminder[];
    repeat: RepeatRule;
    attachments: AttachmentMeta[];
    maxPermission: Permission;
    etag?: string;
}

export interface TaskDraft {
    title: string;
    projectId: number;
    labelIds: number[];
    assigneeIds: number[];
    startAt: string | null;
    dueAt: string | null;
    priority: number;
    descriptionMarkdown: string;
    reminders: ReminderDraft[];
    repeat: EditableRepeatRule | PreservedRepeatRule | { kind: "none" };
}

export interface TaskPatch {
    title?: string;
    projectId?: number;
    startAt?: string | null;
    dueAt?: string | null;
    priority?: number;
    descriptionMarkdown?: string;
    reminders?: ReminderDraft[];
    /** Repeat interval in SECONDS. `null` clears the repeat rule. */
    repeatAfter?: number | null;
    /** Vikunja `repeat_mode`, which is an integer enum, never a unit name. */
    repeatMode?: number | null;
    done?: boolean;
}

export interface Versioned<T> {
    value: T;
    etag?: string;
    updatedAt: string;
}

export interface TaskSearchQuery {
    query: string;
    page: number;
    perPage: number;
}

export interface TaskQuery {
    view: "inbox" | "all";
    inboxProjectId?: number | null;
    page: number;
    perPage: number;
    timeZone: string;
    doneFilter: "open" | "all";
    projectIds: number[];
    labelIds: number[];
}

export type TaskPage = Page<TaskSummary>;

/**
 * Vikunja encodes repetitions as a seconds interval plus an integer mode:
 * `0` repeats every `repeat_after` seconds, `1` repeats monthly on the same day
 * (ignoring `repeat_after`) and `2` repeats from the current date.
 */
export const REPEAT_MODE_AFTER_INTERVAL = 0;
export const REPEAT_MODE_MONTHLY = 1;

const SECONDS_PER_DAY = 86_400;

/**
 * Converts a repeat rule into the wire representation.
 *
 * Returns `undefined` for rules the editor cannot express, so callers leave the
 * field untouched instead of overwriting a server-side rule they do not model.
 */
export function repeatToWire(
    repeat: RepeatRule,
): { repeatAfter: number | null; repeatMode: number | null } | undefined {
    if (repeat.kind === "none") return { repeatAfter: null, repeatMode: null };
    if (repeat.kind === "preserved") return undefined;
    if (repeat.unit === "month")
        // Monthly repeats ignore repeat_after entirely.
        return { repeatAfter: 0, repeatMode: REPEAT_MODE_MONTHLY };
    const every = Math.max(1, Math.floor(repeat.every));
    const days = repeat.unit === "week" ? every * 7 : every;
    return {
        repeatAfter: days * SECONDS_PER_DAY,
        repeatMode: REPEAT_MODE_AFTER_INTERVAL,
    };
}

/**
 * Decodes the wire representation back into a rule the editor understands.
 * Anything not expressible as "every N days/weeks" or "monthly" is preserved
 * read-only rather than silently approximated.
 */
export function repeatFromWire(
    repeatAfter: unknown,
    repeatMode: unknown,
): RepeatRule {
    const afterSeconds =
        typeof repeatAfter === "number" && Number.isFinite(repeatAfter)
            ? repeatAfter
            : 0;
    const mode =
        typeof repeatMode === "number" ? repeatMode : Number(repeatMode ?? 0);
    if (!Number.isInteger(mode))
        return {
            kind: "preserved",
            summary: `${afterSeconds}s`,
            raw: { repeat_after: afterSeconds, repeat_mode: repeatMode },
        };
    if (afterSeconds <= 0 && mode === REPEAT_MODE_AFTER_INTERVAL)
        return { kind: "none" };
    if (mode === REPEAT_MODE_MONTHLY)
        return { kind: "editable", every: 1, unit: "month" };
    if (mode === REPEAT_MODE_AFTER_INTERVAL && afterSeconds > 0) {
        if (afterSeconds % SECONDS_PER_DAY === 0) {
            const days = afterSeconds / SECONDS_PER_DAY;
            if (days % 7 === 0)
                return { kind: "editable", every: days / 7, unit: "week" };
            return { kind: "editable", every: days, unit: "day" };
        }
    }
    return {
        kind: "preserved",
        summary: `${afterSeconds}s`,
        raw: { repeat_after: afterSeconds, repeat_mode: mode },
    };
}
