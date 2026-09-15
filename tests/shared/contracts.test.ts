import { describe, expect, it } from "vitest";
import {
    DEFAULT_CONFIG,
    normalizePluginConfig,
    normalizeVikunjaOrigin,
} from "../../src/shared/config.js";
import { parsePage } from "../../src/shared/pagination.js";
import { publicError } from "../../src/shared/errors.js";

describe("shared contracts", () => {
    it("migrates a legacy v1 URL to a root Origin", () => {
        expect(
            normalizePluginConfig({
                vikunjaBaseUrl: " https://tasks.example/api/v1/// ",
                vikunjaTokenSecretName: " TOKEN ",
            }),
        ).toEqual({
            schemaVersion: 2,
            vikunjaOrigin: "https://tasks.example",
            vikunjaTokenSecretName: "TOKEN",
            inboxProjectId: null,
            snapshotEnabled: true,
        });
    });

    it("rejects non-root custom paths instead of guessing", () => {
        expect(() =>
            normalizePluginConfig({
                vikunjaBaseUrl: "https://tasks.example/custom/api",
            }),
        ).toThrow(/confirm the Vikunja instance origin/i);
        expect(() => normalizeVikunjaOrigin("file:///secret")).toThrow(/http/i);
    });

    it("uses v2 defaults for missing stored data", () => {
        expect(normalizePluginConfig(null)).toEqual(DEFAULT_CONFIG);
    });

    it("parses the v2 page envelope strictly", () => {
        expect(
            parsePage(
                { items: [{ id: 3 }], total: 1, page: 2, per_page: 50 },
                (item) => item as { id: number },
            ),
        ).toEqual({ items: [{ id: 3 }], total: 1, page: 2, perPage: 50 });
    });

    it("builds a discriminated public error without secret fields", () => {
        expect(
            publicError("UNAUTHORIZED", "Authentication failed", false),
        ).toEqual({
            code: "UNAUTHORIZED",
            message: "Authentication failed",
            retryable: false,
        });
    });
});
