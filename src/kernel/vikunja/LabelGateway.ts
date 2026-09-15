import {
    Label,
    LabelDeleteImpact,
    LabelDraft,
    LabelQuery,
} from "../../shared/label.js";
import { Page } from "../../shared/pagination.js";
import { VikunjaCredentials } from "../../shared/contracts.js";
import { VikunjaV2Client } from "./VikunjaV2Client.js";
import { mapLabel } from "./mappers/labelMapper.js";

export class LabelGateway {
    constructor(private readonly client: VikunjaV2Client) {}

    async list(
        credentials: VikunjaCredentials,
        query: LabelQuery,
    ): Promise<{ data: Page<Label> }> {
        const response = await this.client.requestPage(
            credentials,
            "/labels",
            {
                page: query.page,
                per_page: query.perPage,
                ...(query.search ? { s: query.search } : {}),
            },
            mapLabel,
        );
        return { data: response.data };
    }

    async create(
        credentials: VikunjaCredentials,
        draft: LabelDraft,
    ): Promise<Label> {
        const response = await this.client.requestJson<unknown>(
            credentials,
            "POST",
            "/labels",
            {
                body: { kind: "json", value: labelToWire(draft) },
            },
        );
        return mapLabel(response.data);
    }

    async patch(
        credentials: VikunjaCredentials,
        labelId: number,
        draft: Partial<LabelDraft>,
    ): Promise<Label> {
        const response = await this.client.requestJson<unknown>(
            credentials,
            "PATCH",
            `/labels/${assertId(labelId)}`,
            {
                body: { kind: "json", value: labelToWire(draft) },
            },
        );
        return mapLabel(response.data);
    }

    async delete(
        credentials: VikunjaCredentials,
        labelId: number,
    ): Promise<void> {
        await this.client.requestJson<void>(
            credentials,
            "DELETE",
            `/labels/${assertId(labelId)}`,
            { responseMode: "empty" },
        );
    }

    async get(
        credentials: VikunjaCredentials,
        labelId: number,
    ): Promise<Label> {
        const response = await this.client.requestJson<unknown>(
            credentials,
            "GET",
            `/labels/${assertId(labelId)}`,
            { query: { format: "markdown" } },
        );
        return mapLabel(response.data);
    }

    async getDeleteImpact(
        credentials: VikunjaCredentials,
        labelId: number,
        impact: LabelDeleteImpact,
    ): Promise<LabelDeleteImpact> {
        const label = await this.get(credentials, labelId);
        return { ...impact, label: { id: label.id, title: label.title } };
    }
}

function assertId(value: number): number {
    if (!Number.isSafeInteger(value) || value <= 0)
        throw new Error("labelId must be a positive safe integer");
    return value;
}

function labelToWire(draft: Partial<LabelDraft>): Record<string, unknown> {
    const value: Record<string, unknown> = {};
    if (draft.title !== undefined) value.title = draft.title;
    if (draft.descriptionMarkdown !== undefined)
        value.description = draft.descriptionMarkdown;
    if (draft.color !== undefined) value.hex_color = draft.color;
    return value;
}
