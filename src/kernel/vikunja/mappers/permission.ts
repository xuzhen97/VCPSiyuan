import { Permission } from "../../../shared/task.js";

const STRING_PERMISSIONS: readonly Permission[] = [
   "read",
   "write",
   "admin",
   "owner",
   "unknown",
];

/**
 * Vikunja serialises `max_permission` as a number, not a name:
 * `0` = read, `1` = read/write, `2` = admin, `null`/`-1` = unknown.
 *
 * Accepting the numeric form is essential: treating it as a string silently
 * produced `"unknown"` for every resource, which defeated every permission gate
 * in the UI.
 */
export function decodePermission(value: unknown): Permission {
   if (typeof value === "number") {
      if (value === 0) return "read";
      if (value === 1) return "write";
      if (value === 2) return "admin";
      return "unknown";
   }
   if (typeof value === "string") {
      return STRING_PERMISSIONS.includes(value as Permission)
         ? (value as Permission)
         : "unknown";
   }
   return "unknown";
}
