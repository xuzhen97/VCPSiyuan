import { describe, expect, it } from "vitest";
import { buildTaskTree } from "../../src/frontend/dock/taskTree.js";
import { TaskSummary } from "../../src/shared/task.js";

const task = (
    id: number,
    parentTaskIds: number[] = [],
    childTaskIds: number[] = [],
): TaskSummary => ({
    id,
    title: `Task ${id}`,
    done: false,
    parentTaskIds,
    childTaskIds,
});

describe("buildTaskTree", () => {
    it("keeps a child at root until a parent is loaded, then places it under one stable parent", () => {
        const child = task(3, [2, 1]);
        expect(buildTaskTree([child]).map((node) => node.task.id)).toEqual([3]);

        const tree = buildTaskTree([
            task(1, [], [3]),
            child,
            task(2, [], [3]),
        ]);
        expect(tree.map((node) => node.task.id)).toEqual([1, 2]);
        expect(tree[0].children.map((node) => node.task.id)).toEqual([3]);
        expect(tree[1].children).toEqual([]);
    });

    it("accepts either side of the direct relation when the other side is absent", () => {
        const tree = buildTaskTree([
            task(10, [], [11]),
            task(11),
        ]);
        expect(tree.map((node) => node.task.id)).toEqual([10]);
        expect(tree[0].children.map((node) => node.task.id)).toEqual([11]);
    });

    it("breaks inconsistent cycles without losing or duplicating tasks", () => {
        const tree = buildTaskTree([
            task(1, [2], [2]),
            task(2, [1], [1]),
            task(3),
        ]);
        const ids: number[] = [];
        const visit = (nodes: typeof tree): void => {
            for (const node of nodes) {
                ids.push(node.task.id);
                visit(node.children);
            }
        };
        visit(tree);
        expect(ids.sort((a, b) => a - b)).toEqual([1, 2, 3]);
    });
});
