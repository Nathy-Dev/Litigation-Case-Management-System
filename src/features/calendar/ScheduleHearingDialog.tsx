import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import type { CaseRecord, CourtDate, HearingPurpose } from '@/types';
import { useDataStore } from '@/store/dataStore';
import { useCurrentUser } from '@/store/authStore';
import { notify } from '@/store/uiStore';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea, Checkbox } from '@/components/ui/Input';

export const HEARING_PURPOSES: HearingPurpose[] = [
  'Mention',
  'Hearing',
  'Motion',
  'Adoption of Written Address',
  'Cross-Examination',
  'Pre-Trial Conference',
  'Report of Settlement',
  'Ruling',
  'Judgment',
];

/** TOR §12 — reminders at one week, three days and 24 hours before the sitting. */
const REMINDER_CHOICES: Array<{ hours: number; label: string }> = [
  { hours: 168, label: 'One week before' },
  { hours: 72, label: 'Three days before' },
  { hours: 24, label: '24 hours before' },
];

const DURATIONS = [30, 60, 90, 120, 180, 240];

/** Schedule a new sitting, or edit an existing one (TOR §11). */
export function ScheduleHearingDialog({
  open,
  onClose,
  caseRecord,
  courtDate,
  defaultDate,
}: {
  open: boolean;
  onClose: () => void;
  caseRecord: CaseRecord;
  /** Supplied when editing; omitted when scheduling afresh. */
  courtDate?: CourtDate | null;
  /** Pre-fills the date when the dialog is opened from a calendar cell. */
  defaultDate?: Date;
}) {
  const courts = useDataStore((state) => state.courts);
  const users = useDataStore((state) => state.users);
  const createCourtDate = useDataStore((state) => state.createCourtDate);
  const updateCourtDate = useDataStore((state) => state.updateCourtDate);
  const user = useCurrentUser();

  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [durationMinutes, setDuration] = useState(60);
  const [courtId, setCourtId] = useState(caseRecord.courtId);
  const [courtRoom, setCourtRoom] = useState('Court 1');
  const [judge, setJudge] = useState(caseRecord.presidingJudge ?? '');
  const [purpose, setPurpose] = useState<HearingPurpose>('Mention');
  const [notes, setNotes] = useState('');
  const [attendeeIds, setAttendeeIds] = useState<string[]>([]);
  const [reminders, setReminders] = useState<number[]>([168, 72, 24]);
  const [error, setError] = useState<string | undefined>();

  // Re-seed the form each time the dialog is opened.
  useEffect(() => {
    if (!open) return;
    const seed = courtDate ? new Date(courtDate.startsAt) : (defaultDate ?? new Date());
    setDate(format(seed, 'yyyy-MM-dd'));
    setTime(courtDate ? format(seed, 'HH:mm') : '09:00');
    setDuration(courtDate?.durationMinutes ?? 60);
    setCourtId(courtDate?.courtId ?? caseRecord.courtId);
    setCourtRoom(courtDate?.courtRoom ?? 'Court 1');
    setJudge(courtDate?.judge ?? caseRecord.presidingJudge ?? '');
    setPurpose(courtDate?.purpose ?? 'Mention');
    setNotes(courtDate?.notes ?? '');
    setAttendeeIds(courtDate?.attendeeIds ?? [caseRecord.matterOwnerId]);
    setReminders(courtDate?.reminderOffsetsHours ?? [168, 72, 24]);
    setError(undefined);
  }, [open, courtDate, defaultDate, caseRecord]);

  const team = users.filter(
    (item) =>
      item.id === caseRecord.matterOwnerId ||
      caseRecord.assigneeIds.includes(item.id) ||
      caseRecord.externalCounselIds.includes(item.id),
  );

  const submit = () => {
    if (!date) {
      setError('Choose the sitting date.');
      return;
    }
    const startsAt = new Date(`${date}T${time || '09:00'}:00`).toISOString();
    const actorId = user?.id ?? 'system';

    if (courtDate) {
      updateCourtDate(
        courtDate.id,
        {
          startsAt,
          durationMinutes,
          courtId,
          courtRoom,
          judge,
          purpose,
          notes,
          attendeeIds,
          reminderOffsetsHours: reminders,
        },
        actorId,
      );
      notify({ variant: 'success', title: 'Sitting updated' });
    } else {
      createCourtDate(
        {
          caseId: caseRecord.id,
          startsAt,
          durationMinutes,
          courtId,
          courtRoom,
          judge,
          purpose,
          notes,
          attendeeIds,
          reminderOffsetsHours: reminders,
        },
        actorId,
      );
      notify({
        variant: 'success',
        title: 'Sitting scheduled',
        description: `${purpose} on ${format(new Date(startsAt), 'EEE d MMM yyyy')} · ${reminders.length} reminder${reminders.length === 1 ? '' : 's'} set.`,
      });
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={courtDate ? 'Edit sitting' : 'Schedule a sitting'}
      description={`${caseRecord.caseId} — ${caseRecord.title}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>
            {courtDate ? 'Save changes' : 'Schedule sitting'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Date" required error={error}>
            {(props) => (
              <Input
                type="date"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  setError(undefined);
                }}
                {...props}
              />
            )}
          </Field>
          <Field label="Time" required>
            {(props) => (
              <Input
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                {...props}
              />
            )}
          </Field>
          <Field label="Expected duration">
            {(props) => (
              <Select
                value={String(durationMinutes)}
                onChange={(event) => setDuration(Number(event.target.value))}
                {...props}
              >
                {DURATIONS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes < 60 ? `${minutes} minutes` : `${minutes / 60} hour${minutes === 60 ? '' : 's'}`}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Purpose" required>
            {(props) => (
              <Select
                value={purpose}
                onChange={(event) => setPurpose(event.target.value as HearingPurpose)}
                {...props}
              >
                {HEARING_PURPOSES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Court">
            {(props) => (
              <Select
                value={courtId}
                onChange={(event) => setCourtId(event.target.value)}
                {...props}
              >
                {courts
                  .filter((court) => court.active)
                  .map((court) => (
                    <option key={court.id} value={court.id}>
                      {court.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Court room">
            {(props) => (
              <Input
                value={courtRoom}
                onChange={(event) => setCourtRoom(event.target.value)}
                placeholder="e.g. Court 4"
                {...props}
              />
            )}
          </Field>
          <Field label="Presiding judge">
            {(props) => (
              <Input
                value={judge}
                onChange={(event) => setJudge(event.target.value)}
                placeholder="e.g. Hon. Justice A. B. Nwosu"
                {...props}
              />
            )}
          </Field>
        </div>

        <Field label="Notes for the file" hint="Directions given, documents to file, witnesses expected.">
          {(props) => (
            <Textarea
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              {...props}
            />
          )}
        </Field>

        <fieldset>
          <legend className="text-[12px] font-semibold text-ink-700">Who should attend?</legend>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {team.map((member) => (
              <Checkbox
                key={member.id}
                checked={attendeeIds.includes(member.id)}
                onChange={(event) =>
                  setAttendeeIds((current) =>
                    event.target.checked
                      ? [...current, member.id]
                      : current.filter((id) => id !== member.id),
                  )
                }
                label={member.fullName}
                description={member.firm ?? member.title}
              />
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-[12px] font-semibold text-ink-700">Reminders</legend>
          <p className="text-[12px] text-ink-500">
            Sent by e-mail and in-app to every attendee and the matter owner.
          </p>
          <div className="mt-2 space-y-1.5">
            {REMINDER_CHOICES.map((choice) => (
              <Checkbox
                key={choice.hours}
                checked={reminders.includes(choice.hours)}
                onChange={(event) =>
                  setReminders((current) =>
                    event.target.checked
                      ? [...current, choice.hours].sort((a, b) => b - a)
                      : current.filter((hours) => hours !== choice.hours),
                  )
                }
                label={choice.label}
              />
            ))}
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}
