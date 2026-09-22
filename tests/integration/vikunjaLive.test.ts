import { describe, expect, it } from "vitest";
import { SiYuanHttpClient } from "../../src/kernel/http/SiYuanHttpClient.js";
import { VikunjaV2Client } from "../../src/kernel/vikunja/VikunjaV2Client.js";
import { TaskGateway } from "../../src/kernel/vikunja/TaskGateway.js";
import { ProjectGateway } from "../../src/kernel/vikunja/ProjectGateway.js";
import { LabelGateway } from "../../src/kernel/vikunja/LabelGateway.js";
import { UserGateway } from "../../src/kernel/vikunja/UserGateway.js";
import { AttachmentGateway } from "../../src/kernel/vikunja/AttachmentGateway.js";
import { ConnectionService } from "../../src/kernel/services/ConnectionService.js";
import { TaskQueryService } from "../../src/kernel/services/TaskQueryService.js";
import { TaskCommandService } from "../../src/kernel/services/TaskCommandService.js";
import { ProjectService } from "../../src/kernel/services/ProjectService.js";
import { LabelService } from "../../src/kernel/services/LabelService.js";
import { UserService } from "../../src/kernel/services/UserService.js";
import { AttachmentService } from "../../src/kernel/services/AttachmentService.js";
import { VikunjaCredentials } from "../../src/shared/contracts.js";
import { createForwardProxyShim } from "../../dev/forwardProxyShim.js";

/**
 * Live integration tests against a real, isolated Vikunja v2.5.0 instance.
 *
 * These are skipped unless both env vars are present, so the default test run
 * stays hermetic:
 *
 *   VIKUNJA_LIVE_URL=http://127.0.0.1:3456
 *   VIKUNJA_LIVE_TOKEN=<jwt from POST /api/v2/login>
 *
 * They drive the plugin's real Kernel stack (client -> gateways -> services)
 * through a faithful reimplementation of SiYuan's `forwardProxy`, so mappers,
 * URL construction, pagination, and error translation are exercised for real
 * instead of against hand-written fixtures.
 */
const baseUrl = process.env.VIKUNJA_LIVE_URL;
const token = process.env.VIKUNJA_LIVE_TOKEN;
const live = Boolean(baseUrl && token);

const credentials: VikunjaCredentials = {
    origin: baseUrl ?? "",
    token: token ?? "",
};

/**
 * Vikunja stamps `updated` — and therefore the ETag derived from it — at
 * one-second resolution, and `/api/v2/info` advertises `concurrent_writes: false`.
 * Two writes inside the same second are indistinguishable, so a conflict test has
 * to cross a second boundary before the first write.
 */
async function waitForNextSecondBoundary(): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < 2_000) {
        if (Date.now() % 1_000 < 100) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}

function buildStack() {
    const shim = createForwardProxyShim();
    const http = new SiYuanHttpClient(shim.fetch);
    const client = new VikunjaV2Client(http);
    const taskGateway = new TaskGateway(client);
    const projectGateway = new ProjectGateway(client);
    const labelGateway = new LabelGateway(client);
    const userGateway = new UserGateway(client);
    const attachmentGateway = new AttachmentGateway(client);
    return {
        shim,
        connection: new ConnectionService(client, {
            taskPatch: true,
            projectPermissions: true,
        }),
        tasks: new TaskQueryService(taskGateway),
        commands: new TaskCommandService(taskGateway, { writesAllowed: true }),
        projects: new ProjectService(projectGateway, taskGateway, {
            writesAllowed: true,
        }),
        labels: new LabelService(labelGateway, taskGateway, {
            writesAllowed: true,
        }),
        users: new UserService(userGateway),
        attachments: new AttachmentService(attachmentGateway, {
            attachmentsEnabled: true,
        }),
        taskGateway,
    };
}

const stack = buildStack();
const suffix = Date.now().toString(36);

describe.skipIf(!live)("Vikunja v2.5.0 live integration", () => {
    it("reports v2.5.0 capabilities and the effective attachment limit", async () => {
        const result = await stack.connection.test(credentials);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.serverVersion).toBe("v2.5.0");
        expect(result.data.apiVersion).toBe("v2");
        expect(result.data.attachments).toBe(true);
        expect(result.data.writesAllowed).toBe(true);
        // server advertises 20MB, plugin caps at 30MiB -> 20MB wins
        expect(result.data.effectiveAttachmentLimitBytes).toBe(
            20 * 1024 * 1024,
        );
    });

    it("lists projects, mapping the root project parent id", async () => {
        const result = await stack.projects.list(credentials, {
            page: 1,
            perPage: 50,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.items.length).toBeGreaterThan(0);
        const inbox = result.data.items.find((p) => p.title === "Inbox");
        expect(inbox).toBeDefined();
        expect(inbox?.parentProjectId).toBeNull();
    });

    it("queries all tasks with structured filters", async () => {
        const result = await stack.tasks.query(credentials, {
            view: "all",
            page: 1,
            perPage: 50,
            timeZone: "Asia/Shanghai",
            doneFilter: "open",
            projectIds: [],
            labelIds: [],
        });
        expect(result).toMatchObject({ ok: true });
    });

    it("queries the inbox view through the project-scoped path", async () => {
        const result = await stack.tasks.query(credentials, {
            view: "inbox",
            inboxProjectId: 1,
            page: 1,
            perPage: 50,
            timeZone: "Asia/Shanghai",
            doneFilter: "open",
            projectIds: [],
            labelIds: [],
        });
        expect(result).toMatchObject({ ok: true });
        if (!result.ok) return;
        expect(
            stack.shim.log.some((entry) =>
                entry.url.includes("/api/v2/projects/1/tasks"),
            ),
        ).toBe(true);
    });

    it("creates, reads, and patches a task", async () => {
        const created = await stack.commands.create(credentials, {
            draft: {
                title: `live task ${suffix}`,
                projectId: 1,
                labelIds: [],
                assigneeIds: [],
                startAt: null,
                dueAt: "2026-10-01T10:00:00Z",
                priority: 3,
                descriptionMarkdown: "# live body",
                reminders: [],
                repeat: { kind: "none" },
            },
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        expect(created.data.title).toBe(`live task ${suffix}`);
        expect(created.data.dueAt).toBe("2026-10-01T10:00:00Z");
        expect(created.data.priority).toBe(3);
        expect(created.data.descriptionMarkdown).toBe("# live body");
        expect(created.data.repeat).toEqual({ kind: "none" });
        expect(created.data.labels).toEqual([]);
        expect(created.data.assignees).toEqual([]);
        // permission must be decoded from the numeric wire value
        expect(created.data.maxPermission).toBe("admin");

        const patched = await stack.commands.update(credentials, {
            taskId: created.data.id,
            patch: { title: `live task patched ${suffix}`, priority: 5 },
            expected: {
                etag: created.data.etag,
                updatedAt: created.data.updatedAt,
            },
        });
        expect(patched.ok).toBe(true);
        if (!patched.ok) return;
        expect(patched.data.title).toBe(`live task patched ${suffix}`);
        expect(patched.data.priority).toBe(5);
    });

    it("round-trips an editable repeat rule as seconds and an integer mode", async () => {
        const created = await stack.commands.create(credentials, {
            draft: {
                title: `live repeat ${suffix}`,
                projectId: 1,
                labelIds: [],
                assigneeIds: [],
                startAt: null,
                dueAt: null,
                priority: 0,
                descriptionMarkdown: "",
                reminders: [],
                repeat: { kind: "editable", every: 2, unit: "week" },
            },
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        // two weeks in seconds
        expect(created.data.repeat).toEqual({
            kind: "editable",
            every: 2,
            unit: "week",
        });
    });

    it("blocks a stale update instead of overwriting a newer remote task", async () => {
        const created = await stack.commands.create(credentials, {
            draft: {
                title: `live conflict ${suffix}`,
                projectId: 1,
                labelIds: [],
                assigneeIds: [],
                startAt: null,
                dueAt: null,
                priority: 0,
                descriptionMarkdown: "",
                reminders: [],
                repeat: { kind: "none" },
            },
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        const originalEtag = created.data.etag;
        // The v2 detail endpoint exposes an ETag; the plugin must surface it,
        // because `updated` only has second granularity.
        expect(originalEtag).toBeTruthy();

        await waitForNextSecondBoundary();

        const first = await stack.commands.update(credentials, {
            taskId: created.data.id,
            patch: { title: "first writer" },
            expected: { etag: originalEtag },
        });
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        // The version token really moved, so the next write is genuinely stale.
        expect(first.data.updatedAt).not.toBe(created.data.updatedAt);

        const stale = await stack.commands.update(credentials, {
            taskId: created.data.id,
            patch: { title: "stale writer" },
            expected: { etag: originalEtag },
        });
        expect(stale).toMatchObject({
            ok: false,
            error: { code: "CONFLICT" },
        });
    });

    it("treats a patch that changes nothing as a successful no-op", async () => {
        const created = await stack.commands.create(credentials, {
            draft: {
                title: `live noop ${suffix}`,
                projectId: 1,
                labelIds: [],
                assigneeIds: [],
                startAt: null,
                dueAt: null,
                priority: 0,
                descriptionMarkdown: "",
                reminders: [],
                repeat: { kind: "none" },
            },
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        // Vikunja's AutoPatch answers an unchanged patch with 304 Not Modified
        // and no body, which must not surface as a retryable failure.
        const noop = await stack.commands.update(credentials, {
            taskId: created.data.id,
            patch: { priority: 0 },
            expected: { etag: created.data.etag },
        });
        expect(noop).toMatchObject({ ok: true });
        if (!noop.ok) return;
        expect(noop.data.id).toBe(created.data.id);
        expect(noop.data.title).toBe(`live noop ${suffix}`);
    });

    it("attaches and detaches labels and assignees", async () => {
        const created = await stack.commands.create(credentials, {
            draft: {
                title: `live relations ${suffix}`,
                projectId: 1,
                labelIds: [],
                assigneeIds: [],
                startAt: null,
                dueAt: null,
                priority: 0,
                descriptionMarkdown: "",
                reminders: [],
                repeat: { kind: "none" },
            },
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        const taskId = created.data.id;

        const label = await stack.labels.create(credentials, {
            draft: {
                title: `live label ${suffix}`,
                descriptionMarkdown: "",
                color: null,
            },
        });
        expect(label.ok).toBe(true);
        if (!label.ok) return;

        const withRelations = await stack.commands.update(credentials, {
            taskId,
            patch: {},
            labels: { before: [], after: [label.data.id] },
        });
        expect(withRelations.ok).toBe(true);
        if (!withRelations.ok) return;
        expect(withRelations.data.labels?.map((l) => l.id)).toEqual([
            label.data.id,
        ]);

        const detached = await stack.commands.update(credentials, {
            taskId,
            patch: {},
            labels: { before: [label.data.id], after: [] },
        });
        expect(detached.ok).toBe(true);
        if (!detached.ok) return;
        expect(detached.data.labels ?? []).toEqual([]);
    });

    it("uploads, lists, downloads, and deletes an attachment", async () => {
        const created = await stack.commands.create(credentials, {
            draft: {
                title: `live attachment ${suffix}`,
                projectId: 1,
                labelIds: [],
                assigneeIds: [],
                startAt: null,
                dueAt: null,
                priority: 0,
                descriptionMarkdown: "",
                reminders: [],
                repeat: { kind: "none" },
            },
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        const taskId = created.data.id;

        const bytes = new TextEncoder().encode("attachment-body");
        const upload = await stack.attachments.upload(credentials, {
            taskId,
            files: [
                {
                    id: "file-1",
                    name: "live.txt",
                    type: "text/plain",
                    bytes,
                },
            ],
        });
        expect(upload.ok).toBe(true);
        if (!upload.ok) return;
        expect(upload.data.failed).toEqual([]);
        expect(upload.data.succeeded).toHaveLength(1);
        const attachmentId = upload.data.succeeded[0].id;
        expect(upload.data.succeeded[0].name).toBe("live.txt");
        expect(upload.data.succeeded[0].size).toBe(bytes.byteLength);

        const list = await stack.attachments.list(credentials, {
            taskId,
            page: 1,
            perPage: 50,
        });
        expect(list.ok).toBe(true);
        if (!list.ok) return;
        expect(list.data.items.map((item) => item.name)).toContain("live.txt");

        const download = await stack.attachments.download(credentials, {
            taskId,
            attachmentId,
        });
        expect(download.ok).toBe(true);
        if (!download.ok) return;
        expect(new TextDecoder().decode(download.data.bytes)).toBe(
            "attachment-body",
        );

        const removed = await stack.attachments.delete(credentials, {
            taskId,
            attachmentId,
        });
        expect(removed.ok).toBe(true);
    });

    it("previews project and label deletion impact", async () => {
        const project = await stack.projects.getDeleteImpactResult(
            credentials,
            {
                projectId: 1,
                inboxProjectId: 1,
            },
        );
        expect(project.ok).toBe(true);
        if (!project.ok) return;
        expect(project.data.complete).toBe(true);
        expect(project.data.project.title).toBe("Inbox");
        expect(project.data.isInboxProject).toBe(true);

        const label = await stack.labels.create(credentials, {
            draft: {
                title: `live impact ${suffix}`,
                descriptionMarkdown: "",
                color: null,
            },
        });
        expect(label.ok).toBe(true);
        if (!label.ok) return;
        const impact = await stack.labels.getDeleteImpactResult(credentials, {
            labelId: label.data.id,
        });
        expect(impact.ok).toBe(true);
        if (!impact.ok) return;
        expect(impact.data.complete).toBe(true);
        expect(impact.data.label.title).toBe(`live impact ${suffix}`);

        await stack.labels.delete(credentials, {
            labelId: label.data.id,
            expectedTitle: `live impact ${suffix}`,
        });
    });

    it("searches project members", async () => {
        const result = await stack.users.search(credentials, {
            projectId: 1,
            query: "test",
            page: 1,
            perPage: 10,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.items.map((u) => u.username)).toContain("testuser");
    });

    it("creates, reparents, and deletes a project", async () => {
        const parent = await stack.projects.create(credentials, {
            draft: {
                title: `live parent ${suffix}`,
                descriptionMarkdown: "",
                color: null,
                parentProjectId: null,
            },
        });
        expect(parent.ok).toBe(true);
        if (!parent.ok) return;
        expect(parent.data.parentProjectId).toBeNull();

        const child = await stack.projects.create(credentials, {
            draft: {
                title: `live child ${suffix}`,
                descriptionMarkdown: "",
                color: null,
                parentProjectId: parent.data.id,
            },
        });
        expect(child.ok).toBe(true);
        if (!child.ok) return;
        expect(child.data.parentProjectId).toBe(parent.data.id);

        const renamed = await stack.projects.patch(credentials, {
            projectId: child.data.id,
            draft: { title: `live child renamed ${suffix}` },
        });
        expect(renamed.ok).toBe(true);

        const deleted = await stack.projects.delete(credentials, {
            projectId: child.data.id,
            expectedTitle: `live child renamed ${suffix}`,
        });
        expect(deleted.ok).toBe(true);

        const parentDeleted = await stack.projects.delete(credentials, {
            projectId: parent.data.id,
            expectedTitle: `live parent ${suffix}`,
        });
        expect(parentDeleted.ok).toBe(true);
    });
});
