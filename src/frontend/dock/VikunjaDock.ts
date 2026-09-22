import { Label } from "../../shared/label.js";
import { Project } from "../../shared/project.js";
import { TaskListStore, TaskView } from "../stores/TaskListStore.js";
import {
    createMultiSelectFilter,
    MultiSelectFilterElement,
    MultiSelectOption,
} from "./MultiSelectFilter.js";
import { TaskRowI18n, createTaskRow } from "./TaskRow.js";

export type DockView = TaskView | "resources";

export interface VikunjaDockI18n extends TaskRowI18n {
    dockTitle: string;
    refresh: string;
    openSettings: string;
    loading: string;
    refreshing: string;
    empty: string;
    unconfigured: string;
    inboxNotConfigured: string;
    offline: string;
    loadError: string;
    inbox: string;
    allTasks: string;
    projectsAndLabels: string;
    incomplete: string;
    projects: string;
    labels: string;
    newTask: string;
    loadMore: string;
    connectionOnline: string;
    connectionOffline: string;
    shownCount: (shown: number, total: number) => string;
    timeZoneLabel: (timeZone: string) => string;
    snapshotAt: (value: string) => string;
    resourcesLoading: string;
    resourcesError: string;
    retry: string;
}

export interface VikunjaDockOptions {
    store: TaskListStore;
    openSettings: () => void;
    i18n: VikunjaDockI18n;
    onOpenTask?: (taskId: number) => void;
    onCreateTask?: () => void;
    getProjects?: () => Project[];
    getLabels?: () => Label[];
    projectPath?: (projectId: number) => string;
    resourceStatus?: () => "idle" | "loading" | "ready" | "error";
    resourceError?: () => string | undefined;
    retryResources?: () => void | Promise<void>;
    renderResourceManagement?: (container: HTMLElement) => (() => void) | void;
    now?: () => Date;
}

const views: DockView[] = ["inbox", "all", "resources"];

export class VikunjaDock {
    private readonly store: TaskListStore;
    private readonly openSettingsCb: () => void;
    private readonly onOpenTask?: (taskId: number) => void;
    private readonly onCreateTask?: () => void;
    private readonly getProjects: () => Project[];
    private readonly getLabels: () => Label[];
    private readonly projectPath: (projectId: number) => string;
    private readonly resourceStatus: () => "idle" | "loading" | "ready" | "error";
    private readonly resourceError: () => string | undefined;
    private readonly retryResources?: () => void | Promise<void>;
    private readonly renderResourceManagement?: (
        container: HTMLElement,
    ) => (() => void) | void;
    private readonly now: () => Date;
    private readonly i18n: VikunjaDockI18n;
    private readonly unsubscribeStore: () => void;
    private container?: HTMLElement;
    private destroyed = false;
    private activeView: DockView = "inbox";
    private multiSelects: MultiSelectFilterElement[] = [];
    private resourceDisposer?: () => void;
    private resourcesLoaded = false;

    constructor(options: VikunjaDockOptions) {
        this.store = options.store;
        this.openSettingsCb = options.openSettings;
        this.onOpenTask = options.onOpenTask;
        this.onCreateTask = options.onCreateTask;
        this.getProjects = options.getProjects ?? (() => []);
        this.getLabels = options.getLabels ?? (() => []);
        this.projectPath = options.projectPath ?? ((id) => String(id));
        this.resourceStatus = options.resourceStatus ?? (() => "ready");
        this.resourceError = options.resourceError ?? (() => undefined);
        this.retryResources = options.retryResources;
        this.renderResourceManagement = options.renderResourceManagement;
        this.now = options.now ?? (() => new Date());
        this.i18n = options.i18n;
        this.unsubscribeStore = this.store.subscribe(() => this.render());
    }

    mount(element: HTMLElement): void {
        this.container = element;
        this.render();
        void this.refresh().catch(() => {});
    }

    invalidate(): void {
        this.render();
    }

    destroy(): void {
        this.destroyed = true;
        this.disposeDynamicContent();
        this.unsubscribeStore();
        this.store.destroy();
        this.container?.replaceChildren();
        this.container = undefined;
    }

    async refresh(): Promise<void> {
        if (this.destroyed || this.activeView === "resources") return;
        // Both task views, not just the active one: the other tab's badge is
        // visible at the same time and must not lag behind.
        await this.store.refreshAll();
    }

    private render(): void {
        if (!this.container || this.destroyed) return;
        this.disposeDynamicContent();
        this.container.replaceChildren();
        const root = document.createElement("div");
        root.className = "vcp-siyuan-dock";
        root.append(this.renderHeader());
        this.renderWorkbench(root);
        this.container.append(root);
    }

    private renderHeader(): HTMLElement {
        const header = document.createElement("header");
        header.className = "vcp-siyuan-dock__header";
        const title = document.createElement("div");
        title.className = "vcp-siyuan-dock__title";
        title.textContent = this.i18n.dockTitle;
        const connection = document.createElement("div");
        connection.className = "vcp-siyuan-dock__connection";
        const dot = document.createElement("span");
        dot.className = "vcp-siyuan-dock__connection-dot";
        dot.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        const state = this.activeView === "resources"
            ? this.resourceStatus()
            : this.store.getState(this.activeView).status;
        label.textContent = state === "offline" || state === "error"
            ? this.i18n.connectionOffline
            : this.i18n.connectionOnline;
        connection.append(dot, label);
        const actions = document.createElement("div");
        actions.className = "vcp-siyuan-dock__actions";
        const refresh = document.createElement("button");
        refresh.type = "button";
        refresh.className = "b3-button b3-button--text";
        refresh.textContent = this.i18n.refresh;
        refresh.addEventListener("click", () => {
            if (this.activeView === "resources") void this.retryResources?.();
            else void this.refresh();
        });
        const settings = document.createElement("button");
        settings.type = "button";
        settings.className = "b3-button b3-button--text";
        settings.textContent = this.i18n.openSettings;
        settings.addEventListener("click", () => this.openSettingsCb());
        actions.append(refresh, settings);
        header.append(title, connection, actions);
        return header;
    }

    private renderWorkbench(root: HTMLElement): void {
        const tabs = document.createElement("nav");
        tabs.className = "vcp-siyuan-dock__tabs";
        tabs.setAttribute("aria-label", this.i18n.dockTitle);
        for (const view of views) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "b3-button b3-button--text";
            button.dataset.view = view;
            button.textContent = this.viewLabel(view);
            button.setAttribute("aria-selected", String(view === this.activeView));
            button.addEventListener("click", () => {
                this.activeView = view;
                if (view !== "resources") void this.store.activate(view);
                else if (!this.resourcesLoaded) {
                    this.resourcesLoaded = true;
                    void this.retryResources?.();
                }
                this.render();
            });
            tabs.append(button);
        }
        root.append(tabs);
        if (this.activeView === "resources") {
            this.renderResources(root);
            return;
        }
        root.append(this.renderFilters());
        root.append(this.renderTaskContent());
        root.append(this.createFooter());
    }

    private renderFilters(): HTMLElement {
        const filters = document.createElement("div");
        filters.className = "vcp-siyuan-dock__filters";
        const view = this.activeView as TaskView;
        const state = this.store.getState(view);
        const filterState = this.store.getFilters(view);
        const disabled = this.isWriteDisabled();
        const incomplete = document.createElement("label");
        incomplete.className = "vcp-siyuan-dock__check-filter";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = filterState.incompleteOnly;
        checkbox.disabled = disabled;
        checkbox.dataset.filter = "incomplete";
        checkbox.addEventListener("change", () => {
            void this.store.setIncompleteOnly(this.activeView as TaskView, checkbox.checked);
        });
        incomplete.append(checkbox, document.createTextNode(this.i18n.incomplete));
        filters.append(incomplete);
        if (this.activeView === "all") {
            this.appendMultiSelect(filters, "project");
        }
        this.appendMultiSelect(filters, "label");
        if (this.onCreateTask) {
            const create = document.createElement("button");
            create.type = "button";
            create.className = "b3-button b3-button--outline";
            create.dataset.action = "create-task";
            create.textContent = this.i18n.newTask;
            create.disabled = disabled;
            create.addEventListener("click", () => this.onCreateTask?.());
            filters.append(create);
        }
        void state;
        return filters;
    }

    private appendMultiSelect(
        filters: HTMLElement,
        key: "project" | "label",
    ): void {
        const view = this.activeView as TaskView;
        const filterState = this.store.getFilters(view);
        const options: MultiSelectOption[] = key === "project"
            ? this.getProjects()
                  .filter((project) => !project.archived || filterState.projectIds.includes(project.id))
                  .map((project) => ({
                      id: project.id,
                      label: this.projectPath(project.id) || project.title,
                      color: project.color,
                  }))
            : this.getLabels().map((label) => ({
                  id: label.id,
                  label: label.title,
                  color: label.color,
              }));
        const control = createMultiSelectFilter({
            key,
            label: key === "project" ? this.i18n.projects : this.i18n.labels,
            selectedIds: key === "project" ? filterState.projectIds : filterState.labelIds,
            options,
            disabled: this.isWriteDisabled(),
            onChange: (ids) =>
                void (key === "project"
                    ? this.store.setProjectIds(view, ids)
                    : this.store.setLabelIds(view, ids)),
        });
        this.multiSelects.push(control);
        filters.append(control);
    }

    private renderTaskContent(): HTMLElement {
        const content = document.createElement("main");
        content.className = "vcp-siyuan-dock__content";
        const view = this.activeView as TaskView;
        const state = this.store.getState(view);
        if (this.store.getConfigurationError(view)) {
            const notice = document.createElement("div");
            notice.className = "vcp-siyuan-dock__notice";
            notice.textContent = this.store.getConfigurationError(view) === "inbox"
                ? this.i18n.inboxNotConfigured
                : this.i18n.unconfigured;
            content.append(notice);
            return content;
        }
        if (state.status === "loading" || state.status === "idle") {
            const loading = document.createElement("div");
            loading.className = "vcp-siyuan-dock__loading";
            loading.textContent = this.i18n.loading;
            content.append(loading);
        } else if (state.status === "offline") {
            this.appendNotice(content, `${this.i18n.offline}${state.snapshotAt ? ` · ${this.i18n.snapshotAt(new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(state.snapshotAt))}` : ""}`, "offline");
            this.appendRows(content, view);
        } else if (state.status === "error") {
            this.appendNotice(content, state.error || this.i18n.loadError, "error");
            if (state.items.length > 0) this.appendRows(content, view);
        } else {
            if (state.status === "refreshing") {
                const refreshing = document.createElement("div");
                refreshing.className = "vcp-siyuan-dock__refreshing";
                refreshing.textContent = this.i18n.refreshing;
                content.append(refreshing);
            }
            this.appendRows(content, view);
        }
        return content;
    }

    private renderResources(root: HTMLElement): void {
        const content = document.createElement("main");
        content.className = "vcp-siyuan-dock__content vcp-siyuan-dock__resources";
        const status = this.resourceStatus();
        if (status === "loading" || status === "idle") {
            const notice = document.createElement("div");
            notice.className = "vcp-siyuan-dock__loading";
            notice.textContent = this.i18n.resourcesLoading;
            content.append(notice);
        } else if (status === "error") {
            this.appendNotice(content, this.resourceError() || this.i18n.resourcesError, "error");
            const retry = document.createElement("button");
            retry.type = "button";
            retry.className = "b3-button b3-button--text";
            retry.textContent = this.i18n.retry;
            retry.addEventListener("click", () => void this.retryResources?.());
            content.append(retry);
        }
        if (this.renderResourceManagement) {
            this.resourceDisposer = this.renderResourceManagement(content) || undefined;
        }
        root.append(content);
    }

    private appendRows(content: HTMLElement, view: TaskView): void {
        const items = this.store.getVisibleItems(view);
        if (items.length === 0) {
            const empty = document.createElement("div");
            empty.className = "vcp-siyuan-dock__empty";
            empty.textContent = this.i18n.empty;
            content.append(empty);
        } else {
            const rows = document.createElement("div");
            rows.className = "vcp-siyuan-dock__groups";
            for (const task of items) {
                rows.append(
                    createTaskRow(task, this.i18n, {
                        onOpen: this.onOpenTask,
                        onToggleDone: (taskId, done) => void this.store.toggleDone(taskId, done),
                        canComplete: !this.isWriteDisabled(),
                    }),
                );
            }
            content.append(rows);
        }
        const state = this.store.getState(view);
        if (state.items.length > 0 && state.items.length < state.total) {
            const loadMore = document.createElement("button");
            loadMore.type = "button";
            loadMore.className = "b3-button b3-button--text vcp-siyuan-dock__load-more";
            loadMore.dataset.action = "load-more";
            loadMore.textContent = this.i18n.loadMore;
            loadMore.disabled = this.store.isLoadingMore();
            loadMore.addEventListener("click", () => void this.store.loadNextPage());
            content.append(loadMore);
        }
    }

    private createFooter(): HTMLElement {
        const footer = document.createElement("footer");
        footer.className = "vcp-siyuan-dock__footer";
        const state = this.store.getState(this.activeView as TaskView);
        footer.textContent = `${this.i18n.shownCount(this.store.getVisibleItems(this.activeView as TaskView).length, state.total)} · ${this.i18n.timeZoneLabel(this.store.getTimeZone())}`;
        return footer;
    }

    private appendNotice(
        content: HTMLElement,
        message: string,
        kind: "offline" | "error",
    ): void {
        const notice = document.createElement("div");
        notice.className = "vcp-siyuan-dock__notice";
        notice.dataset.state = kind;
        notice.textContent = message;
        content.append(notice);
    }

    private isWriteDisabled(): boolean {
        const view = this.activeView as TaskView;
        const state = this.store.getState(view);
        return this.store.needsConfiguration(view) || ["offline", "error", "loading", "idle"].includes(state.status);
    }

    private viewLabel(view: DockView): string {
        if (view === "resources") return this.i18n.projectsAndLabels;
        const state = this.store.getState(view);
        return `${view === "inbox" ? this.i18n.inbox : this.i18n.allTasks} (${state.total})`;
    }

    private disposeDynamicContent(): void {
        for (const control of this.multiSelects) control.destroy();
        this.multiSelects = [];
        this.resourceDisposer?.();
        this.resourceDisposer = undefined;
    }
}
