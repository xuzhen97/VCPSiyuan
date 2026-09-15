import {
    ConnectionInfo,
    RpcResult,
    TaskSummary,
    VikunjaCredentials,
} from "../../shared/contracts.js";
import { VikunjaGateway } from "./VikunjaGateway.js";
import { toServiceError } from "../services/serviceError.js";

export class VikunjaService {
    private readonly gateway: VikunjaGateway;

    constructor(gateway: VikunjaGateway) {
        this.gateway = gateway;
    }

    async testConnection(
        credentials: VikunjaCredentials,
    ): Promise<RpcResult<ConnectionInfo>> {
        try {
            const data = await this.gateway.testConnection(credentials);
            return {
                ok: true,
                data,
            };
        } catch (error) {
            return {
                ok: false,
                error: toServiceError(error, "Vikunja connection test failed"),
            };
        }
    }

    async listOpenTasks(
        credentials: VikunjaCredentials,
    ): Promise<RpcResult<TaskSummary[]>> {
        try {
            const data = await this.gateway.listOpenTasks(credentials);
            return {
                ok: true,
                data,
            };
        } catch (error) {
            return {
                ok: false,
                error: toServiceError(
                    error,
                    "Failed to load open tasks from Vikunja",
                ),
            };
        }
    }
}
