import { describe, expect, it } from "vitest";
import { TaskGateway } from "../../src/kernel/vikunja/TaskGateway.js";
import { ProjectGateway } from "../../src/kernel/vikunja/ProjectGateway.js";
import { LabelGateway } from "../../src/kernel/vikunja/LabelGateway.js";
import { UserGateway } from "../../src/kernel/vikunja/UserGateway.js";
import { AttachmentGateway } from "../../src/kernel/vikunja/AttachmentGateway.js";
import { VikunjaCredentials } from "../../src/shared/contracts.js";
import { AttachmentPreviewSize } from "../../src/shared/attachment.js";

class FakeClient {
    requests: Array<{
        method: string;
        path: string;
        options?: Record<string, unknown>;
    }> = [];
    responses: unknown[] = [];

    async requestJson(
        _credentials: VikunjaCredentials,
        method: string,
        path: string,
        options?: Record<string, unknown>,
    ) {
        this.requests.push({ method, path, options });
        return { status: 200, headers: {}, data: this.responses.shift() ?? {} };
    }

    async requestPage(
        _credentials: VikunjaCredentials,
        path: string,
        query: Record<string, unknown>,
        parseItem: (value: unknown) => unknown,
    ) {
        this.requests.push({ method: "GET", path, options: { query } });
        const response = this.responses.shift() ?? {
            items: [],
            total: 0,
            page: 1,
            per_page: 50,
        };
        const raw = response as {
            items: unknown[];
            total: number;
            page: number;
            per_page: number;
        };
        return {
            status: 200,
            headers: {},
            data: {
                items: raw.items.map(parseItem),
                total: raw.total,
                page: raw.page,
                perPage: raw.per_page,
            },
        };
    }

    async uploadFiles(
        _credentials: VikunjaCredentials,
        taskId: number,
        files: unknown[],
    ) {
        this.requests.push({
            method: "POST",
            path: `/tasks/${taskId}/attachments`,
            options: { files },
        });
        return {
            status: 200,
            headers: {},
            data: this.responses.shift() ?? { succeeded: [], failed: [] },
        };
    }

    async downloadFile(
        _credentials: VikunjaCredentials,
        taskId: number,
        attachmentId: number,
        previewSize?: AttachmentPreviewSize,
    ) {
        this.requests.push({
            method: "GET",
            path: `/tasks/${taskId}/attachments/${attachmentId}`,
            options: { previewSize },
        });
        return {
            status: 200,
            headers: { "content-type": ["text/plain"] },
            data: new Uint8Array([1]),
        };
    }
}

const credentials: VikunjaCredentials = {
    origin: "https://tasks.example",
    token: "secret",
};
const taskWire = {
    id: 12,
    title: "Task",
    project_id: 7,
    project: { id: 7, title: "Inbox" },
    done: false,
    labels: [],
    assignees: [],
    priority: 1,
    updated: "2026-09-13T00:00:00Z",
};

describe("Vikunja v2.5.0 resource gateways", () => {
    it("creates and removes a parent-child relation with the v2 contract", async () => {
        const client = new FakeClient();
        const gateway = new TaskGateway(client as never);

        await gateway.linkChild(credentials, 12, 33);
        await gateway.unlinkChild(credentials, 12, 33);

        expect(
            client.requests.map(({ method, path }) => `${method} ${path}`),
        ).toEqual([
            "POST /tasks/12/relations",
            "DELETE /tasks/12/relations/subtask/33",
        ]);
        expect(client.requests[0].options?.body).toEqual({
            kind: "json",
            value: { other_task_id: 33, relation_kind: "subtask" },
        });
    });

    it("searches tasks using the server-side paginated title query", async () => {
        const client = new FakeClient();
        client.responses.push({
            items: [taskWire],
            total: 1,
            page: 2,
            per_page: 10,
        });
        const gateway = new TaskGateway(client as never);
        const result = await gateway.search(credentials, {
            query: "needle",
            page: 2,
            perPage: 10,
        });

        expect(result.items[0].id).toBe(12);
        expect(client.requests[0]).toMatchObject({
            method: "GET",
            path: "/tasks",
            options: {
                query: { s: "needle", page: 2, per_page: 10, format: "markdown" },
            },
        });
    });

    it("queries all tasks with OR within resources and AND across resources", async () => {
        const client = new FakeClient();
        client.responses.push({
            items: [taskWire],
            total: 1,
            page: 1,
            per_page: 50,
        });
        const gateway = new TaskGateway(client as never);
        const result = await gateway.query(credentials, {
            view: "all",
            page: 1,
            perPage: 50,
            timeZone: "Asia/Shanghai",
            doneFilter: "open",
            projectIds: [2, 1, 2],
            labelIds: [4, 3, 4],
        });
        expect(result.data.items[0].id).toBe(12);
        expect(client.requests[0].path).toBe("/tasks");
        expect(
            (client.requests[0].options?.query as Record<string, unknown>)
                .filter_timezone,
        ).toBe("Asia/Shanghai");
        expect(
            (client.requests[0].options?.query as Record<string, unknown>)
                .sort_by,
        ).toEqual(["due_date", "priority"]);
        expect(
            (client.requests[0].options?.query as Record<string, unknown>)
                .filter,
        ).toBe("done = false && project_id in 1,2 && labels in 3,4");
    });

    it("omits completion and empty resource filters for all tasks", async () => {
        const client = new FakeClient();
        client.responses.push({
            items: [],
            total: 0,
            page: 1,
            per_page: 50,
        });
        const gateway = new TaskGateway(client as never);
        await gateway.query(credentials, {
            view: "all",
            page: 1,
            perPage: 50,
            timeZone: "UTC",
            doneFilter: "all",
            projectIds: [],
            labelIds: [],
        });
        expect(
            (client.requests[0].options?.query as Record<string, unknown>)
                .filter,
        ).toBeUndefined();
    });

    it("queries inbox through the project-scoped path", async () => {
        const client = new FakeClient();
        client.responses.push({
            items: [taskWire],
            total: 1,
            page: 1,
            per_page: 50,
        });
        const gateway = new TaskGateway(client as never);
        await gateway.query(credentials, {
            view: "inbox",
            inboxProjectId: 7,
            page: 1,
            perPage: 50,
            timeZone: "UTC",
            doneFilter: "open",
            projectIds: [],
            labelIds: [4],
        });
        expect(client.requests[0].path).toBe("/projects/7/tasks");
        expect(
            (client.requests[0].options?.query as Record<string, unknown>)
                .filter,
        ).toBe("done = false && labels in 4");
    });

    it("uses markdown detail/create and sends only scalar dirty fields", async () => {
        const client = new FakeClient();
        client.responses.push(taskWire, taskWire, taskWire);
        const gateway = new TaskGateway(client as never);
        await gateway.get(credentials, 12);
        await gateway.create(credentials, {
            title: "New",
            projectId: 7,
            labelIds: [],
            assigneeIds: [],
            startAt: null,
            dueAt: null,
            priority: 1,
            descriptionMarkdown: "# body",
            reminders: [],
            repeat: { kind: "none" },
        });
        await gateway.patchScalars(
            credentials,
            12,
            { title: "Changed", done: true },
            { etag: '"v1"' },
        );
        expect(client.requests[0].options?.query).toEqual({
            format: "markdown",
        });
        expect(client.requests[1].options?.query).toEqual({
            format: "markdown",
        });
        expect(client.requests[2].options?.body).toEqual({
            kind: "json",
            value: { title: "Changed", done: true },
        });
        expect(client.requests[2].options?.headers).toEqual({
            "If-Match": '"v1"',
        });
    });

    it("reconciles labels and assignees with deterministic nested calls", async () => {
        const client = new FakeClient();
        const gateway = new TaskGateway(client as never);
        await gateway.setLabels(credentials, 12, [1, 2], [2, 3]);
        await gateway.setAssignees(credentials, 12, [4], [5]);
        expect(
            client.requests.map(
                (request) => `${request.method} ${request.path}`,
            ),
        ).toEqual([
            "DELETE /tasks/12/labels/1",
            "POST /tasks/12/labels",
            "DELETE /tasks/12/assignees/4",
            "POST /tasks/12/assignees",
        ]);
        expect(client.requests[1].options?.body).toEqual({
            kind: "json",
            value: { label_id: 3 },
        });
        expect(client.requests[3].options?.body).toEqual({
            kind: "json",
            value: { user_id: 5 },
        });
    });

    it("issues a bare DELETE on the task resource", async () => {
        const client = new FakeClient();
        const gateway = new TaskGateway(client as never);
        await gateway.delete(credentials, 12);
        expect(client.requests[0]).toEqual({
            method: "DELETE",
            path: "/tasks/12",
            options: { responseMode: "empty" },
        });
    });

    it("covers project, label, user, and attachment endpoint shapes", async () => {
        const client = new FakeClient();
        client.responses.push({ items: [], total: 0, page: 1, per_page: 50 });
        const projects = new ProjectGateway(client as never);
        const labels = new LabelGateway(client as never);
        const users = new UserGateway(client as never);
        const attachments = new AttachmentGateway(client as never);
        await projects.list(credentials, { page: 1, perPage: 50 });
        await labels.list(credentials, { page: 1, perPage: 50 });
        await users.searchProjectMembers(credentials, 7, "al", 1, 20);
        await attachments.list(credentials, 12, 1, 50);
        expect(client.requests.map((request) => request.path)).toEqual([
            "/projects",
            "/labels",
            "/projects/7/users/search",
            "/tasks/12/attachments",
        ]);
    });
});
