import { normalizePluginConfig, PluginConfig } from "../../shared/config.js";
import { PublicError, publicError } from "../../shared/errors.js";
import { RpcRequest, RpcResponse, VikunjaRpcMethod } from "../../shared/rpc.js";
import {
    ConnectionInfo,
    RpcResult,
    VikunjaCredentials,
} from "../../shared/contracts.js";

export interface AuthenticatedRpcEnvelope<K extends VikunjaRpcMethod> {
    credentials: VikunjaCredentials;
    request: RpcRequest<K>;
}

export interface VikunjaControllerOptions {
    getConfig: () => PluginConfig;
    getSecret: (name: string) => string;
    call: <K extends VikunjaRpcMethod>(
        method: K,
        envelope: AuthenticatedRpcEnvelope<K>,
    ) => Promise<RpcResult<RpcResponse<K>>>;
}

export class VikunjaController {
    private readonly getConfig: () => PluginConfig;
    private readonly getSecret: (name: string) => string;
    private readonly callRpc: VikunjaControllerOptions["call"];

    constructor(options: VikunjaControllerOptions) {
        this.getConfig = options.getConfig;
        this.getSecret = options.getSecret;
        this.callRpc = options.call;
    }

    async testConnection(): Promise<RpcResult<ConnectionInfo>> {
        return this.call("vikunja.connection.test", {});
    }

    async call<K extends VikunjaRpcMethod>(
        method: K,
        request: RpcRequest<K>,
    ): Promise<RpcResult<RpcResponse<K>>> {
        const credentialsOrError = this.resolveCredentials();
        if (!credentialsOrError.ok) return credentialsOrError;
        return this.callRpc(method, {
            credentials: credentialsOrError.credentials,
            request,
        });
    }

    private resolveCredentials():
        | { ok: true; credentials: VikunjaCredentials }
        | { ok: false; error: PublicError } {
        let config: PluginConfig;
        try {
            config = normalizePluginConfig(this.getConfig());
        } catch (error) {
            return {
                ok: false,
                error: publicError(
                    "CONFIG_INVALID",
                    error instanceof Error
                        ? error.message
                        : "Vikunja instance origin is invalid",
                ),
            };
        }

        const origin = config.vikunjaOrigin?.trim() ?? "";
        if (!origin) {
            return {
                ok: false,
                error: publicError(
                    "CONFIG_INVALID",
                    "Vikunja instance origin is not configured",
                ),
            };
        }

        const secretName = config.vikunjaTokenSecretName.trim();
        if (!secretName) {
            return {
                ok: false,
                error: publicError(
                    "CONFIG_INVALID",
                    "Vikunja Token Secret Name is not configured",
                ),
            };
        }

        const token = (config.inlineToken ?? this.getSecret(secretName)).trim();
        if (!token) {
            return {
                ok: false,
                error: publicError(
                    "SECRET_NOT_FOUND",
                    `Secret '${secretName}' not found in SiYuan secrets repository`,
                ),
            };
        }

        return { ok: true, credentials: { origin, token } };
    }
}
