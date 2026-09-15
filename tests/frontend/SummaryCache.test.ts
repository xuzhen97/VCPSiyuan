import { describe, expect, it } from "vitest";
import { SummaryCache } from "../../src/frontend/persistence/SummaryCache.js";
import { TaskSummary } from "../../src/shared/task.js";

const task: TaskSummary = {
    id: 1,
    title: "Read",
    done: false,
    project: { id: 2, title: "Inbox" },
    labels: [{ id: 3, title: "work" }],
    assignees: [{ id: 4, username: "u", displayName: "User" }],
    startAt: null,
    dueAt: "2026-09-20T00:00:00Z",
    priority: 2,
    attachmentCount: 1,
    linkedBlockCount: 1,
    updatedAt: "2026-09-13T00:00:00Z",
};

describe("SummaryCache", () => {
    it("persists only minimum summaries partitioned by origin and view", async () => {
        let stored: unknown;
        const cache = new SummaryCache({
            load: async () => stored,
            save: async (_name, value) => {
                stored = value;
            },
        });
        await cache.save("https://tasks.example", "focus", {
            page: 1,
            perPage: 50,
            items: [task],
            total: 1,
        });
        const raw = JSON.stringify(stored);
        expect(raw).not.toContain("description");
        expect(raw).not.toContain("token");
        expect(raw).not.toContain("avatarUrl");
        expect(
            await cache.load("https://tasks.example", "focus"),
        ).toMatchObject({ items: [{ id: 1, title: "Read" }] });
    });

    it("discards corrupt and wrong-schema snapshots", async () => {
        const cache = new SummaryCache({
            load: async () => ({ schemaVersion: 99 }),
            save: async () => {},
        });
        expect(await cache.load("https://tasks.example", "focus")).toBeNull();
    });
});
