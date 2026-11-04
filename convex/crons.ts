import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

/**
 * HYPREP LCMS - scheduled work.
 *
 * Every job here is either idempotent by construction (the `sentReminders`
 * ledger makes the reminder job safe to re-run) or cheap to re-run (the OCR and
 * webhook requeues only pick up rows still in a pending state). Crons run on
 * UTC, while `settings.timeZone` is Africa/Lagos (UTC+1), so the digest offset
 * is explicit rather than implicit.
 *
 * The handlers themselves live in `cronHandlers.ts` (this file owns the
 * schedule; that one owns the work).
 */

const crons = cronJobs();

// ---------------------------------------------------------------------------
// Hearing reminders - hourly, idempotent via the sentReminders ledger.
// ---------------------------------------------------------------------------

/**
 * Walks the diary for sittings whose reminder window has opened and delivers
 * the in-app notification plus email/SMS fan-out exactly once per offset.
 */
crons.interval('hearing-reminders', { hours: 1 }, internal.cronHandlers.runReminders, {
  now: new Date().toISOString(),
});

// ---------------------------------------------------------------------------
// Daily / weekly digest (Africa/Lagos morning).
// ---------------------------------------------------------------------------

/**
 * Runs at 08:00 UTC = 09:00 Africa/Lagos, on the cadence the settings doc
 * asks for. The handler reads `settings.digestFrequency` and no-ops on 'off'.
 */
crons.cron('digest', '0 8 * * *', internal.cronHandlers.runDigest, {
  now: new Date().toISOString(),
});

// ---------------------------------------------------------------------------
// Overdue-task rollup - nightly reconcile.
// ---------------------------------------------------------------------------

/** Recomputes `overdueTaskCount` and reconciles all case rollups nightly. */
crons.cron('overdue-rollup', '0 1 * * *', internal.cases.internalReconcileRollups);

// ---------------------------------------------------------------------------
// Retention sweep - report-only until explicitly enabled.
// ---------------------------------------------------------------------------

/**
 * Archives concluded cases past `retentionArchiveAfterYears` and, when
 * `retentionDeletionEnabled` is set, moves documents past their type's
 * retention window onto a disposal review list. Runs in report-only mode by
 * default: `internal.cronHandlers.runRetentionSweep` logs what it *would* do
 * and only acts when the setting is on.
 */
crons.cron('retention-sweep', '0 2 * * *', internal.cronHandlers.runRetentionSweep, {
  now: new Date().toISOString(),
});

// ---------------------------------------------------------------------------
// Backup - per settings.backupSchedule (hourly/daily/weekly), default daily.
// ---------------------------------------------------------------------------

/** Runs the real export and prunes past `backupRetentionDays`. */
crons.cron('backup', '0 3 * * *', internal.cronHandlers.runScheduledBackup, {
  now: new Date().toISOString(),
});

// ---------------------------------------------------------------------------
// OCR requeue - every 15 minutes, drains stuck processing/failed documents.
// ---------------------------------------------------------------------------

crons.interval('ocr-requeue', { minutes: 15 }, internal.cronHandlers.requeueOcr);

// ---------------------------------------------------------------------------
// Webhook retry - every 5 minutes, drains pending deliveries past due.
// ---------------------------------------------------------------------------

crons.interval('webhook-retry', { minutes: 5 }, internal.cronHandlers.retryWebhooks, {
  now: new Date().toISOString(),
});

// ---------------------------------------------------------------------------
// Storage usage - daily, real sum of document version sizes.
// ---------------------------------------------------------------------------

/** Recomputes `settings.storageUsedGb` from the actual blobs in storage. */
crons.cron('storage-usage', '0 4 * * *', internal.cronHandlers.updateStorageUsage);

export default crons;
