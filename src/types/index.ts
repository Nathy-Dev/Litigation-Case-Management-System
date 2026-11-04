/**
 * HYPREP LCMS — Domain model
 *
 * Mirrors the entities in the Terms of Reference §30/§31 so the eventual REST
 * backend can be generated from (or validated against) these shapes.
 */

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
export type Role = (typeof ROLES)[number];

/** Job titles within the Legal Unit — narrower than Role, used for display. */
export type StaffTitle =
  | 'Director of Legal Services'
  | 'Head, Legal Unit'
  | 'Senior Lawyer'
  | 'Lawyer'
  | 'Paralegal'
  | 'Case Officer'
  | 'Legal Clerk'
  | 'Principal Partner'
  | 'Associate Counsel'
  | 'System Administrator'
  | 'Stakeholder';

export type UserStatus = 'active' | 'disabled' | 'locked' | 'invited';

export interface User {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  title: StaffTitle;
  role: Role;
  department: string;
  teamId: string | null;
  /** Nigerian Bar Association enrolment / practising licence number. */
  practisingLicenceNo: string | null;
  /** External counsel are attached to a chamber or firm. */
  firm: string | null;
  avatarColor: string;
  initials: string;
  status: UserStatus;
  mfaEnabled: boolean;
  failedLoginAttempts: number;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Team {
  id: string;
  name: string;
  description: string;
  leadUserId: string;
  memberIds: string[];
}

/** Fine-grained permission keys used by the role/permission editor (§19). */
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
export type Permission = (typeof PERMISSIONS)[number];

export type PermissionMatrix = Record<Role, Permission[]>;

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
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_PRIORITIES = ['Critical', 'High', 'Medium', 'Low'] as const;
export type CasePriority = (typeof CASE_PRIORITIES)[number];

export type PartyRole =
  | 'Plaintiff'
  | 'Defendant'
  | 'Claimant'
  | 'Respondent'
  | 'Appellant'
  | 'Applicant'
  | 'Interested Party'
  | 'Nominal Party';

export interface Party {
  id: string;
  name: string;
  role: PartyRole;
  type: 'Individual' | 'Corporate' | 'Government' | 'Community';
  email: string | null;
  phone: string | null;
  address: string | null;
  representedBy: string | null;
}

export type CaseLinkType =
  | 'Appeal'
  | 'Consolidated'
  | 'Related Suit'
  | 'Cross Appeal'
  | 'Enforcement';

export interface RelatedCaseLink {
  caseId: string;
  linkType: CaseLinkType;
  note: string;
}

export interface CaseRecord {
  id: string;
  /** System-generated, unique, human-readable. e.g. HYP/LCMS/2026/0042 */
  caseId: string;
  /** Optional manual reference kept by the Legal Unit. */
  caseReference: string | null;
  title: string;
  /** Suit number as filed at the registry. e.g. FHC/PH/CS/119/2026 */
  suitNumber: string | null;
  courtId: string;
  caseTypeId: string;
  status: CaseStatus;
  priority: CasePriority;
  filingDate: string | null;
  /** Monetary value or claim sum in Naira, when applicable. */
  claimValue: number | null;
  matterOwnerId: string;
  assigneeIds: string[];
  externalCounselIds: string[];
  /**
   * Oversight stakeholders granted view-only access to this matter. They do not
   * work the file, so they are held apart from `assigneeIds` — the distinction
   * is what lets a read-only account see selected matters and nothing else.
   */
  stakeholderIds: string[];
  teamId: string | null;
  parties: Party[];
  relatedCases: RelatedCaseLink[];
  tags: string[];
  confidential: boolean;
  /** Restricted cases are visible only to explicitly listed users. */
  restrictedToUserIds: string[];
  summary: string;
  reliefSought: string;
  presidingJudge: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface CaseStatusChange {
  id: string;
  caseId: string;
  from: CaseStatus | null;
  to: CaseStatus;
  reason: string;
  byUserId: string;
  at: string;
}

export interface CaseTemplate {
  id: string;
  name: string;
  description: string;
  caseTypeId: string;
  defaultCourtId: string | null;
  defaultPriority: CasePriority;
  defaultTags: string[];
  checklist: string[];
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export type DocumentFormat = 'pdf' | 'docx' | 'doc' | 'jpg' | 'png' | 'xlsx' | 'msg';

export interface DocumentVersion {
  version: number;
  uploadedById: string;
  uploadedAt: string;
  sizeBytes: number;
  changeNote: string;
  /** Simulated storage key — the backend will return a signed URL. */
  storageKey: string;
}

export interface CaseDocument {
  id: string;
  caseId: string;
  name: string;
  documentTypeId: string;
  format: DocumentFormat;
  currentVersion: number;
  versions: DocumentVersion[];
  authorId: string;
  confidential: boolean;
  tags: string[];
  description: string;
  /** Text extracted by OCR (§10, optional capability) — powers full-text search. */
  ocrText: string | null;
  ocrStatus: 'not_applicable' | 'queued' | 'processing' | 'completed' | 'failed';
  /** Check-out lock for collaborative editing (§10). */
  checkedOutById: string | null;
  checkedOutAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Court dates / hearings
// ---------------------------------------------------------------------------

export type HearingPurpose =
  | 'Mention'
  | 'Hearing'
  | 'Motion'
  | 'Adoption of Written Address'
  | 'Judgment'
  | 'Ruling'
  | 'Pre-Trial Conference'
  | 'Cross-Examination'
  | 'Report of Settlement';

export type HearingOutcome =
  | 'Adjourned'
  | 'Heard'
  | 'Part-Heard'
  | 'Judgment Delivered'
  | 'Judgment Reserved'
  | 'Ruling Delivered'
  | 'Struck Out'
  | 'Settled'
  | 'Not Sat';

export interface CourtDate {
  id: string;
  caseId: string;
  /** ISO datetime — hearing start. */
  startsAt: string;
  durationMinutes: number;
  courtId: string;
  courtRoom: string;
  judge: string;
  purpose: HearingPurpose;
  notes: string;
  attendeeIds: string[];
  /** Reminder offsets in hours before the hearing (§12). */
  reminderOffsetsHours: number[];
  outcome: HearingOutcome | null;
  outcomeNotes: string;
  outcomeRecordedById: string | null;
  outcomeRecordedAt: string | null;
  /** Set when the outcome adjourns the matter to a further date. */
  adjournedToDateId: string | null;
  createdById: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Tasks & workflow
// ---------------------------------------------------------------------------

export type TaskStatus = 'Not Started' | 'In Progress' | 'Blocked' | 'Completed' | 'Cancelled';
export type TaskPriority = CasePriority;

export interface TaskChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export interface Task {
  id: string;
  caseId: string | null;
  title: string;
  description: string;
  ownerId: string;
  assignedTeamId: string | null;
  dueDate: string;
  priority: TaskPriority;
  status: TaskStatus;
  checklist: TaskChecklistItem[];
  attachmentDocumentIds: string[];
  createdById: string;
  createdAt: string;
  completedAt: string | null;
  /** Set when the task was materialised from a workflow template. */
  workflowTemplateId: string | null;
}

export interface WorkflowTemplateStep {
  id: string;
  title: string;
  description: string;
  offsetDays: number;
  priority: TaskPriority;
  defaultOwnerRole: Role;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  steps: WorkflowTemplateStep[];
}

// ---------------------------------------------------------------------------
// Notes, timeline, notifications, audit
// ---------------------------------------------------------------------------

export interface CaseNote {
  id: string;
  caseId: string;
  body: string;
  authorId: string;
  createdAt: string;
  /** Internal notes are hidden from external counsel and read-only users. */
  internalOnly: boolean;
  mentions: string[];
}

export type TimelineEventType =
  | 'case.created'
  | 'case.updated'
  | 'case.status.changed'
  | 'case.archived'
  | 'document.uploaded'
  | 'document.version.added'
  | 'document.checked_out'
  | 'document.checked_in'
  | 'courtdate.created'
  | 'courtdate.updated'
  | 'courtdate.outcome.recorded'
  | 'task.created'
  | 'task.completed'
  | 'note.added'
  | 'counsel.assigned';

/**
 * Timeline events are produced server-side and carry structured operands rather
 * than composed prose, so the type is declared alongside the builder in
 * `convex/shared/timeline.ts` and re-exported here for the components that read
 * it. `src/lib/timelineText.ts` turns one into the sentence a user sees.
 */
export type { TimelineEvent } from '@shared/timeline';

export type NotificationChannel = 'in_app' | 'email' | 'sms';

export type NotificationType =
  | 'hearing.reminder'
  | 'case.assigned'
  | 'document.uploaded'
  | 'task.assigned'
  | 'task.overdue'
  | 'status.changed'
  | 'courtdate.changed'
  | 'digest'
  | 'system';

export interface AppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  caseId: string | null;
  link: string | null;
  channels: NotificationChannel[];
  priority: 'normal' | 'high';
  read: boolean;
  at: string;
}

export type AuditEntity =
  | 'Case'
  | 'Document'
  | 'CourtDate'
  | 'Task'
  | 'User'
  | 'Role'
  | 'Note'
  | 'Session'
  | 'Configuration'
  | 'Report'
  | 'Backup';

export interface AuditLogEntry {
  id: string;
  at: string;
  actorId: string;
  action: string;
  entity: AuditEntity;
  entityId: string;
  entityLabel: string;
  ipAddress: string;
  userAgent: string;
  outcome: 'success' | 'failure';
  metadata: Record<string, string | number | boolean>;
}

// ---------------------------------------------------------------------------
// Configuration (§19 — admin-configurable reference data)
// ---------------------------------------------------------------------------

export type CourtTier =
  | 'Supreme Court'
  | 'Court of Appeal'
  | 'Federal High Court'
  | 'National Industrial Court'
  | 'State High Court'
  | 'Magistrate Court'
  | 'Customary Court'
  | 'Tribunal'
  | 'Arbitration Panel';

export interface Court {
  id: string;
  name: string;
  tier: CourtTier;
  division: string;
  state: string;
  address: string;
  active: boolean;
}

export interface CaseType {
  id: string;
  name: string;
  description: string;
  category:
    | 'Civil'
    | 'Criminal'
    | 'Regulatory'
    | 'Employment'
    | 'Land'
    | 'Contract'
    | 'Environmental';
  active: boolean;
}

export interface DocumentType {
  id: string;
  name: string;
  group: 'Court Process' | 'Draft' | 'Evidence' | 'Correspondence' | 'Judgment' | 'Internal';
  retentionYears: number;
  requiresConfidentiality: boolean;
  active: boolean;
}

export interface TagDefinition {
  id: string;
  label: string;
  color: string;
  usageCount: number;
}

export interface SystemSettings {
  organisationName: string;
  unitName: string;
  dateFormat: 'dd/MM/yyyy' | 'yyyy-MM-dd' | 'dd MMM yyyy';
  timeZone: string;
  currency: 'NGN';
  sessionTimeoutMinutes: number;
  passwordExpiryDays: number;
  passwordMinLength: number;
  passwordRequireComplexity: boolean;
  maxFailedLoginAttempts: number;
  mfaRequiredForRoles: Role[];
  reminderOffsetsHours: number[];
  digestFrequency: 'daily' | 'weekly' | 'off';
  retentionArchiveAfterYears: number;
  storageQuotaGb: number;
  storageUsedGb: number;
  backupSchedule: 'hourly' | 'daily' | 'weekly';
  backupRetentionDays: number;
  watermarkConfidentialDownloads: boolean;
  ocrEnabled: boolean;
  smsEnabled: boolean;
  ssoEnabled: boolean;
}

export interface UserSession {
  id: string;
  userId: string;
  device: string;
  browser: string;
  ipAddress: string;
  location: string;
  startedAt: string;
  lastSeenAt: string;
  current: boolean;
}

export interface BackupRecord {
  id: string;
  startedAt: string;
  completedAt: string | null;
  type: 'Full' | 'Incremental';
  scope: 'Database' | 'Document Store' | 'Both';
  sizeGb: number;
  location: string;
  status: 'completed' | 'running' | 'failed';
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export type ReportId =
  | 'caseload-by-status'
  | 'upcoming-hearings'
  | 'age-of-matters'
  | 'workload-by-lawyer'
  | 'concluded-matters'
  | 'document-inventory';

export interface ReportColumn {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
}

export interface ReportDefinition {
  id: ReportId;
  name: string;
  description: string;
  /** Which TOR requirement the report satisfies. */
  requirement: string;
  columns: ReportColumn[];
}

export interface SavedView {
  id: string;
  name: string;
  ownerId: string;
  entity: 'cases' | 'documents' | 'tasks';
  filters: Record<string, unknown>;
  shared: boolean;
}

// ---------------------------------------------------------------------------
// Shared UI helper types
// ---------------------------------------------------------------------------

export type SortDirection = 'asc' | 'desc';

export interface Paginated<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}
