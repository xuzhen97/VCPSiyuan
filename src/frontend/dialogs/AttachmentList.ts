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
    /** Omitted by hosts that have no viewer, which disables thumbnail opening. */
    onPreview?: (itemId: string) => void;
    loadThumbnail?: (itemId: string) => Promise<Blob | undefined>;
    canDelete?: boolean;
    canDownload?: boolean;
}

export class AttachmentList {
    private readonly options: AttachmentListOptions;
    private readonly thumbnailUrls = new Map<string, string>();
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
        for (const url of this.thumbnailUrls.values()) URL.revokeObjectURL(url);
        this.thumbnailUrls.clear();
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

            const previewable = this.canPreview(item);
            const thumbnail = document.createElement(previewable ? "button" : "div");
            thumbnail.className = "vcp-siyuan-attachment-list__thumbnail";
            if (thumbnail instanceof HTMLButtonElement) {
                thumbnail.type = "button";
                thumbnail.dataset.action = "preview";
                thumbnail.title = i18n.preview;
                thumbnail.setAttribute("aria-label", `${i18n.preview}: ${item.fileName}`);
                thumbnail.addEventListener("click", () =>
                    this.options.onPreview?.(item.id),
                );
            }
            const fallback = document.createElement("span");
            fallback.className = "vcp-siyuan-attachment-list__file-icon";
            fallback.textContent = isImageMimeType(item.mimeType) ? "▧" : "▤";
            fallback.setAttribute("aria-hidden", "true");
            thumbnail.append(fallback);
            row.append(thumbnail);
            if (isImageMimeType(item.mimeType))
                void this.renderThumbnail(item, thumbnail, fallback);

            const body = document.createElement("div");
            body.className = "vcp-siyuan-attachment-list__body";
            const name = document.createElement(previewable ? "button" : "span");
            name.className = "vcp-siyuan-attachment-list__name";
            name.textContent = item.fileName;
            if (name instanceof HTMLButtonElement) {
                name.type = "button";
                name.dataset.action = "preview-name";
                name.addEventListener("click", () =>
                    this.options.onPreview?.(item.id),
                );
            }
            const meta = document.createElement("div");
            meta.className = "vcp-siyuan-attachment-list__meta";
            const status = document.createElement("span");
            status.className = "vcp-siyuan-attachment-list__state";
            status.textContent = `${formatBytes(item.size)} · ${i18n.statusLabel(item.state)}`;
            meta.append(status);
            const actions = document.createElement("div");
            actions.className = "vcp-siyuan-attachment-list__actions";
            body.append(name, meta, actions);
            row.append(body);

            if (item.state === "failed" && item.error?.retryable) {
                const retry = document.createElement("button");
                retry.type = "button";
                retry.dataset.action = "retry";
                retry.textContent = i18n.retry;
                retry.addEventListener("click", () =>
                    this.options.onRetry(item.id),
                );
                this.styleAction(retry, "↻", i18n.retry);
                actions.append(retry);
            }
            if (item.state === "succeeded") {
                const download = document.createElement("button");
                download.type = "button";
                download.dataset.action = "download";
                this.styleAction(download, "↓", i18n.download);
                download.disabled = this.options.canDownload === false;
                download.addEventListener("click", () =>
                    this.options.onDownload(item.id),
                );
                actions.append(download);
            }
            const remove = document.createElement("button");
            remove.type = "button";
            remove.dataset.action = "delete";
            this.styleAction(remove, "×", i18n.delete);
            remove.disabled = this.options.canDelete === false;
            remove.addEventListener("click", () =>
                this.options.onDelete(item.id),
            );
            actions.append(remove);
            list.append(row);
        }
        this.container.append(list);
    }

    private styleAction(button: HTMLButtonElement, icon: string, label: string): void {
        button.className = "vcp-siyuan-attachment-list__action";
        button.textContent = icon;
        button.title = label;
        button.setAttribute("aria-label", label);
    }

    private async renderThumbnail(
        item: AttachmentItem,
        host: HTMLElement,
        fallback: HTMLElement,
    ): Promise<void> {
        let url = this.thumbnailUrls.get(item.id);
        if (!url) {
            const blob = item.file ?? (await this.options.loadThumbnail?.(item.id));
            if (!blob || !this.container) return;
            if (typeof URL.createObjectURL !== "function") return;
            url = URL.createObjectURL(blob);
            this.thumbnailUrls.set(item.id, url);
        }
        if (!host.isConnected && !this.container?.contains(host)) return;
        const image = document.createElement("img");
        image.src = url;
        image.alt = "";
        image.addEventListener("error", () => image.remove());
        fallback.replaceWith(image);
    }

    /** Draft images preview locally; uploaded images use the host's viewer. */
    private canPreview(item: AttachmentItem): boolean {
        if (!this.options.onPreview) return false;
        if (!isImageMimeType(item.mimeType)) return false;
        return item.state === "succeeded" || item.file !== undefined;
    }
}

function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
}
