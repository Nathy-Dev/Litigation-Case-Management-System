'use node';

import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { backupScopeValidator, backupTypeValidator } from './shared/enums';
import { authedAction } from './lib/functions';
import type { ActionCtx } from './_generated/server';

/**
 * HYPREP LCMS - backup/restore (TOR section 35).
 *
 * The authoritative disaster-recovery mechanism for this deployment is Convex's
 * own platform snapshots - the in-app backup is an *auditable artefact*, not a
 * substitute for the platform. It exports selected application tables to a gzipped JSONL file in
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
  ctx: ActionCtx,
  table: TableName,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  let cursor: string | null = null;
  let bytes = 0;
  do {
    const result: { page: unknown[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.backupDb.page, { table, paginationOpts: { cursor, numItems: 100 } });
    rows.push(...result.page);
    bytes += new TextEncoder().encode(JSON.stringify(result.page)).byteLength;
    if (bytes > 20 * 1024 * 1024) throw new Error('This register exceeds the in-app export limit. Use a platform snapshot instead.');
    cursor = result.isDone ? null : result.continueCursor;
  } while (cursor);
  return rows;
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
    { type = 'Full', scope = 'Database' },
  ): Promise<{ backupId: Id<'backups'>; sizeGb: number }> => {
    if (type !== 'Full' || scope !== 'Database') throw new Error('This tool creates a full application-record export only. File bytes, authentication and incremental backups require a Convex platform snapshot.');
    const backupId = await ctx.runMutation(internal.admin.internalStartBackup, {
      type,
      scope,
      triggeredById: ctx.actor.id,
    });

    try {
      const chunks: Uint8Array[] = [new TextEncoder().encode(JSON.stringify({ manifest: 'hyprep-domain-export-v1', createdAt: new Date().toISOString(), includes: 'Application records and document metadata', excludes: ['Stored file bytes', 'Authentication component', 'Atomic point-in-time snapshot'], restoreFormat: 'Not directly importable; use the platform snapshot for recovery' }) + '\n')];
      for (const table of EXPORT_TABLES) {
        const rows = await collectTable(ctx, table);
        chunks.push(new TextEncoder().encode(serializeTable(table, rows) + '\n'));
        if (chunks.reduce((total, chunk) => total + chunk.byteLength, 0) > 20 * 1024 * 1024) throw new Error('This export exceeds the 20 MB limit. Use a platform snapshot.');
      }

      const blob = await gzipExport(chunks);
      const sizeGb = blob.size / 1_073_741_824;

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

    const claim = await ctx.runMutation(internal.backupDb.claimScheduledBackup, { now });
    if (!claim.backupId) return { backupId: null, sizeGb: 0, skipped: true, reason: claim.reason ?? 'not due' };
    const backupId = claim.backupId;

    try {
      const chunks: Uint8Array[] = [new TextEncoder().encode(JSON.stringify({ manifest: 'hyprep-domain-export-v1', createdAt: now, includes: 'Application records and document metadata', excludes: ['Stored file bytes', 'Authentication component', 'Atomic point-in-time snapshot'], restoreFormat: 'Not directly importable; use the platform snapshot for recovery' }) + '\n')];
      for (const table of EXPORT_TABLES) {
        const rows = await collectTable(ctx, table);
        chunks.push(new TextEncoder().encode(serializeTable(table, rows) + '\n'));
        if (chunks.reduce((total, chunk) => total + chunk.byteLength, 0) > 20 * 1024 * 1024) throw new Error('This export exceeds the 20 MB limit. Use a platform snapshot.');
      }
      const blob = await gzipExport(chunks);
      const sizeGb = blob.size / 1_073_741_824;
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
