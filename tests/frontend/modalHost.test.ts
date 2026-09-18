// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createModalHost } from "../../src/frontend/dialogs/modalHost.js";

describe("createModalHost", () => {
    it("traps Tab inside the modal and restores focus to the opener", () => {
        const opener = document.createElement("button");
        document.body.append(opener);
        opener.focus();
        const onDismiss = vi.fn();
        const modal = createModalHost(onDismiss);
        const panel = document.createElement("div");
        const first = document.createElement("button");
        const last = document.createElement("button");
        panel.append(first, last);
        modal.host.append(panel);

        first.focus();
        const forward = new KeyboardEvent("keydown", {
            key: "Tab",
            bubbles: true,
            cancelable: true,
        });
        document.dispatchEvent(forward);
        expect(document.activeElement).toBe(last);
        expect(forward.defaultPrevented).toBe(true);

        last.focus();
        const backward = new KeyboardEvent("keydown", {
            key: "Tab",
            shiftKey: true,
            bubbles: true,
            cancelable: true,
        });
        document.dispatchEvent(backward);
        expect(document.activeElement).toBe(first);
        expect(backward.defaultPrevented).toBe(true);

        modal.dispose();
        expect(document.activeElement).toBe(opener);
        opener.remove();
    });

    it("takes its z-index from SiYuan's dialog counter so later dialogs stack above", () => {
        // SiYuan numbers dialogs with ++window.siyuan.zIndex. A fixed z-index put
        // this host above the confirmations opened from inside it (delete
        // attachment), leaving both unreachable.
        const host = { zIndex: 10 };
        (globalThis as { siyuan?: { zIndex: number } }).siyuan = host;
        try {
            const first = createModalHost(() => {});
            expect(first.host.style.zIndex).toBe("11");
            // A dialog SiYuan opens afterwards takes the next number -> above us.
            host.zIndex += 1;
            expect(host.zIndex).toBe(12);
            const second = createModalHost(() => {});
            expect(second.host.style.zIndex).toBe("13");
            first.dispose();
            second.dispose();
        } finally {
            delete (globalThis as { siyuan?: unknown }).siyuan;
        }
    });

    it("falls back to a fixed layer when SiYuan globals are absent", () => {
        const modal = createModalHost(() => {});
        expect(modal.host.style.zIndex).toBe("1000");
        modal.dispose();
    });
});
