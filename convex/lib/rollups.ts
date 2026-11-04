import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { caseMemberRows, type CaseAccessFields } from './access';

/**
 * HYPREP LCMS - derived case state, maintained at write time.
 *
 * Two families of derived data live on the `cases` document, and both have the
 * same reason for existing: the register sorts and filters on them, and Convex
 * can only sort and filter over *indexed* fields. A value computed during a
 * query cannot be indexed, so leaving these derived would force the whole
 * register to the client for what is a routine sort.
 *
 * 1. **Rollups** (`nextHearingAt`, `lastHearingAt`, `openTaskCount`,
 *    `overdueTaskCount`, `documentCount`). Maintained by the court-date, task
 *    and document mutations that change their inputs. `overdueTaskCount`
 *    additionally depends on the clock, so a nightly cron reconciles it - see
 *    `crons.ts`.
 *
 * 2. **`caseMembers` rows** - the access index. The membership arrays on the
 *    case document stay the source of truth; this projection exists because
 *    Convex cannot index an array for containment. Any mutation touching the
 *    membership fields must rewrite these rows in the same transaction, or a
 *    lawyer silently loses access to their own matter.
 *
 * Both are *derived*: neither is edited directly, and every function here is
 * called from the same mutation that wrote the source of truth, so they cannot
 * drift apart.
 */

/**
 * One clock reading per act. The mutation wrapper stamps its own `at` for the
 * audit row; this exists so the derived fields a handler touches all agree with
 * the source rows it just wrote.
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * A context that can both read and write. The rollup maintainers are called
 * from mutations, and `patch` is not on the read handle - so these helpers are
 * typed against the mutation handle and never pretend otherwise.
 */
type WriterCtx = { db: MutationCtx['db'] };

/**
 * Recomputes the four count/date rollups for one matter from its actual
 * court dates, tasks and documents - the same numbers `buildCaseRows` derived
 * by scanning whole collections in the prototype, read here from the indexed
 * child tables of one case.
 *
 * Call after any mutation that inserts, updates or deletes a court date, task
 * or document for the case, and after the case itself is created or restored.
 * `overdueTaskCount` is time-dependent; the nightly reconcile cron calls this
 * for every case so the counts stay honest as the calendar moves.
 */
export async function recomputeCaseRollups(
  ctx: WriterCtx,
  caseId: Id<'cases'>,
): Promise<void> {
  const [sittings, tasks, docs] = await Promise.all([
    ctx.db.query('courtDates').withIndex('by_case', (q) => q.eq('caseId', caseId)).collect(),
    ctx.db.query('tasks').withIndex('by_case', (q) => q.eq('caseId', caseId)).collect(),
    ctx.db.query('documents').withIndex('by_case', (q) => q.eq('caseId', caseId)).collect(),
  ]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // `nextHearing` in the client is the earliest future sitting without an
  // outcome; `lastHearing` is the latest sitting that already has one.
  const upcoming = sittings
    .filter((sitting) => !sitting.outcome && Date.parse(sitting.startsAt) >= today.getTime())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = sittings
    .filter((sitting) => sitting.outcome !== null)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const open = tasks.filter(
    (task) => task.status !== 'Completed' && task.status !== 'Cancelled',
  );
  const overdue = open.filter((task) => {
    const due = Date.parse(task.dueDate);
    return !Number.isNaN(due) && due < today.getTime();
  });

  await ctx.db.patch(caseId, {
    nextHearingAt: upcoming[0]?.startsAt ?? null,
    lastHearingAt: past[past.length - 1]?.startsAt ?? null,
    openTaskCount: open.length,
    overdueTaskCount: overdue.length,
    documentCount: docs.length,
  });
}

/**
 * Rewrites a matter's `caseMembers` rows to match its membership arrays.
 *
 * Diff-free on purpose: delete the projection for the case and re-insert from
 * the source of truth. The number of rows per case is small (bounded by the
 * people attached to one matter), so the write is cheap and the "diff" is
 * simply the projection being correct rather than being small.
 *
 * This must run in the same transaction as any change to `matterOwnerId`,
 * `assigneeIds`, `externalCounselIds`, `stakeholderIds` or
 * `restrictedToUserIds` - see the access module for why that invariant exists.
 */
export async function syncCaseMembers(
  ctx: WriterCtx,
  caseId: Id<'cases'>,
  record: CaseAccessFields,
): Promise<void> {
  const existing = await ctx.db.query('caseMembers').withIndex('by_case', (q) => q.eq('caseId', caseId)).collect();
  for (const row of existing) {
    await ctx.db.delete(row._id);
  }
  for (const row of caseMemberRows(record)) {
    await ctx.db.insert('caseMembers', { caseId, userId: row.userId, kind: row.kind });
  }
}

/**
 * The searchable text for the register search index.
 *
 * The client's filter box searched across case number, reference, title, suit
 * number, summary, judge, court, type, parties, owner and tags. A search index
 * covers exactly one field, so those are concatenated here at write time. The
 * court and matter-type names come from their reference docs; everything else
 * is on the record.
 */
export function buildCaseSearchText(
  record: Pick<
    Doc<'cases'>,
    | 'caseId'
    | 'caseReference'
    | 'title'
    | 'suitNumber'
    | 'summary'
    | 'presidingJudge'
    | 'tags'
    | 'parties'
  >,
  courtName: string,
  caseTypeName: string,
  ownerName: string,
): string {
  return [
    record.caseId,
    record.caseReference ?? '',
    record.title,
    record.suitNumber ?? '',
    record.summary,
    record.presidingJudge ?? '',
    courtName,
    caseTypeName,
    ownerName,
    record.tags.join(' '),
    record.parties.map((party) => party.name).join(' '),
  ]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Maintains the tag vocabulary's `usageCount` when a matter's tags change.
 *
 * Matched by label (the case stores the label, the tag row carries a slug and
 * a label). Counting down to zero is left as-is: a tag with zero uses is a
 * valid vocabulary entry an administrator may prune.
 */
export async function touchTagUsage(
  ctx: WriterCtx,
  previous: readonly string[],
  next: readonly string[],
): Promise<void> {
  const removed = previous.filter((label) => !next.includes(label));
  const added = next.filter((label) => !previous.includes(label));

  const bump = async (label: string, delta: number) => {
    const tag = await ctx.db.query('tags').withIndex('by_label', (q) => q.eq('label', label)).unique();
    if (tag === null) return;
    await ctx.db.patch(tag._id, { usageCount: Math.max(0, tag.usageCount + delta) });
  };

  await Promise.all([
    ...removed.map((label) => bump(label, -1)),
    ...added.map((label) => bump(label, 1)),
  ]);
}
