import type {
  AppNotification,
  CaseRecord,
  CourtDate,
  NotificationChannel,
  Task,
  User,
} from '@/types';
import { daysUntil, formatDateMedium, formatHearingSlot } from '@/lib/format';
import { hoursBefore, minutesBefore, rngFor } from './helpers';

interface Sources {
  now: Date;
  users: User[];
  cases: CaseRecord[];
  courtDates: CourtDate[];
  tasks: Task[];
}

const IN_APP_EMAIL: NotificationChannel[] = ['in_app', 'email'];
const ALL_CHANNELS: NotificationChannel[] = ['in_app', 'email', 'sms'];

/**
 * Builds the notification feed (TOR §14). Reminders are derived from the actual
 * upcoming diary so the bell badge, the calendar and the dashboard always agree.
 */
export function buildNotifications({
  now,
  users,
  cases,
  courtDates,
  tasks,
}: Sources): AppNotification[] {
  const notifications: AppNotification[] = [];
  const caseById = new Map(cases.map((record) => [record.id, record]));
  const activeUsers = users.filter((user) => user.status === 'active');

  // ---- Hearing reminders --------------------------------------------------
  const upcoming = courtDates
    .filter((sitting) => !sitting.outcome && daysUntil(sitting.startsAt) >= 0)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  upcoming.slice(0, 22).forEach((sitting, index) => {
    const record = caseById.get(sitting.caseId);
    if (!record) return;
    const days = daysUntil(sitting.startsAt);
    const window = days === 0 ? '24 hours' : days <= 3 ? '3 days' : '1 week';

    sitting.attendeeIds.forEach((userId, attendeeIndex) => {
      notifications.push({
        id: `ntf_hearing_${sitting.id}_${userId}`,
        userId,
        type: 'hearing.reminder',
        title:
          days === 0
            ? `Court today — ${record.suitNumber ?? record.caseId}`
            : `Hearing in ${days} day${days === 1 ? '' : 's'} — ${record.suitNumber ?? record.caseId}`,
        body: `${sitting.purpose} before ${sitting.judge}, ${sitting.courtRoom}. ${formatHearingSlot(sitting.startsAt)}. Reminder sent at the ${window} mark.`,
        caseId: record.id,
        link: `/cases/${record.id}?tab=court-dates`,
        channels: record.priority === 'Critical' ? ALL_CHANNELS : IN_APP_EMAIL,
        priority: days <= 1 || record.priority === 'Critical' ? 'high' : 'normal',
        read: index > 3 || attendeeIndex > 1,
        at: hoursBefore(now, index * 3 + attendeeIndex + 1),
      });
    });
  });

  // ---- Task assignment & overdue alerts -----------------------------------
  tasks.slice(0, 60).forEach((task, index) => {
    const record = task.caseId ? caseById.get(task.caseId) : null;
    const overdue = task.status !== 'Completed' && daysUntil(task.dueDate) < 0;

    notifications.push({
      id: `ntf_task_${task.id}`,
      userId: task.ownerId,
      type: overdue ? 'task.overdue' : 'task.assigned',
      title: overdue ? `Overdue: ${task.title}` : `Task assigned: ${task.title}`,
      body: overdue
        ? `This task was due on ${formatDateMedium(task.dueDate)}${record ? ` on ${record.caseId}` : ''}. Please update its status.`
        : `Due ${formatDateMedium(task.dueDate)} · ${task.priority} priority${record ? ` · ${record.title}` : ''}.`,
      caseId: task.caseId,
      link: task.caseId ? `/cases/${task.caseId}?tab=tasks` : '/tasks',
      channels: IN_APP_EMAIL,
      priority: overdue || task.priority === 'Critical' ? 'high' : 'normal',
      read: index > 6,
      at: overdue ? hoursBefore(now, 6 + index) : hoursBefore(now, 10 + index * 4),
    });
  });

  // ---- Matter events: assignment, uploads, status changes -----------------
  cases.slice(0, 24).forEach((record, index) => {
    const rng = rngFor('notification', index);
    const recipient = record.assigneeIds[index % record.assigneeIds.length] ?? record.matterOwnerId;

    notifications.push({
      id: `ntf_assigned_${record.id}`,
      userId: recipient,
      type: 'case.assigned',
      title: `You were assigned to ${record.caseId}`,
      body: `${record.title} — ${record.priority} priority, owned by the ${record.status === 'Draft' ? 'drafting' : 'litigation'} desk.`,
      caseId: record.id,
      link: `/cases/${record.id}`,
      channels: IN_APP_EMAIL,
      priority: record.priority === 'Critical' ? 'high' : 'normal',
      read: index > 2,
      at: hoursBefore(now, 24 + index * 7),
    });

    if (rng() > 0.5) {
      notifications.push({
        id: `ntf_status_${record.id}`,
        userId: record.matterOwnerId,
        type: 'status.changed',
        title: `${record.caseId} is now ${record.status}`,
        body: `The status of ${record.title} was updated. See the matter timeline for the reason recorded.`,
        caseId: record.id,
        link: `/cases/${record.id}?tab=timeline`,
        channels: ['in_app'],
        priority: 'normal',
        read: index > 1,
        at: hoursBefore(now, 30 + index * 9),
      });
    }

    if (rng() > 0.55) {
      notifications.push({
        id: `ntf_doc_${record.id}`,
        userId: record.assigneeIds[0] ?? record.matterOwnerId,
        type: 'document.uploaded',
        title: `New document on ${record.caseId}`,
        body: 'A court process was uploaded to the matter file and is awaiting your review.',
        caseId: record.id,
        link: `/cases/${record.id}?tab=documents`,
        channels: ['in_app'],
        priority: 'normal',
        read: index > 4,
        at: hoursBefore(now, 14 + index * 5),
      });
    }
  });

  // ---- Daily digest & system notices --------------------------------------
  activeUsers.forEach((user, index) => {
    const hearingsToday = upcoming.filter(
      (sitting) => daysUntil(sitting.startsAt) <= 7 && sitting.attendeeIds.includes(user.id),
    ).length;

    notifications.push({
      id: `ntf_digest_${user.id}`,
      userId: user.id,
      type: 'digest',
      title: 'Your daily digest',
      body: `${hearingsToday} hearing${hearingsToday === 1 ? '' : 's'} in the next 7 days · ${
        tasks.filter((task) => task.ownerId === user.id && task.status !== 'Completed').length
      } open tasks. Delivered at 06:30 WAT.`,
      caseId: null,
      link: '/',
      channels: ['email'],
      priority: 'normal',
      read: index % 3 !== 0,
      at: minutesBefore(now, 180 + index),
    });
  });

  notifications.push(
    {
      id: 'ntf_sys_backup',
      userId: 'usr_okonkwo',
      type: 'system',
      title: 'Nightly backup completed',
      body: 'Database and document store backed up successfully. Retention: 30 days, geo-separate location.',
      caseId: null,
      link: '/admin/system',
      channels: ['in_app'],
      priority: 'normal',
      read: false,
      at: hoursBefore(now, 8),
    },
    {
      id: 'ntf_sys_storage',
      userId: 'usr_okonkwo',
      type: 'system',
      title: 'Storage at 68% of quota',
      body: 'The document store is approaching the configured quota. Review the retention policy or request additional capacity.',
      caseId: null,
      link: '/admin/system',
      channels: IN_APP_EMAIL,
      priority: 'high',
      read: false,
      at: hoursBefore(now, 20),
    },
    {
      id: 'ntf_sys_lockout',
      userId: 'usr_adeyemi',
      type: 'system',
      title: 'Account locked after failed sign-in attempts',
      body: 'The account of Amara Nwachukwu was locked after 5 failed attempts and requires administrative unlock.',
      caseId: null,
      link: '/admin/users',
      channels: IN_APP_EMAIL,
      priority: 'high',
      read: false,
      at: hoursBefore(now, 4),
    },
  );

  return notifications.sort((a, b) => b.at.localeCompare(a.at));
}
