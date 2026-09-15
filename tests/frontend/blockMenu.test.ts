import { describe, expect, it, vi } from "vitest";
import { registerBlockMenu } from "../../src/frontend/context/blockMenu.js";
import { blockMenuLabels } from "../helpers/pluginI18n.js";

describe("Block menu", () => {
    it("registers four localized actions and removes the same handler on dispose", () => {
        const eventBus = { on: vi.fn(), off: vi.fn() };
        const create = vi.fn();
        const menu = { addItem: vi.fn() };
        const dispose = registerBlockMenu(
            eventBus,
            {
                onCreate: create,
                onLink: vi.fn(),
                onView: vi.fn(),
                onUnlink: vi.fn(),
            },
            blockMenuLabels,
        );
        expect(eventBus.on).toHaveBeenCalledWith(
            "click-blockicon",
            expect.any(Function),
        );
        const handler = eventBus.on.mock.calls[0][1];
        handler({
            detail: {
                menu,
                blockElements: [
                    { dataset: { nodeId: "b1" } },
                    { dataset: { nodeId: "b2" } },
                ],
            },
        });
        expect(menu.addItem).toHaveBeenCalledTimes(4);
        expect(menu.addItem.mock.calls[0][0].label).toBe(
            `${blockMenuLabels.create}${blockMenuLabels.selectionCount(2)}`,
        );
        expect(menu.addItem.mock.calls[0][0].label).toContain("2");
        menu.addItem.mock.calls[0][0].click();
        expect(create).toHaveBeenCalledWith(["b1", "b2"]);
        dispose();
        expect(eventBus.off).toHaveBeenCalledWith("click-blockicon", handler);
    });

    it("omits the selection suffix for a single Block", () => {
        const eventBus = { on: vi.fn(), off: vi.fn() };
        const menu = { addItem: vi.fn() };
        registerBlockMenu(
            eventBus,
            {
                onCreate: vi.fn(),
                onLink: vi.fn(),
                onView: vi.fn(),
                onUnlink: vi.fn(),
            },
            blockMenuLabels,
        );
        eventBus.on.mock.calls[0][1]({
            detail: { blockIds: ["b1"], menu },
        });
        expect(menu.addItem.mock.calls[0][0].label).toBe(
            blockMenuLabels.create,
        );
    });
});
