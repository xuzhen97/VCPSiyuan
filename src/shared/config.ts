export interface PluginConfig {
    schemaVersion?: 2;
    vikunjaOrigin?: string;
    vikunjaTokenSecretName: string;
    /** Optional inline token for simple local setups. Never logged or persisted in config.json. */
    inlineToken?: string;
    inboxProjectId?: number | null;
    snapshotEnabled?: true;
    /** @deprecated Only retained while legacy frontend callers migrate. */
    vikunjaBaseUrl?: string;
}

export const DEFAULT_CONFIG: PluginConfig = {
    schemaVersion: 2,
    vikunjaOrigin: "",
    vikunjaTokenSecretName: "VIKUNJA_API_TOKEN",
    inboxProjectId: null,
    snapshotEnabled: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

export function normalizeVikunjaOrigin(value: string): string {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) {
        return "";
    }

    let parsed: URL;
    try {
        parsed = new URL(trimmed.replace(/\/+$/, ""));
    } catch {
        throw new Error("Confirm the Vikunja instance origin");
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Vikunja instance origin must use http or https");
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error("Confirm the Vikunja instance origin");
    }

    const path = parsed.pathname.replace(/\/+$/, "");
    if (path === "/api/v1" || path === "/api/v2") {
        parsed.pathname = "/";
    } else if (path !== "") {
        throw new Error("Confirm the Vikunja instance origin");
    }

    return parsed.origin;
}

function readSecretName(raw: Record<string, unknown>): string {
    const value =
        typeof raw.vikunjaTokenSecretName === "string"
            ? raw.vikunjaTokenSecretName.trim()
            : DEFAULT_CONFIG.vikunjaTokenSecretName;
    return value || DEFAULT_CONFIG.vikunjaTokenSecretName;
}

export function normalizePluginConfig(input: unknown): PluginConfig {
    if (!isRecord(input)) {
        return { ...DEFAULT_CONFIG };
    }

    const hasV2Origin = typeof input.vikunjaOrigin === "string";
    const legacyBaseUrl =
        typeof input.vikunjaBaseUrl === "string" ? input.vikunjaBaseUrl : "";
    const rawOrigin = hasV2Origin ? input.vikunjaOrigin : legacyBaseUrl;

    if (typeof rawOrigin !== "string") {
        return {
            ...DEFAULT_CONFIG,
            vikunjaTokenSecretName: readSecretName(input),
        };
    }

    const origin = normalizeVikunjaOrigin(rawOrigin);
    const rawInbox = input.inboxProjectId;
    const inboxProjectId =
        rawInbox === null || rawInbox === undefined
            ? null
            : typeof rawInbox === "number" &&
                Number.isSafeInteger(rawInbox) &&
                rawInbox > 0
              ? rawInbox
              : (() => {
                    throw new Error(
                        "Inbox project ID must be a positive safe integer",
                    );
                })();

    return {
        schemaVersion: 2,
        vikunjaOrigin: origin,
        vikunjaTokenSecretName: readSecretName(input),
        ...(typeof input.inlineToken === "string" && input.inlineToken
            ? { inlineToken: input.inlineToken }
            : {}),
        inboxProjectId,
        snapshotEnabled: true,
    };
}
