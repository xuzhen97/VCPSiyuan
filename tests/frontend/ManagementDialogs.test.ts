// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ProjectManagerDialog } from "../../src/frontend/dialogs/ProjectManagerDialog.js";
import { LabelManagerDialog } from "../../src/frontend/dialogs/LabelManagerDialog.js";
import { ProjectDeleteImpact } from "../../src/shared/project.js";
import { LabelDeleteImpact } from "../../src/shared/label.js";
import {
    labelManagerDialogI18n,
    projectManagerDialogI18n,
} from "../helpers/pluginI18n.js";

describe("ProjectManagerDialog", () => {
    it("keeps delete disabled until impact is complete and title matches", () => {
        const impact: ProjectDeleteImpact = {
            project: { id: 1, title: "Inbox" },
            descendantProjects: [],
            openTaskCount: 1,
            completedTaskCount: 0,
            isInboxProject: true,
            complete: false,
        };
        const host = document.createElement("div");
        const dialog = new ProjectManagerDialog({
            impact,
            i18n: projectManagerDialogI18n,
            onDelete: vi.fn(),
        });
        dialog.mount(host);
        expect(
            host
                .querySelector("button[data-action='delete']")
                ?.hasAttribute("disabled"),
        ).toBe(true);
        expect(host.textContent).toContain("Inbox");
        expect(host.textContent).toContain(
            projectManagerDialogI18n.impact(1, 0, 0),
        );
    });

    it("updates the impact target after previewing a different project", () => {
        const onPreviewDelete = vi.fn();
        const host = document.createElement("div");
        const dialog = new ProjectManagerDialog({
            projects: [
                {
                    id: 1,
                    title: "One",
                    descriptionMarkdown: "",
                    color: null,
                    parentProjectId: null,
                    archived: false,
                    maxPermission: "owner",
                },
                {
                    id: 2,
                    title: "Two",
                    descriptionMarkdown: "",
                    color: null,
                    parentProjectId: null,
                    archived: false,
                    maxPermission: "owner",
                },
            ],
            i18n: projectManagerDialogI18n,
            onPreviewDelete,
        });
        dialog.mount(host);
        host.querySelectorAll<HTMLButtonElement>(
            "button[data-action='delete-project']",
        )[1].click();
        expect(onPreviewDelete).toHaveBeenCalledWith(2);
        dialog.setImpact({
            project: { id: 2, title: "Two" },
            descendantProjects: [],
            openTaskCount: 0,
            completedTaskCount: 0,
            isInboxProject: false,
            complete: true,
        });
        expect(host.textContent).toContain("Two");
        expect(host.querySelector("input[placeholder='Two']")).not.toBeNull();
    });

    it("normalizes the color draft and encodes a root parent as zero", () => {
        const onCreate = vi.fn();
        const host = document.createElement("div");
        const dialog = new ProjectManagerDialog({
            projects: [],
            i18n: projectManagerDialogI18n,
            onCreate,
        });
        dialog.mount(host);
        host.querySelector<HTMLButtonElement>(
            "button[data-action='create-project']",
        )!.click();
        host.querySelector<HTMLInputElement>("input:not([type])")!.value =
            "Root project";
        host.querySelector<HTMLFormElement>("form")!.dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
        );
        expect(onCreate).toHaveBeenCalledWith({
            title: "Root project",
            descriptionMarkdown: "",
            color: "888888",
            parentProjectId: 0,
        });
    });

    it("shows the project list without a delete confirmation until one is asked for", () => {
        const onPreviewDelete = vi.fn();
        const onClose = vi.fn();
        const host = document.createElement("div");
        new ProjectManagerDialog({
            projects: [
                {
                    id: 1,
                    title: "Inbox",
                    descriptionMarkdown: "",
                    color: "ff0000",
                    parentProjectId: null,
                    archived: false,
                    maxPermission: "owner",
                },
            ],
            i18n: projectManagerDialogI18n,
            onPreviewDelete,
            onClose,
        }).mount(host);

        // The impact summary used to render up front for the first project,
        // which read as a confirmation the user never requested.
        expect(host.querySelector("button[data-action='delete']")).toBeNull();
        expect(host.querySelector("input[placeholder='Inbox']")).toBeNull();
        expect(host.textContent).toContain(projectManagerDialogI18n.create);

        host.querySelector<HTMLButtonElement>(
            "button[data-action='close']",
        )?.click();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("reports an empty project list and filtered-out results separately", () => {
        const host = document.createElement("div");
        new ProjectManagerDialog({
            projects: [],
            i18n: projectManagerDialogI18n,
        }).mount(host);
        const empty = host.querySelector<HTMLElement>("[data-state='empty']");
        expect(empty?.hidden).toBe(false);
        expect(empty?.textContent).toBe(projectManagerDialogI18n.empty);

        const populated = document.createElement("div");
        new ProjectManagerDialog({
            projects: [
                {
                    id: 1,
                    title: "Inbox",
                    descriptionMarkdown: "",
                    color: null,
                    parentProjectId: null,
                    archived: false,
                    maxPermission: "owner",
                },
            ],
            i18n: projectManagerDialogI18n,
        }).mount(populated);
        const search = populated.querySelector<HTMLInputElement>(
            "input[type='search']",
        )!;
        search.value = "nothing matches";
        search.dispatchEvent(new Event("input"));
        expect(
            populated.querySelector<HTMLElement>("[data-state='no-matches']")
                ?.hidden,
        ).toBe(false);
        expect(
            populated.querySelector<HTMLElement>("[data-state='empty']")
                ?.hidden,
        ).toBe(true);
    });

    it("requires the confirmation input to equal the project title", () => {
        const onDelete = vi.fn();
        const host = document.createElement("div");
        new ProjectManagerDialog({
            impact: {
                project: { id: 1, title: "Inbox" },
                descendantProjects: [],
                openTaskCount: 0,
                completedTaskCount: 0,
                isInboxProject: false,
                complete: true,
            },
            i18n: projectManagerDialogI18n,
            onDelete,
        }).mount(host);

        const button = host.querySelector<HTMLButtonElement>(
            "button[data-action='delete']",
        )!;
        const input = host.querySelector("input")!;
        expect(button.disabled).toBe(false);

        button.click();
        expect(onDelete).not.toHaveBeenCalled();

        input.value = "Inbox";
        button.click();
        expect(onDelete).toHaveBeenCalledWith("Inbox");
    });
});

describe("LabelManagerDialog", () => {
    it("updates the impact target after previewing a different label", () => {
        const onPreviewDelete = vi.fn();
        const host = document.createElement("div");
        const dialog = new LabelManagerDialog({
            labels: [
                {
                    id: 1,
                    title: "one",
                    descriptionMarkdown: "",
                    color: null,
                    maxPermission: "owner",
                },
                {
                    id: 2,
                    title: "two",
                    descriptionMarkdown: "",
                    color: null,
                    maxPermission: "owner",
                },
            ],
            i18n: labelManagerDialogI18n,
            onPreviewDelete,
        });
        dialog.mount(host);
        host.querySelectorAll<HTMLButtonElement>(
            "button[data-action='delete-label']",
        )[1].click();
        expect(onPreviewDelete).toHaveBeenCalledWith(2);
        dialog.setImpact({
            label: { id: 2, title: "two" },
            accessibleTaskCount: 0,
            complete: true,
        });
        expect(host.querySelector("input[placeholder='two']")).not.toBeNull();
    });

    it("keeps delete disabled until the label impact is complete", () => {
        const impact: LabelDeleteImpact = {
            label: { id: 7, title: "urgent" },
            accessibleTaskCount: 3,
            complete: false,
        };
        const host = document.createElement("div");
        new LabelManagerDialog({
            impact,
            i18n: labelManagerDialogI18n,
            onDelete: vi.fn(),
        }).mount(host);
        expect(
            host
                .querySelector("button[data-action='delete']")
                ?.hasAttribute("disabled"),
        ).toBe(true);
        expect(host.textContent).toContain("urgent");
        expect(host.textContent).toContain(labelManagerDialogI18n.usage(3));
        expect(host.textContent).toContain(
            labelManagerDialogI18n.impactIncomplete,
        );
    });

    it("manages labels on its own page, without the project list", () => {
        const host = document.createElement("div");
        new LabelManagerDialog({
            labels: [
                {
                    id: 1,
                    title: "urgent",
                    descriptionMarkdown: "",
                    color: "00ff00",
                    maxPermission: "owner",
                    usageCount: 2,
                },
            ],
            i18n: labelManagerDialogI18n,
        }).mount(host);

        expect(host.textContent).toContain(labelManagerDialogI18n.usage(2));
        // Labels used to be reachable only through a button inside the project
        // page; the split removed every cross link between the two.
        expect(
            host.querySelector("[data-action='manage-projects']"),
        ).toBeNull();
        expect(host.querySelector("button[data-action='delete']")).toBeNull();
        expect(host.querySelector("input[type='search']")).not.toBeNull();
        expect(
            host.querySelector("button[data-action='close']"),
        ).not.toBeNull();
    });

    it("omits the usage meta when the server sends no count", () => {
        const host = document.createElement("div");
        new LabelManagerDialog({
            labels: [
                {
                    id: 1,
                    title: "urgent",
                    descriptionMarkdown: "",
                    color: null,
                    maxPermission: "owner",
                    // The RPC round trip turns a missing count into null.
                    usageCount: null as unknown as number,
                },
            ],
            i18n: labelManagerDialogI18n,
        }).mount(host);
        expect(host.textContent).toContain("urgent");
        expect(host.textContent).not.toContain("null");
    });
});
