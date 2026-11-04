import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, internalQuery } from './_generated/server';
import { authedMutation, authedQuery } from './lib/functions';
import { DEFAULT_PERMISSION_MATRIX } from './shared/permissions';
import { DEFAULT_SETTINGS } from './seed/reference';
import {
  backupScopeValidator,
  backupTypeValidator,
  caseTypeCategoryValidator,
  courtTierValidator,
  documentGroupValidator,
  permissionValidator,
  roleValidator,
  savedViewEntityValidator,
} from './shared/enums';

/**
 * HYPREP LCMS - the administration surface (Admin -> Roles, Config, System).
 *
 * Everything an administrator edits that is not a user lives here: the
 * permission matrix, the runtime-editable lookup tables, the settings
 * singleton, saved views and the backup ledger. The users/accounts surface is
 * in `users.ts` / `userAccounts.ts`; read-only reference data is in
 * `reference.ts`.
 */

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

/** A human-readable unique key for the reference tables' `by_slug` index. */
function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const courtInput = v.object({
  id: v.union(v.id('courts'), v.null()),
  name: v.string(),
  tier: courtTierValidator,
  division: v.string(),
  state: v.string(),
  address: v.string(),
  active: v.boolean(),
});

const caseTypeInput = v.object({
  id: v.union(v.id('caseTypes'), v.null()),
  name: v.string(),
  description: v.string(),
  category: caseTypeCategoryValidator,
  active: v.boolean(),
});

const documentTypeInput = v.object({
  id: v.union(v.id('documentTypes'), v.null()),
  name: v.string(),
  group: documentGroupValidator,
  retentionYears: v.number(),
  requiresConfidentiality: v.boolean(),
  active: v.boolean(),
});

const tagInput = v.object({
  id: v.union(v.id('tags'), v.null()),
  label: v.string(),
  color: v.string(),
});

const savedViewInput = v.object({
  id: v.union(v.id('savedViews'), v.null()),
  name: v.string(),
  entity: savedViewEntityValidator,
  filters: v.string(),
  shared: v.boolean(),
});

/**
 * A partial patch over the settings singleton.
 *
 * `AdminSystemPage` submits only the fields the operator touched, so every field
 * is optional here. There is deliberately no shared validator: the singleton is
 * defined in `schema.ts` (not the enum module), and a patch is the only shape
 * this mutation ever sees.
 */
const settingsPatchValidator = v.object({
  organisationName: v.optional(v.string()),
  unitName: v.optional(v.string()),
  dateFormat: v.optional(v.union(v.literal('dd/MM/yyyy'), v.literal('yyyy-MM-dd'), v.literal('dd MMM yyyy'))),
  timeZone: v.optional(v.string()),
  currency: v.optional(v.literal('NGN')),
  sessionTimeoutMinutes: v.optional(v.number()),
  passwordExpiryDays: v.optional(v.number()),
  passwordMinLength: v.optional(v.number()),
  passwordRequireComplexity: v.optional(v.boolean()),
  maxFailedLoginAttempts: v.optional(v.number()),
  mfaRequiredForRoles: v.optional(v.array(roleValidator)),
  reminderOffsetsHours: v.optional(v.array(v.number())),
  digestFrequency: v.optional(v.union(v.literal('daily'), v.literal('weekly'), v.literal('off'))),
  retentionArchiveAfterYears: v.optional(v.number()),
  storageQuotaGb: v.optional(v.number()),
  storageUsedGb: v.optional(v.number()),
  backupSchedule: v.optional(v.union(v.literal('hourly'), v.literal('daily'), v.literal('weekly'))),
  backupRetentionDays: v.optional(v.number()),
  watermarkConfidentialDownloads: v.optional(v.boolean()),
  ocrEnabled: v.optional(v.boolean()),
  smsEnabled: v.optional(v.boolean()),
  ssoEnabled: v.optional(v.boolean()),
  retentionDeletionEnabled: v.optional(v.boolean()),
});

const backupRow = v.object({
  id: v.id('backups'),
  startedAt: v.string(),
  completedAt: v.union(v.string(), v.null()),
  type: v.string(),
  scope: v.string(),
  sizeGb: v.number(),
  location: v.string(),
  status: v.string(),
  error: v.union(v.string(), v.null()),
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** The backup ledger, newest first. */
export const listBackups = authedQuery({
  permission: 'system.manage',
  args: {},
  returns: v.array(backupRow),
  handler: async (ctx) => {
    const backups = await ctx.db.query('backups').order('desc').collect();
    return backups.map((backup) => ({
      id: backup._id,
      startedAt: backup.startedAt,
      completedAt: backup.completedAt,
      type: backup.type,
      scope: backup.scope,
      sizeGb: backup.sizeGb,
      location: backup.location,
      status: backup.status,
      error: backup.error,
    }));
  },
});

/** The caller's saved views, plus any shared with them. */
export const savedViews = authedQuery({
  permission: null,
  args: {},
  returns: v.array(
    v.object({
      id: v.id('savedViews'),
      name: v.string(),
      ownerId: v.id('users'),
      entity: savedViewEntityValidator,
      filters: v.string(),
      shared: v.boolean(),
      createdAt: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const owned = await ctx.db
      .query('savedViews')
      .withIndex('by_owner', (q) => q.eq('ownerId', ctx.actor.user._id))
      .collect();
    const shared = await ctx.db
      .query('savedViews')
      .withIndex('by_shared', (q) => q.eq('shared', true))
      .collect();
    const seen = new Set<Id<'savedViews'>>();
    const rows = [];
    for (const view of [...owned, ...shared]) {
      if (seen.has(view._id)) continue;
      seen.add(view._id);
      rows.push({
        id: view._id,
        name: view.name,
        ownerId: view.ownerId,
        entity: view.entity,
        filters: view.filters,
        shared: view.shared,
        createdAt: view.createdAt,
      });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Issues an API key for the public REST surface (TOR section 33).
 *
 * The secret is returned exactly once, in the `lcms_<keyId>_<secret>` form the
 * `http.ts` bearer parser expects; only its SHA-256 is stored, so a leaked
 * database row is not a usable credential. `scopes` are the REST surface's
 * coarse grants (`cases:read`, `hearings:read`, `documents:read`) matched
 * against each route in `http.ts`.
 */
export const createApiKey = authedMutation({
  permission: 'system.manage',
  audit: { entity: 'Configuration', action: 'Created API key' },
  args: {
    name: v.string(),
    scopes: v.array(v.string()),
    expiresAt: v.optional(v.string()),
  },
  handler: async (ctx, { name, scopes, expiresAt }) => {
    const keyId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const secret = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    const hashedSecret = await sha256Hex(secret);
    const id = await ctx.db.insert('apiKeys', {
      keyId,
      hashedSecret,
      name,
      scopes,
      createdById: ctx.actor.user._id,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      expiresAt: expiresAt ?? null,
      revokedAt: null,
    });
    await ctx.audit({
      entityId: id,
      entityLabel: name,
      metadata: { scopes: scopes.join(', ') },
    });
    return { id, key: `lcms_${keyId}_${secret}` };
  },
});

/** Revokes an API key immediately; the REST layer refuses it from then on. */
export const revokeApiKey = authedMutation({
  permission: 'system.manage',
  audit: { entity: 'Configuration', action: 'Revoked API key' },
  args: { id: v.id('apiKeys') },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (row === null) return { revoked: false };
    await ctx.db.patch(id, { revokedAt: new Date().toISOString() });
    await ctx.audit({ entityId: id, entityLabel: row.name });
    return { revoked: true };
  },
});

/** SHA-256 hex, the only form of an API secret that is ever stored. */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Edits the runtime-editable permission matrix for one role. */
export const setRolePermissions = authedMutation({
  permission: 'role.manage',
  audit: { entity: 'Role', action: 'Updated role permissions' },
  args: { role: roleValidator, permissions: v.array(permissionValidator) },
  handler: async (ctx, { role, permissions }) => {
    const existing = await ctx.db
      .query('permissionMatrix')
      .withIndex('by_role', (q) => q.eq('role', role))
      .unique();
    const now = new Date().toISOString();
    if (existing) {
      await ctx.db.patch(existing._id, {
        permissions,
        updatedAt: now,
        updatedById: ctx.actor.user._id,
      });
    } else {
      await ctx.db.insert('permissionMatrix', {
        role,
        permissions,
        updatedAt: now,
        updatedById: ctx.actor.user._id,
      });
    }
    await ctx.audit({ entityId: role, entityLabel: role });
    return { role, updated: true };
  },
});

/** Restores a role to the delivered default matrix. */
export const resetRolePermissions = authedMutation({
  permission: 'role.manage',
  audit: { entity: 'Role', action: 'Reset role permissions' },
  args: { role: roleValidator },
  handler: async (ctx, { role }) => {
    const existing = await ctx.db
      .query('permissionMatrix')
      .withIndex('by_role', (q) => q.eq('role', role))
      .unique();
    const now = new Date().toISOString();
    const permissions = DEFAULT_PERMISSION_MATRIX[role];
    if (existing) {
      await ctx.db.patch(existing._id, { permissions, updatedAt: now, updatedById: ctx.actor.user._id });
    } else {
      await ctx.db.insert('permissionMatrix', { role, permissions, updatedAt: now, updatedById: ctx.actor.user._id });
    }
    await ctx.audit({ entityId: role, entityLabel: role });
    return { role, updated: true };
  },
});

/** Upserts the settings singleton (Admin -> System). */
export const updateSettings = authedMutation({
  permission: 'system.manage',
  audit: { entity: 'Configuration', action: 'Updated system settings' },
  args: { patch: settingsPatchValidator },
  handler: async (ctx, { patch }) => {
    const existing = await ctx.db.query('settings').first();
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      // A fresh deployment with no seeded settings row: complete the patch
      // against the shipped defaults so the singleton is always whole. The
      // spread of an optional-typed patch does not narrow, so the merged
      // object is asserted - the fields really are all present after the
      // merge with `DEFAULT_SETTINGS`.
      await ctx.db.insert('settings', {
        ...DEFAULT_SETTINGS,
        ...patch,
      } as unknown as Doc<'settings'>);
    }
    await ctx.audit({ entityId: 'cfg_system', entityLabel: 'System settings' });
    return { updated: true };
  },
});

// ---------------------------------------------------------------------------
// Config-table CRUD (Admin -> Config)
// ---------------------------------------------------------------------------

export const upsertCourt = authedMutation({
  permission: 'config.manage',
  audit: { entity: 'Configuration', action: 'Saved court' },
  args: { input: courtInput },
  handler: async (ctx, { input }) => {
    if (input.id) {
      const existing = await ctx.db.get(input.id);
      if (existing) {
        await ctx.db.patch(input.id, {
          name: input.name,
          tier: input.tier,
          division: input.division,
          state: input.state,
          address: input.address,
          active: input.active,
        });
        return { id: input.id };
      }
    }
    const id = await ctx.db.insert('courts', {
      slug: slugify(input.name),
      name: input.name,
      tier: input.tier,
      division: input.division,
      state: input.state,
      address: input.address,
      active: input.active,
    });
    await ctx.audit({ entityId: id, entityLabel: input.name });
    return { id };
  },
});

export const upsertCaseType = authedMutation({
  permission: 'config.manage',
  audit: { entity: 'Configuration', action: 'Saved matter type' },
  args: { input: caseTypeInput },
  handler: async (ctx, { input }) => {
    if (input.id) {
      const existing = await ctx.db.get(input.id);
      if (existing) {
        await ctx.db.patch(input.id, {
          name: input.name,
          description: input.description,
          category: input.category,
          active: input.active,
        });
        return { id: input.id };
      }
    }
    const id = await ctx.db.insert('caseTypes', {
      slug: slugify(input.name),
      name: input.name,
      description: input.description,
      category: input.category,
      active: input.active,
    });
    await ctx.audit({ entityId: id, entityLabel: input.name });
    return { id };
  },
});

export const upsertDocumentType = authedMutation({
  permission: 'config.manage',
  audit: { entity: 'Configuration', action: 'Saved document type' },
  args: { input: documentTypeInput },
  handler: async (ctx, { input }) => {
    if (input.id) {
      const existing = await ctx.db.get(input.id);
      if (existing) {
        await ctx.db.patch(input.id, {
          name: input.name,
          group: input.group,
          retentionYears: input.retentionYears,
          requiresConfidentiality: input.requiresConfidentiality,
          active: input.active,
        });
        return { id: input.id };
      }
    }
    const id = await ctx.db.insert('documentTypes', {
      slug: slugify(input.name),
      name: input.name,
      group: input.group,
      retentionYears: input.retentionYears,
      requiresConfidentiality: input.requiresConfidentiality,
      active: input.active,
    });
    await ctx.audit({ entityId: id, entityLabel: input.name });
    return { id };
  },
});

export const upsertTag = authedMutation({
  permission: 'config.manage',
  audit: { entity: 'Configuration', action: 'Saved tag' },
  args: { input: tagInput },
  handler: async (ctx, { input }) => {
    if (input.id) {
      const existing = await ctx.db.get(input.id);
      if (existing) {
        await ctx.db.patch(input.id, { label: input.label, color: input.color });
        return { id: input.id };
      }
    }
    const id = await ctx.db.insert('tags', {
      slug: slugify(input.label),
      label: input.label,
      color: input.color,
      usageCount: 0,
    });
    await ctx.audit({ entityId: id, entityLabel: input.label });
    return { id };
  },
});

export const deleteTag = authedMutation({
  permission: 'config.manage',
  audit: { entity: 'Configuration', action: 'Deleted tag' },
  args: { id: v.id('tags') },
  handler: async (ctx, { id }) => {
    const tag = await ctx.db.get(id);
    if (tag === null) return { deleted: false };
    await ctx.db.delete(id);
    await ctx.audit({ entityId: id, entityLabel: tag.label });
    return { deleted: true };
  },
});

// ---------------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------------

export const saveView = authedMutation({
  permission: null,
  audit: { skip: 'Saving a personal filter layout is a client convenience, not an auditable act.' },
  args: { input: savedViewInput },
  handler: async (ctx, { input }) => {
    const now = new Date().toISOString();
    if (input.id) {
      const existing = await ctx.db.get(input.id);
      if (existing && existing.ownerId === ctx.actor.user._id) {
        await ctx.db.patch(input.id, {
          name: input.name,
          entity: input.entity,
          filters: input.filters,
          shared: input.shared,
        });
        return { id: input.id };
      }
      throw new Error('You can only edit your own saved views.');
    }
    const id = await ctx.db.insert('savedViews', {
      name: input.name,
      ownerId: ctx.actor.user._id,
      entity: input.entity,
      filters: input.filters,
      shared: input.shared,
      createdAt: now,
    });
    return { id };
  },
});

export const deleteSavedView = authedMutation({
  permission: null,
  audit: { skip: 'Deleting a personal saved view is a client convenience, not an auditable act.' },
  args: { id: v.id('savedViews') },
  handler: async (ctx, { id }) => {
    const view = await ctx.db.get(id);
    if (view === null) return { deleted: false };
    if (view.ownerId !== ctx.actor.user._id && !ctx.actor.can('system.manage')) {
      throw new Error('You can only delete your own saved views.');
    }
    await ctx.db.delete(id);
    return { deleted: true };
  },
});

// ---------------------------------------------------------------------------
// Internal surface (cron)
// ---------------------------------------------------------------------------

/** The full backup ledger for the retention/prune cron. */
export const internalListBackups = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('backups').order('desc').collect();
  },
});

/** Marks a backup row complete or failed, with a real size. */
export const internalCompleteBackup = internalMutation({
  args: {
    id: v.id('backups'),
    completedAt: v.string(),
    sizeGb: v.number(),
    storageId: v.union(v.id('_storage'), v.null()),
    status: v.union(v.literal('completed'), v.literal('failed')),
    error: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { id, completedAt, sizeGb, storageId, status, error }) => {
    const backup = await ctx.db.get(id);
    if (backup === null) return;
    await ctx.db.patch(id, { completedAt, sizeGb, storageId, status, error });
  },
});

/** Inserts a backup row (started) for the on-demand and cron runs. */
export const internalStartBackup = internalMutation({
  args: {
    type: backupTypeValidator,
    scope: backupScopeValidator,
    triggeredById: v.union(v.id('users'), v.null()),
  },
  handler: async (ctx, { type, scope, triggeredById }) => {
    const now = new Date().toISOString();
    return await ctx.db.insert('backups', {
      startedAt: now,
      completedAt: null,
      type,
      scope,
      sizeGb: 0,
      location: 'Convex storage',
      status: 'running',
      storageId: null,
      triggeredById,
      error: null,
    });
  },
});

/**
 * Deletes backup rows (and their storage blobs, when present) older than the
 * retention window. Runs from the scheduled backup after a successful export.
 */
export const internalPruneBackups = internalMutation({
  args: { now: v.string(), retentionDays: v.number() },
  handler: async (ctx, { now, retentionDays }) => {
    const cutoff = new Date(Date.parse(now) - retentionDays * 86_400_000).toISOString();
    const rows = await ctx.db.query('backups').collect();
    const expired = rows.filter((row) => row.completedAt !== null && row.completedAt < cutoff);
    for (const row of expired) {
      if (row.storageId !== null) await ctx.storage.delete(row.storageId);
      await ctx.db.delete(row._id);
    }
    return { pruned: expired.length };
  },
});
