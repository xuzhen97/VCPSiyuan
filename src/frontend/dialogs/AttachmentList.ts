import { isImageMimeType } from "../../shared/attachment.js";
import { AttachmentItem } from "../stores/AttachmentStore.js";

export interface AttachmentListI18n {
    retry: string;
    preview: string;
    download: string;
    delete: string;
    statusLabel: (state: AttachmentItem["state"]) => string;
}

export interface AttachmentListOptions {
    items: AttachmentItem[];
    i18n: AttachmentListI18n;
    onRetry: (itemId: string) => void;
    onDownload: (itemId: string) => void;
    onDelete: (itemId: string) => void;
    /** Omitted by hosts that have no viewer, which hides the action entirely. */
    onPreview?: (itemId: string) => void;
    canDelete?: boolean;
    canDownload?: boolean;
}

export class AttachmentList {
    private readonly options: AttachmentListOptions;
    private container?: HTMLElement;

    constructor(options: AttachmentListOptions) {
        this.options = options;
    }

    update(items: AttachmentItem[]): void {
        this.options.items = items;
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
        const i18n = this.options.i18n;
        const list = document.createElement("div");
        list.className = "vcp-siyuan-attachment-list";
        for (const item of this.options.items) {
            const row = document.createElement("div");
            row.className = "vcp-siyuan-attachment-list__item";
            row.dataset.itemId = item.id;

            const name = document.createElement("span");
            name.className = "vcp-siyuan-attachment-list__name";
            name.textContent = item.fileName;
            row.append(name);

            const status = document.createElement("span");
            status.className = "vcp-siyuan-attachment-list__state";
            status.textContent = i18n.statusLabel(item.state);
            row.append(status);

            if (item.state === "failed" && item.error?.retryable) {
                const retry = document.createElement("button");
                retry.type = "button";
                retry.dataset.action = "retry";
                retry.textContent = i18n.retry;
                retry.addEventListener("click", () =>
                    this.options.onRetry(item.id),
                );
                row.append(retry);
            }
            if (this.canPreview(item)) {
                const preview = document.createElement("button");
                preview.type = "button";
                preview.dataset.action = "preview";
                preview.textContent = i18n.preview;
                preview.addEventListener("click", () =>
                    this.options.onPreview?.(item.id),
                );
                row.append(preview);
            }
            if (item.state === "succeeded") {
                const download = document.createElement("button");
                download.type = "button";
                download.dataset.action = "download";
                download.textContent = i18n.download;
                download.disabled = this.options.canDownload === false;
                download.addEventListener("click", () =>
                    this.options.onDownload(item.id),
                );
                row.append(download);
            }
            const remove = document.createElement("button");
            remove.type = "button";
            remove.dataset.action = "delete";
            remove.textContent = i18n.delete;
            remove.disabled = this.options.canDelete === false;
            remove.addEventListener("click", () =>
                this.options.onDelete(item.id),
            );
            row.append(remove);
            list.append(row);
        }
        this.container.append(list);
    }

    /**
     * Draft images are still in memory, so they preview without a round trip;
     * uploaded ones need the store to fetch them.
     */
    private canPreview(item: AttachmentItem): boolean {
        if (!this.options.onPreview) return false;
        if (!isImageMimeType(item.mimeType)) return false;
        return item.state === "succeeded" || item.file !== undefined;
    }
}
