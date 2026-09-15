import { describe, expect, it, vi } from "vitest";
import { TaskListStore } from "../../src/frontend/stores/TaskListStore.js";
import { TaskDetail, TaskSummary } from "../../src/shared/task.js";

function task(id: number, title = `Task ${id}`): TaskSummary {
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
    it("reports that it needs configuration until an Origin is set", () => {
        const controller = { call: vi.fn() };
        const store = new TaskListStore({
            controller: controller as never,
            origin: "  ",
            timeZone: "UTC",
        });
        expect(store.needsConfiguration()).toBe(true);
        store.updateConfig("https://tasks.example", null);
        expect(store.needsConfiguration()).toBe(false);
    });

    it("keeps independent view state and ignores a late response from an old generation", async () => {
        const focus = deferred<{
            ok: true;
            data: {
                items: TaskSummary[];
                total: number;
                page: number;
                perPage: number;
            };
        }>();
        const controller = {
            call: vi
                .fn()
                .mockImplementationOnce(() => focus.promise)
                .mockResolvedValueOnce({
                    ok: true,
                    data: {
                        items: [task(2, "Inbox")],
                        total: 1,
                        page: 1,
                        perPage: 50,
                    },
                }),
        };
        const store = new TaskListStore({
            controller: controller as never,
            origin: "https://tasks.example",
            timeZone: "Asia/Shanghai",
        });
        const focusPromise = store.refresh("focus");
        await store.refresh("inbox");
        focus.resolve({
            ok: true,
            data: {
                items: [task(1, "Late focus")],
                total: 1,
                page: 1,
                perPage: 50,
            },
        });
        await focusPromise;
        expect(store.getState("inbox").items.map((item) => item.title)).toEqual(
            ["Inbox"],
        );
        expect(store.getState("focus").items.map((item) => item.title)).toEqual(
            ["Late focus"],
        );
    });

    it("uses explicit filter enablement and composes filters as an intersection", async () => {
        const call = vi.fn().mockResolvedValue({
            ok: true,
            data: {
                items: [
                    task(1),
                    {
                        ...task(2),
                        assignees: [
                            { id: 42, username: "me", displayName: "Me" },
                        ],
                    },
                    task(3),
                ],
                total: 3,
                page: 1,
                perPage: 50,
            },
        });
        const store = new TaskListStore({
            controller: { call } as never,
            origin: "https://tasks.example",
            timeZone: "UTC",
        });
        await store.refresh("focus");

        store.setCurrentDocumentFilter(true);
        store.setCurrentDocumentTaskIds(new Set([2]));
        expect(store.getVisibleItems("focus").map((item) => item.id)).toEqual([
            2,
        ]);

        store.setAssignedToMe(true, 42);
        expect(store.getVisibleItems("focus").map((item) => item.id)).toEqual([
            2,
        ]);
        expect(store.getFilterState()).toEqual({
            currentDocument: true,
            assignedToMe: true,
        });

        store.setCurrentDocumentFilter(false);
        expect(store.getVisibleItems("focus").map((item) => item.id)).toEqual([
            2,
        ]);
        store.setAssignedToMe(false);
        expect(store.getVisibleItems("focus").map((item) => item.id)).toEqual([
            1, 2, 3,
        ]);
    });

    it("treats an enabled current-document filter with no links as an empty result", async () => {
        const call = vi.fn().mockResolvedValue({
            ok: true,
            data: { items: [task(1)], total: 1, page: 1, perPage: 50 },
        });
        const store = new TaskListStore({
            controller: { call } as never,
            origin: "https://tasks.example",
            timeZone: "UTC",
        });
        await store.refresh("focus");
        store.setCurrentDocumentFilter(true);
        store.setCurrentDocumentTaskIds(new Set());
        expect(store.getVisibleItems("focus")).toEqual([]);
    });

    it("exposes shared focus and planned groups without completed tasks or duplicates", async () => {
        const call = vi.fn().mockResolvedValue({
            ok: true,
            data: {
                items: [
                    { ...task(1), dueAt: "2026-09-12T12:00:00Z" },
                    { ...task(2), dueAt: "2026-09-13T12:00:00Z" },
                    { ...task(3), priority: 2 },
                    { ...task(4), dueAt: "2026-09-14T12:00:00Z" },
                    { ...task(5), dueAt: "2026-09-20T12:00:00Z", done: true },
                    { ...task(6), dueAt: "2026-09-21T12:00:00Z" },
                ],
                total: 6,
                page: 1,
                perPage: 50,
            },
        });
        const store = new TaskListStore({
            controller: { call } as never,
            origin: "https://tasks.example",
            timeZone: "UTC",
        });
        await store.refresh("focus");
        await store.refresh("planned");

        expect(
            store.getGroups("focus", new Date("2026-09-13T12:00:00Z")),
        ).toEqual([
            { key: "overdue", items: [expect.objectContaining({ id: 1 })] },
            { key: "today", items: [expect.objectContaining({ id: 2 })] },
            { key: "next", items: [expect.objectContaining({ id: 3 })] },
        ]);
        expect(
            store.getGroups("planned", new Date("2026-09-13T12:00:00Z")),
        ).toEqual([
            { key: "tomorrow", items: [expect.objectContaining({ id: 4 })] },
            { key: "thisWeek", items: [] },
            { key: "nextWeek", items: [] },
            { key: "later", items: [expect.objectContaining({ id: 6 })] },
        ]);
    });

    it("optimistically completes a task and accepts the authoritative repeating response", async () => {
        const authoritative: TaskDetail = {
            ...task(1),
            done: true,
            dueAt: "2026-09-20T12:00:00Z",
            descriptionMarkdown: "",
            reminders: [],
            repeat: { kind: "editable", every: 1, unit: "week" },
            attachments: [],
            maxPermission: "write",
            etag: "v2",
        };
        const call = vi
            .fn()
            .mockResolvedValueOnce({
                ok: true,
                data: { items: [task(1)], total: 1, page: 1, perPage: 50 },
            })
            .mockResolvedValueOnce({ ok: true, data: authoritative });
        const store = new TaskListStore({
            controller: { call } as never,
            origin: "https://tasks.example",
            timeZone: "UTC",
        });
        await store.refresh("focus");

        await store.toggleDone(1, true);

        expect(call).toHaveBeenCalledWith("vikunja.tasks.patch", {
            taskId: 1,
            patch: { done: true },
            expected: { updatedAt: "2026-09-13T00:00:00Z" },
        });
        expect(store.getState("focus").items[0]).toMatchObject({
            id: 1,
            done: true,
            dueAt: "2026-09-20T12:00:00Z",
        });
    });

    it("rolls back a failed completion and gates writes offline or after destroy", async () => {
        const call = vi.fn().mockResolvedValue({
            ok: false,
            error: { code: "CONFLICT", message: "changed", retryable: false },
        });
        const store = new TaskListStore({
            controller: { call } as never,
            origin: "https://tasks.example",
            timeZone: "UTC",
        });
        call.mockResolvedValueOnce({
            ok: true,
            data: { items: [task(1)], total: 1, page: 1, perPage: 50 },
        });
        await store.refresh("focus");
        await store.toggleDone(1, true);
        expect(store.getState("focus").items[0].done).toBe(false);

        const offlineCall = vi
            .fn()
            .mockResolvedValueOnce({
                ok: true,
                data: { items: [task(1)], total: 1, page: 1, perPage: 50 },
            })
            .mockResolvedValueOnce({
                ok: false,
                error: {
                    code: "NETWORK_ERROR",
                    message: "offline",
                    retryable: true,
                },
            });
        const offlineStore = new TaskListStore({
            controller: { call: offlineCall } as never,
            origin: "https://tasks.example",
            timeZone: "UTC",
        });
        await offlineStore.refresh("focus");
        await offlineStore.refresh("focus");
        await offlineStore.toggleDone(1, true);
        expect(offlineCall).toHaveBeenCalledTimes(2);
        expect(offlineStore.getState("focus").status).toBe("offline");

        const late = deferred<unknown>();
        const destroyedCall = vi
            .fn()
            .mockResolvedValueOnce({
                ok: true,
                data: { items: [task(1)], total: 1, page: 1, perPage: 50 },
            })
            .mockReturnValueOnce(late.promise);
        const destroyedStore = new TaskListStore({
            controller: { call: destroyedCall } as never,
            origin: "https://tasks.example",
            timeZone: "UTC",
        });
        await destroyedStore.refresh("focus");
        const toggle = destroyedStore.toggleDone(1, true);
        destroyedStore.destroy();
        late.resolve({
            ok: true,
            data: { ...task(1), done: true, dueAt: "2026-09-30T00:00:00Z" },
        });
        await toggle;
        expect(destroyedCall).toHaveBeenCalledWith(
            "vikunja.tasks.patch",
            expect.anything(),
        );
        expect(destroyedStore.getState("focus").items[0].done).toBe(false);
        expect(destroyedStore.getState("focus").items[0].dueAt).toBeNull();
    });

    it("appends pages once and composes current-document and assigned filters", async () => {
        const controller = {
            call: vi
                .fn()
                .mockResolvedValueOnce({
                    ok: true,
                    data: {
                        items: [task(1), task(2)],
                        total: 3,
                        page: 1,
                        perPage: 2,
                    },
                })
                .mockResolvedValueOnce({
                    ok: true,
                    data: {
                        items: [task(2), task(3)],
                        total: 3,
                        page: 2,
                        perPage: 2,
                    },
                }),
        };
        const store = new TaskListStore({
            controller: controller as never,
            origin: "https://tasks.example",
            timeZone: "UTC",
            currentDocumentTaskIds: new Set([2, 3]),
            currentUserId: 9,
        });
        await store.refresh("focus");
        await store.loadNextPage();
        expect(store.getState("focus").items.map((item) => item.id)).toEqual([
            1, 2, 3,
        ]);
        expect(store.getVisibleItems("focus").map((item) => item.id)).toEqual([
            2, 3,
        ]);
    });
});
