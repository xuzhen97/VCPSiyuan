import { Label, LabelDeleteImpact } from "../../shared/label.js";

export interface LabelManagerDialogI18n {
    title: string;
    usage: (count: number) => string;
    impactIncomplete: string;
    confirmPlaceholder: string;
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
    onClose?: () => void;
}

/**
 * Label management page, opened on its own from the dock.
 *
 * Deliberately not reachable from `ProjectManagerDialog`: the two lists have
 * different permissions and different delete impacts, and hiding one behind the
 * other made both harder to find.
 */
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
        const root = document.createElement("section");
        root.className = "vcp-siyuan-label-manager";
        root.append(this.header());

        if (this.impact) {
            this.appendImpact(root, this.impact);
            this.container.append(root);
            return;
        }

        const labels = this.options.labels ?? [];
        const list = document.createElement("div");
        list.className = "vcp-siyuan-label-manager__list";
        for (const label of labels) {
            list.append(this.row(label));
        }
        const empty = document.createElement("p");
        empty.className = "vcp-siyuan-label-manager__empty";
        empty.dataset.state = "empty";
        empty.hidden = labels.length > 0;
        empty.textContent = this.options.i18n.empty;
        list.append(empty);

        root.append(this.toolbar(list, labels.length), list);
        this.container.append(root);
    }

    private header(): HTMLElement {
        const { i18n } = this.options;
        const header = document.createElement("header");
        header.className = "vcp-siyuan-label-manager__header";
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
        toolbar.className = "vcp-siyuan-label-manager__toolbar";
        const search = document.createElement("input");
        search.type = "search";
        search.placeholder = i18n.search;
        search.dataset.action = "search";
        const noMatches = document.createElement("p");
        noMatches.className = "vcp-siyuan-label-manager__empty";
        noMatches.dataset.state = "no-matches";
        noMatches.textContent = i18n.noMatches;
        noMatches.hidden = true;
        search.addEventListener("input", () => {
            const query = search.value.trim().toLocaleLowerCase();
            let visible = 0;
            for (const row of list.querySelectorAll<HTMLElement>(
                "[data-label-id]",
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
        create.dataset.action = "create-label";
        create.className = "b3-button b3-button--outline";
        create.textContent = i18n.create;
        create.addEventListener("click", () => this.renderEditor());
        toolbar.append(search, create);
        list.append(noMatches);
        return toolbar;
    }

    private row(label: Label): HTMLElement {
        const { i18n } = this.options;
        const row = document.createElement("div");
        row.dataset.labelId = String(label.id);
        row.className = "vcp-siyuan-label-manager__row";

        const swatch = document.createElement("span");
        swatch.className = "vcp-siyuan-label-manager__swatch";
        swatch.style.background = normalizeColor(label.color);
        row.append(swatch);

        const name = document.createElement("span");
        name.className = "vcp-siyuan-label-manager__name";
        name.textContent = label.title;
        row.append(name);

        // Usage only exists for labels read from the server, and a missing count
        // arrives as `null` after the Kernel's JSON round trip, so an
        // `!== undefined` guard rendered "used null times".
        if (typeof label.usageCount === "number") {
            const usage = document.createElement("small");
            usage.className = "vcp-siyuan-label-manager__meta";
            usage.textContent = i18n.usage(label.usageCount);
            row.append(usage);
        }

        const actions = document.createElement("span");
        actions.className = "vcp-siyuan-label-manager__row-actions";
        const edit = document.createElement("button");
        edit.type = "button";
        edit.textContent = i18n.edit;
        edit.dataset.action = "edit-label";
        edit.className = "b3-button b3-button--text";
        edit.disabled = !isWritable(label.maxPermission);
        edit.addEventListener("click", () => this.renderEditor(label));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = i18n.delete;
        remove.dataset.action = "delete-label";
        remove.className = "b3-button b3-button--text";
        remove.disabled = !isWritable(label.maxPermission);
        remove.addEventListener(
            "click",
            () => void this.options.onPreviewDelete?.(label.id),
        );
        actions.append(edit, remove);
        row.append(actions);
        return row;
    }

    private renderEditor(label?: Label): void {
        if (!this.container) return;
        const { i18n } = this.options;
        const form = document.createElement("form");
        form.className = "vcp-siyuan-label-manager__editor";
        const heading = document.createElement("h3");
        heading.textContent = label ? i18n.edit : i18n.create;
        form.append(heading);

        const title = document.createElement("input");
        title.required = true;
        title.value = label?.title ?? "";
        form.append(this.labeled(i18n.titleLabel, title));

        const description = document.createElement("textarea");
        description.value = label?.descriptionMarkdown ?? "";
        form.append(this.labeled(i18n.descriptionLabel, description));

        const color = document.createElement("input");
        color.type = "color";
        color.value = normalizeColor(label?.color);
        form.append(this.labeled(i18n.colorLabel, color));

        const actions = document.createElement("div");
        actions.className = "vcp-siyuan-label-manager__actions";
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
        section.className = "vcp-siyuan-label-manager__impact";
        const heading = document.createElement("h3");
        heading.textContent = impact.label.title;
        heading.dataset.state = "impact-target";
        section.append(heading);
        const usage = document.createElement("p");
        usage.textContent = i18n.usage(impact.accessibleTaskCount);
        section.append(usage);
        if (!impact.complete) {
            const warning = document.createElement("p");
            warning.className = "vcp-siyuan-label-manager__warning";
            warning.textContent = i18n.impactIncomplete;
            section.append(warning);
        }
        const confirmation = document.createElement("input");
        confirmation.placeholder = impact.label.title;
        confirmation.setAttribute("aria-label", i18n.confirmPlaceholder);
        section.append(confirmation);
        const actions = document.createElement("div");
        actions.className = "vcp-siyuan-label-manager__actions";
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
            if (confirmation.value === impact.label.title)
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

function normalizeColor(value: string | null | undefined): string {
    const normalized = value?.trim().replace(/^#/, "") ?? "";
    return /^[0-9a-fA-F]{6}$/.test(normalized) ? `#${normalized}` : "#888888";
}

function isWritable(permission: Label["maxPermission"]): boolean {
    return (
        permission === "write" ||
        permission === "admin" ||
        permission === "owner"
    );
}
