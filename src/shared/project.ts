import { EntityRef, Permission } from "./task.js";

export interface Project {
    id: number;
    title: string;
    descriptionMarkdown: string;
    color: string | null;
    parentProjectId: number | null;
    archived: boolean;
    maxPermission: Permission;
    parent?: EntityRef | null;
}

export interface ProjectQuery {
    page: number;
    perPage: number;
    search?: string;
    includeArchived?: boolean;
}

export interface ProjectDraft {
    title: string;
    descriptionMarkdown: string;
    color: string | null;
    parentProjectId: number | null;
}

export interface ProjectDeleteImpact {
    project: EntityRef;
    descendantProjects: EntityRef[];
    openTaskCount: number;
    completedTaskCount: number;
    isInboxProject: boolean;
    complete: boolean;
}
