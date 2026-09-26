import { Page } from "../../shared/pagination.js";
import { TaskSummary } from "../../shared/task.js";

export interface TaskRelationPickerI18n {
    title: string;
    search: string;
    searchAction: string;
    loading: string;
    empty: string;
    loadMore: string;
    select: string;
    close: string;
    retry: string;
    project: string;
    error: string;
}

export interface TaskRelationPickerOptions {
    taskId: number;
    childTaskIds: number[];
    search: (query: string, page: number, perPage: number) => Promise<Page<TaskSummary>>;
    i18n: TaskRelationPickerI18n;
    onSelect: (task: TaskSummary) => void;
    onClose?: () => void;
}

export class TaskRelationPicker {
    private readonly options: TaskRelationPickerOptions;
    private container?: HTMLElement;
    private query = "";
    private page = 0;
    private total = 0;
    private items: TaskSummary[] = [];
    private generation = 0;
    private loading = false;
    private error?: string;

    constructor(options: TaskRelationPickerOptions) {
        this.options = options;
    }

    mount(container: HTMLElement): void {
        this.container = container;
        this.render();
    }

    destroy(): void {
        ++this.generation;
        this.container?.replaceChildren();
        this.container = undefined;
    }

    private async search(reset: boolean): Promise<void> {
        const query = this.query.trim();
        if (!query) {
            ++this.generation;
            this.loading = false;
            this.error = undefined;
            this.items = [];
            this.page = 0;
            this.total = 0;
            this.render();
            return;
        }
        const generation = ++this.generation;
        const page = reset ? 1 : this.page + 1;
        this.loading = true;
        this.error = undefined;
        this.render();
        try {
            const result = await this.options.search(query, page, 50);
            if (generation !== this.generation) return;
            this.items = reset ? result.items : [...this.items, ...result.items];
            this.page = result.page;
            this.total = result.total;
        } catch {
            if (generation !== this.generation) return;
            this.error = this.options.i18n.error;
        } finally {
            if (generation === this.generation) {
                this.loading = false;
                this.render();
            }
        }
    }

    private render(): void {
        if (!this.container) return;
        this.container.replaceChildren();
        const i18n = this.options.i18n;
        const root = document.createElement("section");
        root.className = "vcp-siyuan-task-relation-picker";
        const heading = document.createElement("h2");
        heading.textContent = i18n.title;
        const form = document.createElement("form");
        const input = document.createElement("input");
        input.type = "search";
        input.placeholder = i18n.search;
        input.setAttribute("aria-label", i18n.search);
        input.value = this.query;
        input.addEventListener("input", () => {
            this.query = input.value;
            void this.search(true);
        });
        const submit = document.createElement("button");
        submit.type = "submit";
        submit.textContent = i18n.searchAction;
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            void this.search(true);
        });
        form.append(input, submit);
        root.append(heading, form);

        if (this.loading) {
            const loading = document.createElement("p");
            loading.textContent = i18n.loading;
            root.append(loading);
        }
        if (this.error) {
            const error = document.createElement("p");
            error.setAttribute("role", "alert");
            error.textContent = this.error;
            const retry = document.createElement("button");
            retry.type = "button";
            retry.textContent = i18n.retry;
            retry.addEventListener("click", () => void this.search(this.page === 0));
            root.append(error, retry);
        }

        const excluded = new Set([this.options.taskId, ...this.options.childTaskIds]);
        const eligible = this.items.filter((task) => !excluded.has(task.id));
        if (!this.loading && !this.error && eligible.length === 0 && this.query.trim()) {
            const empty = document.createElement("p");
            empty.textContent = i18n.empty;
            root.append(empty);
        }
        for (const task of eligible) {
            const row = document.createElement("div");
            row.className = "vcp-siyuan-task-relation-picker__task";
            row.dataset.taskId = String(task.id);
            const label = document.createElement("span");
            const projectId = task.project?.id ?? task.projectId;
            label.textContent = `#${task.id} · ${task.title} · ${i18n.project} ${projectId ?? "—"}`;
            const select = document.createElement("button");
            select.type = "button";
            select.dataset.action = `select-${task.id}`;
            select.textContent = i18n.select;
            select.addEventListener("click", () => this.options.onSelect(task));
            row.append(label, select);
            root.append(row);
        }
        if (this.items.length < this.total) {
            const more = document.createElement("button");
            more.type = "button";
            more.textContent = i18n.loadMore;
            more.disabled = this.loading;
            more.addEventListener("click", () => void this.search(false));
            root.append(more);
        }
        const close = document.createElement("button");
        close.type = "button";
        close.textContent = i18n.close;
        close.addEventListener("click", () => this.options.onClose?.());
        root.append(close);
        this.container.append(root);
    }
}
