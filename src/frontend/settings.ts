import { PluginConfig } from "../shared/config.js";
import { ConnectionInfo, RpcResult } from "../shared/contracts.js";

export interface SettingsI18n {
    baseUrlTitle: string;
    baseUrlDesc: string;
    tokenTitle: string;
    tokenDesc: string;
    tokenPlaceholder: string;
    testConnectionTitle: string;
    testConnectionDesc: string;
    testBtn: string;
    testSuccess: string;
    testFailed: string;
    inboxProjectTitle: string;
    inboxProjectDesc: string;
    repairIndexTitle: string;
    repairIndexDesc: string;
    repairIndexBtn: string;
    repairIndexSuccess: string;
    repairIndexFailed: string;
    offlineSnapshotTitle: string;
    offlineSnapshotDesc: string;
    baseUrlPlaceholder: string;
    projectSearchPlaceholder: string;
    capabilityUnknown: string;
    testing: string;
    inboxProjectIdInvalid: string;
    capabilitySummary: string;
    apiVersionV2: string;
    attachmentsEnabled: string;
    attachmentsDisabled: string;
    attachmentLimitUnavailable: string;
    effectiveAttachmentLimit: string;
}

export interface InboxProjectOption {
    id: number;
    title: string;
    archived?: boolean;
}

export interface SettingsOptions {
    initialConfig: PluginConfig;
    onSave: (config: PluginConfig) => void;
    onTestConnection: (
        draft: PluginConfig,
    ) => Promise<RpcResult<ConnectionInfo>>;
    onRepairIndex?: () => void | Promise<void>;
    inboxProjects?: InboxProjectOption[];
    i18n: SettingsI18n;
}

export interface SettingsDescriptor {
    items: Array<{
        title: string;
        description: string;
        element?: HTMLElement;
        createActionElement?: () => HTMLElement;
    }>;
    confirm: () => void;
    updateConfig: (config: PluginConfig) => void;
    updateCapability: (capability: ConnectionInfo | undefined) => void;
}

export function createSettings(options: SettingsOptions): SettingsDescriptor {
    let currentConfig = { ...options.initialConfig };
    let capability: ConnectionInfo | undefined;

    const baseUrlInput = document.createElement("input");
    baseUrlInput.type = "url";
    baseUrlInput.className = "b3-text-field fn__block";
    baseUrlInput.placeholder = options.i18n.baseUrlPlaceholder;
    baseUrlInput.value = currentConfig.vikunjaOrigin ?? "";

    const tokenInput = document.createElement("input");
    tokenInput.type = "password";
    tokenInput.className = "b3-text-field fn__block";
    tokenInput.placeholder = options.i18n.tokenPlaceholder;
    const tokenToggle = document.createElement("button");
    tokenToggle.type = "button";
    tokenToggle.className = "b3-button b3-button--outline";
    tokenToggle.textContent = "◉";
    tokenToggle.title = options.i18n.tokenTitle;
    tokenToggle.addEventListener("click", () => {
        tokenInput.type = tokenInput.type === "password" ? "text" : "password";
    });
    const tokenContainer = document.createElement("div");
    tokenContainer.className = "vcp-siyuan-token-editor";
    tokenContainer.append(tokenInput, tokenToggle);

    const inboxProjectInput = document.createElement("input");
    inboxProjectInput.type = "number";
    inboxProjectInput.min = "1";
    inboxProjectInput.step = "1";
    inboxProjectInput.className = "b3-text-field fn__block";
    inboxProjectInput.value = currentConfig.inboxProjectId?.toString() ?? "";
    const projectSearch = document.createElement("input");
    projectSearch.type = "search";
    projectSearch.className = "b3-text-field fn__block";
    projectSearch.placeholder = options.i18n.projectSearchPlaceholder;
    const projectList = document.createElement("datalist");
    projectList.id = `vcp-siyuan-inbox-projects-${Math.random().toString(36).slice(2)}`;
    projectSearch.setAttribute("list", projectList.id);
    for (const project of options.inboxProjects ?? []) {
        if (project.archived) continue;
        const option = document.createElement("option");
        option.value = project.title;
        option.label = String(project.id);
        projectList.append(option);
    }
    projectSearch.addEventListener("change", () => {
        const selected = (options.inboxProjects ?? []).find(
            (project) => project.title === projectSearch.value,
        );
        if (selected) inboxProjectInput.value = String(selected.id);
    });
    const inboxContainer = document.createElement("div");
    inboxContainer.append(projectSearch, inboxProjectInput, projectList);

    const testContainer = document.createElement("div");
    testContainer.className = "vcp-siyuan-settings-test";
    const testActions = document.createElement("div");
    testActions.className = "vcp-siyuan-settings-test-row";
    const testBtn = document.createElement("button");
    testBtn.type = "button";
    testBtn.className = "b3-button b3-button--outline";
    testBtn.textContent = options.i18n.testBtn;
    const testStatus = document.createElement("div");
    testStatus.className = "vcp-siyuan-settings-test-status";
    const capabilityStatus = document.createElement("div");
    capabilityStatus.className = "vcp-siyuan-settings-capability";

    const repairBtn = document.createElement("button");
    repairBtn.type = "button";
    repairBtn.className = "b3-button b3-button--outline";
    repairBtn.textContent = options.i18n.repairIndexBtn;
    repairBtn.disabled = !options.onRepairIndex;
    repairBtn.addEventListener("click", () => {
        void options.onRepairIndex?.();
    });

    const renderCapability = (): void => {
        capabilityStatus.textContent = capability
            ? formatCapability(capability, options.i18n)
            : options.i18n.capabilityUnknown;
    };
    renderCapability();

    testBtn.addEventListener("click", async () => {
        testBtn.disabled = true;
        testStatus.textContent = options.i18n.testing;
        testStatus.style.color = "var(--b3-theme-on-surface-light)";
        try {
            const draftConfig = readConfig();
            const result = await options.onTestConnection(draftConfig);
            if (result.ok) {
                capability = result.data;
                renderCapability();
                testStatus.textContent = `✓ ${options.i18n.testSuccess}${result.data.serverVersion ? ` (${result.data.serverVersion})` : ""}`;
                testStatus.style.color = "var(--b3-theme-primary)";
            } else {
                testStatus.textContent = `✗ ${result.error.message || options.i18n.testFailed}`;
                testStatus.style.color = "var(--b3-theme-error)";
            }
        } catch (error) {
            testStatus.textContent = `✗ ${error instanceof Error ? error.message : options.i18n.testFailed}`;
            testStatus.style.color = "var(--b3-theme-error)";
        } finally {
            testBtn.disabled = false;
        }
    });

    testActions.append(testBtn, testStatus);
    testContainer.append(testActions, capabilityStatus);

    const items: SettingsDescriptor["items"] = [
        {
            title: options.i18n.baseUrlTitle,
            description: options.i18n.baseUrlDesc,
            createActionElement: () => baseUrlInput,
        },
        {
            title: options.i18n.tokenTitle,
            description: options.i18n.tokenDesc,
            createActionElement: () => tokenContainer,
        },
        {
            title: options.i18n.inboxProjectTitle,
            description: options.i18n.inboxProjectDesc,
            createActionElement: () => inboxContainer,
        },
        {
            title: options.i18n.testConnectionTitle,
            description: options.i18n.testConnectionDesc,
            createActionElement: () => testContainer,
        },
        {
            title: options.i18n.offlineSnapshotTitle,
            description: options.i18n.offlineSnapshotDesc,
        },
        {
            title: options.i18n.repairIndexTitle,
            description: options.i18n.repairIndexDesc,
            createActionElement: () => repairBtn,
        },
    ];

    return {
        items,
        confirm: () => {
            currentConfig = readConfig();
            options.onSave(currentConfig);
        },
        updateConfig: (config: PluginConfig) => {
            currentConfig = { ...config };
            baseUrlInput.value = config.vikunjaOrigin ?? "";
            tokenInput.value = config.inlineToken ?? "";
            inboxProjectInput.value = config.inboxProjectId?.toString() ?? "";
        },
        updateCapability: (next) => {
            capability = next;
            renderCapability();
        },
    };

    function readConfig(): PluginConfig {
        const rawInbox = inboxProjectInput.value.trim();
        const inboxProjectId = rawInbox === "" ? null : Number(rawInbox);
        if (
            inboxProjectId !== null &&
            (!Number.isSafeInteger(inboxProjectId) || inboxProjectId <= 0)
        ) {
            throw new Error(options.i18n.inboxProjectIdInvalid);
        }
        return {
            schemaVersion: 2,
            vikunjaOrigin: baseUrlInput.value.trim(),
            vikunjaTokenSecretName: currentConfig.vikunjaTokenSecretName,
            inlineToken: tokenInput.value.trim(),
            inboxProjectId,
            snapshotEnabled: true,
        };
    }
}

function formatCapability(
    capability: ConnectionInfo,
    i18n: SettingsI18n,
): string {
    const version = capability.serverVersion ?? capability.version ?? "unknown";
    const attachments =
        capability.attachments === false
            ? i18n.attachmentsDisabled
            : i18n.attachmentsEnabled;
    const limit =
        capability.effectiveAttachmentLimitBytes === undefined
            ? i18n.attachmentLimitUnavailable
            : interpolate(i18n.effectiveAttachmentLimit, {
                  value: formatBytes(capability.effectiveAttachmentLimitBytes),
              });
    return interpolate(i18n.capabilitySummary, {
        version,
        apiVersion: i18n.apiVersionV2,
        attachments,
        limit,
    });
}

function interpolate(template: string, values: Record<string, string>): string {
    return template.replace(
        /\{(\w+)\}/g,
        (_, key: string) => values[key] ?? "",
    );
}

function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${Math.floor(bytes / (1024 * 1024))} MiB`;
    if (bytes >= 1024) return `${Math.floor(bytes / 1024)} KiB`;
    return `${bytes} B`;
}
