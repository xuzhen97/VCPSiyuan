import { describe, expect, it, vi } from "vitest";
import { TaskDetailStore } from "../../src/frontend/stores/TaskDetailStore.js";
import { TaskDetail } from "../../src/shared/task.js";

function detail(overrides: Partial<TaskDetail> = {}): TaskDetail {
    return {
        id: 1,
        title: "Task",
        done: false,
        project: { id: 2, title: "Inbox" },
        labels: [],
        assignees: [],
        startAt: null,
        dueAt: null,
        priority: 1,
        attachmentCount: 0,
        linkedBlockCount: 0,
        updatedAt: "v1",
        descriptionMarkdown: "",
        reminders: [],
        repeat: { kind: "none" },
        attachments: [],
        parentTasks: [],
        childTasks: [],
        maxPermission: "write",
        etag: '"v1"',
        ...overrides,
    };
}

describe("TaskDetailStore", () => {
    it("uses the authoritative response for a repeating task and serializes toggles", async () => {
        const calls: boolean[] = [];
        const controller = {
            call: vi
                .fn()
                .mockImplementation(
                    async (
                        _method: string,
                        request: { patch?: { done?: boolean } },
                    ) => {
                        calls.push(request.patch?.done ?? false);
                        await Promise.resolve();
                        return {
                            ok: true,
                            data: detail({
                                done: false,
                                dueAt: "2026-09-20T00:00:00Z",
                                updatedAt: "v2",
                            }),
                        };
                    },
                ),
        };
        const store = new TaskDetailStore({ controller: controller as never });
        store.setDetail(
            detail({ repeat: { kind: "editable", every: 1, unit: "day" } }),
        );
        await Promise.all([store.toggleDone(true), store.toggleDone(false)]);
        expect(calls).toEqual([true, false]);
        expect(store.getDetail()?.done).toBe(false);
        expect(store.getDetail()?.dueAt).toBe("2026-09-20T00:00:00Z");
    });

    it("rolls back on network failure and exposes retryable error", async () => {
        const controller = {
            call: vi.fn().mockResolvedValue({
                ok: false,
                error: {
                    code: "NETWORK_ERROR",
                    message: "offline",
                    retryable: true,
                },
            }),
        };
        const store = new TaskDetailStore({ controller: controller as never });
        store.setDetail(detail());
        await store.toggleDone(true);
        expect(store.getDetail()?.done).toBe(false);
        expect(store.getState().error?.code).toBe("NETWORK_ERROR");
    });

    it("publishes state changes and ignores an older open response", async () => {
        const resolvers: Array<(value: unknown) => void> = [];
        const controller = {
            call: vi
                .fn()
                .mockImplementation(
                    () => new Promise((resolve) => resolvers.push(resolve)),
                ),
        };
        const store = new TaskDetailStore({ controller: controller as never });
        const statuses: string[] = [];
        store.subscribe(() => statuses.push(store.getState().status));
        const first = store.open(1);
        const second = store.open(2);
        resolvers[1]({
            ok: true,
            data: { value: detail({ id: 2, title: "new" }), updatedAt: "v2" },
        });
        await second;
        resolvers[0]({
            ok: true,
            data: { value: detail({ id: 1, title: "old" }), updatedAt: "v1" },
        });
        await first;
        expect(store.getDetail()?.id).toBe(2);
        expect(statuses).toContain("loading");
        expect(statuses).toContain("ready");
    });

    it("marks retryable detail failures as offline and can retry the current task", async () => {
        const controller = {
            call: vi
                .fn()
                .mockResolvedValueOnce({
                    ok: false,
                    error: {
                        code: "NETWORK_ERROR",
                        message: "offline",
                        retryable: true,
                    },
                })
                .mockResolvedValueOnce({
                    ok: true,
                    data: {
                        value: detail({ title: "recovered" }),
                        updatedAt: "v2",
                    },
                }),
        };
        const store = new TaskDetailStore({ controller: controller as never });
        await store.open(1);
        expect(store.getState().status).toBe("offline");
        await store.retry();
        expect(store.getDetail()?.title).toBe("recovered");
        expect(controller.call).toHaveBeenCalledTimes(2);
    });

    it("uses a read-only offline summary snapshot and refuses completion", async () => {
        const call = vi.fn().mockResolvedValue({
            ok: false,
            error: {
                code: "NETWORK_ERROR",
                message: "offline",
                retryable: true,
            },
        });
        const store = new TaskDetailStore({
            controller: { call } as never,
            getOfflineSnapshot: () => ({
                ...detail(),
                description: "cached summary",
            }),
        });
        await store.open(1);
        expect(store.getState().status).toBe("offline");
        expect(store.getDetail()).toMatchObject({
            title: "Task",
            maxPermission: "read",
        });
        await store.toggleDone(true);
        expect(call).toHaveBeenCalledTimes(1);
    });

    it("links and unlinks a child through the current parent and adopts authoritative details", async () => {
        const authoritative = detail({
            childTasks: [{ id: 33, title: "Saved child", done: false, projectId: 7 }],
            updatedAt: "v2",
        });
        const controller = {
            call: vi.fn().mockResolvedValue({ ok: true, data: authoritative }),
        };
        const store = new TaskDetailStore({ controller: controller as never });
        store.setDetail(detail());
        await expect(store.linkChild(33)).resolves.toBe(true);
        expect(controller.call).toHaveBeenNthCalledWith(1, "vikunja.tasks.linkChild", {
            parentTaskId: 1,
            childTaskId: 33,
        });
        expect(store.getDetail()?.childTasks).toEqual(authoritative.childTasks);
        await store.unlinkChild(33);
        expect(controller.call).toHaveBeenNthCalledWith(2, "vikunja.tasks.unlinkChild", {
            parentTaskId: 1,
            childTaskId: 33,
        });
    });

    it("completes the selected direct child by its own task ID", async () => {
        const controller = {
            call: vi.fn().mockResolvedValue({ ok: true, data: detail() }),
        };
        const store = new TaskDetailStore({ controller: controller as never });
        store.setDetail(detail({
            childTasks: [{ id: 33, title: "Child", done: false, projectId: 7 }],
        }));
        await store.toggleDoneForTask(33, true);
        expect(controller.call).toHaveBeenCalledWith("vikunja.tasks.patch", {
            taskId: 33,
            patch: { done: true },
            expected: {},
        });
    });

    it("refuses relation writes from a read-only offline detail", async () => {
        const call = vi.fn();
        const store = new TaskDetailStore({ controller: { call } as never });
        store.setDetail(detail({ maxPermission: "read" }));
        await expect(store.linkChild(33)).resolves.toBe(false);
        expect(call).not.toHaveBeenCalled();
    });

    it("does not apply a response after destroy", async () => {
        let resolve!: (value: unknown) => void;
        const controller = {
            call: vi.fn().mockReturnValue(
                new Promise((done) => {
                    resolve = done;
                }),
            ),
        };
        const store = new TaskDetailStore({ controller: controller as never });
        store.setDetail(detail());
        const pending = store.toggleDone(true);
        store.destroy();
        resolve({ ok: true, data: detail({ done: true }) });
        await pending;
        expect(store.getDetail()?.done).toBe(false);
    });
});
