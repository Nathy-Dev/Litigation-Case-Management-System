import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { authedMutation, authedQuery } from './lib/functions';
import { loadAccessibleCase, type AccessActor } from './lib/access';
import { nowIso } from './lib/rollups';

/**
 * HYPREP LCMS - case notes.
 *
 * Notes live on the case they describe and inherit its visibility: a user who
 * can open a matter can read its notes, with one wrinkle - notes marked
 * `internalOnly` are the Legal Unit's own, hidden from EXTERNAL_COUNSEL and
 * READ_ONLY stakeholders even when they can otherwise see the matter. That
 * check mirrors the prototype's `visibleNotes` and is enforced here on every
 * read, never in the client.
 */

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

const noteRow = v.object({
  id: v.id('notes'),
  caseId: v.id('cases'),
  body: v.string(),
  authorId: v.id('users'),
  createdAt: v.string(),
  internalOnly: v.boolean(),
  mentions: v.array(v.id('users')),
});

const noteListResult = v.object({
  notes: v.array(noteRow),
  /** The notes a user may not see. Kept as a count, not rows. */
  hiddenInternalCount: v.number(),
});

// ---------------------------------------------------------------------------
// Access helpers
// ---------------------------------------------------------------------------

/**
 * Notes visible to an actor on a given matter.
 *
 * External counsel and read-only stakeholders never see `internalOnly` notes;
 * everyone else on the matter sees all of them.
 */
function visibleNotes(
  notes: readonly {
    _id: Id<'notes'>;
    caseId: Id<'cases'>;
    body: string;
    authorId: Id<'users'>;
    createdAt: string;
    internalOnly: boolean;
    mentions: Id<'users'>[];
  }[],
  actor: AccessActor,
) {
  // EXTERNAL_COUNSEL and READ_ONLY never hold `note.create` (the permission the
  // Legal Unit's own staff carry), so the permission doubles as the role test
  // without reading the users table.
  const hidesInternal = !actor.permissions.has('note.create');
  const visible = notes.filter((note) => !(hidesInternal && note.internalOnly));
  return {
    notes: visible.map((note) => ({
      id: note._id,
      caseId: note.caseId,
      body: note.body,
      authorId: note.authorId,
      createdAt: note.createdAt,
      internalOnly: note.internalOnly,
      mentions: note.mentions,
    })),
    hiddenInternalCount: notes.length - visible.length,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** The notes on one matter, newest first. Access-checked against the matter. */
export const list = authedQuery({
  permission: 'note.create',
  args: { caseId: v.id('cases') },
  returns: noteListResult,
  handler: async (ctx, { caseId }) => {
    await loadAccessibleCase(ctx, caseId, ctx.actor.access);
    const notes = await ctx.db
      .query('notes')
      .withIndex('by_case_createdAt', (q) => q.eq('caseId', caseId))
      .order('desc')
      .collect();
    return visibleNotes(notes, ctx.actor.access);
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Adds a note to a matter. `internalOnly` hides it from external counsel. */
export const addNote = authedMutation({
  permission: 'note.create',
  audit: { entity: 'Note', action: 'Added note' },
  args: {
    caseId: v.id('cases'),
    body: v.string(),
    internalOnly: v.boolean(),
    mentions: v.optional(v.array(v.id('users'))),
  },
  handler: async (ctx, { caseId, body, internalOnly, mentions }) => {
    const record = await loadAccessibleCase(ctx, caseId, ctx.actor.access);
    const noteId = await ctx.db.insert('notes', {
      caseId,
      body,
      authorId: ctx.actor.user._id,
      createdAt: nowIso(),
      internalOnly,
      mentions: mentions ?? [],
    });

    await ctx.audit({ entityId: caseId, entityLabel: record.caseId });
    return { id: noteId, caseId };
  },
});
