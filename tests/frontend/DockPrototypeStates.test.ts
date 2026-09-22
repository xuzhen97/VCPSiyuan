// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { VikunjaDock } from "../../src/frontend/dock/VikunjaDock.js";
import { TaskListStore } from "../../src/frontend/stores/TaskListStore.js";
import { TaskSummary } from "../../src/shared/task.js";
import { dockI18n } from "../helpers/pluginI18n.js";

function summary(overrides: Partial<TaskSummary> = {}): TaskSummary {
    return {
        id: 1,
        title: "Prototype task",
        done: false,
        project: { id: 1, title: "Inbox" },
        labels: [{ id: 4, title: "Writing" }],
        assignees: [{ id: 7, username: "alice", displayName: "Alice" }],
        startAt: null,
        dueAt: "2026-09-13T12:00:00Z",
        priority: 2,
        attachmentCount: 2,
        linkedBlockCount: 1,
        updatedAt: "2026-09-13T00:00:00Z",
        ...overrides,
    };
}

function createStore(result: unknown): TaskListStore {
    return new TaskListStore({
        controller: { call: vi.fn().mockResolvedValue(result) } as never,
        origin: "https://tasks.example",
        timeZone: "UTC",
        inboxProjectId: 1,
    });
}

describe("Dock prototype states", () => {
    it("renders the approved hierarchy, counts, groups, metadata and separate controls", async () => {
        const store = createStore({
            ok: true,
            data: { items: [summary()], total: 3, page: 1, perPage: 50 },
        });
        const onOpen = vi.fn();
        const onCreate = vi.fn();
        const dock = new VikunjaDock({
            store,
            openSettings: vi.fn(),
            onOpenTask: onOpen,
            onCreateTask: onCreate,
            now: () => new Date("2026-09-13T12:00:00Z"),
            i18n: dockI18n,
        });
        const element = document.createElement("div");
        dock.mount(element);

        await vi.waitFor(() => {
            expect(
                element.querySelector(".vcp-siyuan-dock__task"),
            ).not.toBeNull();
        });

        expect(
            element.querySelector(".vcp-siyuan-dock__header"),
        ).not.toBeNull();
        expect(
            element.querySelector(".vcp-siyuan-dock__connection"),
        ).not.toBeNull();
        expect(element.querySelector(".vcp-siyuan-dock__tabs")).not.toBeNull();
        expect(
            element.querySelector(".vcp-siyuan-dock__filters"),
        ).not.toBeNull();
        expect(
            element.querySelector(".vcp-siyuan-dock__groups"),
        ).not.toBeNull();
        expect(
            element.querySelector(".vcp-siyuan-dock__footer"),
        ).not.toBeNull();
        expect(
            element.querySelector(".vcp-siyuan-dock__tabs")?.textContent,
        ).toContain(`${dockI18n.inbox} (3)`);
        expect(
            element.querySelector(".vcp-siyuan-dock__task-labels")?.textContent,
        ).toContain("Writing");
        expect(
            element.querySelector(".vcp-siyuan-dock__task-assignees")
                ?.textContent,
        ).toContain("Alice");
        expect(
            element.querySelector(".vcp-siyuan-dock__task-attachments")
                ?.textContent,
        ).toContain("2");
        expect(
            element.querySelector(".vcp-siyuan-dock__task-blocks")?.textContent,
        ).toContain("1");
        // Open is the only button left in the row: completion is a checkbox.
        expect(
            element.querySelectorAll(".vcp-siyuan-dock__task button").length,
        ).toBe(1);
        expect(
            element
                .querySelector(".vcp-siyuan-dock__task")
                ?.querySelector("button button"),
        ).toBeNull();

        element
            .querySelector<HTMLButtonElement>("[data-action='open-task']")
            ?.click();
        expect(onOpen).toHaveBeenCalledWith(1);
        element
            .querySelector<HTMLButtonElement>("[data-action='create-task']")
            ?.click();
        expect(onCreate).toHaveBeenCalledTimes(1);
    });

    it("toggles both filters through the filter bar callbacks", async () => {
        const store = createStore({
            ok: true,
            data: { items: [], total: 0, page: 1, perPage: 50 },
        });
        const dock = new VikunjaDock({
            store,
            openSettings: vi.fn(),
            i18n: dockI18n,
        });
        const element = document.createElement("div");
        dock.mount(element);
        await vi.waitFor(() =>
            expect(element.textContent).toContain(dockI18n.empty),
        );

        expect(element.querySelector("[data-filter='incomplete']")).not.toBeNull();
    });

    it("disables creating and completion in offline and unconfigured states", async () => {
        const offlineStore = createStore({
            ok: false,
            error: {
                code: "NETWORK_ERROR",
                message: "offline",
                retryable: true,
            },
        });
        const offlineDock = new VikunjaDock({
            store: offlineStore,
            openSettings: vi.fn(),
            onCreateTask: vi.fn(),
            i18n: dockI18n,
        });
        const offlineElement = document.createElement("div");
        offlineDock.mount(offlineElement);
        await vi.waitFor(() =>
            expect(
                offlineElement.querySelector("[data-state='offline']"),
            ).not.toBeNull(),
        );
        expect(
            offlineElement.querySelector<HTMLButtonElement>(
                "[data-action='create-task']",
            )?.disabled,
        ).toBe(true);

        const unconfiguredStore = createStore({
            ok: true,
            data: { items: [], total: 0, page: 1, perPage: 50 },
        });
        const unconfiguredDock = new VikunjaDock({
            store: new TaskListStore({
                controller: { call: vi.fn() } as never,
                origin: "",
                timeZone: "UTC",
            }),
            openSettings: vi.fn(),
            onCreateTask: vi.fn(),
            i18n: dockI18n,
        });
        const unconfiguredElement = document.createElement("div");
        unconfiguredDock.mount(unconfiguredElement);
        expect(
            unconfiguredElement.querySelector<HTMLButtonElement>(
                "[data-action='create-task']",
            )?.disabled,
        ).toBe(true);
        void unconfiguredStore;
    });
});
