import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import type { AccessActor, CaseAccessFields } from './access';

/**
 * HYPREP LCMS - the access oracle. **Test-only.**
 *
 * This is the rule as the client-side prototype implemented it: scan every
 * matter in the register, filter with the predicate, done. It is what
 * `access.ts` replaces, and it exists here so `access.test.ts` can assert that
 * replacing it changed the answer in exactly one intended way and no others.
 *
 * Two independent things could go wrong in the migration, and this catches both:
 *
 *   - **The predicate.** Reordering the gates and inserting the confidential
 *     check could have altered who sees what. The oracle pins the old answer so
 *     the difference can be measured rather than assumed.
 *   - **The projection.** `caseMembers` is derived state, and a bug in
 *     `caseMemberRows` would produce an index that quietly disagrees with the
 *     arrays it was built from - a lawyer locked out of their own matter, or
 *     worse, a stakeholder let into someone else's. The oracle never consults
 *     the join table, so any disagreement is the projection's fault.
 *
 * It is deliberately the slow, obvious implementation. That is the point: an
 * oracle that shared code with the thing it checks would confirm nothing. No
 * production module may import it.
 *
 * Delete this file, and `access.test.ts`'s comparison suites, once the register
 * has run on `access.ts` long enough to trust it. Until then the cost of keeping
 * it is one unused file, and the cost of not having it is a silent
 * confidentiality breach.
 */

/**
 * The predicate exactly as `src/lib/selectors/cases.ts:126-140` had it.
 *
 * Transcribed rather than adapted, including the parts that turned out to be
 * wrong. `confidential` is absent because the client never checked it - the
 * missing gate is the whole finding, so removing it here would erase the
 * evidence. `canViewAll` is a parameter for the same reason: the client received
 * it pre-resolved from `can('case.view.all')` rather than looking it up.
 */
export function oracleCanAccess(
  record: CaseAccessFields,
  userId: Id<'users'> | null,
  canViewAll: boolean,
): boolean {
  if (userId === null) return false;

  if (record.restrictedToUserIds.length && !record.restrictedToUserIds.includes(userId)) {
    return false;
  }
  if (canViewAll) return true;
  return (
    record.matterOwnerId === userId ||
    record.assigneeIds.includes(userId) ||
    record.externalCounselIds.includes(userId) ||
    record.stakeholderIds.includes(userId)
  );
}

/**
 * The oracle's answer to "which matters can this user see", by brute force.
 *
 * A full table scan for every user on every read - the performance cliff that
 * justified the join table in the first place. Acceptable in a test over a
 * corpus of a few dozen matters; fatal in production somewhere in the low
 * thousands.
 */
export async function oracleVisibleCaseIds(
  ctx: { db: QueryCtx['db'] },
  actor: AccessActor,
): Promise<Set<Id<'cases'>>> {
  const canViewAll = actor.permissions.has('case.view.all');
  const all = await ctx.db.query('cases').collect();
  const visible = new Set<Id<'cases'>>();
  for (const record of all) {
    if (oracleCanAccess(record, actor.userId, canViewAll)) visible.add(record._id);
  }
  return visible;
}
