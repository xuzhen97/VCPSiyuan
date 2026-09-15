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
});
