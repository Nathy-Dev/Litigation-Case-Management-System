import { v, type Infer } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, internalQuery } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import { authedMutation, authedQuery, type ActorMutationCtx } from './lib/functions';
import {
  canAccessCase,
  loadAccessibleCase,
  memberCaseIds,
  type AccessActor,
  type CaseAccessFields,
} from './lib/access';
import { nowIso, recomputeCaseRollups, syncCaseMembers, touchTagUsage, buildCaseSearchText } from './lib/rollups';
import { buildRow, loadCourt, loadCaseType, loadUser, type CaseRowOut } from './lib/rows';
import { caseDetail } from './shared/query';
import {
  casePriorityValidator,
  caseStatusValidator,
  partyRoleValidator,
  partyTypeValidator,
  caseLinkTypeValidator,
  type CasePriority,
} from './shared/enums';
import { paginatedCaseRows } from './shared/query';
import { buildTimeline, type TimelineSources } from './shared/timeline';

/**
 * HYPREP LCMS - the matter register and its lifecycle.
 *
 * Every mutation that changes a matter's membership arrays, status, court
 * dates, tasks or documents runs the derived-state maintainers in the same
 * transaction (`syncCaseMembers`, `recomputeCaseRollups`, `touchTagUsage`) so
 * the access index and the sortable rollups can never drift from the source of
 * truth.
 *
 * All queries enforce row-level visibility in the query itself: a caller that
 * cannot see a matter gets no row, not a row it must not see. See
 * `lib/access.ts` for the visibility model.
 */

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

const partyInput = v.object({
  id: v.string(),
  name: v.string(),
  role: partyRoleValidator,
  type: partyTypeValidator,
  email: v.union(v.string(), v.null()),
  phone: v.union(v.string(), v.null()),
  address: v.union(v.string(), v.null()),
  representedBy: v.union(v.string(), v.null()),
});

const relatedCaseInput = v.object({
  caseId: v.id('cases'),
  linkType: caseLinkTypeValidator,
  note: v.string(),
});

const caseInput = v.object({
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
  parties: v.array(partyInput),
  relatedCases: v.array(relatedCaseInput),
  tags: v.array(v.string()),
  confidential: v.boolean(),
  restrictedToUserIds: v.array(v.id('users')),
  summary: v.string(),
  reliefSought: v.string(),
  presidingJudge: v.union(v.string(), v.null()),
});

const listArgs = v.object({
  filters: v.optional(
    v.object({
      query: v.optional(v.string()),
      status: v.optional(v.array(caseStatusValidator)),
      priority: v.optional(v.array(casePriorityValidator)),
      courtIds: v.optional(v.array(v.id('courts'))),
      caseTypeIds: v.optional(v.array(v.id('caseTypes'))),
      ownerIds: v.optional(v.array(v.id('users'))),
      tags: v.optional(v.array(v.string())),
      teamIds: v.optional(v.array(v.id('teams'))),
      confidentialOnly: v.optional(v.boolean()),
      includeArchived: v.optional(v.boolean()),
      hearingWithinDays: v.optional(v.number()),
      filedFrom: v.optional(v.string()),
      filedTo: v.optional(v.string()),
      minClaimValue: v.optional(v.number()),
    }),
  ),
  sort: v.optional(
    v.object({
      key: v.union(
        v.literal('caseId'),
        v.literal('title'),
        v.literal('courtName'),
        v.literal('status'),
        v.literal('priority'),
        v.literal('nextHearing'),
        v.literal('filingDate'),
        v.literal('claimValue'),
        v.literal('ageDays'),
      ),
      dir: v.union(v.literal('asc'), v.literal('desc')),
    }),
  ),
  page: v.optional(v.number()),
  pageSize: v.optional(v.number()),
});

type ListArgs = Infer<typeof listArgs>;

const PRIORITY_ORDER: Record<CasePriority, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

function matchesQuery(haystack: string, query: string): boolean {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  if (terms.length === 0) return true;
  const source = haystack.toLowerCase();
  return terms.every((term) => source.includes(term));
}

function sortRows(rows: CaseRowOut[], sort: NonNullable<ListArgs['sort']>): CaseRowOut[] {
  const factor = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (sort.key) {
      case 'priority':
        return (PRIORITY_ORDER[a.record.priority] - PRIORITY_ORDER[b.record.priority]) * factor;
      case 'claimValue':
        return ((a.record.claimValue ?? 0) - (b.record.claimValue ?? 0)) * factor;
      case 'ageDays':
        return (a.ageDays - b.ageDays) * factor;
      case 'nextHearing': {
        const left = a.nextHearing?.startsAt ?? '';
        const right = b.nextHearing?.startsAt ?? '';
        if (!left && !right) return 0;
        if (!left) return 1;
        if (!right) return -1;
        return left.localeCompare(right) * factor;
      }
      case 'filingDate':
        return (a.record.filingDate ?? '').localeCompare(b.record.filingDate ?? '') * factor;
      case 'courtName':
        return a.courtName.localeCompare(b.courtName) * factor;
      case 'title':
        return a.record.title.localeCompare(b.record.title) * factor;
      case 'status':
        return a.record.status.localeCompare(b.record.status) * factor;
      case 'caseId':
      default:
        return a.record.caseId.localeCompare(b.record.caseId) * factor;
    }
  });
}

// ---------------------------------------------------------------------------
// Access helpers
// ---------------------------------------------------------------------------

/**
 * The case ids the actor may see, whatever the source of the grant.
 *
 * For a register-wide role the candidate set is the whole table - the
 * `caseMembers` projection is what *narrows* a per-user caseload, and a role
 * with `case.view.all` has nothing to narrow. Either way each document is
 * re-checked against `canAccessCase`, so the restricted list and the
 * confidential flag are enforced on both paths.
 */
export async function visibleCaseIds(
  ctx: QueryCtx,
  actor: AccessActor,
): Promise<Set<Id<'cases'>>> {
  const ids = new Set<Id<'cases'>>(await memberCaseIds(ctx, actor.userId));

  if (actor.permissions.has('case.view.all')) {
    const all = await ctx.db.query('cases').collect();
    for (const record of all) {
      if (canAccessCase(record, actor)) ids.add(record._id);
    }
  } else {
    // Non-register-wide roles: the membership index is the candidate set, but
    // each candidate is re-checked so a stale or restricted member row can
    // never grant what the predicate denies.
    for (const id of [...ids]) {
      const record = await ctx.db.get(id);
      if (record === null || !canAccessCase(record, actor)) ids.delete(id);
    }
  }

  return ids;
}

// ---------------------------------------------------------------------------
// Case ID generation
// ---------------------------------------------------------------------------

/**
 * Allocates the next human-readable matter number for a year.
 *
 * Convex mutations are serialisable, so read-increment-write on the `counters`
 * row is atomic without any explicit locking: two creates cannot hand out the
 * same number.
 */
async function nextCaseNumber(ctx: { db: ActorMutationCtx['db'] }, year: string): Promise<number> {
  const name = `case:${year}`;
  const counter = await ctx.db.query('counters').withIndex('by_name', (q) => q.eq('name', name)).unique();
  const next = (counter?.value ?? 0) + 1;
  if (counter === null) {
    await ctx.db.insert('counters', { name, value: next });
  } else {
    await ctx.db.patch(counter._id, { value: next });
  }
  return next;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * The register, visibility applied in the query.
 *
 * The caller's visible case ids come from the `caseMembers` index - the
 * projection kept for exactly this hot path - so a READ_ONLY stakeholder
 * scanning ten thousand matters does not scan ten thousand matters. Filtering,
 * sorting and pagination happen here, over the same enriched rows the client
 * used to build for itself.
 */
export const list = authedQuery({
  // Any signed-in user may read the register; `visibleCaseIds` narrows it to
  // their own caseload for roles without `case.view.all`, exactly the way a
  // READ_ONLY stakeholder or briefed counsel is meant to see only their
  // matters. `case.view.all` is about *scope*, and scope is enforced in the
  // query body, not by refusing the whole read.
  permission: null,
  args: listArgs,
  returns: paginatedCaseRows,
  handler: async (ctx, { filters, sort, page, pageSize }) => {
    const actor = ctx.actor;
    const ids = await visibleCaseIds(ctx, actor.access);
    if (ids.size === 0) {
      return { rows: [], total: 0, page: 1, pageSize: pageSize ?? 25, pageCount: 1 };
    }

    const now = new Date();
    const cases: Doc<'cases'>[] = [];
    for (const id of ids) {
      const record = await ctx.db.get(id);
      if (record !== null) cases.push(record);
    }

    // One pass of reference lookups so the N+1 join is a map, not a fan of
    // queries. Rows with a missing court/type/owner fall back to '—'.
    const courtById = new Map<Id<'courts'>, Doc<'courts'>>();
    const typeById = new Map<Id<'caseTypes'>, Doc<'caseTypes'>>();
    const userById = new Map<Id<'users'>, Doc<'users'>>();
    for (const record of cases) {
      if (!courtById.has(record.courtId)) {
        const court = await loadCourt(ctx, record.courtId);
        if (court) courtById.set(record.courtId, court);
      }
      if (!typeById.has(record.caseTypeId)) {
        const type = await loadCaseType(ctx, record.caseTypeId);
        if (type) typeById.set(record.caseTypeId, type);
      }
      if (!userById.has(record.matterOwnerId)) {
        const owner = await loadUser(ctx, record.matterOwnerId);
        if (owner) userById.set(record.matterOwnerId, owner);
      }
    }

    // Rollups are materialised on the case doc; next/last hearing come from the
    // by_case index of the courtDates table - two reads per case, bounded.
    const hearingByCase = new Map<Id<'cases'>, Doc<'courtDates'>[]>();
    for (const record of cases) {
      const sittings = await ctx.db
        .query('courtDates')
        .withIndex('by_case', (q) => q.eq('caseId', record._id))
        .collect();
      hearingByCase.set(record._id, sittings);
    }

    const rows: CaseRowOut[] = [];
    for (const record of cases) {
      const sittings = hearingByCase.get(record._id) ?? [];
      const upcoming = sittings
        .filter((sitting) => !sitting.outcome && Date.parse(sitting.startsAt) >= now.getTime())
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      const past = sittings
        .filter((sitting) => sitting.outcome !== null)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      rows.push(
        await buildRow(ctx, record, {
          court: courtById.get(record.courtId),
          caseType: typeById.get(record.caseTypeId),
          owner: userById.get(record.matterOwnerId),
          nextHearing: upcoming[0] ?? null,
          lastHearing: past[past.length - 1] ?? null,
        }, now),
      );
    }

    const matched = rows.filter((row) => {
      const { record } = row;
      const f = filters ?? {};

      if (!f.includeArchived && record.status === 'Archived') return false;
      if (f.status?.length && !f.status.includes(record.status)) return false;
      if (f.priority?.length && !f.priority.includes(record.priority)) return false;
      if (f.courtIds?.length && !f.courtIds.includes(record.courtId)) return false;
      if (f.caseTypeIds?.length && !f.caseTypeIds.includes(record.caseTypeId)) return false;
      if (f.ownerIds?.length && !f.ownerIds.includes(record.matterOwnerId)) return false;
      if (f.teamIds?.length && (!record.teamId || !f.teamIds.includes(record.teamId))) return false;
      if (f.tags?.length && !f.tags.some((tag) => record.tags.includes(tag))) return false;
      if (f.confidentialOnly && !record.confidential) return false;
      if (f.minClaimValue != null && (record.claimValue ?? 0) < f.minClaimValue) return false;
      if (f.filedFrom && (record.filingDate ?? '') < f.filedFrom) return false;
      if (f.filedTo && (record.filingDate ?? '') > f.filedTo) return false;

      if (f.hearingWithinDays != null) {
        const days = row.nextHearing
          ? Math.floor((Date.parse(row.nextHearing.startsAt) - now.getTime()) / 86_400_000)
          : null;
        if (days == null || days > f.hearingWithinDays) return false;
      }

      if (f.query) {
        const haystack = [
          record.caseId,
          record.caseReference ?? '',
          record.title,
          record.suitNumber ?? '',
          record.summary,
          record.presidingJudge ?? '',
          row.courtName,
          row.caseTypeName,
          row.partiesLabel,
          row.owner?.fullName ?? '',
          record.tags.join(' '),
          record.parties.map((party) => party.name).join(' '),
        ].join(' ');
        if (!matchesQuery(haystack, f.query)) return false;
      }

      return true;
    });

    const ordered = sort ? sortRows(matched, sort) : matched;
    const size = pageSize ?? 25;
    const safePage = Math.max(1, page ?? 1);
    const pageCount = Math.max(1, Math.ceil(ordered.length / size));
    const index = Math.min(safePage, pageCount);

    return {
      rows: ordered.slice((index - 1) * size, index * size) as CaseRowOut[],
      total: ordered.length,
      page: index,
      pageSize: size,
      pageCount,
    };
  },
});

/**
 * The full detail bundle for one matter: the row plus every child collection,
 * access-checked in the query, one subscription for the whole page.
 *
 * The permission is the *read* grant for a matter the caller is attached to
 * (`case.view.assigned`); the deeper access check happens inside the handler,
 * so a caller who is not attached to this particular matter gets no bundle even
 * if they hold the general read grant.
 */
export const getDetail = authedQuery({
  permission: 'case.view.assigned',
  args: { caseId: v.id('cases') },
  returns: caseDetail,
  handler: async (ctx, { caseId }) => {
    const record = await loadAccessibleCase(ctx, caseId, ctx.actor.access);
    const now = new Date();

    const [court, caseType, owner, sittings, tasks, documents, notes, statusChanges] =
      await Promise.all([
        loadCourt(ctx, record.courtId),
        loadCaseType(ctx, record.caseTypeId),
        loadUser(ctx, record.matterOwnerId),
        ctx.db.query('courtDates').withIndex('by_case', (q) => q.eq('caseId', caseId)).collect(),
        ctx.db.query('tasks').withIndex('by_case', (q) => q.eq('caseId', caseId)).collect(),
        ctx.db.query('documents').withIndex('by_case', (q) => q.eq('caseId', caseId)).collect(),
        ctx.db.query('notes').withIndex('by_case', (q) => q.eq('caseId', caseId)).collect(),
        ctx.db.query('statusChanges').withIndex('by_case', (q) => q.eq('caseId', caseId)).collect(),
      ]);

    const upcoming = sittings
      .filter((sitting) => !sitting.outcome && Date.parse(sitting.startsAt) >= now.getTime())
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const past = sittings
      .filter((sitting) => sitting.outcome !== null)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

    // Internal notes are hidden from EXTERNAL_COUNSEL and READ_ONLY - the two
    // roles that never hold `note.create` - exactly as `notes.list` does, so
    // the detail bundle and the notes tab can never disagree about what an
    // external reader may see.
    const hidesInternal = ctx.actor.user.role === 'EXTERNAL_COUNSEL' || ctx.actor.user.role === 'READ_ONLY';
    const visibleNotes = hidesInternal ? notes.filter((note) => !note.internalOnly) : notes;

    const row = await buildRow(ctx, record, {
      court,
      caseType,
      owner,
      nextHearing: upcoming[0] ?? null,
      lastHearing: past[past.length - 1] ?? null,
    }, now);

    const timelineSources: TimelineSources = {
      cases: [
        {
          id: record._id,
          caseId: record.caseId,
          caseReference: record.caseReference,
          parties: record.parties,
          externalCounselIds: record.externalCounselIds,
          matterOwnerId: record.matterOwnerId,
          createdById: record.createdById,
          createdAt: record.createdAt,
          filingDate: record.filingDate,
          archivedAt: record.archivedAt,
          archivedById: record.archivedAt ? null : null,
        },
      ],
      statusChanges: statusChanges.map((change) => ({
        id: change._id,
        caseId: change.caseId,
        from: change.from,
        to: change.to,
        reason: change.reason,
        byUserId: change.byUserId,
        at: change.at,
      })),
      documents: documents.map((document) => ({
        id: document._id,
        caseId: document.caseId,
        name: document.name,
        versions: document.versions,
        checkedOutById: document.checkedOutById,
        checkedOutAt: document.checkedOutAt,
      })),
      courtDates: sittings.map((sitting) => ({
        id: sitting._id,
        caseId: sitting.caseId,
        startsAt: sitting.startsAt,
        purpose: sitting.purpose,
        judge: sitting.judge,
        courtRoom: sitting.courtRoom,
        createdById: sitting.createdById,
        createdAt: sitting.createdAt,
        outcome: sitting.outcome,
        outcomeNotes: sitting.outcomeNotes,
        outcomeRecordedAt: sitting.outcomeRecordedAt,
        outcomeRecordedById: sitting.outcomeRecordedById,
        adjournedToDateId: sitting.adjournedToDateId,
      })),
      tasks: tasks.map((task) => ({
        id: task._id,
        caseId: task.caseId,
        title: task.title,
        dueDate: task.dueDate,
        priority: task.priority,
        createdById: task.createdById,
        createdAt: task.createdAt,
        ownerId: task.ownerId,
        completedAt: task.completedAt,
      })),
      notes: visibleNotes.map((note) => ({
        id: note._id,
        caseId: note.caseId,
        body: note.body,
        internalOnly: note.internalOnly,
        authorId: note.authorId,
        createdAt: note.createdAt,
      })),
    };

    return {
      row,
      documents: documents.map((document) => ({
        id: document._id,
        caseId: document.caseId,
        name: document.name,
        documentTypeId: document.documentTypeId,
        format: document.format,
        currentVersion: document.currentVersion,
        versions: document.versions.map((version) => ({
          version: version.version,
          uploadedById: version.uploadedById,
          uploadedAt: version.uploadedAt,
          sizeBytes: version.sizeBytes,
          changeNote: version.changeNote,
          storageId: version.storageId,
          storageKey: version.storageKey,
        })),
        authorId: document.authorId,
        confidential: document.confidential,
        tags: document.tags,
        description: document.description,
        ocrText: document.ocrText,
        ocrStatus: document.ocrStatus,
        ocrAttempts: document.ocrAttempts,
        checkedOutById: document.checkedOutById,
        checkedOutAt: document.checkedOutAt,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
      })),
      courtDates: sittings.map((sitting) => ({
        id: sitting._id,
        caseId: sitting.caseId,
        startsAt: sitting.startsAt,
        durationMinutes: sitting.durationMinutes,
        courtId: sitting.courtId,
        courtRoom: sitting.courtRoom,
        judge: sitting.judge,
        purpose: sitting.purpose,
        notes: sitting.notes,
        attendeeIds: sitting.attendeeIds,
        reminderOffsetsHours: sitting.reminderOffsetsHours,
        outcome: sitting.outcome,
        outcomeNotes: sitting.outcomeNotes,
        outcomeRecordedById: sitting.outcomeRecordedById,
        outcomeRecordedAt: sitting.outcomeRecordedAt,
        adjournedToDateId: sitting.adjournedToDateId,
        createdById: sitting.createdById,
        createdAt: sitting.createdAt,
      })),
      tasks: tasks.map((task) => ({
        id: task._id,
        caseId: task.caseId,
        title: task.title,
        description: task.description,
        ownerId: task.ownerId,
        assignedTeamId: task.assignedTeamId,
        dueDate: task.dueDate,
        priority: task.priority,
        status: task.status,
        checklist: task.checklist,
        attachmentDocumentIds: task.attachmentDocumentIds,
        createdById: task.createdById,
        createdAt: task.createdAt,
        completedAt: task.completedAt,
        workflowTemplateId: task.workflowTemplateId,
      })),
      notes: visibleNotes.map((note) => ({
        id: note._id,
        caseId: note.caseId,
        body: note.body,
        authorId: note.authorId,
        createdAt: note.createdAt,
        internalOnly: note.internalOnly,
        mentions: note.mentions,
      })),
      statusChanges: statusChanges.map((change) => ({
        id: change._id,
        caseId: change.caseId,
        from: change.from,
        to: change.to,
        reason: change.reason,
        byUserId: change.byUserId,
        at: change.at,
      })),
      timeline: buildTimeline(timelineSources),
    };
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Creates a matter and wires its access index and rollups in the same write. */
export const createCase = authedMutation({
  permission: 'case.create',
  audit: { entity: 'Case', action: 'Created case' },
  args: { input: caseInput },
  handler: async (ctx, { input }) => {
    const at = nowIso();
    const year = new Date().getUTCFullYear().toString();
    const sequence = await nextCaseNumber(ctx, year);
    const caseId = `HYP/LCMS/${year}/${String(sequence).padStart(4, '0')}`;

    const court = await ctx.db.get(input.courtId);
    const caseType = await ctx.db.get(input.caseTypeId);
    const owner = await ctx.db.get(input.matterOwnerId);

    const id = await ctx.db.insert('cases', {
      ...input,
      caseId,
      createdById: ctx.actor.user._id,
      createdAt: at,
      updatedAt: at,
      archivedAt: null,
      nextHearingAt: null,
      lastHearingAt: null,
      openTaskCount: 0,
      overdueTaskCount: 0,
      documentCount: 0,
      searchText: buildCaseSearchText(
        {
          caseId,
          caseReference: input.caseReference,
          title: input.title,
          suitNumber: input.suitNumber,
          summary: input.summary,
          presidingJudge: input.presidingJudge,
          tags: input.tags,
          parties: input.parties,
        },
        court?.name ?? '',
        caseType?.name ?? '',
        owner?.fullName ?? '',
      ),
    });

    const record: CaseAccessFields = {
      _id: id,
      matterOwnerId: input.matterOwnerId,
      assigneeIds: input.assigneeIds,
      externalCounselIds: input.externalCounselIds,
      stakeholderIds: input.stakeholderIds,
      restrictedToUserIds: input.restrictedToUserIds,
      confidential: input.confidential,
    };

    await syncCaseMembers(ctx, id, record);
    await touchTagUsage(ctx, [], input.tags);

    await ctx.audit({
      entityId: id,
      entityLabel: caseId,
      metadata: { status: input.status, confidential: input.confidential },
    });

    return { id, caseId };
  },
});

/** Edits a matter, re-syncing the access index and tag usage in the same write. */
export const updateCase = authedMutation({
  permission: 'case.edit',
  audit: { entity: 'Case', action: 'Updated case' },
  args: { caseId: v.id('cases'), input: caseInput },
  handler: async (ctx, { caseId, input }) => {
    const record = await loadAccessibleCase(ctx, caseId, ctx.actor.access);
    const court = await ctx.db.get(input.courtId);
    const caseType = await ctx.db.get(input.caseTypeId);
    const owner = await ctx.db.get(input.matterOwnerId);
    const at = nowIso();

    await ctx.db.patch(caseId, {
      ...input,
      updatedAt: at,
      searchText: buildCaseSearchText(
        {
          caseId: record.caseId,
          caseReference: input.caseReference,
          title: input.title,
          suitNumber: input.suitNumber,
          summary: input.summary,
          presidingJudge: input.presidingJudge,
          tags: input.tags,
          parties: input.parties,
        },
        court?.name ?? '',
        caseType?.name ?? '',
        owner?.fullName ?? '',
      ),
    });

    const next: CaseAccessFields = {
      _id: caseId,
      matterOwnerId: input.matterOwnerId,
      assigneeIds: input.assigneeIds,
      externalCounselIds: input.externalCounselIds,
      stakeholderIds: input.stakeholderIds,
      restrictedToUserIds: input.restrictedToUserIds,
      confidential: input.confidential,
    };
    await syncCaseMembers(ctx, caseId, next);
    await touchTagUsage(ctx, record.tags, input.tags);

    await ctx.audit({
      entityId: caseId,
      entityLabel: record.caseId,
      metadata: { status: input.status, confidential: input.confidential },
    });

    return { id: caseId };
  },
});

/** Moves a matter to a new status, writing the history row the timeline reads. */
export const changeCaseStatus = authedMutation({
  permission: 'case.status.change',
  audit: { entity: 'Case', action: 'Changed case status' },
  args: {
    caseId: v.id('cases'),
    to: caseStatusValidator,
    reason: v.string(),
  },
  handler: async (ctx, { caseId, to, reason }) => {
    const record = await loadAccessibleCase(ctx, caseId, ctx.actor.access);
    const at = nowIso();

    await ctx.db.patch(caseId, { status: to, updatedAt: at });

    await ctx.db.insert('statusChanges', {
      caseId,
      from: record.status,
      to,
      reason,
      byUserId: ctx.actor.user._id,
      at,
    });

    await ctx.audit({
      entityId: caseId,
      entityLabel: record.caseId,
      metadata: { from: record.status, to },
    });

    return { id: caseId, status: to };
  },
});

/** Archives a matter (retention keeps concluded matters, it does not delete them). */
export const archiveCase = authedMutation({
  permission: 'case.archive',
  audit: { entity: 'Case', action: 'Archived case' },
  args: { caseId: v.id('cases') },
  handler: async (ctx, { caseId }) => {
    const record = await loadAccessibleCase(ctx, caseId, ctx.actor.access);
    const at = nowIso();
    await ctx.db.patch(caseId, { status: 'Archived', archivedAt: at, updatedAt: at });
    await ctx.audit({ entityId: caseId, entityLabel: record.caseId });
    return { id: caseId };
  },
});

/** Deletes a matter and its membership projection. Children are kept or deleted by their own paths. */
export const deleteCase = authedMutation({
  permission: 'case.delete',
  audit: { entity: 'Case', action: 'Deleted case' },
  args: { caseId: v.id('cases') },
  handler: async (ctx, { caseId }) => {
    const record = await loadAccessibleCase(ctx, caseId, ctx.actor.access);
    await ctx.db.delete(caseId);
    const members = await ctx.db.query('caseMembers').withIndex('by_case', (q) => q.eq('caseId', caseId)).collect();
    for (const row of members) await ctx.db.delete(row._id);
    await touchTagUsage(ctx, record.tags, []);
    await ctx.audit({ entityId: caseId, entityLabel: record.caseId });
    return { id: caseId };
  },
});

// ---------------------------------------------------------------------------
// Internal surface (crons, tools, REST)
// ---------------------------------------------------------------------------

/** Recomputes the rollups for every case - the nightly reconcile cron's driver. */
export const internalReconcileRollups = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cases = await ctx.db.query('cases').collect();
    for (const record of cases) {
      await recomputeCaseRollups(ctx, record._id);
    }
    return cases.length;
  },
});

/** The count of cases visible to a user - the dashboard's "my matters" source. */
export const internalVisibleCount = internalQuery({
  args: { userId: v.id('users') },
  returns: v.number(),
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db.query('caseMembers').withIndex('by_user', (q) => q.eq('userId', userId)).collect();
    return new Set(rows.map((row) => row.caseId)).size;
  },
});
