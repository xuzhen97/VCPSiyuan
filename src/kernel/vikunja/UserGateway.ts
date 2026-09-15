import { Page } from "../../shared/pagination.js";
import { UserRef } from "../../shared/task.js";
import { VikunjaCredentials } from "../../shared/contracts.js";
import { VikunjaV2Client } from "./VikunjaV2Client.js";
import { mapUser } from "./mappers/userMapper.js";

export class UserGateway {
    constructor(private readonly client: VikunjaV2Client) {}

    async current(credentials: VikunjaCredentials): Promise<{ data: UserRef }> {
        const response = await this.client.requestJson<unknown>(
            credentials,
            "GET",
            "/user",
        );
        return { data: mapUser(response.data) };
    }

    async searchProjectMembers(
        credentials: VikunjaCredentials,
        projectId: number,
        query: string,
        page: number,
        perPage: number,
    ): Promise<{ data: Page<UserRef> }> {
        if (!Number.isSafeInteger(projectId) || projectId <= 0)
            throw new Error("projectId must be a positive safe integer");
        const response = await this.client.requestPage(
            credentials,
            `/projects/${projectId}/users/search`,
            {
                page,
                per_page: perPage,
                q: query,
            },
            mapUser,
        );
        return { data: response.data };
    }
}
