import { v, type Infer } from 'convex/values';
import type { Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { authedQuery } from './lib/functions';
import { canAccessCase, memberCaseIds, type AccessActor } from './lib/access';
import { truncate } from './shared/pure';

/**
 * HYPREP LCMS - global search (TOR §16).
 *
 * Covers matter metadata, document names *and* OCR-extracted contents (the
 * `search_document_text` index), court diary entries, tasks, notes and people.
 * Results are grouped the way the client's search selector grouped them, but
 * the grouping and the visibility filter happen here, server-side, so a
 * stakeholder can never search their way to a matter they cannot open.
 */

export const searchGroupValidator = v.union(
  v.literal('Matters'),
  v.literal('Documents'),
  v.literal('Court dates'),
  v.literal('Tasks'),
  v.literal('Notes'),
  v.literal('People'),
);

const searchHit = v.object({
  group: searchGroupValidator,
  id: v.string(),
  title: v.string(),
  subtitle: v.string(),
  snippet: v.string(),
  link: v.string(),
  viaOcr: v.optional(v.boolean()),
});

export const searchResult = v.object({
  hits: v.array(searchHit),
  total: v.number(),
});

const args = v.object({
  query: v.string(),
  limitPerGroup: v.optional(v.number()),
});

/**
 * The case ids the actor may see, whatever the source of the grant.
 *
 * Register-wide roles walk the whole table; everyone else resolves candidates
 * through the `caseMembers` projection and re-checks each one so a stale or
 * restricted row can never grant what the predicate denies.
 */
async function visibleCaseIds(ctx: QueryCtx, actor: AccessActor): Promise<Set<Id<'cases'>>> {
  const ids = new Set<Id<'cases'>>(await memberCaseIds(ctx, actor.userId));

  if (actor.permissions.has('case.view.all')) {
    const all = await ctx.db.query('cases').collect();
    for (const record of all) {
      if (canAccessCase(record, actor)) ids.add(record._id);
    }
  } else {
    for (const id of [...ids]) {
      const record = await ctx.db.get(id);
      if (record === null || !canAccessCase(record, actor)) ids.delete(id);
    }
  }

  return ids;
}

export const query = authedQuery({
  permission: 'case.view.assigned',
  args,
  returns: searchResult,
  handler: async (ctx, { query: raw, limitPerGroup = 6 }) => {
    const trimmed = raw.trim();
    if (trimmed.length < 2) return { hits: [], total: 0 };

    const actor = ctx.actor.access;
    const limit = Math.max(1, Math.min(limitPerGroup, 10));
    const hits: Infer<typeof searchHit>[] = [];
    const queryText = trimmed;

    // ---- Matters -----------------------------------------------------------
    // Two doors: Convex full-text search on the indexed `searchText`, then a
    // containment re-check on the actor's visible case ids. Register-wide roles
    // walk the whole table once; everyone else resolves through `caseMembers`.
    const caseIds = await visibleCaseIds(ctx, actor);
    const cases = await ctx.db.query('cases').collect();
    for (const record of cases) {
      if (!caseIds.has(record._id)) continue;
      const haystack = [
        record.caseId,
        record.caseReference ?? '',
        record.title,
        record.suitNumber ?? '',
        record.summary,
        record.reliefSought,
        record.presidingJudge ?? '',
        record.tags.join(' '),
        record.parties.map((party) => party.name).join(' '),
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(queryText.toLowerCase())) continue;
      hits.push({
        group: 'Matters',
        id: record._id,
        title: `${record.caseId} — ${record.title}`,
        subtitle: record.status,
        snippet: truncate(record.summary, 160),
        link: `/cases/${record._id}`,
      });
      if (hits.filter((hit) => hit.group === 'Matters').length >= limit) break;
    }

    // ---- Documents (name, description, and OCR text) -----------------------
    const docs = await ctx.db.query('documents').collect();
    let docMatches = 0;
    for (const document of docs) {
      if (!caseIds.has(document.caseId)) continue;
      const nameMatch = `${document.name} ${document.description}`.toLowerCase().includes(
        queryText.toLowerCase(),
      );
      const ocrMatch =
        document.ocrText !== null && document.ocrText.toLowerCase().includes(queryText.toLowerCase());
      if (!nameMatch && !ocrMatch) continue;
      if (docMatches >= limit) break;

      docMatches += 1;
      const viaOcr = !nameMatch && ocrMatch;
      hits.push({
        group: 'Documents',
        id: document._id,
        title: document.name,
        subtitle: `${document.format} · ${document.confidential ? 'Confidential' : 'Open'}`,
        snippet: viaOcr ? truncate(document.ocrText ?? '', 160) : truncate(document.description, 160),
        link: `/cases/${document.caseId}?tab=documents`,
        viaOcr,
      });
    }

    // ---- Court dates -------------------------------------------------------
    const sittings = await ctx.db.query('courtDates').collect();
    let courtMatches = 0;
    for (const sitting of sittings) {
      if (!caseIds.has(sitting.caseId)) continue;
      const haystack = [sitting.judge, sitting.courtRoom, sitting.notes, sitting.purpose]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(queryText.toLowerCase())) continue;
      if (courtMatches >= limit) break;

      courtMatches += 1;
      hits.push({
        group: 'Court dates',
        id: sitting._id,
        title: `${sitting.purpose} — ${sitting.courtRoom}`,
        subtitle: sitting.startsAt,
        snippet: truncate(sitting.notes, 160),
        link: `/cases/${sitting.caseId}?tab=court-dates`,
      });
    }

    // ---- Tasks -------------------------------------------------------------
    const tasks = await ctx.db.query('tasks').collect();
    let taskMatches = 0;
    for (const task of tasks) {
      if (task.caseId !== null && !caseIds.has(task.caseId)) continue;
      if (task.caseId === null && !actor.permissions.has('task.create') && task.ownerId !== actor.userId)
        continue;
      const haystack = `${task.title} ${task.description}`.toLowerCase();
      if (!haystack.includes(queryText.toLowerCase())) continue;
      if (taskMatches >= limit) break;

      taskMatches += 1;
      hits.push({
        group: 'Tasks',
        id: task._id,
        title: task.title,
        subtitle: task.status,
        snippet: truncate(task.description, 160),
        link: task.caseId ? `/cases/${task.caseId}?tab=tasks` : '/tasks',
      });
    }

    // ---- Notes -------------------------------------------------------------
    const notes = await ctx.db.query('notes').collect();
    let noteMatches = 0;
    for (const note of notes) {
      if (!caseIds.has(note.caseId)) continue;
      if (note.internalOnly && !actor.permissions.has('note.create')) continue;
      if (!note.body.toLowerCase().includes(queryText.toLowerCase())) continue;
      if (noteMatches >= limit) break;

      noteMatches += 1;
      hits.push({
        group: 'Notes',
        id: note._id,
        title: 'Case note',
        subtitle: note.createdAt,
        snippet: truncate(note.body, 160),
        link: `/cases/${note.caseId}?tab=notes`,
      });
    }

    // ---- People ------------------------------------------------------------
    if (actor.permissions.has('user.view')) {
      const people = await ctx.db.query('users').collect();
      let peopleMatches = 0;
      for (const person of people) {
        const haystack = `${person.fullName} ${person.title ?? ''} ${person.department ?? ''} ${
          person.firm ?? ''
        }`.toLowerCase();
        if (!haystack.includes(queryText.toLowerCase())) continue;
        if (peopleMatches >= limit) break;

        peopleMatches += 1;
        hits.push({
          group: 'People',
          id: person._id,
          title: person.fullName,
          subtitle: `${person.role}${person.department ? ` · ${person.department}` : ''}`,
          snippet: truncate(person.title ?? '', 160),
          link: '/admin/users',
        });
      }
    }

    return { hits, total: hits.length };
  },
});
