import {
    Label,
    LabelDeleteImpact,
    LabelDraft,
    LabelQuery,
} from "../../shared/label.js";
import { Page } from "../../shared/pagination.js";
import { RpcResult, VikunjaCredentials } from "../../shared/contracts.js";
import {
    CreateLabelRequest,
    DeleteLabelRequest,
    PatchLabelRequest,
} from "../../shared/rpc.js";
import { publicError } from "../../shared/errors.js";
import { LabelGateway } from "../vikunja/LabelGateway.js";
import { toServiceError } from "./serviceError.js";

interface LabelTaskQueryLike {
    query: (
        credentials: VikunjaCredentials,
        query: {
            view: "inbox" | "all";
            page: number;
            perPage: number;
            timeZone: string;
            doneFilter: "open" | "all";
            projectIds: number[];
            labelIds: number[];
        },
    ) => Promise<{ data: { total: number } }>;
}

interface LabelGatewayLike {
    list?: (
        credentials: VikunjaCredentials,
        query: LabelQuery,
    ) => Promise<{ data: Page<Label> }>;
    get?: (credentials: VikunjaCredentials, labelId: number) => Promise<Label>;
    create?: (
        credentials: VikunjaCredentials,
        draft: LabelDraft,
    ) => Promise<Label>;
    patch?: (
        credentials: VikunjaCredentials,
        labelId: number,
        draft: Partial<LabelDraft>,
    ) => Promise<Label>;
    delete?: (
        credentials: VikunjaCredentials,
        labelId: number,
    ) => Promise<void>;
}

export interface LabelServiceOptions {
    writesAllowed?:
        | boolean
        | ((credentials: VikunjaCredentials) => Promise<boolean>);
}

export class LabelService {
    constructor(
        private readonly gateway:
            | LabelGatewayLike
            | LabelTaskQueryLike
            | LabelGateway,
        private readonly taskQuery?: LabelTaskQueryLike,
        private readonly options: LabelServiceOptions = {},
    ) {}

    async list(
        credentials: VikunjaCredentials,
        query: LabelQuery,
    ): Promise<RpcResult<Page<Label>>> {
        return this.run(
            async () =>
                (await this.requireGateway().list!(credentials, query)).data,
            "Label list failed",
        );
    }

    /**
     * The RPC envelope carries the draft under `request.draft`; unwrapping it here
     * keeps the wire contract in one place. Destructuring the request as the draft
     * itself silently sent an empty body to Vikunja.
     */
    async create(
        credentials: VikunjaCredentials,
        request: CreateLabelRequest,
    ): Promise<RpcResult<Label>> {
        return this.writeRun(
            credentials,
            () => this.requireGateway().create!(credentials, request.draft),
            "Label creation failed",
        );
    }

    async patch(
        credentials: VikunjaCredentials,
        request: PatchLabelRequest,
    ): Promise<RpcResult<Label>> {
        return this.writeRun(
            credentials,
            () =>
                this.requireGateway().patch!(
                    credentials,
                    request.labelId,
                    request.draft,
                ),
            "Label update failed",
        );
    }

    async delete(
        credentials: VikunjaCredentials,
        request: DeleteLabelRequest,
    ): Promise<RpcResult<void>> {
        return this.writeRun(
            credentials,
            async () => {
                const gateway = this.requireGateway();
                if (gateway.get) {
                    const current = await gateway.get(
                        credentials,
                        request.labelId,
                    );
                    if (current.title !== request.expectedTitle)
                        throw publicError(
                            "CONFLICT",
                            "Label title changed; review before deleting",
                            false,
                            "review",
                        );
                }
                await gateway.delete!(credentials, request.labelId);
                return undefined;
            },
            "Label delete failed",
        );
    }

    async getDeleteImpactResult(
        credentials: VikunjaCredentials,
        request: { labelId: number },
    ): Promise<RpcResult<LabelDeleteImpact>> {
        return {
            ok: true,
            data: await this.getDeleteImpact(credentials, request.labelId),
        };
    }

    async getDeleteImpact(
        credentials: VikunjaCredentials,
        labelId: number,
    ): Promise<LabelDeleteImpact> {
        if (!Number.isSafeInteger(labelId) || labelId <= 0) {
            return {
                label: { id: labelId, title: "Unknown" },
                accessibleTaskCount: 0,
                complete: false,
            };
        }
        try {
            const taskQuery = this.taskQuery ?? this.asTaskQuery();
            const result = await taskQuery.query(credentials, {
                view: "all",
                page: 1,
                perPage: 1,
                timeZone: "UTC",
                doneFilter: "all",
                projectIds: [],
                labelIds: [labelId],
            });
            const candidate = this.gateway as LabelGatewayLike;
            if (!candidate.get) {
                return {
                    label: { id: labelId, title: "Unknown" },
                    accessibleTaskCount: 0,
                    complete: false,
                };
            }
            const label = await candidate.get(credentials, labelId);
            return {
                label: { id: label.id, title: label.title },
                accessibleTaskCount: result.data.total,
                complete: true,
            };
        } catch {
            return {
                label: { id: labelId, title: "Unknown" },
                accessibleTaskCount: 0,
                complete: false,
            };
        }
    }

    private requireGateway(): LabelGatewayLike {
        const value = this.gateway as LabelGatewayLike;
        if (!value.list && !value.create && !value.delete && !value.get)
            throw new Error("Label gateway is unavailable");
        return value;
    }

    private asTaskQuery(): LabelTaskQueryLike {
        const value = this.gateway as LabelTaskQueryLike;
        if (typeof value.query !== "function")
            throw new Error("Task query gateway is unavailable");
        return value;
    }

    private async writeRun<T>(
        credentials: VikunjaCredentials,
        operation: () => Promise<T>,
        fallback: string,
    ): Promise<RpcResult<T>> {
        if (this.options.writesAllowed !== undefined) {
            const allowed =
                typeof this.options.writesAllowed === "function"
                    ? await this.options.writesAllowed(credentials)
                    : this.options.writesAllowed;
            if (!allowed)
                return {
                    ok: false,
                    error: publicError(
                        "FORBIDDEN",
                        "Label writes are disabled by the Vikunja server",
                    ),
                };
        }
        return this.run(operation, fallback);
    }

    private async run<T>(
        operation: () => Promise<T>,
        fallback: string,
    ): Promise<RpcResult<T>> {
        try {
            return { ok: true, data: await operation() };
        } catch (error) {
            return { ok: false, error: toServiceError(error, fallback) };
        }
    }
}
