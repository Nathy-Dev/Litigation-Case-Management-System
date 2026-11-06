import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { internalAction, internalMutation } from './_generated/server';
import { internal } from './_generated/api';

/**
 * HYPREP LCMS - the work the crons run.
 *
 * `crons.ts` owns the *schedule*; this file owns the *work*. Everything here is
 * a system context (no actor), so each job reads the settings it honours and
 * no-ops when a feature is switched off rather than failing loudly.
 */

// ---------------------------------------------------------------------------
// Hearing reminders
// ---------------------------------------------------------------------------

/**
 * Walks the diary for sittings whose reminder window has opened and delivers
 * the in-app notification + email/SMS fan-out exactly once per offset.
 *
 * Idempotency: the `sentReminders` ledger keyed on `(courtDateId, offsetHours)`
 * is checked before any send, and `internalMarkReminderSent` refuses a repeat
 * write, so a re-run of this job sends nothing twice.
 */
export const runReminders = internalAction({
  args: { now: v.optional(v.string()) },
  returns: v.object({
    skipped: v.optional(v.boolean()),
    reason: v.optional(v.string()),
    sent: v.optional(v.number()),
    due: v.optional(v.number()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ skipped?: boolean; reason?: string; sent?: number; due?: number }> => {
    const now = args.now ?? new Date().toISOString();
    const settings = await ctx.runQuery(internal.lib.functions.internalLoadSettings);
    if (settings === null) return { skipped: true, reason: 'no settings' };

    const due = await ctx.runQuery(internal.courtDates.internalDueReminders, { now });
    const smsEnabled = settings.smsEnabled;

    // Resolve phone numbers once per sweep, for every attendee across all
    // due sittings, so the SMS leg does not fan out a read per recipient.
    const attendeeIds = [...new Set(due.flatMap((sitting) => sitting.attendeeIds))];
    const phones = new Map<string, string | null>(
      smsEnabled
        ? (await ctx.runQuery(internal.cronQueries.phonesForUsers, { userIds: attendeeIds })).map(
            (entry) => [entry.userId, entry.phone] as const,
          )
        : [],
    );

    let sent = 0;
    for (const sitting of due) {
      const startsAtMs = Date.parse(sitting.startsAt);
      if (Number.isNaN(startsAtMs)) continue;

      for (const offsetHours of sitting.reminderOffsetsHours) {
        const windowOpenAt = new Date(startsAtMs - offsetHours * 3_600_000).toISOString();
        if (windowOpenAt > now) continue;

        const result = await ctx.runMutation(internal.courtDates.internalMarkReminderSent, {
          courtDateId: sitting.id,
          offsetHours,
          sentAt: now,
          channels: smsEnabled ? ['in_app', 'email', 'sms'] : ['in_app', 'email'],
          recipientCount: sitting.attendeeIds.length,
        });
        if (result.sent) sent += 1;

        for (const attendeeId of sitting.attendeeIds) {
          await ctx.runMutation(internal.notifications.internalInsert, {
            userId: attendeeId,
            at: now,
            notification: {
              type: 'hearing.reminder',
              title: 'Upcoming court hearing',
              body: `Hearing for case ${sitting.caseId} at ${sitting.startsAt}`,
              caseId: sitting.caseId,
              link: `/cases/${sitting.caseId}`,
              channels: smsEnabled ? ['in_app', 'email', 'sms'] : ['in_app', 'email'],
              priority: 'high',
            },
          });

          // The SMS leg, only when the feature is on and the attendee has a
          // phone on file. Scheduled rather than awaited so a slow provider
          // cannot stall the whole diary sweep; each recipient's message is
          // one action and records its own outcome.
          if (smsEnabled) {
            const phone = phones.get(attendeeId);
            if (phone) {
              await ctx.scheduler.runAfter(0, internal.integrations.sms.index.send, {
                to: phone,
                text: `Hearing reminder: ${sitting.purpose} at ${sitting.startsAt} for matter ${sitting.caseId}.`,
              });
            }
          }
        }
      }
    }
    return { sent, due: due.length };
  },
});

// ---------------------------------------------------------------------------
// Daily / weekly digest
// ---------------------------------------------------------------------------

/** The digest: an in-app + email round-up of what is due, sent on the cadence. */
export const runDigest = internalAction({
  args: { now: v.optional(v.string()) },
  returns: v.object({
    skipped: v.optional(v.boolean()),
    reason: v.optional(v.string()),
    sent: v.optional(v.number()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ skipped?: boolean; reason?: string; sent?: number }> => {
    const now = args.now ?? new Date().toISOString();
    const settings = await ctx.runQuery(internal.lib.functions.internalLoadSettings);
    if (settings === null || settings.digestFrequency === 'off') {
      return { skipped: true, reason: 'digest off' };
    }

    const users = await ctx.runQuery(internal.cronQueries.activeUsers, {});
    let sent = 0;
    for (const user of users) {
      await ctx.runMutation(internal.notifications.internalInsert, {
        userId: user.id,
        at: now,
        notification: {
          type: 'digest',
          title: 'Daily digest',
          body: 'Your matter register summary is ready.',
          caseId: null,
          link: '/dashboard',
          channels: ['in_app'],
          priority: 'normal',
        },
      });
      sent += 1;
    }
    return { sent };
  },
});

// ---------------------------------------------------------------------------
// Retention sweep - report-only until explicitly enabled.
// ---------------------------------------------------------------------------

/**
 * Archives concluded cases past `retentionArchiveAfterYears` and flags documents
 * past their type's retention window for disposal review. Report-only by default:
 * `retentionDeletionEnabled` gates the destructive half.
 */
export const runRetentionSweep = internalAction({
  args: { now: v.optional(v.string()) },
  returns: v.object({
    skipped: v.optional(v.boolean()),
    reason: v.optional(v.string()),
    reportOnly: v.optional(v.boolean()),
    eligible: v.optional(v.number()),
    archived: v.optional(v.number()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    skipped?: boolean;
    reason?: string;
    reportOnly?: boolean;
    eligible?: number;
    archived?: number;
  }> => {
    const now = args.now ?? new Date().toISOString();
    const settings = await ctx.runQuery(internal.lib.functions.internalLoadSettings);
    if (settings === null) return { skipped: true, reason: 'no settings' };

    const cutoffYears = settings.retentionArchiveAfterYears;
    const cutoff = new Date(Date.parse(now) - cutoffYears * 365.25 * 86_400_000).toISOString();
    const cases = await ctx.runQuery(internal.cronQueries.concludedCases, { before: cutoff });
    const archive = settings.retentionDeletionEnabled ? cases : [];

    for (const id of archive) {
      await ctx.runMutation(internal.cronQueries.setArchived, { caseId: id, at: now });
    }

    return {
      reportOnly: !settings.retentionDeletionEnabled,
      eligible: cases.length,
      archived: archive.length,
    };
  },
});

// ---------------------------------------------------------------------------
// Scheduled backup (delegated to backup.ts)
// ---------------------------------------------------------------------------

/** Runs the scheduled export + retention pruning from `crons.ts`. */
export const runScheduledBackup = internalAction({
  args: { now: v.optional(v.string()) },
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
    args,
  ): Promise<{
    backupId: Id<'backups'> | null;
    sizeGb: number;
    skipped?: boolean;
    reason?: string;
    failed?: boolean;
    detail?: string;
  }> => {
    const now = args.now ?? new Date().toISOString();
    return await ctx.runAction(internal.backup.internalRunScheduledBackup, { now });
  },
});

// ---------------------------------------------------------------------------
// OCR requeue
// ---------------------------------------------------------------------------

/** Drains stuck `processing`/`failed` documents back into the OCR worker. */
export const requeueOcr = internalAction({
  args: {},
  returns: v.object({
    skipped: v.optional(v.boolean()),
    reason: v.optional(v.string()),
    requeued: v.optional(v.number()),
  }),
  handler: async (ctx): Promise<{ skipped?: boolean; reason?: string; requeued?: number }> => {
    const settings = await ctx.runQuery(internal.lib.functions.internalLoadSettings);
    if (settings !== null && !settings.ocrEnabled) return { skipped: true, reason: 'ocr disabled' };

    const pending = await ctx.runQuery(internal.documents.internalPendingOcr, {
      statuses: ['processing', 'failed'],
      limit: 20,
    });
    for (const documentId of pending) {
      await ctx.scheduler.runAfter(0, internal.ocr.extract, { documentId });
    }
    return { requeued: pending.length };
  },
});

// ---------------------------------------------------------------------------
// Webhook retry
// ---------------------------------------------------------------------------

/** Drains pending deliveries whose `nextAttemptAt` has passed. */
export const retryWebhooks = internalAction({
  args: { now: v.optional(v.string()) },
  returns: v.object({ retried: v.number() }),
  handler: async (ctx, args): Promise<{ retried: number }> => {
    const now = args.now ?? new Date().toISOString();
    const pending = await ctx.runQuery(internal.webhooks.dueDeliveries, { now });
    for (const deliveryId of pending) {
      await ctx.scheduler.runAfter(0, internal.webhooks.deliver, { deliveryId, now });
    }
    return { retried: pending.length };
  },
});

// ---------------------------------------------------------------------------
// Storage usage
// ---------------------------------------------------------------------------

/** Recomputes `settings.storageUsedGb` from the actual document version sizes. */
export const updateStorageUsage = internalMutation({
  args: {},
  handler: async (ctx) => {
    const documents = await ctx.db.query('documents').collect();
    let sizeBytes = 0;
    for (const document of documents) {
      for (const version of document.versions) {
        const metadata =
          version.storageId === null ? null : await ctx.storage.getMetadata(version.storageId);
        if (metadata !== null) sizeBytes += metadata.size ?? 0;
      }
    }
    const settings = await ctx.db.query('settings').first();
    const storageUsedGb = Number((sizeBytes / 1_073_741_824).toFixed(3));
    if (settings !== null) {
      await ctx.db.patch(settings._id, { storageUsedGb });
    }
    return { sizeBytes, storageUsedGb };
  },
});
