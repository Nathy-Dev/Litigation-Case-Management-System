import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { CalendarDays, CalendarPlus, Gavel, MapPin, MoreHorizontal, Pencil, Users } from 'lucide-react';
import type { CaseRecord, CourtDate } from '@/types';
import { daysUntil, formatHearingSlot, formatDateTime, shortCourtName } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDataStore } from '@/store/dataStore';
import { useCan } from '@/store/authStore';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, OutcomeBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Dropdown, MenuItem } from '@/components/ui/Dropdown';
import { Avatar } from '@/components/ui/Avatar';
import { ScheduleHearingDialog } from '@/features/calendar/ScheduleHearingDialog';
import { RecordOutcomeDialog } from '@/features/calendar/RecordOutcomeDialog';

/** Court diary for one matter — upcoming sittings first, then the history (TOR §37). */
export function CourtDatesTab({ caseRecord }: { caseRecord: CaseRecord }) {
  const courtDates = useDataStore((state) => state.courtDates);
  const canSchedule = useCan('courtdate.create');
  const canEdit = useCan('courtdate.edit');
  const canRecord = useCan('courtdate.outcome.record');

  const [scheduling, setScheduling] = useState(false);
  const [editing, setEditing] = useState<CourtDate | null>(null);
  const [recording, setRecording] = useState<CourtDate | null>(null);

  const { upcoming, past } = useMemo(() => {
    const mine = courtDates
      .filter((date) => date.caseId === caseRecord.id)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return {
      upcoming: mine.filter((date) => !date.outcome && daysUntil(date.startsAt) >= 0),
      past: mine.filter((date) => date.outcome || daysUntil(date.startsAt) < 0).reverse(),
    };
  }, [courtDates, caseRecord.id]);

  const openEdit = (date: CourtDate) => {
    setEditing(date);
    setScheduling(true);
  };

  return (
    <>
      <div className="space-y-4">
        <Card flush>
          <CardHeader
            title="Upcoming sittings"
            description={
              upcoming.length === 0
                ? 'No date is currently fixed on this matter.'
                : `${upcoming.length} date${upcoming.length === 1 ? '' : 's'} fixed · reminders go out one week, three days and 24 hours before.`
            }
            icon={<CalendarDays className="size-4" aria-hidden />}
            actions={
              canSchedule && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setEditing(null);
                    setScheduling(true);
                  }}
                  icon={<CalendarPlus className="size-4" aria-hidden />}
                >
                  Schedule sitting
                </Button>
              )
            }
            divided
          />
          {upcoming.length === 0 ? (
            <EmptyState
              icon={<CalendarDays className="size-6" aria-hidden />}
              title="No date fixed"
              description="Once the registry gives a date, record it here so reminders reach the team."
              compact
            />
          ) : (
            <ul className="divide-y divide-ink-100">
              {upcoming.map((date) => (
                <HearingRow
                  key={date.id}
                  courtDate={date}
                  onEdit={canEdit ? () => openEdit(date) : undefined}
                  onRecord={canRecord ? () => setRecording(date) : undefined}
                />
              ))}
            </ul>
          )}
        </Card>

        <Card flush>
          <CardHeader
            title="Record of proceedings"
            description={`${past.length} past ${past.length === 1 ? 'sitting' : 'sittings'} with recorded outcomes.`}
            icon={<Gavel className="size-4" aria-hidden />}
            divided
          />
          {past.length === 0 ? (
            <EmptyState
              icon={<Gavel className="size-6" aria-hidden />}
              title="Nothing has been heard yet"
              description="Outcomes recorded after each sitting build the history of the matter."
              compact
            />
          ) : (
            <ul className="divide-y divide-ink-100">
              {past.map((date) => (
                <HearingRow
                  key={date.id}
                  courtDate={date}
                  past
                  onRecord={canRecord ? () => setRecording(date) : undefined}
                />
              ))}
            </ul>
          )}
        </Card>
      </div>

      <ScheduleHearingDialog
        open={scheduling}
        onClose={() => {
          setScheduling(false);
          setEditing(null);
        }}
        caseRecord={caseRecord}
        courtDate={editing}
      />
      <RecordOutcomeDialog
        open={Boolean(recording)}
        onClose={() => setRecording(null)}
        courtDate={recording}
        caseRecord={caseRecord}
      />
    </>
  );
}

function HearingRow({
  courtDate,
  past = false,
  onEdit,
  onRecord,
}: {
  courtDate: CourtDate;
  past?: boolean;
  onEdit?: () => void;
  onRecord?: () => void;
}) {
  const courts = useDataStore((state) => state.courts);
  const users = useDataStore((state) => state.users);
  const court = courts.find((item) => item.id === courtDate.courtId);
  const sittingDate = new Date(courtDate.startsAt);
  const days = daysUntil(courtDate.startsAt);
  const attendees = users.filter((user) => courtDate.attendeeIds.includes(user.id));
  const recordedBy = users.find((user) => user.id === courtDate.outcomeRecordedById);

  return (
    <li className="flex items-start gap-3 px-4 py-3.5">
      <div
        className={cn(
          'grid w-14 shrink-0 place-items-center rounded-lg py-1.5 text-center',
          past
            ? 'bg-ink-100 text-ink-600'
            : days <= 3
              ? 'bg-danger-50 text-danger-700'
              : days <= 7
                ? 'bg-gold-50 text-gold-800'
                : 'bg-brand-50 text-brand-800',
        )}
      >
        <span className="text-[10px] font-semibold tracking-wide uppercase">
          {format(sittingDate, 'EEE')}
        </span>
        <span className="tnum text-lg leading-none font-semibold">{format(sittingDate, 'd')}</span>
        <span className="text-[10px] uppercase">{format(sittingDate, 'MMM')}</span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-[13px] font-medium text-ink-900">{courtDate.purpose}</p>
          {courtDate.outcome && <OutcomeBadge outcome={courtDate.outcome} size="sm" />}
          {!past && days >= 0 && days <= 7 && (
            <Badge tone={days <= 3 ? 'danger' : 'gold'} size="sm">
              {days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`}
            </Badge>
          )}
        </div>

        <p className="mt-0.5 text-[12px] text-ink-600">
          {formatHearingSlot(courtDate.startsAt, courtDate.durationMinutes)}
        </p>

        <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-ink-500">
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3" aria-hidden />
            {shortCourtName(court?.name)} · {courtDate.courtRoom}
          </span>
          {courtDate.judge && (
            <>
              <span aria-hidden>·</span>
              <span>{courtDate.judge}</span>
            </>
          )}
        </p>

        {courtDate.notes && (
          <p className="mt-1.5 text-[12px] leading-snug text-ink-600">{courtDate.notes}</p>
        )}

        {courtDate.outcome && courtDate.outcomeNotes && (
          <div className="mt-2 rounded-lg bg-ink-50 px-3 py-2">
            <p className="text-[12px] leading-snug text-ink-700">{courtDate.outcomeNotes}</p>
            {recordedBy && (
              <p className="mt-1 text-[11px] text-ink-400">
                Recorded by {recordedBy.fullName} · {formatDateTime(courtDate.outcomeRecordedAt)}
              </p>
            )}
          </div>
        )}

        {attendees.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5">
            <Users className="size-3 text-ink-400" aria-hidden />
            <div className="flex -space-x-1.5">
              {attendees.slice(0, 5).map((user) => (
                <Avatar key={user.id} user={user} size="xs" className="ring-2 ring-white" />
              ))}
            </div>
            {attendees.length > 5 && (
              <span className="text-[11px] text-ink-500">+{attendees.length - 5}</span>
            )}
          </div>
        )}
      </div>

      {(onEdit || onRecord) && (
        <Dropdown
          trigger={({ toggle }) => (
            <Button
              size="sm"
              variant="ghost"
              onClick={toggle}
              aria-label="Sitting actions"
              icon={<MoreHorizontal className="size-4" aria-hidden />}
            />
          )}
        >
          {(close) => (
            <>
              {onRecord && (
                <MenuItem
                  icon={<Gavel className="size-4" aria-hidden />}
                  onClick={() => {
                    onRecord();
                    close();
                  }}
                >
                  {courtDate.outcome ? 'Amend outcome' : 'Record outcome'}
                </MenuItem>
              )}
              {onEdit && (
                <MenuItem
                  icon={<Pencil className="size-4" aria-hidden />}
                  onClick={() => {
                    onEdit();
                    close();
                  }}
                >
                  Edit sitting
                </MenuItem>
              )}
            </>
          )}
        </Dropdown>
      )}
    </li>
  );
}
