import { useMemo } from 'react';
import { create } from 'zustand';
import type {
  AppNotification,
  AuditLogEntry,
  BackupRecord,
  CaseDocument,
  CaseNote,
  CaseRecord,
  CaseStatus,
  CaseType,
  Court,
  CourtDate,
  DocumentType,
  DocumentVersion,
  HearingOutcome,
  Permission,
  Role,
  SavedView,
  SystemSettings,
  TagDefinition,
  Task,
  User,
} from '@/types';
import { makeId } from '@/lib/utils';
import { type Dataset, buildDataset } from '@/mocks/generate';

/**
 * Single source of truth for the demo.
 *
 * The dataset is regenerated from the current clock on every page load, so the
 * register never looks stale, and it is deliberately *not* persisted: a refresh
 * resets the demo to a known-good state. Every mutation below is the seam where
 * a real API call will slot in when the backend is built — same signature, same
 * optimistic update, just awaited.
 */
export interface DataActions {
  resetDemoData: () => void;
  recordAudit: (input: AuditInput) => void;

  createCase: (input: NewCaseInput, actorId: string) => CaseRecord;
  updateCase: (id: string, patch: Partial<CaseRecord>, actorId: string) => void;
  changeCaseStatus: (id: string, to: CaseStatus, reason: string, actorId: string) => void;
  archiveCase: (id: string, actorId: string) => void;
  deleteCase: (id: string, actorId: string) => void;

  uploadDocument: (input: NewDocumentInput, actorId: string) => CaseDocument;
  addDocumentVersion: (id: string, changeNote: string, actorId: string) => void;
  toggleCheckOut: (id: string, actorId: string) => void;
  deleteDocument: (id: string, actorId: string) => void;

  createCourtDate: (input: NewCourtDateInput, actorId: string) => CourtDate;
  updateCourtDate: (id: string, patch: Partial<CourtDate>, actorId: string) => void;
  rescheduleCourtDate: (id: string, startsAt: string, actorId: string) => void;
  recordOutcome: (id: string, outcome: HearingOutcome, notes: string, actorId: string) => void;

  createTask: (input: NewTaskInput, actorId: string) => Task;
  updateTask: (id: string, patch: Partial<Task>, actorId: string) => void;
  toggleChecklistItem: (taskId: string, itemId: string) => void;
  addNote: (caseId: string, body: string, internalOnly: boolean, actorId: string) => void;

  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: (userId: string) => void;

  setRolePermissions: (role: Role, permissions: Permission[], actorId: string) => void;
  upsertUser: (user: User, actorId: string) => void;
  importUsers: (users: User[], actorId: string) => void;
  updateSettings: (patch: Partial<SystemSettings>, actorId: string) => void;

  upsertCourt: (court: Court, actorId: string) => void;
  upsertCaseType: (caseType: CaseType, actorId: string) => void;
  upsertDocumentType: (documentType: DocumentType, actorId: string) => void;
  upsertTag: (tag: TagDefinition, actorId: string) => void;
  deleteTag: (id: string, actorId: string) => void;
  runBackup: (actorId: string) => void;
  revokeSession: (id: string, actorId: string) => void;
  saveView: (view: SavedView) => void;
  deleteSavedView: (id: string) => void;
}

export type DataStore = Dataset & DataActions;

interface AuditInput {
  actorId: string;
  action: string;
  entity: AuditLogEntry['entity'];
  entityId: string;
  entityLabel: string;
  outcome?: AuditLogEntry['outcome'];
  metadata?: AuditLogEntry['metadata'];
}

export interface NewCaseInput
  extends Pick<
    CaseRecord,
    | 'title'
    | 'suitNumber'
    | 'courtId'
    | 'caseTypeId'
    | 'status'
    | 'priority'
    | 'filingDate'
    | 'claimValue'
    | 'matterOwnerId'
    | 'assigneeIds'
    | 'parties'
    | 'tags'
    | 'confidential'
    | 'summary'
    | 'reliefSought'
  > {
  caseReference?: string | null;
  presidingJudge?: string | null;
  externalCounselIds?: string[];
  teamId?: string | null;
  restrictedToUserIds?: string[];
}

export interface NewDocumentInput
  extends Pick<CaseDocument, 'caseId' | 'name' | 'documentTypeId' | 'format' | 'confidential'> {
  sizeBytes: number;
  description?: string;
  tags?: string[];
}

export interface NewCourtDateInput
  extends Pick<
    CourtDate,
    'caseId' | 'startsAt' | 'durationMinutes' | 'courtId' | 'courtRoom' | 'judge' | 'purpose'
  > {
  notes?: string;
  attendeeIds?: string[];
  reminderOffsetsHours?: number[];
}

export interface NewTaskInput
  extends Pick<Task, 'caseId' | 'title' | 'ownerId' | 'dueDate' | 'priority'> {
  description?: string;
  assignedTeamId?: string | null;
}

/** The current wall clock, isolated so tests can freeze it later. */
const nowIso = () => new Date().toISOString();

export const useDataStore = create<DataStore>()((set, get) => ({
  ...buildDataset(new Date()),

  resetDemoData: () => set({ ...buildDataset(new Date()) }),

  recordAudit: ({ actorId, action, entity, entityId, entityLabel, outcome, metadata }) =>
    set((state) => ({
      auditLog: [
        {
          id: makeId('aud'),
          at: nowIso(),
          actorId,
          action,
          entity,
          entityId,
          entityLabel,
          ipAddress: '105.112.44.18',
          userAgent: navigator.userAgent,
          outcome: outcome ?? 'success',
          metadata: metadata ?? {},
        },
        ...state.auditLog,
      ],
    })),

  // ---- Cases --------------------------------------------------------------
  createCase: (input, actorId) => {
    const state = get();
    const year = new Date(input.filingDate ?? nowIso()).getFullYear();
    const sequence = state.cases.length + 1;
    const record: CaseRecord = {
      id: makeId('case'),
      caseId: `HYP/LCMS/${year}/${String(sequence).padStart(4, '0')}`,
      caseReference: input.caseReference ?? null,
      title: input.title,
      suitNumber: input.suitNumber,
      courtId: input.courtId,
      caseTypeId: input.caseTypeId,
      status: input.status,
      priority: input.priority,
      filingDate: input.filingDate,
      claimValue: input.claimValue,
      matterOwnerId: input.matterOwnerId,
      assigneeIds: input.assigneeIds,
      externalCounselIds: input.externalCounselIds ?? [],
      teamId: input.teamId ?? null,
      parties: input.parties,
      relatedCases: [],
      tags: input.tags,
      confidential: input.confidential,
      restrictedToUserIds: input.restrictedToUserIds ?? [],
      summary: input.summary,
      reliefSought: input.reliefSought,
      presidingJudge: input.presidingJudge ?? null,
      createdById: actorId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      archivedAt: null,
    };

    set((current) => ({
      cases: [record, ...current.cases],
      statusChanges: [
        ...current.statusChanges,
        {
          id: makeId('sc'),
          caseId: record.id,
          from: null,
          to: record.status,
          reason: 'Matter opened on the register.',
          byUserId: actorId,
          at: nowIso(),
        },
      ],
    }));

    get().recordAudit({
      actorId,
      action: 'Created case',
      entity: 'Case',
      entityId: record.id,
      entityLabel: `${record.caseId} — ${record.title}`,
      metadata: { status: record.status, priority: record.priority },
    });

    return record;
  },

  updateCase: (id, patch, actorId) => {
    set((state) => ({
      cases: state.cases.map((record) =>
        record.id === id ? { ...record, ...patch, updatedAt: nowIso() } : record,
      ),
    }));
    const record = get().cases.find((item) => item.id === id);
    if (record) {
      get().recordAudit({
        actorId,
        action: 'Updated case details',
        entity: 'Case',
        entityId: id,
        entityLabel: `${record.caseId} — ${record.title}`,
        metadata: { fields: Object.keys(patch).join(', ') },
      });
    }
  },

  changeCaseStatus: (id, to, reason, actorId) => {
    const previous = get().cases.find((record) => record.id === id);
    if (!previous || previous.status === to) return;

    set((state) => ({
      cases: state.cases.map((record) =>
        record.id === id ? { ...record, status: to, updatedAt: nowIso() } : record,
      ),
      statusChanges: [
        ...state.statusChanges,
        {
          id: makeId('sc'),
          caseId: id,
          from: previous.status,
          to,
          reason,
          byUserId: actorId,
          at: nowIso(),
        },
      ],
    }));

    get().recordAudit({
      actorId,
      action: `Changed status to ${to}`,
      entity: 'Case',
      entityId: id,
      entityLabel: `${previous.caseId} — ${previous.title}`,
      metadata: { from: previous.status, to, reason },
    });
  },

  archiveCase: (id, actorId) => {
    const record = get().cases.find((item) => item.id === id);
    set((state) => ({
      cases: state.cases.map((item) =>
        item.id === id
          ? { ...item, status: 'Archived', archivedAt: nowIso(), updatedAt: nowIso() }
          : item,
      ),
    }));
    if (record) {
      get().recordAudit({
        actorId,
        action: 'Archived case',
        entity: 'Case',
        entityId: id,
        entityLabel: `${record.caseId} — ${record.title}`,
        metadata: { retentionYears: get().settings.retentionArchiveAfterYears },
      });
    }
  },

  deleteCase: (id, actorId) => {
    const record = get().cases.find((item) => item.id === id);
    set((state) => ({
      cases: state.cases.filter((item) => item.id !== id),
      documents: state.documents.filter((item) => item.caseId !== id),
      courtDates: state.courtDates.filter((item) => item.caseId !== id),
      tasks: state.tasks.filter((item) => item.caseId !== id),
      notes: state.notes.filter((item) => item.caseId !== id),
      statusChanges: state.statusChanges.filter((item) => item.caseId !== id),
    }));
    if (record) {
      get().recordAudit({
        actorId,
        action: 'Deleted case',
        entity: 'Case',
        entityId: id,
        entityLabel: `${record.caseId} — ${record.title}`,
        metadata: { cascade: 'documents, court dates, tasks, notes' },
      });
    }
  },

  // ---- Documents ----------------------------------------------------------
  uploadDocument: (input, actorId) => {
    const version: DocumentVersion = {
      version: 1,
      uploadedById: actorId,
      uploadedAt: nowIso(),
      sizeBytes: input.sizeBytes,
      changeNote: 'Initial upload.',
      storageKey: `s3://hyprep-lcms-docs/${input.caseId}/${input.documentTypeId}/v1`,
    };
    const document: CaseDocument = {
      id: makeId('doc'),
      caseId: input.caseId,
      name: input.name,
      documentTypeId: input.documentTypeId,
      format: input.format,
      currentVersion: 1,
      versions: [version],
      authorId: actorId,
      confidential: input.confidential,
      tags: input.tags ?? [],
      description: input.description ?? '',
      ocrText: null,
      ocrStatus: input.format === 'jpg' || input.format === 'png' ? 'queued' : 'not_applicable',
      checkedOutById: null,
      checkedOutAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    set((state) => ({ documents: [document, ...state.documents] }));
    get().recordAudit({
      actorId,
      action: 'Uploaded document',
      entity: 'Document',
      entityId: document.id,
      entityLabel: document.name,
      metadata: { caseId: document.caseId, sizeBytes: input.sizeBytes, format: input.format },
    });
    return document;
  },

  addDocumentVersion: (id, changeNote, actorId) => {
    set((state) => ({
      documents: state.documents.map((document) => {
        if (document.id !== id) return document;
        const next = document.currentVersion + 1;
        const previous = document.versions[document.versions.length - 1]!;
        return {
          ...document,
          currentVersion: next,
          updatedAt: nowIso(),
          versions: [
            ...document.versions,
            {
              version: next,
              uploadedById: actorId,
              uploadedAt: nowIso(),
              sizeBytes: Math.round(previous.sizeBytes * 1.08),
              changeNote,
              storageKey: `${previous.storageKey.replace(/v\d+$/, '')}v${next}`,
            },
          ],
        };
      }),
    }));
    const document = get().documents.find((item) => item.id === id);
    if (document) {
      get().recordAudit({
        actorId,
        action: `Uploaded version ${document.currentVersion}`,
        entity: 'Document',
        entityId: id,
        entityLabel: document.name,
        metadata: { changeNote },
      });
    }
  },

  toggleCheckOut: (id, actorId) => {
    const document = get().documents.find((item) => item.id === id);
    if (!document) return;
    const checkingIn = Boolean(document.checkedOutById);

    set((state) => ({
      documents: state.documents.map((item) =>
        item.id === id
          ? {
              ...item,
              checkedOutById: checkingIn ? null : actorId,
              checkedOutAt: checkingIn ? null : nowIso(),
              updatedAt: nowIso(),
            }
          : item,
      ),
    }));

    get().recordAudit({
      actorId,
      action: checkingIn ? 'Checked in document' : 'Checked out document for editing',
      entity: 'Document',
      entityId: id,
      entityLabel: document.name,
      metadata: { lockedToOthers: !checkingIn },
    });
  },

  deleteDocument: (id, actorId) => {
    const document = get().documents.find((item) => item.id === id);
    set((state) => ({ documents: state.documents.filter((item) => item.id !== id) }));
    if (document) {
      get().recordAudit({
        actorId,
        action: 'Deleted document',
        entity: 'Document',
        entityId: id,
        entityLabel: document.name,
        metadata: { caseId: document.caseId },
      });
    }
  },

  // ---- Court dates --------------------------------------------------------
  createCourtDate: (input, actorId) => {
    const sitting: CourtDate = {
      id: makeId('cd'),
      caseId: input.caseId,
      startsAt: input.startsAt,
      durationMinutes: input.durationMinutes,
      courtId: input.courtId,
      courtRoom: input.courtRoom,
      judge: input.judge,
      purpose: input.purpose,
      notes: input.notes ?? '',
      attendeeIds: input.attendeeIds ?? [],
      reminderOffsetsHours: input.reminderOffsetsHours ?? get().settings.reminderOffsetsHours,
      outcome: null,
      outcomeNotes: '',
      outcomeRecordedById: null,
      outcomeRecordedAt: null,
      adjournedToDateId: null,
      createdById: actorId,
      createdAt: nowIso(),
    };

    set((state) => ({
      courtDates: [...state.courtDates, sitting].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    }));
    get().recordAudit({
      actorId,
      action: 'Fixed court date',
      entity: 'CourtDate',
      entityId: sitting.id,
      entityLabel: `${sitting.purpose} — ${sitting.courtRoom}`,
      metadata: { caseId: sitting.caseId, startsAt: sitting.startsAt },
    });
    return sitting;
  },

  updateCourtDate: (id, patch, actorId) => {
    set((state) => ({
      courtDates: state.courtDates
        .map((sitting) => (sitting.id === id ? { ...sitting, ...patch } : sitting))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    }));
    const sitting = get().courtDates.find((item) => item.id === id);
    if (sitting) {
      get().recordAudit({
        actorId,
        action: 'Updated court date',
        entity: 'CourtDate',
        entityId: id,
        entityLabel: `${sitting.purpose} — ${sitting.courtRoom}`,
        metadata: { fields: Object.keys(patch).join(', ') },
      });
    }
  },

  /** Used by drag-and-drop rescheduling on the calendar (TOR §10). */
  rescheduleCourtDate: (id, startsAt, actorId) => {
    const previous = get().courtDates.find((sitting) => sitting.id === id);
    if (!previous) return;

    set((state) => ({
      courtDates: state.courtDates
        .map((sitting) => (sitting.id === id ? { ...sitting, startsAt } : sitting))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    }));

    const record = get().cases.find((item) => item.id === previous.caseId);
    set((state) => ({
      notifications: [
        {
          id: makeId('ntf'),
          userId: record?.matterOwnerId ?? actorId,
          type: 'courtdate.changed',
          title: `Court date moved — ${record?.caseId ?? 'matter'}`,
          body: `${previous.purpose} was rescheduled. Diaries and reminders have been updated.`,
          caseId: previous.caseId,
          link: `/cases/${previous.caseId}?tab=court-dates`,
          channels: ['in_app', 'email'],
          priority: 'high',
          read: false,
          at: nowIso(),
        },
        ...state.notifications,
      ],
    }));

    get().recordAudit({
      actorId,
      action: 'Rescheduled court date',
      entity: 'CourtDate',
      entityId: id,
      entityLabel: `${previous.purpose} — ${previous.courtRoom}`,
      metadata: { from: previous.startsAt, to: startsAt },
    });
  },

  recordOutcome: (id, outcome, notes, actorId) => {
    const sitting = get().courtDates.find((item) => item.id === id);
    if (!sitting) return;

    set((state) => ({
      courtDates: state.courtDates.map((item) =>
        item.id === id
          ? {
              ...item,
              outcome,
              outcomeNotes: notes,
              outcomeRecordedById: actorId,
              outcomeRecordedAt: nowIso(),
            }
          : item,
      ),
    }));

    // The matter status follows the outcome recorded in open court.
    const followOn: Partial<Record<HearingOutcome, CaseStatus>> = {
      Adjourned: 'Adjourned',
      Heard: 'Heard',
      'Part-Heard': 'Pending',
      'Judgment Delivered': 'Judgment Delivered',
      'Ruling Delivered': 'Pending',
      Settled: 'Concluded',
      'Struck Out': 'Concluded',
    };
    const nextStatus = followOn[outcome];
    if (nextStatus) {
      get().changeCaseStatus(
        sitting.caseId,
        nextStatus,
        `Following the hearing of ${new Date(sitting.startsAt).toLocaleDateString('en-NG')}: ${outcome}.`,
        actorId,
      );
    }

    get().recordAudit({
      actorId,
      action: 'Recorded hearing outcome',
      entity: 'CourtDate',
      entityId: id,
      entityLabel: `${sitting.purpose} — ${sitting.courtRoom}`,
      metadata: { outcome, caseId: sitting.caseId },
    });
  },

  // ---- Tasks & notes ------------------------------------------------------
  createTask: (input, actorId) => {
    const task: Task = {
      id: makeId('tsk'),
      caseId: input.caseId,
      title: input.title,
      description: input.description ?? '',
      ownerId: input.ownerId,
      assignedTeamId: input.assignedTeamId ?? null,
      dueDate: input.dueDate,
      priority: input.priority,
      status: 'Not Started',
      checklist: [],
      attachmentDocumentIds: [],
      createdById: actorId,
      createdAt: nowIso(),
      completedAt: null,
      workflowTemplateId: null,
    };

    set((state) => ({
      tasks: [task, ...state.tasks],
      notifications: [
        {
          id: makeId('ntf'),
          userId: task.ownerId,
          type: 'task.assigned',
          title: `Task assigned: ${task.title}`,
          body: `${task.priority} priority. Please review and update the status.`,
          caseId: task.caseId,
          link: task.caseId ? `/cases/${task.caseId}?tab=tasks` : '/tasks',
          channels: ['in_app', 'email'],
          priority: task.priority === 'Critical' ? 'high' : 'normal',
          read: false,
          at: nowIso(),
        },
        ...state.notifications,
      ],
    }));

    get().recordAudit({
      actorId,
      action: 'Created task',
      entity: 'Task',
      entityId: task.id,
      entityLabel: task.title,
      metadata: { ownerId: task.ownerId, dueDate: task.dueDate },
    });
    return task;
  },

  updateTask: (id, patch, actorId) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? {
              ...task,
              ...patch,
              completedAt:
                patch.status === 'Completed'
                  ? (task.completedAt ?? nowIso())
                  : patch.status
                    ? null
                    : task.completedAt,
            }
          : task,
      ),
    }));
    const task = get().tasks.find((item) => item.id === id);
    if (task) {
      get().recordAudit({
        actorId,
        action: patch.status === 'Completed' ? 'Completed task' : 'Updated task',
        entity: 'Task',
        entityId: id,
        entityLabel: task.title,
        metadata: { status: task.status },
      });
    }
  },

  toggleChecklistItem: (taskId, itemId) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              checklist: task.checklist.map((item) =>
                item.id === itemId ? { ...item, done: !item.done } : item,
              ),
            }
          : task,
      ),
    })),

  addNote: (caseId, body, internalOnly, actorId) => {
    const note: CaseNote = {
      id: makeId('nte'),
      caseId,
      body,
      authorId: actorId,
      createdAt: nowIso(),
      internalOnly,
      mentions: [],
    };
    set((state) => ({ notes: [note, ...state.notes] }));
    get().recordAudit({
      actorId,
      action: internalOnly ? 'Added internal note' : 'Added note',
      entity: 'Note',
      entityId: note.id,
      entityLabel: body.slice(0, 60),
      metadata: { caseId },
    });
  },

  // ---- Notifications ------------------------------------------------------
  markNotificationRead: (id) =>
    set((state) => ({
      notifications: state.notifications.map((item) =>
        item.id === id ? { ...item, read: true } : item,
      ),
    })),

  markAllNotificationsRead: (userId) =>
    set((state) => ({
      notifications: state.notifications.map((item) =>
        item.userId === userId ? { ...item, read: true } : item,
      ),
    })),

  // ---- Administration -----------------------------------------------------
  setRolePermissions: (role, permissions, actorId) => {
    const before = get().permissionMatrix[role];
    set((state) => ({
      permissionMatrix: { ...state.permissionMatrix, [role]: permissions },
    }));
    get().recordAudit({
      actorId,
      action: 'Updated role permissions',
      entity: 'Role',
      entityId: role,
      entityLabel: role,
      metadata: { before: before.length, after: permissions.length },
    });
  },

  upsertUser: (user, actorId) => {
    const exists = get().users.some((item) => item.id === user.id);
    set((state) => ({
      users: exists
        ? state.users.map((item) => (item.id === user.id ? user : item))
        : [...state.users, user],
    }));
    get().recordAudit({
      actorId,
      action: exists ? 'Updated user account' : 'Created user account',
      entity: 'User',
      entityId: user.id,
      entityLabel: user.fullName,
      metadata: { role: user.role, status: user.status },
    });
  },

  updateSettings: (patch, actorId) => {
    set((state) => ({ settings: { ...state.settings, ...patch } }));
    get().recordAudit({
      actorId,
      action: 'Updated system configuration',
      entity: 'Configuration',
      entityId: 'cfg_system',
      entityLabel: 'System settings',
      metadata: { fields: Object.keys(patch).join(', ') },
    });
  },

  importUsers: (incoming, actorId) => {
    set((state) => {
      const byId = new Map(state.users.map((item) => [item.id, item]));
      incoming.forEach((user) => byId.set(user.id, user));
      return { users: [...byId.values()] };
    });
    get().recordAudit({
      actorId,
      action: 'Imported user accounts in bulk',
      entity: 'User',
      entityId: 'bulk',
      entityLabel: `${incoming.length} accounts`,
      metadata: { count: incoming.length },
    });
  },

  revokeSession: (id, actorId) => {
    const session = get().sessions.find((item) => item.id === id);
    set((state) => ({ sessions: state.sessions.filter((item) => item.id !== id) }));
    if (!session) return;
    get().recordAudit({
      actorId,
      action: 'Signed out a session remotely',
      entity: 'Session',
      entityId: session.id,
      entityLabel: `${session.device} · ${session.browser}`,
      metadata: { ipAddress: session.ipAddress, location: session.location },
    });
  },

  upsertCourt: (court, actorId) => {
    const exists = get().courts.some((item) => item.id === court.id);
    set((state) => ({
      courts: exists
        ? state.courts.map((item) => (item.id === court.id ? court : item))
        : [...state.courts, court],
    }));
    get().recordAudit({
      actorId,
      action: exists ? 'Updated court' : 'Added court',
      entity: 'Configuration',
      entityId: court.id,
      entityLabel: court.name,
    });
  },

  upsertCaseType: (caseType, actorId) => {
    const exists = get().caseTypes.some((item) => item.id === caseType.id);
    set((state) => ({
      caseTypes: exists
        ? state.caseTypes.map((item) => (item.id === caseType.id ? caseType : item))
        : [...state.caseTypes, caseType],
    }));
    get().recordAudit({
      actorId,
      action: exists ? 'Updated case type' : 'Added case type',
      entity: 'Configuration',
      entityId: caseType.id,
      entityLabel: caseType.name,
    });
  },

  upsertDocumentType: (documentType, actorId) => {
    const exists = get().documentTypes.some((item) => item.id === documentType.id);
    set((state) => ({
      documentTypes: exists
        ? state.documentTypes.map((item) => (item.id === documentType.id ? documentType : item))
        : [...state.documentTypes, documentType],
    }));
    get().recordAudit({
      actorId,
      action: exists ? 'Updated document type' : 'Added document type',
      entity: 'Configuration',
      entityId: documentType.id,
      entityLabel: documentType.name,
    });
  },

  upsertTag: (tag, actorId) => {
    const exists = get().tags.some((item) => item.id === tag.id);
    set((state) => ({
      tags: exists ? state.tags.map((item) => (item.id === tag.id ? tag : item)) : [...state.tags, tag],
    }));
    get().recordAudit({
      actorId,
      action: exists ? 'Updated tag' : 'Added tag',
      entity: 'Configuration',
      entityId: tag.id,
      entityLabel: tag.label,
    });
  },

  deleteTag: (id, actorId) => {
    const tag = get().tags.find((item) => item.id === id);
    set((state) => ({ tags: state.tags.filter((item) => item.id !== id) }));
    get().recordAudit({
      actorId,
      action: 'Deleted tag',
      entity: 'Configuration',
      entityId: id,
      entityLabel: tag?.label ?? id,
    });
  },

  /** Simulates an on-demand backup (TOR §35) so the panel can be demonstrated. */
  runBackup: (actorId) => {
    const entry: BackupRecord = {
      id: makeId('bkp'),
      startedAt: nowIso(),
      completedAt: nowIso(),
      type: 'Full',
      scope: 'Both',
      sizeGb: Number((get().settings.storageUsedGb * 0.42).toFixed(2)),
      status: 'completed',
      location: 'Abuja primary · Lagos replica',
    };
    set((state) => ({ backups: [entry, ...state.backups] }));
    get().recordAudit({
      actorId,
      action: 'Ran an on-demand backup',
      entity: 'Backup',
      entityId: entry.id,
      entityLabel: 'On-demand backup',
      metadata: { sizeGb: entry.sizeGb },
    });
  },

  saveView: (view) =>
    set((state) => ({
      savedViews: state.savedViews.some((item) => item.id === view.id)
        ? state.savedViews.map((item) => (item.id === view.id ? view : item))
        : [...state.savedViews, view],
    })),

  deleteSavedView: (id) =>
    set((state) => ({ savedViews: state.savedViews.filter((item) => item.id !== id) })),
}));

/** Convenience hooks so components subscribe to the narrowest slice possible. */
export const useCases = () => useDataStore((state) => state.cases);
export const useUsers = () => useDataStore((state) => state.users);
export const useSettings = () => useDataStore((state) => state.settings);
export const usePermissionMatrix = () => useDataStore((state) => state.permissionMatrix);

export function useUserLookup(): Map<string, User> {
  const users = useUsers();
  return useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
}

/**
 * Derive the slice *outside* the selector. A selector that builds a new array
 * on every call gives `useSyncExternalStore` a fresh snapshot each render, which
 * zustand reads as a store change — the component then re-renders for ever.
 */
export function useNotificationsFor(userId: string | null): AppNotification[] {
  const notifications = useDataStore((state) => state.notifications);
  return useMemo(
    () => (userId ? notifications.filter((item) => item.userId === userId) : EMPTY),
    [notifications, userId],
  );
}

const EMPTY: AppNotification[] = [];

