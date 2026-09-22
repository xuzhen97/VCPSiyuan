// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createMultiSelectFilter } from "../../src/frontend/dock/MultiSelectFilter.js";

describe("MultiSelectFilter", () => {
    it("selects multiple options, reports the count, and closes on Escape", () => {
        const changes: number[][] = [];
        const filter = createMultiSelectFilter({
            key: "project",
            label: "Project",
            selectedIds: [],
            options: [
                { id: 1, label: "Parent / One" },
                { id: 2, label: "Two" },
            ],
            onChange: (ids) => changes.push(ids),
        });
        document.body.append(filter);
        filter.querySelector<HTMLButtonElement>("button")!.click();
        const checkboxes = filter.querySelectorAll<HTMLInputElement>(
            "input[type='checkbox']",
        );
        checkboxes[0].click();
        checkboxes[1].click();
        expect(changes).toEqual([[1], [1, 2]]);
        expect(filter.textContent).toContain("Project · 2");
        expect(
            filter.querySelector(".vcp-siyuan-dock__multi-select-popover"),
        ).not.toBeNull();
        const optionRows = filter.querySelectorAll(
            ".vcp-siyuan-dock__multi-select-option",
        );
        expect(optionRows).toHaveLength(2);
        expect(optionRows[0].tagName).toBe("DIV");
        expect(optionRows[0].textContent).toContain("Parent / One");
        filter.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        expect(
            filter
                .querySelector<HTMLButtonElement>("button")
                ?.getAttribute("aria-expanded"),
        ).toBe("false");
        filter.destroy();
    });

    it("keeps one single-select marker and allows clearing it", () => {
        const onChange = vi.fn();
        const filter = createMultiSelectFilter({
            key: "project",
            label: "Project",
            mode: "single",
            selectedIds: [1],
            options: [
                { id: 1, label: "One" },
                { id: 2, label: "Two" },
            ],
            onChange,
        });
        document.body.append(filter);
        const rows = filter.querySelectorAll<HTMLElement>(
            ".vcp-siyuan-dock__multi-select-option",
        );
        rows[1].click();
        expect(onChange).toHaveBeenLastCalledWith([2]);
        expect(
            [...filter.querySelectorAll<HTMLInputElement>("input[type='radio']")]
                .filter((input) => input.checked),
        ).toHaveLength(1);
        rows[1].click();
        expect(onChange).toHaveBeenLastCalledWith([]);
        expect(filter.querySelector<HTMLInputElement>("input:checked")).toBeNull();
        filter.destroy();
    });

    it("closes when clicking outside and disables writes", () => {
        const filter = createMultiSelectFilter({
            key: "label",
            label: "Label",
            selectedIds: [3],
            options: [{ id: 3, label: "Urgent" }],
            disabled: true,
            onChange: vi.fn(),
        });
        document.body.append(filter);
        const button = filter.querySelector<HTMLButtonElement>("button")!;
        expect(button.disabled).toBe(true);
        button.click();
        expect(button.getAttribute("aria-expanded")).toBe("false");
        filter.destroy();
    });
});
