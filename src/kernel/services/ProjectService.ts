import {
    Project,
    ProjectDeleteImpact,
    ProjectDraft,
    ProjectQuery,
} from "../../shared/project.js";
import { Page } from "../../shared/pagination.js";
import { RpcResult, VikunjaCredentials } from "../../shared/contracts.js";
import {
    CreateProjectRequest,
    DeleteProjectRequest,
    PatchProjectRequest,
} from "../../shared/rpc.js";
import { PublicError, publicError } from "../../shared/errors.js";
import { ProjectGateway } from "../vikunja/ProjectGateway.js";

interface ProjectGatewayLike {
    list: (
        credentials: VikunjaCredentials,
        query: ProjectQuery,
    ) => Promise<{ data: Page<Project> }>;
    get: (
        credentials: VikunjaCredentials,
        projectId: number,
    ) => Promise<Project>;
    create: (
        credentials: VikunjaCredentials,
        draft: ProjectDraft,
    ) => Promise<Project>;
    patch: (
        credentials: VikunjaCredentials,
        projectId: number,
        draft: Partial<ProjectDraft>,
    ) => Promise<Project>;
    delete: (
        credentials: VikunjaCredentials,
        projectId: number,
    ) => Promise<void>;
}

interface TaskGatewayLike {
    query: (
        credentials: VikunjaCredentials,
        query: {
            view: "inbox" | "all";
            inboxProjectId?: number;
            page: number;
            perPage: number;
            timeZone: string;
            doneFilter: "open" | "all";
            projectIds: number[];
            labelIds: number[];
        },
    ) => Promise<{ data: { total: number; page?: number; perPage?: number } }>;
}

export interface ProjectServiceOptions {
    writesAllowed?:
        | boolean
        | ((credentials: VikunjaCredentials) => Promise<boolean>);
}

export class ProjectService {
    constructor(
        private readonly projects: ProjectGatewayLike | ProjectGateway,
        private readonly tasks: TaskGatewayLike,
        private readonly options: ProjectServiceOptions = {},
    ) {}

    async list(
        credentials: VikunjaCredentials,
        query: ProjectQuery,
    ): Promise<RpcResult<Page<Project>>> {
        return this.safe(
            async () => (await this.projects.list(credentials, query)).data,
        );
    }

    /**
     * Every write takes the RPC request envelope, not its fields: the binding
     * hands over `request` as a single argument, so a positional signature read
     * `{ draft }` as the draft and sent an empty body to Vikunja.
     */
    async create(
        credentials: VikunjaCredentials,
        request: CreateProjectRequest,
    ): Promise<RpcResult<Project>> {
        return this.writeSafe(credentials, () =>
            this.projects.create(credentials, request.draft),
        );
    }

    async patch(
        credentials: VikunjaCredentials,
        request: PatchProjectRequest,
    ): Promise<RpcResult<Project>> {
        return this.writeSafe(credentials, () =>
            this.projects.patch(
                credentials,
                request.projectId,
                request.draft,
            ),
        );
    }

    async delete(
        credentials: VikunjaCredentials,
        request: DeleteProjectRequest,
    ): Promise<RpcResult<void>> {
        return this.writeSafe(credentials, async () => {
            const current = await this.projects.get(
                credentials,
                request.projectId,
            );
            if (current.title !== request.expectedTitle)
                throw publicError(
                    "CONFLICT",
                    "Project title changed; review before deleting",
                    false,
                    "review",
                );
            await this.projects.delete(credentials, request.projectId);
            return undefined;
        });
    }

    async getDeleteImpactResult(
        credentials: VikunjaCredentials,
        request: { projectId: number; inboxProjectId?: number | null },
    ): Promise<RpcResult<ProjectDeleteImpact>> {
        const impact = await this.getDeleteImpact(
            credentials,
            request.projectId,
            // The caller owns the configured Inbox project id; the service must
            // not assume it is never the project being deleted.
            request.inboxProjectId === request.projectId,
        );
        return { ok: true, data: impact };
    }

    async getDeleteImpact(
        credentials: VikunjaCredentials,
        projectId: number,
        isInboxProject: boolean,
    ): Promise<ProjectDeleteImpact> {
        const incomplete = (
            project: { id: number; title: string },
            descendants: Project[] = [],
        ): ProjectDeleteImpact => ({
            project,
            descendantProjects: descendants.map((item) => ({
                id: item.id,
                title: item.title,
            })),
            openTaskCount: 0,
            completedTaskCount: 0,
            isInboxProject,
            complete: false,
        });

        let all: Project[];
        try {
            const listed = await this.listAllProjects(credentials);
            if (listed === null)
                return incomplete({ id: projectId, title: "Unknown" });
            all = listed;
        } catch {
            return incomplete({ id: projectId, title: "Unknown" });
        }

        const root = all.find((project) => project.id === projectId);
        if (!root) return incomplete({ id: projectId, title: "Unknown" });

        const descendants = all.filter((project) =>
            isDescendant(project.id, project.parentProjectId, projectId, all),
        );

        let openTaskCount = 0;
        let completedTaskCount = 0;
        try {
            for (const project of [root, ...descendants]) {
                const open = await this.tasks.query(credentials, {
                    view: "inbox",
                    inboxProjectId: project.id,
                    page: 1,
                    perPage: 1,
                    timeZone: "UTC",
                    doneFilter: "open",
                    projectIds: [],
                    labelIds: [],
                });
                const completed = await this.tasks.query(credentials, {
                    view: "inbox",
                    inboxProjectId: project.id,
                    page: 1,
                    perPage: 1,
                    timeZone: "UTC",
                    doneFilter: "all",
                    projectIds: [],
                    labelIds: [],
                });
                // The paginated `total` is authoritative for a count, so only a
                // failed request or an incomplete project listing marks the
                // report incomplete.
                openTaskCount += open.data.total;
                completedTaskCount += completed.data.total;
            }
        } catch {
            return incomplete({ id: root.id, title: root.title }, descendants);
        }

        return {
            project: { id: root.id, title: root.title },
            descendantProjects: descendants.map((project) => ({
                id: project.id,
                title: project.title,
            })),
            openTaskCount,
            completedTaskCount,
            isInboxProject,
            complete: true,
        };
    }

    /**
     * Reads every project by following pages. Requesting one oversized page is
     * not safe: Vikunja caps `per_page` at the server's `max_items_per_page`, and
     * treating that capped response as "truncated" would permanently disable
     * project deletion on any server with a smaller cap.
     */
    private async listAllProjects(
        credentials: VikunjaCredentials,
    ): Promise<Project[] | null> {
        const collected: Project[] = [];
        const seen = new Set<number>();
        let page = 1;
        let total = Number.POSITIVE_INFINITY;
        while (collected.length < total) {
            const response = await this.projects.list(credentials, {
                page,
                perPage: 100,
            });
            const data = response.data;
            for (const project of data.items) {
                if (seen.has(project.id)) continue;
                seen.add(project.id);
                collected.push(project);
            }
            total = data.total;
            if (data.items.length === 0) break;
            page += 1;
        }
        return collected.length >= total ? collected : null;
    }

    private async writeSafe<T>(
        credentials: VikunjaCredentials,
        operation: () => Promise<T>,
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
                        "Project writes are disabled by the Vikunja server",
                    ),
                };
        }
        return this.safe(operation);
    }

    private async safe<T>(operation: () => Promise<T>): Promise<RpcResult<T>> {
        try {
            return { ok: true, data: await operation() };
        } catch (error) {
            if (isPublicError(error)) return { ok: false, error };
            return {
                ok: false,
                error: publicError(
                    "REMOTE_ERROR",
                    "Project operation failed",
                    true,
                    "retry",
                ),
            };
        }
    }
}

function isPublicError(value: unknown): value is PublicError {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as { code?: unknown }).code === "string" &&
        typeof (value as { message?: unknown }).message === "string"
    );
}

function isDescendant(
    id: number,
    parentId: number | null,
    rootId: number,
    all: Array<{ id: number; parentProjectId: number | null }>,
): boolean {
    const seen = new Set<number>();
    let current = parentId;
    while (current !== null) {
        if (current === rootId) return id !== rootId;
        if (seen.has(current)) return false;
        seen.add(current);
        current =
            all.find((project) => project.id === current)?.parentProjectId ??
            null;
    }
    return false;
}
