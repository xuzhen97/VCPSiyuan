// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { TaskDetailView } from "../../src/frontend/dock/TaskDetailView.js";
import { TaskDetail } from "../../src/shared/task.js";
import { taskDetailViewI18n } from "../helpers/pluginI18n.js";

const value: TaskDetail = {
    id: 1,
    title: "Task",
    done: false,
    project: { id: 2, title: "Inbox" },
    labels: [],
    assignees: [],
    startAt: null,
    dueAt: null,
    priority: 2,
    attachmentCount: 0,
    linkedBlockCount: 0,
    updatedAt: "v1",
    descriptionMarkdown: "<img src=x onerror=alert(1)>",
    reminders: [],
    repeat: { kind: "none" },
    attachments: [],
    maxPermission: "write",
};

describe("TaskDetailView", () => {
    it("renders task detail and description as text", () => {
        const element = document.createElement("div");
        const view = new TaskDetailView({
            task: value,
            i18n: taskDetailViewI18n,
            onBack: () => {},
            onComplete: () => {},
            onEdit: () => {},
            onDelete: () => {},
        });
        view.mount(element);
        expect(element.querySelector("img")).toBeNull();
        expect(element.textContent).toContain("<img src=x onerror=alert(1)>");
        expect(element.textContent).toContain("Inbox");
        expect(element.textContent).toContain(taskDetailViewI18n.complete);
        expect(element.textContent).toContain(taskDetailViewI18n.edit);
    });

    it("falls back to the project id when the project title is unknown", () => {
        const element = document.createElement("div");
        new TaskDetailView({
            // Task payloads only carry project_id, so the mapper can leave the
            // title empty; the meta line must not render blank.
            task: { ...value, project: { id: 2, title: "" } },
            i18n: taskDetailViewI18n,
            onBack: () => {},
            onComplete: () => {},
            onEdit: () => {},
            onDelete: () => {},
        }).mount(element);
        expect(
            element.querySelector(".vcp-siyuan-task-detail__meta")?.textContent,
        ).toBe(`${taskDetailViewI18n.projectPrefix}2`);
    });

    it("disables write actions for read-only tasks", () => {
        const element = document.createElement("div");
        const view = new TaskDetailView({
            task: { ...value, maxPermission: "read" },
            i18n: taskDetailViewI18n,
            onBack: () => {},
            onComplete: () => {},
            onEdit: () => {},
            onDelete: () => {},
        });
        view.mount(element);
        for (const button of element.querySelectorAll("button")) {
            if (button.textContent === taskDetailViewI18n.edit) {
                expect(button.hasAttribute("disabled")).toBe(true);
            }
        }
    });

    it("renders a delete action that fires only when the task is writable", () => {
        const element = document.createElement("div");
        let deleted = 0;
        new TaskDetailView({
            task: value,
            i18n: taskDetailViewI18n,
            onBack: () => {},
            onComplete: () => {},
            onEdit: () => {},
            onDelete: () => {
                deleted += 1;
            },
        }).mount(element);
        const button = [...element.querySelectorAll("button")].find(
            (candidate) => candidate.textContent === taskDetailViewI18n.delete,
        );
        expect(button).toBeDefined();
        button!.click();
        expect(deleted).toBe(1);

        const readOnly = document.createElement("div");
        new TaskDetailView({
            task: { ...value, maxPermission: "read" },
            i18n: taskDetailViewI18n,
            onBack: () => {},
            onComplete: () => {},
            onEdit: () => {},
            onDelete: () => {
                deleted += 10;
            },
        }).mount(readOnly);
        const locked = [...readOnly.querySelectorAll("button")].find(
            (candidate) => candidate.textContent === taskDetailViewI18n.delete,
        );
        expect(locked?.hasAttribute("disabled")).toBe(true);
        locked!.click();
        expect(deleted).toBe(1);
    });
});
