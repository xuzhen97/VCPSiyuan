export class TaskFollowUpError extends Error {
    constructor(cause: unknown) {
        super(cause instanceof Error ? cause.message : "Task follow-up failed");
        this.name = "TaskFollowUpError";
    }
}

/**
 * Keeps a successful remote task creation id across a failed follow-up step.
 *
 * Creation and context linking are deliberately separate operations. If the
 * follow-up fails, retrying the save must retry the follow-up for the existing
 * task rather than creating a second task.
 */
export function createTaskSaveOnce(
    create: () => Promise<number>,
    followUp: (taskId: number) => Promise<void>,
): () => Promise<number> {
    let createdTaskId: number | undefined;
    return async (): Promise<number> => {
        if (createdTaskId === undefined) {
            createdTaskId = await create();
        }
        try {
            await followUp(createdTaskId);
        } catch (error) {
            throw new TaskFollowUpError(error);
        }
        return createdTaskId;
    };
}
