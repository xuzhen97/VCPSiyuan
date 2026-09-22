// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { AttachmentList } from "../../src/frontend/dialogs/AttachmentList.js";
import { AttachmentItem } from "../../src/frontend/stores/AttachmentStore.js";
import { attachmentListI18n } from "../helpers/pluginI18n.js";

describe("AttachmentList", () => {
    it("renders filenames as text and wires retry/download/delete actions", () => {
        const item: AttachmentItem = {
            id: "file-1",
            file: new File(["x"], "<unsafe>.txt"),
            fileName: "<unsafe>.txt",
            mimeType: "text/plain",
            size: 1,
            state: "failed",
            error: { code: "REMOTE_ERROR", message: "retry", retryable: true },
        };
        const retry = vi.fn();
        const download = vi.fn();
        const remove = vi.fn();
        const host = document.createElement("div");
        new AttachmentList({
            items: [item],
            i18n: attachmentListI18n,
            onRetry: retry,
            onDownload: download,
            onDelete: remove,
        }).mount(host);
        expect(host.querySelector("img")).toBeNull();
        expect(host.textContent).toContain("<unsafe>.txt");
        expect(host.textContent).toContain(
            attachmentListI18n.statusLabel("failed"),
        );
        host.querySelector("button[data-action='retry']")?.dispatchEvent(
            new MouseEvent("click"),
        );
        expect(retry).toHaveBeenCalledWith("file-1");
    });

    it("renders localized status labels instead of raw state names", () => {
        const host = document.createElement("div");
        new AttachmentList({
            items: [
                {
                    id: "file-2",
                    fileName: "a.txt",
                    mimeType: "text/plain",
                    size: 1,
                    state: "uploading",
                },
            ],
            i18n: attachmentListI18n,
            onRetry: vi.fn(),
            onDownload: vi.fn(),
            onDelete: vi.fn(),
        }).mount(host);
        expect(host.textContent).toContain(
            attachmentListI18n.statusLabel("uploading"),
        );
        expect(host.textContent).not.toContain("uploading");
        expect(host.querySelector("button[data-action='download']")).toBeNull();
    });

    it("offers an image preview for local drafts and uploaded images", () => {
        const onPreview = vi.fn();
        const host = document.createElement("div");
        new AttachmentList({
            items: [
                {
                    id: "file-3",
                    file: new File(["x"], "draft.png"),
                    fileName: "draft.png",
                    mimeType: "image/png",
                    size: 1,
                    state: "queued",
                },
                {
                    id: "remote-4",
                    fileName: "saved.jpg",
                    mimeType: "image/jpeg",
                    size: 1,
                    state: "succeeded",
                },
            ],
            i18n: attachmentListI18n,
            onRetry: vi.fn(),
            onDownload: vi.fn(),
            onDelete: vi.fn(),
            onPreview,
        }).mount(host);
        const buttons = host.querySelectorAll("button[data-action='preview']");
        expect(buttons).toHaveLength(2);
        buttons[0].dispatchEvent(new MouseEvent("click"));
        expect(onPreview).toHaveBeenCalledWith("file-3");
        expect(buttons[0].getAttribute("aria-label")).toContain(
            attachmentListI18n.preview,
        );
        expect(host.querySelector("button[data-action='preview-name']")?.textContent)
            .toBe("draft.png");
    });

    it("hides the preview action for non-images and for hosts without a viewer", () => {
        const items: AttachmentItem[] = [
            {
                id: "remote-5",
                fileName: "notes.txt",
                mimeType: "text/plain",
                size: 1,
                state: "succeeded",
            },
            {
                id: "file-6",
                fileName: "gone.png",
                mimeType: "image/png",
                size: 1,
                state: "failed",
                error: { code: "REMOTE_ERROR", message: "x", retryable: false },
            },
        ];
        const host = document.createElement("div");
        new AttachmentList({
            items,
            i18n: attachmentListI18n,
            onRetry: vi.fn(),
            onDownload: vi.fn(),
            onDelete: vi.fn(),
            onPreview: vi.fn(),
        }).mount(host);
        expect(host.querySelector("button[data-action='preview']")).toBeNull();

        const withoutHost = document.createElement("div");
        new AttachmentList({
            items: [
                {
                    id: "remote-7",
                    fileName: "photo.png",
                    mimeType: "image/png",
                    size: 1,
                    state: "succeeded",
                },
            ],
            i18n: attachmentListI18n,
            onRetry: vi.fn(),
            onDownload: vi.fn(),
            onDelete: vi.fn(),
        }).mount(withoutHost);
        expect(
            withoutHost.querySelector("button[data-action='preview']"),
        ).toBeNull();
    });
});
