import { Project } from "../../shared/project.js";
import {
    EditableRepeatRule,
    PreservedRepeatRule,
    ReminderDraft,
    TaskDetail,
    TaskDraft,
    TaskPatch,
    UserRef,
    repeatToWire,
} from "../../shared/task.js";

export interface BlockLinkSummary {
    blockId: string;
    documentId: string;
    title?: string;
    selectedCount?: number;
    /** Tasks already linked to this Block, so appending is visible up front. */
    linkedTaskCount?: number;
}

export interface BlockLinkState {
    enabled: boolean;
    blockId?: string;
    summary?: BlockLinkSummary;
}

export interface TaskCreateContext {
    projectId: number;
    linkedBlockId?: string;
    linkedBlockSummary?: BlockLinkSummary;
}

export interface RelationChanges {
    labels: { before: number[]; after: number[] } | undefined;
    assignees: { before: number[]; after: number[] } | undefined;
}

export type TaskDialogField =
    | "title"
    | "projectId"
    | "startAt"
    | "dueAt"
    | "priority"
    | "descriptionMarkdown"
    | "labels"
    | "assignees"
    | "reminders"
    | "repeat";

export interface TaskDialogConflict {
    remote: TaskDetail;
}

type EditableField = Extract<
    TaskDialogField,
    | "title"
    | "projectId"
    | "startAt"
    | "dueAt"
    | "priority"
    | "descriptionMarkdown"
>;

export class TaskDialogStore {
    private original?: TaskDetail;
    private values: Record<string, unknown>;
    private dirty = new Set<string>();
    private labelsDirty = false;
    private assigneesDirty = false;
    private labelIds: number[];
    private assigneeIds: number[];
    private reminders: ReminderDraft[];
    private repeat: TaskDetail["repeat"];
    private readonly blockLink: BlockLinkState;
    private availableAssignees?: UserRef[];
    private conflict?: TaskDialogConflict;

    private constructor(
        original?: TaskDetail,
        createContext?: TaskCreateContext,
    ) {
        this.original = original;
        this.values = {};
        this.labelIds = [];
        this.assigneeIds = [];
        this.reminders = [];
        this.repeat = { kind: "none" };
        this.loadValues(original, createContext?.projectId ?? 0);
        this.blockLink = {
            enabled: Boolean(createContext?.linkedBlockId),
            blockId: createContext?.linkedBlockId,
            summary: createContext?.linkedBlockSummary,
        };
    }

    static edit(detail: TaskDetail): TaskDialogStore {
        return new TaskDialogStore(detail);
    }

    static create(context: TaskCreateContext): TaskDialogStore {
        return new TaskDialogStore(undefined, context);
    }

    setField(field: EditableField, value: string | number | null): void {
        this.values[field] = value;
        if (this.original && this.values[field] === this.originalValue(field)) {
            this.dirty.delete(field);
        } else {
            this.dirty.add(field);
        }
    }

    setLabels(ids: number[]): void {
        const normalized = canonicalIds(ids);
        this.labelsDirty = !sameIds(
            normalized,
            this.original
                ? (this.original.labels ?? []).map((label) => label.id)
                : [],
        );
        this.labelIds = normalized;
    }

    setAssignees(ids: number[]): void {
        const normalized = canonicalIds(ids);
        this.assigneesDirty = !sameIds(
            normalized,
            this.original
                ? (this.original.assignees ?? []).map((user) => user.id)
                : [],
        );
        this.assigneeIds = normalized;
    }

    setReminders(reminders: ReminderDraft[]): void {
        const normalized = normalizeReminders(reminders);
        this.reminders = normalized;
        const original = normalizeReminders(this.original?.reminders ?? []);
        if (sameReminderValues(normalized, original))
            this.dirty.delete("reminders");
        else this.dirty.add("reminders");
    }

    setRepeat(repeat: TaskDetail["repeat"]): void {
        this.repeat = repeat;
        this.dirty.add("repeat");
    }

    setAvailableAssignees(assignees: UserRef[]): void {
        this.availableAssignees = [...assignees];
    }

    getUnavailableAssigneeIds(): number[] {
        if (!this.availableAssignees) return [];
        const available = new Set(
            this.availableAssignees.map((user) => user.id),
        );
        return this.assigneeIds.filter((id) => !available.has(id));
    }

    validate(projects: Project[]): Record<string, string> {
        const errors: Record<string, string> = {};
        if (!String(this.values.title ?? "").trim())
            errors.title = "Title is required";
        const projectId = Number(this.values.projectId);
        const project = projects.find((item) => item.id === projectId);
        if (!project) errors.projectId = "Project is required";
        else if (!isWritable(project.maxPermission))
            errors.projectId = "PROJECT_NOT_WRITABLE";
        return errors;
    }

    markConflict(remote: TaskDetail): void {
        this.conflict = { remote };
    }

    getConflict(): TaskDialogConflict | undefined {
        return this.conflict;
    }

    reloadFrom(remote: TaskDetail): void {
        this.original = remote;
        this.loadValues(remote, remote.project?.id ?? remote.projectId ?? 0);
        this.conflict = undefined;
    }

    acceptSaved(remote: TaskDetail): void {
        this.reloadFrom(remote);
    }

    rebaseOnto(remote: TaskDetail, fields: TaskDialogField[]): void {
        const local = this.getDraft();
        const localRelations = this.getRelationChanges();
        this.reloadFrom(remote);
        for (const field of fields) {
            switch (field) {
                case "title":
                case "projectId":
                case "startAt":
                case "dueAt":
                case "priority":
                case "descriptionMarkdown":
                    this.setField(field, localValue(local, field));
                    break;
                case "labels":
                    this.setLabels(
                        localRelations.labels?.after ?? local.labelIds,
                    );
                    break;
                case "assignees":
                    this.setAssignees(
                        localRelations.assignees?.after ?? local.assigneeIds,
                    );
                    break;
                case "reminders":
                    this.setReminders(local.reminders);
                    break;
                case "repeat":
                    this.setRepeat(local.repeat);
                    break;
            }
        }
        this.conflict = undefined;
    }

    getBlockLink(): BlockLinkState {
        return { ...this.blockLink };
    }

    getProjectId(): number {
        return Number(this.values.projectId);
    }

    getLabelIds(): number[] {
        return [...this.labelIds];
    }

    getAssigneeIds(): number[] {
        return [...this.assigneeIds];
    }

    getAssigneeRefs(): UserRef[] {
        return this.original ? [...(this.original.assignees ?? [])] : [];
    }

    getReminders(): ReminderDraft[] {
        return [...this.reminders];
    }

    getRepeat(): TaskDetail["repeat"] {
        return this.repeat;
    }

    getExpectedVersion(): { etag?: string; updatedAt?: string } {
        if (!this.original) return {};
        return {
            ...(this.original.etag ? { etag: this.original.etag } : {}),
            ...(this.original.updatedAt
                ? { updatedAt: this.original.updatedAt }
                : {}),
        };
    }

    getPatch(): TaskPatch {
        const patch: TaskPatch = {};
        if (this.dirty.has("title"))
            patch.title = String(this.values.title ?? "");
        if (this.dirty.has("projectId"))
            patch.projectId = Number(this.values.projectId);
        if (this.dirty.has("startAt"))
            patch.startAt = this.values.startAt as string | null;
        if (this.dirty.has("dueAt"))
            patch.dueAt = this.values.dueAt as string | null;
        if (this.dirty.has("priority"))
            patch.priority = Number(this.values.priority);
        if (this.dirty.has("descriptionMarkdown"))
            patch.descriptionMarkdown = String(
                this.values.descriptionMarkdown ?? "",
            );
        if (this.dirty.has("reminders")) patch.reminders = this.reminders;
        if (this.dirty.has("repeat")) {
            // Month/editable rules become a seconds interval plus an integer mode;
            // rules the editor cannot express are left untouched.
            const wire = repeatToWire(this.repeat);
            if (wire) {
                patch.repeatAfter = wire.repeatAfter;
                patch.repeatMode = wire.repeatMode;
            }
        }
        return patch;
    }

    getRelationChanges(): RelationChanges {
        return {
            labels: this.labelsDirty
                ? {
                      before: this.original
                          ? (this.original.labels ?? []).map(
                                (label) => label.id,
                            )
                          : [],
                      after: [...this.labelIds],
                  }
                : undefined,
            assignees: this.assigneesDirty
                ? {
                      before: this.original
                          ? (this.original.assignees ?? []).map(
                                (user) => user.id,
                            )
                          : [],
                      after: [...this.assigneeIds],
                  }
                : undefined,
        };
    }

    getDraft(): TaskDraft {
        const repeat =
            this.repeat.kind === "preserved"
                ? this.repeat
                : this.repeat.kind === "editable"
                  ? this.repeat
                  : { kind: "none" as const };
        return {
            title: String(this.values.title ?? "").trim(),
            projectId: Number(this.values.projectId),
            labelIds: [...this.labelIds],
            assigneeIds: [...this.assigneeIds],
            startAt: this.values.startAt as string | null,
            dueAt: this.values.dueAt as string | null,
            priority: Number(this.values.priority),
            descriptionMarkdown: String(this.values.descriptionMarkdown ?? ""),
            reminders: [...this.reminders],
            repeat,
        };
    }

    isDirty(): boolean {
        return this.dirty.size > 0 || this.labelsDirty || this.assigneesDirty;
    }

    private loadValues(
        detail: TaskDetail | undefined,
        projectId: number,
    ): void {
        this.values = detail
            ? {
                  title: detail.title,
                  projectId:
                      detail.project?.id ?? detail.projectId ?? projectId,
                  startAt: detail.startAt ?? null,
                  dueAt: detail.dueAt ?? null,
                  priority: detail.priority ?? 0,
                  descriptionMarkdown: detail.descriptionMarkdown,
              }
            : {
                  title: "",
                  projectId,
                  startAt: null,
                  dueAt: null,
                  priority: 0,
                  descriptionMarkdown: "",
              };
        this.labelIds = canonicalIds(
            (detail?.labels ?? []).map((label) => label.id),
        );
        this.assigneeIds = canonicalIds(
            (detail?.assignees ?? []).map((user) => user.id),
        );
        this.reminders = normalizeReminders(detail?.reminders ?? []);
        this.repeat = detail?.repeat ?? { kind: "none" };
        this.dirty.clear();
        this.labelsDirty = false;
        this.assigneesDirty = false;
    }

    private originalValue(
        field: EditableField,
    ): string | number | null | undefined {
        if (!this.original) return undefined;
        switch (field) {
            case "title":
                return this.original.title;
            case "projectId":
                return (
                    this.original.project?.id ?? this.original.projectId ?? 0
                );
            case "startAt":
                return this.original.startAt ?? null;
            case "dueAt":
                return this.original.dueAt ?? null;
            case "priority":
                return this.original.priority ?? 0;
            case "descriptionMarkdown":
                return this.original.descriptionMarkdown;
        }
    }
}

function canonicalIds(ids: number[]): number[] {
    return [...new Set(ids)]
        .filter((id) => Number.isSafeInteger(id) && id > 0)
        .sort((a, b) => a - b);
}

function sameIds(left: number[], right: number[]): boolean {
    const a = canonicalIds(left);
    const b = canonicalIds(right);
    return a.length === b.length && a.every((id, index) => id === b[index]);
}

function normalizeReminders(reminders: Array<{ at: string }>): ReminderDraft[] {
    return [
        ...new Set(
            reminders
                .map((reminder) => reminder.at)
                .filter((at) => !Number.isNaN(new Date(at).getTime())),
        ),
    ]
        .sort()
        .map((at) => ({ at }));
}

function sameReminderValues(
    left: ReminderDraft[],
    right: ReminderDraft[],
): boolean {
    return (
        left.length === right.length &&
        left.every((value, index) => value.at === right[index]?.at)
    );
}

function isWritable(permission: Project["maxPermission"]): boolean {
    return (
        permission === "write" ||
        permission === "admin" ||
        permission === "owner"
    );
}

function localValue(
    draft: TaskDraft,
    field: Extract<TaskDialogField, EditableField>,
): string | number | null {
    switch (field) {
        case "title":
            return draft.title;
        case "projectId":
            return draft.projectId;
        case "startAt":
            return draft.startAt;
        case "dueAt":
            return draft.dueAt;
        case "priority":
            return draft.priority;
        case "descriptionMarkdown":
            return draft.descriptionMarkdown;
    }
}

export type PreservedRepeat = PreservedRepeatRule;
export type EditableRepeat = EditableRepeatRule;
