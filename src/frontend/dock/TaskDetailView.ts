import { AttachmentItem } from "../stores/AttachmentStore.js";
import {
    AttachmentList,
    AttachmentListI18n,
} from "../dialogs/AttachmentList.js";
import { BlockSummary } from "../controller/SiYuanContextController.js";
import { TaskDetail } from "../../shared/task.js";

export interface TaskDetailViewI18n {
    back: string;
    reopen: string;
    complete: string;
    edit: string;
    projectPrefix: string;
    projectUnknown: string;
    status: string;
    priority: string;
    startDate: string;
    dueDate: string;
    labels: string;
    assignees: string;
    reminders: string;
    repeat: string;
    description: string;
    attachments: string;
    blocks: string;
    noAttachments: string;
    uploadAttachment: string;
    attachmentsDisabled: string;
    attachmentLimit: (value: string) => string;
    retry: string;
    loadError: string;
    retryLoad: string;
    blockOpen: string;
    blockUnknown: string;
    blockCount: (count: number) => string;
    permissionReadOnly: string;
    repeatNone: string;
    repeatEvery: (every: number, unit: string) => string;
    preservedRepeat: (summary: string) => string;
    attachmentList: AttachmentListI18n;
    formatDate: (value: string) => string;
}

export interface TaskDetailViewOptions {
    task: TaskDetail;
    i18n: TaskDetailViewI18n;
    onBack: () => void;
    onComplete: () => void;
    onEdit: () => void;
    onRetry?: () => void;
    onAttachmentSelect?: (files: File[]) => void;
    onAttachmentRetry?: (itemId: string) => void;
    onAttachmentDownload?: (itemId: string) => void;
    onAttachmentDelete?: (itemId: string) => void;
    canUploadAttachments?: boolean;
    canDeleteAttachments?: boolean;
    onBlockOpen?: (blockId: string) => void;
    attachments?: AttachmentItem[];
    attachmentsEnabled?: boolean;
    attachmentLimitBytes?: number;
    blocks?: BlockSummary[];
    error?: string;
    saving?: boolean;
}

export class TaskDetailView {
    private readonly options: TaskDetailViewOptions;
    private container?: HTMLElement;
    private attachmentList?: AttachmentList;
    private currentTask: TaskDetail;

    constructor(options: TaskDetailViewOptions) {
        this.options = options;
        this.currentTask = options.task;
    }

    mount(container: HTMLElement): void {
        this.container = container;
        this.render();
    }

    update(
        task: TaskDetail,
        state?: { error?: string; saving?: boolean },
    ): void {
        this.currentTask = task;
        if (state) {
            this.options.error = state.error;
            this.options.saving = state.saving;
        }
        this.render();
    }

    setAttachments(items: AttachmentItem[]): void {
        this.options.attachments = items;
        if (this.container) this.render();
    }

    setBlocks(blocks: BlockSummary[]): void {
        this.options.blocks = blocks;
        if (this.container) this.render();
    }

    destroy(): void {
        this.attachmentList?.destroy();
        this.attachmentList = undefined;
        this.container?.replaceChildren();
        this.container = undefined;
    }

    private render(): void {
        if (!this.container) return;
        this.attachmentList?.destroy();
        this.attachmentList = undefined;
        this.container.replaceChildren();
        const { i18n } = this.options;
        const task = this.currentTask;
        const root = document.createElement("section");
        root.className = "vcp-siyuan-task-detail";

        const header = document.createElement("div");
        header.className = "vcp-siyuan-task-detail__header";
        const back = this.button(
            i18n.back,
            "back",
            "b3-button b3-button--text",
        );
        back.addEventListener("click", () => this.options.onBack());
        const title = document.createElement("h2");
        title.textContent = task.title;
        header.append(back, title);

        const actions = document.createElement("div");
        actions.className = "vcp-siyuan-task-detail__actions";
        const complete = this.button(
            task.done ? i18n.reopen : i18n.complete,
            "complete",
            "b3-button",
        );
        complete.disabled =
            !isWritable(task.maxPermission) || this.options.saving === true;
        complete.setAttribute("aria-pressed", String(task.done));
        complete.addEventListener("click", () => this.options.onComplete());
        const edit = this.button(
            i18n.edit,
            "edit",
            "b3-button b3-button--outline",
        );
        edit.disabled = !isWritable(task.maxPermission);
        edit.addEventListener("click", () => this.options.onEdit());
        actions.append(complete, edit);
        if (task.maxPermission === "read") {
            const permission = document.createElement("span");
            permission.className = "vcp-siyuan-task-detail__permission";
            permission.textContent = i18n.permissionReadOnly;
            actions.append(permission);
        }

        const status = document.createElement("div");
        status.className = "vcp-siyuan-task-detail__status";
        status.textContent = `${i18n.status}: ${task.done ? i18n.reopen : i18n.complete}`;

        const projectMeta = document.createElement("div");
        projectMeta.className = "vcp-siyuan-task-detail__meta";
        projectMeta.textContent = task.project
            ? task.project.title || `${i18n.projectPrefix}${task.project.id}`
            : `${i18n.projectPrefix}${task.projectId ?? i18n.projectUnknown}`;
        const meta = document.createElement("dl");
        meta.className = "vcp-siyuan-task-detail__metadata";
        this.addMeta(meta, i18n.priority, String(task.priority ?? 0));
        if (task.startAt)
            this.addMeta(meta, i18n.startDate, i18n.formatDate(task.startAt));
        if (task.dueAt)
            this.addMeta(meta, i18n.dueDate, i18n.formatDate(task.dueAt));
        if ((task.labels ?? []).length > 0)
            this.addMeta(
                meta,
                i18n.labels,
                task.labels!.map((label) => label.title).join(", "),
            );
        if ((task.assignees ?? []).length > 0)
            this.addMeta(
                meta,
                i18n.assignees,
                task
                    .assignees!.map((user) => user.displayName || user.username)
                    .join(", "),
            );
        const reminders = task.reminders ?? [];
        if (reminders.length > 0)
            this.addMeta(
                meta,
                i18n.reminders,
                reminders.map((item) => i18n.formatDate(item.at)).join(", "),
            );
        this.addMeta(meta, i18n.repeat, repeatText(task, i18n));

        const descriptionHeading = document.createElement("h3");
        descriptionHeading.textContent = i18n.description;
        const description = document.createElement("pre");
        description.className = "vcp-siyuan-task-detail__description";
        description.textContent = task.descriptionMarkdown;

        root.append(
            header,
            actions,
            status,
            projectMeta,
            meta,
            descriptionHeading,
            description,
        );
        this.renderAttachments(root);
        this.renderBlocks(root);
        if (this.options.error) {
            const error = document.createElement("div");
            error.className = "vcp-siyuan-task-detail__error";
            error.setAttribute("role", "alert");
            error.textContent = this.options.error;
            if (this.options.onRetry) {
                const retry = this.button(
                    i18n.retryLoad,
                    "retry",
                    "b3-button b3-button--text",
                );
                retry.addEventListener("click", () => this.options.onRetry?.());
                error.append(retry);
            }
            root.append(error);
        }
        this.container.append(root);
    }

    private renderAttachments(root: HTMLElement): void {
        const i18n = this.options.i18n;
        const section = document.createElement("section");
        section.className = "vcp-siyuan-task-detail__attachments";
        const heading = document.createElement("h3");
        heading.textContent = i18n.attachments;
        section.append(heading);
        if (this.options.attachmentsEnabled === false) {
            const disabled = document.createElement("p");
            disabled.textContent = i18n.attachmentsDisabled;
            section.append(disabled);
        } else {
            const select = document.createElement("input");
            select.type = "file";
            select.multiple = true;
            select.dataset.action = "select-attachments";
            select.setAttribute("aria-label", i18n.uploadAttachment);
            select.disabled =
                this.options.canUploadAttachments === false ||
                !isWritable(this.currentTask.maxPermission);
            select.addEventListener("change", () => {
                if (select.files)
                    this.options.onAttachmentSelect?.([...select.files]);
                select.value = "";
            });
            section.append(select);
            if (this.options.attachmentLimitBytes !== undefined) {
                const limit = document.createElement("small");
                limit.textContent = i18n.attachmentLimit(
                    formatBytes(this.options.attachmentLimitBytes),
                );
                section.append(limit);
            }
            if ((this.options.attachments ?? []).length === 0) {
                const empty = document.createElement("p");
                empty.textContent = i18n.noAttachments;
                section.append(empty);
            } else {
                this.attachmentList = new AttachmentList({
                    items: this.options.attachments ?? [],
                    i18n: i18n.attachmentList,
                    onRetry: (id) => this.options.onAttachmentRetry?.(id),
                    onDownload: (id) => this.options.onAttachmentDownload?.(id),
                    onDelete: (id) => this.options.onAttachmentDelete?.(id),
                    canDelete:
                        this.options.canDeleteAttachments !== false &&
                        isWritable(this.currentTask.maxPermission),
                    canDownload: this.currentTask.maxPermission !== "unknown",
                });
                const listHost = document.createElement("div");
                this.attachmentList.mount(listHost);
                section.append(listHost);
            }
        }
        root.append(section);
    }

    private renderBlocks(root: HTMLElement): void {
        const i18n = this.options.i18n;
        const section = document.createElement("section");
        section.className = "vcp-siyuan-task-detail__blocks";
        const heading = document.createElement("h3");
        heading.textContent = i18n.blocks;
        section.append(heading);
        const blocks = this.options.blocks ?? [];
        if (blocks.length === 0) {
            const empty = document.createElement("p");
            empty.textContent = i18n.blockUnknown;
            section.append(empty);
        } else {
            const count = document.createElement("small");
            count.textContent = i18n.blockCount(blocks.length);
            section.append(count);
            for (const block of blocks) {
                const button = this.button(
                    block.title || block.blockId,
                    "open-block",
                    "b3-button b3-button--text",
                );
                button.dataset.blockId = block.blockId;
                button.addEventListener("click", () =>
                    this.options.onBlockOpen?.(block.blockId),
                );
                section.append(button);
            }
        }
        root.append(section);
    }

    private addMeta(meta: HTMLElement, label: string, value: string): void {
        const term = document.createElement("dt");
        term.textContent = label;
        const detail = document.createElement("dd");
        detail.textContent = value;
        meta.append(term, detail);
    }

    private button(
        text: string,
        action: string,
        className: string,
    ): HTMLButtonElement {
        const button = document.createElement("button");
        button.type = "button";
        button.className = className;
        button.dataset.action = action;
        button.textContent = text;
        return button;
    }
}

function repeatText(task: TaskDetail, i18n: TaskDetailViewI18n): string {
    const repeat = task.repeat ?? { kind: "none" as const };
    if (repeat.kind === "none") return i18n.repeatNone;
    if (repeat.kind === "preserved")
        return i18n.preservedRepeat(repeat.summary);
    return i18n.repeatEvery(repeat.every, repeat.unit);
}

function isWritable(permission: TaskDetail["maxPermission"]): boolean {
    return (
        permission === "write" ||
        permission === "admin" ||
        permission === "owner"
    );
}

function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${Math.floor(bytes / (1024 * 1024))} MiB`;
    if (bytes >= 1024) return `${Math.floor(bytes / 1024)} KiB`;
    return `${bytes} B`;
}
