// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { TaskDialog } from "../../src/frontend/dialogs/TaskDialog.js";
import { TaskDialogStore } from "../../src/frontend/stores/TaskDialogStore.js";
import { AttachmentStore } from "../../src/frontend/stores/AttachmentStore.js";
import { taskDialogI18n } from "../helpers/pluginI18n.js";

import {
    TaskFollowUpError,
    TaskRelationFollowUpError,
} from "../../src/frontend/dialogs/taskCreateWorkflow.js";

describe("TaskDialog", () => {
    it("offers retry-link and open-created-task after a follow-up failure without resubmitting create", async () => {
        const store = TaskDialogStore.create({ projectId: 2 });
        store.setField("title", "Child task");
        const onSave = vi.fn().mockRejectedValue(
            new TaskFollowUpError(
                33,
                new TaskRelationFollowUpError("link failed"),
            ),
        );
        const onRetryFollowUp = vi.fn().mockResolvedValue(undefined);
        const onOpenCreatedTask = vi.fn();
        const onClose = vi.fn();
        const dialog = new TaskDialog({
            store,
            onSave,
            onClose,
            title: "Create subtask",
            i18n: taskDialogI18n,
            onRetryFollowUp,
            onOpenCreatedTask,
            taskFollowUpFailure: true,
        });
        const host = document.createElement("div");
        dialog.mount(host);
        host.querySelector<HTMLFormElement>("form")!.dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
        );
        await vi.waitFor(() => expect(host.textContent).toContain("33"));
        expect(host.querySelector<HTMLButtonElement>("form button[type='submit']")).toBeNull();
        host.querySelector<HTMLButtonElement>("[data-action='open-created-task']")!.click();
        expect(onOpenCreatedTask).toHaveBeenCalledWith(33);
        expect(onSave).toHaveBeenCalledTimes(1);

        host.querySelector<HTMLButtonElement>("[data-action='retry-follow-up']")!.click();
        await vi.waitFor(() => expect(onRetryFollowUp).toHaveBeenCalledWith(33));
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalled();
    });

    it("requires a title and renders a safe native form", () => {
        const store = TaskDialogStore.create({ projectId: 2 });
        const onSave = vi.fn();
        const onClose = vi.fn();
        const dialog = new TaskDialog({
            store,
            onSave,
            onClose,
            title: "Create task",
            i18n: taskDialogI18n,
        });
        const host = document.createElement("div");
        dialog.mount(host);
        expect(host.querySelector("textarea")).not.toBeNull();
        const form = host.querySelector("form")!;
        form.dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
        );
        expect(onSave).not.toHaveBeenCalled();
        expect(host.textContent).toContain(taskDialogI18n.titleRequired);
    });

    it("offers Block linking as an opt-in choice for Block creates", () => {
        const store = TaskDialogStore.create({
            projectId: 2,
            linkedBlockId: "block-1",
            linkedBlockSummary: {
                blockId: "block-1",
                documentId: "doc-1",
                title: "Intro",
                selectedCount: 1,
                linkedTaskCount: 2,
            },
        });
        const dialog = new TaskDialog({
            store,
            onSave: vi.fn(),
            onClose: vi.fn(),
            title: "Create from Block",
            i18n: taskDialogI18n,
        });
        const host = document.createElement("div");
        dialog.mount(host);

        const link = host.querySelector<HTMLInputElement>(
            'input[name="blockLink"]',
        );
        expect(link).not.toBeNull();
        expect(link!.checked).toBe(false);
        expect(link!.disabled).toBe(false);
        expect(store.getBlockLink().enabled).toBe(false);
        link!.checked = true;
        link!.dispatchEvent(new Event("change", { bubbles: true }));
        expect(store.getBlockLink().enabled).toBe(true);
        expect(host.textContent).toContain(taskDialogI18n.blockLinkedCount(2));
    });

    it("omits the Block link control entirely for a plain create", () => {
        const store = TaskDialogStore.create({ projectId: 2 });
        const dialog = new TaskDialog({
            store,
            onSave: vi.fn(),
            onClose: vi.fn(),
            title: "New task",
            i18n: taskDialogI18n,
        });
        const host = document.createElement("div");
        dialog.mount(host);

        expect(host.querySelector('input[name="blockLink"]')).toBeNull();
        expect(host.textContent).not.toContain(taskDialogI18n.blockLinkLabel);
    });

    it("asks before discarding a dirty draft and only closes when confirmed", async () => {
        const store = TaskDialogStore.create({ projectId: 2 });
        store.setField("title", "Draft");
        const onClose = vi.fn();
        const confirmDiscard = vi.fn().mockResolvedValue(false);
        const dialog = new TaskDialog({
            store,
            onSave: vi.fn(),
            onClose,
            title: "Create",
            i18n: taskDialogI18n,
            confirmDiscard,
        });
        const host = document.createElement("div");
        dialog.mount(host);

        await dialog.close();
        expect(confirmDiscard).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();

        confirmDiscard.mockResolvedValue(true);
        await dialog.close();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("renders and edits all task fields with native controls", () => {
        const store = TaskDialogStore.create({ projectId: 2 });
        const dialog = new TaskDialog({
            store,
            onSave: vi.fn(),
            onClose: vi.fn(),
            title: "Create task",
            i18n: taskDialogI18n,
            projects: [
                {
                    id: 2,
                    title: "Inbox",
                    descriptionMarkdown: "",
                    color: null,
                    parentProjectId: null,
                    archived: false,
                    maxPermission: "write",
                },
            ],
            labels: [
                {
                    id: 3,
                    title: "work",
                    descriptionMarkdown: "",
                    color: null,
                    maxPermission: "write",
                },
            ],
            assignees: [{ id: 8, username: "alice", displayName: "Alice" }],
        });
        const host = document.createElement("div");
        dialog.mount(host);

        expect(
            host.querySelector("[data-filter='project'][data-mode='single']"),
        ).not.toBeNull();
        expect(host.querySelector("input[name='startAt']")).not.toBeNull();
        expect(host.querySelector("input[name='dueAt']")).not.toBeNull();
        expect(host.querySelector("input[name='priority']")).not.toBeNull();
        expect(host.querySelector("[data-filter='label']")).not.toBeNull();
        expect(host.querySelector("[data-filter='assignee']")).not.toBeNull();
        expect(
            host.querySelector(".vcp-siyuan-dock__multi-select-search"),
        ).not.toBeNull();
        expect(host.querySelector("button")).not.toBeNull();
        expect(host.querySelector("select[name='repeatUnit']")).not.toBeNull();

        const project = host.querySelector<HTMLButtonElement>(
            "[data-filter='project'] button",
        )!;
        project.click();
        host.querySelector<HTMLInputElement>(
            "[data-filter='project'] input[type='radio']",
        )!.click();
        host.querySelector<HTMLInputElement>("input[name='priority']")!.value =
            "4";
        host.querySelector<HTMLInputElement>(
            "input[name='priority']",
        )!.dispatchEvent(new Event("input", { bubbles: true }));
        const labels = host.querySelector<HTMLButtonElement>(
            "[data-filter='label'] button",
        )!;
        labels.click();
        host.querySelector<HTMLInputElement>(
            "[data-filter='label'] input[type='checkbox']",
        )!.click();
        expect(store.getLabelIds()).toEqual([3]);
        const assignees = host.querySelector<HTMLButtonElement>(
            "[data-filter='assignee'] button",
        )!;
        assignees.click();
        host.querySelector<HTMLInputElement>(
            "[data-filter='assignee'] input[type='radio']",
        )!.click();
        expect(store.getDraft()).toMatchObject({
            priority: 4,
            labelIds: [3],
            assigneeIds: [8],
        });

        const search = host.querySelector<HTMLInputElement>(
            ".vcp-siyuan-dock__multi-select-search",
        )!;
        search.value = "ali";
        search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    it("shows the selected Block context beside the link control", () => {
        const store = TaskDialogStore.create({
            projectId: 2,
            linkedBlockId: "block-1",
            linkedBlockSummary: {
                blockId: "block-1",
                documentId: "doc-1",
                title: "Research note",
                selectedCount: 2,
            },
        });
        const dialog = new TaskDialog({
            store,
            onSave: vi.fn(),
            onClose: vi.fn(),
            title: "Create task",
            i18n: taskDialogI18n,
        });
        const host = document.createElement("div");
        dialog.mount(host);

        const context = host.querySelector(
            ".vcp-siyuan-task-dialog__block-context",
        );
        expect(context?.textContent).toContain("Research note");
        expect(context?.textContent).toContain("doc-1");
        expect(context?.textContent).toContain("2");
    });

    it("does not let an older project member response replace the newer project", async () => {
        let resolveOld!: (
            users: Array<{ id: number; username: string; displayName: string }>,
        ) => void;
        let resolveNew!: (
            users: Array<{ id: number; username: string; displayName: string }>,
        ) => void;
        const oldResponse = new Promise<
            Array<{ id: number; username: string; displayName: string }>
        >((resolve) => {
            resolveOld = resolve;
        });
        const newResponse = new Promise<
            Array<{ id: number; username: string; displayName: string }>
        >((resolve) => {
            resolveNew = resolve;
        });
        const store = TaskDialogStore.create({ projectId: 2 });
        const dialog = new TaskDialog({
            store,
            onSave: vi.fn(),
            onClose: vi.fn(),
            title: "Create task",
            i18n: taskDialogI18n,
            projects: [
                {
                    id: 2,
                    title: "One",
                    descriptionMarkdown: "",
                    color: null,
                    parentProjectId: null,
                    archived: false,
                    maxPermission: "write",
                },
                {
                    id: 3,
                    title: "Two",
                    descriptionMarkdown: "",
                    color: null,
                    parentProjectId: null,
                    archived: false,
                    maxPermission: "write",
                },
            ],
            assignees: [{ id: 1, username: "initial", displayName: "Initial" }],
            onProjectChange: (projectId) =>
                projectId === 2 ? oldResponse : newResponse,
        });
        const host = document.createElement("div");
        dialog.mount(host);
        const project = host.querySelector<HTMLButtonElement>(
            "[data-filter='project'] button",
        )!;
        project.click();
        const projectOptions = host.querySelectorAll<HTMLInputElement>(
            "[data-filter='project'] input[type='radio']",
        );
        projectOptions[0].click();
        project.click();
        host.querySelectorAll<HTMLInputElement>(
            "[data-filter='project'] input[type='radio']",
        )[1].click();

        resolveOld([{ id: 2, username: "old", displayName: "Old" }]);
        await Promise.resolve();
        expect(host.textContent).not.toContain("Old");

        resolveNew([{ id: 3, username: "new", displayName: "New" }]);
        await Promise.resolve();
        expect(host.textContent).toContain("New");
    });

    it("renders conflict recovery actions and invokes reload or review", async () => {
        const store = TaskDialogStore.create({ projectId: 2 });
        const dialog = new TaskDialog({
            store,
            onSave: vi.fn(),
            onClose: vi.fn(),
            title: "Edit task",
            i18n: taskDialogI18n,
        });
        const host = document.createElement("div");
        const remote = {
            id: 1,
            title: "Remote",
            done: false,
            project: { id: 2, title: "Inbox" },
            labels: [],
            assignees: [],
            startAt: null,
            dueAt: null,
            priority: 0,
            attachmentCount: 0,
            linkedBlockCount: 0,
            updatedAt: "v2",
            descriptionMarkdown: "",
            reminders: [],
            repeat: { kind: "none" as const },
            attachments: [],
            parentTasks: [],
            childTasks: [],
            maxPermission: "write" as const,
        };
        const onReload = vi.fn();
        const onReview = vi.fn();
        dialog.showConflict(remote, onReload, onReview);
        dialog.mount(host);

        expect(host.querySelector("[role='alert']")?.textContent).toContain(
            taskDialogI18n.conflict,
        );
        const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];
        buttons
            .find((button) => button.textContent === taskDialogI18n.reload)
            ?.click();
        await Promise.resolve();
        expect(onReload).toHaveBeenCalledTimes(1);

        dialog.showConflict(remote, onReload, onReview);
        const review = [
            ...host.querySelectorAll<HTMLButtonElement>("button"),
        ].find((button) => button.textContent === taskDialogI18n.review);
        review?.click();
        await Promise.resolve();
        expect(onReview).toHaveBeenCalledTimes(1);
    });

    it("closes a pristine draft without asking", async () => {
        const store = TaskDialogStore.create({ projectId: 2 });
        const confirmDiscard = vi.fn();
        const onClose = vi.fn();
        const dialog = new TaskDialog({
            store,
            onSave: vi.fn(),
            onClose,
            title: "Create",
            i18n: taskDialogI18n,
            confirmDiscard,
        });
        const host = document.createElement("div");
        dialog.mount(host);

        await dialog.close();
        expect(confirmDiscard).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("previews a queued image attachment before the task is saved", () => {
        const onAttachmentPreview = vi.fn();
        const attachmentStore = new AttachmentStore({
            controller: { call: vi.fn() } as never,
            effectiveLimitBytes: 30 * 1024 * 1024,
        });
        attachmentStore.queue([
            new File(["x"], "draft.png", { type: "image/png" }),
        ]);
        const dialog = new TaskDialog({
            store: TaskDialogStore.create({ projectId: 2 }),
            onSave: vi.fn(),
            onClose: vi.fn(),
            title: "Create",
            i18n: taskDialogI18n,
            attachmentStore,
            onAttachmentPreview,
        });
        const host = document.createElement("div");
        dialog.mount(host);

        const preview = host.querySelector<HTMLButtonElement>(
            "button[data-action='preview']",
        );
        expect(preview?.getAttribute("aria-label")).toContain(
            taskDialogI18n.attachmentList.preview,
        );
        preview?.click();
        expect(onAttachmentPreview).toHaveBeenCalledWith("file-1");
    });
});
