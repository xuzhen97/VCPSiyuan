import {
    Plugin,
    Setting,
    confirm as siyuanConfirm,
    showMessage,
    openTab,
    getAllEditor,
} from "siyuan";
import {
    DEFAULT_CONFIG,
    normalizePluginConfig,
    PluginConfig,
} from "../shared/config.js";
import { VikunjaDock } from "./dock/VikunjaDock.js";
import { createSettings, SettingsDescriptor } from "./settings.js";
import { VikunjaController } from "./controller/VikunjaController.js";
import { AuthenticatedRpcEnvelope } from "./controller/VikunjaController.js";
import { RpcResponse, VikunjaRpcMethod } from "../shared/rpc.js";
import { ConnectionInfo, RpcResult } from "../shared/contracts.js";
import { registerBlockMenu } from "./context/blockMenu.js";
import { BlockLinkRepository } from "./context/BlockLinkRepository.js";
import { TaskLinkIndex, TaskLinkIndexEntry } from "./context/TaskLinkIndex.js";
import { createCurrentDocumentSource } from "./context/currentDocument.js";
import { parseBlockTaskLinks } from "../shared/block-link.js";
import {
    BlockCreateDialogRequest,
    createBlockMenuActions,
} from "./context/blockMenuActions.js";
import { DefaultSiYuanContextController } from "./controller/SiYuanContextController.js";
import { createModalHost } from "./dialogs/modalHost.js";
import { TaskDialogStore } from "./stores/TaskDialogStore.js";
import { TaskDialog } from "./dialogs/TaskDialog.js";
import type { TaskDialogI18n } from "./dialogs/TaskDialog.js";
import { createTaskSaveOnce } from "./dialogs/taskCreateWorkflow.js";
import { TaskDetail } from "../shared/task.js";
import { TaskDetailStore } from "./stores/TaskDetailStore.js";
import { TaskDetailView } from "./dock/TaskDetailView.js";
import { TaskListStore } from "./stores/TaskListStore.js";
import { SummaryCache } from "./persistence/SummaryCache.js";
import { ResourceStore } from "./stores/ResourceStore.js";
import { AttachmentStore } from "./stores/AttachmentStore.js";
import { PendingOperationStore } from "./persistence/PendingOperationStore.js";
import { ManagementStore } from "./stores/ManagementStore.js";
import { ProjectManagerDialog } from "./dialogs/ProjectManagerDialog.js";
import { LabelManagerDialog } from "./dialogs/LabelManagerDialog.js";

const STORAGE_NAME = "config.json";
const PRIVATE_DATA_FILES = [
    "config.json",
    "task-summary-cache-v1.json",
    "task-link-index-v1.json",
    "pending-operations-v1.json",
] as const;

async function callKernelRpc<K extends VikunjaRpcMethod>(
    plugin: Plugin,
    method: K,
    envelope: AuthenticatedRpcEnvelope<K>,
): Promise<RpcResult<RpcResponse<K>>> {
    const handler = (
        plugin.kernel.rpc.call as Record<
            string,
            (args: unknown) => Promise<unknown>
        >
    )[method];
    if (!handler) {
        return {
            ok: false,
            error: {
                code: "REMOTE_ERROR",
                message: `RPC method ${method} is unavailable`,
                retryable: false,
            },
        } as RpcResult<RpcResponse<K>>;
    }
    // SAFETY: Kernel RPC validates the same typed envelope before dispatch; this adapter
    // only converts the dynamic SiYuan method table back to the shared RPC result type.
    return handler(envelope) as Promise<RpcResult<RpcResponse<K>>>;
}
const DOCK_TYPE = "vikunja-tasks";

export class VCPSiyuanPlugin extends Plugin {
    private config: PluginConfig = { ...DEFAULT_CONFIG };
    private controller!: VikunjaController;
    private dockInstance!: VikunjaDock;
    private taskListStore?: TaskListStore;
    private resourceStore?: ResourceStore;
    private pendingOperations?: PendingOperationStore;
    private capabilities?: ConnectionInfo;
    private settingsDescriptor?: SettingsDescriptor;
    private managementStore?: ManagementStore;
    private disposeBlockMenu?: () => void;
    private initialized = false;
    private destroyed = false;
    private blockLinks?: BlockLinkRepository;
    private linkIndex?: TaskLinkIndex;
    private contextController?: DefaultSiYuanContextController;
    private linkedTaskModal?: { host: HTMLElement; dispose: () => void };
    private linkedTaskView?: TaskDetailView;
    private linkedTaskStore?: TaskDetailStore;
    private linkedTaskAttachments?: AttachmentStore;
    private linkedTaskUnsubscribe?: () => void;
    private linkedTaskDetailUnsubscribe?: () => void;
    private managementModal?: { host: HTMLElement; dispose: () => void };
    private managementDialog?: ProjectManagerDialog | LabelManagerDialog;
    private currentDocumentSource?: ReturnType<
        typeof createCurrentDocumentSource
    >;
    private onSwitchProtyle?: (event: unknown) => void;

    onload(): void {
        if (this.initialized) return;
        this.initialized = true;
        this.addIcons(`
<symbol id="iconVikunja" viewBox="0 0 32 32">
    <rect x="3.5" y="3.5" width="25" height="25" rx="6"></rect>
    <path d="M8.5 16l5 5 10-11" fill="none" stroke="var(--b3-theme-background)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"></path>
</symbol>`);

        this.controller = new VikunjaController({
            getConfig: () => this.config,
            getSecret: (name: string) =>
                name === this.config.vikunjaTokenSecretName &&
                this.config.inlineToken
                    ? this.config.inlineToken
                    : this.getSecret(name),
            call: <K extends VikunjaRpcMethod>(
                method: K,
                envelope: AuthenticatedRpcEnvelope<K>,
            ) => callKernelRpc(this, method, envelope),
        });
        this.resourceStore = new ResourceStore({
            controller: this.controller,
        });
        this.pendingOperations = new PendingOperationStore({
            load: (name: string) => this.loadData(name),
            save: (name: string, value: unknown) => this.saveData(name, value),
        });

        const summaryCache = new SummaryCache({
            load: (name: string) => this.loadData(name),
            save: (name: string, value: unknown) => this.saveData(name, value),
        });
        const taskListStore = new TaskListStore({
            controller: this.controller,
            origin: this.config.vikunjaOrigin ?? "",
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            inboxProjectId: this.config.inboxProjectId ?? null,
            summaryCache,
        });
        this.taskListStore = taskListStore;
        this.currentDocumentSource = createCurrentDocumentSource(() =>
            getAllEditor().map((editor) => ({
                block: editor.protyle?.block,
            })),
        );
        this.dockInstance = new VikunjaDock({
            openSettings: () => {
                this.openSetting();
            },
            store: taskListStore,
            onOpenTask: (taskId: number) => {
                void this.openLinkedTask(taskId);
            },
            onCreateTask: () => this.openCreateTaskDialog(),
            onManageResources: () => void this.openManagementDialog(),
            onCurrentDocumentFilterChange: (enabled) =>
                this.handleCurrentDocumentFilter(enabled),
            onAssignedToMeFilterChange: (enabled) =>
                this.handleAssignedToMeFilter(enabled),
            i18n: {
                dockTitle: this.i18n.dockTitle,
                refresh: this.i18n.refresh,
                openSettings: this.i18n.openSettings,
                loading: this.i18n.loading,
                empty: this.i18n.empty,
                unconfigured: this.i18n.unconfigured,
                projectPrefix: this.i18n.projectPrefix,
                focus: this.i18n.focus,
                inbox: this.i18n.inbox,
                planned: this.i18n.planned,
                offline: this.i18n.offline,
                loadError: this.i18n.loadError,
                newTask: this.i18n.newTask,
                manageResources: this.i18n.manageResources,
                loadMore: this.i18n.loadMore,
                refreshing: this.i18n.refreshing,
                connectionOnline: this.i18n.connectionOnline,
                connectionOffline: this.i18n.connectionOffline,
                currentDocument: this.i18n.currentDocument,
                assignedToMe: this.i18n.assignedToMe,
                groupLabel: (key) =>
                    this.i18n[`group${key[0].toUpperCase()}${key.slice(1)}`],
                shownCount: (shown, total) =>
                    this.i18n.shownCount
                        .replace("{shown}", String(shown))
                        .replace("{total}", String(total)),
                serverFiltered: this.i18n.serverFiltered,
                timeZoneLabel: (timeZone) =>
                    this.i18n.timeZoneLabel.replace("{value}", timeZone),
                snapshotAt: (value) =>
                    this.i18n.snapshotAt.replace("{value}", value),
                complete: this.i18n.complete,
                reopen: this.i18n.reopen,
                openTask: this.i18n.openTask,
                formatDate: (value) =>
                    new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                    }).format(new Date(value)),
                labelsSummary: (labels) =>
                    this.i18n.labelsSummary.replace(
                        "{value}",
                        labels.join(", "),
                    ),
                assigneesSummary: (assignees) =>
                    this.i18n.assigneesSummary.replace(
                        "{value}",
                        assignees.join(", "),
                    ),
                attachmentCount: (count) =>
                    this.i18n.attachmentCount.replace("{count}", String(count)),
                blockCount: (count) =>
                    this.i18n.blockCount.replace("{count}", String(count)),
                priorityLabel: (priority) =>
                    this.i18n.priorityLabel.replace(
                        "{value}",
                        String(priority),
                    ),
            },
        });

        this.addDock({
            type: DOCK_TYPE,
            config: {
                position: "RightTop",
                size: { width: 360, height: 0 },
                icon: "iconVikunja",
                title: this.i18n.dockTitle,
                hotkey: "⌥⌘V",
            },
            data: {},
            init: (custom?: { element?: HTMLElement }) => {
                const element =
                    custom?.element ||
                    (document.querySelector(
                        `.dock__panel.sy__${this.name}${DOCK_TYPE}`,
                    ) as HTMLElement);
                if (element) {
                    this.dockInstance.mount(element);
                }
            },
            update: () => {
                this.dockInstance.refresh().catch(() => {});
            },
            destroy: () => {
                this.dockInstance.destroy();
            },
        });

        this.contextController = new DefaultSiYuanContextController({
            request: <T>(path: string, body: Record<string, unknown>) =>
                this.requestSiYuan<T>(path, body),
            openBlock: async (blockId: string) => {
                await openTab({ app: this.app as never, doc: { id: blockId } });
            },
        });
        this.blockLinks = new BlockLinkRepository(this.contextController);
        const linkIndex = new TaskLinkIndex({
            load: (name: string) => this.loadData(name),
            save: (name: string, value: unknown) => this.saveData(name, value),
        });
        this.linkIndex = linkIndex;
        const menuActions = createBlockMenuActions({
            context: this.contextController,
            links: this.blockLinks,
            index: linkIndex,
            getProjectId: () => this.config.inboxProjectId ?? null,
            promptTaskId: () => window.prompt(this.i18n.taskIdPrompt),
            notify: (message: string) => showMessage(message),
            i18n: {
                missingInboxProject: this.i18n.missingInboxProject,
                blocksUnreadable: this.i18n.blocksUnreadable,
                blockActionFailed: this.i18n.blockActionFailed,
            },
            openCreateDialog: (request: BlockCreateDialogRequest) =>
                this.openCreateDialog(request),
            openTask: (taskId: number) => this.openLinkedTask(taskId),
            getTask: (taskId: number) =>
                this.controller.call("vikunja.tasks.get", { taskId }),
        });
        this.disposeBlockMenu = registerBlockMenu(
            this.eventBus as never,
            menuActions,
            {
                create: this.i18n.blockCreate,
                link: this.i18n.blockLink,
                view: this.i18n.blockView,
                unlink: this.i18n.blockUnlink,
                selectionCount: (count) =>
                    this.i18n.blockSelectionCount.replace(
                        "{count}",
                        String(count),
                    ),
            },
        );

        this.onSwitchProtyle = () => {
            if (this.taskListStore?.getFilterState().currentDocument) {
                void this.syncCurrentDocumentFilter();
            }
        };
        this.eventBus.on("switch-protyle", this.onSwitchProtyle as never);

        this.settingsDescriptor = createSettings({
            initialConfig: this.config,
            onSave: (newConfig: PluginConfig) => {
                this.config = normalizePluginConfig(newConfig);
                this.taskListStore?.updateConfig(
                    this.config.vikunjaOrigin ?? "",
                    this.config.inboxProjectId ?? null,
                );
                this.saveData(STORAGE_NAME, this.config).catch(
                    (err: unknown) => {
                        showMessage(
                            `[${this.name}] save config failed: ${String(err)}`,
                        );
                    },
                );
                this.dockInstance.invalidate();
                this.dockInstance.refresh().catch(() => {});
            },
            onTestConnection: async (draft: PluginConfig) => {
                const tempController = new VikunjaController({
                    getConfig: () => draft,
                    getSecret: (name: string) =>
                        name === draft.vikunjaTokenSecretName &&
                        draft.inlineToken
                            ? draft.inlineToken
                            : this.getSecret(name),
                    call: <K extends VikunjaRpcMethod>(
                        method: K,
                        envelope: AuthenticatedRpcEnvelope<K>,
                    ) => callKernelRpc(this, method, envelope),
                });
                const result = await tempController.testConnection();
                this.capabilities = result.ok ? result.data : undefined;
                this.settingsDescriptor?.updateCapability(this.capabilities);
                return result;
            },
            onRepairIndex: async () => {
                if (!this.linkIndex || !this.contextController) return;
                try {
                    await this.linkIndex.rebuildWorkspace(
                        this.contextController,
                    );
                    showMessage(this.i18n.repairIndexSuccess);
                } catch {
                    showMessage(this.i18n.repairIndexFailed);
                }
            },
            i18n: {
                baseUrlTitle: this.i18n.baseUrlTitle,
                baseUrlDesc: this.i18n.baseUrlDesc,
                tokenTitle: this.i18n.tokenTitle,
                tokenDesc: this.i18n.tokenDesc,
                tokenPlaceholder: this.i18n.tokenPlaceholder,
                testConnectionTitle: this.i18n.testConnectionTitle,
                testConnectionDesc: this.i18n.testConnectionDesc,
                testBtn: this.i18n.testBtn,
                testSuccess: this.i18n.testSuccess,
                testFailed: this.i18n.testFailed,
                inboxProjectTitle: this.i18n.inboxProjectTitle,
                inboxProjectDesc: this.i18n.inboxProjectDesc,
                repairIndexTitle: this.i18n.repairIndexTitle,
                repairIndexDesc: this.i18n.repairIndexDesc,
                offlineSnapshotTitle: this.i18n.offlineSnapshotTitle,
                offlineSnapshotDesc: this.i18n.offlineSnapshotDesc,
                repairIndexBtn: this.i18n.repairIndexBtn,
                repairIndexSuccess: this.i18n.repairIndexSuccess,
                repairIndexFailed: this.i18n.repairIndexFailed,
                baseUrlPlaceholder: this.i18n.baseUrlPlaceholder,
                projectSearchPlaceholder: this.i18n.projectSearchPlaceholder,
                capabilityUnknown: this.i18n.capabilityUnknown,
                testing: this.i18n.testPending,
                inboxProjectIdInvalid: this.i18n.inboxProjectIdInvalid,
                capabilitySummary: this.i18n.capabilitySummary,
                apiVersionV2: this.i18n.apiVersionV2,
                attachmentsEnabled: this.i18n.attachmentsEnabled,
                attachmentsDisabled: this.i18n.attachmentsDisabled,
                attachmentLimitUnavailable:
                    this.i18n.attachmentLimitUnavailable,
                effectiveAttachmentLimit: this.i18n.effectiveAttachmentLimit,
            },
        });

        this.setting = new Setting({
            confirmCallback: () => {
                this.settingsDescriptor?.confirm();
            },
        });

        for (const item of this.settingsDescriptor.items) {
            this.setting.addItem(item);
        }
    }

    private async handleCurrentDocumentFilter(enabled: boolean): Promise<void> {
        if (!this.taskListStore) return;
        if (!enabled) {
            this.taskListStore.setCurrentDocumentTaskIds(new Set());
            return;
        }
        await this.syncCurrentDocumentFilter();
    }

    private async handleAssignedToMeFilter(enabled: boolean): Promise<void> {
        if (!enabled || !this.taskListStore) return;
        const result = await this.controller.call("vikunja.users.current", {});
        if (!result.ok) {
            this.taskListStore.setAssignedToMe(false);
            return;
        }
        this.taskListStore.setAssignedToMe(true, result.data.id);
    }

    private async syncCurrentDocumentFilter(): Promise<void> {
        if (
            !this.taskListStore ||
            !this.currentDocumentSource ||
            !this.linkIndex ||
            !this.contextController
        )
            return;
        const documentId = this.currentDocumentSource.getCurrentDocumentId();
        this.taskListStore.setCurrentDocumentTaskIds(new Set());
        if (!documentId) return;
        try {
            const taskIds = await this.linkIndex.taskIdsForDocumentOrScan(
                documentId,
                async () => {
                    const blocks =
                        await this.contextController!.listDocumentBlocks(
                            documentId,
                        );
                    const entries: TaskLinkIndexEntry[] = [];
                    for (const block of blocks) {
                        const attrs =
                            await this.contextController!.getBlockAttrs(
                                block.blockId,
                            );
                        const taskIds = parseBlockTaskLinks(
                            attrs["custom-vikunja-task-links"],
                        ).taskIds;
                        for (const taskId of taskIds) {
                            entries.push({
                                taskId,
                                blockId: block.blockId,
                                documentId: block.documentId,
                                ...(block.notebookId
                                    ? { notebookId: block.notebookId }
                                    : {}),
                                updatedAt: block.updatedAt ?? Date.now(),
                            });
                        }
                    }
                    return entries;
                },
            );
            this.taskListStore.setCurrentDocumentTaskIds(taskIds);
        } catch {
            this.taskListStore.setCurrentDocumentTaskIds(new Set());
        }
    }

    async onLayoutReady(): Promise<void> {
        try {
            const loaded = await this.loadData(STORAGE_NAME);
            this.config = normalizePluginConfig(loaded);
            this.taskListStore?.updateConfig(
                this.config.vikunjaOrigin ?? "",
                this.config.inboxProjectId ?? null,
            );
            this.settingsDescriptor?.updateConfig(this.config);
        } catch (error) {
            console.error(`[${this.name}] failed to load config`, error);
        }
    }

    getSecret(name: string): string {
        const host = globalThis as typeof globalThis & {
            siyuan?: {
                config?: {
                    secrets?: {
                        items?: Array<{ name: string; value: string }>;
                    };
                };
            };
        };
        const secrets = host.siyuan?.config?.secrets?.items;
        return secrets?.find((item) => item.name === name)?.value ?? "";
    }

    private async requestSiYuan<T>(
        path: string,
        body: Record<string, unknown>,
    ): Promise<T> {
        const response = await fetch(path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!response.ok)
            throw new Error(`SiYuan request failed (${response.status})`);
        const envelope = (await response.json()) as {
            code?: number;
            msg?: string;
            data?: T;
        };
        if (envelope.code !== undefined && envelope.code !== 0)
            throw new Error(envelope.msg || "SiYuan request failed");
        return envelope.data as T;
    }

    /** Asks the host to confirm discarding an unsaved task draft. */
    private confirmDiscardDraft(): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            siyuanConfirm(
                this.i18n.discardDraftTitle,
                this.i18n.discardDraftText,
                () => resolve(true),
                () => resolve(false),
            );
        });
    }

    /**
     * Starts task creation from the Dock. The Dock has no Block context, so the
     * task targets the configured Inbox project and links no Blocks.
     */
    private openCreateTaskDialog(): void {
        const projectId = this.config.inboxProjectId ?? null;
        if (!projectId) {
            showMessage(this.i18n.missingInboxProject);
            return;
        }
        void this.openCreateDialog({
            blockIds: [],
            blockSummaries: [],
            projectId,
            initialTitle: "",
            onCreated: async () => {},
        });
    }

    private async openCreateDialog(
        request: BlockCreateDialogRequest,
    ): Promise<void> {
        const resources = await this.loadTaskDialogResources(request.projectId);
        if (!resources) return;
        await this.ensureCapabilities();
        const attachmentStore = new AttachmentStore({
            controller: this.controller,
            effectiveLimitBytes:
                this.capabilities?.effectiveAttachmentLimitBytes ??
                30 * 1024 * 1024,
            enabled: this.capabilities?.attachments !== false,
            pendingOperations: this.pendingOperations,
        });
        const first = request.blockSummaries[0];
        const store = TaskDialogStore.create({
            projectId: request.projectId,
            linkedBlockId: first?.blockId,
            linkedBlockSummary: first
                ? {
                      blockId: first.blockId,
                      documentId: first.documentId,
                      ...(first.title ? { title: first.title } : {}),
                      selectedCount: request.blockSummaries.length,
                  }
                : undefined,
        });
        if (request.initialTitle) store.setField("title", request.initialTitle);
        let disposeHost = (): void => {};
        const dialogRef: { current?: TaskDialog } = {};
        let createdTaskId: number | undefined;
        const saveCreatedTask = createTaskSaveOnce(
            async () => {
                const result = await this.controller.call(
                    "vikunja.tasks.create",
                    { draft: store.getDraft() },
                );
                if (!result.ok)
                    throw new Error(result.error.message || result.error.code);
                createdTaskId = result.data.id;
                return result.data.id;
            },
            async (taskId) => {
                if (attachmentStore.hasPendingFiles()) {
                    await attachmentStore.upload(taskId);
                } else if (attachmentStore.hasRetryableFailures()) {
                    await attachmentStore.retryFailed(taskId);
                }
                if (attachmentStore.hasFailures())
                    throw new Error(this.i18n.attachmentPartialFailure);
                if (!store.getBlockLink().enabled) return;
                try {
                    await request.onCreated(taskId);
                } catch {
                    throw new Error(this.i18n.blockLinkAfterCreateFailed);
                }
            },
        );
        const attachmentSubscription = attachmentStore.subscribe(() =>
            dialogRef.current?.refreshAttachments(),
        );
        const dialog = new TaskDialog({
            store,
            title: this.i18n.blockCreate,
            i18n: this.taskDialogI18n(),
            projects: resources.projects,
            projectPath: (projectId) =>
                this.resourceStore?.getProjectPath(projectId) || "",
            labels: resources.labels,
            assignees: resources.assignees,
            attachmentStore,
            attachmentsEnabled: this.capabilities?.attachments,
            attachmentLimitBytes:
                this.capabilities?.effectiveAttachmentLimitBytes,
            canUploadAttachments: this.capabilities?.attachments !== false,
            canDeleteAttachments: true,
            confirmAttachmentDelete: () =>
                this.confirmAction(this.i18n.attachmentDelete),
            onAttachmentRetry: (itemId) => {
                if (createdTaskId !== undefined)
                    void attachmentStore.retryFailed(createdTaskId, itemId);
            },
            onAttachmentDelete: (itemId) => {
                if (createdTaskId !== undefined)
                    void this.deleteAttachmentFromStore(
                        attachmentStore,
                        createdTaskId,
                        itemId,
                    );
                else attachmentStore.remove(itemId);
            },
            onProjectChange: (projectId) =>
                this.resourceStore?.searchMembers(projectId, ""),
            onAssigneeSearch: (projectId, query) =>
                this.resourceStore?.searchMembers(projectId, query),
            onSave: async () => {
                await saveCreatedTask();
                attachmentSubscription();
                attachmentStore.destroy();
                dialogRef.current?.destroy();
                disposeHost();
            },
            onClose: () => {
                attachmentSubscription();
                attachmentStore.destroy();
                dialogRef.current?.destroy();
                disposeHost();
            },
            confirmDiscard: () => this.confirmDiscardDraft(),
        });
        dialogRef.current = dialog;
        const modal = createModalHost(() => {
            void dialog.close();
        });
        disposeHost = modal.dispose;
        dialog.mount(modal.host);
    }

    private async openLinkedTask(taskId: number): Promise<void> {
        // Load first, then replace, so a failed load leaves the current detail
        // open instead of blanking it.
        const store = new TaskDetailStore({
            controller: this.controller,
            getOfflineSnapshot: (id) => this.taskListStore?.getTask(id),
        });
        await store.open(taskId);
        const detail = store.getDetail();
        if (!detail) {
            const error = store.getState().error;
            store.destroy();
            showMessage(
                error?.message || error?.code || this.i18n.taskLoadFailed,
            );
            return;
        }
        this.closeLinkedTask();
        this.linkedTaskStore = store;
        await this.ensureCapabilities();
        await this.mountTaskAttachments(store, detail);
        const blockIds = (await this.linkIndex?.blocksForTask(taskId)) ?? [];
        const blocks = this.contextController
            ? (
                  await Promise.all(
                      blockIds.map((blockId) =>
                          this.contextController!.getBlockSummary(blockId),
                      ),
                  )
              ).filter(
                  (block): block is NonNullable<typeof block> => block !== null,
              )
            : [];
        const modal = createModalHost(
            () => this.closeLinkedTask(),
            "vcp-siyuan-linked-task-dialog",
        );
        this.linkedTaskModal = modal;
        this.linkedTaskView = new TaskDetailView({
            task: detail,
            i18n: this.taskDetailViewI18n(),
            onBack: () => this.closeLinkedTask(),
            onComplete: () => {
                const current = store.getDetail();
                if (!current) return;
                void store
                    .toggleDoneForTask(taskId, !current.done)
                    .then(() => this.openLinkedTask(taskId))
                    .catch(() => {});
            },
            onEdit: () => {
                void this.openEditTask(detail);
            },
            onRetry: () => void store.retry(),
            attachments:
                this.linkedTaskAttachments?.getItems() ??
                detail.attachments.map((attachment) => ({
                    id: `remote-${attachment.id}`,
                    fileName: attachment.name,
                    mimeType: attachment.mimeType,
                    size: attachment.size,
                    state: "succeeded" as const,
                    attachment,
                })),
            attachmentsEnabled: this.capabilities?.attachments,
            attachmentLimitBytes:
                this.capabilities?.effectiveAttachmentLimitBytes,
            canUploadAttachments: isWritableTask(detail.maxPermission),
            canDeleteAttachments: isWritableTask(detail.maxPermission),
            onAttachmentSelect: (files) => {
                this.linkedTaskAttachments?.queue(files);
                void this.linkedTaskAttachments?.upload(taskId);
            },
            onAttachmentRetry: (itemId) =>
                void this.linkedTaskAttachments?.retryFailed(taskId, itemId),
            onAttachmentDownload: (itemId) =>
                void this.downloadAttachment(taskId, itemId),
            onAttachmentDelete: (itemId) =>
                void this.deleteAttachment(taskId, itemId),
            onBlockOpen: (blockId) =>
                void this.contextController?.openBlock(blockId),
            blocks,
        });
        this.linkedTaskDetailUnsubscribe = store.subscribe(() => {
            const latest = store.getDetail();
            if (latest) {
                this.linkedTaskView?.update(latest, {
                    error: store.getState().error?.message,
                    saving: store.getState().status === "saving",
                });
            }
        });
        this.linkedTaskView.mount(modal.host);
    }

    private async ensureCapabilities(): Promise<void> {
        if (this.capabilities) return;
        const result = await this.controller.testConnection();
        if (result.ok) this.capabilities = result.data;
    }

    private async mountTaskAttachments(
        _store: TaskDetailStore,
        detail: TaskDetail,
    ): Promise<void> {
        const limit =
            this.capabilities?.effectiveAttachmentLimitBytes ??
            30 * 1024 * 1024;
        this.linkedTaskAttachments = new AttachmentStore({
            controller: this.controller,
            effectiveLimitBytes: limit,
            enabled: this.capabilities?.attachments !== false,
            pendingOperations: this.pendingOperations,
        });
        this.linkedTaskUnsubscribe = this.linkedTaskAttachments.subscribe(
            () => {
                this.linkedTaskView?.setAttachments(
                    this.linkedTaskAttachments?.getItems() ?? [],
                );
            },
        );
        if (
            this.capabilities?.attachments !== false &&
            _store.getState().status !== "offline"
        ) {
            await this.linkedTaskAttachments.load(detail.id);
            await this.linkedTaskAttachments.resumePending(detail.id);
        }
    }

    private async downloadAttachment(
        taskId: number,
        itemId: string,
    ): Promise<void> {
        const download = await this.linkedTaskAttachments?.download(
            taskId,
            itemId,
        );
        if (!download) return;
        const blob = new Blob([new Uint8Array(download.bytes)], {
            type: download.mimeType,
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = download.fileName.replace(/[\\\\/]/g, "_");
        link.click();
        URL.revokeObjectURL(url);
    }

    private async downloadAttachmentFromStore(
        store: AttachmentStore,
        taskId: number,
        itemId: string,
    ): Promise<void> {
        const download = await store.download(taskId, itemId);
        if (!download) return;
        const blob = new Blob([new Uint8Array(download.bytes)], {
            type: download.mimeType,
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = download.fileName.replace(/[\\\\/]/g, "_");
        link.click();
        URL.revokeObjectURL(url);
    }

    private async deleteAttachment(
        taskId: number,
        itemId: string,
    ): Promise<void> {
        const accepted = await this.confirmAction(this.i18n.attachmentDelete);
        if (!accepted) return;
        await this.linkedTaskAttachments?.deleteRemote(taskId, itemId);
    }

    private async deleteAttachmentFromStore(
        store: AttachmentStore,
        taskId: number,
        itemId: string,
    ): Promise<void> {
        const accepted = await this.confirmAction(this.i18n.attachmentDelete);
        if (!accepted) return;
        await store.deleteRemote(taskId, itemId);
    }

    private confirmAction(title: string): Promise<boolean> {
        return new Promise((resolve) =>
            siyuanConfirm(
                title,
                title,
                () => resolve(true),
                () => resolve(false),
            ),
        );
    }

    private async openManagementDialog(): Promise<void> {
        if (!this.resourceStore) return;
        try {
            await this.resourceStore.refresh();
        } catch {
            showMessage(this.i18n.loadError);
            return;
        }
        const project = this.resourceStore.getProjects()[0];
        const impact = project
            ? await this.controller.call("vikunja.projects.deleteImpact", {
                  projectId: project.id,
                  inboxProjectId: this.config.inboxProjectId,
              })
            : undefined;
        if (impact && !impact.ok) {
            showMessage(impact.error.message || this.i18n.loadError);
            return;
        }
        this.managementStore = new ManagementStore({
            deleteResource: (kind, id, expectedTitle) =>
                kind === "project"
                    ? this.controller.call("vikunja.projects.delete", {
                          projectId: id,
                          expectedTitle: expectedTitle ?? "",
                      })
                    : this.controller.call("vikunja.labels.delete", {
                          labelId: id,
                          expectedTitle: expectedTitle ?? "",
                      }),
        });
        if (impact?.ok) this.managementStore.setImpact(impact.data);
        const dialog = new ProjectManagerDialog({
            projects: this.resourceStore.getProjects(),
            impact: impact?.ok ? impact.data : undefined,
            i18n: {
                title: this.i18n.projectManagerTitle,
                impact: (open, completed, descendants) =>
                    this.i18n.projectImpact
                        .replace("{open}", String(open))
                        .replace("{completed}", String(completed))
                        .replace("{descendants}", String(descendants)),
                confirmLabel: this.i18n.confirmProjectTitle,
                delete: this.i18n.delete,
                cancel: this.i18n.cancel,
                save: this.i18n.save,
                search: this.i18n.projectSearchPlaceholder,
                create: this.i18n.projectCreate,
                edit: this.i18n.projectEdit,
                titleLabel: this.i18n.projectTitleLabel,
                descriptionLabel: this.i18n.projectDescriptionLabel,
                colorLabel: this.i18n.projectColorLabel,
                parentLabel: this.i18n.projectParentLabel,
                archivedLabel: this.i18n.projectArchivedLabel,
                projectPath: (path) => path,
                manageLabels: this.i18n.manageLabels,
            },
            onCreate: async (draft) => {
                await this.resourceStore?.createProject(draft);
                await this.resourceStore?.refresh();
                dialog.destroy();
                this.managementModal?.dispose();
                this.dockInstance.invalidate();
            },
            onEdit: async (projectId, draft) => {
                await this.resourceStore?.patchProject(projectId, {
                    title: draft.title,
                    descriptionMarkdown: draft.descriptionMarkdown,
                    color: draft.color,
                    parentProjectId: draft.parentProjectId,
                });
                dialog.destroy();
                this.managementModal?.dispose();
                this.dockInstance.invalidate();
            },
            onPreviewDelete: async (projectId) => {
                const preview = await this.controller.call(
                    "vikunja.projects.deleteImpact",
                    {
                        projectId,
                        inboxProjectId: this.config.inboxProjectId,
                    },
                );
                if (!preview.ok) {
                    showMessage(preview.error.message || this.i18n.loadError);
                    return;
                }
                this.managementStore?.setImpact(preview.data);
                dialog.setImpact(preview.data);
            },
            onDelete: async (title) => {
                const target = this.managementStore?.getState().impact?.project;
                if (!target) return;
                const store = this.managementStore;
                if (!store) return;
                const result = await store.deleteProject(target.id, title);
                if (result.ok) {
                    dialog.destroy();
                    this.managementModal?.dispose();
                    await this.resourceStore?.refresh();
                    this.dockInstance.invalidate();
                }
            },
            onOpenLabels: () => {
                dialog.destroy();
                this.managementModal?.dispose();
                void this.openLabelManagementDialog();
            },
        });
        const modal = createModalHost(() => {
            dialog.destroy();
            modal.dispose();
        }, "vcp-siyuan-management-dialog");
        this.managementModal = modal;
        this.managementDialog = dialog;
        dialog.mount(modal.host);
    }

    private async openLabelManagementDialog(): Promise<void> {
        if (!this.resourceStore) return;
        try {
            await this.resourceStore.refresh();
        } catch {
            showMessage(this.i18n.loadError);
            return;
        }
        const label = this.resourceStore.getLabels()[0];
        const impact = label
            ? await this.controller.call("vikunja.labels.deleteImpact", {
                  labelId: label.id,
              })
            : undefined;
        if (impact && !impact.ok) {
            showMessage(impact.error.message || this.i18n.loadError);
            return;
        }
        this.managementStore = new ManagementStore({
            deleteResource: (kind, id, expectedTitle) =>
                kind === "label"
                    ? this.controller.call("vikunja.labels.delete", {
                          labelId: id,
                          expectedTitle: expectedTitle ?? "",
                      })
                    : this.controller.call("vikunja.projects.delete", {
                          projectId: id,
                          expectedTitle: expectedTitle ?? "",
                      }),
        });
        if (impact?.ok) this.managementStore.setLabelImpact(impact.data);
        const dialog = new LabelManagerDialog({
            labels: this.resourceStore.getLabels(),
            impact: impact?.ok ? impact.data : undefined,
            i18n: {
                title: this.i18n.labelManagerTitle,
                usage: (count) =>
                    this.i18n.labelUsage.replace("{count}", String(count)),
                confirmPlaceholder: this.i18n.confirmTitle,
                delete: this.i18n.delete,
                cancel: this.i18n.cancel,
                save: this.i18n.save,
                search: this.i18n.projectSearchPlaceholder,
                create: this.i18n.labelCreate,
                edit: this.i18n.labelEdit,
                titleLabel: this.i18n.labelTitleLabel,
                descriptionLabel: this.i18n.labelDescriptionLabel,
                colorLabel: this.i18n.labelColorLabel,
            },
            onCreate: async (draft) => {
                await this.resourceStore?.createLabel(draft);
                dialog.destroy();
                this.managementModal?.dispose();
                this.dockInstance.invalidate();
            },
            onEdit: async (labelId, draft) => {
                await this.resourceStore?.patchLabel(labelId, {
                    title: draft.title,
                    descriptionMarkdown: draft.descriptionMarkdown,
                    color: draft.color,
                });
                dialog.destroy();
                this.managementModal?.dispose();
                this.dockInstance.invalidate();
            },
            onPreviewDelete: async (labelId) => {
                const preview = await this.controller.call(
                    "vikunja.labels.deleteImpact",
                    { labelId },
                );
                if (!preview.ok) {
                    showMessage(preview.error.message || this.i18n.loadError);
                    return;
                }
                this.managementStore?.setLabelImpact(preview.data);
                dialog.setImpact(preview.data);
            },
            onDelete: async (title) => {
                const target =
                    this.managementStore?.getState().labelImpact?.label;
                if (!target) return;
                const store = this.managementStore;
                if (!store) return;
                const result = await store.deleteLabel(target.id, title);
                if (result.ok) {
                    dialog.destroy();
                    this.managementModal?.dispose();
                    await this.resourceStore?.refresh();
                    this.dockInstance.invalidate();
                }
            },
        });
        const modal = createModalHost(() => {
            dialog.destroy();
            modal.dispose();
        }, "vcp-siyuan-management-dialog");
        this.managementModal = modal;
        this.managementDialog = dialog;
        dialog.mount(modal.host);
    }

    private async openEditTask(detail: TaskDetail): Promise<void> {
        const projectId = detail.project?.id ?? detail.projectId ?? 0;
        const resources = await this.loadTaskDialogResources(projectId);
        if (!resources) return;
        await this.ensureCapabilities();
        const store = TaskDialogStore.edit(detail);
        const attachmentStore = new AttachmentStore({
            controller: this.controller,
            effectiveLimitBytes:
                this.capabilities?.effectiveAttachmentLimitBytes ??
                30 * 1024 * 1024,
            enabled: this.capabilities?.attachments !== false,
            pendingOperations: this.pendingOperations,
        });
        if (this.capabilities?.attachments !== false) {
            await attachmentStore.load(detail.id);
            await attachmentStore.resumePending(detail.id);
        }
        let disposeHost = (): void => {};
        const dialogRef: { current?: TaskDialog } = {};
        const attachmentSubscription = attachmentStore.subscribe(() =>
            dialogRef.current?.refreshAttachments(),
        );
        const dialog = new TaskDialog({
            store,
            title: this.i18n.blockEdit,
            i18n: this.taskDialogI18n(),
            projects: resources.projects,
            projectPath: (nextProjectId) =>
                this.resourceStore?.getProjectPath(nextProjectId) || "",
            labels: resources.labels,
            assignees: resources.assignees,
            attachmentStore,
            attachmentsEnabled: this.capabilities?.attachments,
            attachmentLimitBytes:
                this.capabilities?.effectiveAttachmentLimitBytes,
            canUploadAttachments: isWritableTask(detail.maxPermission),
            canDeleteAttachments: isWritableTask(detail.maxPermission),
            onAttachmentRetry: (itemId) =>
                void attachmentStore.retryFailed(detail.id, itemId),
            onAttachmentDownload: (itemId) =>
                void this.downloadAttachmentFromStore(
                    attachmentStore,
                    detail.id,
                    itemId,
                ),
            onAttachmentDelete: (itemId) =>
                void attachmentStore.deleteRemote(detail.id, itemId),
            confirmAttachmentDelete: () =>
                this.confirmAction(this.i18n.attachmentDelete),
            onProjectChange: (nextProjectId) =>
                this.resourceStore?.searchMembers(nextProjectId, ""),
            onAssigneeSearch: (nextProjectId, query) =>
                this.resourceStore?.searchMembers(nextProjectId, query),
            onSave: async () => {
                const relations = store.getRelationChanges();
                const patch = store.getPatch();
                const result = await this.controller.call(
                    "vikunja.tasks.patch",
                    {
                        taskId: detail.id,
                        patch,
                        expected: store.getExpectedVersion(),
                        ...(relations.labels
                            ? { labels: relations.labels }
                            : {}),
                        ...(relations.assignees
                            ? { assignees: relations.assignees }
                            : {}),
                    },
                );
                if (!result.ok) {
                    if (result.error.code === "CONFLICT") {
                        const latest = await this.controller.call(
                            "vikunja.tasks.get",
                            { taskId: detail.id },
                        );
                        if (latest.ok) {
                            const remote = latest.data.value;
                            store.markConflict(remote);
                            dialog.showConflict(
                                remote,
                                () => store.reloadFrom(remote),
                                () =>
                                    store.rebaseOnto(remote, [
                                        "title",
                                        "projectId",
                                        "startAt",
                                        "dueAt",
                                        "priority",
                                        "descriptionMarkdown",
                                        "labels",
                                        "assignees",
                                        "reminders",
                                        "repeat",
                                    ]),
                            );
                            return;
                        }
                    }
                    throw new Error(result.error.message || result.error.code);
                }
                store.acceptSaved(result.data);
                if (attachmentStore.hasPendingFiles())
                    await attachmentStore.upload(detail.id);
                else if (attachmentStore.hasRetryableFailures())
                    await attachmentStore.retryFailed(detail.id);
                if (attachmentStore.hasFailures())
                    throw new Error(this.i18n.attachmentPartialFailure);
                attachmentSubscription();
                attachmentStore.destroy();
                dialog.destroy();
                disposeHost();
                await this.openLinkedTask(detail.id);
            },
            onClose: () => {
                attachmentSubscription();
                attachmentStore.destroy();
                dialog.destroy();
                disposeHost();
            },
            confirmDiscard: () => this.confirmDiscardDraft(),
        });
        const modal = createModalHost(() => {
            void dialog.close();
        });
        disposeHost = modal.dispose;
        dialogRef.current = dialog;
        dialog.mount(modal.host);
    }

    private taskDetailViewI18n(): import("./dock/TaskDetailView.js").TaskDetailViewI18n {
        return {
            back: this.i18n.back,
            reopen: this.i18n.reopen,
            complete: this.i18n.complete,
            edit: this.i18n.edit,
            projectPrefix: this.i18n.projectPrefix,
            projectUnknown: this.i18n.projectUnknown,
            status: this.i18n.status,
            priority: this.i18n.priorityLabel.replace(" {value}", ""),
            startDate: this.i18n.startDate,
            dueDate: this.i18n.dueDate,
            labels: this.i18n.labels,
            assignees: this.i18n.assignees,
            reminders: this.i18n.reminders,
            repeat: this.i18n.repeat,
            description: this.i18n.description,
            attachments: this.i18n.attachments,
            blocks: this.i18n.blocks,
            noAttachments: this.i18n.noAttachments,
            uploadAttachment: this.i18n.uploadAttachment,
            attachmentsDisabled: this.i18n.attachmentDisabled,
            attachmentLimit: (value) =>
                this.i18n.attachmentLimitLabel.replace("{value}", value),
            retry: this.i18n.retry,
            loadError: this.i18n.loadError,
            retryLoad: this.i18n.retryLoad,
            blockOpen: this.i18n.blockOpen,
            blockUnknown: this.i18n.blockUnknown,
            blockCount: (count) =>
                this.i18n.blockCount.replace("{count}", String(count)),
            permissionReadOnly: this.i18n.permissionReadOnly,
            repeatNone: this.i18n.repeatNone,
            repeatEvery: (every, unit) =>
                this.i18n.repeatEverySummary
                    .replace("{every}", String(every))
                    .replace("{unit}", unit),
            preservedRepeat: (summary) =>
                this.i18n.preservedRepeatSummary.replace("{value}", summary),
            attachmentList: {
                retry: this.i18n.retry,
                download: this.i18n.attachmentDownload,
                delete: this.i18n.delete,
                statusLabel: (state) =>
                    this.i18n[
                        state === "queued"
                            ? "attachmentStateQueued"
                            : state === "uploading"
                              ? "attachmentStateUploading"
                              : state === "succeeded"
                                ? "attachmentStateSucceeded"
                                : "attachmentStateFailed"
                    ],
            },
            formatDate: (value) =>
                new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                }).format(new Date(value)),
        };
    }

    private taskDialogI18n(): TaskDialogI18n {
        return {
            titleLabel: this.i18n.taskTitleLabel,
            descriptionLabel: this.i18n.taskDescriptionLabel,
            projectLabel: this.i18n.taskProjectLabel,
            startDateLabel: this.i18n.taskStartDateLabel,
            dueDateLabel: this.i18n.taskDueDateLabel,
            priorityLabel: this.i18n.taskPriorityLabel,
            labelsLabel: this.i18n.taskLabelsLabel,
            assigneesLabel: this.i18n.taskAssigneesLabel,
            assigneeUnavailable: this.i18n.assigneeUnavailable,
            assigneeSearchPlaceholder: this.i18n.assigneeSearchPlaceholder,
            reminderLabel: this.i18n.taskReminderLabel,
            addReminder: this.i18n.addReminder,
            removeReminder: this.i18n.removeReminder,
            repeatLabel: this.i18n.taskRepeatLabel,
            repeatNone: this.i18n.repeatNone,
            repeatEvery: this.i18n.repeatEvery,
            repeatDay: this.i18n.repeatDay,
            repeatWeek: this.i18n.repeatWeek,
            repeatMonth: this.i18n.repeatMonth,
            preservedRepeat: this.i18n.preservedRepeat,
            blockLinkLabel: this.i18n.blockLinkLabel,
            projectRequired: this.i18n.projectRequired,
            projectNotWritable: this.i18n.projectNotWritable,
            conflict: this.i18n.conflict,
            reload: this.i18n.reload,
            review: this.i18n.review,
            cancel: this.i18n.cancel,
            save: this.i18n.save,
            titleRequired: this.i18n.titleRequired,
            saveFailed: this.i18n.saveFailed,
            attachments: this.i18n.attachments,
            uploadAttachment: this.i18n.uploadAttachment,
            attachmentLimit: (value) =>
                this.i18n.attachmentLimitLabel.replace("{value}", value),
            attachmentsDisabled: this.i18n.attachmentDisabled,
            noAttachments: this.i18n.noAttachments,
            attachmentList: {
                retry: this.i18n.retry,
                download: this.i18n.attachmentDownload,
                delete: this.i18n.delete,
                statusLabel: (state) =>
                    this.i18n[
                        state === "queued"
                            ? "attachmentStateQueued"
                            : state === "uploading"
                              ? "attachmentStateUploading"
                              : state === "succeeded"
                                ? "attachmentStateSucceeded"
                                : "attachmentStateFailed"
                    ],
            },
        };
    }

    private async loadTaskDialogResources(projectId: number): Promise<
        | {
              projects: ReturnType<ResourceStore["getProjects"]>;
              labels: ReturnType<ResourceStore["getLabels"]>;
              assignees: Awaited<ReturnType<ResourceStore["searchMembers"]>>;
          }
        | undefined
    > {
        if (
            !this.resourceStore ||
            !Number.isSafeInteger(projectId) ||
            projectId <= 0
        ) {
            showMessage(this.i18n.projectRequired);
            return undefined;
        }
        try {
            await this.resourceStore.refresh();
            const assignees = await this.resourceStore.searchMembers(
                projectId,
                "",
            );
            return {
                projects: this.resourceStore.getProjects(),
                labels: this.resourceStore.getLabels(),
                assignees,
            };
        } catch {
            showMessage(this.i18n.loadError);
            return undefined;
        }
    }

    private closeLinkedTask(): void {
        this.linkedTaskUnsubscribe?.();
        this.linkedTaskUnsubscribe = undefined;
        this.linkedTaskDetailUnsubscribe?.();
        this.linkedTaskDetailUnsubscribe = undefined;
        this.linkedTaskAttachments?.destroy();
        this.linkedTaskAttachments = undefined;
        this.linkedTaskView?.destroy();
        this.linkedTaskView = undefined;
        this.linkedTaskStore?.destroy();
        this.linkedTaskStore = undefined;
        this.linkedTaskModal?.dispose();
        this.linkedTaskModal = undefined;
    }

    async onunload(): Promise<void> {
        if (this.destroyed) return;
        this.destroyed = true;
        this.disposeBlockMenu?.();
        if (this.onSwitchProtyle) {
            this.eventBus.off("switch-protyle", this.onSwitchProtyle as never);
            this.onSwitchProtyle = undefined;
        }
        this.disposeBlockMenu = undefined;
        this.dockInstance?.destroy();
        this.closeLinkedTask();
        this.taskListStore?.destroy();
        this.taskListStore = undefined;
        this.managementDialog?.destroy();
        this.managementDialog = undefined;
        this.managementModal?.dispose();
        this.managementModal = undefined;
        this.resourceStore = undefined;
        this.pendingOperations = undefined;
        this.currentDocumentSource = undefined;
        this.blockLinks = undefined;
        this.linkIndex = undefined;
        this.contextController = undefined;
    }

    async uninstall(): Promise<void> {
        for (const storageName of PRIVATE_DATA_FILES) {
            await this.removeData(storageName).catch((err: unknown) => {
                console.error(
                    `[${this.name}] failed to remove ${storageName}`,
                    err,
                );
            });
        }
    }
}

function isWritableTask(permission: TaskDetail["maxPermission"]): boolean {
    return (
        permission === "write" ||
        permission === "admin" ||
        permission === "owner"
    );
}
