import { TaskListStore, TaskView } from "../stores/TaskListStore.js";
import { TaskRowI18n, createTaskRow } from "./TaskRow.js";

export type DockGroupKey =
    | "overdue"
    | "today"
    | "next"
    | "tomorrow"
    | "thisWeek"
    | "nextWeek"
    | "later"
    | "all";

export interface VikunjaDockI18n extends TaskRowI18n {
    dockTitle: string;
    refresh: string;
    openSettings: string;
    loading: string;
    refreshing: string;
    empty: string;
    unconfigured: string;
    offline: string;
    loadError: string;
    focus: string;
    inbox: string;
    planned: string;
    newTask: string;
    manageProjects: string;
    manageLabels: string;
    loadMore: string;
    connectionOnline: string;
    connectionOffline: string;
    currentDocument: string;
    assignedToMe: string;
    groupLabel: (key: DockGroupKey) => string;
    shownCount: (shown: number, total: number) => string;
    serverFiltered: string;
    timeZoneLabel: (timeZone: string) => string;
    snapshotAt: (value: string) => string;
}

export interface VikunjaDockOptions {
    store: TaskListStore;
    openSettings: () => void;
    i18n: VikunjaDockI18n;
    /** Opens the task detail; without it rows are not interactive. */
    onOpenTask?: (taskId: number) => void;
    /** Starts task creation; without it the create button is hidden. */
    onCreateTask?: () => void;
    /** Opens project management. */
    onManageProjects?: () => void;
    /** Opens label management; the two are separate pages on purpose. */
    onManageLabels?: () => void;
    onCurrentDocumentFilterChange?: (enabled: boolean) => void | Promise<void>;
    onAssignedToMeFilterChange?: (enabled: boolean) => void | Promise<void>;
    now?: () => Date;
}

const views: TaskView[] = ["focus", "inbox", "planned"];

export class VikunjaDock {
    private readonly store: TaskListStore;
    private readonly openSettingsCb: () => void;
    private readonly onOpenTask?: (taskId: number) => void;
    private readonly onCreateTask?: () => void;
    private readonly onManageProjects?: () => void;
    private readonly onManageLabels?: () => void;
    private readonly onCurrentDocumentFilterChange?: (
        enabled: boolean,
    ) => void | Promise<void>;
    private readonly onAssignedToMeFilterChange?: (
        enabled: boolean,
    ) => void | Promise<void>;
    private readonly now: () => Date;
    private readonly i18n: VikunjaDockI18n;
    private readonly unsubscribeStore: () => void;
    private container?: HTMLElement;
    private destroyed = false;
    private activeView: TaskView = "focus";

    constructor(options: VikunjaDockOptions) {
        this.store = options.store;
        this.openSettingsCb = options.openSettings;
        this.onOpenTask = options.onOpenTask;
        this.onCreateTask = options.onCreateTask;
        this.onManageProjects = options.onManageProjects;
        this.onManageLabels = options.onManageLabels;
        this.onCurrentDocumentFilterChange =
            options.onCurrentDocumentFilterChange;
        this.onAssignedToMeFilterChange = options.onAssignedToMeFilterChange;
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
        this.unsubscribeStore();
        this.store.destroy();
        this.container?.replaceChildren();
        this.container = undefined;
    }

    async refresh(): Promise<void> {
        if (this.destroyed) return;
        if (this.store.needsConfiguration()) {
            this.render();
            return;
        }
        await this.store.refresh(this.activeView);
    }

    private render(): void {
        if (!this.container || this.destroyed) return;
        this.container.replaceChildren();
        const root = document.createElement("div");
        root.className = "vcp-siyuan-dock";

        const state = this.store.getState(this.activeView);
        const header = document.createElement("header");
        header.className = "vcp-siyuan-dock__header";
        const title = document.createElement("div");
        title.className = "vcp-siyuan-dock__title";
        title.textContent = this.i18n.dockTitle;
        const connection = document.createElement("div");
        connection.className = "vcp-siyuan-dock__connection";
        const connectionDot = document.createElement("span");
        connectionDot.className = "vcp-siyuan-dock__connection-dot";
        connectionDot.setAttribute("aria-hidden", "true");
        const connectionLabel = document.createElement("span");
        connectionLabel.textContent = this.connectionLabel(state.status);
        connection.append(connectionDot, connectionLabel);

        const actions = document.createElement("div");
        actions.className = "vcp-siyuan-dock__actions";
        const refresh = document.createElement("button");
        refresh.type = "button";
        refresh.className = "b3-button b3-button--text";
        refresh.dataset.action = "refresh";
        refresh.textContent = this.i18n.refresh;
        refresh.addEventListener("click", () => {
            void this.refresh().catch(() => {});
        });
        const settings = document.createElement("button");
        settings.type = "button";
        settings.className = "b3-button b3-button--text";
        settings.dataset.action = "settings";
        settings.textContent = this.i18n.openSettings;
        settings.addEventListener("click", () => this.openSettingsCb());
        actions.append(refresh, settings);
        header.append(title, connection, actions);
        root.append(header);

        this.renderWorkbench(root);
        this.container.append(root);
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
            button.setAttribute(
                "aria-selected",
                String(view === this.activeView),
            );
            button.addEventListener("click", () => {
                this.activeView = view;
                void this.store.activate(view).catch(() => {});
                this.render();
            });
            tabs.append(button);
        }
        root.append(tabs);

        const filters = document.createElement("div");
        filters.className = "vcp-siyuan-dock__filters";
        filters.append(
            this.createFilterButton(
                "current-document",
                this.i18n.currentDocument,
                this.store.getFilterState().currentDocument,
            ),
            this.createFilterButton(
                "assigned-to-me",
                this.i18n.assignedToMe,
                this.store.getFilterState().assignedToMe,
            ),
        );
        if (this.onCreateTask) {
            const create = document.createElement("button");
            create.type = "button";
            create.className = "b3-button b3-button--outline";
            create.dataset.action = "create-task";
            create.textContent = this.i18n.newTask;
            create.disabled = this.isWriteDisabled();
            create.addEventListener("click", () => this.onCreateTask?.());
            filters.append(create);
        }
        if (this.onManageProjects) {
            const manage = document.createElement("button");
            manage.type = "button";
            manage.className = "b3-button b3-button--text";
            manage.dataset.action = "manage-projects";
            manage.textContent = this.i18n.manageProjects;
            manage.disabled = this.isWriteDisabled();
            manage.addEventListener("click", () => this.onManageProjects?.());
            filters.append(manage);
        }
        if (this.onManageLabels) {
            const manage = document.createElement("button");
            manage.type = "button";
            manage.className = "b3-button b3-button--text";
            manage.dataset.action = "manage-labels";
            manage.textContent = this.i18n.manageLabels;
            manage.disabled = this.isWriteDisabled();
            manage.addEventListener("click", () => this.onManageLabels?.());
            filters.append(manage);
        }
        root.append(filters);

        const state = this.store.getState(this.activeView);
        const content = document.createElement("main");
        content.className = "vcp-siyuan-dock__content";
        if (this.store.needsConfiguration()) {
            this.appendNotice(content, this.i18n.unconfigured, "unconfigured");
        } else if (state.status === "loading" || state.status === "idle") {
            const loading = document.createElement("div");
            loading.className = "vcp-siyuan-dock__loading";
            loading.setAttribute("role", "status");
            loading.textContent = this.i18n.loading;
            content.append(loading);
        } else if (state.status === "offline") {
            const snapshot = state.snapshotAt
                ? this.i18n.snapshotAt(
                      new Intl.DateTimeFormat(undefined, {
                          dateStyle: "short",
                          timeStyle: "short",
                      }).format(state.snapshotAt),
                  )
                : "";
            this.appendNotice(
                content,
                snapshot
                    ? `${this.i18n.offline} · ${snapshot}`
                    : this.i18n.offline,
                "offline",
            );
            this.appendRows(content);
        } else if (state.status === "error") {
            this.appendNotice(
                content,
                state.error || this.i18n.loadError,
                "error",
            );
            if (state.items.length > 0) this.appendRows(content);
        } else {
            if (state.status === "refreshing") {
                const refreshing = document.createElement("div");
                refreshing.className = "vcp-siyuan-dock__refreshing";
                refreshing.setAttribute("role", "status");
                refreshing.textContent = this.i18n.refreshing;
                content.append(refreshing);
            }
            this.appendRows(content);
        }
        root.append(content);
        root.append(this.createFooter(state));
    }

    private createFilterButton(
        key: "current-document" | "assigned-to-me",
        label: string,
        selected: boolean,
    ): HTMLButtonElement {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "b3-button b3-button--text vcp-siyuan-dock__filter";
        button.dataset.filter = key;
        button.setAttribute("aria-pressed", String(selected));
        button.textContent = label;
        button.addEventListener("click", () => {
            const enabled = !selected;
            if (key === "current-document") {
                this.store.setCurrentDocumentFilter(enabled);
                void this.onCurrentDocumentFilterChange?.(enabled);
            } else {
                this.store.setAssignedToMe(enabled);
                void this.onAssignedToMeFilterChange?.(enabled);
            }
        });
        return button;
    }

    private appendRows(content: HTMLElement): void {
        const groups = this.store.getGroups(this.activeView, this.now());
        const visibleCount = groups.reduce(
            (count, group) => count + group.items.length,
            0,
        );
        if (visibleCount === 0) {
            const empty = document.createElement("div");
            empty.className = "vcp-siyuan-dock__empty";
            empty.textContent = this.i18n.empty;
            content.append(empty);
            this.appendLoadMore(content);
            return;
        }
        const groupsRoot = document.createElement("div");
        groupsRoot.className = "vcp-siyuan-dock__groups";
        for (const group of groups) {
            if (group.items.length === 0) continue;
            const groupElement = document.createElement("section");
            groupElement.className = "vcp-siyuan-dock__group";
            const heading = document.createElement("h3");
            heading.className = "vcp-siyuan-dock__group-title";
            heading.textContent = this.i18n.groupLabel(group.key);
            groupElement.append(heading);
            for (const task of group.items) {
                groupElement.append(
                    createTaskRow(task, this.i18n, {
                        onOpen: this.onOpenTask,
                        onToggleDone: (taskId, done) => {
                            void this.store.toggleDone(taskId, done);
                        },
                        canComplete: !this.isWriteDisabled(),
                    }),
                );
            }
            groupsRoot.append(groupElement);
        }
        content.append(groupsRoot);
        this.appendLoadMore(content);
    }

    private appendLoadMore(content: HTMLElement): void {
        const state = this.store.getState(this.activeView);
        if (state.items.length === 0 || state.items.length >= state.total)
            return;
        const loadMore = document.createElement("button");
        loadMore.type = "button";
        loadMore.className =
            "b3-button b3-button--text vcp-siyuan-dock__load-more";
        loadMore.dataset.action = "load-more";
        loadMore.textContent = this.i18n.loadMore;
        loadMore.disabled = this.store.isLoadingMore();
        loadMore.addEventListener("click", () => {
            void this.store.loadNextPage().catch(() => {});
        });
        content.append(loadMore);
    }

    private createFooter(
        state: ReturnType<TaskListStore["getState"]>,
    ): HTMLElement {
        const footer = document.createElement("footer");
        footer.className = "vcp-siyuan-dock__footer";
        const visible = this.store.getVisibleItems(this.activeView).length;
        const count = document.createElement("span");
        count.textContent = this.i18n.shownCount(visible, state.total);
        const filterState = this.store.getFilterState();
        if (filterState.currentDocument || filterState.assignedToMe) {
            const filtered = document.createElement("span");
            filtered.textContent = this.i18n.serverFiltered;
            footer.append(filtered);
        }
        const timeZone = document.createElement("span");
        timeZone.textContent = this.i18n.timeZoneLabel(
            this.store.getTimeZone(),
        );
        footer.prepend(count, timeZone);
        return footer;
    }

    private appendNotice(
        content: HTMLElement,
        message: string,
        kind: "unconfigured" | "offline" | "error",
    ): void {
        const notice = document.createElement("div");
        notice.className = "vcp-siyuan-dock__notice";
        notice.dataset.state = kind;
        notice.setAttribute("role", "status");
        notice.textContent = message;
        content.append(notice);
    }

    private isWriteDisabled(): boolean {
        const status = this.store.getState(this.activeView).status;
        return (
            this.store.needsConfiguration() ||
            status === "offline" ||
            status === "error" ||
            status === "loading" ||
            status === "idle"
        );
    }

    private connectionLabel(
        status: ReturnType<TaskListStore["getState"]>["status"],
    ): string {
        return status === "offline" || status === "error"
            ? this.i18n.connectionOffline
            : this.i18n.connectionOnline;
    }

    private viewLabel(view: TaskView): string {
        const state = this.store.getState(view);
        const label =
            view === "focus"
                ? this.i18n.focus
                : view === "inbox"
                  ? this.i18n.inbox
                  : this.i18n.planned;
        return `${label} (${state.total})`;
    }
}
