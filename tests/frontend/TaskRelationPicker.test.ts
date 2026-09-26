// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { TaskRelationPicker } from "../../src/frontend/dialogs/TaskRelationPicker.js";
import { Page } from "../../src/shared/pagination.js";
import { TaskSummary } from "../../src/shared/task.js";

const result = (items: TaskSummary[], page = 1, total = items.length): Page<TaskSummary> => ({
    items,
    total,
    page,
    perPage: 2,
});

const candidate = (id: number): TaskSummary => ({
    id,
    title: `Task ${id}`,
    done: false,
    projectId: 7,
});

const i18n = {
    title: "Link existing subtask",
    search: "Search tasks",
    searchAction: "Search",
    loading: "Loading",
    empty: "No tasks",
    loadMore: "Load more",
    select: "Link",
    close: "Close",
    retry: "Retry",
    project: "Project",
    error: "Search failed",
};

describe("TaskRelationPicker", () => {
    it("searches server pages, excludes self and existing children, and selects a candidate", async () => {
        const search = vi.fn().mockResolvedValue(result([candidate(1), candidate(3)], 1, 3));
        const onSelect = vi.fn();
        const element = document.createElement("div");
        const picker = new TaskRelationPicker({
            taskId: 1,
            childTaskIds: [2],
            search,
            i18n,
            onSelect,
        });
        picker.mount(element);
        const input = element.querySelector<HTMLInputElement>("input[type=search]")!;
        input.value = "roadmap";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
        expect(search).toHaveBeenCalledWith("roadmap", 1, 50);
        expect(element.querySelector("[data-task-id='1']")).toBeNull();
        expect(element.querySelector("[data-task-id='2']")).toBeNull();
        expect(element.querySelector("[data-task-id='3']")).not.toBeNull();
        element.querySelector<HTMLButtonElement>("[data-action='select-3']")!.click();
        expect(onSelect).toHaveBeenCalledWith(candidate(3));
    });

    it("ignores stale search responses and lets the latest query win", async () => {
        let resolveOld!: (page: Page<TaskSummary>) => void;
        const search = vi.fn()
            .mockImplementationOnce(() => new Promise<Page<TaskSummary>>((resolve) => { resolveOld = resolve; }))
            .mockResolvedValueOnce(result([candidate(8)]));
        const element = document.createElement("div");
        const picker = new TaskRelationPicker({ taskId: 1, childTaskIds: [], search, i18n, onSelect: vi.fn() });
        picker.mount(element);
        const input = element.querySelector<HTMLInputElement>("input[type=search]")!;
        input.value = "old";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
        input.value = "new";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await vi.waitFor(() => expect(element.textContent).toContain("Task 8"));
        resolveOld(result([candidate(7)]));
        await Promise.resolve();
        expect(element.querySelector("[data-task-id='7']")).toBeNull();
    });
});
