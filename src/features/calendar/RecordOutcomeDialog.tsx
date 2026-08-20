import { useEffect, useState } from 'react';
import { addDays, format } from 'date-fns';
import type { CaseRecord, CourtDate, HearingOutcome, HearingPurpose } from '@/types';
import { formatHearingSlot } from '@/lib/format';
import { useDataStore } from '@/store/dataStore';
import { useCurrentUser } from '@/store/authStore';
import { notify } from '@/store/uiStore';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea, Checkbox } from '@/components/ui/Input';
import { HEARING_PURPOSES } from './ScheduleHearingDialog';

const OUTCOMES: Array<{ value: HearingOutcome; hint: string }> = [
  { value: 'Adjourned', hint: 'Matter did not proceed; a further date was given.' },
  { value: 'Heard', hint: 'The application or matter was heard in full.' },
  { value: 'Part-Heard', hint: 'Hearing began and continues on another day.' },
  { value: 'Judgment Delivered', hint: 'Final judgment was delivered.' },
  { value: 'Judgment Reserved', hint: 'Court reserved judgment to a later date.' },
  { value: 'Ruling Delivered', hint: 'Ruling on an interlocutory application was delivered.' },
  { value: 'Struck Out', hint: 'The suit or application was struck out.' },
  { value: 'Settled', hint: 'Terms of settlement were adopted.' },
  { value: 'Not Sat', hint: 'The court did not sit.' },
];

/** Outcomes that normally carry a further date. */
const ADJOURNING: HearingOutcome[] = ['Adjourned', 'Part-Heard', 'Judgment Reserved', 'Not Sat'];

/** TOR §13 — record what happened in court, and fix the next date in the same breath. */
export function RecordOutcomeDialog({
  open,
  onClose,
  courtDate,
  caseRecord,
}: {
  open: boolean;
  onClose: () => void;
  courtDate: CourtDate | null;
  caseRecord: CaseRecord | undefined;
}) {
  const recordOutcome = useDataStore((state) => state.recordOutcome);
  const createCourtDate = useDataStore((state) => state.createCourtDate);
  const updateCourtDate = useDataStore((state) => state.updateCourtDate);
  const user = useCurrentUser();

  const [outcome, setOutcome] = useState<HearingOutcome>('Adjourned');
  const [notes, setNotes] = useState('');
  const [scheduleNext, setScheduleNext] = useState(true);
  const [nextDate, setNextDate] = useState('');
  const [nextTime, setNextTime] = useState('09:00');
  const [nextPurpose, setNextPurpose] = useState<HearingPurpose>('Hearing');
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!open || !courtDate) return;
    setOutcome(courtDate.outcome ?? 'Adjourned');
    setNotes(courtDate.outcomeNotes ?? '');
    setScheduleNext(true);
    setNextDate(format(addDays(new Date(courtDate.startsAt), 28), 'yyyy-MM-dd'));
    setNextTime('09:00');
    setNextPurpose(courtDate.purpose === 'Mention' ? 'Hearing' : courtDate.purpose);
    setError(undefined);
  }, [open, courtDate]);

  if (!courtDate || !caseRecord) return null;

  const adjourning = ADJOURNING.includes(outcome);
  const chosen = OUTCOMES.find((item) => item.value === outcome);

  const submit = () => {
    if (notes.trim().length < 5) {
      setError('Summarise what the court said — this becomes the record of proceedings.');
      return;
    }
    const actorId = user?.id ?? 'system';
    recordOutcome(courtDate.id, outcome, notes.trim(), actorId);

    if (adjourning && scheduleNext && nextDate) {
      const next = createCourtDate(
        {
          caseId: courtDate.caseId,
          startsAt: new Date(`${nextDate}T${nextTime || '09:00'}:00`).toISOString(),
          durationMinutes: courtDate.durationMinutes,
          courtId: courtDate.courtId,
          courtRoom: courtDate.courtRoom,
          judge: courtDate.judge,
          purpose: nextPurpose,
          notes: `Adjourned from ${format(new Date(courtDate.startsAt), 'dd/MM/yyyy')}.`,
          attendeeIds: courtDate.attendeeIds,
          reminderOffsetsHours: courtDate.reminderOffsetsHours,
        },
        actorId,
      );
      updateCourtDate(courtDate.id, { adjournedToDateId: next.id }, actorId);
      notify({
        variant: 'success',
        title: 'Outcome recorded',
        description: `Adjourned to ${format(new Date(next.startsAt), 'EEE d MMM yyyy')} for ${nextPurpose.toLowerCase()}.`,
      });
    } else {
      notify({
        variant: 'success',
        title: 'Outcome recorded',
        description: `${outcome} · ${caseRecord.caseId}`,
      });
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record hearing outcome"
      description={`${caseRecord.caseId} · ${courtDate.purpose} · ${formatHearingSlot(courtDate.startsAt)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>
            Save outcome
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Outcome" required hint={chosen?.hint}>
          {(props) => (
            <Select
              value={outcome}
              onChange={(event) => setOutcome(event.target.value as HearingOutcome)}
              {...props}
            >
              {OUTCOMES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.value}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Record of proceedings"
          required
          error={error}
          hint="Directions of the court, orders made, next steps for the unit."
        >
          {(props) => (
            <Textarea
              rows={4}
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value);
                setError(undefined);
              }}
              placeholder="e.g. Court granted the applicant leave to amend the statement of claim and awarded ₦50,000 costs against the 2nd defendant."
              {...props}
            />
          )}
        </Field>

        {adjourning && (
          <div className="rounded-xl bg-ink-50 p-3">
            <Checkbox
              checked={scheduleNext}
              onChange={(event) => setScheduleNext(event.target.checked)}
              label="Fix the next date now"
              description="Creates the follow-up sitting and carries the attendees and reminders across."
            />
            {scheduleNext && (
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Field label="Next date" required>
                  {(props) => (
                    <Input
                      type="date"
                      value={nextDate}
                      onChange={(event) => setNextDate(event.target.value)}
                      {...props}
                    />
                  )}
                </Field>
                <Field label="Time">
                  {(props) => (
                    <Input
                      type="time"
                      value={nextTime}
                      onChange={(event) => setNextTime(event.target.value)}
                      {...props}
                    />
                  )}
                </Field>
                <Field label="Purpose">
                  {(props) => (
                    <Select
                      value={nextPurpose}
                      onChange={(event) => setNextPurpose(event.target.value as HearingPurpose)}
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
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
