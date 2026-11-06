import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import {
  Archive,
  Database,
  HardDrive,
  Laptop,
  Play,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { SystemSettings } from '@/types';
import { formatBytes, formatDateTime, formatNumber, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDataStore } from '@/store/dataStore';
import { useCan, useCurrentUser } from '@/store/authStore';
import { DAY_MS, useNow } from '@/hooks/useNow';
import { notify } from '@/store/uiStore';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Disclosure } from '@/components/ui/Disclosure';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Checkbox, Field, Input, Select } from '@/components/ui/Input';
import { StatCard } from '@/components/ui/StatCard';

const BACKUP_TONE = { completed: 'brand', running: 'gold', failed: 'danger' } as const;

/** Sessions, retention, storage and backups (TOR §30, §34–36). */
export function AdminSystemPage() {
  const downloadArchive = useMutation(api.backupDb.downloadArchive);
  const [exportBusy, setExportBusy] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const settings = useDataStore((state) => state.settings);
  const sessions = useDataStore((state) => state.sessions);
  const backups = useDataStore((state) => state.backups);
  const users = useDataStore((state) => state.users);
  const cases = useDataStore((state) => state.cases);
  const updateSettings = useDataStore((state) => state.updateSettings);
  const revokeSession = useDataStore((state) => state.revokeSession);
  const runBackup = useDataStore((state) => state.runBackup);
  const actor = useCurrentUser();
  const canManage = useCan('system.manage');
  const canRetain = useCan('retention.manage');
  const now = useNow();

  const [draft, setDraft] = useState<Partial<SystemSettings>>({});
  const [revoking, setRevoking] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const value = <K extends keyof SystemSettings>(key: K): SystemSettings[K] =>
    (draft[key] ?? settings[key]) as SystemSettings[K];
  const set = <K extends keyof SystemSettings>(key: K, next: SystemSettings[K]) =>
    setDraft((current) => ({ ...current, [key]: next }));

  const dirty = Object.keys(draft).length > 0;
  const save = async () => {
    setSaving(true);
    try {
      await updateSettings(draft, actor?.id ?? 'system');
      setDraft({});
      notify({ variant: 'success', title: 'Settings saved', description: 'The new values apply to every session from now on.' });
    } catch (failure) {
      notify({ variant: 'error', title: 'Settings were not saved', description: failure instanceof Error ? failure.message : 'Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  const quotaPct = Math.round((settings.storageUsedGb / settings.storageQuotaGb) * 100);
  const archivable = cases.filter(
    (record) =>
      record.status === 'Concluded' &&
      new Date(record.updatedAt).getTime() <
        now - settings.retentionArchiveAfterYears * 365 * DAY_MS,
  ).length;
  const lastBackup = backups[0];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Storage used"
          value={`${settings.storageUsedGb.toFixed(1)} GB`}
          hint={`of ${settings.storageQuotaGb} GB quota · ${quotaPct}%`}
          tone={quotaPct > 85 ? 'danger' : quotaPct > 70 ? 'gold' : 'default'}
          icon={<HardDrive className="size-4" aria-hidden />}
        />
        <StatCard
          label="Active sessions"
          value={sessions.length}
          hint="Signed in across all devices"
          icon={<Laptop className="size-4" aria-hidden />}
        />
        <StatCard
          label="Last backup"
          value={lastBackup ? formatRelative(lastBackup.startedAt) : 'None'}
          hint={lastBackup ? `${lastBackup.type} · ${formatBytes(lastBackup.sizeGb * 1_073_741_824)}` : 'No backup on record'}
          tone={lastBackup?.status === 'failed' ? 'danger' : 'default'}
          icon={<Database className="size-4" aria-hidden />}
        />
      </div>

      <Card>
        <CardHeader
          title="Storage quota"
          hint="Documents are held in the unit's own store; the quota is enforced on upload."
        />
        <CardBody className="space-y-3">
          <div>
            <div
              className="h-2.5 w-full overflow-hidden rounded-full bg-ink-100"
              role="progressbar"
              aria-valuenow={quotaPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Storage used"
            >
              <div
                className={cn(
                  'h-full rounded-full transition-[width]',
                  quotaPct > 85 ? 'bg-danger-500' : quotaPct > 70 ? 'bg-gold-500' : 'bg-brand-500',
                )}
                style={{ width: `${Math.min(100, quotaPct)}%` }}
              />
            </div>
            <p className="mt-1.5 text-[12px] text-ink-600">
              {settings.storageUsedGb.toFixed(1)} GB of {settings.storageQuotaGb} GB used ·{' '}
              {(settings.storageQuotaGb - settings.storageUsedGb).toFixed(1)} GB remaining
            </p>
          </div>
          {canManage && (
            <div className="w-48">
              <Field label="Quota (GB)">
                {(props) => (
                  <Input
                    type="number"
                    min={10}
                    step={10}
                    value={value('storageQuotaGb')}
                    onChange={(event) => set('storageQuotaGb', Number(event.target.value))}
                    sizing="sm"
                    {...props}
                  />
                )}
              </Field>
            </div>
          )}
        </CardBody>
      </Card>

      <Disclosure
        title="Security & sessions"
        summary={`Signed out after ${value('sessionTimeoutMinutes')} idle minutes · locked after ${value('maxFailedLoginAttempts')} failed attempts`}
        icon={<ShieldCheck className="size-4" aria-hidden />}
        defaultOpen
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Session timeout (minutes)" hint="Idle sessions are ended.">
            {(props) => (
              <Input
                type="number"
                min={5}
                max={480}
                disabled={!canManage}
                value={value('sessionTimeoutMinutes')}
                onChange={(event) => set('sessionTimeoutMinutes', Number(event.target.value))}
                sizing="sm"
                {...props}
              />
            )}
          </Field>
          <Field label="Failed attempts before lockout">
            {(props) => (
              <Input
                type="number"
                min={3}
                max={10}
                disabled={!canManage}
                value={value('maxFailedLoginAttempts')}
                onChange={(event) => set('maxFailedLoginAttempts', Number(event.target.value))}
                sizing="sm"
                {...props}
              />
            )}
          </Field>
          <Field label="Password expiry (days)">
            {(props) => (
              <Input
                type="number"
                min={30}
                max={365}
                disabled={!canManage}
                value={value('passwordExpiryDays')}
                onChange={(event) => set('passwordExpiryDays', Number(event.target.value))}
                sizing="sm"
                {...props}
              />
            )}
          </Field>
          <Field label="Minimum password length">
            {(props) => (
              <Input
                type="number"
                min={8}
                max={32}
                disabled={!canManage}
                value={value('passwordMinLength')}
                onChange={(event) => set('passwordMinLength', Number(event.target.value))}
                sizing="sm"
                {...props}
              />
            )}
          </Field>
          <div className="sm:col-span-2 lg:col-span-4 space-y-2">
            <Checkbox
              checked={value('passwordRequireComplexity')}
              disabled={!canManage}
              onChange={(event) => set('passwordRequireComplexity', event.target.checked)}
              label="Require upper case, lower case, a digit and a symbol"
            />
            <Checkbox
              checked={value('watermarkConfidentialDownloads')}
              disabled={!canManage}
              onChange={(event) => set('watermarkConfidentialDownloads', event.target.checked)}
              label="Watermark confidential downloads"
              description="Stamps the recipient's name, the time and the case ID on each page."
            />
            <Checkbox
              checked={value('ssoEnabled')}
              disabled={!canManage}
              onChange={(event) => set('ssoEnabled', event.target.checked)}
              label="Allow single sign-on with the HYPREP directory"
            />
          </div>
        </div>
      </Disclosure>

      <Disclosure
        title="Retention & archiving"
        summary={`Archived ${value('retentionArchiveAfterYears')} years after conclusion, never deleted · ${formatNumber(archivable)} ready on the next run`}
        icon={<Archive className="size-4" aria-hidden />}
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Archive concluded matters after (years)">
              {(props) => (
                <Input
                  type="number"
                  min={1}
                  max={25}
                  disabled={!canRetain}
                  value={value('retentionArchiveAfterYears')}
                  onChange={(event) => set('retentionArchiveAfterYears', Number(event.target.value))}
                  sizing="sm"
                  {...props}
                />
              )}
            </Field>
            <Field label="Backup retention (days)">
              {(props) => (
                <Input
                  type="number"
                  min={7}
                  max={365}
                  disabled={!canManage}
                  value={value('backupRetentionDays')}
                  onChange={(event) => set('backupRetentionDays', Number(event.target.value))}
                  sizing="sm"
                  {...props}
                />
              )}
            </Field>
            <Field label="Backup schedule">
              {(props) => (
                <Select
                  value={value('backupSchedule')}
                  disabled={!canManage}
                  onChange={(event) =>
                    set('backupSchedule', event.target.value as SystemSettings['backupSchedule'])
                  }
                  sizing="sm"
                  {...props}
                >
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </Select>
              )}
            </Field>
            <Field label="Digest e-mails">
              {(props) => (
                <Select
                  value={value('digestFrequency')}
                  disabled={!canManage}
                  onChange={(event) =>
                    set('digestFrequency', event.target.value as SystemSettings['digestFrequency'])
                  }
                  sizing="sm"
                  {...props}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="off">Off</option>
                </Select>
              )}
            </Field>
          </div>
          <p className="rounded-lg bg-ink-50 px-3 py-2 text-[12px] text-ink-700">
            <span className="font-semibold text-ink-900">{formatNumber(archivable)}</span> concluded
            matter{archivable === 1 ? '' : 's'} currently meet the archiving rule and will move to
            the archive on the next nightly run.
          </p>
        </div>
      </Disclosure>

      <Disclosure
        title="Active sessions"
        summary="Sign a device out remotely if an account may be compromised"
        meta={
          <Badge tone="neutral" size="sm">
            {sessions.length}
          </Badge>
        }
        icon={<Laptop className="size-4" aria-hidden />}
        flush
      >
        <ul>
          {sessions.map((session) => {
            const user = users.find((item) => item.id === session.userId);
            return (
              <li
                key={session.id}
                className="flex items-center gap-3 border-b border-ink-100 px-4 py-2.5 last:border-b-0 sm:px-5"
              >
                {user && <Avatar user={user} size="sm" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-ink-900">
                    {user?.fullName ?? 'Unknown user'}
                    {session.current && (
                      <Badge tone="brand" size="sm" className="ml-1.5">
                        This device
                      </Badge>
                    )}
                  </p>
                  <p className="truncate text-[11px] text-ink-500">
                    {session.device} · {session.browser} · {session.ipAddress} · {session.location}
                  </p>
                </div>
                <span
                  className="hidden shrink-0 text-[11px] text-ink-500 sm:block"
                  title={formatDateTime(session.lastSeenAt)}
                >
                  Active {formatRelative(session.lastSeenAt)}
                </span>
                {canManage && !session.current && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setRevoking(session.id)}
                    icon={<Trash2 className="size-4 text-danger-600" aria-hidden />}
                    aria-label="Sign this session out"
                  />
                )}
              </li>
            );
          })}
        </ul>
      </Disclosure>

      <Disclosure
        title="Backups"
        summary={
          lastBackup
            ? `Last run ${formatRelative(lastBackup.startedAt)} · ${settings.backupSchedule} application records in Convex storage (not a recovery snapshot)`
            : 'No backup on record'
        }
        meta={
          lastBackup && (
            <Badge tone={BACKUP_TONE[lastBackup.status]} size="sm">
              {lastBackup.status === 'completed' ? 'Export completed' : lastBackup.status === 'running' ? 'Running' : 'Failed'}
            </Badge>
          )
        }
        icon={<Database className="size-4" aria-hidden />}
        flush
      >
        {canManage && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
            <p className="text-[12px] text-ink-600">
              Kept for {value('backupRetentionDays')} days, then rotated.
            </p>
            <Button
              size="sm"
              onClick={async () => {
                if (exportBusy) return;
                setExportBusy(true);
                try {
                  await runBackup(actor?.id ?? 'system');
                  notify({ variant: 'success', title: 'Record export completed', description: 'Application records were exported. File bytes and sign-in data require a separate platform snapshot.' });
                } catch (error) {
                  notify({ variant: 'error', title: 'Record export failed', description: error instanceof Error ? error.message : 'Please try again.' });
                }
                finally { setExportBusy(false); }
              }}
              loading={exportBusy}
              icon={<Play className="size-4" aria-hidden />}
            >
              Export application records
            </Button>
          </div>
        )}
        <ul className={cn(canManage && 'border-t border-ink-100')}>
          {backups.slice(0, 8).map((backup) => (
            <li
              key={backup.id}
              className="flex items-center gap-3 border-b border-ink-100 px-4 py-2.5 last:border-b-0 sm:px-5"
            >
              <Database className="size-4 shrink-0 text-ink-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-ink-900">
                  {backup.type} backup · {backup.scope}
                </p>
                <p className="truncate text-[11px] text-ink-500">
                  {formatDateTime(backup.startedAt)} · {backup.location}
                </p>
              </div>
              <span className="tnum shrink-0 text-[12px] text-ink-700">{formatBytes(backup.sizeGb * 1_073_741_824)}</span>
              {backup.archiveAvailable && <Button size="sm" loading={downloading === backup.id} onClick={async () => {
                setDownloading(backup.id);
                try {
                  const archive = await downloadArchive({ id: backup.id as never });
                  const response = await fetch(archive.url);
                  if (!response.ok) throw new Error('Archive download failed or access expired.');
                  const url = URL.createObjectURL(await response.blob());
                  const link = document.createElement('a'); link.href = url; link.download = archive.filename; link.click();
                  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                } catch (error) { notify({ variant: 'error', title: 'Download failed', description: error instanceof Error ? error.message : 'Please try again.' }); }
                finally { setDownloading(null); }
              }}>Download</Button>}
              {backup.error && <span role="alert" className="text-[11px] text-danger-600">{backup.error}</span>}
              <Badge tone={BACKUP_TONE[backup.status]} size="sm">
                {backup.status === 'completed'
                  ? 'Completed'
                  : backup.status === 'running'
                    ? 'Running'
                    : 'Failed'}
              </Badge>
            </li>
          ))}
        </ul>
      </Disclosure>

      {(canManage || canRetain) && (
        <div className="sticky bottom-3 flex items-center justify-end gap-2 rounded-xl border border-ink-200 bg-white/95 p-2.5 backdrop-blur">
          <p className="mr-auto text-[12px] text-ink-600">
            {dirty ? 'Unsaved changes to system settings.' : 'All settings saved.'}
          </p>
          <Button disabled={!dirty || saving} onClick={() => setDraft({})}>
            Discard
          </Button>
          <Button
            variant="primary"
            disabled={!dirty || saving}
            onClick={save}
            icon={<Save className="size-4" aria-hidden />}
          >
            Save settings
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        title="Sign this session out?"
        destructive
        message="The device will be returned to the sign-in screen on its next request. Unsaved work on that device is lost."
        confirmLabel="Sign out"
        onConfirm={() => {
          if (!revoking) return;
          revokeSession(revoking, actor?.id ?? 'system');
          notify({ variant: 'success', title: 'Session ended' });
          setRevoking(null);
        }}
      />
    </div>
  );
}
