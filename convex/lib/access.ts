import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import type { CaseMemberKind, Permission } from '../shared/enums';

/**
 * HYPREP LCMS - row-level case access (TOR section 5).
 *
 * This is the security boundary. Every read of a matter, and every write to one,
 * passes through here, and a mistake in this file silently over-exposes
 * confidential and restricted matters rather than failing loudly. It is
 * therefore deliberately small, deliberately explicit, and checked against an
 * independent oracle (`accessOracle.ts`) over a generated corpus.
 *
 * ## The rule
 *
 * Evaluated in this order, first match wins:
 *
 * 1. **Restricted list.** If a matter names specific users, nobody outside that
 *    list sees it - not an administrator, not the system owner. An explicit
 *    allow-list is the strongest statement the register can make, so it is
 *    checked before anything that would otherwise grant access.
 * 2. **Membership.** Owner, assignee, briefed counsel or named stakeholder: you
 *    see the matters you are actually attached to.
 * 3. **Confidential flag.** A matter marked confidential is withheld from
 *    everyone else unless they hold `case.confidential.view`.
 * 4. **Register-wide scope.** `case.view.all` sees what is left.
 * 5. Otherwise, denied.
 *
 * ## Why membership is checked *before* the confidential gate
 *
 * `case.confidential.view` is held by SUPER_ADMIN, ADMIN and LEGAL_STAFF - but
 * not by CASE_OFFICER, and not by EXTERNAL_COUNSEL. Those two roles are
 * nonetheless attached to individual matters as a matter of routine, and some of
 * those matters are confidential. If the flag gated membership too, briefing
 * external counsel on a confidential matter would produce a file they cannot
 * open, and assigning a case officer to one would be a no-op.
 *
 * So the flag does what the register needs it to do: it stops a confidential
 * matter being *browsable* by everyone with register-wide scope, while the people
 * working the file keep their access. `case.confidential.view` is what lets you
 * see confidential matters you are **not** attached to.
 *
 * ## Relationship to the rule this replaces
 *
 * The client-side predicate this ports (`visibleToUser`) checked the restricted
 * list, then register-wide scope, then membership - and never consulted
 * `confidential` at all, despite `case.confidential.view` being a declared
 * permission. Two consequences:
 *
 *   - For non-confidential matters this rule is *exactly equivalent* to the old
 *     one. Reordering scope and membership changes nothing, because they are
 *     alternatives in a disjunction.
 *   - For confidential matters this rule is strictly narrower. That is the point:
 *     it closes a gap in which the confidential flag was only ever a list filter.
 *
 * Both properties are asserted by the corpus test, so the change in behaviour is
 * bounded to exactly the cases it was meant to affect.
 */

/**
 * The signed-in user, reduced to what an access decision needs.
 *
 * Permissions arrive already resolved from the `permissionMatrix` table - this
 * module never reads the matrix itself, so it cannot be fooled by a stale copy
 * and stays a pure function of its arguments.
 */
export interface AccessActor {
  userId: Id<'users'>;
  permissions: ReadonlySet<Permission>;
}

export function makeActor(
  userId: Id<'users'>,
  permissions: Iterable<Permission>,
): AccessActor {
  return { userId, permissions: new Set(permissions) };
}

/**
 * The fields an access decision reads, and only those.
 *
 * Structural rather than `Doc<'cases'>` so the predicate can be applied to a
 * projection, and so a test can build a case shape without inventing the thirty
 * unrelated fields a real document carries.
 */
export interface CaseAccessFields {
  _id: Id<'cases'>;
  matterOwnerId: Id<'users'>;
  assigneeIds: readonly Id<'users'>[];
  externalCounselIds: readonly Id<'users'>[];
  stakeholderIds: readonly Id<'users'>[];
  restrictedToUserIds: readonly Id<'users'>[];
  confidential: boolean;
}

/**
 * Membership kinds that *grant* access.
 *
 * `restricted` is deliberately absent. It mirrors `restrictedToUserIds`, which
 * narrows visibility rather than conferring it: being named on a matter's
 * restricted list does not give you access to that matter, it only means the
 * list does not exclude you. Treating it as a grant would turn every restricted
 * matter into one visible to precisely the people it was locked down for -
 * plausible-looking, and wrong.
 */
export const GRANTING_MEMBER_KINDS: readonly CaseMemberKind[] = [
  'owner',
  'assignee',
  'counsel',
  'stakeholder',
];

const GRANTING_KIND_SET: ReadonlySet<CaseMemberKind> = new Set(GRANTING_MEMBER_KINDS);

/** Whether the user is attached to the matter in any working capacity. */
export function isCaseMember(record: CaseAccessFields, userId: Id<'users'>): boolean {
  return (
    record.matterOwnerId === userId ||
    record.assigneeIds.includes(userId) ||
    record.externalCounselIds.includes(userId) ||
    record.stakeholderIds.includes(userId)
  );
}

/**
 * The access decision, as a pure predicate over one matter.
 *
 * This is the definition of the rule; everything else in this file is a way of
 * evaluating it without reading the whole register.
 */
export function canAccessCase(record: CaseAccessFields, actor: AccessActor): boolean {
  // 1. An explicit allow-list excludes everyone not on it, whatever they hold.
  if (record.restrictedToUserIds.length > 0 && !record.restrictedToUserIds.includes(actor.userId)) {
    return false;
  }

  // 2. The people working the file always see it.
  if (isCaseMember(record, actor.userId)) return true;

  // 3. Confidential matters are not browsable without the capability.
  if (record.confidential && !actor.permissions.has('case.confidential.view')) return false;

  // 4. Register-wide scope covers the rest.
  return actor.permissions.has('case.view.all');
}

// ---------------------------------------------------------------------------
// The membership projection
// ---------------------------------------------------------------------------

export interface CaseMemberRow {
  userId: Id<'users'>;
  kind: CaseMemberKind;
}

/**
 * Projects a matter's membership arrays into `caseMembers` rows.
 *
 * The arrays on the case document stay the source of truth; this table is a
 * derived index that exists because Convex cannot index an array for
 * containment. Any mutation touching `matterOwnerId`, `assigneeIds`,
 * `externalCounselIds`, `stakeholderIds` or `restrictedToUserIds` must rewrite
 * these rows in the same transaction, or a lawyer silently loses access to their
 * own matter.
 *
 * One user may legitimately appear under several kinds - an owner who is also a
 * named stakeholder - so rows are deduplicated per `(userId, kind)` pair rather
 * than per user. Duplicate ids within a single array collapse.
 */
export function caseMemberRows(record: CaseAccessFields): CaseMemberRow[] {
  const seen = new Set<string>();
  const rows: CaseMemberRow[] = [];

  const add = (userId: Id<'users'>, kind: CaseMemberKind) => {
    const key = `${userId}:${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ userId, kind });
  };

  add(record.matterOwnerId, 'owner');
  for (const userId of record.assigneeIds) add(userId, 'assignee');
  for (const userId of record.externalCounselIds) add(userId, 'counsel');
  for (const userId of record.stakeholderIds) add(userId, 'stakeholder');
  // Recorded so the reverse question - who is this matter locked down to - is
  // answerable from the index. Never a grant; see GRANTING_MEMBER_KINDS.
  for (const userId of record.restrictedToUserIds) add(userId, 'restricted');

  return rows;
}

// ---------------------------------------------------------------------------
// Evaluating the rule against the database
// ---------------------------------------------------------------------------

/** Just the `db` handle, so both query and mutation contexts satisfy it. */
type ReaderCtx = { db: QueryCtx['db'] };

/**
 * Case ids the actor is attached to, via the `by_user` index.
 *
 * This is the hot path the join table exists for: one index range read instead
 * of a scan of the register. Only granting kinds are returned - a `restricted`
 * row is not a grant.
 */
export async function memberCaseIds(
  ctx: ReaderCtx,
  userId: Id<'users'>,
): Promise<Set<Id<'cases'>>> {
  const rows = await ctx.db
    .query('caseMembers')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect();

  const ids = new Set<Id<'cases'>>();
  for (const row of rows) {
    if (GRANTING_KIND_SET.has(row.kind)) ids.add(row.caseId);
  }
  return ids;
}

/**
 * Whether the actor may see one specific matter.
 *
 * Reads the document and applies the predicate directly rather than consulting
 * the join table: at one document the index buys nothing, and going to the
 * source removes any chance of a stale projection granting access it should not.
 * `by_user_case` remains the right tool where the document is not wanted.
 */
export async function canAccessCaseId(
  ctx: ReaderCtx,
  caseId: Id<'cases'>,
  actor: AccessActor,
): Promise<boolean> {
  const record = await ctx.db.get(caseId);
  return record !== null && canAccessCase(record, actor);
}

/**
 * Fetches a matter, or throws if the actor may not see it.
 *
 * Deliberately indistinguishable between "no such matter" and "not yours": a
 * distinct "forbidden" error would confirm that a given suit number exists on
 * the register, which is itself information a stakeholder should not be able to
 * extract by guessing.
 */
export async function loadAccessibleCase(
  ctx: ReaderCtx,
  caseId: Id<'cases'>,
  actor: AccessActor,
) {
  const record = await ctx.db.get(caseId);
  if (record === null || !canAccessCase(record, actor)) {
    throw new Error('Matter not found.');
  }
  return record;
}

/**
 * Every matter the actor can see.
 *
 * Two strategies, chosen by scope:
 *
 *   - **Without `case.view.all`**, resolve candidates from the `by_user` index
 *     and check each. Work is proportional to the user's own caseload, which is
 *     the property the join table was introduced to get.
 *   - **With `case.view.all`**, the candidate set is the register itself, so
 *     there is nothing to narrow with and the table is walked.
 *
 * Either way the predicate is applied per document, so the restricted list and
 * the confidential flag are enforced on both paths.
 *
 * **This returns the whole visible register and is only for callers that need
 * it** - the dashboard aggregates, a report, an export. The case list must not
 * use it: `api.cases.list` paginates the same index reads instead, or a
 * register-wide role pulls the entire table into one response.
 */
export async function visibleCases(ctx: ReaderCtx, actor: AccessActor) {
  if (actor.permissions.has('case.view.all')) {
    const all = await ctx.db.query('cases').collect();
    return all.filter((record) => canAccessCase(record, actor));
  }

  const ids = await memberCaseIds(ctx, actor.userId);
  const records = await Promise.all([...ids].map((id) => ctx.db.get(id)));
  return records.filter(
    (record): record is NonNullable<typeof record> =>
      record !== null && canAccessCase(record, actor),
  );
}

/**
 * Whether the actor may see a task.
 *
 * Tasks follow the register: no access to the matter, no access to its tasks.
 * The second copy of this rule in the client selector is why it lives here -
 * one helper, called from the task board, the dashboard counts and search, so
 * the three cannot disagree about what a stakeholder is allowed to count.
 *
 * A task bound to no matter is the Legal Unit's own work - the quarterly return,
 * the fee schedule. `canSeeUnitTasks` is the Unit's membership test (pass
 * `task.create`), so an oversight stakeholder or a briefed external firm holding
 * `task.view` still sees none of it, save any task assigned to them personally.
 */
export function canAccessTask(
  task: { caseId: Id<'cases'> | null; ownerId: Id<'users'> },
  visibleCaseIds: ReadonlySet<Id<'cases'>>,
  actor: AccessActor,
): boolean {
  if (task.caseId !== null) return visibleCaseIds.has(task.caseId);
  return actor.permissions.has('task.create') || task.ownerId === actor.userId;
}
