'use node';

import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { backupScopeValidator, backupTypeValidator } from './shared/enums';
import { authedAction } from './lib/functions';

/**
 * HYPREP LCMS - backup/restore (TOR section 35).
 *
 * The authoritative disaster-recovery mechanism for this deployment is Convex's
 * own platform snapshots - the in-app backup is an *auditable artefact*, not a
 * substitute for the platform. It exports every table to a gzipped JSONL file in
 * Convex storage, records a real `sizeGb` in the `backups` ledger, and prunes
 * runs older than `settings.backupRetentionDays`.
 *
 * The export runs in the Node runtime because `zlib` (gzip) is a native module
 * the default V8 isolate does not have.
 */

/** Every table that holds domain data, in a stable order for the export. */
const EXPORT_TABLES = [
  'users',
  'teams',
  'permissionMatrix',
  'cases',
  'caseMembers',
  'statusChanges',
  'documents',
  'courtDates',
  'sentReminders',
  'tasks',
  'notes',
  'notifications',
  'auditLog',
  'courts',
  'caseTypes',
  'documentTypes',
  'tags',
  'settings',
  'savedViews',
  'backups',
  'counters',
] as const;

type TableName = (typeof EXPORT_TABLES)[number];

/**
 * The JSONL payload for one table: a header line declaring the table and a row
 * per document. `sizeGb` is derived from the serialised bytes so the ledger
 * figure is real, not a fraction of the storage quota.
 */
function serializeTable(name: TableName, rows: unknown[]): string {
  const lines = [JSON.stringify({ table: name, count: rows.length })];
  for (const row of rows) lines.push(JSON.stringify(row));
  return lines.join('\n');
}

/** Reads a whole table. Typed as `Record` rows to keep the export generic. */
async function collectTable(
  ctx: { db: { query: (table: string) => { collect: () => Promise<unknown[]> } } },
  table: TableName,
): Promise<unknown[]> {
  return await ctx.db.query(table).collect();
}

/** Gzips a JSONL export and returns it as a Blob for Convex storage. */
async function gzipExport(chunks: Uint8Array[]): Promise<Blob> {
  const { gzipSync } = await import('zlib');
  const gzipped = gzipSync(Buffer.concat(chunks), { level: 6 });
  return new Blob([gzipped], { type: 'application/gzip' });
}

/**
 * The on-demand backup, reachable from Admin -> System -> Run backup.
 *
 * An action because it must call `ctx.storage` and run in the Node runtime.
 * The ledger row is created and completed by internal mutations so the audit
 * trail sees a coherent `startedAt`/`completedAt` pair.
 */
export const runBackup = authedAction({
  permission: 'system.manage',
  audit: { entity: 'Backup', action: 'Ran an on-demand backup' },
  args: { type: v.optional(backupTypeValidator), scope: v.optional(backupScopeValidator) },
  returns: v.object({ backupId: v.id('backups'), sizeGb: v.number() }),
  handler: async (
    ctx,
    { type = 'Full', scope = 'Both' },
  ): Promise<{ backupId: Id<'backups'>; sizeGb: number }> => {
    const backupId = await ctx.runMutation(internal.admin.internalStartBackup, {
      type,
      scope,
      triggeredById: ctx.actor.id,
    });

    try {
      const chunks: Uint8Array[] = [];
      for (const table of EXPORT_TABLES) {
        const rows = await collectTable(ctx as never, table);
        chunks.push(new TextEncoder().encode(serializeTable(table, rows) + '\n'));
      }

      const blob = await gzipExport(chunks);
      const sizeGb = Number((blob.size / 1_073_741_824).toFixed(4));

      const storageId = await ctx.storage.store(blob);

      await ctx.runMutation(internal.admin.internalCompleteBackup, {
        id: backupId,
        completedAt: new Date().toISOString(),
        sizeGb,
        storageId,
        status: 'completed',
        error: null,
      });

      return { backupId, sizeGb };
    } catch (error) {
      const detail = error instanceof Error ? error.message : JSON.stringify(error);
      await ctx.runMutation(internal.admin.internalCompleteBackup, {
        id: backupId,
        completedAt: new Date().toISOString(),
        sizeGb: 0,
        storageId: null,
        status: 'failed',
        error: detail,
      });
      throw error;
    }
  },
});

/**
 * The scheduled backup, driven by `crons.ts`. Runs as the system, so it uses
 * the internal start/complete helpers directly and does not need an actor.
 */
export const internalRunScheduledBackup = internalAction({
  args: { now: v.string() },
  returns: v.object({
    backupId: v.union(v.id('backups'), v.null()),
    sizeGb: v.number(),
    skipped: v.optional(v.boolean()),
    reason: v.optional(v.string()),
    failed: v.optional(v.boolean()),
    detail: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    { now },
  ): Promise<{
    backupId: Id<'backups'> | null;
    sizeGb: number;
    skipped?: boolean;
    reason?: string;
    failed?: boolean;
    detail?: string;
  }> => {
    const settings = await ctx.runQuery(internal.lib.functions.internalLoadSettings);
    if (settings === null) return { backupId: null, sizeGb: 0, skipped: true, reason: 'no settings row' };

    const backupId = await ctx.runMutation(internal.admin.internalStartBackup, {
      type: 'Full',
      scope: 'Both',
      triggeredById: null,
    });

    try {
      const chunks: Uint8Array[] = [];
      for (const table of EXPORT_TABLES) {
        const rows = await collectTable(ctx as never, table);
        chunks.push(new TextEncoder().encode(serializeTable(table, rows) + '\n'));
      }
      const blob = await gzipExport(chunks);
      const sizeGb = Number((blob.size / 1_073_741_824).toFixed(4));
      const storageId = await ctx.storage.store(blob);

      await ctx.runMutation(internal.admin.internalCompleteBackup, {
        id: backupId,
        completedAt: new Date().toISOString(),
        sizeGb,
        storageId,
        status: 'completed',
        error: null,
      });

      // Prune past the retention window.
      await ctx.runMutation(internal.admin.internalPruneBackups, {
        now,
        retentionDays: settings.backupRetentionDays,
      });

      return { backupId, sizeGb };
    } catch (error) {
      const detail = error instanceof Error ? error.message : JSON.stringify(error);
      await ctx.runMutation(internal.admin.internalCompleteBackup, {
        id: backupId,
        completedAt: new Date().toISOString(),
        sizeGb: 0,
        storageId: null,
        status: 'failed',
        error: detail,
      });
      return { backupId, sizeGb: 0, failed: true, detail };
    }
  },
});
