import { Database, HardDrive, ShieldCheck } from 'lucide-react';
import { formatDateTime, formatRelative } from '@/lib/format';
import { useDataStore } from '@/store/dataStore';
import { Card, CardHeader } from '@/components/ui/Card';
import { Meter } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';

/** Admin-only strip: storage against quota, last backup, session policy. */
export function SystemHealthPanel() {
  const settings = useDataStore((state) => state.settings);
  const backups = useDataStore((state) => state.backups);
  const sessions = useDataStore((state) => state.sessions);

  const lastGood = backups.find((backup) => backup.status === 'completed');
  const failed = backups.filter((backup) => backup.status === 'failed').length;
  const quotaPct = Math.round((settings.storageUsedGb / settings.storageQuotaGb) * 100);

  return (
    <Card flush>
      <CardHeader
        title="System health"
        description="Storage, backups and session policy."
        icon={<ShieldCheck className="size-4" aria-hidden />}
        actions={
          <ButtonLink to="/admin/system" variant="ghost" size="sm">
            Manage
          </ButtonLink>
        }
        divided
      />

      <div className="space-y-4 px-4 py-4">
        <div>
          <Meter
            label={
              <span className="inline-flex items-center gap-1.5">
                <HardDrive className="size-3.5 text-ink-400" aria-hidden />
                Document storage
              </span>
            }
            value={settings.storageUsedGb}
            max={settings.storageQuotaGb}
            tone={quotaPct >= 85 ? 'danger' : quotaPct >= 70 ? 'gold' : 'brand'}
            caption={`${settings.storageUsedGb.toFixed(1)} GB of ${settings.storageQuotaGb} GB used · ${quotaPct}%`}
          />
        </div>

        <div className="flex items-start gap-2.5 border-t border-ink-100 pt-3.5">
          <Database className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-ink-900">
              Last backup
              {failed > 0 ? (
                <Badge tone="danger" size="sm">
                  {failed} failed
                </Badge>
              ) : (
                <Badge tone="success" size="sm">
                  Healthy
                </Badge>
              )}
            </p>
            <p className="mt-0.5 text-[12px] leading-snug text-ink-500">
              {lastGood
                ? `${lastGood.type} · ${lastGood.scope} · ${formatRelative(lastGood.completedAt ?? lastGood.startedAt)}`
                : 'No completed backup on record.'}
            </p>
            {lastGood?.completedAt && (
              <p className="tnum mt-0.5 text-[11px] text-ink-400">
                {formatDateTime(lastGood.completedAt)} · {lastGood.sizeGb.toFixed(1)} GB
              </p>
            )}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-ink-100 pt-3.5 text-[12px]">
          <div>
            <dt className="text-ink-500">Active sessions</dt>
            <dd className="tnum font-semibold text-ink-900">{sessions.length}</dd>
          </div>
          <div>
            <dt className="text-ink-500">Session timeout</dt>
            <dd className="tnum font-semibold text-ink-900">
              {settings.sessionTimeoutMinutes} min
            </dd>
          </div>
          <div>
            <dt className="text-ink-500">Backup schedule</dt>
            <dd className="font-semibold text-ink-900 capitalize">{settings.backupSchedule}</dd>
          </div>
          <div>
            <dt className="text-ink-500">Retention</dt>
            <dd className="tnum font-semibold text-ink-900">
              {settings.backupRetentionDays} days
            </dd>
          </div>
        </dl>
      </div>
    </Card>
  );
}
