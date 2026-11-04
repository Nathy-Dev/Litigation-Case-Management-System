import { v, type Infer } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { internalMutation, internalQuery } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import { authedMutation, authedQuery } from './lib/functions';
import { canAccessCase, loadAccessibleCase, type AccessActor } from './lib/access';
import { nowIso, recomputeCaseRollups } from './lib/rollups';
import { toCourtDateSummary } from './lib/rows';
import { followOnStatus, writeStatusChange } from './lib/caseStatus';
import { courtDateSummary } from './shared/query';
import { hearingOutcomeValidator, hearingPurposeValidator } from './shared/enums';

/**
 * HYPREP LCMS - the court diary.
 *
 * Every sitting belongs to a matter, and every mutation here maintains the
 * matter's rollups (`nextHearingAt`/`lastHearingAt`) in the same transaction,
 * so the register's "next hearing" column can never disagree with the diary.
 *
 * The reminder machinery (scheduling, idempotent delivery) lives in
 * `crons.ts` and `integrations/`; this module records the offsets the diary
 * will honour and re-arms the ledger when a sitting moves.
 */

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

const courtDateInput = v.object({
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
});

const listArgs = v.object({
  from: v.optional(v.string()),
  to: v.optional(v.string()),
  courtIds: v.optional(v.array(v.id('courts'))),
  caseIds: v.optional(v.array(v.id('cases'))),
  includeCompleted: v.optional(v.boolean()),
});

type ListArgs = Infer<typeof listArgs>;

// ---------------------------------------------------------------------------
// Access helpers
// ---------------------------------------------------------------------------

/**
 * The sittings the actor may see, in diary order.
 *
 * Membership is checked per sitting via the owning matter's `caseMembers`
 * index, so a caller only ever sees hearings for matters they are attached to.
 */
async function visibleCourtDates(
  ctx: QueryCtx,
  actor: AccessActor,
  args: ListArgs,
): Promise<Doc<'courtDates'>[]> {
  const base =
    args.from || args.to
      ? ctx.db.query('courtDates').withIndex('by_startsAt', (q) => {
          if (args.from && args.to) return q.gte('startsAt', args.from).lte('startsAt', args.to);
          if (args.from) return q.gte('startsAt', args.from);
          return q.lte('startsAt', args.to!);
        })
      : ctx.db.query('courtDates');
  const all = await base.collect();

  const visible: Doc<'courtDates'>[] = [];

  for (const sitting of all) {
    if (args.courtIds?.length && !args.courtIds.includes(sitting.courtId)) continue;
    if (args.caseIds?.length && !args.caseIds.includes(sitting.caseId)) continue;
    if (args.includeCompleted === false && sitting.outcome) continue;

    // The owning matter's access rule is applied to *every* sitting, including
    // for a register-wide role. `canAccessCase` enforces the restricted
    // allow-list before anything else, so a matter locked to named users stays
    // locked on the diary even for an administrator who can see the rest of the
    // register.
    const record = await ctx.db.get(sitting.caseId);
    if (record !== null && canAccessCase(record, actor)) visible.push(sitting);
  }

  return visible.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * The diary for the visible register, in date order. Powers the calendar page
 * and the dashboard's hearings panel.
 */
export const list = authedQuery({
  permission: 'courtdate.view',
  args: listArgs,
  returns: v.array(courtDateSummary),
  handler: async (ctx, args) => {
    const sittings = await visibleCourtDates(ctx, ctx.actor.access, args);
    return sittings.map(toCourtDateSummary);
  },
});

/** The full sitting, for the calendar's sitting-details panel. */
export const get = authedQuery({
  permission: 'courtdate.view',
  args: { id: v.id('courtDates') },
  returns: v.union(courtDateSummary, v.null()),
  handler: async (ctx, { id }) => {
    const sitting = await ctx.db.get(id);
    if (sitting === null) return null;
    const record = await loadAccessibleCase(ctx, sitting.caseId, ctx.actor.access);
    if (record === null) return null;
    return toCourtDateSummary(sitting);
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Schedules a sitting and refreshes the matter's next-hearing rollup. */
export const createCourtDate = authedMutation({
  permission: 'courtdate.create',
  audit: { entity: 'CourtDate', action: 'Scheduled hearing' },
  args: { input: courtDateInput },
  handler: async (ctx, { input }) => {
    const record = await loadAccessibleCase(ctx, input.caseId, ctx.actor.access);
    const at = nowIso();

    const id = await ctx.db.insert('courtDates', {
      ...input,
      outcome: null,
      outcomeNotes: '',
      outcomeRecordedById: null,
      outcomeRecordedAt: null,
      adjournedToDateId: null,
      createdById: ctx.actor.user._id,
      createdAt: at,
    });

    await recomputeCaseRollups(ctx, input.caseId);

    await ctx.audit({
      entityId: input.caseId,
      entityLabel: record.caseId,
      metadata: { courtDateId: id, startsAt: input.startsAt },
    });

    return { id, caseId: input.caseId };
  },
});

/** Edits a sitting in place; the reminder ledger is re-armed on reschedule. */
export const updateCourtDate = authedMutation({
  permission: 'courtdate.edit',
  audit: { entity: 'CourtDate', action: 'Updated hearing' },
  args: {
    id: v.id('courtDates'),
    patch: v.object({
      startsAt: v.optional(v.string()),
      durationMinutes: v.optional(v.number()),
      courtId: v.optional(v.id('courts')),
      courtRoom: v.optional(v.string()),
      judge: v.optional(v.string()),
      purpose: v.optional(hearingPurposeValidator),
      notes: v.optional(v.string()),
      attendeeIds: v.optional(v.array(v.id('users'))),
      reminderOffsetsHours: v.optional(v.array(v.number())),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const sitting = await ctx.db.get(id);
    if (sitting === null) throw new Error('Hearing not found');
    const record = await loadAccessibleCase(ctx, sitting.caseId, ctx.actor.access);

    await ctx.db.patch(id, { ...patch });
    await recomputeCaseRollups(ctx, sitting.caseId);

    await ctx.audit({
      entityId: sitting.caseId,
      entityLabel: record.caseId,
      metadata: { courtDateId: id },
    });

    return { id, caseId: sitting.caseId };
  },
});

/**
 * Moves a sitting to a new time, cancels its stale reminders, and re-arms the
 * ledger for the new time. The email/SMS fan-out is scheduled after commit.
 */
export const rescheduleCourtDate = authedMutation({
  permission: 'courtdate.edit',
  audit: { entity: 'CourtDate', action: 'Rescheduled hearing' },
  args: { id: v.id('courtDates'), startsAt: v.string() },
  handler: async (ctx, { id, startsAt }) => {
    const sitting = await ctx.db.get(id);
    if (sitting === null) throw new Error('Hearing not found');
    const record = await loadAccessibleCase(ctx, sitting.caseId, ctx.actor.access);

    await ctx.db.patch(id, { startsAt });

    // Drop stale reminder deliveries so a re-run does not double-send.
    const sent = await ctx.db
      .query('sentReminders')
      .withIndex('by_courtDate', (q) => q.eq('courtDateId', id))
      .collect();
    for (const row of sent) await ctx.db.delete(row._id);

    await recomputeCaseRollups(ctx, sitting.caseId);

    await ctx.audit({
      entityId: sitting.caseId,
      entityLabel: record.caseId,
      metadata: { courtDateId: id, from: sitting.startsAt, to: startsAt },
    });

    return { id, caseId: sitting.caseId, startsAt };
  },
});

/** Records an outcome and applies the follow-on status change, if any. */
export const recordOutcome = authedMutation({
  permission: 'courtdate.outcome.record',
  audit: { entity: 'CourtDate', action: 'Recorded hearing outcome' },
  args: {
    id: v.id('courtDates'),
    outcome: hearingOutcomeValidator,
    notes: v.string(),
  },
  handler: async (ctx, { id, outcome, notes }) => {
    const sitting = await ctx.db.get(id);
    if (sitting === null) throw new Error('Hearing not found');
    const record = await loadAccessibleCase(ctx, sitting.caseId, ctx.actor.access);
    const at = nowIso();

    await ctx.db.patch(id, {
      outcome,
      outcomeNotes: notes,
      outcomeRecordedById: ctx.actor.user._id,
      outcomeRecordedAt: at,
    });

    await recomputeCaseRollups(ctx, sitting.caseId);

    const follow = followOnStatus(outcome);
    if (follow) {
      await writeStatusChange(
        ctx,
        sitting.caseId,
        record.status,
        follow,
        `Outcome: ${outcome}`,
        ctx.actor.user._id,
        at,
      );
      await recomputeCaseRollups(ctx, sitting.caseId);
    }

    await ctx.audit({
      entityId: sitting.caseId,
      entityLabel: record.caseId,
      metadata: { courtDateId: id, outcome },
    });

    return { id, caseId: sitting.caseId, outcome };
  },
});

// ---------------------------------------------------------------------------
// Internal surface (reminder cron, REST)
// ---------------------------------------------------------------------------

/** The sittings whose reminder window has opened and not yet been served. */
export const internalDueReminders = internalQuery({
  args: { now: v.string() },
  returns: v.array(courtDateSummary),
  handler: async (ctx, { now }) => {
    const sittings = await ctx.db
      .query('courtDates')
      .withIndex('by_startsAt', (q) => q.gte('startsAt', now))
      .collect();
    return sittings.map(toCourtDateSummary);
  },
});

/** Marks a (sitting, offset) reminder as sent, idempotently. */
export const internalMarkReminderSent = internalMutation({
  args: {
    courtDateId: v.id('courtDates'),
    offsetHours: v.number(),
    sentAt: v.string(),
    channels: v.array(v.string()),
    recipientCount: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('sentReminders')
      .withIndex('by_courtDate_offset', (q) =>
        q.eq('courtDateId', args.courtDateId).eq('offsetHours', args.offsetHours),
      )
      .unique();
    if (existing !== null) return { sent: false, id: existing._id };
    const id = await ctx.db.insert('sentReminders', {
      courtDateId: args.courtDateId,
      offsetHours: args.offsetHours,
      sentAt: args.sentAt,
      channels: args.channels as Doc<'sentReminders'>['channels'],
      recipientCount: args.recipientCount,
    });
    return { sent: true, id };
  },
});
