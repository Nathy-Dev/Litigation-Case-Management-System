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

/**
 * The collection of records the selectors read.
 *
 * This shape was originally declared by the mock generator, which made every
 * selector in the application nominally dependent on the demo fixtures. It is
 * declared here instead: the selectors own the shape they consume, and the
 * generator is now one *implementation* of it rather than its definition.
 *
 * That inversion is what allows the generator tree to be deleted without
 * touching a single selector. As each entity moves to Convex its collection is
 * served by a query instead, and the members here fall away one at a time.
 */
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
