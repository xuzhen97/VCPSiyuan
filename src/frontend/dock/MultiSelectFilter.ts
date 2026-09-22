export interface MultiSelectOption {
    id: number;
    label: string;
    color?: string | null;
    disabled?: boolean;
}

export interface MultiSelectFilterOptions {
    key: "project" | "label" | "assignee";
    label: string;
    selectedIds: number[];
    options: MultiSelectOption[];
    disabled?: boolean;
    mode?: "multiple" | "single";
    clearable?: boolean;
    searchable?: boolean;
    searchPlaceholder?: string;
    className?: string;
    onSearch?: (query: string) => void;
    onChange: (ids: number[]) => void;
}

export interface MultiSelectFilterElement extends HTMLDivElement {
    destroy: () => void;
    updateOptions: (options: MultiSelectOption[]) => void;
    setSelected: (ids: number[]) => void;
}

export function createMultiSelectFilter(
    options: MultiSelectFilterOptions,
): MultiSelectFilterElement {
    const root = document.createElement("div") as MultiSelectFilterElement;
    const mode = options.mode ?? "multiple";
    const inputName = `vcp-siyuan-${options.key}-${crypto.randomUUID()}`;
    let availableOptions = [...options.options];
    root.className = options.className ?? "vcp-siyuan-dock__multi-select";
    root.dataset.filter = options.key;
    root.dataset.mode = mode;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "b3-button vcp-siyuan-dock__multi-select-trigger";
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", options.label);
    button.disabled = options.disabled === true;
    root.append(button);

    const menu = document.createElement("div");
    menu.className = "vcp-siyuan-dock__multi-select-popover";
    menu.hidden = true;
    let query = "";
    const search = options.searchable
        ? document.createElement("input")
        : undefined;
    if (search) {
        search.type = "search";
        search.className = "vcp-siyuan-dock__multi-select-search";
        search.placeholder = options.searchPlaceholder ?? options.label;
        search.setAttribute("aria-label", search.placeholder);
        search.addEventListener("input", () => {
            query = search.value.trim().toLocaleLowerCase();
            options.onSearch?.(search.value.trim());
            render();
        });
        menu.append(search);
    }
    menu.setAttribute("role", "listbox");
    if (mode === "multiple") menu.setAttribute("aria-multiselectable", "true");
    root.append(menu);

    const selected = new Set(options.selectedIds);
    const labelText = () => {
        if (mode === "single" && selected.size > 0) {
            const id = [...selected][0];
            return availableOptions.find((option) => option.id === id)?.label ?? options.label;
        }
        return selected.size > 0
            ? `${options.label} · ${selected.size}`
            : options.label;
    };

    const close = () => {
        menu.hidden = true;
        button.setAttribute("aria-expanded", "false");
    };
    const open = () => {
        if (button.disabled) return;
        menu.hidden = false;
        button.setAttribute("aria-expanded", "true");
    };
    const render = () => {
        button.replaceChildren();
        const text = document.createElement("span");
        text.className = "vcp-siyuan-dock__multi-select-label";
        text.textContent = labelText();
        // A vector chevron is centred by flexbox itself. The old "⌄" glyph sat
        // on font metrics and drifted well below the label.
        const chevron = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "svg",
        );
        // Size and paint live in the dock stylesheet: the host's
        // `.b3-button svg` and `svg { fill: currentcolor }` rules outrank
        // presentation attributes.
        chevron.setAttribute("class", "vcp-siyuan-dock__multi-select-chevron");
        chevron.setAttribute("viewBox", "0 0 12 12");
        chevron.setAttribute("aria-hidden", "true");
        const chevronPath = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "path",
        );
        chevronPath.setAttribute("d", "M2.5 4.5 6 8l3.5-3.5");
        chevron.append(chevronPath);
        button.append(text, chevron);
        menu.replaceChildren();
        if (search) menu.append(search);
        for (const option of availableOptions.filter((item) =>
            !query || item.label.toLocaleLowerCase().includes(query),
        )) {
            const row = document.createElement("div");
            row.className = "vcp-siyuan-dock__multi-select-option";
            row.setAttribute("role", "option");
            row.tabIndex = option.disabled ? -1 : 0;
            row.dataset.selected = String(selected.has(option.id));
            row.setAttribute("aria-selected", String(selected.has(option.id)));
            if (option.disabled) row.setAttribute("aria-disabled", "true");

            const checkbox = document.createElement("input");
            checkbox.type = mode === "single" ? "radio" : "checkbox";
            checkbox.name = inputName;
            checkbox.value = String(option.id);
            checkbox.checked = selected.has(option.id);
            checkbox.disabled = option.disabled === true;
            checkbox.tabIndex = -1;
            checkbox.setAttribute("aria-hidden", "true");

            const choose = () => {
                if (option.disabled) return;
                if (mode === "single") {
                    if (selected.has(option.id) && options.clearable !== false)
                        selected.clear();
                    else {
                        selected.clear();
                        selected.add(option.id);
                    }
                    close();
                } else if (selected.has(option.id)) selected.delete(option.id);
                else selected.add(option.id);
                for (const optionRow of menu.querySelectorAll<HTMLElement>(
                    ".vcp-siyuan-dock__multi-select-option",
                )) {
                    const input = optionRow.querySelector<HTMLInputElement>("input");
                    const isSelected = input ? selected.has(Number(input.value)) : false;
                    if (input) input.checked = isSelected;
                    optionRow.dataset.selected = String(isSelected);
                    optionRow.setAttribute("aria-selected", String(isSelected));
                }
                text.textContent = labelText();
                options.onChange([...selected].sort((a, b) => a - b));
            };
            row.addEventListener("click", choose);
            row.addEventListener("keydown", (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                choose();
            });

            const optionText = document.createElement("span");
            optionText.className = "vcp-siyuan-dock__multi-select-option-text";
            optionText.textContent = option.label;
            row.append(checkbox);
            if (option.color) {
                const swatch = document.createElement("span");
                swatch.className = "vcp-siyuan-dock__multi-select-swatch";
                swatch.style.background = option.color;
                swatch.setAttribute("aria-hidden", "true");
                row.append(swatch);
            }
            row.append(optionText);
            menu.append(row);
        }
    };

    button.addEventListener("click", () => {
        if (menu.hidden) open();
        else close();
    });
    const onDocumentClick = (event: MouseEvent) => {
        if (!root.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") close();
    };
    document.addEventListener("click", onDocumentClick);
    root.addEventListener("keydown", onKeyDown);
    root.destroy = () => {
        document.removeEventListener("click", onDocumentClick);
        root.removeEventListener("keydown", onKeyDown);
    };
    root.updateOptions = (nextOptions) => {
        availableOptions = [...nextOptions];
        render();
    };
    root.setSelected = (ids) => {
        selected.clear();
        for (const id of ids) {
            if (availableOptions.some((option) => option.id === id))
                selected.add(id);
        }
        render();
    };
    render();
    return root;
}
