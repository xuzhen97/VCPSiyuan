import {
    parseBlockTaskLinks,
    serializeBlockTaskLinks,
} from "../../shared/block-link.js";
import { PublicError, publicError } from "../../shared/errors.js";

export interface BlockAttributeContext {
    getBlockAttrs: (blockId: string) => Promise<Record<string, string>>;
    setBlockAttrs: (
        blockId: string,
        attrs: Record<string, string | null>,
    ) => Promise<void>;
}

const ATTRIBUTE_NAME = "custom-vikunja-task-links";

export class BlockLinkRepository {
    private readonly context: BlockAttributeContext;

    constructor(context: BlockAttributeContext) {
        this.context = context;
    }

    async read(blockId: string): Promise<number[]> {
        const attrs = await this.context.getBlockAttrs(blockId);
        return parseBlockTaskLinks(attrs[ATTRIBUTE_NAME]).taskIds;
    }

    async link(blockId: string, taskId: number): Promise<void> {
        await this.mutate(blockId, taskId, "link");
    }

    async unlink(blockId: string, taskId: number): Promise<void> {
        await this.mutate(blockId, taskId, "unlink");
    }

    private async mutate(
        blockId: string,
        taskId: number,
        operation: "link" | "unlink",
    ): Promise<void> {
        try {
            await this.read(blockId);
        } catch (error) {
            throw publicErrorFromParse(error);
        }
        let latestIds: number[];
        try {
            latestIds = await this.read(blockId);
        } catch (error) {
            throw publicErrorFromParse(error);
        }
        if (operation === "unlink" && !latestIds.includes(taskId)) {
            throw publicError(
                "CONFLICT",
                "The requested Block link is no longer present; retry the operation",
                false,
                "retry",
            );
        }
        const nextIds =
            operation === "link"
                ? [...new Set([...latestIds, taskId])].sort((a, b) => a - b)
                : latestIds.filter((id) => id !== taskId);
        await this.context.setBlockAttrs(blockId, {
            [ATTRIBUTE_NAME]: serializeBlockTaskLinks(nextIds),
        });

        let verifiedIds: number[];
        try {
            verifiedIds = await this.read(blockId);
        } catch (error) {
            throw publicErrorFromParse(error);
        }
        const expectedPresent = operation === "link";
        const present = verifiedIds.includes(taskId);
        if (present !== expectedPresent) {
            throw publicError(
                "CONFLICT",
                "Block links changed while saving; retry the operation",
                false,
                "retry",
            );
        }
    }
}

function publicErrorFromParse(error: unknown): PublicError {
    if (error instanceof Error && /version/i.test(error.message)) {
        return publicError(
            "INVALID_RESPONSE",
            "Unsupported Block link attribute version",
            false,
            "review",
        );
    }
    return publicError(
        "INVALID_RESPONSE",
        "Block link attribute is invalid",
        false,
        "review",
    );
}
