// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { VikunjaDock } from "../../src/frontend/dock/VikunjaDock.js";
import { TaskListStore } from "../../src/frontend/stores/TaskListStore.js";
import { TaskSummary } from "../../src/shared/task.js";
import { dockI18n } from "../helpers/pluginI18n.js";

function summary(overrides: Partial<TaskSummary> = {}): TaskSummary {
    return {
        id: 1,
        title: "Write documentation",
        done: false,
        project: { id: 3, title: "" },
        labels: [],
        assignees: [],
        startAt: null,
        dueAt: null,
        priority: 2,
        attachmentCount: 0,
        linkedBlockCount: 0,
        updatedAt: "2026-09-13T00:00:00Z",
        ...overrides,
    };
}

function storeWith(
    call: ReturnType<typeof vi.fn>,
    origin = "https://tasks.example",
): TaskListStore {
    return new TaskListStore({
        controller: { call } as never,
        origin,
        timeZone: "UTC",
    });
}

describe("VikunjaDock", () => {
    it("renders localized tabs and rows from the task store", async () => {
        const call = vi.fn().mockResolvedValue({
            ok: true,
            data: { items: [summary()], total: 1, page: 1, perPage: 50 },
        });
        const dock = new VikunjaDock({
            store: storeWith(call),
            openSettings: vi.fn(),
            i18n: dockI18n,
        });
        const element = document.createElement("div");
        dock.mount(element);

        await vi.waitFor(() => {
            expect(element.textContent).toContain("Write documentation");
        });

        expect(call).toHaveBeenCalledTimes(1);
        expect(call).toHaveBeenCalledWith(
            "vikunja.tasks.query",
            expect.objectContaining({
                view: "focus",
                page: 1,
                perPage: 50,
                timeZone: "UTC",
            }),
        );
        expect(element.textContent).toContain(dockI18n.focus);
        expect(element.textContent).toContain(dockI18n.inbox);
        expect(element.textContent).toContain(dockI18n.planned);
        expect(element.textContent).toContain(`${dockI18n.projectPrefix}3`);
        expect(
            element
                .querySelector(".vcp-siyuan-dock__task-priority")
                ?.getAttribute("aria-label"),
        ).toBe(dockI18n.priorityLabel(2));
    });

    it("renders task titles as plain text", async () => {
        const call = vi.fn().mockResolvedValue({
            ok: true,
            data: {
                items: [summary({ title: '<img src=x onerror="alert(1)">' })],
                total: 1,
                page: 1,
                perPage: 50,
            },
        });
        const dock = new VikunjaDock({
            store: storeWith(call),
            openSettings: vi.fn(),
            i18n: dockI18n,
        });
        const element = document.createElement("div");
        dock.mount(element);

        await vi.waitFor(() => {
            expect(element.textContent).toContain(
                '<img src=x onerror="alert(1)">',
            );
        });
        expect(element.querySelector("img")).toBeNull();
    });

    it("shows the unconfigured notice without calling the query RPC", async () => {
        const call = vi.fn();
        const dock = new VikunjaDock({
            store: storeWith(call, ""),
            openSettings: vi.fn(),
            i18n: dockI18n,
        });
        const element = document.createElement("div");
        dock.mount(element);

        await dock.refresh();

        expect(call).not.toHaveBeenCalled();
        expect(element.textContent).toContain(dockI18n.unconfigured);
    });

    it("opens a task when a row is activated and can start task creation", async () => {
        const call = vi.fn().mockResolvedValue({
            ok: true,
            data: { items: [summary()], total: 1, page: 1, perPage: 50 },
        });
        const onOpenTask = vi.fn();
        const onCreateTask = vi.fn();
        const dock = new VikunjaDock({
            store: storeWith(call),
            openSettings: vi.fn(),
            i18n: dockI18n,
            onOpenTask,
            onCreateTask,
        });
        const element = document.createElement("div");
        dock.mount(element);

        await vi.waitFor(() => {
            expect(element.textContent).toContain("Write documentation");
        });

        // Completion and detail controls are separate keyboard-reachable buttons.
        const row = element.querySelector<HTMLElement>(
            ".vcp-siyuan-dock__task",
        );
        expect(row?.tagName).toBe("ARTICLE");
        row?.querySelector<HTMLButtonElement>(
            "[data-action='open-task']",
        )?.click();
        expect(onOpenTask).toHaveBeenCalledWith(1);

        element
            .querySelector<HTMLButtonElement>("[data-action='create-task']")
            ?.click();
        expect(onCreateTask).toHaveBeenCalledTimes(1);
    });

    it("hides the create button and row interaction when no handlers are given", async () => {
        const call = vi.fn().mockResolvedValue({
            ok: true,
            data: { items: [summary()], total: 1, page: 1, perPage: 50 },
        });
        const dock = new VikunjaDock({
            store: storeWith(call),
            openSettings: vi.fn(),
            i18n: dockI18n,
        });
        const element = document.createElement("div");
        dock.mount(element);

        await vi.waitFor(() => {
            expect(element.textContent).toContain("Write documentation");
        });
        expect(element.querySelector("[data-action='create-task']")).toBeNull();
        expect(
            element.querySelector<HTMLElement>(".vcp-siyuan-dock__task")
                ?.tagName,
        ).toBe("ARTICLE");
        expect(
            element.querySelector<HTMLButtonElement>(
                "[data-action='open-task']",
            )?.disabled,
        ).toBe(true);
    });

    it("offers paging only while the server reports more tasks", async () => {
        const call = vi.fn().mockResolvedValue({
            ok: true,
            data: { items: [summary()], total: 3, page: 1, perPage: 50 },
        });
        const dock = new VikunjaDock({
            store: storeWith(call),
            openSettings: vi.fn(),
            i18n: dockI18n,
        });
        const element = document.createElement("div");
        dock.mount(element);

        await vi.waitFor(() => {
            expect(element.textContent).toContain("Write documentation");
        });
        const loadMore = element.querySelector<HTMLButtonElement>(
            "[data-action='load-more']",
        );
        expect(loadMore?.textContent).toBe(dockI18n.loadMore);

        // A fully loaded view (items === total) must not offer paging.
        const complete = new VikunjaDock({
            store: storeWith(
                vi.fn().mockResolvedValue({
                    ok: true,
                    data: {
                        items: [summary()],
                        total: 1,
                        page: 1,
                        perPage: 50,
                    },
                }),
            ),
            openSettings: vi.fn(),
            i18n: dockI18n,
        });
        const secondElement = document.createElement("div");
        complete.mount(secondElement);
        await vi.waitFor(() => {
            expect(secondElement.textContent).toContain("Write documentation");
        });
        expect(
            secondElement.querySelector("[data-action='load-more']"),
        ).toBeNull();
    });

    it("opens projects and labels as two separate pages", async () => {
        const call = vi.fn().mockResolvedValue({
            ok: true,
            data: { items: [], total: 0, page: 1, perPage: 50 },
        });
        const onManageProjects = vi.fn();
        const onManageLabels = vi.fn();
        const dock = new VikunjaDock({
            store: storeWith(call),
            openSettings: vi.fn(),
            i18n: dockI18n,
            onManageProjects,
            onManageLabels,
        });
        const element = document.createElement("div");
        dock.mount(element);

        const find = (action: string) =>
            element.querySelector<HTMLButtonElement>(
                `button[data-action='${action}']`,
            );
        expect(find("manage-projects")?.textContent).toBe(
            dockI18n.manageProjects,
        );
        expect(find("manage-labels")?.textContent).toBe(dockI18n.manageLabels);

        // Both entries are write-gated, so they only accept clicks once the
        // first load settles. The dock rebuilds its DOM on every store change,
        // so the buttons must be re-queried rather than captured up front.
        await vi.waitFor(() => {
            expect(find("manage-projects")?.disabled).toBe(false);
        });
        find("manage-projects")?.click();
        find("manage-labels")?.click();
        expect(onManageProjects).toHaveBeenCalledTimes(1);
        expect(onManageLabels).toHaveBeenCalledTimes(1);
    });

    it("stops updating the DOM after destroy", async () => {
        const call = vi.fn().mockResolvedValue({
            ok: true,
            data: { items: [summary()], total: 1, page: 1, perPage: 50 },
        });
        const dock = new VikunjaDock({
            store: storeWith(call),
            openSettings: vi.fn(),
            i18n: dockI18n,
        });
        const element = document.createElement("div");
        dock.mount(element);
        dock.destroy();

        await vi.waitFor(() => {
            expect(call).toHaveBeenCalled();
        });
        expect(element.textContent).toBe("");
    });
});
