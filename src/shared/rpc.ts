import {
    AttachmentMeta,
    AttachmentQuery,
    BinaryDownload,
    DeleteAttachmentRequest,
    DownloadRequest,
    UploadBatchResult,
    UploadFilePayload,
} from "./attachment.js";
import { Label, LabelDeleteImpact, LabelDraft, LabelQuery } from "./label.js";
import { Page } from "./pagination.js";
import {
    Project,
    ProjectDeleteImpact,
    ProjectDraft,
    ProjectQuery,
} from "./project.js";
import {
    TaskDetail,
    TaskDraft,
    TaskPatch,
    TaskQuery,
    TaskSearchQuery,
    TaskSummary,
    UserRef,
    Versioned,
} from "./task.js";

export interface RpcMethod<Request, Response> {
    request: Request;
    response: Response;
}

export interface ConnectionRequest {
    timeZone?: string;
}

export interface ServerCapabilities {
    apiVersion: "v2";
    serverVersion?: string;
    attachments: boolean;
    maxFileSize: string;
    effectiveAttachmentLimitBytes: number;
    taskPatch: boolean;
    projectPermissions: boolean;
    writesAllowed: boolean;
}

export interface ConnectionInfo {
    connected: true;
    version?: string;
    apiVersion?: "v2";
    serverVersion?: string;
    attachments?: boolean;
    maxFileSize?: string;
    effectiveAttachmentLimitBytes?: number;
    taskPatch?: boolean;
    projectPermissions?: boolean;
    writesAllowed?: boolean;
}

export interface GetTaskRequest {
    taskId: number;
}
export interface CreateTaskRequest {
    draft: TaskDraft;
}
export interface PatchTaskRequest {
    taskId: number;
    patch: TaskPatch;
    expected?: { etag?: string; updatedAt?: string };
    labels?: { before: number[]; after: number[] };
    assignees?: { before: number[]; after: number[] };
}
export interface TaskRelationRequest {
    parentTaskId: number;
    childTaskId: number;
}
export interface DeleteTaskRequest {
    taskId: number;
    expectedTitle: string;
}
export interface DeleteProjectRequest {
    projectId: number;
    expectedTitle: string;
}
export interface DeleteLabelRequest {
    labelId: number;
    expectedTitle: string;
}
export interface CreateProjectRequest {
    draft: ProjectDraft;
}
export interface PatchProjectRequest {
    projectId: number;
    draft: Partial<ProjectDraft>;
}
export interface CreateLabelRequest {
    draft: LabelDraft;
}
export interface PatchLabelRequest {
    labelId: number;
    draft: Partial<LabelDraft>;
}
export type CurrentUserRequest = Record<string, never>;
export interface UserSearchRequest {
    projectId: number;
    query: string;
    page: number;
    perPage: number;
}
export interface UploadRequest {
    taskId: number;
    files: UploadFilePayload[];
}

export interface VikunjaRpcMap {
    "vikunja.connection.test": RpcMethod<ConnectionRequest, ConnectionInfo>;
    "vikunja.tasks.query": RpcMethod<TaskQuery, Page<TaskSummary>>;
    "vikunja.tasks.search": RpcMethod<TaskSearchQuery, Page<TaskSummary>>;
    "vikunja.tasks.linkChild": RpcMethod<TaskRelationRequest, TaskDetail>;
    "vikunja.tasks.unlinkChild": RpcMethod<TaskRelationRequest, TaskDetail>;
    "vikunja.tasks.get": RpcMethod<GetTaskRequest, Versioned<TaskDetail>>;
    "vikunja.tasks.create": RpcMethod<CreateTaskRequest, TaskDetail>;
    "vikunja.tasks.patch": RpcMethod<PatchTaskRequest, TaskDetail>;
    "vikunja.tasks.delete": RpcMethod<DeleteTaskRequest, void>;
    "vikunja.projects.list": RpcMethod<ProjectQuery, Page<Project>>;
    "vikunja.projects.create": RpcMethod<CreateProjectRequest, Project>;
    "vikunja.projects.patch": RpcMethod<PatchProjectRequest, Project>;
    "vikunja.projects.delete": RpcMethod<DeleteProjectRequest, void>;
    "vikunja.labels.list": RpcMethod<LabelQuery, Page<Label>>;
    "vikunja.labels.create": RpcMethod<CreateLabelRequest, Label>;
    "vikunja.labels.patch": RpcMethod<PatchLabelRequest, Label>;
    "vikunja.labels.delete": RpcMethod<DeleteLabelRequest, void>;
    "vikunja.users.current": RpcMethod<CurrentUserRequest, UserRef>;
    "vikunja.users.search": RpcMethod<UserSearchRequest, Page<UserRef>>;
    "vikunja.attachments.list": RpcMethod<
        AttachmentQuery,
        Page<AttachmentMeta>
    >;
    "vikunja.attachments.upload": RpcMethod<UploadRequest, UploadBatchResult>;
    "vikunja.attachments.download": RpcMethod<DownloadRequest, BinaryDownload>;
    "vikunja.attachments.delete": RpcMethod<DeleteAttachmentRequest, void>;
    "vikunja.projects.deleteImpact": RpcMethod<
        { projectId: number; inboxProjectId?: number | null },
        ProjectDeleteImpact
    >;
    "vikunja.labels.deleteImpact": RpcMethod<
        { labelId: number },
        LabelDeleteImpact
    >;
}

export type VikunjaRpcMethod = keyof VikunjaRpcMap;
export type RpcRequest<K extends VikunjaRpcMethod> =
    VikunjaRpcMap[K]["request"];
export type RpcResponse<K extends VikunjaRpcMethod> =
    VikunjaRpcMap[K]["response"];
