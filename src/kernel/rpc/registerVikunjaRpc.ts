import { RpcRequest, VikunjaRpcMethod } from "../../shared/rpc.js";
import { VikunjaCredentials, RpcResult } from "../../shared/contracts.js";
import { publicError } from "../../shared/errors.js";
import { ConnectionService } from "../services/ConnectionService.js";
import { TaskQueryService } from "../services/TaskQueryService.js";
import { TaskCommandService } from "../services/TaskCommandService.js";
import { ProjectService } from "../services/ProjectService.js";
import { LabelService } from "../services/LabelService.js";
import { UserService } from "../services/UserService.js";
import { AttachmentService } from "../services/AttachmentService.js";
import { TaskRelationService } from "../services/TaskRelationService.js";
import { toServiceError } from "../services/serviceError.js";

export interface IRpcBinder {
    bind(
        name: string,
        handler: (envelope: unknown) => Promise<unknown>,
        description?: string,
    ): Promise<void> | void;
    unbind(name: string): Promise<void> | void;
}

export interface VikunjaRpcServices {
    connection: ConnectionService;
    tasks: TaskQueryService;
    commands: TaskCommandService;
    projects: ProjectService;
    labels: LabelService;
    users: UserService;
    attachments: AttachmentService;
    relations: TaskRelationService;
}

interface AuthenticatedRpcEnvelope<K extends VikunjaRpcMethod> {
    credentials: VikunjaCredentials;
    request: RpcRequest<K>;
}

type Binding = {
    [K in VikunjaRpcMethod]: {
        name: K;
        handler: (envelope: unknown) => Promise<unknown>;
    };
}[VikunjaRpcMethod];

const RPC_DESCRIPTIONS: Partial<Record<VikunjaRpcMethod, string>> = {
    "vikunja.connection.test": "Tests the configured Vikunja v2.5.0 connection",
    "vikunja.tasks.query": "Queries one paginated Vikunja task view",
    "vikunja.tasks.search": "Searches paginated Vikunja tasks by title",
    "vikunja.tasks.linkChild": "Creates a Vikunja parent-child task relation",
    "vikunja.tasks.unlinkChild": "Removes a Vikunja parent-child task relation",
    "vikunja.tasks.get": "Loads one typed Vikunja task detail",
    "vikunja.tasks.create": "Creates one Vikunja task",
    "vikunja.tasks.patch": "Patches one Vikunja task",
    "vikunja.tasks.delete": "Deletes one Vikunja task",
    "vikunja.projects.deleteImpact":
        "Previews the complete project deletion impact",
    "vikunja.labels.deleteImpact": "Previews label usage in accessible tasks",
};

export async function registerVikunjaRpc(
    rpc: IRpcBinder,
    services: VikunjaRpcServices,
): Promise<() => Promise<void>> {
    const bindings: Binding[] = [
        bind("vikunja.connection.test", services, "connection", "test"),
        bind("vikunja.tasks.query", services, "tasks", "query"),
        bind("vikunja.tasks.search", services, "tasks", "search"),
        bind("vikunja.tasks.linkChild", services, "relations", "link"),
        bind("vikunja.tasks.unlinkChild", services, "relations", "unlink"),
        bind("vikunja.tasks.get", services, "commands", "get"),
        bind("vikunja.tasks.create", services, "commands", "create"),
        bind("vikunja.tasks.patch", services, "commands", "update"),
        bind("vikunja.tasks.delete", services, "commands", "delete"),
        bind("vikunja.projects.list", services, "projects", "list"),
        bind("vikunja.projects.create", services, "projects", "create"),
        bind("vikunja.projects.patch", services, "projects", "patch"),
        bind("vikunja.projects.delete", services, "projects", "delete"),
        bind(
            "vikunja.projects.deleteImpact",
            services,
            "projects",
            "getDeleteImpactResult",
        ),
        bind("vikunja.labels.list", services, "labels", "list"),
        bind("vikunja.labels.create", services, "labels", "create"),
        bind("vikunja.labels.patch", services, "labels", "patch"),
        bind("vikunja.labels.delete", services, "labels", "delete"),
        bind(
            "vikunja.labels.deleteImpact",
            services,
            "labels",
            "getDeleteImpactResult",
        ),
        bind("vikunja.users.current", services, "users", "current"),
        bind("vikunja.users.search", services, "users", "search"),
        bind("vikunja.attachments.list", services, "attachments", "list"),
        bind("vikunja.attachments.upload", services, "attachments", "upload"),
        bind(
            "vikunja.attachments.download",
            services,
            "attachments",
            "download",
        ),
        bind("vikunja.attachments.delete", services, "attachments", "delete"),
    ];

    for (const binding of bindings) {
        await rpc.bind(
            binding.name,
            binding.handler,
            RPC_DESCRIPTIONS[binding.name],
        );
    }

    let disposed = false;
    return async () => {
        if (disposed) return;
        disposed = true;
        for (const binding of bindings) await rpc.unbind(binding.name);
    };
}

function bind<K extends VikunjaRpcMethod>(
    name: K,
    services: VikunjaRpcServices,
    serviceName: keyof VikunjaRpcServices,
    methodName: string,
): Binding {
    return {
        name,
        handler: async (envelope: unknown) => {
            const value = validateEnvelope<K>(envelope);
            // SAFETY: bind() receives a service key and method name from the single typed
            // binding table above; every entry points to a service method with the shared
            // credentials/request signature used by the RPC envelope.
            const service = services[serviceName] as unknown as Record<
                string,
                (
                    credentials: VikunjaCredentials,
                    request: RpcRequest<K>,
                ) => Promise<unknown>
            >;
            const method = service[methodName];
            if (typeof method !== "function")
                return {
                    ok: false,
                    error: publicError(
                        "INTERNAL_ERROR",
                        `RPC service method ${methodName} is unavailable`,
                    ),
                };
            try {
                return await method.call(
                    service,
                    value.credentials,
                    value.request,
                );
            } catch (error) {
                return {
                    ok: false,
                    error: toServiceError(error, "Vikunja operation failed"),
                } satisfies RpcResult<unknown>;
            }
        },
    } as Binding;
}

function validateEnvelope<K extends VikunjaRpcMethod>(
    value: unknown,
): AuthenticatedRpcEnvelope<K> {
    if (typeof value !== "object" || value === null)
        throw new Error("RPC envelope must be an object");
    const raw = value as Record<string, unknown>;
    if (typeof raw.credentials !== "object" || raw.credentials === null)
        throw new Error("RPC credentials are required");
    const credentials = raw.credentials as Record<string, unknown>;
    if (typeof credentials.token !== "string" || !credentials.token)
        throw new Error("RPC token is required");
    if (typeof credentials.origin !== "string" || !credentials.origin)
        throw new Error("RPC origin is required");
    if (typeof raw.request !== "object" || raw.request === null)
        throw new Error("RPC request is required");
    return value as AuthenticatedRpcEnvelope<K>;
}
