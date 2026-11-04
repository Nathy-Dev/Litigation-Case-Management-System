import { v } from 'convex/values';
import { internalMutation } from './_generated/server';
import { authedMutation, authedQuery } from './lib/functions';
import {
  notificationChannelValidator,
  notificationPriorityValidator,
  notificationTypeValidator,
} from './shared/enums';

/**
 * HYPREP LCMS - in-app notifications.
 *
 * Notifications are personal: a row belongs to exactly one user, and every
 * query and mutation here is scoped to the caller's own id, resolved from the
 * session rather than accepted as an argument. A user cannot read or mark
 * another user's notifications, and the wrapper's identity is the only source
 * of who that is.
 *
 * The channel fan-out (email/SMS) is the job of the reminder and digest crons
 * in `crons.ts`/`integrations/`; this module owns the in-app ledger only.
 */

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

const notificationRow = v.object({
  id: v.id('notifications'),
  userId: v.id('users'),
  type: notificationTypeValidator,
  title: v.string(),
  body: v.string(),
  caseId: v.union(v.id('cases'), v.null()),
  link: v.union(v.string(), v.null()),
  channels: v.array(notificationChannelValidator),
  priority: notificationPriorityValidator,
  read: v.boolean(),
  at: v.string(),
});

const notificationInput = v.object({
  type: notificationTypeValidator,
  title: v.string(),
  body: v.string(),
  caseId: v.union(v.id('cases'), v.null()),
  link: v.union(v.string(), v.null()),
  channels: v.array(notificationChannelValidator),
  priority: notificationPriorityValidator,
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** The caller's notifications, newest first. */
export const list = authedQuery({
  permission: null,
  args: { limit: v.optional(v.number()) },
  returns: v.array(notificationRow),
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query('notifications')
      .withIndex('by_user_at', (q) => q.eq('userId', ctx.actor.user._id))
      .order('desc')
      .collect();
    return rows.slice(0, limit ?? rows.length).map((row) => ({
      id: row._id,
      userId: row.userId,
      type: row.type,
      title: row.title,
      body: row.body,
      caseId: row.caseId,
      link: row.link,
      channels: row.channels,
      priority: row.priority,
      read: row.read,
      at: row.at,
    }));
  },
});

/** The count of unread rows, for the topbar badge. */
export const unreadCount = authedQuery({
  permission: null,
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query('notifications')
      .withIndex('by_user_read', (q) => q.eq('userId', ctx.actor.user._id).eq('read', false))
      .collect();
    return rows.length;
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Marks one of the caller's own notifications as read. */
export const markRead = authedMutation({
  permission: null,
  audit: {
    skip: 'A user reading their own notification is not an auditable act; marking it read is equivalent to dismissing a toast.',
  },
  args: { id: v.id('notifications') },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (row === null || row.userId !== ctx.actor.user._id) return { id };
    await ctx.db.patch(id, { read: true });
    return { id };
  },
});

/** Marks all of the caller's notifications as read. */
export const markAllRead = authedMutation({
  permission: null,
  audit: {
    skip: 'Marking your own notification tray read is a client convenience, not an auditable act; the volume would bury entries that matter.',
  },
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query('notifications')
      .withIndex('by_user_read', (q) => q.eq('userId', ctx.actor.user._id).eq('read', false))
      .collect();
    for (const row of rows) await ctx.db.patch(row._id, { read: true });
    return { updated: rows.length };
  },
});

// ---------------------------------------------------------------------------
// Internal surface (crons, fan-out helpers)
// ---------------------------------------------------------------------------

/**
 * Creates a notification for one user. Called by the reminder cron, digest and
 * the fan-out helpers in `integrations/` - all system contexts, never a client.
 */
export const internalInsert = internalMutation({
  args: {
    userId: v.id('users'),
    notification: notificationInput,
    at: v.string(),
  },
  returns: v.id('notifications'),
  handler: async (ctx, { userId, notification, at }) => {
    return await ctx.db.insert('notifications', {
      userId,
      ...notification,
      read: false,
      at,
    });
  },
});
