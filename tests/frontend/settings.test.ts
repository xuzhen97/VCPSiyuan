// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createSettings } from "../../src/frontend/settings.js";

describe("createSettings", () => {
    it("creates v2 Origin settings and saves the migrated shape", () => {
        const onSave = vi.fn();
        const settings = createSettings({
            initialConfig: {
                schemaVersion: 2,
                vikunjaOrigin: "https://tasks.example",
                vikunjaTokenSecretName: "VIKUNJA_API_TOKEN",
                inboxProjectId: null,
                snapshotEnabled: true,
            },
            onSave,
            onTestConnection: vi.fn().mockResolvedValue({
                ok: true,
                data: {
                    connected: true,
                    serverVersion: "v2.5.0",
                    attachments: true,
                    maxFileSize: "20MB",
                    effectiveAttachmentLimitBytes: 20 * 1024 * 1024,
                },
            }),
            i18n: {
                baseUrlTitle: "Origin",
                baseUrlDesc: "Root Origin",
                tokenTitle: "Vikunja Token",
                tokenDesc: "Paste the token here",
                tokenPlaceholder: "Paste token",
                testConnectionTitle: "Test Connection",
                testConnectionDesc: "Verify connection",
                testBtn: "Test",
                testSuccess: "Connected",
                testFailed: "Failed",
                inboxProjectTitle: "Inbox project",
                inboxProjectDesc: "Choose Inbox",
                repairIndexTitle: "Repair links",
                repairIndexDesc: "Rebuild links",
                repairIndexBtn: "Repair",
                repairIndexSuccess: "Rebuilt",
                repairIndexFailed: "Repair failed",
                offlineSnapshotTitle: "Offline summaries",
                offlineSnapshotDesc: "Read-only summaries",
                baseUrlPlaceholder: "https://tasks.example.com",
                projectSearchPlaceholder: "Search projects",
                capabilityUnknown: "No capability",
                testing: "Testing",
                inboxProjectIdInvalid: "Invalid project ID",
                capabilitySummary:
                    "{version}; {apiVersion}; {attachments}; {limit}",
                apiVersionV2: "API v2",
                attachmentsEnabled: "attachments enabled",
                attachmentsDisabled: "attachments disabled",
                attachmentLimitUnavailable: "limit unavailable",
                effectiveAttachmentLimit: "limit {value}",
            },
        });
        expect(settings.items).toHaveLength(6);
        expect(settings.items.map((item) => item.title)).toEqual([
            "Origin",
            "Vikunja Token",
            "Inbox project",
            "Test Connection",
            "Offline summaries",
            "Repair links",
        ]);
        const tokenEditor = settings.items[1].createActionElement!();
        const tokenInput = tokenEditor.querySelector<HTMLInputElement>(
            "input[type='password']",
        )!;
        tokenInput.value = "tk_test_token";
        tokenEditor.querySelector<HTMLButtonElement>("button")!.click();
        expect(tokenInput.type).toBe("text");
        settings.confirm();
        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({
                vikunjaOrigin: "https://tasks.example",
                inlineToken: "tk_test_token",
            }),
        );
    });
});
