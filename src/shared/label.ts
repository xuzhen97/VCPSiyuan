import { Permission } from "./task.js";

export interface Label {
    id: number;
    title: string;
    descriptionMarkdown: string;
    color: string | null;
    maxPermission: Permission;
    usageCount?: number;
}

export interface LabelQuery {
    page: number;
    perPage: number;
    search?: string;
}

export interface LabelDraft {
    title: string;
    descriptionMarkdown: string;
    color: string | null;
}

export interface LabelDeleteImpact {
    label: { id: number; title: string };
    accessibleTaskCount: number;
    complete: boolean;
}
