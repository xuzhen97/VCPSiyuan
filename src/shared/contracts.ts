export type { PluginConfig } from "./config.js";
export type { PublicError, PublicErrorCode } from "./errors.js";
export type * from "./attachment.js";
export type * from "./label.js";
export type * from "./pagination.js";
export type * from "./project.js";
export type * from "./rpc.js";
export type * from "./task.js";

export interface VikunjaCredentials {
    /** v2 root Origin. */
    origin: string;
    token: string;
}

export { ConnectionInfo } from "./rpc.js";

export type RpcResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: import("./errors.js").PublicError };
