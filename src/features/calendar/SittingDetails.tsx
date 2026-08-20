import type { ReactNode } from 'react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import {
  CalendarClock,
  Clock,
  Gavel,
  Landmark,
  MapPin,
  PencilLine,
  ScrollText,
  Users,
} from 'lucide-react';
import type { CalendarEntry } from '@/lib/selectors/calendar';
import { formatDateLong, formatRelative } from '@/lib/format';
import { Drawer } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge, PriorityBadge, StatusBadge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';

function Line({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 text-ink-400" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">{label}</p>
        <p className="text-[13px] text-ink-800">{children}</p>
      </div>
    </div>
  );
}

/** Read-only summary of a sitting, opened from any calendar view. */
export function SittingDetails({
  entry,
  onClose,
  onEdit,
  onRecordOutcome,
  canEdit,
  canRecord,
}: {
  entry: CalendarEntry | null;
  onClose: () => void;
  onEdit: () => void;
  onRecordOutcome: () => void;
  canEdit: boolean;
  canRecord: boolean;
}) {
  const sitting = entry?.courtDate;
  const startsAt = sitting ? new Date(sitting.startsAt) : null;

  return (
    <Drawer
      open={Boolean(entry)}
      onClose={onClose}
      title={sitting ? sitting.purpose : 'Sitting'}
      description={
        startsAt
          ? `${formatDateLong(startsAt)} · ${format(startsAt, 'h:mm a')} (${formatRelative(startsAt)})`
          : undefined
      }
      footer={
        entry ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canEdit && !sitting?.outcome && (
              <Button onClick={onEdit} icon={<PencilLine className="size-4" aria-hidden />}>
                Edit sitting
              </Button>
            )}
            {canRecord && (
              <Button
                variant="primary"
                onClick={onRecordOutcome}
                icon={<ScrollText className="size-4" aria-hidden />}
              >
                {sitting?.outcome ? 'Amend outcome' : 'Record outcome'}
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      {entry && sitting && (
        <div className="space-y-5">
          <div className="rounded-xl border border-ink-200 bg-ink-50/70 p-3">
            <Link
              to={`/cases/${entry.row.record.id}`}
              className="text-[13px] font-semibold text-brand-700 underline-offset-2 hover:underline"
            >
              {entry.row.record.caseId}
            </Link>
            <p className="mt-0.5 text-sm font-medium text-ink-900">{entry.row.record.title}</p>
            <p className="mt-1 text-[12px] text-ink-600">{entry.row.partiesLabel}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StatusBadge status={entry.row.record.status} size="sm" />
              <PriorityBadge priority={entry.row.record.priority} size="sm" />
              {entry.row.record.suitNumber && (
                <Badge tone="neutral" size="sm">
                  {entry.row.record.suitNumber}
                </Badge>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Line icon={<Landmark className="size-4" aria-hidden />} label="Court">
              {entry.courtName}
            </Line>
            <Line icon={<MapPin className="size-4" aria-hidden />} label="Court room">
              {sitting.courtRoom}
            </Line>
            <Line icon={<Gavel className="size-4" aria-hidden />} label="Presiding">
              {sitting.judge}
            </Line>
            <Line icon={<Clock className="size-4" aria-hidden />} label="Listed for">
              {sitting.durationMinutes} minutes
            </Line>
          </div>

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
              <Users className="size-3.5" aria-hidden />
              Appearing ({entry.attendees.length})
            </p>
            {entry.attendees.length === 0 ? (
              <p className="text-[13px] text-ink-500">No one has been listed to appear yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {entry.attendees.map((person) => (
                  <li key={person.id} className="flex items-center gap-2">
                    <Avatar user={person} size="sm" />
                    <span className="text-[13px] text-ink-800">{person.fullName}</span>
                    <span className="text-[12px] text-ink-500">{person.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
              <CalendarClock className="size-3.5" aria-hidden />
              Reminders
            </p>
            <div className="flex flex-wrap gap-1.5">
              {sitting.reminderOffsetsHours.length === 0 ? (
                <span className="text-[13px] text-ink-500">None set.</span>
              ) : (
                [...sitting.reminderOffsetsHours]
                  .sort((a, b) => b - a)
                  .map((hours) => (
                    <Badge key={hours} tone="info" size="sm">
                      {hours >= 168 ? `${hours / 168} week` : hours >= 24 ? `${hours / 24} days` : `${hours} hours`}{' '}
                      before
                    </Badge>
                  ))
              )}
            </div>
          </div>

          {sitting.notes && (
            <div>
              <p className="mb-1 text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
                Notes
              </p>
              <p className="text-[13px] whitespace-pre-line text-ink-700">{sitting.notes}</p>
            </div>
          )}

          {sitting.outcome && (
            <div className="rounded-xl border border-brand-200 bg-brand-50/70 p-3">
              <div className="flex items-center gap-2">
                <Badge tone="brand" size="sm">
                  {sitting.outcome}
                </Badge>
                {sitting.outcomeRecordedAt && (
                  <span className="text-[11px] text-ink-500">
                    recorded {formatRelative(sitting.outcomeRecordedAt)}
                  </span>
                )}
              </div>
              {sitting.outcomeNotes && (
                <p className="mt-2 text-[13px] whitespace-pre-line text-ink-700">
                  {sitting.outcomeNotes}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
