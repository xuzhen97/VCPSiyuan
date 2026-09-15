import { ProjectDeleteImpact } from "../../shared/project.js";
import { LabelDeleteImpact } from "../../shared/label.js";
import { RpcResult } from "../../shared/contracts.js";
import { PublicError, publicError } from "../../shared/errors.js";

export interface ManagementStoreOptions {
    deleteResource: (
        kind: "project" | "label",
        id: number,
        expectedTitle?: string,
    ) => Promise<RpcResult<void>>;
}

export interface ManagementDeleteState {
    impact?: ProjectDeleteImpact;
    labelImpact?: LabelDeleteImpact;
    status: "idle" | "ready" | "deleting" | "error" | "repair-required";
    error?: PublicError;
}

export type DeleteResult =
    | { ok: true; inboxRepairRequired: boolean }
    | { ok: false; error: PublicError };

export class ManagementStore {
    private readonly deleteResource: ManagementStoreOptions["deleteResource"];
    private state: ManagementDeleteState = { status: "idle" };

    constructor(options: ManagementStoreOptions) {
        this.deleteResource = options.deleteResource;
    }

    setImpact(impact: ProjectDeleteImpact): void {
        this.state = { impact, status: "ready", error: undefined };
    }

    setLabelImpact(impact: LabelDeleteImpact): void {
        this.state = {
            ...this.state,
            impact: undefined,
            labelImpact: impact,
            status: "ready",
            error: undefined,
        };
    }

    getState(): ManagementDeleteState {
        return {
            ...this.state,
            labelImpact: this.state.labelImpact
                ? {
                      ...this.state.labelImpact,
                      label: { ...this.state.labelImpact.label },
                  }
                : undefined,
            impact: this.state.impact
                ? {
                      ...this.state.impact,
                      descendantProjects: [
                          ...this.state.impact.descendantProjects,
                      ],
                  }
                : undefined,
        };
    }

    async deleteProject(
        projectId: number,
        confirmationTitle: string,
    ): Promise<DeleteResult> {
        const impact = this.state.impact;
        if (!impact || impact.project.id !== projectId || !impact.complete) {
            const error = publicError(
                "VALIDATION_ERROR",
                "A complete deletion impact preview is required",
                false,
                "review",
            );
            this.state = { ...this.state, status: "error", error };
            return { ok: false, error };
        }
        if (confirmationTitle !== impact.project.title) {
            const error = publicError(
                "VALIDATION_ERROR",
                "Enter the exact project title to confirm deletion",
                false,
                "review",
            );
            this.state = { ...this.state, status: "error", error };
            return { ok: false, error };
        }

        this.state = { ...this.state, status: "deleting", error: undefined };
        const result = await this.deleteResource(
            "project",
            projectId,
            impact.project.title,
        );
        if (!result.ok) {
            this.state = {
                ...this.state,
                status: "error",
                error: result.error,
            };
            return { ok: false, error: result.error };
        }
        const inboxRepairRequired = impact.isInboxProject;
        this.state = {
            ...this.state,
            status: inboxRepairRequired ? "repair-required" : "idle",
            impact: undefined,
        };
        return { ok: true, inboxRepairRequired };
    }

    async deleteLabel(
        labelId: number,
        confirmationTitle: string,
    ): Promise<{ ok: true } | { ok: false; error: PublicError }> {
        const impact = this.state.labelImpact;
        if (!impact || impact.label.id !== labelId || !impact.complete) {
            const error = publicError(
                "VALIDATION_ERROR",
                "A complete deletion impact preview is required",
                false,
                "review",
            );
            this.state = { ...this.state, status: "error", error };
            return { ok: false, error };
        }
        if (confirmationTitle !== impact.label.title) {
            const error = publicError(
                "VALIDATION_ERROR",
                "Enter the exact label title to confirm deletion",
                false,
                "review",
            );
            this.state = { ...this.state, status: "error", error };
            return { ok: false, error };
        }
        this.state = { ...this.state, status: "deleting", error: undefined };
        const result = await this.deleteResource(
            "label",
            labelId,
            impact.label.title,
        );
        if (!result.ok) {
            this.state = {
                ...this.state,
                status: "error",
                error: result.error,
            };
            return { ok: false, error: result.error };
        }
        this.state = { ...this.state, status: "idle", labelImpact: undefined };
        return { ok: true };
    }
}
