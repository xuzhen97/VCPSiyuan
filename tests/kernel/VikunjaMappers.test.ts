import { describe, expect, it } from "vitest";
import {
    mapAttachment,
    mapUploadBatch,
} from "../../src/kernel/vikunja/mappers/attachmentMapper.js";
import { mapLabel } from "../../src/kernel/vikunja/mappers/labelMapper.js";
import { decodePermission } from "../../src/kernel/vikunja/mappers/permission.js";
import { mapProject } from "../../src/kernel/vikunja/mappers/projectMapper.js";
import {
    mapTaskDetail,
    mapTaskSummary,
} from "../../src/kernel/vikunja/mappers/taskMapper.js";

/**
 * Wire payloads in this file were captured from a real Vikunja v2.5.0 instance.
 * They exist because fixture-only tests previously froze the WRONG contract and
 * hid several defects; every assertion here corresponds to something the live
 * integration suite proved.
 */

// GET /api/v2/projects — the root project reports parent_project_id 0, not null.
const rootProjectWire = {
    id: 1,
    title: "Inbox",
    description: "",
    identifier: "",
    hex_color: "",
    parent_project_id: 0,
    is_archived: false,
    max_permission: 2,
};

function attachmentWire(): Record<string, unknown> {
    return {
        id: 7,
        task_id: 1,
        created_by: { id: 1, username: "testuser" },
        file: {
            id: 3,
            name: "probe.txt",
            mime: "text/plain; charset=utf-8",
            size: 21,
            created: "2026-09-13T11:54:53Z",
        },
        created: "2026-09-13T11:54:53Z",
    };
}

describe("permission decoding", () => {
    it("maps Vikunja's numeric enum to named permissions", () => {
        expect(decodePermission(0)).toBe("read");
        expect(decodePermission(1)).toBe("write");
        expect(decodePermission(2)).toBe("admin");
        // -1 / null is Vikunja's "unknown" and must not become a weaker guess.
        expect(decodePermission(-1)).toBe("unknown");
        expect(decodePermission(null)).toBe("unknown");
        expect(decodePermission(undefined)).toBe("unknown");
    });

    it("still tolerates an already-named permission", () => {
        expect(decodePermission("write")).toBe("write");
        expect(decodePermission("nonsense")).toBe("unknown");
    });
});

describe("project mapping", () => {
    it("treats parent_project_id 0 as a root project", () => {
        const project = mapProject(rootProjectWire);
        expect(project.parentProjectId).toBeNull();
        expect(project.maxPermission).toBe("admin");
        // An empty hex_color means "no colour", not a colour called "".
        expect(project.color).toBeNull();
    });

    it("keeps a real parent id", () => {
        const project = mapProject({
            ...rootProjectWire,
            id: 9,
            parent_project_id: 4,
        });
        expect(project.parentProjectId).toBe(4);
    });

    it("normalizes an empty label colour", () => {
        const label = mapLabel({
            id: 2,
            title: "urgent",
            description: "",
            hex_color: "",
            max_permission: 2,
        });
        expect(label.color).toBeNull();
        expect(label.maxPermission).toBe("admin");
    });

    it("treats an unreported label permission as writable", () => {
        // `GET /labels` omits max_permission, unlike the single-label read.
        const listed = mapLabel({
            id: 3,
            title: "from list",
            description: "",
            hex_color: "ff0000",
        });
        expect(listed.maxPermission).toBe("write");

        const readOnly = mapLabel({
            id: 4,
            title: "from read",
            description: "",
            hex_color: "ff0000",
            max_permission: 0,
        });
        expect(readOnly.maxPermission).toBe("read");
    });
});

describe("attachment mapping", () => {
    it("reads file metadata nested under `file`", () => {
        const attachment = mapAttachment(attachmentWire());
        expect(attachment).toEqual({
            id: 7,
            name: "probe.txt",
            size: 21,
            mimeType: "text/plain; charset=utf-8",
            createdAt: "2026-09-13T11:54:53Z",
        });
    });

    it("maps the real upload response keys and its unnamed failures", () => {
        const result = mapUploadBatch({
            errors: [{ code: 4003, message: "File too large" }],
            success: [attachmentWire()],
        });
        expect(result.succeeded.map((item) => item.name)).toEqual([
            "probe.txt",
        ]);
        expect(result.failed).toHaveLength(1);
        // Vikunja reports a numeric code and does not name the failed file.
        expect(result.failed[0].code).toBe("4003");
        expect(result.failed[0].message).toBe("File too large");
        expect(result.failed[0].fileName).toBe("");
    });

    it("accepts a null errors list from a fully successful upload", () => {
        const result = mapUploadBatch({
            errors: null,
            success: [attachmentWire()],
        });
        expect(result.failed).toEqual([]);
        expect(result.succeeded).toHaveLength(1);
    });
});

describe("task mapping", () => {
    const taskWire = {
        id: 5,
        title: "live task",
        done: false,
        project_id: 1,
        description: "# body",
        priority: 3,
        due_date: "2026-10-01T10:00:00Z",
        start_date: "0001-01-01T00:00:00Z",
        reminders: null,
        labels: null,
        assignees: null,
        repeat_after: 0,
        repeat_mode: 0,
        max_permission: 2,
        updated: "2026-09-13T11:51:24Z",
        attachments: [attachmentWire()],
    };

    it("normalizes null collections and zero dates", () => {
        const detail = mapTaskDetail(taskWire);
        expect(detail.reminders).toEqual([]);
        expect(detail.labels).toEqual([]);
        expect(detail.assignees).toEqual([]);
        expect(detail.startAt).toBeNull();
        expect(detail.repeat).toEqual({ kind: "none" });
        expect(detail.maxPermission).toBe("admin");
    });

    it("maps attachments on the task detail", () => {
        expect(mapTaskDetail(taskWire).attachments).toEqual([
            {
                id: 7,
                name: "probe.txt",
                size: 21,
                mimeType: "text/plain; charset=utf-8",
                createdAt: "2026-09-13T11:54:53Z",
            },
        ]);
        expect(mapTaskDetail(taskWire).attachmentCount).toBe(1);
    });

    it("decodes a seconds interval plus integer mode into an editable rule", () => {
        // Two weeks, mode 0 (repeat after repeat_after seconds).
        expect(
            mapTaskDetail({
                ...taskWire,
                repeat_after: 1_209_600,
                repeat_mode: 0,
            }).repeat,
        ).toEqual({ kind: "editable", every: 2, unit: "week" });
        // Monthly mode ignores repeat_after.
        expect(
            mapTaskDetail({ ...taskWire, repeat_after: 0, repeat_mode: 1 })
                .repeat,
        ).toEqual({ kind: "editable", every: 1, unit: "month" });
        // Anything the editor cannot express is preserved, never approximated.
        expect(
            mapTaskDetail({ ...taskWire, repeat_after: 90, repeat_mode: 0 })
                .repeat,
        ).toMatchObject({ kind: "preserved" });
        expect(
            mapTaskDetail({ ...taskWire, repeat_after: 60, repeat_mode: 2 })
                .repeat,
        ).toMatchObject({ kind: "preserved" });
    });

    it("does not invent a project id when the task has no project", () => {
        const summary = mapTaskSummary({
            id: 6,
            title: "orphan",
            project_id: null,
        });
        expect(summary.project).toBeUndefined();
        expect(summary.projectId).toBeNull();
    });
});
