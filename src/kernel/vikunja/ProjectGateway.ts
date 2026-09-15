import { Page } from "../../shared/pagination.js";
import {
    Project,
    ProjectDeleteImpact,
    ProjectDraft,
    ProjectQuery,
} from "../../shared/project.js";
import { VikunjaCredentials } from "../../shared/contracts.js";
import { VikunjaV2Client } from "./VikunjaV2Client.js";
import { mapProject } from "./mappers/projectMapper.js";

export class ProjectGateway {
    constructor(private readonly client: VikunjaV2Client) {}

    async list(
        credentials: VikunjaCredentials,
        query: ProjectQuery,
    ): Promise<{ data: Page<Project> }> {
        const response = await this.client.requestPage(
            credentials,
            "/projects",
            {
                page: query.page,
                per_page: query.perPage,
                ...(query.search ? { s: query.search } : {}),
                ...(query.includeArchived ? { is_archived: true } : {}),
                expand: "permissions",
            },
            mapProject,
        );
        return { data: response.data };
    }

    async get(
        credentials: VikunjaCredentials,
        projectId: number,
    ): Promise<Project> {
        const response = await this.client.requestJson<unknown>(
            credentials,
            "GET",
            `/projects/${assertId(projectId)}`,
            { query: { expand: "permissions" } },
        );
        return mapProject(response.data);
    }

    async create(
        credentials: VikunjaCredentials,
        draft: ProjectDraft,
    ): Promise<Project> {
        const response = await this.client.requestJson<unknown>(
            credentials,
            "POST",
            "/projects",
            { body: { kind: "json", value: projectToWire(draft) } },
        );
        return mapProject(response.data);
    }

    async patch(
        credentials: VikunjaCredentials,
        projectId: number,
        draft: Partial<ProjectDraft>,
    ): Promise<Project> {
        const response = await this.client.requestJson<unknown>(
            credentials,
            "PATCH",
            `/projects/${assertId(projectId)}`,
            { body: { kind: "json", value: projectToWire(draft) } },
        );
        return mapProject(response.data);
    }

    async delete(
        credentials: VikunjaCredentials,
        projectId: number,
    ): Promise<void> {
        await this.client.requestJson<void>(
            credentials,
            "DELETE",
            `/projects/${assertId(projectId)}`,
            { responseMode: "empty" },
        );
    }

    async getDeleteImpact(
        credentials: VikunjaCredentials,
        projectId: number,
        impact: ProjectDeleteImpact,
    ): Promise<ProjectDeleteImpact> {
        await this.get(credentials, projectId);
        return impact;
    }
}

function assertId(value: number): number {
    if (!Number.isSafeInteger(value) || value <= 0)
        throw new Error("projectId must be a positive safe integer");
    return value;
}

function projectToWire(draft: Partial<ProjectDraft>): Record<string, unknown> {
    const value: Record<string, unknown> = {};
    if (draft.title !== undefined) value.title = draft.title;
    if (draft.descriptionMarkdown !== undefined)
        value.description = draft.descriptionMarkdown;
    if (draft.color !== undefined) value.hex_color = draft.color;
    if (draft.parentProjectId !== undefined)
        value.parent_project_id = draft.parentProjectId;
    return value;
}
