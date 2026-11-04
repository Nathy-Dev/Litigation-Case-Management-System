import { v, type Infer } from 'convex/values';
import {
  casePriorityValidator,
  caseStatusValidator,
  courtTierValidator,
  hearingPurposeValidator,
  roleValidator,
  staffTitleValidator,
  taskStatusValidator,
  userStatusValidator,
} from './enums';

/**
 * HYPREP LCMS - wire shapes shared by the server modules.
 *
 * One validator for each shape that crosses the wire more than once, so the
 * server does not declare the same interface in five places and then have to
 * keep them in agreement. The client-facing hooks (`src/hooks/*`) map these to
 * the existing `src/types` interfaces, which keeps the ~47 components untouched
 * by the shape of the transport.
 */

// ---------------------------------------------------------------------------
// Users (the roster projection the register joins on)
// ---------------------------------------------------------------------------

/**
 * The staff projection carried on case rows. Narrower than `users.directory`:
 * everything a register row needs to render an owner chip and a name, nothing
 * the register does not.
 */
export const userLite = v.object({
  id: v.id('users'),
  fullName: v.string(),
  email: v.string(),
  title: staffTitleValidator,
  role: roleValidator,
  department: v.string(),
  teamId: v.union(v.id('teams'), v.null()),
  avatarColor: v.string(),
  initials: v.string(),
  status: userStatusValidator,
});

export type UserLite = Infer<typeof userLite>;

export function toUserLite(user: {
  _id: string;
  fullName: string;
  email: string;
  title: string;
  role: string;
  department: string;
  teamId: string | null;
  avatarColor: string;
  initials: string;
  status: string;
}) {
  return {
    id: user._id,
    fullName: user.fullName,
    email: user.email,
    title: user.title,
    role: user.role,
    department: user.department,
    teamId: user.teamId,
    avatarColor: user.avatarColor,
    initials: user.initials,
    status: user.status,
  } as UserLite;
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export const teamRow = v.object({
  id: v.id('teams'),
  name: v.string(),
  description: v.string(),
  leadUserId: v.union(v.id('users'), v.null()),
  memberIds: v.array(v.id('users')),
});

// ---------------------------------------------------------------------------
// The register row
// ---------------------------------------------------------------------------

/**
 * One row of the register - the exact shape `src/lib/selectors/cases.ts`'s
 * `CaseRow` produces, computed server-side so sort and filter can happen where
 * the visibility rule is enforced.
 *
 * `nextHearing`/`lastHearing` are the full `CourtDate` shape so the calendar
 * and detail page render them without a second join; the rollups on the case
 * document provide the sortable `nextHearingAt` for the index.
 */
export const courtDateSummary = v.object({
  id: v.id('courtDates'),
  caseId: v.id('cases'),
  startsAt: v.string(),
  durationMinutes: v.number(),
  courtId: v.id('courts'),
  courtRoom: v.string(),
  judge: v.string(),
  purpose: hearingPurposeValidator,
  notes: v.string(),
  attendeeIds: v.array(v.id('users')),
  reminderOffsetsHours: v.array(v.number()),
  outcome: v.union(
    v.literal('Adjourned'),
    v.literal('Heard'),
    v.literal('Part-Heard'),
    v.literal('Judgment Delivered'),
    v.literal('Judgment Reserved'),
    v.literal('Ruling Delivered'),
    v.literal('Struck Out'),
    v.literal('Settled'),
    v.literal('Not Sat'),
    v.null(),
  ),
  outcomeNotes: v.string(),
  outcomeRecordedById: v.union(v.id('users'), v.null()),
  outcomeRecordedAt: v.union(v.string(), v.null()),
  adjournedToDateId: v.union(v.id('courtDates'), v.null()),
  createdById: v.id('users'),
  createdAt: v.string(),
});

export const caseRow = v.object({
  record: v.object({
    id: v.id('cases'),
    caseId: v.string(),
    caseReference: v.union(v.string(), v.null()),
    title: v.string(),
    suitNumber: v.union(v.string(), v.null()),
    courtId: v.id('courts'),
    caseTypeId: v.id('caseTypes'),
    status: caseStatusValidator,
    priority: casePriorityValidator,
    filingDate: v.union(v.string(), v.null()),
    claimValue: v.union(v.number(), v.null()),
    matterOwnerId: v.id('users'),
    assigneeIds: v.array(v.id('users')),
    externalCounselIds: v.array(v.id('users')),
    stakeholderIds: v.array(v.id('users')),
    teamId: v.union(v.id('teams'), v.null()),
    parties: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        role: v.string(),
        type: v.string(),
        email: v.union(v.string(), v.null()),
        phone: v.union(v.string(), v.null()),
        address: v.union(v.string(), v.null()),
        representedBy: v.union(v.string(), v.null()),
      }),
    ),
    relatedCases: v.array(
      v.object({
        caseId: v.id('cases'),
        linkType: v.string(),
        note: v.string(),
      }),
    ),
    tags: v.array(v.string()),
    confidential: v.boolean(),
    restrictedToUserIds: v.array(v.id('users')),
    summary: v.string(),
    reliefSought: v.string(),
    presidingJudge: v.union(v.string(), v.null()),
    createdById: v.id('users'),
    createdAt: v.string(),
    updatedAt: v.string(),
    archivedAt: v.union(v.string(), v.null()),
  }),
  courtName: v.string(),
  courtTier: v.union(courtTierValidator, v.literal('—')),
  caseTypeName: v.string(),
  owner: v.union(userLite, v.null()),
  partiesLabel: v.string(),
  nextHearing: v.union(courtDateSummary, v.null()),
  lastHearing: v.union(courtDateSummary, v.null()),
  openTasks: v.number(),
  overdueTasks: v.number(),
  documentCount: v.number(),
  ageDays: v.number(),
});

/** The paginated register envelope - same shape as `src/types`' `Paginated<T>`. */
export const paginatedCaseRows = v.object({
  rows: v.array(caseRow),
  total: v.number(),
  page: v.number(),
  pageSize: v.number(),
  pageCount: v.number(),
});

// ---------------------------------------------------------------------------
// Task row
// ---------------------------------------------------------------------------

export const taskRow = v.object({
  id: v.id('tasks'),
  caseId: v.union(v.id('cases'), v.null()),
  title: v.string(),
  description: v.string(),
  ownerId: v.id('users'),
  assignedTeamId: v.union(v.id('teams'), v.null()),
  dueDate: v.string(),
  priority: casePriorityValidator,
  status: taskStatusValidator,
  checklist: v.array(
    v.object({
      id: v.string(),
      label: v.string(),
      done: v.boolean(),
    }),
  ),
  attachmentDocumentIds: v.array(v.id('documents')),
  createdById: v.id('users'),
  createdAt: v.string(),
  completedAt: v.union(v.string(), v.null()),
  workflowTemplateId: v.union(v.string(), v.null()),
});

export const taskListResult = v.object({
  rows: v.array(taskRow),
  total: v.number(),
});

// ---------------------------------------------------------------------------
// Case detail bundle
// ---------------------------------------------------------------------------

/**
 * Everything one matter's page reads: the row itself, the child collections,
 * and the timeline, so a detail page is one subscription rather than seven.
 */
export const caseDetail = v.object({
  row: caseRow,
  documents: v.array(
    v.object({
      id: v.id('documents'),
      caseId: v.id('cases'),
      name: v.string(),
      documentTypeId: v.id('documentTypes'),
      format: v.string(),
      currentVersion: v.number(),
      versions: v.array(
        v.object({
          version: v.number(),
          uploadedById: v.id('users'),
          uploadedAt: v.string(),
          sizeBytes: v.number(),
          changeNote: v.string(),
          storageId: v.union(v.id('_storage'), v.null()),
          storageKey: v.string(),
        }),
      ),
      authorId: v.id('users'),
      confidential: v.boolean(),
      tags: v.array(v.string()),
      description: v.string(),
      ocrText: v.union(v.string(), v.null()),
      ocrStatus: v.string(),
      ocrAttempts: v.number(),
      checkedOutById: v.union(v.id('users'), v.null()),
      checkedOutAt: v.union(v.string(), v.null()),
      createdAt: v.string(),
      updatedAt: v.string(),
    }),
  ),
  courtDates: v.array(courtDateSummary),
  tasks: v.array(taskRow),
  notes: v.array(
    v.object({
      id: v.id('notes'),
      caseId: v.id('cases'),
      body: v.string(),
      authorId: v.id('users'),
      createdAt: v.string(),
      internalOnly: v.boolean(),
      mentions: v.array(v.id('users')),
    }),
  ),
  statusChanges: v.array(
    v.object({
      id: v.id('statusChanges'),
      caseId: v.id('cases'),
      from: v.union(caseStatusValidator, v.null()),
      to: caseStatusValidator,
      reason: v.string(),
      byUserId: v.id('users'),
      at: v.string(),
    }),
  ),
  timeline: v.array(
    v.object({
      id: v.string(),
      type: v.string(),
      at: v.string(),
      actorId: v.union(v.string(), v.null()),
      caseId: v.union(v.string(), v.null()),
      refId: v.union(v.string(), v.null()),
      data: v.any(),
    }),
  ),
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const notificationRow = v.object({
  id: v.id('notifications'),
  userId: v.id('users'),
  type: v.string(),
  title: v.string(),
  body: v.string(),
  caseId: v.union(v.id('cases'), v.null()),
  link: v.union(v.string(), v.null()),
  channels: v.array(v.string()),
  priority: v.union(v.literal('normal'), v.literal('high')),
  read: v.boolean(),
  at: v.string(),
});

// ---------------------------------------------------------------------------
// Audit rows
// ---------------------------------------------------------------------------

export const auditRow = v.object({
  id: v.id('auditLog'),
  at: v.string(),
  actorId: v.union(v.id('users'), v.null()),
  actorLabel: v.string(),
  action: v.string(),
  entity: v.string(),
  entityId: v.string(),
  entityLabel: v.string(),
  ipAddress: v.union(v.string(), v.null()),
  userAgent: v.union(v.string(), v.null()),
  outcome: v.union(v.literal('success'), v.literal('failure')),
  metadata: v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
});

export const paginatedAudit = v.object({
  rows: v.array(auditRow),
  total: v.number(),
  page: v.number(),
  pageSize: v.number(),
  pageCount: v.number(),
});

// ---------------------------------------------------------------------------
// Saved views & backups
// ---------------------------------------------------------------------------

export const savedViewRow = v.object({
  id: v.id('savedViews'),
  name: v.string(),
  ownerId: v.id('users'),
  entity: v.string(),
  filters: v.string(),
  shared: v.boolean(),
  createdAt: v.string(),
});

export const backupRow = v.object({
  id: v.id('backups'),
  startedAt: v.string(),
  completedAt: v.union(v.string(), v.null()),
  type: v.string(),
  scope: v.string(),
  sizeGb: v.number(),
  location: v.string(),
  status: v.string(),
  storageId: v.union(v.id('_storage'), v.null()),
  triggeredById: v.union(v.id('users'), v.null()),
  error: v.union(v.string(), v.null()),
});
