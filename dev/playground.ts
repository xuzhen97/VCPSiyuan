// Mirror the plugin entry point (`src/frontend/index.ts`): the Vite sandbox has to
// import the stylesheets itself, otherwise the Dock renders with no CSS at all.
import "../src/frontend/dock/VikunjaDock.scss";
import "../src/frontend/dialogs/dialog.scss";
import "../src/frontend/settings.scss";
import { SiYuanHttpClient } from "../src/kernel/http/SiYuanHttpClient.js";
import { registerVikunjaRpc } from "../src/kernel/rpc/registerVikunjaRpc.js";
import { ConnectionService } from "../src/kernel/services/ConnectionService.js";
import { TaskQueryService } from "../src/kernel/services/TaskQueryService.js";
import { TaskCommandService } from "../src/kernel/services/TaskCommandService.js";
import { ProjectService } from "../src/kernel/services/ProjectService.js";
import { LabelService } from "../src/kernel/services/LabelService.js";
import { UserService } from "../src/kernel/services/UserService.js";
import { AttachmentService } from "../src/kernel/services/AttachmentService.js";
import { TaskGateway } from "../src/kernel/vikunja/TaskGateway.js";
import { ProjectGateway } from "../src/kernel/vikunja/ProjectGateway.js";
import { LabelGateway } from "../src/kernel/vikunja/LabelGateway.js";
import { UserGateway } from "../src/kernel/vikunja/UserGateway.js";
import { AttachmentGateway } from "../src/kernel/vikunja/AttachmentGateway.js";
import { VikunjaV2Client } from "../src/kernel/vikunja/VikunjaV2Client.js";
import { VikunjaController } from "../src/frontend/VikunjaController.js";
import { VikunjaDock } from "../src/frontend/dock/VikunjaDock.js";
import { TaskDetailView } from "../src/frontend/dock/TaskDetailView.js";
import { TaskDialog } from "../src/frontend/dialogs/TaskDialog.js";
import { createModalHost } from "../src/frontend/dialogs/modalHost.js";
import { TaskListStore } from "../src/frontend/stores/TaskListStore.js";
import { TaskDetailStore } from "../src/frontend/stores/TaskDetailStore.js";
import { TaskDialogStore } from "../src/frontend/stores/TaskDialogStore.js";
import { ResourceStore } from "../src/frontend/stores/ResourceStore.js";
import { ManagementStore } from "../src/frontend/stores/ManagementStore.js";
import { ProjectManagerDialog } from "../src/frontend/dialogs/ProjectManagerDialog.js";
import { LabelManagerDialog } from "../src/frontend/dialogs/LabelManagerDialog.js";
import { PluginConfig } from "../src/shared/config.js";
import {
    RpcRequest,
    RpcResponse,
    VikunjaRpcMethod,
} from "../src/shared/rpc.js";
import { VikunjaCredentials, RpcResult } from "../src/shared/contracts.js";
import { TaskDetail } from "../src/shared/task.js";
import { createForwardProxyShim } from "./forwardProxyShim.js";

function log(msg: string): void {
    const box = document.getElementById("log-box");
    if (box) {
        const time = new Date().toLocaleTimeString();
        const row = document.createElement("div");
        row.textContent = `[${time}] ${msg}`;
        box.append(row);
        box.scrollTop = box.scrollHeight;
    }
    console.log(`[Playground] ${msg}`);
}

const STORAGE_KEY_CONFIG = "vcp_siyuan_play_config";
const STORAGE_KEY_SECRETS = "vcp_siyuan_play_secrets";

function defaultConfig(): PluginConfig {
    return {
        schemaVersion: 2,
        vikunjaOrigin: "http://localhost:3456",
        vikunjaTokenSecretName: "VIKUNJA_API_TOKEN",
        inboxProjectId: null,
        snapshotEnabled: true,
    };
}

function loadSavedConfig(): PluginConfig {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_CONFIG);
        if (raw) return JSON.parse(raw) as PluginConfig;
    } catch (error) {
        console.warn("Failed to load saved config from localStorage", error);
    }
    return defaultConfig();
}

function loadSavedSecrets(): Record<string, string> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_SECRETS);
        if (raw) return JSON.parse(raw) as Record<string, string>;
    } catch (error) {
        console.warn("Failed to load saved secrets from localStorage", error);
    }
    return { VIKUNJA_API_TOKEN: "" };
}

let currentConfig = loadSavedConfig();
let currentSecrets = loadSavedSecrets();

// The sandbox has no SiYuan Kernel, so the forward-proxy shim stands in for it.
// Everything above it (transport, gateways, services, RPC table) is production
// code, which is what makes this page a usable end-to-end harness.
const shim = createForwardProxyShim();
const httpClient = new SiYuanHttpClient(shim.fetch, {
    logger: (entry) =>
        log(`HTTP ${entry.method} ${entry.url} ${entry.status ?? ""}`.trim()),
});

const client = new VikunjaV2Client(httpClient);
const taskGateway = new TaskGateway(client);
const connection = new ConnectionService(client, {
    taskPatch: true,
    projectPermissions: true,
});
const capability = async (credentials: VikunjaCredentials) => {
    const response = await client.requestJson<Record<string, unknown>>(
        credentials,
        "GET",
        "/info",
    );
    const version =
        typeof response.data.version === "string"
            ? response.data.version
            : undefined;
    return {
        writesAllowed: version === "v2.5.0",
        attachments: response.data.task_attachments_enabled === true,
    };
};

// Reuse the Kernel's real dispatch table instead of hand-rolling a switch, so
// the sandbox cannot silently drift from the plugin's RPC surface.
const handlers = new Map<string, (envelope: unknown) => Promise<unknown>>();
await registerVikunjaRpc(
    {
        bind: (name, handler) => {
            handlers.set(name, handler);
        },
        unbind: (name) => {
            handlers.delete(name);
        },
    },
    {
        connection,
        tasks: new TaskQueryService(taskGateway),
        commands: new TaskCommandService(taskGateway, {
            writesAllowed: async (credentials) =>
                (await capability(credentials)).writesAllowed,
        }),
        projects: new ProjectService(new ProjectGateway(client), taskGateway, {
            writesAllowed: async (credentials) =>
                (await capability(credentials)).writesAllowed,
        }),
        labels: new LabelService(new LabelGateway(client), taskGateway, {
            writesAllowed: async (credentials) =>
                (await capability(credentials)).writesAllowed,
        }),
        users: new UserService(new UserGateway(client)),
        attachments: new AttachmentService(new AttachmentGateway(client), {
            attachmentsEnabled: async (credentials) =>
                (await capability(credentials)).attachments,
        }),
    },
);

const controller = new VikunjaController({
    getConfig: () => currentConfig,
    getSecret: (name: string) => currentSecrets[name] || "",
    call: async <K extends VikunjaRpcMethod>(
        method: K,
        envelope: { credentials: VikunjaCredentials; request: RpcRequest<K> },
    ): Promise<RpcResult<RpcResponse<K>>> => {
        log(`RPC Call -> ${method}`);
        const handler = handlers.get(method);
        if (!handler) {
            return {
                ok: false,
                error: {
                    code: "REMOTE_ERROR",
                    message: `Unsupported playground method: ${method}`,
                    retryable: false,
                },
            } as RpcResult<RpcResponse<K>>;
        }
        return (await handler(envelope)) as RpcResult<RpcResponse<K>>;
    },
});

const mountPoint = document.getElementById("dock-mount-point");
let dock: VikunjaDock | null = null;
const taskListStore = new TaskListStore({
    controller,
    origin: currentConfig.vikunjaOrigin ?? "",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    inboxProjectId: currentConfig.inboxProjectId ?? null,
});
const resourceStore = new ResourceStore({ controller });
let managementModal: { dispose: () => void } | null = null;

// Dialog i18n. The sandbox has no SiYuan i18n bundle, so these mirror
// i18n/en.json for the components that take their strings by injection.
const taskDialogI18n = {
    titleLabel: "Title",
    descriptionLabel: "Description",
    projectLabel: "Project",
    startDateLabel: "Start date",
    dueDateLabel: "Due date",
    priorityLabel: "Priority",
    labelsLabel: "Labels",
    assigneesLabel: "Assignees",
    assigneeUnavailable: "historical member",
    assigneeSearchPlaceholder: "Search members",
    reminderLabel: "Reminders",
    addReminder: "Add reminder",
    removeReminder: "Remove reminder",
    repeatLabel: "Repeat",
    repeatNone: "Does not repeat",
    repeatEvery: "Every",
    repeatDay: "day",
    repeatWeek: "week",
    repeatMonth: "month",
    preservedRepeat: "Server rule",
    blockLinkLabel: "Link selected Block",
    projectRequired: "Select a project",
    projectNotWritable: "Project is not writable",
    conflict: "This task changed remotely",
    reload: "Reload",
    review: "Review local changes",
    cancel: "Cancel",
    save: "Save",
    titleRequired: "Title is required",
    saveFailed: "Unable to save task",
    attachments: "Attachments",
    uploadAttachment: "Upload attachment",
    attachmentLimit: (value: string) => `Limit: ${value}`,
    attachmentsDisabled: "Attachments are disabled",
    noAttachments: "No attachments",
    attachmentList: {
        retry: "Retry",
        download: "Download",
        delete: "Delete",
        statusLabel: (state: string) => state,
    },
};

const taskDetailI18n = {
    back: "Back",
    reopen: "Reopen",
    complete: "Complete",
    edit: "Edit",
    projectPrefix: "Project #",
    projectUnknown: "Project ?",
    status: "Status",
    priority: "Priority",
    startDate: "Start date",
    dueDate: "Due date",
    labels: "Labels",
    assignees: "Assignees",
    reminders: "Reminders",
    repeat: "Repeat",
    description: "Description",
    attachments: "Attachments",
    blocks: "Blocks",
    noAttachments: "No attachments",
    uploadAttachment: "Upload attachment",
    attachmentsDisabled: "Attachments are disabled",
    attachmentLimit: (value: string) => `Limit: ${value}`,
    retry: "Retry",
    loadError: "Unable to load task",
    retryLoad: "Retry",
    blockOpen: "Open Block",
    blockUnknown: "No linked Blocks",
    blockCount: (count: number) => `${count} Blocks`,
    permissionReadOnly: "Read-only task",
    repeatNone: "Does not repeat",
    repeatEvery: (every: number, unit: string) => `Every ${every} ${unit}`,
    preservedRepeat: (summary: string) => `Server rule: ${summary}`,
    attachmentList: {
        retry: "Retry",
        download: "Download",
        delete: "Delete",
        statusLabel: (state: string) => state,
    },
    formatDate: (value: string) =>
        new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
        }).format(new Date(value)),
};

function confirmDiscard(): boolean {
    return window.confirm(
        "Discard changes?\nYour unsaved task changes will be lost.",
    );
}

let detailModal: { host: HTMLElement; dispose: () => void } | null = null;
let detailStore: TaskDetailStore | null = null;
let detailView: TaskDetailView | null = null;

function closeTaskDetail(): void {
    detailView?.destroy();
    detailView = null;
    detailStore?.destroy();
    detailStore = null;
    detailModal?.dispose();
    detailModal = null;
}

async function openTaskDetail(taskId: number): Promise<void> {
    const store = new TaskDetailStore({ controller });
    await store.open(taskId);
    const detail = store.getDetail();
    if (!detail) {
        log(`Failed to load task ${taskId}`);
        store.destroy();
        return;
    }
    closeTaskDetail();
    detailStore = store;
    const modal = createModalHost(
        () => closeTaskDetail(),
        "vcp-siyuan-linked-task-dialog",
    );
    detailModal = modal;
    detailView = new TaskDetailView({
        task: detail,
        i18n: taskDetailI18n,
        onBack: () => closeTaskDetail(),
        onComplete: () => {
            void store
                .toggleDone(!detail.done)
                .then(() => openTaskDetail(taskId));
        },
        onEdit: () => openEditTask(detail),
    });
    detailView.mount(modal.host);
}

function openEditTask(detail: TaskDetail): void {
    const store = TaskDialogStore.edit(detail);
    let disposeHost = (): void => {};
    const dialog = new TaskDialog({
        store,
        title: "Edit task",
        i18n: taskDialogI18n,
        onSave: async () => {
            const relations = store.getRelationChanges();
            const result = await controller.call("vikunja.tasks.patch", {
                taskId: detail.id,
                patch: store.getPatch(),
                expected: {
                    etag: detail.etag,
                    updatedAt: detail.updatedAt,
                },
                ...(relations.labels ? { labels: relations.labels } : {}),
                ...(relations.assignees
                    ? { assignees: relations.assignees }
                    : {}),
            });
            if (!result.ok)
                throw new Error(result.error.message || result.error.code);
            dialog.destroy();
            disposeHost();
            await openTaskDetail(detail.id);
        },
        onClose: () => {
            dialog.destroy();
            disposeHost();
        },
        confirmDiscard,
    });
    const modal = createModalHost(() => {
        void dialog.close();
    });
    disposeHost = modal.dispose;
    dialog.mount(modal.host);
}

function openCreateTask(): void {
    const projectId = currentConfig.inboxProjectId ?? 1;
    const store = TaskDialogStore.create({ projectId });
    let disposeHost = (): void => {};
    const dialog = new TaskDialog({
        store,
        title: "New task",
        i18n: taskDialogI18n,
        onSave: async (draft) => {
            const result = await controller.call("vikunja.tasks.create", {
                draft,
            });
            if (!result.ok)
                throw new Error(result.error.message || result.error.code);
            dialog.destroy();
            disposeHost();
            await dock?.refresh();
            await openTaskDetail(result.data.id);
        },
        onClose: () => {
            dialog.destroy();
            disposeHost();
        },
        confirmDiscard,
    });
    const modal = createModalHost(() => {
        void dialog.close();
    });
    disposeHost = modal.dispose;
    dialog.mount(modal.host);
}

async function openLabelManagementDialog(): Promise<void> {
    await resourceStore.refresh();
    const labels = resourceStore.getLabels();
    const impact = labels[0]
        ? await controller.call("vikunja.labels.deleteImpact", {
              labelId: labels[0].id,
          })
        : undefined;
    const management = new ManagementStore({
        deleteResource: (kind, id, expectedTitle) =>
            kind === "label"
                ? controller.call("vikunja.labels.delete", {
                      labelId: id,
                      expectedTitle: expectedTitle ?? "",
                  })
                : controller.call("vikunja.projects.delete", {
                      projectId: id,
                      expectedTitle: expectedTitle ?? "",
                  }),
    });
    if (impact?.ok) management.setLabelImpact(impact.data);
    const dialog = new LabelManagerDialog({
        labels,
        impact: impact?.ok ? impact.data : undefined,
        i18n: {
            title: "Labels",
            usage: (count) => `${count} tasks`,
            confirmPlaceholder: "Type the exact title",
            delete: "Delete",
            cancel: "Cancel",
            save: "Save",
            search: "Search labels",
            create: "Create label",
            edit: "Edit",
            titleLabel: "Title",
            descriptionLabel: "Description",
            colorLabel: "Color",
        },
        onCreate: async (draft) => {
            await resourceStore.createLabel(draft);
            dialog.destroy();
            managementModal?.dispose();
        },
        onEdit: async (id, draft) => {
            await resourceStore.patchLabel(id, draft);
            dialog.destroy();
            managementModal?.dispose();
        },
        onPreviewDelete: async (labelId) => {
            const preview = await controller.call(
                "vikunja.labels.deleteImpact",
                { labelId },
            );
            if (preview.ok) {
                management.setLabelImpact(preview.data);
                dialog.setImpact(preview.data);
            }
        },
        onDelete: async (title) => {
            const target = management.getState().labelImpact?.label;
            if (!target) return;
            const result = await management.deleteLabel(target.id, title);
            if (result.ok) {
                dialog.destroy();
                managementModal?.dispose();
                await resourceStore.refresh();
                dock?.invalidate();
            }
        },
    });
    const host = createModalHost(() => {
        dialog.destroy();
        host.dispose();
    });
    managementModal = host;
    dialog.mount(host.host);
}

async function openManagementDialog(): Promise<void> {
    await resourceStore.refresh();
    const projects = resourceStore.getProjects();
    const project = projects[0];
    const impact = project
        ? await controller.call("vikunja.projects.deleteImpact", {
              projectId: project.id,
              inboxProjectId: currentConfig.inboxProjectId,
          })
        : undefined;
    const management = new ManagementStore({
        deleteResource: (kind, id, expectedTitle) =>
            kind === "project"
                ? controller.call("vikunja.projects.delete", {
                      projectId: id,
                      expectedTitle: expectedTitle ?? "",
                  })
                : controller.call("vikunja.labels.delete", {
                      labelId: id,
                      expectedTitle: expectedTitle ?? "",
                  }),
    });
    if (impact?.ok) management.setImpact(impact.data);
    const dialog = new ProjectManagerDialog({
        projects,
        impact: impact?.ok ? impact.data : undefined,
        i18n: {
            title: "Projects",
            impact: (open, completed, descendants) =>
                `${open} open, ${completed} completed, ${descendants} descendants`,
            confirmLabel: "Confirm title",
            delete: "Delete",
            cancel: "Cancel",
            save: "Save",
            search: "Search projects",
            create: "Create project",
            edit: "Edit",
            titleLabel: "Title",
            descriptionLabel: "Description",
            colorLabel: "Color",
            parentLabel: "Parent",
            archivedLabel: "Archived",
            projectPath: (path) => path,
            manageLabels: "Manage labels",
        },
        onCreate: async (draft) => {
            await resourceStore.createProject({
                ...draft,
                color: draft.color?.replace(/^#/, "") || null,
                parentProjectId: draft.parentProjectId || 0,
            });
            dialog.destroy();
            managementModal?.dispose();
        },
        onEdit: async (id, draft) => {
            await resourceStore.patchProject(id, draft);
            dialog.destroy();
            managementModal?.dispose();
        },
        onPreviewDelete: async (projectId) => {
            const preview = await controller.call(
                "vikunja.projects.deleteImpact",
                { projectId, inboxProjectId: currentConfig.inboxProjectId },
            );
            if (preview.ok) {
                management.setImpact(preview.data);
                dialog.setImpact(preview.data);
            }
        },
        onDelete: async (title) => {
            const target = management.getState().impact?.project;
            if (!target) return;
            const result = await management.deleteProject(target.id, title);
            if (result.ok) {
                dialog.destroy();
                managementModal?.dispose();
                await resourceStore.refresh();
                dock?.invalidate();
            }
        },
        onOpenLabels: () => {
            dialog.destroy();
            managementModal?.dispose();
            void openLabelManagementDialog();
        },
    });
    const host = createModalHost(() => {
        dialog.destroy();
        host.dispose();
    });
    managementModal = host;
    dialog.mount(host.host);
}

function initDock(): void {
    if (!mountPoint) return;
    dock?.destroy();
    taskListStore.updateConfig(
        currentConfig.vikunjaOrigin ?? "",
        currentConfig.inboxProjectId ?? null,
    );
    dock = new VikunjaDock({
        store: taskListStore,
        openSettings: () => log("Open settings in the host application"),
        onOpenTask: (taskId: number) => {
            void openTaskDetail(taskId);
        },
        onCreateTask: () => openCreateTask(),
        onManageResources: () => void openManagementDialog(),
        i18n: {
            dockTitle: "Vikunja Tasks",
            refresh: "Refresh",
            openSettings: "Settings",
            loading: "Loading tasks...",
            refreshing: "Refreshing…",
            empty: "No tasks",
            unconfigured: "Not configured",
            offline: "Offline summary; remote actions are disabled",
            loadError: "Unable to load tasks",
            focus: "Focus",
            inbox: "Inbox",
            planned: "Planned",
            newTask: "New task",
            manageResources: "Manage resources",
            loadMore: "Load more",
            connectionOnline: "Connected",
            connectionOffline: "Offline",
            currentDocument: "Current note",
            assignedToMe: "Assigned to me",
            groupLabel: (key) =>
                ({
                    overdue: "Overdue",
                    today: "Today",
                    next: "Next",
                    tomorrow: "Tomorrow",
                    thisWeek: "This week",
                    nextWeek: "Next week",
                    later: "Later",
                    all: "All tasks",
                })[key],
            shownCount: (shown, total) => `Showing ${shown} of ${total}`,
            serverFiltered: "Server-filtered",
            timeZoneLabel: (timeZone) => `Time zone: ${timeZone}`,
            snapshotAt: (value) => `Snapshot ${value}`,
            labelsSummary: (labels) => `Labels: ${labels.join(", ")}`,
            assigneesSummary: (assignees) =>
                `Assignees: ${assignees.join(", ")}`,
            attachmentCount: (count) => `Attachments: ${count}`,
            blockCount: (count) => `Blocks: ${count}`,
            openTask: "Open task",
            complete: "Complete",
            reopen: "Reopen",
            formatDate: (value) =>
                new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                }).format(new Date(value)),
            projectPrefix: "Project #",
            priorityLabel: (priority) => `Priority ${priority}`,
        },
    });
    dock.mount(mountPoint);
}

const urlInput = document.getElementById(
    "cfg-base-url",
) as HTMLInputElement | null;
const secretNameInput = document.getElementById(
    "cfg-secret-name",
) as HTMLInputElement | null;
const secretValInput = document.getElementById(
    "cfg-secret-value",
) as HTMLInputElement | null;
const saveBtn = document.getElementById("btn-save-secrets");
const testBtn = document.getElementById("btn-test-conn");
const statusSpan = document.getElementById("test-result-status");

if (urlInput && secretNameInput && secretValInput) {
    urlInput.value = currentConfig.vikunjaOrigin ?? "";
    secretNameInput.value = currentConfig.vikunjaTokenSecretName;
    secretValInput.value =
        currentSecrets[currentConfig.vikunjaTokenSecretName] || "";
}

saveBtn?.addEventListener("click", () => {
    if (!urlInput || !secretNameInput || !secretValInput) return;
    currentConfig = {
        ...defaultConfig(),
        vikunjaOrigin: urlInput.value.trim(),
        vikunjaTokenSecretName: secretNameInput.value.trim(),
    };
    currentSecrets = {
        ...currentSecrets,
        [currentConfig.vikunjaTokenSecretName]: secretValInput.value.trim(),
    };
    localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(currentConfig));
    localStorage.setItem(STORAGE_KEY_SECRETS, JSON.stringify(currentSecrets));
    taskListStore.updateConfig(
        currentConfig.vikunjaOrigin ?? "",
        currentConfig.inboxProjectId ?? null,
    );
    dock?.invalidate();
    dock?.refresh().catch(() => {});
});

testBtn?.addEventListener("click", async () => {
    if (!statusSpan) return;
    statusSpan.textContent = "Testing connection...";
    const result = await controller.testConnection();
    statusSpan.textContent = result.ok
        ? `✓ Connected${result.data.serverVersion ? ` (${result.data.serverVersion})` : ""}`
        : `✗ ${result.error.message || result.error.code}`;
});

initDock();
