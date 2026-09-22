import { describe, expect, it, vi } from "vitest";
import { TaskListStore } from "../../src/frontend/stores/TaskListStore.js";
import { TaskDetail, TaskSummary } from "../../src/shared/task.js";

function task(
    id: number,
    title = `Task ${id}`,
    overrides: Partial<TaskSummary> = {},
): TaskSummary {
    return {
        id,
        title,
        done: false,
        project: { id: 1, title: "Inbox" },
        labels: [],
        assignees: [],
        startAt: null,
        dueAt: null,
        priority: 1,
        attachmentCount: 0,
        linkedBlockCount: 0,
        updatedAt: "2026-09-13T00:00:00Z",
        ...overrides,
    };
}

function page(items: TaskSummary[], total = items.length, pageNumber = 1) {
    return {
        ok: true as const,
        data: { items, total, page: pageNumber, perPage: 2 },
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

describe("TaskListStore", () => {
    it("requires Origin for both views and an Inbox project only for Inbox", () => {
        const controller = { call: vi.fn() };
        const store = new TaskListStore({
            controller: controller as never,
            origin: "  ",
            timeZone: "UTC",
        });
        expect(store.needsConfiguration("inbox")).toBe(true);
        expect(store.needsConfiguration("all")).toBe(true);
        store.updateConfig("https://tasks.example", null);
        expect(store.needsConfiguration("inbox")).toBe(true);
        expect(store.needsConfiguration("all")).toBe(false);
        expect(store.getConfigurationError("inbox")).toBe("inbox");
    });

    it("defaults to Inbox and keeps filter state independent per view", async () => {
        const call = vi.fn().mockResolvedValue(page([]));
        const store = new TaskListStore({
            controller: { call } as never,
            origin: "https://tasks.example",
            timeZone: "UTC",
            inboxProjectId: 7,
        });

        await store.activate("inbox");
        await store.setLabelIds("inbox", [3, 4, 3]);
        await store.setIncompleteOnly("all", false);
        await store.setProjectIds("all", [8, 9, 8]);

        expect(store.getFilters("inbox")).toEqual({
            incompleteOnly: true,
            projectIds: [],
            labelIds: [3, 4],
        });
        expect(store.getFilters("all")).toEqual({
            incompleteOnly: false,
            projectIds: [8, 9],
            labelIds: [],
        });
        expect(call.mock.calls.at(-1)?.[1]).toMatchObject({
            view: "all",
            doneFilter: "all",
            projectIds: [8, 9],
            labelIds: [],
        });
    });

    it("sends Inbox and All queries with the correct structured filters", async () => {
        const call = vi.fn().mockResolvedValue(page([]));
        const store = new TaskListStore({
            controller: { call } as never,
            origin: "https://tasks.example",
            timeZone: "UTC",
            inboxProjectId: 7,
        });

        await store.refresh("inbox");
        expect(call).toHaveBeenLastCalledWith(
            "vikunja.tasks.query",
            expect.objectContaining({
                view: "inbox",
                inboxProjectId: 7,
                doneFilter: "open",
                projectIds: [],
                labelIds: [],
            }),
        );

        await store.setLabelIds("inbox", [4]);
        expect(call).toHaveBeenLastCalledWith(
            "vikunja.tasks.query",
            expect.objectContaining({
                view: "inbox",
                doneFilter: "open",
                projectIds: [],
                labelIds: [4],
            }),
        );

        await store.setProjectIds("all", [2]);
        await store.setLabelIds("all", [3]);
        expect(call).toHaveBeenLastCalledWith(
            "vikunja.tasks.query",
            expect.objectContaining({
                view: "all",
                doneFilter: "open",
                projectIds: [2],
                labelIds: [3],
            }),
        );
    });

    it("resets pagination and carries filters into the next page", async () => {
        const controller = {
            call: vi
                .fn()
                .mockResolvedValueOnce(page([task(1), task(2)], 3, 1))
                .mockResolvedValueOnce(page([task(2)], 3, 1))
                .mockResolvedValueOnce(page([task(3)], 3, 2)),
        };
        const store = new TaskListStore({
            controller: controller as never,
            origin: "https://tasks.example",
            timeZone: "UTC",
            inboxProjectId: 7,
        });

        await store.activate("all");
        await store.setLabelIds("all", [4]);
        await store.loadNextPage();

        expect(controller.call).toHaveBeenNthCalledWith(
            2,
            "vikunja.tasks.query",
            expect.objectContaining({
                view: "all",
                page: 1,
                labelIds: [4],
            }),
        );
        expect(controller.call).toHaveBeenNthCalledWith(
            3,
            "vikunja.tasks.query",
            expect.objectContaining({
                view: "all",
                page: 2,
                labelIds: [4],
            }),
        );
        expect(store.getState("all").items.map((item) => item.id)).toEqual([
            2,
            3,
        ]);
    });

    it("ignores a late response from an older generation", async () => {
        const first = deferred<ReturnType<typeof page>>();
        const controller = {
            call: vi
                .fn()
                .mockImplementationOnce(() => first.promise)
                .mockResolvedValueOnce(page([task(2, "New")])) ,
        };
        const store = new TaskListStore({
            controller: controller as never,
            origin: "https://tasks.example",
            timeZone: "UTC",
            inboxProjectId: 7,
        });

        const oldRefresh = store.refresh("inbox");
        const newRefresh = store.refresh("inbox");
        await newRefresh;
        first.resolve(page([task(1, "Old")]));
        await oldRefresh;
        expect(store.getState("inbox").items.map((item) => item.title)).toEqual(
            ["New"],
        );
    });

    it("removes a completed task from open views but keeps it in all-status views", async () => {
        const authoritative: TaskDetail = {
            ...task(1),
            done: true,
            descriptionMarkdown: "",
            reminders: [],
            repeat: { kind: "none" },
            attachments: [],
            maxPermission: "write",
            etag: "v2",
        };
        const controller = {
            call: vi
                .fn()
                .mockResolvedValueOnce(page([task(1)]))
                .mockResolvedValueOnce(page([task(1)]))
                .mockResolvedValueOnce({ ok: true, data: authoritative }),
        };
        const store = new TaskListStore({
            controller: controller as never,
            origin: "https://tasks.example",
            timeZone: "UTC",
            inboxProjectId: 7,
        });
        await store.refresh("inbox");
        await store.setIncompleteOnly("all", false);
        await store.toggleDone(1, true);

        expect(store.getState("inbox").items).toEqual([]);
        expect(store.getState("all").items[0]).toMatchObject({
            id: 1,
            done: true,
        });
    });

    it("rolls back a failed completion and gates offline writes", async () => {
        const controller = {
            call: vi
                .fn()
                .mockResolvedValueOnce(page([task(1)]))
                .mockResolvedValueOnce({
                    ok: false,
                    error: { code: "CONFLICT", message: "changed", retryable: false },
                }),
        };
        const store = new TaskListStore({
            controller: controller as never,
            origin: "https://tasks.example",
            timeZone: "UTC",
            inboxProjectId: 7,
        });
        await store.refresh("inbox");
        await store.toggleDone(1, true);
        expect(store.getState("inbox").items[0].done).toBe(false);

        const offlineCall = vi
            .fn()
            .mockResolvedValueOnce(page([task(1)]))
            .mockResolvedValueOnce({
                ok: false,
                error: { code: "NETWORK_ERROR", message: "offline", retryable: true },
            });
        const offlineStore = new TaskListStore({
            controller: { call: offlineCall } as never,
            origin: "https://tasks.example",
            timeZone: "UTC",
            inboxProjectId: 7,
        });
        await offlineStore.refresh("inbox");
        await offlineStore.refresh("inbox");
        await offlineStore.toggleDone(1, true);
        expect(offlineCall).toHaveBeenCalledTimes(2);
        expect(offlineStore.getState("inbox").status).toBe("offline");
    });

    it("deduplicates appended pages and preserves visible ordering", async () => {
        const controller = {
            call: vi
                .fn()
                .mockResolvedValueOnce(page([task(1), task(2)], 3, 1))
                .mockResolvedValueOnce(page([task(2), task(3)], 3, 2)),
        };
        const store = new TaskListStore({
            controller: controller as never,
            origin: "https://tasks.example",
            timeZone: "UTC",
        });
        await store.activate("all");
        await store.loadNextPage();
        expect(store.getState("all").items.map((item) => item.id)).toEqual([
            1, 2, 3,
        ]);
    });

    it("keeps the server total in sync when a task is removed locally", async () => {
        const controller = {
            call: vi
                .fn()
                .mockResolvedValueOnce(page([task(1), task(2)], 5, 1))
                .mockResolvedValueOnce(page([task(1), task(2)], 7, 1)),
        };
        const store = new TaskListStore({
            controller: controller as never,
            origin: "https://tasks.example",
            timeZone: "UTC",
            inboxProjectId: 7,
        });
        await store.refresh("inbox");
        await store.refresh("all");

        store.removeTask(1);

        // The tab badges and the footer read `total`, so a local deletion must
        // move it in every view that listed the task.
        expect(store.getState("inbox").total).toBe(4);
        expect(store.getState("all").total).toBe(6);
        expect(store.getState("inbox").items.map((item) => item.id)).toEqual([
            2,
        ]);

        // A task that was never loaded must not move the server-reported total.
        store.removeTask(99);
        expect(store.getState("inbox").total).toBe(4);
        expect(store.getState("all").total).toBe(6);
    });

    it("decrements the total when a completion filters the row out", async () => {
        const authoritative: TaskDetail = {
            ...task(1),
            done: true,
            descriptionMarkdown: "",
            reminders: [],
            repeat: { kind: "none" },
            attachments: [],
            maxPermission: "write",
            etag: "v2",
        };
        const controller = {
            call: vi
                .fn()
                .mockResolvedValueOnce(page([task(1)], 4, 1))
                .mockResolvedValueOnce({ ok: true, data: authoritative }),
        };
        const store = new TaskListStore({
            controller: controller as never,
            origin: "https://tasks.example",
            timeZone: "UTC",
            inboxProjectId: 7,
        });
        await store.refresh("inbox");
        expect(store.getState("inbox").total).toBe(4);

        await store.toggleDone(1, true);

        expect(store.getState("inbox").items).toEqual([]);
        expect(store.getState("inbox").total).toBe(3);
    });

    it("re-queries an already loaded view every time it is activated", async () => {
        const call = vi.fn().mockResolvedValue(page([task(1)], 1, 1));
        const store = new TaskListStore({
            controller: { call } as never,
            origin: "https://tasks.example",
            timeZone: "UTC",
            inboxProjectId: 7,
        });
        await store.activate("all");
        await store.activate("all");
        expect(call).toHaveBeenCalledTimes(2);
    });
});
