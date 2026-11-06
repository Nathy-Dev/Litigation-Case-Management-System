import { internalQuery, internalMutation } from './_generated/server';
import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { authedMutation } from './lib/functions';
import { buildActor, requireCompliance, requirePermission, sessionVerdict } from './lib/actor';

export const downloadArchive = authedMutation({
  permission: 'system.manage',
  audit: { entity: 'Backup', action: 'Downloaded application-record archive' },
  args: { id: v.id('backups') },
  returns: v.object({ url: v.string(), filename: v.string() }),
  handler: async (ctx, args) => {
    const backup = await ctx.db.get(args.id);
    if (!backup || backup.status !== 'completed' || !backup.storageId) throw new Error('No completed archive is available for this job.');
    if (!ctx.actor.authSessionId) throw new Error('Sign in again to download this archive.');
    const token = crypto.randomUUID();
    const id = await ctx.db.insert('archiveTickets', { token, backupId: backup._id, userId: ctx.actor.user._id, authSessionId: ctx.actor.authSessionId, expiresAt: Date.now() + 600000 });
    await ctx.scheduler.runAfter(600000, internal.backupDb.removeTicket, { id });
    const filename = `hyprep-litigation-records-${backup.startedAt.slice(0, 10)}.jsonl.gz`;
    await ctx.audit({ entityId: backup._id, entityLabel: filename });
    return { url: `${process.env.CONVEX_SITE_URL}/exports/${token}`, filename };
  },
});

export const readArchiveTicket = internalQuery({
  args: { token: v.string() },
  returns: v.union(v.null(), v.object({ storageId: v.id('_storage'), filename: v.string() })),
  handler: async (ctx, args) => {
    const ticket = await ctx.db.query('archiveTickets').withIndex('by_token', (query) => query.eq('token', args.token)).unique();
    if (!ticket || ticket.expiresAt <= Date.now()) return null;
    const user = await ctx.db.get(ticket.userId);
    const backup = await ctx.db.get(ticket.backupId);
    if (!user || user.status !== 'active' || !user.authUserId || !backup?.storageId || backup.status !== 'completed') return null;
    const session = await ctx.db.query('userSessions').withIndex('by_authSessionId', (query) => query.eq('authSessionId', ticket.authSessionId)).unique();
    if (!session || session.userId !== user._id) return null;
    const verdict = await sessionVerdict(ctx, { user, authUserId: user.authUserId, authSessionId: ticket.authSessionId });
    if (!verdict.live) return null;
    try {
      requirePermission(await buildActor(ctx, user, ticket.authSessionId), 'system.manage');
      await requireCompliance(ctx, user);
    } catch { return null; }
    return { storageId: backup.storageId, filename: `hyprep-litigation-records-${backup.startedAt.slice(0, 10)}.jsonl.gz` };
  },
});

export const removeTicket = internalMutation({
  args: { id: v.id('archiveTickets') },
  returns: v.null(),
  handler: async (ctx, args) => { if (await ctx.db.get(args.id)) await ctx.db.delete(args.id); return null; },
});

export const exportTables = ['users', 'teams', 'permissionMatrix', 'cases', 'caseMembers', 'statusChanges', 'documents', 'courtDates', 'sentReminders', 'tasks', 'notes', 'notifications', 'auditLog', 'courts', 'caseTypes', 'documentTypes', 'tags', 'settings', 'savedViews', 'backups', 'counters'] as const;

export const claimScheduledBackup = internalMutation({
  args: { now: v.string() },
  returns: v.object({ backupId: v.union(v.id('backups'), v.null()), reason: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => {
    const now = Date.parse(args.now);
    if (!Number.isFinite(now)) throw new Error('Invalid backup schedule time.');
    const settings = await ctx.db.query('settings').first();
    if (!settings) return { backupId: null, reason: 'no settings row' };
    const hours = { hourly: 1, daily: 24, weekly: 168 }[settings.backupSchedule];
    const previous = await ctx.db.query('backups').withIndex('by_scheduledAt', (query) => query.gt('scheduledAt', '')).order('desc').first();
    if (previous?.scheduledAt) {
      const elapsed = now - Date.parse(previous.scheduledAt);
      if (previous.status === 'running' && elapsed < 15 * 60_000) return { backupId: null, reason: 'a scheduled export is already running' };
      if (previous.status === 'completed' && elapsed < hours * 3_600_000) return { backupId: null, reason: 'not due on the selected schedule' };
      if (previous.status === 'running') await ctx.db.patch(previous._id, { status: 'failed', completedAt: new Date(now).toISOString(), error: 'This scheduled export timed out. A new attempt has started.' });
    }
    const at = new Date(now).toISOString();
    const backupId = await ctx.db.insert('backups', {
      startedAt: at, scheduledAt: at, completedAt: null, type: 'Full', scope: 'Database', sizeGb: 0,
      location: 'Convex storage - application records only, not a recovery snapshot', status: 'running', storageId: null, triggeredById: null, error: null,
    });
    return { backupId, reason: null };
  },
});

export const page = internalQuery({
  args: { table: v.union(...exportTables.map((table) => v.literal(table))), paginationOpts: paginationOptsValidator },
  returns: v.object({ page: v.array(v.any()), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, args) => {
    const result = await ctx.db.query(args.table).paginate({ ...args.paginationOpts, numItems: Math.min(100, args.paginationOpts.numItems), maximumBytesRead: 500000 });
    return { page: result.page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});
