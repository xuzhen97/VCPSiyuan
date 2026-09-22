import { Label } from "../../shared/label.js";
import { Project } from "../../shared/project.js";
import { EditableRepeatRule, TaskDetail, UserRef } from "../../shared/task.js";
import { TaskDialogStore } from "../stores/TaskDialogStore.js";
import { AttachmentList } from "./AttachmentList.js";
import { AttachmentStore } from "../stores/AttachmentStore.js";
import {
    createMultiSelectFilter,
    MultiSelectFilterElement,
    MultiSelectOption,
} from "../dock/MultiSelectFilter.js";

export interface TaskDialogI18n {
    titleLabel: string;
    descriptionLabel: string;
    projectLabel: string;
    startDateLabel: string;
    dueDateLabel: string;
    priorityLabel: string;
    labelsLabel: string;
    assigneesLabel: string;
    assigneeUnavailable: string;
    assigneeSearchPlaceholder: string;
    reminderLabel: string;
    addReminder: string;
    removeReminder: string;
    repeatLabel: string;
    repeatNone: string;
    repeatEvery: string;
    repeatDay: string;
    repeatWeek: string;
    repeatMonth: string;
    preservedRepeat: string;
    blockLinkLabel: string;
    blockLinkLocked: string;
    blockLinkedCount: (count: number) => string;
    projectRequired: string;
    projectNotWritable: string;
    conflict: string;
    reload: string;
    review: string;
    cancel: string;
    save: string;
    titleRequired: string;
    saveFailed: string;
    attachments: string;
    uploadAttachment: string;
    attachmentLimit: (value: string) => string;
    attachmentsDisabled: string;
    noAttachments: string;
    attachmentList: ConstructorParameters<typeof AttachmentList>[0]["i18n"];
}

export interface TaskDialogOptions {
    store: TaskDialogStore;
    title: string;
    i18n: TaskDialogI18n;
    projects?: Project[];
    projectPath?: (projectId: number) => string;
    labels?: Label[];
    assignees?: UserRef[];
    onProjectChange?: (
        projectId: number,
    ) => void | Promise<ReadonlyArray<UserRef> | void>;
    onAssigneeSearch?: (
        projectId: number,
        query: string,
    ) => void | Promise<ReadonlyArray<UserRef> | void>;
    onSave: (
        draft: ReturnType<TaskDialogStore["getDraft"]>,
    ) => boolean | void | Promise<boolean | void>;
    onClose: () => void;
    /**
     * Consulted before discarding a dirty draft. May be asynchronous so the host
     * can show its own native confirmation dialog.
     */
    confirmDiscard?: () => boolean | Promise<boolean>;
    attachmentStore?: AttachmentStore;
    attachmentsEnabled?: boolean;
    attachmentLimitBytes?: number;
    onAttachmentRetry?: (itemId: string) => void;
    onAttachmentDownload?: (itemId: string) => void;
    onAttachmentPreview?: (itemId: string) => void;
    onAttachmentThumbnail?: (itemId: string) => Promise<Blob | undefined>;
    onAttachmentDelete?: (itemId: string) => void;
    confirmAttachmentDelete?: (itemId: string) => boolean | Promise<boolean>;
    canUploadAttachments?: boolean;
    canDeleteAttachments?: boolean;
}

export class TaskDialog {
    private readonly options: TaskDialogOptions;
    private container?: HTMLElement;
    private titleInput?: HTMLInputElement;
    private projectFilter?: MultiSelectFilterElement;
    private labelFilter?: MultiSelectFilterElement;
    private assigneeFilter?: MultiSelectFilterElement;
    private assigneeSearchTimer?: ReturnType<typeof setTimeout>;
    private assigneeSearchGeneration = 0;
    private opener?: HTMLElement;
    private attachmentList?: AttachmentList;
    private attachmentUnsubscribe?: () => void;
    private conflict?: {
        remote: TaskDetail;
        onReload: () => void | Promise<void>;
        onReview: () => void | Promise<void>;
    };

    constructor(options: TaskDialogOptions) {
        this.options = options;
    }

    mount(container: HTMLElement): void {
        this.container = container;
        if (this.options.attachmentStore) {
            this.attachmentUnsubscribe = this.options.attachmentStore.subscribe(
                () => this.refreshAttachments(),
            );
        }
        this.opener =
            document.activeElement instanceof HTMLElement
                ? document.activeElement
                : undefined;
        this.render();
        this.titleInput?.focus();
    }

    /**
     * Closes the dialog, asking first when the draft has unsaved changes. Returns
     * after the answer is known so callers can await dismissal.
     */
    async close(): Promise<void> {
        if (this.options.store.isDirty() && this.options.confirmDiscard) {
            const discard = await this.options.confirmDiscard();
            if (!discard) return;
        }
        this.options.onClose();
    }

    destroy(): void {
        if (this.assigneeSearchTimer !== undefined)
            clearTimeout(this.assigneeSearchTimer);
        this.assigneeSearchTimer = undefined;
        this.attachmentUnsubscribe?.();
        this.attachmentUnsubscribe = undefined;
        this.attachmentList?.destroy();
        this.attachmentList = undefined;
        this.projectFilter?.destroy();
        this.labelFilter?.destroy();
        this.assigneeFilter?.destroy();
        this.projectFilter = undefined;
        this.labelFilter = undefined;
        this.assigneeFilter = undefined;
        this.container?.replaceChildren();
        this.container = undefined;
        if (this.opener?.isConnected) this.opener.focus();
        this.opener = undefined;
    }

    refreshAttachments(): void {
        if (!this.options.attachmentStore || !this.container) return;
        const host = this.container.querySelector<HTMLElement>(
            "[data-field='attachments']",
        );
        if (!host) return;
        this.attachmentList?.update(this.options.attachmentStore.getItems());
    }

    showConflict(
        remote: TaskDetail,
        onReload: () => void | Promise<void>,
        onReview: () => void | Promise<void>,
    ): void {
        this.conflict = { remote, onReload, onReview };
        this.render();
    }

    private render(): void {
        if (!this.container) return;
        this.container.replaceChildren();
        const form = document.createElement("form");
        form.className = "vcp-siyuan-task-dialog";

        const header = document.createElement("div");
        header.className = "vcp-siyuan-task-dialog__header";
        const heading = document.createElement("h2");
        heading.textContent = this.options.title;
        header.append(heading);
        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.className =
            "b3-button b3-button--text vcp-siyuan-task-dialog__close";
        closeButton.setAttribute("aria-label", this.options.i18n.cancel);
        closeButton.textContent = "×";
        closeButton.addEventListener("click", () => {
            void this.close();
        });
        header.append(closeButton);
        form.append(header);

        const i18n = this.options.i18n;
        if (this.conflict) {
            const notice = document.createElement("div");
            notice.className = "vcp-siyuan-task-dialog__conflict";
            notice.setAttribute("role", "alert");
            notice.textContent = i18n.conflict;
            const reload = document.createElement("button");
            reload.type = "button";
            reload.className = "b3-button b3-button--text";
            reload.textContent = i18n.reload;
            reload.addEventListener("click", () => {
                void Promise.resolve(this.conflict?.onReload()).then(() => {
                    this.conflict = undefined;
                    this.render();
                });
            });
            const review = document.createElement("button");
            review.type = "button";
            review.className = "b3-button b3-button--text";
            review.textContent = i18n.review;
            review.addEventListener("click", () => {
                void Promise.resolve(this.conflict?.onReview()).then(() => {
                    this.conflict = undefined;
                    this.render();
                });
            });
            notice.append(reload, review);
            form.append(notice);
        }
        const store = this.options.store;
        const draft = store.getDraft();
        if (this.options.assignees)
            store.setAvailableAssignees(this.options.assignees);

        this.titleInput = document.createElement("input");
        this.titleInput.type = "text";
        this.titleInput.name = "title";
        this.titleInput.required = true;
        this.titleInput.className = "b3-text-field";
        this.titleInput.value = draft.title;
        this.titleInput.addEventListener("input", () =>
            store.setField("title", this.titleInput?.value ?? ""),
        );
        form.append(this.field(i18n.titleLabel, this.titleInput));

        if (this.options.projects) {
            const projectOptions = this.options.projects.map((item) => ({
                id: item.id,
                label: this.options.projectPath?.(item.id) || item.title,
                disabled: item.archived && item.id !== draft.projectId,
                color: item.color,
            }));
            const projectId = document.createElement("input");
            projectId.type = "hidden";
            projectId.name = "projectId";
            projectId.value = String(draft.projectId || "");
            const project = createMultiSelectFilter({
                key: "project",
                label: i18n.projectLabel,
                mode: "single",
                clearable: false,
                selectedIds: draft.projectId ? [draft.projectId] : [],
                options: projectOptions,
                onChange: ([nextProjectId]) => {
                    projectId.value = String(nextProjectId ?? "");
                    if (nextProjectId === undefined) return;
                    store.setField("projectId", nextProjectId);
                    this.loadProjectAssignees(store, nextProjectId);
                },
            });
            this.projectFilter = project;
            const control = document.createElement("div");
            control.className = "vcp-siyuan-task-dialog__choice-control";
            control.append(project, projectId);
            form.append(this.field(i18n.projectLabel, control));
        }

        const startAt = this.createDateInput(
            "startAt",
            draft.startAt,
            (value) => store.setField("startAt", parseDateInput(value)),
        );
        form.append(this.field(i18n.startDateLabel, startAt));

        const dueAt = this.createDateInput("dueAt", draft.dueAt, (value) =>
            store.setField("dueAt", parseDateInput(value)),
        );
        form.append(this.field(i18n.dueDateLabel, dueAt));

        const priority = document.createElement("input");
        priority.type = "number";
        priority.name = "priority";
        priority.min = "0";
        priority.max = "5";
        priority.step = "1";
        priority.value = String(draft.priority);
        priority.className = "b3-text-field";
        priority.addEventListener("input", () =>
            store.setField("priority", Number(priority.value)),
        );
        form.append(this.field(i18n.priorityLabel, priority));

        if (this.options.labels) {
            const labelOptions = this.options.labels.map((item) => ({
                id: item.id,
                label: item.title,
                color: item.color,
            }));
            const chips = document.createElement("div");
            chips.className = "vcp-siyuan-task-dialog__choice-chips";
            const labelsRef: { current?: MultiSelectFilterElement } = {};
            const syncLabels = (ids: number[]) => {
                store.setLabels(ids);
                labelsRef.current?.setSelected(ids);
                this.renderChoiceChips(chips, labelOptions, ids, (id) =>
                    syncLabels(ids.filter((item) => item !== id)),
                );
            };
            const labels = createMultiSelectFilter({
                key: "label",
                label: i18n.labelsLabel,
                selectedIds: draft.labelIds,
                options: labelOptions,
                onChange: syncLabels,
            });
            labelsRef.current = labels;
            this.labelFilter = labels;
            const control = document.createElement("div");
            control.className = "vcp-siyuan-task-dialog__choice-control";
            control.append(labels, chips);
            this.renderChoiceChips(chips, labelOptions, draft.labelIds, (id) =>
                syncLabels(draft.labelIds.filter((item) => item !== id)),
            );
            form.append(this.field(i18n.labelsLabel, control));
        }

        if (this.options.assignees) {
            const assigneeOptions = this.assigneeOptions(
                this.options.assignees,
                store,
                draft.assigneeIds,
            );
            const chips = document.createElement("div");
            chips.className = "vcp-siyuan-task-dialog__choice-chips";
            const assigneesRef: { current?: MultiSelectFilterElement } = {};
            const syncAssignees = (ids: number[]) => {
                store.setAssignees(ids);
                assigneesRef.current?.setSelected(ids);
                this.renderChoiceChips(chips, assigneeOptions, ids, () =>
                    syncAssignees([]),
                );
            };
            const assignees = createMultiSelectFilter({
                key: "assignee",
                label: i18n.assigneesLabel,
                mode: "single",
                searchable: true,
                searchPlaceholder: i18n.assigneeSearchPlaceholder,
                selectedIds: draft.assigneeIds.slice(0, 1),
                options: assigneeOptions,
                onSearch: (query) => this.searchAssignees(store, query),
                onChange: (ids) => syncAssignees(ids),
            });
            assigneesRef.current = assignees;
            this.assigneeFilter = assignees;
            const control = document.createElement("div");
            control.className = "vcp-siyuan-task-dialog__choice-control";
            control.append(assignees, chips);
            this.renderChoiceChips(
                chips,
                assigneeOptions,
                draft.assigneeIds.slice(0, 1),
                () => syncAssignees([]),
            );
            form.append(this.field(i18n.assigneesLabel, control));
        }

        const reminders = document.createElement("div");
        reminders.className = "vcp-siyuan-task-dialog__reminders";
        reminders.dataset.field = "reminders";
        const renderReminders = (): void => {
            reminders.replaceChildren();
            for (const reminder of store.getReminders()) {
                const row = document.createElement("div");
                row.className = "vcp-siyuan-task-dialog__reminder";
                const input = document.createElement("input");
                input.type = "datetime-local";
                input.name = "reminder";
                input.value = toDateInput(reminder.at);
                input.className = "b3-text-field";
                input.addEventListener("change", () => {
                    store.setReminders(readReminderInputs(reminders));
                });
                const remove = document.createElement("button");
                remove.type = "button";
                remove.className = "b3-button b3-button--text";
                remove.textContent = i18n.removeReminder;
                remove.addEventListener("click", () => {
                    row.remove();
                    store.setReminders(readReminderInputs(reminders));
                });
                row.append(input, remove);
                reminders.append(row);
            }
            const add = document.createElement("button");
            add.type = "button";
            add.className = "b3-button b3-button--text";
            add.textContent = i18n.addReminder;
            add.addEventListener("click", () => {
                store.setReminders([
                    ...readReminderInputs(reminders),
                    { at: new Date().toISOString() },
                ]);
                renderReminders();
            });
            reminders.append(add);
        };
        renderReminders();
        form.append(this.field(i18n.reminderLabel, reminders));

        const repeat = this.createRepeatControls(store, i18n);
        form.append(this.field(i18n.repeatLabel, repeat));

        const blockLink = store.getBlockLink();
        // Only the Block entry point carries a link; the dock's plain "new task"
        // does not. Rendering the control only in the first case keeps the two
        // flows visually distinct instead of showing a dead checkbox.
        if (blockLink.blockId) {
            const blockLinkControl = document.createElement("div");
            blockLinkControl.className =
                "vcp-siyuan-task-dialog__block-link";
            const link = document.createElement("input");
            link.type = "checkbox";
            link.name = "blockLink";
            link.checked = blockLink.enabled;
            link.addEventListener("change", () =>
                store.setBlockLinkEnabled(link.checked),
            );
            blockLinkControl.append(link);
            if (blockLink.summary) {
                const summary = document.createElement("span");
                summary.className = "vcp-siyuan-task-dialog__block-context";
                const title =
                    blockLink.summary.title || blockLink.summary.blockId;
                const count = blockLink.summary.selectedCount
                    ? ` (${blockLink.summary.selectedCount})`
                    : "";
                summary.textContent = `${title} · ${blockLink.summary.documentId}${count}`;
                blockLinkControl.append(summary);
            }
            const linkedCount = blockLink.summary?.linkedTaskCount ?? 0;
            if (linkedCount > 0) {
                const linked = document.createElement("span");
                linked.className = "vcp-siyuan-task-dialog__block-note";
                linked.textContent = i18n.blockLinkedCount(linkedCount);
                blockLinkControl.append(linked);
            }
            form.append(this.field(i18n.blockLinkLabel, blockLinkControl));
        }

        this.renderAttachments(form, i18n);

        const description = document.createElement("textarea");
        description.name = "description";
        description.value = draft.descriptionMarkdown;
        description.addEventListener("input", () =>
            store.setField("descriptionMarkdown", description.value),
        );
        form.append(this.field(i18n.descriptionLabel, description));

        const error = document.createElement("div");
        error.className = "vcp-siyuan-task-dialog__error";
        error.setAttribute("aria-live", "polite");

        const actions = document.createElement("div");
        actions.className = "vcp-siyuan-task-dialog__actions";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "b3-button b3-button--text";
        cancel.textContent = i18n.cancel;
        cancel.addEventListener("click", () => {
            void this.close();
        });
        const save = document.createElement("button");
        save.type = "submit";
        save.className = "b3-button";
        save.textContent = i18n.save;
        actions.append(cancel, save);
        form.append(error, actions);

        form.addEventListener("submit", (event) => {
            event.preventDefault();
            form.querySelectorAll<HTMLElement>("[aria-invalid='true']").forEach(
                (control) => control.removeAttribute("aria-invalid"),
            );
            const currentDraft = store.getDraft();
            if (!currentDraft.title.trim()) {
                error.textContent = i18n.titleRequired;
                this.titleInput?.focus();
                return;
            }
            const validation = this.options.projects
                ? store.validate(this.options.projects)
                : {};
            if (validation.projectId) {
                error.textContent =
                    validation.projectId === "PROJECT_NOT_WRITABLE"
                        ? i18n.projectNotWritable
                        : i18n.projectRequired;
                const projectControl = form.elements.namedItem("projectId");
                if (projectControl instanceof HTMLElement) {
                    projectControl.setAttribute("aria-invalid", "true");
                }
                return;
            }
            save.disabled = true;
            error.textContent = "";
            void Promise.resolve()
                .then(() => this.options.onSave(currentDraft))
                .catch((cause: unknown) => {
                    save.disabled = false;
                    error.textContent =
                        cause instanceof Error
                            ? cause.message
                            : i18n.saveFailed;
                });
        });

        this.container.append(form);
    }

    updateAssigneeOptions(assignees: ReadonlyArray<UserRef>): void {
        this.options.store.setAvailableAssignees([...assignees]);
        const options = this.assigneeOptions(
            assignees,
            this.options.store,
            this.options.store.getAssigneeIds(),
        );
        this.assigneeFilter?.updateOptions(options);
        this.assigneeFilter?.setSelected(this.options.store.getAssigneeIds());
        const host = this.container?.querySelector<HTMLElement>(
            ".vcp-siyuan-task-dialog__choice-chips",
        );
        if (host) {
            this.renderChoiceChips(host, options, this.options.store.getAssigneeIds(), () => {
                this.options.store.setAssignees([]);
                this.assigneeFilter?.setSelected([]);
                this.renderChoiceChips(host, options, [], () => {});
            });
        }
    }

    private loadProjectAssignees(
        store: TaskDialogStore,
        projectId: number,
    ): void {
        if (this.assigneeSearchTimer !== undefined)
            clearTimeout(this.assigneeSearchTimer);
        this.assigneeSearchTimer = undefined;
        const generation = ++this.assigneeSearchGeneration;
        void Promise.resolve(this.options.onProjectChange?.(projectId))
            .then((assignees) => {
                if (
                    generation === this.assigneeSearchGeneration &&
                    store.getProjectId() === projectId &&
                    assignees
                )
                    this.updateAssigneeOptions(assignees);
            })
            .catch(() => {});
    }

    private searchAssignees(store: TaskDialogStore, query: string): void {
        if (this.assigneeSearchTimer !== undefined)
            clearTimeout(this.assigneeSearchTimer);
        const projectId = store.getProjectId();
        const generation = ++this.assigneeSearchGeneration;
        this.assigneeSearchTimer = setTimeout(() => {
            void Promise.resolve(
                this.options.onAssigneeSearch?.(projectId, query),
            )
                .then((assignees) => {
                    if (generation === this.assigneeSearchGeneration && assignees)
                        this.updateAssigneeOptions(assignees);
                })
                .catch(() => {});
        }, 250);
    }

    private assigneeOptions(
        assignees: ReadonlyArray<UserRef>,
        store: TaskDialogStore,
        selectedIds: number[],
    ): MultiSelectOption[] {
        const byId = new Map(assignees.map((user) => [user.id, user]));
        for (const user of store.getAssigneeRefs()) byId.set(user.id, user);
        const unavailableIds = new Set(store.getUnavailableAssigneeIds());
        return [...byId.values()].map((user) => ({
            id: user.id,
            label:
                (user.displayName || user.username) +
                (unavailableIds.has(user.id)
                    ? ` (${this.options.i18n.assigneeUnavailable})`
                    : ""),
            disabled: unavailableIds.has(user.id) && !selectedIds.includes(user.id),
        }));
    }

    private renderChoiceChips(
        container: HTMLElement,
        options: MultiSelectOption[],
        selectedIds: number[],
        onRemove: (id: number) => void,
    ): void {
        container.replaceChildren();
        for (const id of selectedIds) {
            const option = options.find((item) => item.id === id);
            if (!option) continue;
            const chip = document.createElement("span");
            chip.className = "vcp-siyuan-task-dialog__choice-chip";
            if (option.color) {
                const swatch = document.createElement("span");
                swatch.className = "vcp-siyuan-task-dialog__choice-chip-swatch";
                swatch.style.background = option.color;
                chip.append(swatch);
            }
            const text = document.createElement("span");
            text.textContent = option.label;
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "vcp-siyuan-task-dialog__choice-chip-remove";
            remove.textContent = "×";
            remove.setAttribute("aria-label", `Remove ${option.label}`);
            remove.addEventListener("click", () => onRemove(id));
            chip.append(text, remove);
            container.append(chip);
        }
    }

    private renderAttachments(
        form: HTMLFormElement,
        i18n: TaskDialogI18n,
    ): void {
        const section = document.createElement("section");
        section.dataset.field = "attachments";
        section.className = "vcp-siyuan-task-dialog__attachments";
        const heading = document.createElement("h3");
        heading.textContent = i18n.attachments;
        section.append(heading);
        if (this.options.attachmentsEnabled === false) {
            const disabled = document.createElement("p");
            disabled.textContent = i18n.attachmentsDisabled;
            section.append(disabled);
        } else if (this.options.attachmentStore) {
            const upload = document.createElement("label");
            upload.className = "vcp-siyuan-task-dialog__attachment-upload";
            upload.textContent = `☁ ${i18n.uploadAttachment}`;
            const input = document.createElement("input");
            input.type = "file";
            input.multiple = true;
            input.disabled = this.options.canUploadAttachments === false;
            input.setAttribute("aria-label", i18n.uploadAttachment);
            input.addEventListener("change", () => {
                if (input.files)
                    this.options.attachmentStore?.queue([...input.files]);
                input.value = "";
                this.refreshAttachments();
            });
            upload.append(input);
            section.append(upload);
            if (this.options.attachmentLimitBytes !== undefined) {
                const limit = document.createElement("small");
                limit.textContent = i18n.attachmentLimit(
                    formatBytes(this.options.attachmentLimitBytes),
                );
                section.append(limit);
            }
            const listHost = document.createElement("div");
            this.attachmentList = new AttachmentList({
                items: this.options.attachmentStore.getItems(),
                i18n: i18n.attachmentList,
                onRetry: (id) => this.options.onAttachmentRetry?.(id),
                onDownload: (id) => this.options.onAttachmentDownload?.(id),
                onPreview: (id) => this.options.onAttachmentPreview?.(id),
                loadThumbnail: (id) => this.options.onAttachmentThumbnail?.(id) ?? Promise.resolve(undefined),
                onDelete: (id) => {
                    void Promise.resolve(
                        this.options.confirmAttachmentDelete?.(id) ?? true,
                    ).then((accepted) => {
                        if (accepted) this.options.onAttachmentDelete?.(id);
                    });
                },
                canDelete: this.options.canDeleteAttachments !== false,
            });
            this.attachmentList.mount(listHost);
            section.append(listHost);
        }
        form.append(section);
    }

    private field(labelText: string, control: HTMLElement): HTMLElement {
        const field = document.createElement("div");
        field.className = "vcp-siyuan-task-dialog__field";
        const label = document.createElement("label");
        label.textContent = labelText;
        field.append(label, control);
        return field;
    }

    private createDateInput(
        name: "startAt" | "dueAt",
        value: string | null,
        onChange: (value: string) => void,
    ): HTMLInputElement {
        const input = document.createElement("input");
        input.type = "datetime-local";
        input.name = name;
        input.value = toDateInput(value);
        input.className = "b3-text-field";
        input.addEventListener("change", () => onChange(input.value));
        return input;
    }

    private createRepeatControls(
        store: TaskDialogStore,
        i18n: TaskDialogI18n,
    ): HTMLElement {
        const wrapper = document.createElement("div");
        wrapper.className = "vcp-siyuan-task-dialog__repeat";
        const current = store.getRepeat();
        const unit = document.createElement("select");
        unit.name = "repeatUnit";
        unit.className = "b3-text-field";
        const options: Array<[string, string]> = [
            ["none", i18n.repeatNone],
            ["day", i18n.repeatDay],
            ["week", i18n.repeatWeek],
            ["month", i18n.repeatMonth],
        ];
        if (current.kind === "preserved") {
            options.push([
                "preserved",
                `${i18n.preservedRepeat}: ${current.summary}`,
            ]);
        }
        for (const [value, text] of options) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = text;
            option.selected =
                current.kind === "preserved"
                    ? value === "preserved"
                    : current.kind === "none"
                      ? value === "none"
                      : value === current.unit;
            option.disabled = value === "preserved";
            unit.append(option);
        }
        const every = document.createElement("input");
        every.type = "number";
        every.name = "repeatEvery";
        every.className = "b3-text-field";
        every.min = "1";
        every.step = "1";
        every.value = current.kind === "editable" ? String(current.every) : "1";
        every.placeholder = i18n.repeatEvery;
        every.disabled =
            current.kind === "none" || current.kind === "preserved";
        const update = (): void => {
            if (unit.value === "none" || unit.value === "preserved") {
                if (unit.value === "none") store.setRepeat({ kind: "none" });
                return;
            }
            every.disabled = false;
            const repeat: EditableRepeatRule = {
                kind: "editable",
                every: Math.max(1, Number(every.value) || 1),
                unit: unit.value as EditableRepeatRule["unit"],
            };
            store.setRepeat(repeat);
        };
        unit.addEventListener("change", update);
        every.addEventListener("input", update);
        wrapper.append(unit, every);
        return wrapper;
    }
}

function parseDateInput(value: string): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toDateInput(value: string | null): string {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${Math.floor(bytes / (1024 * 1024))} MiB`;
    if (bytes >= 1024) return `${Math.floor(bytes / 1024)} KiB`;
    return `${bytes} B`;
}

function readReminderInputs(container: HTMLElement): Array<{ at: string }> {
    return [
        ...container.querySelectorAll<HTMLInputElement>(
            "input[name='reminder']",
        ),
    ]
        .map((input) => parseDateInput(input.value))
        .filter((value): value is string => value !== null)
        .map((at) => ({ at }));
}
