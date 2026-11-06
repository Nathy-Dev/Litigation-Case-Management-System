import { convexTest } from 'convex-test';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';
import { DEFAULT_SETTINGS } from './seed/reference';
import type { Doc, Id } from './_generated/dataModel';

const modules = import.meta.glob('./**/*.ts');
const now = '2026-11-06T03:00:00.000Z';

afterEach(() => vi.useRealTimers());

async function fixture(schedule: Doc<'settings'>['backupSchedule'] = 'daily') {
  const backend = convexTest(schema, modules);
  const settingsId = await backend.run((ctx) => ctx.db.insert('settings', { ...DEFAULT_SETTINGS, backupSchedule: schedule }));
  return { backend, settingsId };
}

async function complete(backend: ReturnType<typeof convexTest>, id: Id<'backups'>, at = now) {
  await backend.mutation(internal.admin.internalCompleteBackup, { id, completedAt: at, sizeGb: 0, storageId: null, status: 'completed', error: null });
}

describe('scheduled application-record exports', () => {
  test.each([['hourly', 1], ['daily', 24], ['weekly', 168]] as const)('honours the %s interval without duplicate runs', async (schedule, hours) => {
    const { backend } = await fixture(schedule);
    const first = await backend.mutation(internal.backupDb.claimScheduledBackup, { now });
    expect(first.backupId).not.toBeNull();
    const repeated = await backend.mutation(internal.backupDb.claimScheduledBackup, { now });
    expect(repeated.backupId).toBeNull();
    expect(repeated.reason).toMatch(/already running/);
    await complete(backend, first.backupId!);
    const tooSoon = new Date(Date.parse(now) + hours * 3_600_000 - 1).toISOString();
    expect((await backend.mutation(internal.backupDb.claimScheduledBackup, { now: tooSoon })).backupId).toBeNull();
    const due = new Date(Date.parse(now) + hours * 3_600_000).toISOString();
    const next = await backend.mutation(internal.backupDb.claimScheduledBackup, { now: due });
    expect(next.backupId).not.toBeNull();
    const record = await backend.run((ctx) => ctx.db.get(next.backupId!));
    expect(record?.scheduledAt).toBe(due);
  });

  test('uses execution time when the cron passes no date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const { backend } = await fixture();
    const first = await backend.mutation(internal.backupDb.claimScheduledBackup, { now });
    await complete(backend, first.backupId!);
    const result = await backend.action(internal.cronHandlers.runScheduledBackup, {});
    expect(result).toMatchObject({ backupId: null, skipped: true, reason: 'not due on the selected schedule' });
  });

  test('applies a changed schedule immediately', async () => {
    const { backend, settingsId } = await fixture();
    const first = await backend.mutation(internal.backupDb.claimScheduledBackup, { now });
    await complete(backend, first.backupId!);
    await backend.run((ctx) => ctx.db.patch(settingsId, { backupSchedule: 'hourly' }));
    const next = await backend.mutation(internal.backupDb.claimScheduledBackup, { now: '2026-11-06T04:00:00.000Z' });
    expect(next.backupId).not.toBeNull();
  });

  test('retries a failed export without waiting a week', async () => {
    const { backend } = await fixture('weekly');
    const first = await backend.mutation(internal.backupDb.claimScheduledBackup, { now });
    await backend.mutation(internal.admin.internalCompleteBackup, { id: first.backupId!, completedAt: now, sizeGb: 0, storageId: null, status: 'failed', error: 'Storage temporarily unavailable' });
    expect((await backend.mutation(internal.backupDb.claimScheduledBackup, { now: '2026-11-06T04:00:00.000Z' })).backupId).not.toBeNull();
  });

  test('marks a stalled run failed before replacing it', async () => {
    const { backend } = await fixture();
    const first = await backend.mutation(internal.backupDb.claimScheduledBackup, { now });
    const replacement = await backend.mutation(internal.backupDb.claimScheduledBackup, { now: '2026-11-06T04:00:00.000Z' });
    expect(replacement.backupId).not.toBeNull();
    expect(await backend.run((ctx) => ctx.db.get(first.backupId!))).toMatchObject({ status: 'failed', error: expect.stringMatching(/timed out/) });
  });

  test('ignores a manual export when calculating the scheduled interval', async () => {
    const { backend } = await fixture();
    const manual = await backend.mutation(internal.admin.internalStartBackup, { type: 'Full', scope: 'Database', triggeredById: null });
    await complete(backend, manual);
    expect((await backend.mutation(internal.backupDb.claimScheduledBackup, { now })).backupId).not.toBeNull();
  });

  test('does not run without settings and rejects an invalid clock value', async () => {
    const backend = convexTest(schema, modules);
    expect(await backend.mutation(internal.backupDb.claimScheduledBackup, { now })).toEqual({ backupId: null, reason: 'no settings row' });
    await expect(backend.mutation(internal.backupDb.claimScheduledBackup, { now: 'not-a-date' })).rejects.toThrow(/Invalid backup schedule time/);
  });
});
