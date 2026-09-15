import { Label } from "../../shared/label.js";
import { Project } from "../../shared/project.js";
import type { UserRef } from "../../shared/task.js";
import type { VikunjaController } from "../controller/VikunjaController.js";

export interface ResourceStoreOptions {
    controller: Pick<VikunjaController, "call">;
}

export class ResourceStore {
    private readonly controller: ResourceStoreOptions["controller"];
    private projects: Project[] = [];
    private labels: Label[] = [];

    constructor(options: ResourceStoreOptions) {
        this.controller = options.controller;
    }

    async refresh(): Promise<void> {
        const [projects, labels] = await Promise.all([
            this.loadProjects(),
            this.loadLabels(),
        ]);
        this.setProjects(projects);
        this.labels = labels;
    }

    async createProject(
        draft: import("../../shared/project.js").ProjectDraft,
    ): Promise<Project> {
        const result = await this.controller.call("vikunja.projects.create", {
            draft,
        });
        if (!result.ok) throw new Error(result.error.message);
        await this.refresh();
        return result.data;
    }

    async patchProject(
        projectId: number,
        draft: Partial<import("../../shared/project.js").ProjectDraft>,
    ): Promise<Project> {
        const result = await this.controller.call("vikunja.projects.patch", {
            projectId,
            draft,
        });
        if (!result.ok) throw new Error(result.error.message);
        await this.refresh();
        return result.data;
    }

    async createLabel(
        draft: import("../../shared/label.js").LabelDraft,
    ): Promise<Label> {
        const result = await this.controller.call("vikunja.labels.create", {
            draft,
        });
        if (!result.ok) throw new Error(result.error.message);
        await this.refresh();
        return result.data;
    }

    async patchLabel(
        labelId: number,
        draft: Partial<import("../../shared/label.js").LabelDraft>,
    ): Promise<Label> {
        const result = await this.controller.call("vikunja.labels.patch", {
            labelId,
            draft,
        });
        if (!result.ok) throw new Error(result.error.message);
        await this.refresh();
        return result.data;
    }

    async searchMembers(projectId: number, query: string): Promise<UserRef[]> {
        const result = await this.controller.call("vikunja.users.search", {
            projectId,
            query,
            page: 1,
            perPage: 20,
        });
        if (!result.ok) throw new Error(result.error.message);
        return result.data.items;
    }

    private async loadProjects(): Promise<Project[]> {
        const items: Project[] = [];
        let page = 1;
        let total = Number.POSITIVE_INFINITY;
        while (items.length < total) {
            const result = await this.controller.call("vikunja.projects.list", {
                page,
                perPage: 100,
                includeArchived: true,
            });
            if (!result.ok) throw new Error(result.error.message);
            items.push(...result.data.items);
            total = result.data.total;
            if (result.data.items.length === 0) break;
            page += 1;
        }
        return items;
    }

    private async loadLabels(): Promise<Label[]> {
        const items: Label[] = [];
        let page = 1;
        let total = Number.POSITIVE_INFINITY;
        while (items.length < total) {
            const result = await this.controller.call("vikunja.labels.list", {
                page,
                perPage: 100,
            });
            if (!result.ok) throw new Error(result.error.message);
            items.push(...result.data.items);
            total = result.data.total;
            if (result.data.items.length === 0) break;
            page += 1;
        }
        return items;
    }

    setProjects(projects: Project[]): void {
        const byId = new Map(projects.map((project) => [project.id, project]));
        for (const project of projects) {
            const seen = new Set<number>();
            let current: Project | undefined = project;
            while (
                current?.parentProjectId !== null &&
                current?.parentProjectId !== undefined
            ) {
                if (seen.has(current.id)) {
                    throw new Error("Project hierarchy contains a cycle");
                }
                seen.add(current.id);
                current = byId.get(current.parentProjectId);
                if (!current && project.parentProjectId !== null) {
                    break;
                }
            }
        }
        this.projects = [...projects];
    }

    getProjects(): Project[] {
        return [...this.projects];
    }

    getLabels(): Label[] {
        return [...this.labels];
    }

    getProjectPath(projectId: number): string {
        const byId = new Map(
            this.projects.map((project) => [project.id, project]),
        );
        const segments: string[] = [];
        const seen = new Set<number>();
        let current = byId.get(projectId);
        while (current) {
            if (seen.has(current.id))
                throw new Error("Project hierarchy contains a cycle");
            seen.add(current.id);
            segments.unshift(current.title);
            current =
                current.parentProjectId === null
                    ? undefined
                    : byId.get(current.parentProjectId);
        }
        return segments.join(" / ");
    }
}
