// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { siyuanI18n } from "../helpers/pluginI18n.js";

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
        expect(onMock).toHaveBeenCalledTimes(2);
        expect(onMock.mock.calls.map(([event]) => event)).toEqual([
            "click-blockicon",
            "switch-protyle",
        ]);
        const handler = onMock.mock.calls[0][1];
        const switchHandler = onMock.mock.calls[1][1];

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
        expect(offMock).toHaveBeenCalledTimes(2);
        expect(offMock).toHaveBeenCalledWith("click-blockicon", handler);
        expect(offMock).toHaveBeenCalledWith("switch-protyle", switchHandler);

        await plugin.uninstall();
        expect(removeDataMock).toHaveBeenCalledTimes(4);
        expect(removeDataMock.mock.calls.map(([name]) => name)).toEqual([
            "config.json",
            "task-summary-cache-v1.json",
            "task-link-index-v1.json",
            "pending-operations-v1.json",
        ]);
    });
});
