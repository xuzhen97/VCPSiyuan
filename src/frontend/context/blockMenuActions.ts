import { RpcResult } from "../../shared/contracts.js";
import { TaskDetail } from "../../shared/task.js";
import { BlockLinkRepository } from "./BlockLinkRepository.js";
import {
    BlockSummary,
    SiYuanContextController,
} from "../controller/SiYuanContextController.js";
import { TaskLinkIndex, TaskLinkIndexEntry } from "./TaskLinkIndex.js";

interface TaskLookup {
    id: number;
    title: string;
}

export interface BlockCreateDialogRequest {
    blockIds: string[];
    blockSummaries: BlockSummary[];
    projectId: number;
    initialTitle: string;
    childParentTaskId?: number;
    onCreated: (taskId: number) => Promise<void>;
}

export interface BlockMenuWorkflowI18n {
    missingInboxProject: string;
    blocksUnreadable: string;
    blockActionFailed: string;
}

export interface BlockMenuWorkflowOptions {
    context: SiYuanContextController;
    links: BlockLinkRepository;
    index: Pick<TaskLinkIndex, "upsert" | "remove">;
    getProjectId: () => number | null;
    promptTaskId: () => string | null;
    notify: (message: string) => void;
    openCreateDialog: (
        request: BlockCreateDialogRequest,
    ) => void | Promise<void>;
    openTask: (taskId: number) => void | Promise<void>;
    getTask: (
        taskId: number,
    ) => Promise<RpcResult<{ value: TaskLookup | TaskDetail }>>;
    i18n: BlockMenuWorkflowI18n;
}

export interface BlockMenuWorkflowActions {
    onCreate: (blockIds: string[]) => Promise<void>;
    onLink: (blockIds: string[]) => Promise<void>;
    onView: (blockIds: string[]) => Promise<void>;
    onUnlink: (blockIds: string[]) => Promise<void>;
}

export function createBlockMenuActions(
    options: BlockMenuWorkflowOptions,
): BlockMenuWorkflowActions {
    return {
        onCreate: (blockIds) =>
            runSafely(() => createTask(blockIds, options), options),
        onLink: (blockIds) =>
            runSafely(() => linkExistingTask(blockIds, options), options),
        onView: (blockIds) =>
            runSafely(() => viewLinkedTasks(blockIds, options), options),
        onUnlink: (blockIds) =>
            runSafely(() => unlinkTask(blockIds, options), options),
    };
}

async function runSafely(
    action: () => Promise<void>,
    options: BlockMenuWorkflowOptions,
): Promise<void> {
    try {
        await action();
    } catch {
        options.notify(options.i18n.blockActionFailed);
    }
}

async function createTask(
    blockIds: string[],
    options: BlockMenuWorkflowOptions,
): Promise<void> {
    const projectId = options.getProjectId();
    if (!projectId) {
        options.notify(options.i18n.missingInboxProject);
        return;
    }
    const summaries = await getSummaries(blockIds, options);
    if (summaries.length !== blockIds.length) {
        options.notify(options.i18n.blocksUnreadable);
        return;
    }
    await options.openCreateDialog({
        blockIds: [...blockIds],
        blockSummaries: summaries,
        projectId,
        initialTitle: summaries[0]?.title ?? "",
        onCreated: async (taskId) => {
            await linkAndIndex(blockIds, taskId, summaries, options);
        },
    });
}

async function linkExistingTask(
    blockIds: string[],
    options: BlockMenuWorkflowOptions,
): Promise<void> {
    const taskId = parseTaskId(options.promptTaskId());
    if (!taskId) return;
    const result = await options.getTask(taskId);
    if (!result.ok) {
        options.notify(result.error.message || result.error.code);
        return;
    }
    const summaries = await getSummaries(blockIds, options);
    if (summaries.length !== blockIds.length) {
        options.notify(options.i18n.blocksUnreadable);
        return;
    }
    await linkAndIndex(blockIds, taskId, summaries, options);
}

async function viewLinkedTasks(
    blockIds: string[],
    options: BlockMenuWorkflowOptions,
): Promise<void> {
    const taskIds = new Set<number>();
    for (const blockId of blockIds) {
        for (const taskId of await options.links.read(blockId))
            taskIds.add(taskId);
    }
    for (const taskId of taskIds) await options.openTask(taskId);
}

async function unlinkTask(
    blockIds: string[],
    options: BlockMenuWorkflowOptions,
): Promise<void> {
    const taskId = parseTaskId(options.promptTaskId());
    if (!taskId) return;
    for (const blockId of blockIds) {
        const current = await options.links.read(blockId);
        if (!current.includes(taskId)) continue;
        await options.links.unlink(blockId, taskId);
        await options.index.remove(taskId, blockId);
    }
}

async function linkAndIndex(
    blockIds: string[],
    taskId: number,
    summaries: BlockSummary[],
    options: BlockMenuWorkflowOptions,
): Promise<void> {
    for (let index = 0; index < blockIds.length; index += 1) {
        const blockId = blockIds[index];
        const summary = summaries[index];
        await options.links.link(blockId, taskId);
        await options.index.upsert(toIndexEntry(taskId, summary));
    }
}

async function getSummaries(
    blockIds: string[],
    options: BlockMenuWorkflowOptions,
): Promise<BlockSummary[]> {
    const summaries = await Promise.all(
        blockIds.map((blockId) => options.context.getBlockSummary(blockId)),
    );
    return summaries.filter(
        (summary): summary is BlockSummary => summary !== null,
    );
}

function toIndexEntry(
    taskId: number,
    summary: BlockSummary,
): TaskLinkIndexEntry {
    return {
        taskId,
        blockId: summary.blockId,
        documentId: summary.documentId,
        ...(summary.notebookId ? { notebookId: summary.notebookId } : {}),
        updatedAt: summary.updatedAt ?? Date.now(),
    };
}

function parseTaskId(value: string | null): number | null {
    if (value === null) return null;
    const taskId = Number(value.trim());
    return Number.isSafeInteger(taskId) && taskId > 0 ? taskId : null;
}
