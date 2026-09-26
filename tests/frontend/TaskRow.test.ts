// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
    createTaskRow,
    TaskRowI18n,
} from "../../src/frontend/dock/TaskRow.js";
import { TaskSummary } from "../../src/shared/task.js";

const i18n: TaskRowI18n = {
    projectPrefix: "Project ",
    complete: "Complete",
    reopen: "Reopen",
    openTask: "Open",
    priorityLabel: (priority) => `Priority ${priority}`,
    formatDate: (value) => value,
    labelsSummary: (labels) => labels.join(", "),
    assigneesSummary: (assignees) => assignees.join(", "),
    attachmentCount: (count) => `${count} attachments`,
    blockCount: (count) => `${count} blocks`,
    expandChildren: "Expand subtasks",
    collapseChildren: "Collapse subtasks",
};

function summary(overrides: Partial<TaskSummary> = {}): TaskSummary {
    return {
        id: 1,
        title: "Task",
        done: false,
        project: { id: 2, title: "Inbox" },
        labels: [],
        assignees: [],
        startAt: null,
        dueAt: null,
        priority: 0,
        attachmentCount: 0,
        linkedBlockCount: 0,
        updatedAt: "2026-09-21T00:00:00Z",
        ...overrides,
    };
}

function completionBox(row: HTMLElement): HTMLInputElement {
    const box = row.querySelector<HTMLInputElement>(
        ".vcp-siyuan-dock__task-complete",
    );
    if (!box) throw new Error("completion control missing");
    return box;
}

describe("createTaskRow completion control", () => {
    it("offers completion as a checkbox that tracks the task state", () => {
        const open = createTaskRow(summary(), i18n, {
            onToggleDone: vi.fn(),
        });
        const openBox = completionBox(open);
        expect(openBox.type).toBe("checkbox");
        expect(openBox.checked).toBe(false);
        expect(openBox.disabled).toBe(false);
        expect(openBox.getAttribute("aria-label")).toBe(i18n.complete);

        const done = createTaskRow(summary({ done: true }), i18n, {
            onToggleDone: vi.fn(),
        });
        const doneBox = completionBox(done);
        expect(doneBox.checked).toBe(true);
        expect(doneBox.getAttribute("aria-label")).toBe(i18n.reopen);
    });

    it("reports the new completion state through onToggleDone", () => {
        const onToggleDone = vi.fn();
        const row = createTaskRow(summary(), i18n, { onToggleDone });
        const box = completionBox(row);

        box.checked = true;
        box.dispatchEvent(new Event("change", { bubbles: true }));
        expect(onToggleDone).toHaveBeenCalledWith(1, true);

        box.checked = false;
        box.dispatchEvent(new Event("change", { bubbles: true }));
        expect(onToggleDone).toHaveBeenLastCalledWith(1, false);
    });

    it("stays disabled when the host cannot write or has no handler", () => {
        const noHandler = createTaskRow(summary(), i18n);
        expect(completionBox(noHandler).disabled).toBe(true);

        const readOnly = createTaskRow(summary(), i18n, {
            onToggleDone: vi.fn(),
            canComplete: false,
        });
        expect(completionBox(readOnly).disabled).toBe(true);
    });
});
