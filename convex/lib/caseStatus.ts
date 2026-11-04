import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import {
  hearingOutcomeValidator,
  type CaseStatus,
  type HearingOutcome,
} from '../shared/enums';

/**
 * HYPREP LCMS - case status transitions.
 *
 * Two mutations need the status-change write: `api.cases.changeCaseStatus`, the
 * explicit "move this matter to the next stage" action, and
 * `api.courtDates.recordOutcome`, which follows the outcome recorded in open
 * court with the status the diary expects. A Convex mutation cannot call
 * another mutation, so the shared write lives here as a plain helper and both
 * call it - one implementation, one audit trail shape, no drift.
 *
 * The follow-on map mirrors the prototype's `recordOutcome`, which is the
 * source of truth for what a given outcome means to the register:
 *
 *   Adjourned            -> Adjourned
 *   Heard                -> Heard
 *   Part-Heard           -> Pending
 *   Judgment Delivered   -> Judgment Delivered
 *   Ruling Delivered     -> Pending
 *   Settled              -> Concluded
 *   Struck Out           -> Concluded
 *
 * `Judgment Reserved` and `Not Sat` have no follow-on: the matter's status is
 * unchanged by a judgment the court has not yet delivered, or by a sitting that
 * did not take place.
 */
export const STATUS_FOLLOW_ON: Partial<Record<HearingOutcome, CaseStatus>> = {
  Adjourned: 'Adjourned',
  Heard: 'Heard',
  'Part-Heard': 'Pending',
  'Judgment Delivered': 'Judgment Delivered',
  'Ruling Delivered': 'Pending',
  Settled: 'Concluded',
  'Struck Out': 'Concluded',
};

/** The follow-on status for an outcome, or `null` where the matter is unchanged. */
export function followOnStatus(outcome: HearingOutcome): CaseStatus | null {
  return STATUS_FOLLOW_ON[outcome] ?? null;
}

export const hearingOutcome = hearingOutcomeValidator;

/**
 * Writes one status change and its opening history row.
 *
 * Both callers pass the case document they have already loaded, so this is a
 * pure write and cannot silently touch a matter the caller cannot see - access
 * control stays with the caller, which is where the audit entry belongs too.
 *
 * Returns `false` when the status is unchanged (a no-op), which lets the caller
 * skip its audit row rather than recording a change that did not happen.
 */
export async function writeStatusChange(
  ctx: MutationCtx,
  caseId: Id<'cases'>,
  previousStatus: CaseStatus,
  to: CaseStatus,
  reason: string,
  byUserId: Id<'users'>,
  at: string,
): Promise<boolean> {
  if (previousStatus === to) return false;

  await ctx.db.patch(caseId, { status: to, updatedAt: at });
  await ctx.db.insert('statusChanges', {
    caseId,
    from: previousStatus,
    to,
    reason,
    byUserId,
    at,
  });

  return true;
}
