import { TaskSummary } from "../../shared/task.js";

export interface TaskTreeNode {
    task: TaskSummary;
    children: TaskTreeNode[];
}

/**
 * Builds a deterministic tree from only the already-loaded flat task results.
 * A relationship is accepted when either side of Vikunja's direct relation
 * payload reports it. Tasks with unavailable parents remain roots; each task is
 * assigned at most once, and cycle-forming edges are ignored.
 */
export function buildTaskTree(items: TaskSummary[]): TaskTreeNode[] {
    const nodes = new Map<number, TaskTreeNode>();
    const positions = new Map<number, number>();
    for (const [index, task] of items.entries()) {
        if (nodes.has(task.id)) continue;
        nodes.set(task.id, { task, children: [] });
        positions.set(task.id, index);
    }

    const parentByChild = new Map<number, number>();
    for (const [childId, childNode] of nodes) {
        const candidates = new Set<number>();
        for (const parentId of childNode.task.parentTaskIds ?? [])
            if (nodes.has(parentId) && parentId !== childId)
                candidates.add(parentId);
        for (const [parentId, parentNode] of nodes)
            if (parentId !== childId && (parentNode.task.childTaskIds ?? []).includes(childId))
                candidates.add(parentId);

        const orderedCandidates = [...candidates].sort((left, right) => {
            const positionDifference =
                positions.get(left)! - positions.get(right)!;
            return positionDifference || left - right;
        });
        for (const parentId of orderedCandidates) {
            if (wouldCreateCycle(childId, parentId, parentByChild)) continue;
            parentByChild.set(childId, parentId);
            break;
        }
    }

    const roots: TaskTreeNode[] = [];
    for (const [taskId, node] of nodes) {
        const parentId = parentByChild.get(taskId);
        const parent = parentId === undefined ? undefined : nodes.get(parentId);
        if (parent) parent.children.push(node);
        else roots.push(node);
    }
    return roots;
}

function wouldCreateCycle(
    childId: number,
    parentId: number,
    parentByChild: Map<number, number>,
): boolean {
    let current: number | undefined = parentId;
    const visited = new Set<number>();
    while (current !== undefined && !visited.has(current)) {
        if (current === childId) return true;
        visited.add(current);
        current = parentByChild.get(current);
    }
    return false;
}
