import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { toUserLite } from '../shared/query';
import type { CourtTier } from '../shared/enums';

/**
 * HYPREP LCMS - one-place lookups and the register-row projection.
 *
 * Every read path - the register, the dashboard, the reports, the exports -
 * needs the same joins (court name, matter-type name, owner) and the same
 * derived labels (parties label, age days, next/last sitting). If each built
 * those for itself they would drift; they are built here and each query reads
 * the answer.
 *
 * `caseRow` is the wire shape declared in `shared/query.ts`; the row the client
 * receives is *this* projection serialised through that validator, so the
 * return type here is inferred rather than written out.
 */

/**
 * Loads a reference doc by id, tolerant of a row deleted since the caller's
 * last read - a matter whose court was renamed renders `'—'` rather than
 * crashing the register.
 */
export async function loadCourt(ctx: QueryCtx, courtId: Id<'courts'>) {
  return (await ctx.db.get(courtId)) ?? null;
}

export async function loadCaseType(ctx: QueryCtx, caseTypeId: Id<'caseTypes'>) {
  return (await ctx.db.get(caseTypeId)) ?? null;
}

export async function loadUser(ctx: QueryCtx, userId: Id<'users'>) {
  return (await ctx.db.get(userId)) ?? null;
}

/**
 * Projects a `courtDates` document into the wire shape the register and detail
 * page render (`id` rather than `_id`). The rollups on the case document carry
 * the sortable `nextHearingAt`; the full row is what the page draws.
 */
export function toCourtDateSummary(
  sitting: Doc<'courtDates'>,
): {
  id: Id<'courtDates'>;
  caseId: Id<'cases'>;
  startsAt: string;
  durationMinutes: number;
  courtId: Id<'courts'>;
  courtRoom: string;
  judge: string;
  purpose: Doc<'courtDates'>['purpose'];
  notes: string;
  attendeeIds: Id<'users'>[];
  reminderOffsetsHours: number[];
  outcome: Doc<'courtDates'>['outcome'];
  outcomeNotes: string;
  outcomeRecordedById: Id<'users'> | null;
  outcomeRecordedAt: string | null;
  adjournedToDateId: Id<'courtDates'> | null;
  createdById: Id<'users'>;
  createdAt: string;
} {
  return {
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
  };
}

/** The display label for a case: "First party v. Second party (& n ors.)". */
export function partiesLabel(parties: readonly Pick<PartyRow, 'name' | 'role'>[]): string {
  const claimants = parties.filter((party) =>
    ['Plaintiff', 'Claimant', 'Appellant', 'Applicant'].includes(party.role),
  );
  const defendants = parties.filter((party) =>
    ['Defendant', 'Respondent'].includes(party.role),
  );
  const first = claimants[0]?.name ?? '—';
  const second = defendants[0]?.name ?? '—';
  return `${first} v. ${second}${defendants.length > 1 ? ` & ${defendants.length - 1} or.` : ''}`;
}

type PartyRow = Doc<'cases'>['parties'][number];

/** Whole-day age in days, clamped at zero - mirrors `src/lib/format.ts`. */
export function ageInDays(value: string | null | undefined, now: Date): number {
  if (!value) return 0;
  const start = Date.parse(value);
  if (Number.isNaN(start)) return 0;
  const dayMs = 86_400_000;
  return Math.max(0, Math.floor((now.getTime() - start) / dayMs));
}

/**
 * Builds one register row from the case document and the docs it joins to.
 *
 * The caller supplies the already-loaded reference docs (one call site's join
 * is another's already-in-hand), so the heavy queries that read many rows do
 * the loads once and this stays pure.
 */
export async function buildRow(
  ctx: QueryCtx,
  record: Doc<'cases'>,
  deps: {
    court?: Doc<'courts'> | null;
    caseType?: Doc<'caseTypes'> | null;
    owner?: Doc<'users'> | null;
    nextHearing?: Doc<'courtDates'> | null;
    lastHearing?: Doc<'courtDates'> | null;
  },
  now: Date,
) {
  const court = deps.court ?? (record.courtId ? await loadCourt(ctx, record.courtId) : null);
  const caseType =
    deps.caseType ?? (record.caseTypeId ? await loadCaseType(ctx, record.caseTypeId) : null);
  const owner = deps.owner ?? (record.matterOwnerId ? await loadUser(ctx, record.matterOwnerId) : null);

  const label = partiesLabel(record.parties);

  return {
    record: {
      id: record._id,
      caseId: record.caseId,
      caseReference: record.caseReference,
      title: record.title,
      suitNumber: record.suitNumber,
      courtId: record.courtId,
      caseTypeId: record.caseTypeId,
      status: record.status,
      priority: record.priority,
      filingDate: record.filingDate,
      claimValue: record.claimValue,
      matterOwnerId: record.matterOwnerId,
      assigneeIds: record.assigneeIds,
      externalCounselIds: record.externalCounselIds,
      stakeholderIds: record.stakeholderIds,
      teamId: record.teamId,
      parties: record.parties,
      relatedCases: record.relatedCases,
      tags: record.tags,
      confidential: record.confidential,
      restrictedToUserIds: record.restrictedToUserIds,
      summary: record.summary,
      reliefSought: record.reliefSought,
      presidingJudge: record.presidingJudge,
      createdById: record.createdById,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      archivedAt: record.archivedAt,
    },
    courtName: court?.name ?? '—',
    courtTier: (court?.tier ?? '—') as CourtTier | '—',
    caseTypeName: caseType?.name ?? '—',
    owner: owner ? toUserLite(owner) : null,
    partiesLabel: label,
    nextHearing: deps.nextHearing ? toCourtDateSummary(deps.nextHearing) : null,
    lastHearing: deps.lastHearing ? toCourtDateSummary(deps.lastHearing) : null,
    openTasks: record.openTaskCount,
    overdueTasks: record.overdueTaskCount,
    documentCount: record.documentCount,
    ageDays: ageInDays(record.filingDate ?? record.createdAt, now),
  };
}

/** The row shape, for the callers that need a type rather than an inference. */
export type CaseRowOut = Awaited<ReturnType<typeof buildRow>>;
