import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { addDays, addMonths, format, isSameDay, startOfDay, startOfWeek } from 'date-fns';
import { CalendarPlus, ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import type { CalendarEntry } from '@/lib/selectors/calendar';
import { buildCalendarEntries, dayKeyOf } from '@/lib/selectors/calendar';
import { useDataStore } from '@/store/dataStore';
import { useCan, useCurrentUser } from '@/store/authStore';
import { notify } from '@/store/uiStore';
import { useVisibleCaseRows } from '@/hooks/useCaseData';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { FilterMenu } from '@/components/ui/FilterMenu';
import { Checkbox, Field, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import type { CaseRow } from '@/lib/selectors/cases';
import { MonthGrid } from './MonthGrid';
import { WeekView } from './WeekView';
import { SittingDetails } from './SittingDetails';
import { HEARING_PURPOSES, ScheduleHearingDialog } from './ScheduleHearingDialog';
import { RecordOutcomeDialog } from './RecordOutcomeDialog';
import { CalendarToolbar, type CalendarViewMode } from './CalendarToolbar';

const VIEWS: CalendarViewMode[] = ['month', 'week', 'day'];

function parseDate(value: string | null) {
  if (!value) return startOfDay(new Date());
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? startOfDay(new Date()) : parsed;
}

/** The court diary (TOR §11–13): month, week and day views over every sitting. */
export function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const view = (VIEWS.find((item) => item === params.get('view')) ?? 'month') as CalendarViewMode;
  const anchor = parseDate(params.get('date'));

  const courtDates = useDataStore((state) => state.courtDates);
  const courts = useDataStore((state) => state.courts);
  const users = useDataStore((state) => state.users);
  const rescheduleCourtDate = useDataStore((state) => state.rescheduleCourtDate);
  const rows = useVisibleCaseRows();
  const user = useCurrentUser();

  const canSchedule = useCan('courtdate.create');
  const canEdit = useCan('courtdate.edit');
  const canRecord = useCan('courtdate.outcome.record');

  const [courtIds, setCourtIds] = useState<string[]>([]);
  const [ownerIds, setOwnerIds] = useState<string[]>([]);
  const [purposes, setPurposes] = useState<string[]>([]);
  const [hideCompleted, setHideCompleted] = useState(false);

  const [selected, setSelected] = useState<CalendarEntry | null>(null);
  const [scheduling, setScheduling] = useState<{ entry?: CalendarEntry; day?: Date } | null>(null);
  const [recording, setRecording] = useState<CalendarEntry | null>(null);

  const entries = useMemo(
    () =>
      buildCalendarEntries(courtDates, rows, users, {
        courtIds,
        ownerIds,
        purposes,
        hideCompleted,
      }),
    [courtDates, rows, users, courtIds, ownerIds, purposes, hideCompleted],
  );

  const owners = useMemo(() => {
    const ids = new Set(rows.map((row) => row.record.matterOwnerId));
    return users.filter((item) => ids.has(item.id));
  }, [rows, users]);

  const step = (direction: -1 | 1) => {
    const next =
      view === 'month'
        ? addMonths(anchor, direction)
        : addDays(anchor, direction * (view === 'week' ? 7 : 1));
    setParams((current) => {
      const draft = new URLSearchParams(current);
      draft.set('date', dayKeyOf(next));
      return draft;
    });
  };

  const setView = (next: CalendarViewMode) => {
    setParams((current) => {
      const draft = new URLSearchParams(current);
      draft.set('view', next);
      return draft;
    });
  };

  const goToday = () => {
    setParams((current) => {
      const draft = new URLSearchParams(current);
      draft.set('date', dayKeyOf(new Date()));
      return draft;
    });
  };

  /** Dropping a sitting on another day keeps its time and only moves the date. */
  const onReschedule = (entry: CalendarEntry, day: Date) => {
    const from = new Date(entry.courtDate.startsAt);
    const to = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      from.getHours(),
      from.getMinutes(),
    );
    rescheduleCourtDate(entry.courtDate.id, to.toISOString(), user?.id ?? 'system');
    notify({
      variant: 'success',
      title: 'Sitting moved',
      description: `${entry.row.record.caseId} now sits on ${format(to, 'EEEE d MMMM')} at ${format(to, 'h:mm a')}.`,
    });
  };

  const label =
    view === 'month'
      ? format(anchor, 'MMMM yyyy')
      : view === 'week'
        ? `${format(startOfWeek(anchor, { weekStartsOn: 1 }), 'd MMM')} – ${format(addDays(startOfWeek(anchor, { weekStartsOn: 1 }), 6), 'd MMM yyyy')}`
        : format(anchor, 'EEEE d MMMM yyyy');

  const inRange = entries.filter((entry) => {
    const day = new Date(entry.courtDate.startsAt);
    if (view === 'month') return day.getMonth() === anchor.getMonth() && day.getFullYear() === anchor.getFullYear();
    if (view === 'day') return isSameDay(day, anchor);
    const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
    return day >= weekStart && day < addDays(weekStart, 7);
  });

  return (
    <div>
      <PageHeader
        title="Court diary"
        description="Drag a sitting to another day to reschedule it."
        hint="Every listed sitting for the matters you can see, across the daily, weekly and monthly views. Rescheduling is written to the audit trail and re-issues the reminders."
        meta={
          <span className="text-[13px] text-ink-600">
            <span className="font-semibold text-ink-800">{inRange.length}</span> sitting
            {inRange.length === 1 ? '' : 's'} in view · {entries.length} in total
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button onClick={() => window.print()} icon={<Printer className="size-4" aria-hidden />}>
              Print
            </Button>
            {canSchedule && (
              <Button
                variant="primary"
                onClick={() => setScheduling({ day: anchor })}
                icon={<CalendarPlus className="size-4" aria-hidden />}
              >
                Schedule a sitting
              </Button>
            )}
          </div>
        }
      />

      <CalendarToolbar
        label={label}
        view={view}
        onView={setView}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        onToday={goToday}
        prevIcon={<ChevronLeft className="size-4" aria-hidden />}
        nextIcon={<ChevronRight className="size-4" aria-hidden />}
        filters={
          <>
            <FilterMenu
              label="Court"
              searchable
              options={courts.map((court) => ({
                value: court.id,
                label: court.name,
                count: entries.filter((entry) => entry.courtDate.courtId === court.id).length,
              }))}
              selected={courtIds}
              onChange={setCourtIds}
              width="w-80"
            />
            <FilterMenu
              label="Matter owner"
              searchable
              options={owners.map((item) => ({ value: item.id, label: item.fullName }))}
              selected={ownerIds}
              onChange={setOwnerIds}
              width="w-72"
            />
            <FilterMenu
              label="Purpose"
              options={HEARING_PURPOSES.map((purpose) => ({ value: purpose, label: purpose }))}
              selected={purposes}
              onChange={setPurposes}
              width="w-72"
            />
            <Checkbox
              checked={hideCompleted}
              onChange={(event) => setHideCompleted(event.target.checked)}
              label="Hide concluded sittings"
            />
          </>
        }
      />

      <div className="mt-3">
        {view === 'month' ? (
          <MonthGrid
            anchor={anchor}
            entries={entries}
            onOpen={setSelected}
            onReschedule={onReschedule}
            onCreate={canSchedule ? (day) => setScheduling({ day }) : undefined}
            canReschedule={canEdit}
          />
        ) : (
          <WeekView
            anchor={anchor}
            days={view === 'week' ? 7 : 1}
            entries={entries}
            onOpen={setSelected}
            onReschedule={onReschedule}
            onCreate={canSchedule ? (day) => setScheduling({ day }) : undefined}
            canReschedule={canEdit}
          />
        )}
      </div>

      <SittingDetails
        entry={selected}
        onClose={() => setSelected(null)}
        onEdit={() => {
          if (selected) setScheduling({ entry: selected });
          setSelected(null);
        }}
        onRecordOutcome={() => {
          setRecording(selected);
          setSelected(null);
        }}
        canEdit={canEdit}
        canRecord={canRecord}
      />

      {scheduling && (scheduling.entry ? (
        <ScheduleHearingDialog
          open
          onClose={() => setScheduling(null)}
          caseRecord={scheduling.entry.row.record}
          courtDate={scheduling.entry.courtDate}
        />
      ) : (
        <ScheduleHearingPicker
          day={scheduling.day ?? anchor}
          onClose={() => setScheduling(null)}
        />
      ))}

      <RecordOutcomeDialog
        open={Boolean(recording)}
        onClose={() => setRecording(null)}
        courtDate={recording?.courtDate ?? null}
        caseRecord={recording?.row.record}
      />
    </div>
  );
}

/**
 * Scheduling from the diary needs a matter first — the dialog itself is
 * matter-scoped, exactly as it is on the case file.
 */
function ScheduleHearingPicker({ day, onClose }: { day: Date; onClose: () => void }) {
  const rows = useVisibleCaseRows();
  const [caseId, setCaseId] = useState<string>('');
  const open = rows.filter((row) => !row.record.archivedAt);
  const chosen = open.find((row) => row.record.id === caseId);

  if (chosen) {
    return (
      <ScheduleHearingDialog
        open
        onClose={onClose}
        caseRecord={chosen.record}
        defaultDate={day}
      />
    );
  }

  return (
    <SelectMatterModal
      day={day}
      rows={open}
      onClose={onClose}
      onPick={setCaseId}
    />
  );
}


function SelectMatterModal({
  day,
  rows,
  onClose,
  onPick,
}: {
  day: Date;
  rows: CaseRow[];
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title="Which matter is sitting?"
      description={`The sitting will be listed for ${format(day, 'EEEE d MMMM yyyy')}.`}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!value} onClick={() => onPick(value)}>
            Continue
          </Button>
        </div>
      }
    >
      <Field label="Matter" required>
        {(props) => (
          <Select value={value} onChange={(event) => setValue(event.target.value)} {...props}>
            <option value="">Select a matter…</option>
            {rows.map((row) => (
              <option key={row.record.id} value={row.record.id}>
                {row.record.caseId} — {row.record.title}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </Modal>
  );
}
