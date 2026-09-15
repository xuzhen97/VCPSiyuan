import { Page } from "../../shared/pagination.js";
import { RpcResult, VikunjaCredentials } from "../../shared/contracts.js";
import { UserSearchRequest } from "../../shared/rpc.js";
import { UserRef } from "../../shared/task.js";
import { UserGateway } from "../vikunja/UserGateway.js";
import { toServiceError } from "./serviceError.js";

export class UserService {
    constructor(private readonly gateway: UserGateway) {}

    async current(
        credentials: VikunjaCredentials,
        _request: Record<string, never>, // eslint-disable-line @typescript-eslint/no-unused-vars
    ): Promise<RpcResult<UserRef>> {
        try {
            const result = await this.gateway.current(credentials);
            return { ok: true, data: result.data };
        } catch (error) {
            return {
                ok: false,
                error: toServiceError(error, "Current user lookup failed"),
            };
        }
    }

    async search(
        credentials: VikunjaCredentials,
        request: UserSearchRequest,
    ): Promise<RpcResult<Page<UserRef>>> {
        try {
            const result = await this.gateway.searchProjectMembers(
                credentials,
                request.projectId,
                request.query,
                request.page,
                request.perPage,
            );
            return { ok: true, data: result.data };
        } catch (error) {
            return {
                ok: false,
                error: toServiceError(error, "User search failed"),
            };
        }
    }
}
