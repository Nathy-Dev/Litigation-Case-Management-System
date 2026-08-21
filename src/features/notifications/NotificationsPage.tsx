import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bell,
  CalendarClock,
  CheckCheck,
  FileText,
  Gavel,
  Inbox,
  ListChecks,
  Mail,
  MessageSquare,
  Repeat,
  Settings2,
  TriangleAlert,
} from 'lucide-react';
import type { AppNotification, NotificationType } from '@/types';
import { formatDateTime, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDataStore, useNotificationsFor } from '@/store/dataStore';
import { useCurrentUser } from '@/store/authStore';
import { notify } from '@/store/uiStore';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { TabPanel, Tabs } from '@/components/ui/Tabs';

const ICONS: Record<NotificationType, typeof Bell> = {
  'hearing.reminder': CalendarClock,
  'case.assigned': Gavel,
  'document.uploaded': FileText,
  'task.assigned': ListChecks,
  'task.overdue': TriangleAlert,
  'status.changed': Repeat,
  'courtdate.changed': CalendarClock,
  digest: Inbox,
  system: Settings2,
};

const LABELS: Record<NotificationType, string> = {
  'hearing.reminder': 'Hearing reminder',
  'case.assigned': 'Matter assigned',
  'document.uploaded': 'Document filed',
  'task.assigned': 'Task assigned',
  'task.overdue': 'Task overdue',
  'status.changed': 'Status changed',
  'courtdate.changed': 'Sitting changed',
  digest: 'Digest',
  system: 'System',
};

const CHANNEL_ICON = { in_app: Bell, email: Mail, sms: MessageSquare } as const;

/** One notification row. Clicking it marks it read and follows its link. */
function Row({ item, onRead }: { item: AppNotification; onRead: () => void }) {
  const Icon = ICONS[item.type];
  const body = (
    <>
      <span
        className={cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
          item.priority === 'high' ? 'bg-danger-50 text-danger-600' : 'bg-brand-50 text-brand-700',
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold text-ink-900">{item.title}</span>
          {!item.read && <span className="size-1.5 shrink-0 rounded-full bg-brand-600" aria-label="Unread" />}
        </span>
        <span className="mt-0.5 block text-[12px] text-ink-600">{item.body}</span>
        <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-500">
          <Badge tone="neutral" size="sm">
            {LABELS[item.type]}
          </Badge>
          <span title={formatDateTime(item.at)}>{formatRelative(item.at)}</span>
          <span className="flex items-center gap-1">
            {item.channels.map((channel) => {
              const ChannelIcon = CHANNEL_ICON[channel];
              return (
                <span key={channel} title={channel === 'in_app' ? 'In app' : channel.toUpperCase()}>
                  <ChannelIcon className="size-3" aria-hidden />
                </span>
              );
            })}
          </span>
        </span>
      </span>
    </>
  );

  return (
    <li className={cn('border-b border-ink-100 last:border-b-0', !item.read && 'bg-brand-50/40')}>
      {item.link ? (
        <Link to={item.link} onClick={onRead} className="flex gap-3 px-3 py-3 hover:bg-ink-50/70">
          {body}
        </Link>
      ) : (
        <button type="button" onClick={onRead} className="flex w-full gap-3 px-3 py-3 text-left hover:bg-ink-50/70">
          {body}
        </button>
      )}
    </li>
  );
}

/** The notification centre (TOR §14–16): reminders, alerts and digests. */
export function NotificationsPage() {
  const user = useCurrentUser();
  const notifications = useNotificationsFor(user?.id ?? null);
  const markNotificationRead = useDataStore((state) => state.markNotificationRead);
  const markAllNotificationsRead = useDataStore((state) => state.markAllNotificationsRead);
  const settings = useDataStore((state) => state.settings);

  const [tab, setTab] = useState<'unread' | 'all' | 'hearings' | 'tasks'>('unread');

  const unread = notifications.filter((item) => !item.read);

  const visible = useMemo(() => {
    const sorted = [...notifications].sort((a, b) => b.at.localeCompare(a.at));
    if (tab === 'unread') return sorted.filter((item) => !item.read);
    if (tab === 'hearings')
      return sorted.filter(
        (item) => item.type === 'hearing.reminder' || item.type === 'courtdate.changed',
      );
    if (tab === 'tasks')
      return sorted.filter((item) => item.type === 'task.assigned' || item.type === 'task.overdue');
    return sorted;
  }, [notifications, tab]);

  const offsets = settings.reminderOffsetsHours
    .map((hours) =>
      hours >= 168 ? `${hours / 168} week` : hours >= 24 ? `${hours / 24} days` : `${hours} hours`,
    )
    .join(', ');

  return (
    <div>
      <PageHeader
        title="Notifications"
        hint={`Court reminders are dispatched ${offsets} before a sitting. Digests are sent ${settings.digestFrequency === 'off' ? 'on request only' : settings.digestFrequency}.`}
        meta={
          unread.length > 0 ? (
            <Badge tone="brand" size="sm">
              {unread.length} unread
            </Badge>
          ) : undefined
        }
        actions={
          unread.length > 0 && (
            <Button
              onClick={() => {
                markAllNotificationsRead(user?.id ?? '');
                notify({ variant: 'success', title: 'All notifications marked read' });
              }}
              icon={<CheckCheck className="size-4" aria-hidden />}
            >
              Mark all read
            </Button>
          )
        }
      />

      <Card flush>
        <CardHeader title="Inbox" description={`${visible.length} shown.`} />
        <div className="border-t border-ink-200 px-3">
          <Tabs
            items={[
              { id: 'unread', label: 'Unread', count: unread.length },
              { id: 'all', label: 'Everything', count: notifications.length },
              {
                id: 'hearings',
                label: 'Court sittings',
                count: notifications.filter(
                  (item) => item.type === 'hearing.reminder' || item.type === 'courtdate.changed',
                ).length,
              },
              {
                id: 'tasks',
                label: 'Tasks',
                count: notifications.filter(
                  (item) => item.type === 'task.assigned' || item.type === 'task.overdue',
                ).length,
              },
            ]}
            active={tab}
            idBase="notifications"
            onChange={(id) => setTab(id as typeof tab)}
            label="Notification filters"
          />
        </div>

        <TabPanel idBase="notifications" tab={tab}>
        {visible.length === 0 ? (
          <CardBody className="border-t border-ink-200">
            <EmptyState
              icon={<Inbox className="size-5" aria-hidden />}
              title={tab === 'unread' ? 'Nothing unread' : 'Nothing here yet'}
              description={
                tab === 'unread'
                  ? 'You are up to date. Reminders for upcoming sittings will appear here.'
                  : 'Notifications are raised as matters, sittings and tasks move.'
              }
            />
          </CardBody>
        ) : (
          <ul className="border-t border-ink-200">
            {visible.map((item) => (
              <Row key={item.id} item={item} onRead={() => markNotificationRead(item.id)} />
            ))}
          </ul>
        )}
        </TabPanel>
      </Card>

      <p className="mt-3 text-[11px] text-ink-500">
        Delivery channels are set per user in{' '}
        <Link to="/profile" className="font-medium text-brand-700 underline">
          your profile
        </Link>
        . SMS is {settings.smsEnabled ? 'enabled' : 'disabled'} for this deployment.
      </p>
    </div>
  );
}
