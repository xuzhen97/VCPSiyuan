import { describe, expect, it } from "vitest";
import {
    FocusGroups,
    TaskSummary,
    groupFocusTasks,
    groupPlannedTasks,
    repeatFromWire,
    repeatToWire,
} from "../../src/shared/task.js";

function task(id: number, overrides: Partial<TaskSummary> = {}): TaskSummary {
    return {
        id,
        title: `Task ${id}`,
        done: false,
        project: { id: 1, title: "Inbox" },
        labels: [],
        assignees: [],
        startAt: null,
        dueAt: null,
        priority: 1,
        attachmentCount: 0,
        linkedBlockCount: 0,
        updatedAt: `2026-09-13T00:00:0${id}Z`,
        ...overrides,
    };
}

describe("task grouping", () => {
    it("does not duplicate focus tasks and caps next-step items at ten", () => {
        const tasks = [
            task(1, { dueAt: "2026-09-12T08:00:00Z", priority: 3 }),
            task(2, { startAt: "2026-09-13T08:00:00Z", priority: 2 }),
            ...Array.from({ length: 12 }, (_, index) =>
                task(index + 3, {
                    priority: 1,
                    updatedAt: `2026-09-13T00:00:${index.toString().padStart(2, "0")}Z`,
                }),
            ),
        ];

        const groups: FocusGroups = groupFocusTasks(
            tasks,
            new Date("2026-09-13T10:00:00Z"),
            "Asia/Shanghai",
        );

        expect(groups.overdue.map((item) => item.id)).toEqual([1]);
        expect(groups.today.map((item) => item.id)).toEqual([2]);
        expect(groups.next).toHaveLength(10);
        expect(
            new Set(
                Object.values(groups)
                    .flat()
                    .map((item) => item.id),
            ).size,
        ).toBe(12);
    });

    it("groups future tasks using the supplied local timezone", () => {
        const groups = groupPlannedTasks(
            [
                task(1, { dueAt: "2026-09-15T00:30:00Z" }),
                task(2, { dueAt: "2026-09-18T00:30:00Z" }),
                task(3, { dueAt: "2026-09-25T00:30:00Z" }),
            ],
            new Date("2026-09-14T02:00:00Z"),
            "Asia/Shanghai",
            "en-US",
        );

        expect(groups.tomorrow.map((item) => item.id)).toEqual([1]);
        expect(groups.thisWeek.map((item) => item.id)).toEqual([2]);
        expect(groups.nextWeek.map((item) => item.id)).toEqual([3]);
    });
});

describe("repeat rule wire encoding", () => {
    it("encodes days and weeks as a seconds interval with mode 0", () => {
        // Vikunja's repeat_after is SECONDS and repeat_mode is an integer enum;
        // sending the unit name is rejected with HTTP 422.
        expect(
            repeatToWire({ kind: "editable", every: 3, unit: "day" }),
        ).toEqual({
            repeatAfter: 3 * 86_400,
            repeatMode: 0,
        });
        expect(
            repeatToWire({ kind: "editable", every: 2, unit: "week" }),
        ).toEqual({ repeatAfter: 14 * 86_400, repeatMode: 0 });
    });

    it("encodes a month rule with the monthly mode", () => {
        expect(
            repeatToWire({ kind: "editable", every: 1, unit: "month" }),
        ).toEqual({ repeatAfter: 0, repeatMode: 1 });
    });

    it("clears a rule with nulls and leaves unmodelled rules untouched", () => {
        expect(repeatToWire({ kind: "none" })).toEqual({
            repeatAfter: null,
            repeatMode: null,
        });
        expect(
            repeatToWire({
                kind: "preserved",
                summary: "custom",
                raw: { repeat_mode: 2 },
            }),
        ).toBeUndefined();
    });

    it("round-trips every editable rule", () => {
        const rules = [
            { kind: "editable", every: 1, unit: "day" },
            { kind: "editable", every: 5, unit: "day" },
            { kind: "editable", every: 1, unit: "week" },
            { kind: "editable", every: 3, unit: "week" },
            { kind: "editable", every: 1, unit: "month" },
        ] as const;
        for (const rule of rules) {
            const wire = repeatToWire(rule);
            expect(wire).toBeDefined();
            expect(repeatFromWire(wire?.repeatAfter, wire?.repeatMode)).toEqual(
                rule,
            );
        }
    });

    it("treats zero as no repetition and preserves what it cannot express", () => {
        expect(repeatFromWire(0, 0)).toEqual({ kind: "none" });
        expect(repeatFromWire(90, 0)).toMatchObject({ kind: "preserved" });
        expect(repeatFromWire(0, 2)).toMatchObject({ kind: "preserved" });
    });
});
