import { internalMutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import { ROLES } from '../shared/enums';
import { DEFAULT_PERMISSION_MATRIX } from '../shared/permissions';
import {
  CASE_TYPES,
  COURTS,
  DEFAULT_SETTINGS,
  DOCUMENT_TYPES,
  TAGS,
} from './reference';

/**
 * HYPREP LCMS - reference data seeding.
 *
 * A fresh deployment needs three things in place before anyone can sign in and
 * do useful work: the runtime-editable lookup tables (courts, matter types,
 * document types, tags), the settings singleton, and the permission matrix that
 * every mutation is checked against. This module puts them there.
 *
 * **Idempotent by natural key.** Lookup rows are keyed by `slug`, the settings
 * and matrix rows by their singleton-ness and role. The seeder inserts only what
 * is genuinely absent, so re-running it after this file gains a new court adds
 * that one row and nothing else - and, importantly, never overwrites an
 * administrator's later edits to rows that already exist. That property is what
 * makes it safe to run on every deploy rather than exactly once.
 *
 * This seeds *configuration*, not fixtures. There is no demo data anywhere in
 * this deployment: the register starts empty and is filled by real use.
 */

async function seedCourts(ctx: MutationCtx): Promise<number> {
  let inserted = 0;
  for (const court of COURTS) {
    const existing = await ctx.db
      .query('courts')
      .withIndex('by_slug', (q) => q.eq('slug', court.slug))
      .unique();
    if (existing) continue;
    await ctx.db.insert('courts', court);
    inserted += 1;
  }
  return inserted;
}

async function seedCaseTypes(ctx: MutationCtx): Promise<number> {
  let inserted = 0;
  for (const caseType of CASE_TYPES) {
    const existing = await ctx.db
      .query('caseTypes')
      .withIndex('by_slug', (q) => q.eq('slug', caseType.slug))
      .unique();
    if (existing) continue;
    await ctx.db.insert('caseTypes', caseType);
    inserted += 1;
  }
  return inserted;
}

async function seedDocumentTypes(ctx: MutationCtx): Promise<number> {
  let inserted = 0;
  for (const documentType of DOCUMENT_TYPES) {
    const existing = await ctx.db
      .query('documentTypes')
      .withIndex('by_slug', (q) => q.eq('slug', documentType.slug))
      .unique();
    if (existing) continue;
    await ctx.db.insert('documentTypes', documentType);
    inserted += 1;
  }
  return inserted;
}

async function seedTags(ctx: MutationCtx): Promise<number> {
  let inserted = 0;
  for (const tag of TAGS) {
    const existing = await ctx.db
      .query('tags')
      .withIndex('by_slug', (q) => q.eq('slug', tag.slug))
      .unique();
    if (existing) continue;
    // `usageCount` is derived from the register and maintained by the case
    // mutations, so it starts at zero on a deployment with no matters yet.
    await ctx.db.insert('tags', { ...tag, usageCount: 0 });
    inserted += 1;
  }
  return inserted;
}

async function seedSettings(ctx: MutationCtx): Promise<boolean> {
  const existing = await ctx.db.query('settings').first();
  if (existing) return false;
  await ctx.db.insert('settings', DEFAULT_SETTINGS);
  return true;
}

/**
 * Writes any missing role rows into the permission matrix.
 *
 * Driven by `ROLES` rather than the matrix's own keys, so adding a role to the
 * enum without granting it anything produces an explicit empty row - a role that
 * can do nothing - instead of a missing row, which the permission check would
 * have to treat as an error at request time.
 */
async function seedPermissionMatrix(
  ctx: MutationCtx,
  now: string,
): Promise<number> {
  let inserted = 0;
  for (const role of ROLES) {
    const existing = await ctx.db
      .query('permissionMatrix')
      .withIndex('by_role', (q) => q.eq('role', role))
      .unique();
    if (existing) continue;
    await ctx.db.insert('permissionMatrix', {
      role,
      permissions: DEFAULT_PERMISSION_MATRIX[role],
      updatedAt: now,
      updatedById: null,
    });
    inserted += 1;
  }
  return inserted;
}

/**
 * Backfills `mfaRequired` onto `users` rows written before the field existed.
 *
 * The schema requires `mfaRequired` on every `users` document, so a deployment
 * that predates the field cannot be pushed until its rows carry it. Run this
 * once (after temporarily relaxing the schema to `v.optional(v.boolean())`),
 * then tighten the schema back to `v.boolean()`.
 *
 * Idempotent: rows that already have the field are left untouched. Missing
 * values are treated as the pre-migration default, `false` - nobody was
 * individually required to enrol before the flag existed.
 */
export const backfillMfaRequired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('users').collect();
    let patched = 0;
    for (const row of rows) {
      if ('mfaRequired' in row && typeof row.mfaRequired === 'boolean') continue;
      await ctx.db.patch(row._id, { mfaRequired: false });
      patched += 1;
    }
    return { patched, total: rows.length };
  },
});

/**
 * Seeds all reference data. Safe to run repeatedly.
 *
 * Internal, never client-callable: run from the Convex dashboard on first
 * deploy, and again after any release that adds reference rows.
 */
export const referenceData = internalMutation({
  args: {},
  handler: async (ctx) => {
    // One clock reading for the whole run, so everything it writes agrees.
    const now = new Date().toISOString();

    return {
      courts: await seedCourts(ctx),
      caseTypes: await seedCaseTypes(ctx),
      documentTypes: await seedDocumentTypes(ctx),
      tags: await seedTags(ctx),
      permissionRoles: await seedPermissionMatrix(ctx, now),
      settingsCreated: await seedSettings(ctx),
    };
  },
});
