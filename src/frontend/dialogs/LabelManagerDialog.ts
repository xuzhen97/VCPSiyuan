import { Label, LabelDeleteImpact } from "../../shared/label.js";

export interface LabelManagerDialogI18n {
    title: string;
    usage: (count: number) => string;
    confirmPlaceholder: string;
    delete: string;
    cancel: string;
    save: string;
    search: string;
    create: string;
    edit: string;
    titleLabel: string;
    descriptionLabel: string;
    colorLabel: string;
}

export interface LabelManagerDialogOptions {
    labels?: Label[];
    impact?: LabelDeleteImpact;
    i18n: LabelManagerDialogI18n;
    onCreate?: (draft: {
        title: string;
        descriptionMarkdown: string;
        color: string | null;
    }) => void | Promise<void>;
    onEdit?: (labelId: number, draft: Partial<Label>) => void | Promise<void>;
    onPreviewDelete?: (labelId: number) => void | Promise<void>;
    onDelete?: (confirmationTitle: string) => void | Promise<void>;
}

export class LabelManagerDialog {
    private readonly options: LabelManagerDialogOptions;
    private container?: HTMLElement;
    private impact?: LabelDeleteImpact;

    constructor(options: LabelManagerDialogOptions) {
        this.options = options;
        this.impact = options.impact;
    }

    setImpact(impact: LabelDeleteImpact): void {
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
        root.className = "vcp-siyuan-label-manager";
        const heading = document.createElement("h2");
        heading.textContent = i18n.title;
        root.append(heading);
        if (this.impact) {
            const selected = document.createElement("p");
            selected.textContent = this.impact.label.title;
            selected.dataset.state = "impact-target";
            root.append(selected);
        }
        if (!this.options.labels && this.impact) {
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
                "[data-label-id]",
            )) {
                const text = row.textContent ?? "";
                row.hidden =
                    query.length > 0 &&
                    !text.toLocaleLowerCase().includes(query);
            }
        });
        root.append(search);
        const list = document.createElement("div");
        for (const label of this.options.labels ?? []) {
            const row = document.createElement("div");
            row.dataset.labelId = String(label.id);
            const name = document.createElement("span");
            name.textContent = label.title;
            row.append(name);
            if (label.usageCount !== undefined) {
                const usage = document.createElement("small");
                usage.textContent = i18n.usage(label.usageCount);
                row.append(usage);
            }
            const edit = document.createElement("button");
            edit.type = "button";
            edit.textContent = i18n.edit;
            edit.dataset.action = "edit-label";
            edit.disabled = !isWritable(label.maxPermission);
            edit.addEventListener("click", () => this.renderEditor(label));
            row.append(edit);
            const remove = document.createElement("button");
            remove.type = "button";
            remove.textContent = i18n.delete;
            remove.dataset.action = "delete-label";
            remove.disabled = !isWritable(label.maxPermission);
            remove.addEventListener(
                "click",
                () => void this.options.onPreviewDelete?.(label.id),
            );
            row.append(remove);
            list.append(row);
        }
        root.append(list);
        const create = document.createElement("button");
        create.type = "button";
        create.textContent = i18n.create;
        create.dataset.action = "create-label";
        create.addEventListener("click", () => this.renderEditor());
        root.append(create);
        if (this.impact) this.appendImpact(root, this.impact);
        this.container.append(root);
    }

    private renderEditor(label?: Label): void {
        if (!this.container) return;
        const { i18n } = this.options;
        const form = document.createElement("form");
        form.className = "vcp-siyuan-label-manager__editor";
        const title = document.createElement("input");
        title.required = true;
        title.value = label?.title ?? "";
        form.append(this.labeled(i18n.titleLabel, title));
        const description = document.createElement("textarea");
        description.value = label?.descriptionMarkdown ?? "";
        form.append(this.labeled(i18n.descriptionLabel, description));
        const color = document.createElement("input");
        color.type = "color";
        color.value = label?.color ?? "#888888";
        form.append(this.labeled(i18n.colorLabel, color));
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
                color: color.value,
            };
            if (label) void this.options.onEdit?.(label.id, draft);
            else void this.options.onCreate?.(draft);
        });
        this.container.replaceChildren(form);
        title.focus();
    }

    private appendImpact(root: HTMLElement, impact: LabelDeleteImpact): void {
        const { i18n } = this.options;
        const section = document.createElement("section");
        const usage = document.createElement("p");
        usage.textContent = i18n.usage(impact.accessibleTaskCount);
        section.append(usage);
        const confirmation = document.createElement("input");
        confirmation.placeholder = impact.label.title;
        confirmation.setAttribute("aria-label", i18n.confirmPlaceholder);
        section.append(confirmation);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.dataset.action = "delete";
        remove.textContent = i18n.delete;
        remove.disabled = !impact.complete;
        remove.addEventListener("click", () => {
            if (confirmation.value === impact.label.title)
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

function isWritable(permission: Label["maxPermission"]): boolean {
    return (
        permission === "write" ||
        permission === "admin" ||
        permission === "owner"
    );
}
