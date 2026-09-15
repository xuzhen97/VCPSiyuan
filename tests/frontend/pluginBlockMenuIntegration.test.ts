// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { siyuanI18n } from "../helpers/pluginI18n.js";

describe("VCPSiyuanPlugin Block Menu integration", () => {
    it("links, views, unlinks a batch, and releases the menu on unload", async () => {
        const { VCPSiyuanPlugin } = await import(
            "../../src/frontend/plugin.js"
        );
        const addDock = vi.fn();
        const addIcons = vi.fn();
        const on = vi.fn();
        const off = vi.fn();
        const attributes = new Map<string, string>();
        const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
            const body = init?.body ? JSON.parse(String(init.body)) : {};
            if (path === "/api/block/getBlockInfo") {
                return {
                    ok: true,
                    json: async () => ({
                        code: 0,
                        data: {
                            rootID: "doc-1",
                            box: "nb-1",
                            rootTitle: body.id,
                        },
                    }),
                };
            }
            if (path === "/api/attr/getBlockAttrs") {
                return {
                    ok: true,
                    json: async () => ({
                        code: 0,
                        data: {
                            "custom-vikunja-task-links":
                                attributes.get(body.id) ?? "",
                        },
                    }),
                };
            }
            if (path === "/api/attr/setBlockAttrs") {
                attributes.set(
                    body.id,
                    body.attrs["custom-vikunja-task-links"],
                );
                return {
                    ok: true,
                    json: async () => ({ code: 0, data: null }),
                };
            }
            throw new Error(`unexpected SiYuan path: ${path}`);
        });
        vi.stubGlobal("fetch", fetchMock);
        vi.stubGlobal(
            "prompt",
            vi.fn(() => "9"),
        );

        const plugin = new VCPSiyuanPlugin({
            app: { appId: "test-app", plugins: [] } as any,
            name: "VCPSiyuan",
            displayName: "VCP SiYuan",
            i18n: siyuanI18n,
        });
        (plugin as any).addDock = addDock;
        (plugin as any).addIcons = addIcons;
        (plugin as any).loadData = vi.fn().mockResolvedValue({
            vikunjaOrigin: "https://tasks.example/api/v1",
            vikunjaTokenSecretName: "TOKEN",
            inboxProjectId: 7,
        });
        (plugin as any).getSecret = vi.fn().mockReturnValue("secret");
        (plugin as any).eventBus = { on, off };
        (plugin as any).kernel.rpc.call["vikunja.tasks.get"] = vi
            .fn()
            .mockResolvedValue({
                ok: true,
                data: {
                    value: {
                        id: 9,
                        title: "Existing task",
                        done: false,
                        descriptionMarkdown: "",
                        maxPermission: "write",
                    },
                },
            });

        plugin.onload();
        await plugin.onLayoutReady();
        const blockMenuHandler = on.mock.calls[0][1] as (
            event: unknown,
        ) => void;
        const menu = { addItem: vi.fn() };
        blockMenuHandler({
            detail: { blockIds: ["b1", "b2"], menu },
        });

        expect(menu.addItem).toHaveBeenCalledTimes(4);
        await menu.addItem.mock.calls[1][0].click();
        expect(JSON.parse(attributes.get("b1") ?? "{}")).toEqual({
            v: 1,
            taskIds: [9],
        });
        expect(JSON.parse(attributes.get("b2") ?? "{}")).toEqual({
            v: 1,
            taskIds: [9],
        });

        await menu.addItem.mock.calls[2][0].click();
        const detailHost = document.querySelector(
            ".vcp-siyuan-linked-task-dialog",
        );
        expect(detailHost).not.toBeNull();
        // The overlay shell must carry the modal class; without it the panel is
        // appended as an unstyled block at the end of the document instead of a
        // centred dialog.
        expect(detailHost?.classList.contains("vcp-siyuan-modal")).toBe(true);
        expect(
            detailHost?.querySelector(".vcp-siyuan-task-detail"),
        ).not.toBeNull();

        blockMenuHandler({
            detail: { blockIds: ["b1", "b2"], menu },
        });
        await menu.addItem.mock.calls[7][0].click();
        expect(JSON.parse(attributes.get("b1") ?? "{}")).toEqual({
            v: 1,
            taskIds: [],
        });
        expect(JSON.parse(attributes.get("b2") ?? "{}")).toEqual({
            v: 1,
            taskIds: [],
        });

        await plugin.onunload();
        expect(off).toHaveBeenCalledTimes(2);
        expect(off.mock.calls.map(([event]) => event)).toEqual([
            "click-blockicon",
            "switch-protyle",
        ]);
        expect(
            document.querySelector(".vcp-siyuan-linked-task-dialog"),
        ).toBeNull();
        expect(fetchMock).toHaveBeenCalled();

        vi.unstubAllGlobals();
    });
});
