import type {
  AppNotification,
  AuditLogEntry,
  BackupRecord,
  CaseDocument,
  CaseNote,
  CaseRecord,
  CaseStatusChange,
  CaseTemplate,
  CaseType,
  Court,
  CourtDate,
  DocumentType,
  PermissionMatrix,
  ReportDefinition,
  SavedView,
  SystemSettings,
  TagDefinition,
  Task,
  Team,
  User,
  UserSession,
  WorkflowTemplate,
} from '@/types';
import { DEFAULT_PERMISSION_MATRIX } from '@/lib/permissions';
import {
  CASE_TEMPLATES,
  CASE_TYPES,
  COURTS,
  DEFAULT_SETTINGS,
  DOCUMENT_TYPES,
  REPORT_DEFINITIONS,
  TAGS,
  WORKFLOW_TEMPLATES,
} from '@/mocks/data/reference';
import { TEAMS, buildSessions, buildUsers } from '@/mocks/data/users';
import { buildCases } from '@/mocks/data/cases';
import { buildCourtDates } from './courtDates';
import { buildDocuments } from './documents';
import { buildTasks } from './tasks';
import { buildNotes, buildStatusChanges } from './history';
import { buildNotifications } from './notifications';
import { buildAuditLog } from './audit';
import { buildAdminAudit, buildBackups, buildSavedViews } from './ops';

export interface Dataset {
  generatedAt: string;
  users: User[];
  teams: Team[];
  sessions: UserSession[];
  permissionMatrix: PermissionMatrix;
  cases: CaseRecord[];
  statusChanges: CaseStatusChange[];
  documents: CaseDocument[];
  courtDates: CourtDate[];
  tasks: Task[];
  notes: CaseNote[];
  notifications: AppNotification[];
  auditLog: AuditLogEntry[];
  backups: BackupRecord[];
  savedViews: SavedView[];
  courts: Court[];
  caseTypes: CaseType[];
  documentTypes: DocumentType[];
  tags: TagDefinition[];
  workflowTemplates: WorkflowTemplate[];
  caseTemplates: CaseTemplate[];
  reports: ReportDefinition[];
  settings: SystemSettings;
}

/**
 * Assembles the whole demo dataset from a single clock reading.
 *
 * Order matters: the derived collections (timeline, notifications, audit) read
 * the primary records, so the whole register stays internally consistent — a
 * hearing reminder always points at a sitting that exists, and every audit row
 * names a record you can open.
 */
export function buildDataset(now: Date = new Date()): Dataset {
  const users = buildUsers(now);
  const cases = buildCases(now);
  const statusChanges = buildStatusChanges(now, cases);
  const documents = buildDocuments(now, cases);
  const courtDates = buildCourtDates(now, cases);
  const tasks = buildTasks(now, cases);
  const notes = buildNotes(now, cases);

  const notifications = buildNotifications({ now, users, cases, courtDates, tasks });
  const auditLog = [
    ...buildAuditLog({ now, users, cases, documents, courtDates, tasks }),
    ...buildAdminAudit(now),
  ].sort((a, b) => b.at.localeCompare(a.at));

  // Tag usage counts are derived rather than hand-maintained.
  const tagUsage = new Map<string, number>();
  cases.forEach((record) =>
    record.tags.forEach((label) => tagUsage.set(label, (tagUsage.get(label) ?? 0) + 1)),
  );
  const tags = TAGS.map((tag) => ({ ...tag, usageCount: tagUsage.get(tag.label) ?? 0 }));

  // Storage used is derived from the actual document sizes, on top of the legacy
  // material migrated into the store at go-live. The demo carries a 36-matter
  // sample of the register, so without that baseline every quota indicator in
  // the system would read 0% and the warning thresholds could not be seen.
  const LEGACY_ARCHIVE_GB = 338.6;
  const storageUsedGb =
    Math.round(
      (LEGACY_ARCHIVE_GB +
        documents.reduce(
          (total, document) =>
            total + document.versions.reduce((sum, version) => sum + version.sizeBytes, 0),
          0,
        ) /
          1_073_741_824) *
        100,
    ) / 100;

  return {
    generatedAt: now.toISOString(),
    users,
    teams: TEAMS,
    sessions: buildSessions(now),
    permissionMatrix: structuredClone(DEFAULT_PERMISSION_MATRIX),
    cases,
    statusChanges,
    documents,
    courtDates,
    tasks,
    notes,
    notifications,
    auditLog,
    backups: buildBackups(now),
    savedViews: buildSavedViews(),
    courts: COURTS,
    caseTypes: CASE_TYPES,
    documentTypes: DOCUMENT_TYPES,
    tags,
    workflowTemplates: WORKFLOW_TEMPLATES,
    caseTemplates: CASE_TEMPLATES,
    reports: REPORT_DEFINITIONS,
    settings: { ...DEFAULT_SETTINGS, storageUsedGb },
  };
}
