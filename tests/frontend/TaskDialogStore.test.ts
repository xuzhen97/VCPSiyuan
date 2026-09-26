import { describe, expect, it } from "vitest";
import { TaskDialogStore } from "../../src/frontend/stores/TaskDialogStore.js";
import { TaskDetail } from "../../src/shared/task.js";

const detail: TaskDetail = {
    id: 1,
    title: "Original",
    done: false,
    project: { id: 2, title: "Inbox" },
    labels: [{ id: 3, title: "old" }],
    assignees: [],
    startAt: null,
    dueAt: null,
    priority: 1,
    attachmentCount: 0,
    linkedBlockCount: 0,
    updatedAt: "v1",
    descriptionMarkdown: "# Body",
    reminders: [{ at: "2026-09-14T00:00:00Z" }],
    repeat: {
        kind: "preserved",
        summary: "advanced",
        raw: { mode: "monthly" },
    },
    attachments: [],
    parentTasks: [],
    childTasks: [],
    maxPermission: "write",
    etag: '"v1"',
};

describe("TaskDialogStore", () => {
    it("starts clean and patches only changed scalar fields", () => {
        const store = TaskDialogStore.edit(detail);
        expect(store.getPatch()).toEqual({});
        store.setField("title", "Changed");
        expect(store.getPatch()).toEqual({ title: "Changed" });
        expect(store.getRelationChanges()).toEqual({
            labels: undefined,
            assignees: undefined,
        });
    });

    it("encodes an editable repeat rule as seconds and an integer mode", () => {
        const store = TaskDialogStore.edit(detail);
        store.setField("priority", 3);
        expect(store.getPatch()).toEqual({ priority: 3 });
        store.setRepeat({ kind: "editable", every: 2, unit: "week" });
        // Vikunja expects repeat_after in SECONDS and repeat_mode as an integer
        // enum, never a unit name. "every 2 weeks" is 14 days in seconds.
        expect(store.getPatch()).toMatchObject({
            repeatAfter: 14 * 86_400,
            repeatMode: 0,
        });
    });

    it("clears a repeat rule with nulls and preserves unmodelled rules", () => {
        const editable = TaskDialogStore.edit(detail);
        editable.setRepeat({ kind: "none" });
        expect(editable.getPatch()).toMatchObject({
            repeatAfter: null,
            repeatMode: null,
        });

        // The fixture already carries a preserved (unknown) rule; changing an
        // unrelated field must not submit any repeat field at all.
        const preserved = TaskDialogStore.edit(detail);
        expect(preserved.getPatch().repeatAfter).toBeUndefined();
        expect(preserved.getPatch().repeatMode).toBeUndefined();
    });

    it("normalizes reminder timestamps and keeps relation sets separate", () => {
        const store = TaskDialogStore.edit(detail);
        store.setReminders([
            { at: "2026-09-15T00:00:00Z" },
            { at: "2026-09-14T00:00:00Z" },
            { at: "2026-09-15T00:00:00Z" },
        ]);
        store.setLabels([5, 4]);
        store.setAssignees([8, 9]);
        expect(store.getPatch().reminders).toEqual([
            { at: "2026-09-14T00:00:00Z" },
            { at: "2026-09-15T00:00:00Z" },
        ]);
        expect(store.getRelationChanges()).toEqual({
            labels: { before: [3], after: [4, 5] },
            assignees: { before: [], after: [8, 9] },
        });
    });

    it("validates writable projects and preserves inaccessible historical assignees", () => {
        const store = TaskDialogStore.edit({
            ...detail,
            assignees: [{ id: 8, username: "old", displayName: "Old member" }],
        });
        expect(
            store.validate([
                {
                    id: 2,
                    title: "Inbox",
                    descriptionMarkdown: "",
                    color: null,
                    parentProjectId: null,
                    archived: false,
                    maxPermission: "read",
                },
            ]),
        ).toEqual({ projectId: "PROJECT_NOT_WRITABLE" });

        store.setAvailableAssignees([]);
        expect(store.getUnavailableAssigneeIds()).toEqual([8]);
        store.setAvailableAssignees([
            { id: 8, username: "old", displayName: "Old member" },
        ]);
        expect(store.getUnavailableAssigneeIds()).toEqual([]);
    });

    it("supports reload and selected-field rebase after a conflict", () => {
        const store = TaskDialogStore.edit(detail);
        store.setField("title", "Local title");
        const remote = { ...detail, title: "Remote title", priority: 4 };
        store.markConflict(remote);
        expect(store.getConflict()?.remote.title).toBe("Remote title");

        store.rebaseOnto(remote, ["title"]);
        expect(store.getDraft()).toMatchObject({
            title: "Local title",
            priority: 4,
        });
        expect(store.getConflict()).toBeUndefined();

        store.reloadFrom(remote);
        expect(store.getDraft().title).toBe("Remote title");
        expect(store.isDirty()).toBe(false);
    });

    it("keeps Block linking disabled until explicitly selected", () => {
        expect(
            TaskDialogStore.create({
                projectId: 2,
                linkedBlockId: "block-1",
            }).getBlockLink(),
        ).toEqual({ enabled: false, blockId: "block-1" });
        expect(TaskDialogStore.create({ projectId: 2 }).getBlockLink()).toEqual(
            { enabled: false, blockId: undefined },
        );
    });
});
