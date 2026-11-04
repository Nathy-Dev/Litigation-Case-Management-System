/**
 * HYPREP LCMS - canonical enumerations.
 *
 * This is the single source of truth for every closed value set in the domain.
 * It is imported by both halves of the stack:
 *
 *   - `convex/**`          - to build argument and schema validators
 *   - `src/types/index.ts` - to derive the TypeScript unions the UI uses
 *
 * The direction is deliberate and one-way: server -> client. Nothing in here may
 * import from `src/`, or a browser-only dependency (`import.meta.env`, `document`)
 * would be dragged into the Convex runtime.
 *
 * Adding a value here makes it valid at the database boundary *and* in the UI's
 * types at once, so the two can never drift.
 */
import { v } from 'convex/values';
import type { Validator } from 'convex/values';

/**
 * Builds a Convex validator from a readonly tuple of string literals.
 *
 * `v.union` requires at least two members, so a single-value set degrades to a
 * plain `v.literal` rather than throwing at module load.
 */
function literals<const T extends readonly [string, ...string[]]>(
  values: T,
): Validator<T[number]> {
  const members = values.map((value) => v.literal(value));
  if (members.length === 1) return members[0] as Validator<T[number]>;
  // The union's element validators are structurally the target type, but TS
  // cannot see through the variadic tuple, so the cast routes via `unknown`.
  return v.union(
    ...(members as unknown as [
      Validator<T[number]>,
      Validator<T[number]>,
      ...Validator<T[number]>[],
    ]),
  ) as unknown as Validator<T[number]>;
}

// ---------------------------------------------------------------------------
// Identity, roles & permissions
// ---------------------------------------------------------------------------

export const ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'LEGAL_STAFF',
  'CASE_OFFICER',
  'EXTERNAL_COUNSEL',
  'READ_ONLY',
] as const;

export const STAFF_TITLES = [
  'Director of Legal Services',
  'Head, Legal Unit',
  'Senior Lawyer',
  'Lawyer',
  'Paralegal',
  'Case Officer',
  'Legal Clerk',
  'Principal Partner',
  'Associate Counsel',
  'System Administrator',
  'Stakeholder',
] as const;

export const USER_STATUSES = ['active', 'disabled', 'locked', 'invited'] as const;

/** Fine-grained permission keys used by the role/permission editor (TOR section 19). */
export const PERMISSIONS = [
  'case.view.all',
  'case.view.assigned',
  'case.create',
  'case.edit',
  'case.delete',
  'case.status.change',
  'case.confidential.view',
  'case.archive',
  'document.view',
  'document.upload',
  'document.delete',
  'document.download',
  'document.version.manage',
  'courtdate.view',
  'courtdate.create',
  'courtdate.edit',
  'courtdate.outcome.record',
  'task.view',
  'task.create',
  'task.assign',
  'task.complete',
  'note.create',
  'report.view',
  'report.build',
  'report.export',
  'user.view',
  'user.manage',
  'role.manage',
  'config.manage',
  'audit.view',
  'audit.export',
  'system.manage',
  'retention.manage',
] as const;

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

export const CASE_STATUSES = [
  'Draft',
  'Filed',
  'Pending',
  'Adjourned',
  'Heard',
  'Judgment Delivered',
  'Concluded',
  'Closed',
  'Archived',
] as const;

export const CASE_PRIORITIES = ['Critical', 'High', 'Medium', 'Low'] as const;

export const PARTY_ROLES = [
  'Plaintiff',
  'Defendant',
  'Claimant',
  'Respondent',
  'Appellant',
  'Applicant',
  'Interested Party',
  'Nominal Party',
] as const;

export const PARTY_TYPES = ['Individual', 'Corporate', 'Government', 'Community'] as const;

export const CASE_LINK_TYPES = [
  'Appeal',
  'Consolidated',
  'Related Suit',
  'Cross Appeal',
  'Enforcement',
] as const;

/**
 * How a user is attached to a matter.
 *
 * Backs the `caseMembers` access index. `restricted` is not a working role - it
 * mirrors `CaseRecord.restrictedToUserIds`, which *narrows* visibility rather
 * than granting it, and is therefore evaluated before the others.
 */
export const CASE_MEMBER_KINDS = [
  'owner',
  'assignee',
  'counsel',
  'stakeholder',
  'restricted',
] as const;

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const DOCUMENT_FORMATS = ['pdf', 'docx', 'doc', 'jpg', 'png', 'xlsx', 'msg'] as const;

export const OCR_STATUSES = [
  'not_applicable',
  'queued',
  'processing',
  'completed',
  'failed',
] as const;

// ---------------------------------------------------------------------------
// Court dates / hearings
// ---------------------------------------------------------------------------

export const HEARING_PURPOSES = [
  'Mention',
  'Hearing',
  'Motion',
  'Adoption of Written Address',
  'Judgment',
  'Ruling',
  'Pre-Trial Conference',
  'Cross-Examination',
  'Report of Settlement',
] as const;

export const HEARING_OUTCOMES = [
  'Adjourned',
  'Heard',
  'Part-Heard',
  'Judgment Delivered',
  'Judgment Reserved',
  'Ruling Delivered',
  'Struck Out',
  'Settled',
  'Not Sat',
] as const;

// ---------------------------------------------------------------------------
// Tasks & workflow
// ---------------------------------------------------------------------------

export const TASK_STATUSES = [
  'Not Started',
  'In Progress',
  'Blocked',
  'Completed',
  'Cancelled',
] as const;

// ---------------------------------------------------------------------------
// Timeline, notifications, audit
// ---------------------------------------------------------------------------

export const TIMELINE_EVENT_TYPES = [
  'case.created',
  'case.updated',
  'case.status.changed',
  'case.archived',
  'document.uploaded',
  'document.version.added',
  'document.checked_out',
  'document.checked_in',
  'courtdate.created',
  'courtdate.updated',
  'courtdate.outcome.recorded',
  'task.created',
  'task.completed',
  'note.added',
  'counsel.assigned',
] as const;

export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'sms'] as const;

export const NOTIFICATION_TYPES = [
  'hearing.reminder',
  'case.assigned',
  'document.uploaded',
  'task.assigned',
  'task.overdue',
  'status.changed',
  'courtdate.changed',
  'digest',
  'system',
] as const;

export const NOTIFICATION_PRIORITIES = ['normal', 'high'] as const;

export const AUDIT_ENTITIES = [
  'Case',
  'Document',
  'CourtDate',
  'Task',
  'User',
  'Role',
  'Note',
  'Session',
  'Configuration',
  'Report',
  'Backup',
] as const;

export const AUDIT_OUTCOMES = ['success', 'failure'] as const;

/**
 * Audit actions a client may record directly.
 *
 * Read events (viewing a report, downloading a document) are genuinely
 * auditable but happen in queries, which cannot write. They therefore need a
 * client-callable mutation - and that mutation must not accept a free-text
 * action, or any signed-in user could forge arbitrary audit history. This is
 * the closed set it accepts.
 */
export const AUDIT_READ_ACTIONS = [
  'document.viewed',
  'document.downloaded',
  'report.viewed',
  'report.exported',
  'audit.exported',
  'case.viewed',
] as const;

// ---------------------------------------------------------------------------
// Configuration (TOR section 19 - admin-configurable reference data)
// ---------------------------------------------------------------------------

export const COURT_TIERS = [
  'Supreme Court',
  'Court of Appeal',
  'Federal High Court',
  'National Industrial Court',
  'State High Court',
  'Magistrate Court',
  'Customary Court',
  'Tribunal',
  'Arbitration Panel',
] as const;

export const CASE_TYPE_CATEGORIES = [
  'Civil',
  'Criminal',
  'Regulatory',
  'Employment',
  'Land',
  'Contract',
  'Environmental',
] as const;

export const DOCUMENT_GROUPS = [
  'Court Process',
  'Draft',
  'Evidence',
  'Correspondence',
  'Judgment',
  'Internal',
] as const;

export const DATE_FORMATS = ['dd/MM/yyyy', 'yyyy-MM-dd', 'dd MMM yyyy'] as const;
export const CURRENCIES = ['NGN'] as const;
export const DIGEST_FREQUENCIES = ['daily', 'weekly', 'off'] as const;
export const BACKUP_SCHEDULES = ['hourly', 'daily', 'weekly'] as const;
export const BACKUP_TYPES = ['Full', 'Incremental'] as const;
export const BACKUP_SCOPES = ['Database', 'Document Store', 'Both'] as const;
export const BACKUP_STATUSES = ['completed', 'running', 'failed'] as const;

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export const REPORT_IDS = [
  'caseload-by-status',
  'upcoming-hearings',
  'age-of-matters',
  'workload-by-lawyer',
  'concluded-matters',
  'document-inventory',
] as const;

export const SAVED_VIEW_ENTITIES = ['cases', 'documents', 'tasks'] as const;

// ---------------------------------------------------------------------------
// Derived TypeScript unions
// ---------------------------------------------------------------------------

export type Role = (typeof ROLES)[number];
export type StaffTitle = (typeof STAFF_TITLES)[number];
export type UserStatus = (typeof USER_STATUSES)[number];
export type Permission = (typeof PERMISSIONS)[number];
export type CaseStatus = (typeof CASE_STATUSES)[number];
export type CasePriority = (typeof CASE_PRIORITIES)[number];
export type PartyRole = (typeof PARTY_ROLES)[number];
export type PartyType = (typeof PARTY_TYPES)[number];
export type CaseLinkType = (typeof CASE_LINK_TYPES)[number];
export type CaseMemberKind = (typeof CASE_MEMBER_KINDS)[number];
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];
export type OcrStatus = (typeof OCR_STATUSES)[number];
export type HearingPurpose = (typeof HEARING_PURPOSES)[number];
export type HearingOutcome = (typeof HEARING_OUTCOMES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];
export type AuditReadAction = (typeof AUDIT_READ_ACTIONS)[number];
export type CourtTier = (typeof COURT_TIERS)[number];
export type CaseTypeCategory = (typeof CASE_TYPE_CATEGORIES)[number];
export type DocumentGroup = (typeof DOCUMENT_GROUPS)[number];
export type DateFormat = (typeof DATE_FORMATS)[number];
export type Currency = (typeof CURRENCIES)[number];
export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number];
export type BackupSchedule = (typeof BACKUP_SCHEDULES)[number];
export type BackupType = (typeof BACKUP_TYPES)[number];
export type BackupScope = (typeof BACKUP_SCOPES)[number];
export type BackupStatus = (typeof BACKUP_STATUSES)[number];
export type ReportId = (typeof REPORT_IDS)[number];
export type SavedViewEntity = (typeof SAVED_VIEW_ENTITIES)[number];

// ---------------------------------------------------------------------------
// Convex validators
// ---------------------------------------------------------------------------

export const roleValidator = literals(ROLES);
export const staffTitleValidator = literals(STAFF_TITLES);
export const userStatusValidator = literals(USER_STATUSES);
export const permissionValidator = literals(PERMISSIONS);
export const caseStatusValidator = literals(CASE_STATUSES);
export const casePriorityValidator = literals(CASE_PRIORITIES);
export const partyRoleValidator = literals(PARTY_ROLES);
export const partyTypeValidator = literals(PARTY_TYPES);
export const caseLinkTypeValidator = literals(CASE_LINK_TYPES);
export const caseMemberKindValidator = literals(CASE_MEMBER_KINDS);
export const documentFormatValidator = literals(DOCUMENT_FORMATS);
export const ocrStatusValidator = literals(OCR_STATUSES);
export const hearingPurposeValidator = literals(HEARING_PURPOSES);
export const hearingOutcomeValidator = literals(HEARING_OUTCOMES);
export const taskStatusValidator = literals(TASK_STATUSES);
export const timelineEventTypeValidator = literals(TIMELINE_EVENT_TYPES);
export const notificationChannelValidator = literals(NOTIFICATION_CHANNELS);
export const notificationTypeValidator = literals(NOTIFICATION_TYPES);
export const notificationPriorityValidator = literals(NOTIFICATION_PRIORITIES);
export const auditEntityValidator = literals(AUDIT_ENTITIES);
export const auditOutcomeValidator = literals(AUDIT_OUTCOMES);
export const auditReadActionValidator = literals(AUDIT_READ_ACTIONS);
export const courtTierValidator = literals(COURT_TIERS);
export const caseTypeCategoryValidator = literals(CASE_TYPE_CATEGORIES);
export const documentGroupValidator = literals(DOCUMENT_GROUPS);
export const dateFormatValidator = literals(DATE_FORMATS);
export const currencyValidator = literals(CURRENCIES);
export const digestFrequencyValidator = literals(DIGEST_FREQUENCIES);
export const backupScheduleValidator = literals(BACKUP_SCHEDULES);
export const backupTypeValidator = literals(BACKUP_TYPES);
export const backupScopeValidator = literals(BACKUP_SCOPES);
export const backupStatusValidator = literals(BACKUP_STATUSES);
export const reportIdValidator = literals(REPORT_IDS);
export const savedViewEntityValidator = literals(SAVED_VIEW_ENTITIES);

/**
 * Audit metadata is a free-form bag of scalars, matching `AuditLogEntry.metadata`.
 * Kept deliberately loose: it is written by ~30 call sites that each want to
 * record a couple of contextual values, and a closed shape would fight every one.
 */
export const auditMetadataValidator = v.record(
  v.string(),
  v.union(v.string(), v.number(), v.boolean()),
);

/**
 * Roles that see the whole register rather than only their own matters.
 *
 * Mirrors `ROLES_WITH_FULL_REGISTER` in the original client selector. Kept as a
 * role list (not a permission) because it answers a different question from
 * `case.view.all`: this is *scope*, that is *capability*.
 */
export const ROLES_WITH_FULL_REGISTER: readonly Role[] = [
  'SUPER_ADMIN',
  'ADMIN',
  'LEGAL_STAFF',
  'CASE_OFFICER',
];

/**
 * How a role is named to a human.
 *
 * Lives here rather than only in `src/lib/permissions.ts` because the invitation
 * email is composed on the server and "you have been added as EXTERNAL_COUNSEL"
 * is not a sentence to send a barrister. Shared file, one set of words, so the
 * email and the roster chip cannot disagree about what a role is called.
 */
export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  LEGAL_STAFF: 'Legal Unit Staff',
  CASE_OFFICER: 'Case Officer / Clerk',
  EXTERNAL_COUNSEL: 'External Counsel',
  READ_ONLY: 'Read-only Stakeholder',
};
