export interface BlockMenuEventBus {
    on: (event: string, handler: (event: unknown) => void) => void;
    off: (event: string, handler: (event: unknown) => void) => void;
}

export interface BlockMenuItem {
    id: string;
    label: string;
    click: () => void | Promise<void>;
}

export interface BlockMenuLabels {
    create: string;
    link: string;
    view: string;
    unlink: string;
    selectionCount: (count: number) => string;
}

export interface BlockMenuHost {
    addItem: (item: BlockMenuItem) => void;
}

export interface BlockMenuActions {
    onCreate: (blockIds: string[]) => void | Promise<void>;
    onLink: (blockIds: string[]) => void | Promise<void>;
    onView: (blockIds: string[]) => void | Promise<void>;
    onUnlink: (blockIds: string[]) => void | Promise<void>;
}

export interface BlockMenuSelectionEvent {
    detail?: {
        blockIds?: unknown;
        id?: unknown;
        blockElements?: unknown;
        menu?: BlockMenuHost;
    };
}

export function registerBlockMenu(
    eventBus: BlockMenuEventBus,
    actions: BlockMenuActions,
    labels: BlockMenuLabels,
): () => void {
    const handler = (event: unknown): void => {
        const detail = (event as BlockMenuSelectionEvent).detail;
        const selection = normalizeSelection(detail);
        if (selection.length === 0 || !detail?.menu) return;
        const count = selection.length;
        const suffix = count > 1 ? labels.selectionCount(count) : "";
        detail.menu.addItem({
            id: "vcp-siyuan-vikunja-create-task",
            label: `${labels.create}${suffix}`,
            click: () => actions.onCreate(selection),
        });
        detail.menu.addItem({
            id: "vcp-siyuan-vikunja-link-task",
            label: `${labels.link}${suffix}`,
            click: () => actions.onLink(selection),
        });
        detail.menu.addItem({
            id: "vcp-siyuan-vikunja-view-links",
            label: `${labels.view}${suffix}`,
            click: () => actions.onView(selection),
        });
        detail.menu.addItem({
            id: "vcp-siyuan-vikunja-unlink-task",
            label: `${labels.unlink}${suffix}`,
            click: () => actions.onUnlink(selection),
        });
    };

    eventBus.on("click-blockicon", handler);
    let disposed = false;
    return () => {
        if (disposed) return;
        disposed = true;
        eventBus.off("click-blockicon", handler);
    };
}

function normalizeSelection(
    detail: BlockMenuSelectionEvent["detail"],
): string[] {
    const blockIds = detail?.blockIds;
    if (Array.isArray(blockIds)) {
        return [
            ...new Set(
                blockIds.filter(
                    (id): id is string =>
                        typeof id === "string" && id.length > 0,
                ),
            ),
        ];
    }
    const elements = detail?.blockElements;
    if (Array.isArray(elements)) {
        return [
            ...new Set(
                elements.flatMap((element) => {
                    if (typeof element !== "object" || element === null)
                        return [];
                    const dataset = (
                        element as {
                            dataset?: { nodeId?: unknown; id?: unknown };
                        }
                    ).dataset;
                    const id = dataset?.nodeId ?? dataset?.id;
                    return typeof id === "string" && id.length > 0 ? [id] : [];
                }),
            ),
        ];
    }
    return typeof detail?.id === "string" && detail.id.length > 0
        ? [detail.id]
        : [];
}
