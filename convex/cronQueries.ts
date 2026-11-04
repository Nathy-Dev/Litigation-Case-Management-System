import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';

/**
 * HYPREP LCMS - internal queries/mutations the cron workers share.
 *
 * Kept in their own file so the cron *actions* (`cronHandlers.ts`) can call
 * them through `internal.cronQueries.*` without a same-file type cycle. A
 * Convex action has no `db`, so all its data access goes through these.
 */

/** Active (non-disabled) users, for the digest fan-out. */
export const activeUsers = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('users').collect();
    return rows
      .filter((user) => user.status === 'active')
      .map((user) => ({ id: user._id, email: user.email, fullName: user.fullName }));
  },
});

/** Phone numbers for a set of users, for the SMS reminder leg. */
export const phonesForUsers = internalQuery({
  args: { userIds: v.array(v.id('users')) },
  handler: async (ctx, { userIds }) => {
    const byUser = new Map<string, string | null>();
    for (const userId of userIds) {
      if (byUser.has(userId)) continue;
      const user = await ctx.db.get(userId);
      byUser.set(userId, user?.phone ?? null);
    }
    return Array.from(byUser.entries()).map(([userId, phone]) => ({ userId, phone }));
  },
});

/** Concluded matters whose filing date predates the retention cutoff. */
export const concludedCases = internalQuery({
  args: { before: v.string() },
  handler: async (ctx, { before }) => {
    const rows = await ctx.db.query('cases').collect();
    return rows
      .filter(
        (record) =>
          record.status === 'Concluded' &&
          record.archivedAt === null &&
          record.filingDate !== null &&
          record.filingDate < before,
      )
      .map((record) => record._id);
  },
});

/** Sets `archivedAt`, idempotently, from the retention sweep. */
export const setArchived = internalMutation({
  args: { caseId: v.id('cases'), at: v.string() },
  handler: async (ctx, { caseId, at }) => {
    const record = await ctx.db.get(caseId);
    if (record === null || record.archivedAt !== null) return { archived: false };
    await ctx.db.patch(caseId, { archivedAt: at });
    return { archived: true };
  },
});
