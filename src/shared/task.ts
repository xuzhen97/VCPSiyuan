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
}

export interface TaskDetail extends TaskSummary {
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

export interface TaskQuery {
    view: "focus" | "inbox" | "planned";
    inboxProjectId?: number | null;
    page: number;
    perPage: number;
    timeZone: string;
    locale?: string;
    filter?: string;
    doneFilter?: "open" | "done" | "all";
    currentDocumentTaskIds?: number[];
    assignedToMe?: boolean;
}

export interface FocusGroups {
    overdue: TaskSummary[];
    today: TaskSummary[];
    next: TaskSummary[];
}

export interface PlannedGroups {
    tomorrow: TaskSummary[];
    thisWeek: TaskSummary[];
    nextWeek: TaskSummary[];
    later: TaskSummary[];
}

function dateParts(
    date: Date,
    timeZone: string,
): { year: number; month: number; day: number } {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    const get = (type: string) =>
        Number(parts.find((part) => part.type === type)?.value);
    return { year: get("year"), month: get("month"), day: get("day") };
}

function dayKey(date: Date, timeZone: string): string {
    const parts = dateParts(date, timeZone);
    return `${parts.year.toString().padStart(4, "0")}-${parts.month.toString().padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

function localDateKey(value: string | null, timeZone: string): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : dayKey(date, timeZone);
}

function addDays(key: string, days: number): string {
    const date = new Date(`${key}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function startOfWeek(key: string): string {
    const date = new Date(`${key}T12:00:00Z`);
    const day = date.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    date.setUTCDate(date.getUTCDate() + mondayOffset);
    return date.toISOString().slice(0, 10);
}

function sortStable(tasks: TaskSummary[]): TaskSummary[] {
    return [...tasks].sort(
        (a, b) =>
            (b.priority ?? 0) - (a.priority ?? 0) ||
            (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") ||
            a.id - b.id,
    );
}

export function groupFocusTasks(
    tasks: TaskSummary[],
    now: Date,
    timeZone: string,
): FocusGroups {
    const today = dayKey(now, timeZone);
    const overdue: TaskSummary[] = [];
    const todayGroup: TaskSummary[] = [];
    const next: TaskSummary[] = [];
    const seen = new Set<number>();

    for (const task of tasks) {
        if (seen.has(task.id) || task.done === true) continue;
        seen.add(task.id);
        const due = localDateKey(task.dueAt ?? null, timeZone);
        const start = localDateKey(task.startAt ?? null, timeZone);
        if (due && due < today) {
            overdue.push(task);
        } else if (due === today || start === today) {
            todayGroup.push(task);
        } else if (!due) {
            // No due date: surface it as a next-step item so undated tasks are
            // not silently hidden from focus. `next` is capped (top 10, highest
            // priority / most recently updated first) in the return value.
            next.push(task);
        }
    }

    return {
        overdue: sortStable(overdue),
        today: sortStable(todayGroup),
        next: sortStable(next).slice(0, 10),
    };
}

export function groupPlannedTasks(
    tasks: TaskSummary[],
    now: Date,
    timeZone: string,
    locale = "en-US",
): PlannedGroups {
    void locale;
    const today = dayKey(now, timeZone);
    const tomorrow = addDays(today, 1);
    const weekStart = startOfWeek(today);
    const nextWeekStart = addDays(weekStart, 7);
    const laterStart = addDays(weekStart, 14);
    const groups: PlannedGroups = {
        tomorrow: [],
        thisWeek: [],
        nextWeek: [],
        later: [],
    };

    for (const task of tasks) {
        if (task.done === true) continue;
        const due = localDateKey(task.dueAt ?? null, timeZone);
        if (!due || due <= today) continue;
        if (due === tomorrow) groups.tomorrow.push(task);
        else if (due < nextWeekStart) groups.thisWeek.push(task);
        else if (due < laterStart) groups.nextWeek.push(task);
        else groups.later.push(task);
    }

    for (const key of Object.keys(groups) as Array<keyof PlannedGroups>) {
        groups[key] = sortStable(groups[key]);
    }
    return groups;
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
