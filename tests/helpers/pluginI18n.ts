import type { VikunjaDockI18n } from "../../src/frontend/dock/VikunjaDock.js";
import type { TaskDetailViewI18n } from "../../src/frontend/dock/TaskDetailView.js";
import type { AttachmentListI18n } from "../../src/frontend/dialogs/AttachmentList.js";
import type { LabelManagerDialogI18n } from "../../src/frontend/dialogs/LabelManagerDialog.js";
import type { ProjectManagerDialogI18n } from "../../src/frontend/dialogs/ProjectManagerDialog.js";
import type { TaskDialogI18n } from "../../src/frontend/dialogs/TaskDialog.js";
import type { BlockMenuLabels } from "../../src/frontend/context/blockMenu.js";
import type { BlockMenuWorkflowI18n } from "../../src/frontend/context/blockMenuActions.js";
import en from "../../i18n/en.json" with { type: "json" };

/**
 * Component i18n fixtures built from the real English locale file.
 *
 * Using the shipped locale instead of hand-written literals means a missing or
 * renamed key fails here instead of silently rendering an English default in
 * production.
 */
const locale = en as Record<string, string>;

/**
 * The SiYuan-injected `plugin.i18n` bundle. SiYuan loads exactly this file into
 * `Plugin.i18n`, so passing it into a constructed plugin exercises the same keys
 * production reads.
 */
export const siyuanI18n: Record<string, string> = locale;

function t(key: string): string {
 const value = locale[key];
 if (typeof value !== "string" || value.length === 0)
  throw new Error(`Missing i18n key: ${key}`);
 return value;
}

function fill(
 template: string,
 values: Record<string, string | number>,
): string {
 return template.replace(
  /\{(\w+)\}/g,
  (_, key: string) => `${values[key] ?? ""}`,
 );
}

export const dockI18n: VikunjaDockI18n = {
 dockTitle: t("dockTitle"),
 refresh: t("refresh"),
 openSettings: t("openSettings"),
 loading: t("loading"),
 empty: t("empty"),
 unconfigured: t("unconfigured"),
 offline: t("offline"),
 loadError: t("loadError"),
 inbox: t("inbox"),
 allTasks: t("allTasks"),
 projectsAndLabels: t("projectsAndLabels"),
 incomplete: t("incomplete"),
 projects: t("projects"),
 labels: t("labels"),
 inboxNotConfigured: t("inboxNotConfigured"),
 resourcesLoading: t("resourcesLoading"),
 resourcesError: t("resourcesError"),
 retry: t("retry"),
 newTask: t("newTask"),
 loadMore: t("loadMore"),
 refreshing: t("refreshing"),
 connectionOnline: t("connectionOnline"),
 connectionOffline: t("connectionOffline"),
 shownCount: (shown, total) => fill(t("shownCount"), { shown, total }),
 timeZoneLabel: (timeZone) => fill(t("timeZoneLabel"), { value: timeZone }),
 snapshotAt: (value) => fill(t("snapshotAt"), { value }),
 complete: t("complete"),
 reopen: t("reopen"),
 openTask: t("openTask"),
 formatDate: (value) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
   new Date(value),
  ),
 labelsSummary: (labels) =>
  fill(t("labelsSummary"), { value: labels.join(", ") }),
 assigneesSummary: (assignees) =>
  fill(t("assigneesSummary"), { value: assignees.join(", ") }),
 attachmentCount: (count) => fill(t("attachmentCount"), { count }),
 blockCount: (count) => fill(t("blockCount"), { count }),
 projectPrefix: t("projectPrefix"),
 priorityLabel: (priority) => fill(t("priorityLabel"), { value: priority }),
};

export const taskDialogI18n: TaskDialogI18n = {
 titleLabel: t("taskTitleLabel"),
 descriptionLabel: t("taskDescriptionLabel"),
 projectLabel: t("taskProjectLabel"),
 startDateLabel: t("taskStartDateLabel"),
 dueDateLabel: t("taskDueDateLabel"),
 priorityLabel: t("taskPriorityLabel"),
 labelsLabel: t("taskLabelsLabel"),
 assigneesLabel: t("taskAssigneesLabel"),
 assigneeUnavailable: t("assigneeUnavailable"),
 assigneeSearchPlaceholder: t("assigneeSearchPlaceholder"),
 reminderLabel: t("taskReminderLabel"),
 addReminder: t("addReminder"),
 removeReminder: t("removeReminder"),
 repeatLabel: t("taskRepeatLabel"),
 repeatNone: t("repeatNone"),
 repeatEvery: t("repeatEvery"),
 repeatDay: t("repeatDay"),
 repeatWeek: t("repeatWeek"),
 repeatMonth: t("repeatMonth"),
 preservedRepeat: t("preservedRepeat"),
 blockLinkLabel: t("blockLinkLabel"),
 blockLinkLocked: t("blockLinkLocked"),
 blockLinkedCount: (count) => fill(t("blockLinkedCount"), { count }),
 projectRequired: t("projectRequired"),
 projectNotWritable: t("projectNotWritable"),
 conflict: t("conflict"),
 reload: t("reload"),
 review: t("review"),
 cancel: t("cancel"),
 save: t("save"),
 titleRequired: t("titleRequired"),
 saveFailed: t("saveFailed"),
 attachments: t("attachments"),
 uploadAttachment: t("uploadAttachment"),
 attachmentLimit: (value) => fill(t("attachmentLimitLabel"), { value }),
 attachmentsDisabled: t("attachmentDisabled"),
 noAttachments: t("noAttachments"),
 attachmentList: {
  retry: t("retry"),
  preview: t("attachmentPreview"),
  download: t("attachmentDownload"),
  delete: t("delete"),
  statusLabel: (state) => {
   if (state === "queued") return t("attachmentStateQueued");
   if (state === "uploading") return t("attachmentStateUploading");
   if (state === "succeeded") return t("attachmentStateSucceeded");
   return t("attachmentStateFailed");
  },
 },
};

export const taskDetailViewI18n: TaskDetailViewI18n = {
 back: t("back"),
 reopen: t("reopen"),
 complete: t("complete"),
 edit: t("edit"),
 projectPrefix: t("projectPrefix"),
 projectUnknown: t("projectUnknown"),
 status: t("status"),
 priority: t("priority"),
 startDate: t("startDate"),
 dueDate: t("dueDate"),
 labels: t("labels"),
 assignees: t("assignees"),
 reminders: t("reminders"),
 repeat: t("repeat"),
 description: t("description"),
 attachments: t("attachments"),
 blocks: t("blocks"),
 noAttachments: t("noAttachments"),
 uploadAttachment: t("uploadAttachment"),
 attachmentsDisabled: t("attachmentDisabled"),
 attachmentLimit: (value) => fill(t("attachmentLimitLabel"), { value }),
 retry: t("retry"),
 loadError: t("loadError"),
 retryLoad: t("retryLoad"),
 blockOpen: t("blockOpen"),
 blockUnknown: t("blockUnknown"),
 blockCount: (count) => fill(t("blockCount"), { count }),
 permissionReadOnly: t("permissionReadOnly"),
 repeatNone: t("repeatNone"),
 repeatEvery: (every, unit) => fill(t("repeatEverySummary"), { every, unit }),
 preservedRepeat: (summary) =>
  fill(t("preservedRepeatSummary"), { value: summary }),
 attachmentList: {
  retry: t("retry"),
  preview: t("attachmentPreview"),
  download: t("attachmentDownload"),
  delete: t("delete"),
  statusLabel: (state) => {
   if (state === "queued") return t("attachmentStateQueued");
   if (state === "uploading") return t("attachmentStateUploading");
   if (state === "succeeded") return t("attachmentStateSucceeded");
   return t("attachmentStateFailed");
  },
 },
 formatDate: (value) =>
  new Intl.DateTimeFormat("en-US", {
   dateStyle: "medium",
   timeStyle: "short",
  }).format(new Date(value)),
};

export const attachmentListI18n: AttachmentListI18n = {
 retry: t("retry"),
 preview: t("attachmentPreview"),
 download: t("attachmentDownload"),
 delete: t("delete"),
 statusLabel: (state) => {
  if (state === "queued") return t("attachmentStateQueued");
  if (state === "uploading") return t("attachmentStateUploading");
  if (state === "succeeded") return t("attachmentStateSucceeded");
  return t("attachmentStateFailed");
 },
};

export const projectManagerDialogI18n: ProjectManagerDialogI18n = {
 title: t("projectManagerTitle"),
 impact: (open, completed, descendants) =>
  fill(t("projectImpact"), { open, completed, descendants }),
 impactIncomplete: t("impactIncomplete"),
 confirmLabel: t("confirmProjectTitle"),
 delete: t("delete"),
 cancel: t("cancel"),
 close: t("close"),
 save: t("save"),
 search: t("projectSearchPlaceholder"),
 create: t("projectCreate"),
 edit: t("projectEdit"),
 empty: t("projectEmpty"),
 noMatches: t("noMatches"),
 titleLabel: t("projectTitleLabel"),
 descriptionLabel: t("projectDescriptionLabel"),
 colorLabel: t("projectColorLabel"),
 parentLabel: t("projectParentLabel"),
 archivedLabel: t("projectArchivedLabel"),
 projectPath: (path) => path,
};

export const labelManagerDialogI18n: LabelManagerDialogI18n = {
 title: t("labelManagerTitle"),
 usage: (count) => fill(t("labelUsage"), { count }),
 impactIncomplete: t("impactIncomplete"),
 confirmPlaceholder: t("confirmTitle"),
 delete: t("delete"),
 cancel: t("cancel"),
 close: t("close"),
 save: t("save"),
 search: t("labelSearchPlaceholder"),
 create: t("labelCreate"),
 edit: t("labelEdit"),
 empty: t("labelEmpty"),
 noMatches: t("noMatches"),
 titleLabel: t("labelTitleLabel"),
 descriptionLabel: t("labelDescriptionLabel"),
 colorLabel: t("labelColorLabel"),
};

export const blockMenuLabels: BlockMenuLabels = {
 create: t("blockCreate"),
 link: t("blockLink"),
 view: t("blockView"),
 unlink: t("blockUnlink"),
 selectionCount: (count) => fill(t("blockSelectionCount"), { count }),
};

export const blockMenuWorkflowI18n: BlockMenuWorkflowI18n = {
 missingInboxProject: t("missingInboxProject"),
 blocksUnreadable: t("blocksUnreadable"),
 blockActionFailed: t("blockActionFailed"),
};
