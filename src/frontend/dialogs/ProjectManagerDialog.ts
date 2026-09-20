import { Project, ProjectDeleteImpact } from "../../shared/project.js";

export interface ProjectManagerDialogI18n {
    title: string;
    impact: (open: number, completed: number, descendants: number) => string;
    impactIncomplete: string;
    confirmLabel: string;
    delete: string;
    cancel: string;
    close: string;
    save: string;
    search: string;
    create: string;
    edit: string;
    empty: string;
    noMatches: string;
    titleLabel: string;
    descriptionLabel: string;
    colorLabel: string;
    parentLabel: string;
    archivedLabel: string;
    projectPath: (path: string) => string;
}

export interface ProjectManagerDialogOptions {
    projects?: Project[];
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
    onDelete?: (confirmationTitle: string) => void | Promise<void>;
    onClose?: () => void;
}

/**
 * Project management page.
 *
 * Labels have their own page (`LabelManagerDialog`) rather than a link from
 * here, so neither list is buried behind the other.
 */
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
        const root = document.createElement("section");
        root.className = "vcp-siyuan-project-manager";
        root.append(this.header());

        // A delete confirmation replaces the list: showing both at once made the
        // impact summary look like a permanent part of the page.
        if (this.impact) {
            this.appendImpact(root, this.impact);
            this.container.append(root);
            return;
        }

        const projects = this.options.projects ?? [];
        const list = document.createElement("div");
        list.className = "vcp-siyuan-project-manager__list";
        const depths = projectDepths(projects);
        for (const project of projects) {
            list.append(this.row(project, depths.get(project.id) ?? 0));
        }
        const empty = document.createElement("p");
        empty.className = "vcp-siyuan-project-manager__empty";
        empty.dataset.state = "empty";
        empty.hidden = projects.length > 0;
        empty.textContent = this.options.i18n.empty;
        list.append(empty);

        root.append(this.toolbar(list, projects.length), list);
        this.container.append(root);
    }

    private header(): HTMLElement {
        const { i18n } = this.options;
        const header = document.createElement("header");
        header.className = "vcp-siyuan-project-manager__header";
        const heading = document.createElement("h2");
        heading.textContent = i18n.title;
        const close = document.createElement("button");
        close.type = "button";
        close.dataset.action = "close";
        close.className = "b3-button b3-button--text";
        close.textContent = i18n.close;
        close.addEventListener("click", () => this.options.onClose?.());
        header.append(heading, close);
        return header;
    }

    private toolbar(list: HTMLElement, total: number): HTMLElement {
        const { i18n } = this.options;
        const toolbar = document.createElement("div");
        toolbar.className = "vcp-siyuan-project-manager__toolbar";
        const search = document.createElement("input");
        search.type = "search";
        search.placeholder = i18n.search;
        search.dataset.action = "search";
        const noMatches = document.createElement("p");
        noMatches.className = "vcp-siyuan-project-manager__empty";
        noMatches.dataset.state = "no-matches";
        noMatches.textContent = i18n.noMatches;
        noMatches.hidden = true;
        search.addEventListener("input", () => {
            const query = search.value.trim().toLocaleLowerCase();
            let visible = 0;
            for (const row of list.querySelectorAll<HTMLElement>(
                "[data-project-id]",
            )) {
                const text = row.textContent ?? "";
                const matches =
                    query.length === 0 ||
                    text.toLocaleLowerCase().includes(query);
                row.hidden = !matches;
                if (matches) visible += 1;
            }
            noMatches.hidden = !(total > 0 && visible === 0);
        });
        const create = document.createElement("button");
        create.type = "button";
        create.dataset.action = "create-project";
        create.className = "b3-button b3-button--outline";
        create.textContent = i18n.create;
        create.addEventListener("click", () => this.renderEditor());
        toolbar.append(search, create);
        list.append(noMatches);
        return toolbar;
    }

    private row(project: Project, depth: number): HTMLElement {
        const { i18n } = this.options;
        const row = document.createElement("div");
        row.dataset.projectId = String(project.id);
        row.className = "vcp-siyuan-project-manager__row";
        row.style.setProperty("--depth", String(depth));

        const swatch = document.createElement("span");
        swatch.className = "vcp-siyuan-project-manager__swatch";
        swatch.style.background = normalizeColor(project.color);
        row.append(swatch);

        const name = document.createElement("span");
        name.className = "vcp-siyuan-project-manager__name";
        name.textContent = i18n.projectPath(project.title);
        row.append(name);

        if (project.archived) {
            const archived = document.createElement("small");
            archived.className = "vcp-siyuan-project-manager__meta";
            archived.textContent = i18n.archivedLabel;
            row.append(archived);
        }

        const actions = document.createElement("span");
        actions.className = "vcp-siyuan-project-manager__row-actions";
        const edit = document.createElement("button");
        edit.type = "button";
        edit.dataset.action = "edit-project";
        edit.className = "b3-button b3-button--text";
        edit.textContent = i18n.edit;
        edit.disabled = !isWritable(project.maxPermission);
        edit.addEventListener("click", () => this.renderEditor(project));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.dataset.action = "delete-project";
        remove.className = "b3-button b3-button--text";
        remove.textContent = i18n.delete;
        remove.disabled = !isAdmin(project.maxPermission);
        remove.addEventListener(
            "click",
            () => void this.options.onPreviewDelete?.(project.id),
        );
        actions.append(edit, remove);
        row.append(actions);
        return row;
    }

    private renderEditor(project?: Project): void {
        if (!this.container) return;
        const { i18n } = this.options;
        const form = document.createElement("form");
        form.className = "vcp-siyuan-project-manager__editor";
        const heading = document.createElement("h3");
        heading.textContent = project ? i18n.edit : i18n.create;
        form.append(heading);

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

        const actions = document.createElement("div");
        actions.className = "vcp-siyuan-project-manager__actions";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "b3-button";
        cancel.textContent = i18n.cancel;
        cancel.addEventListener("click", () => this.render());
        const save = document.createElement("button");
        save.type = "submit";
        save.className = "b3-button b3-button--outline";
        save.textContent = i18n.save;
        actions.append(cancel, save);
        form.append(actions);

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
        const heading = document.createElement("h3");
        heading.textContent = impact.project.title;
        heading.dataset.state = "impact-target";
        section.append(heading);
        const text = document.createElement("p");
        text.textContent = i18n.impact(
            impact.openTaskCount,
            impact.completedTaskCount,
            impact.descendantProjects.length,
        );
        section.append(text);
        if (!impact.complete) {
            const warning = document.createElement("p");
            warning.className = "vcp-siyuan-project-manager__warning";
            warning.textContent = i18n.impactIncomplete;
            section.append(warning);
        }
        const confirmation = document.createElement("input");
        confirmation.placeholder = impact.project.title;
        confirmation.setAttribute("aria-label", i18n.confirmLabel);
        section.append(confirmation);
        const actions = document.createElement("div");
        actions.className = "vcp-siyuan-project-manager__actions";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "b3-button";
        cancel.dataset.action = "cancel-impact";
        cancel.textContent = i18n.cancel;
        cancel.addEventListener("click", () => {
            this.impact = undefined;
            this.render();
        });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.dataset.action = "delete";
        remove.className = "b3-button b3-button--outline";
        remove.textContent = i18n.delete;
        remove.disabled = !impact.complete;
        remove.addEventListener("click", () => {
            if (confirmation.value === impact.project.title)
                void this.options.onDelete?.(confirmation.value);
        });
        actions.append(cancel, remove);
        section.append(actions);
        root.append(section);
    }

    private labeled(text: string, input: HTMLElement): HTMLLabelElement {
        const label = document.createElement("label");
        label.textContent = text;
        label.append(input);
        return label;
    }
}

/** Nesting depth per project so children render indented under their parent. */
function projectDepths(projects: Project[]): Map<number, number> {
    const byId = new Map(projects.map((project) => [project.id, project]));
    const depths = new Map<number, number>();
    for (const project of projects) {
        let depth = 0;
        let current = project;
        const seen = new Set<number>([project.id]);
        while (current.parentProjectId) {
            const parent = byId.get(current.parentProjectId);
            // A cycle can only come from inconsistent server data; stop rather
            // than walk forever.
            if (!parent || seen.has(parent.id)) break;
            seen.add(parent.id);
            depth += 1;
            current = parent;
        }
        depths.set(project.id, depth);
    }
    return depths;
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
