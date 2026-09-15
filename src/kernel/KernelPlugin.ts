import type * as kernel from "siyuan/kernel";
import { SiYuanHttpClient } from "./http/SiYuanHttpClient.js";
import { VikunjaCredentials } from "../shared/contracts.js";
import { registerVikunjaRpc } from "./rpc/registerVikunjaRpc.js";
import { ConnectionService } from "./services/ConnectionService.js";
import { TaskQueryService } from "./services/TaskQueryService.js";
import { TaskCommandService } from "./services/TaskCommandService.js";
import { ProjectService } from "./services/ProjectService.js";
import { LabelService } from "./services/LabelService.js";
import { UserService } from "./services/UserService.js";
import { AttachmentService } from "./services/AttachmentService.js";
import { TaskGateway } from "./vikunja/TaskGateway.js";
import { ProjectGateway } from "./vikunja/ProjectGateway.js";
import { LabelGateway } from "./vikunja/LabelGateway.js";
import { UserGateway } from "./vikunja/UserGateway.js";
import { AttachmentGateway } from "./vikunja/AttachmentGateway.js";
import { VikunjaV2Client } from "./vikunja/VikunjaV2Client.js";

declare const siyuan: kernel.ISiyuan;

export class KernelPlugin {
    private readonly siyuan: kernel.ISiyuan;
    private unregisterRpc?: () => Promise<void>;

    constructor(siyuanInstance: kernel.ISiyuan = siyuan) {
        this.siyuan = siyuanInstance;
        this.siyuan.plugin.lifecycle.onload = this.onload.bind(this);
        this.siyuan.plugin.lifecycle.onunload = this.onunload.bind(this);
    }

    private async onload(): Promise<void> {
        const { client, rpc, logger } = this.siyuan;
        const kernelFetch = (url: string, init: any) => {
            return (
                client.fetch as (target: string, options?: any) => Promise<any>
            )(url, init);
        };
        const httpClient = new SiYuanHttpClient(kernelFetch, {
            logger: (entry) => {
                logger.info(
                    `[HTTP] ${entry.method} ${entry.url} ${entry.status ?? ""}`.trim(),
                );
            },
        });
        const vikunjaClient = new VikunjaV2Client(httpClient);
        const taskGateway = new TaskGateway(vikunjaClient);
        const projectGateway = new ProjectGateway(vikunjaClient);
        const labelGateway = new LabelGateway(vikunjaClient);
        const userGateway = new UserGateway(vikunjaClient);
        const attachmentGateway = new AttachmentGateway(vikunjaClient);
        const connection = new ConnectionService(vikunjaClient, {
            taskPatch: true,
            projectPermissions: true,
        });
        const capabilityInfo = async (credentials: VikunjaCredentials) => {
            const response = await vikunjaClient.requestJson<
                Record<string, unknown>
            >(credentials, "GET", "/info");
            const version =
                typeof response.data.version === "string"
                    ? response.data.version
                    : undefined;
            return {
                writesAllowed: version === "v2.5.0",
                attachments: response.data.task_attachments_enabled === true,
            };
        };
        const tasks = new TaskQueryService(taskGateway);
        const commands = new TaskCommandService(taskGateway, {
            writesAllowed: async (credentials) =>
                (await capabilityInfo(credentials)).writesAllowed,
        });
        const projects = new ProjectService(projectGateway, taskGateway, {
            writesAllowed: async (credentials) =>
                (await capabilityInfo(credentials)).writesAllowed,
        });
        const labels = new LabelService(labelGateway, taskGateway, {
            writesAllowed: async (credentials) =>
                (await capabilityInfo(credentials)).writesAllowed,
        });
        const users = new UserService(userGateway);
        const attachments = new AttachmentService(attachmentGateway, {
            attachmentsEnabled: async (credentials) =>
                (await capabilityInfo(credentials)).attachments,
        });

        this.unregisterRpc = await registerVikunjaRpc(rpc, {
            connection,
            tasks,
            commands,
            projects,
            labels,
            users,
            attachments,
        });
        logger.info("VCPSiyuan kernel plugin loaded");
    }

    private async onunload(): Promise<void> {
        if (this.unregisterRpc) {
            await this.unregisterRpc();
            this.unregisterRpc = undefined;
        }
        this.siyuan.logger.info("VCPSiyuan kernel plugin unloaded");
    }
}
