// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { showMessage } from "siyuan";
import { siyuanI18n } from "../helpers/pluginI18n.js";

// Spy on the toast helper without breaking the real Plugin base class the
// frontend plugin extends.
vi.mock("siyuan", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    showMessage: vi.fn(),
}));

describe("VCPSiyuanPlugin lifecycle", () => {
    it("registers RightTop dock, one Block Menu handler, and removes all private data", async () => {
        const { VCPSiyuanPlugin } = await import(
            "../../src/frontend/plugin.js"
        );
        const addDockMock = vi.fn();
        const addIconsMock = vi.fn();
        const loadDataMock = vi.fn().mockResolvedValue({
            vikunjaBaseUrl: "https://tasks.example/api/v1",
            vikunjaTokenSecretName: "MY_TOKEN",
        });
        const saveDataMock = vi.fn().mockResolvedValue(undefined);
        const removeDataMock = vi.fn().mockResolvedValue(undefined);
        const onMock = vi.fn();
        const offMock = vi.fn();

        const plugin = new VCPSiyuanPlugin({
            app: { appId: "test-app" } as any,
            name: "VCPSiyuan",
            displayName: "VCP SiYuan",
            i18n: siyuanI18n,
        });

        (plugin as any).addDock = addDockMock;
        (plugin as any).addIcons = addIconsMock;
        (plugin as any).loadData = loadDataMock;
        (plugin as any).saveData = saveDataMock;
        (plugin as any).removeData = removeDataMock;
        (plugin as any).eventBus = { on: onMock, off: offMock };

        plugin.onload();
        plugin.onload();

        expect(addIconsMock).toHaveBeenCalledTimes(1);
        expect(addDockMock).toHaveBeenCalledTimes(1);
        expect(onMock).toHaveBeenCalledTimes(1);
        expect(onMock.mock.calls.map(([event]) => event)).toEqual([
            "click-blockicon",
        ]);
        const handler = onMock.mock.calls[0][1];

        await plugin.onLayoutReady();
        expect(loadDataMock).toHaveBeenCalledWith("config.json");

        const settings = (plugin as any).settingsDescriptor;
        const tokenEditor = settings.items[1].createActionElement();
        tokenEditor.querySelector("input").value = "tk_inline_token";
        settings.confirm();
        expect(saveDataMock).toHaveBeenCalledWith(
            "config.json",
            expect.objectContaining({ inlineToken: "tk_inline_token" }),
        );

        await plugin.onunload();
        await plugin.onunload();
        expect(offMock).toHaveBeenCalledTimes(1);
        expect(offMock).toHaveBeenCalledWith("click-blockicon", handler);

        await plugin.uninstall();
        expect(removeDataMock).toHaveBeenCalledTimes(4);
        expect(removeDataMock.mock.calls.map(([name]) => name)).toEqual([
            "config.json",
            "task-summary-cache-v1.json",
            "task-link-index-v1.json",
            "pending-operations-v1.json",
        ]);
    });

    describe("task dialog resources", () => {
        const build = async () => {
            const { VCPSiyuanPlugin } = await import(
                "../../src/frontend/plugin.js"
            );
            const plugin = new VCPSiyuanPlugin({
                app: { appId: "test-app" } as any,
                name: "VCPSiyuan",
                displayName: "VCP SiYuan",
                i18n: siyuanI18n,
            });
            return plugin as any;
        };

        it("still opens the dialog with empty assignees when member search fails", async () => {
            const plugin = await build();
            plugin.resourceStore = {
                refresh: vi.fn().mockResolvedValue(undefined),
                searchMembers: vi
                    .fn()
                    .mockRejectedValue(new Error("403 Forbidden")),
                getProjects: vi.fn().mockReturnValue([]),
                getLabels: vi.fn().mockReturnValue([]),
            };

            const resources = await plugin.loadTaskDialogResources(7);

            // Assignee search needs project admin on some servers; it is
            // optional data and must not block creating tasks.
            expect(resources).toEqual({
                projects: [],
                labels: [],
                assignees: [],
            });
        });

        it("blocks the dialog with the real error when projects or labels fail", async () => {
            const plugin = await build();
            plugin.resourceStore = {
                refresh: vi.fn().mockRejectedValue(new Error("403 Forbidden")),
                searchMembers: vi.fn(),
                getProjects: vi.fn().mockReturnValue([]),
                getLabels: vi.fn().mockReturnValue([]),
            };

            const resources = await plugin.loadTaskDialogResources(7);

            expect(resources).toBeUndefined();
            // The toast must carry the underlying cause, not the generic text.
            expect(vi.mocked(showMessage)).toHaveBeenCalledWith(
                "403 Forbidden",
            );
        });
    });
});
