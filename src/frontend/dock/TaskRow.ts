import { TaskSummary } from "../../shared/task.js";

export interface TaskRowI18n {
    projectPrefix: string;
    complete: string;
    reopen: string;
    openTask: string;
    priorityLabel: (priority: number) => string;
    formatDate: (value: string) => string;
    labelsSummary: (labels: string[]) => string;
    assigneesSummary: (assignees: string[]) => string;
    attachmentCount: (count: number) => string;
    blockCount: (count: number) => string;
}

export interface TaskRowOptions {
    onOpen?: (taskId: number) => void;
    onToggleDone?: (taskId: number, done: boolean) => void;
    canComplete?: boolean;
}

export function createTaskRow(
    task: TaskSummary,
    i18n: TaskRowI18n,
    options: TaskRowOptions = {},
): HTMLElement {
    const row = document.createElement("article");
    row.className = "vcp-siyuan-dock__task";
    row.dataset.taskId = String(task.id);
    if (task.done) row.dataset.done = "true";
    if ((task.priority ?? 0) > 0)
        row.dataset.priority = String(task.priority ?? 0);

    const completion = document.createElement("button");
    completion.type = "button";
    completion.className = "vcp-siyuan-dock__task-complete b3-button";
    completion.dataset.action = "complete-task";
    completion.setAttribute(
        "aria-label",
        task.done ? i18n.reopen : i18n.complete,
    );
    completion.setAttribute("aria-pressed", String(task.done === true));
    completion.textContent = task.done ? "✓" : "";
    completion.disabled =
        options.onToggleDone === undefined || options.canComplete === false;
    completion.addEventListener("click", (event) => {
        event.stopPropagation();
        options.onToggleDone?.(task.id, !task.done);
    });

    const body = document.createElement("div");
    body.className = "vcp-siyuan-dock__task-body";
    const title = document.createElement("div");
    title.className = "vcp-siyuan-dock__task-title";
    title.textContent = task.title;
    body.append(title);

    const meta = document.createElement("div");
    meta.className = "vcp-siyuan-dock__task-meta";
    const project =
        task.project ??
        (task.projectId === null || task.projectId === undefined
            ? null
            : { id: task.projectId, title: "" });
    if (project) {
        const projectElement = document.createElement("span");
        projectElement.className = "vcp-siyuan-dock__task-project";
        projectElement.textContent = `${i18n.projectPrefix}${project.title || project.id}`;
        meta.append(projectElement);
    }
    const dateValue = task.dueAt ?? task.startAt;
    if (dateValue) {
        const due = document.createElement("time");
        due.className = "vcp-siyuan-dock__task-date";
        due.dateTime = dateValue;
        due.textContent = i18n.formatDate(dateValue);
        meta.append(due);
    }
    if (task.labels && task.labels.length > 0) {
        const labels = document.createElement("span");
        labels.className = "vcp-siyuan-dock__task-labels";
        labels.textContent = i18n.labelsSummary(
            task.labels.map((label) => label.title),
        );
        meta.append(labels);
    }
    if (task.assignees && task.assignees.length > 0) {
        const assignees = document.createElement("span");
        assignees.className = "vcp-siyuan-dock__task-assignees";
        assignees.textContent = i18n.assigneesSummary(
            task.assignees.map((user) => user.displayName || user.username),
        );
        meta.append(assignees);
    }
    if ((task.attachmentCount ?? 0) > 0) {
        const attachments = document.createElement("span");
        attachments.className = "vcp-siyuan-dock__task-attachments";
        attachments.textContent = i18n.attachmentCount(
            task.attachmentCount ?? 0,
        );
        meta.append(attachments);
    }
    if ((task.linkedBlockCount ?? 0) > 0) {
        const blocks = document.createElement("span");
        blocks.className = "vcp-siyuan-dock__task-blocks";
        blocks.textContent = i18n.blockCount(task.linkedBlockCount ?? 0);
        meta.append(blocks);
    }
    if (meta.childElementCount > 0) body.append(meta);

    if ((task.priority ?? 0) > 0) {
        const priority = document.createElement("span");
        priority.className = "vcp-siyuan-dock__task-priority";
        priority.setAttribute(
            "aria-label",
            i18n.priorityLabel(task.priority ?? 0),
        );
        priority.title = i18n.priorityLabel(task.priority ?? 0);
        body.append(priority);
    }

    const detail = document.createElement("button");
    detail.type = "button";
    detail.className = "vcp-siyuan-dock__task-open b3-button b3-button--text";
    detail.dataset.action = "open-task";
    detail.textContent = i18n.openTask;
    detail.disabled = options.onOpen === undefined;
    detail.addEventListener("click", (event) => {
        event.stopPropagation();
        options.onOpen?.(task.id);
    });

    row.append(completion, body, detail);
    return row;
}
