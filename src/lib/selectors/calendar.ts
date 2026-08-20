import type { CourtDate, User } from '@/types';
import type { CaseRow } from './cases';

/** One sitting, resolved against the matter the viewer is allowed to see. */
export interface CalendarEntry {
  courtDate: CourtDate;
  row: CaseRow;
  courtName: string;
  attendees: User[];
  /** Local ISO day key, e.g. "2026-08-20". */
  dayKey: string;
  minutesFromMidnight: number;
}

export function dayKeyOf(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value;
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export interface CalendarFilters {
  courtIds?: string[];
  ownerIds?: string[];
  purposes?: string[];
  /** Hide sittings whose outcome has already been recorded. */
  hideCompleted?: boolean;
}

/**
 * Court diary entries for the matters the viewer can see. Built from the same
 * `CaseRow` list as the register, so the calendar can never show a matter the
 * register hides.
 */
export function buildCalendarEntries(
  courtDates: CourtDate[],
  rows: CaseRow[],
  users: User[],
  filters: CalendarFilters = {},
): CalendarEntry[] {
  const rowsById = new Map(rows.map((row) => [row.record.id, row]));
  const usersById = new Map(users.map((user) => [user.id, user]));

  return courtDates
    .flatMap((courtDate) => {
      const row = rowsById.get(courtDate.caseId);
      if (!row) return [];
      if (filters.hideCompleted && courtDate.outcome) return [];
      if (filters.courtIds?.length && !filters.courtIds.includes(courtDate.courtId)) return [];
      if (filters.ownerIds?.length && !filters.ownerIds.includes(row.record.matterOwnerId)) return [];
      if (filters.purposes?.length && !filters.purposes.includes(courtDate.purpose)) return [];

      const startsAt = new Date(courtDate.startsAt);
      return [
        {
          courtDate,
          row,
          courtName: row.courtName,
          attendees: courtDate.attendeeIds
            .map((id) => usersById.get(id))
            .filter((user): user is User => Boolean(user)),
          dayKey: dayKeyOf(startsAt),
          minutesFromMidnight: startsAt.getHours() * 60 + startsAt.getMinutes(),
        },
      ];
    })
    .sort((a, b) => a.courtDate.startsAt.localeCompare(b.courtDate.startsAt));
}

/** Group entries by day so each view can look up a cell in one step. */
export function groupByDay(entries: CalendarEntry[]): Map<string, CalendarEntry[]> {
  const map = new Map<string, CalendarEntry[]>();
  entries.forEach((entry) => {
    const bucket = map.get(entry.dayKey);
    if (bucket) bucket.push(entry);
    else map.set(entry.dayKey, [entry]);
  });
  return map;
}
