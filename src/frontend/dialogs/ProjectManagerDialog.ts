import { Project, ProjectDeleteImpact } from "../../shared/project.js";

export interface ProjectManagerDialogI18n {
    title: string;
    impact: (open: number, completed: number, descendants: number) => string;
    confirmLabel: string;
    delete: string;
    cancel: string;
    save: string;
    search: string;
    create: string;
    edit: string;
    titleLabel: string;
    descriptionLabel: string;
    colorLabel: string;
    parentLabel: string;
    archivedLabel: string;
    projectPath: (path: string) => string;
    manageLabels: string;
}

export interface ProjectManagerDialogOptions {
    projects?: Project[];
    selectedProject?: Project;
    impact?: ProjectDeleteImpact;
    i18n: ProjectManagerDialogI18n;
    onCreate?: (draft: {
        title: string;
        descriptionMarkdown: string;
        color: string | null;
        parentProjectId: number | null;
    }) => void | Promise<void>;
    onEdit?: (
        projectId: number,
        draft: Partial<Project>,
    ) => void | Promise<void>;
    onPreviewDelete?: (projectId: number) => void | Promise<void>;
    onOpenLabels?: () => void | Promise<void>;
    onDelete?: (confirmationTitle: string) => void | Promise<void>;
}

export class ProjectManagerDialog {
    private readonly options: ProjectManagerDialogOptions;
    private container?: HTMLElement;
    private impact?: ProjectDeleteImpact;

    constructor(options: ProjectManagerDialogOptions) {
        this.options = options;
        this.impact = options.impact;
    }

    setImpact(impact: ProjectDeleteImpact): void {
        this.impact = impact;
        this.render();
    }

    mount(container: HTMLElement): void {
        this.container = container;
        this.render();
    }

    destroy(): void {
        this.container?.replaceChildren();
        this.container = undefined;
    }

    private render(): void {
        if (!this.container) return;
        this.container.replaceChildren();
        const { i18n } = this.options;
        const root = document.createElement("section");
        root.className = "vcp-siyuan-project-manager";
        const heading = document.createElement("h2");
        heading.textContent = i18n.title;
        root.append(heading);
        if (this.impact) {
            const selected = document.createElement("p");
            selected.textContent = this.impact.project.title;
            selected.dataset.state = "impact-target";
            root.append(selected);
        }
        if (!this.options.projects && this.impact) {
            this.appendImpact(root, this.impact);
            this.container.append(root);
            return;
        }

        const search = document.createElement("input");
        search.type = "search";
        search.placeholder = i18n.search;
        search.addEventListener("input", () => {
            const query = search.value.trim().toLocaleLowerCase();
            for (const row of root.querySelectorAll<HTMLElement>(
                "[data-project-id]",
            )) {
                const text = row.textContent ?? "";
                row.hidden =
                    query.length > 0 &&
                    !text.toLocaleLowerCase().includes(query);
            }
        });
        root.append(search);

        const list = document.createElement("div");
        list.className = "vcp-siyuan-project-manager__list";
        const projects = this.options.projects ?? [];
        for (const project of projects) {
            const row = document.createElement("div");
            row.dataset.projectId = String(project.id);
            row.className = "vcp-siyuan-project-manager__row";
            const label = document.createElement("span");
            label.textContent = i18n.projectPath(project.title);
            row.append(label);
            const edit = document.createElement("button");
            edit.type = "button";
            edit.dataset.action = "edit-project";
            edit.textContent = i18n.edit;
            edit.disabled = !isWritable(project.maxPermission);
            edit.addEventListener("click", () => this.renderEditor(project));
            row.append(edit);
            const remove = document.createElement("button");
            remove.type = "button";
            remove.dataset.action = "delete-project";
            remove.textContent = i18n.delete;
            remove.disabled = !isAdmin(project.maxPermission);
            remove.addEventListener(
                "click",
                () => void this.options.onPreviewDelete?.(project.id),
            );
            row.append(remove);
            list.append(row);
        }
        root.append(list);
        const create = document.createElement("button");
        create.type = "button";
        create.textContent = i18n.create;
        create.dataset.action = "create-project";
        create.addEventListener("click", () => this.renderEditor());
        root.append(create);
        if (this.options.onOpenLabels) {
            const labels = document.createElement("button");
            labels.type = "button";
            labels.dataset.action = "manage-labels";
            labels.textContent = i18n.manageLabels;
            labels.addEventListener(
                "click",
                () => void this.options.onOpenLabels?.(),
            );
            root.append(labels);
        }
        if (this.impact) this.appendImpact(root, this.impact);
        this.container.append(root);
    }

    private renderEditor(project?: Project): void {
        if (!this.container) return;
        const { i18n } = this.options;
        const form = document.createElement("form");
        form.className = "vcp-siyuan-project-manager__editor";
        const title = document.createElement("input");
        title.required = true;
        title.value = project?.title ?? "";
        form.append(this.labeled(i18n.titleLabel, title));
        const description = document.createElement("textarea");
        description.value = project?.descriptionMarkdown ?? "";
        form.append(this.labeled(i18n.descriptionLabel, description));
        const color = document.createElement("input");
        color.type = "color";
        color.value = normalizeColor(project?.color);
        color.dataset.projectColor = color.value;
        form.append(this.labeled(i18n.colorLabel, color));
        const parent = document.createElement("select");
        const none = document.createElement("option");
        none.value = "";
        none.textContent = "—";
        parent.append(none);
        for (const candidate of this.options.projects ?? []) {
            if (candidate.id === project?.id || candidate.archived) continue;
            const option = document.createElement("option");
            option.value = String(candidate.id);
            option.textContent = candidate.title;
            option.selected = candidate.id === project?.parentProjectId;
            parent.append(option);
        }
        form.append(this.labeled(i18n.parentLabel, parent));
        const save = document.createElement("button");
        save.type = "submit";
        save.textContent = i18n.save;
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = i18n.cancel;
        cancel.addEventListener("click", () => this.render());
        form.append(save, cancel);
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            const draft = {
                title: title.value.trim(),
                descriptionMarkdown: description.value,
                color:
                    color.dataset.projectColor?.replace(/^#/, "") ??
                    color.value.replace(/^#/, ""),
                parentProjectId: parent.value ? Number(parent.value) : 0,
            };
            if (project) void this.options.onEdit?.(project.id, draft);
            else void this.options.onCreate?.(draft);
        });
        this.container.replaceChildren(form);
        title.focus();
    }

    private appendImpact(root: HTMLElement, impact: ProjectDeleteImpact): void {
        const { i18n } = this.options;
        const section = document.createElement("section");
        section.className = "vcp-siyuan-project-manager__impact";
        const text = document.createElement("p");
        text.textContent = i18n.impact(
            impact.openTaskCount,
            impact.completedTaskCount,
            impact.descendantProjects.length,
        );
        section.append(text);
        const confirmation = document.createElement("input");
        confirmation.placeholder = impact.project.title;
        confirmation.setAttribute("aria-label", i18n.confirmLabel);
        section.append(confirmation);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.dataset.action = "delete";
        remove.textContent = i18n.delete;
        remove.disabled = !impact.complete;
        remove.addEventListener("click", () => {
            if (confirmation.value === impact.project.title)
                void this.options.onDelete?.(confirmation.value);
        });
        section.append(remove);
        root.append(section);
    }

    private labeled(text: string, input: HTMLElement): HTMLLabelElement {
        const label = document.createElement("label");
        label.textContent = text;
        label.append(input);
        return label;
    }
}

function normalizeColor(value: string | null | undefined): string {
    const normalized = value?.trim().replace(/^#/, "") ?? "";
    return /^[0-9a-fA-F]{6}$/.test(normalized) ? `#${normalized}` : "#888888";
}

function isWritable(permission: Project["maxPermission"]): boolean {
    return (
        permission === "write" ||
        permission === "admin" ||
        permission === "owner"
    );
}

function isAdmin(permission: Project["maxPermission"]): boolean {
    return permission === "admin" || permission === "owner";
}
