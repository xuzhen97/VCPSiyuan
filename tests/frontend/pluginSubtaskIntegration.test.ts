// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { siyuanI18n } from "../helpers/pluginI18n.js";

describe("VCPSiyuanPlugin subtask creation recovery", () => {
    it("creates a child once, retries only the failed link, and opens the parent", async () => {
        const { VCPSiyuanPlugin } = await import(
            "../../src/frontend/plugin.js"
        );
        const plugin = new VCPSiyuanPlugin({
            app: { appId: "test-app", plugins: [] } as any,
            name: "VCPSiyuan",
            displayName: "VCP SiYuan",
            i18n: siyuanI18n,
        }) as any;
        const createTask = vi.fn().mockResolvedValue({
            ok: true,
            data: { id: 33 },
        });
        const linkChild = vi
            .fn()
            .mockResolvedValueOnce({
                ok: false,
                error: { code: "NETWORK_ERROR", message: "link failed" },
            })
            .mockResolvedValueOnce({
                ok: false,
                error: { code: "NETWORK_ERROR", message: "link failed again" },
            })
            .mockResolvedValue({ ok: true, data: { value: {} } });
        plugin.controller = {
            call: (method: string, request: unknown) => {
                if (method === "vikunja.tasks.create") return createTask(request);
                if (method === "vikunja.tasks.linkChild") return linkChild(request);
                throw new Error(`unexpected RPC: ${method}`);
            },
        };
        plugin.loadTaskDialogResources = vi.fn().mockResolvedValue({
            projects: [{
                id: 7,
                title: "Project",
                descriptionMarkdown: "",
                color: null,
                parentProjectId: null,
                archived: false,
                maxPermission: "admin",
            }],
            labels: [],
            assignees: [],
        });
        plugin.ensureCapabilities = vi.fn().mockResolvedValue(undefined);
        plugin.taskListStore = { refreshAll: vi.fn().mockResolvedValue(undefined) };
        const openLinkedTask = vi.fn().mockResolvedValue(undefined);
        plugin.openLinkedTask = openLinkedTask;

        plugin.openCreateChildDialog({
            id: 12,
            title: "Parent task",
            done: false,
            projectId: 7,
            project: { id: 7, title: "Project" },
            parentTasks: [],
            childTasks: [],
            labels: [],
            assignees: [],
            startAt: null,
            dueAt: null,
            priority: 0,
            attachmentCount: 0,
            linkedBlockCount: 0,
            updatedAt: "v1",
            descriptionMarkdown: "",
            reminders: [],
            repeat: { kind: "none" },
            attachments: [],
            maxPermission: "write",
        });

        await vi.waitFor(() =>
            expect(document.querySelector(".vcp-siyuan-task-dialog")).not.toBeNull(),
        );
        const createForm = document.querySelector<HTMLFormElement>(
            ".vcp-siyuan-task-dialog",
        )!;
        expect((createForm.elements.namedItem("projectId") as HTMLSelectElement).value).toBe("7");
        const title = createForm.querySelector<HTMLInputElement>("input[name='title']")!;
        title.value = "Child task";
        title.dispatchEvent(new Event("input", { bubbles: true }));
        createForm.dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
        );

        await vi.waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
        await vi.waitFor(() =>
            expect(document.querySelector("[data-action='retry-follow-up']")).not.toBeNull(),
        );
        expect(createTask).toHaveBeenCalledTimes(1);
        expect(linkChild).toHaveBeenNthCalledWith(1, {
            parentTaskId: 12,
            childTaskId: 33,
        });

        document.querySelector<HTMLButtonElement>("[data-action='retry-follow-up']")!.click();
        await vi.waitFor(() => expect(linkChild).toHaveBeenCalledTimes(2));
        await vi.waitFor(() =>
            expect(document.querySelector("[role='status']")?.textContent).toBe("link failed again"),
        );
        expect(createTask).toHaveBeenCalledTimes(1);

        document.querySelector<HTMLButtonElement>("[data-action='retry-follow-up']")!.click();
        await vi.waitFor(() => expect(openLinkedTask).toHaveBeenCalledWith(12));
        expect(createTask).toHaveBeenCalledTimes(1);
        expect(linkChild).toHaveBeenCalledTimes(3);
        expect(linkChild).toHaveBeenNthCalledWith(3, {
            parentTaskId: 12,
            childTaskId: 33,
        });
        expect(document.querySelector(".vcp-siyuan-task-dialog")).toBeNull();
    });
});
