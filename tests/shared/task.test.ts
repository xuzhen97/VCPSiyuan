import { describe, expect, it } from "vitest";
import {
    repeatFromWire,
    repeatToWire,
} from "../../src/shared/task.js";

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
