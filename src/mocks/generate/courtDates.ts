import type { CaseRecord, CourtDate, HearingOutcome, HearingPurpose } from '@/types';
import { pick } from '@/lib/utils';
import {
  COURT_ROOMS,
  SITTING_TIMES,
  addDays,
  at,
  atTime,
  chance,
  daysBetween,
  intBetween,
  rngFor,
} from './helpers';

/** Statuses where the matter is still moving through the court. */
const LIVE_STATUSES = new Set(['Filed', 'Pending', 'Adjourned', 'Heard']);

/**
 * Offsets (days from today) for the *next* hearing of each live matter.
 * Curated rather than random so the dashboard, calendar and reminder digests
 * always have something to show: a sitting today, two this week, then a
 * realistic thinning-out across the term.
 */
const NEXT_HEARING_OFFSETS = [
  0, 1, 2, 3, 4, 6, 7, 8, 10, 12, 14, 17, 20, 23, 27, 31, 36, 42, 49, 57, 64, 72,
];

/** The final past-hearing outcome must corroborate the matter's status. */
const CLOSING_OUTCOME: Record<string, HearingOutcome> = {
  Filed: 'Adjourned',
  Pending: 'Adjourned',
  Adjourned: 'Adjourned',
  Heard: 'Judgment Reserved',
  'Judgment Delivered': 'Judgment Delivered',
  Concluded: 'Settled',
  Closed: 'Settled',
  Archived: 'Judgment Delivered',
};

const MID_OUTCOMES: HearingOutcome[] = [
  'Adjourned',
  'Adjourned',
  'Adjourned',
  'Part-Heard',
  'Not Sat',
  'Ruling Delivered',
];

const MID_PURPOSES: HearingPurpose[] = [
  'Mention',
  'Motion',
  'Hearing',
  'Hearing',
  'Cross-Examination',
  'Pre-Trial Conference',
];

const ADJOURNMENT_REASONS = [
  'Adjourned at the instance of the defence for want of service on the 2nd defendant.',
  'Court did not sit — the Honourable Judge was on official assignment.',
  'Adjourned for continuation of cross-examination of PW1.',
  'Adjourned on the application of counsel to enable parties explore settlement.',
  'Matter stood down and later adjourned; the record of proceedings was unavailable.',
  'Adjourned for hearing of the pending motion on notice.',
  'Adjourned sine die at the instance of both parties pending the report of settlement.',
  'Adjourned for adoption of final written addresses.',
];

const OUTCOME_NOTES: Partial<Record<HearingOutcome, string>> = {
  'Judgment Reserved':
    'Final written addresses adopted by both counsel. Judgment reserved; parties to be put on notice.',
  'Judgment Delivered':
    'Judgment delivered. The court granted the reliefs sought in part and awarded costs.',
  'Ruling Delivered': 'Ruling delivered on the preliminary objection, which was dismissed.',
  'Part-Heard': 'PW1 led in evidence and partly cross-examined. Matter part-heard.',
  Settled: 'Terms of settlement filed and adopted as the consent judgment of the court.',
  Heard: 'Hearing concluded on the substantive claim.',
  'Struck Out': 'Matter struck out for want of diligent prosecution.',
  'Not Sat': 'Court did not sit. Fresh hearing notices to issue.',
};

const NEXT_PURPOSES: Record<string, HearingPurpose> = {
  Filed: 'Mention',
  Pending: 'Hearing',
  Adjourned: 'Hearing',
  Heard: 'Judgment',
};

export function buildCourtDates(now: Date, cases: CaseRecord[]): CourtDate[] {
  const dates: CourtDate[] = [];
  let liveIndex = 0;

  cases.forEach((record, caseIndex) => {
    const rng = rngFor('courtdate', caseIndex);
    const judge = record.presidingJudge ?? 'Panel not yet constituted';
    const room = pick(rng, COURT_ROOMS);
    const attendees = [...record.assigneeIds, ...record.externalCounselIds];
    const isLive = LIVE_STATUSES.has(record.status);

    // ---- Past sittings -----------------------------------------------------
    const created: CourtDate[] = [];
    if (record.filingDate) {
      const firstSitting = daysBetween(record.filingDate, now) - 20;
      if (firstSitting > 25) {
        const span = firstSitting - 25;
        const count = Math.min(8, Math.max(1, Math.round(span / 55) + 1));
        const step = count > 1 ? span / (count - 1) : 0;

        for (let k = 0; k < count; k += 1) {
          const daysAfterFiling = 25 + Math.round(step * k);
          const isFinal = k === count - 1;
          const [hour, minute] = pick(rng, SITTING_TIMES);
          const startsAt = atTime(addDays(record.filingDate, daysAfterFiling), hour, minute);

          const outcome: HearingOutcome = isFinal
            ? (CLOSING_OUTCOME[record.status] ?? 'Adjourned')
            : pick(rng, MID_OUTCOMES);

          const purpose: HearingPurpose = isFinal
            ? outcome === 'Judgment Delivered'
              ? 'Judgment'
              : outcome === 'Judgment Reserved'
                ? 'Adoption of Written Address'
                : outcome === 'Settled'
                  ? 'Report of Settlement'
                  : 'Hearing'
            : k === 0
              ? 'Mention'
              : pick(rng, MID_PURPOSES);

          created.push({
            id: `cd_${record.id.slice(5)}_p${k + 1}`,
            caseId: record.id,
            startsAt,
            durationMinutes: pick(rng, [30, 45, 60, 60, 90]),
            courtId: record.courtId,
            courtRoom: room,
            judge,
            purpose,
            notes: `Cause list serial ${intBetween(rng, 2, 28)}. Hearing notice served on all parties.`,
            attendeeIds: attendees,
            reminderOffsetsHours: [168, 72, 24],
            outcome,
            outcomeNotes:
              OUTCOME_NOTES[outcome] ??
              ADJOURNMENT_REASONS[(caseIndex + k) % ADJOURNMENT_REASONS.length]!,
            outcomeRecordedById: record.assigneeIds[0] ?? record.matterOwnerId,
            outcomeRecordedAt: atTime(addDays(startsAt, 0), 16, 30),
            adjournedToDateId: null,
            createdById: record.matterOwnerId,
            createdAt: addDays(startsAt, -21),
          });
        }
      }
    }

    // ---- Upcoming sittings -------------------------------------------------
    if (isLive) {
      const offset =
        NEXT_HEARING_OFFSETS[liveIndex % NEXT_HEARING_OFFSETS.length]! +
        (liveIndex >= NEXT_HEARING_OFFSETS.length ? 78 : 0);
      liveIndex += 1;

      const [hour, minute] = pick(rng, SITTING_TIMES);
      const next: CourtDate = {
        id: `cd_${record.id.slice(5)}_n1`,
        caseId: record.id,
        startsAt: at(now, offset, hour, minute),
        durationMinutes: pick(rng, [30, 45, 60, 90]),
        courtId: record.courtId,
        courtRoom: room,
        judge,
        purpose: NEXT_PURPOSES[record.status] ?? 'Mention',
        notes:
          record.priority === 'Critical'
            ? 'Counsel to attend with the full case file. Director briefed.'
            : 'Hearing notice issued and served.',
        attendeeIds: attendees,
        reminderOffsetsHours: record.priority === 'Critical' ? [168, 72, 24, 4] : [168, 72, 24],
        outcome: null,
        outcomeNotes: '',
        outcomeRecordedById: null,
        outcomeRecordedAt: null,
        adjournedToDateId: null,
        createdById: record.matterOwnerId,
        createdAt: at(now, -Math.max(2, offset), 11, 15),
      };
      created.push(next);

      // A second, further sitting already fixed for roughly 4 in 10 matters.
      if (chance(rng, 0.4)) {
        const [h2, m2] = pick(rng, SITTING_TIMES);
        created.push({
          ...next,
          id: `cd_${record.id.slice(5)}_n2`,
          startsAt: at(now, offset + intBetween(rng, 34, 62), h2, m2),
          purpose: record.status === 'Heard' ? 'Judgment' : 'Hearing',
          notes: 'Further date taken in open court.',
          reminderOffsetsHours: [168, 72, 24],
          createdAt: next.createdAt,
        });
      }
    }

    // Chain adjournments so "adjourned to" resolves to the following sitting.
    created.forEach((sitting, index) => {
      if (sitting.outcome === 'Adjourned' && created[index + 1]) {
        sitting.adjournedToDateId = created[index + 1]!.id;
      }
    });

    dates.push(...created);
  });

  return dates.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
