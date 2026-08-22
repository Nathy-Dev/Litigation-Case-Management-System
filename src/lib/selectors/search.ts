import type { CaseNote, CaseRecord, CaseStatusChange, CourtDate, Task, TimelineEvent } from '@/types';
import type { Dataset } from '@/mocks/generate';
import { buildTimeline } from '@/mocks/generate/timeline';
import { matchesQuery, truncate } from '@/lib/utils';
import type { TaskAccess } from './cases';

/** Per-case timeline, derived on demand from that matter's own records only. */
export function selectCaseTimeline(data: Dataset, caseId: string): TimelineEvent[] {
  const record = data.cases.find((item) => item.id === caseId);
  if (!record) return [];

  const only = <T extends { caseId: string }>(rows: T[]) => rows.filter((row) => row.caseId === caseId);

  return buildTimeline({
    cases: [record] as CaseRecord[],
    statusChanges: only(data.statusChanges) as CaseStatusChange[],
    documents: only(data.documents),
    courtDates: only(data.courtDates) as CourtDate[],
    tasks: data.tasks.filter((task) => task.caseId === caseId) as Task[],
    notes: only(data.notes) as CaseNote[],
  });
}

/** Recent activity across every matter the user can see — dashboard feed. */
export function selectRecentActivity(
  data: Dataset,
  visibleCaseIds: Set<string>,
  limit = 12,
): TimelineEvent[] {
  const inScope = <T extends { caseId: string }>(rows: T[]) =>
    rows.filter((row) => visibleCaseIds.has(row.caseId));

  return buildTimeline({
    cases: data.cases.filter((record) => visibleCaseIds.has(record.id)),
    statusChanges: inScope(data.statusChanges),
    // Only the most recent slice matters here; trimming keeps the pass cheap.
    documents: inScope(data.documents).slice(0, 80),
    courtDates: inScope(data.courtDates).slice(-80),
    tasks: data.tasks.filter((task) => task.caseId && visibleCaseIds.has(task.caseId)).slice(0, 80),
    notes: inScope(data.notes).slice(0, 60),
  }).slice(0, limit);
}

export type SearchGroup = 'Matters' | 'Documents' | 'Court dates' | 'Tasks' | 'Notes' | 'People';

export interface SearchHit {
  group: SearchGroup;
  id: string;
  title: string;
  subtitle: string;
  snippet: string;
  link: string;
  /** True when the match came from OCR-extracted text (TOR §8). */
  viaOcr?: boolean;
}

/**
 * Global search (TOR §16). Covers matter metadata, document names *and* the
 * OCR-extracted contents, court diary entries, tasks, notes and people.
 */
/**
 * Two groups in the results are not governed by matter access, so they are
 * governed explicitly: the Unit's own unbound tasks, and the staff directory.
 * Without this a stakeholder could search their way to a person and follow the
 * hit to an admin screen they are not allowed to open.
 */
export interface SearchAccess extends TaskAccess {
  /** The staff directory. Pass `user.view`. */
  canSeePeople: boolean;
}

export function globalSearch(
  data: Dataset,
  query: string,
  visibleCaseIds: Set<string>,
  access: SearchAccess,
  limitPerGroup = 6,
): SearchHit[] {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const hits: SearchHit[] = [];
  const courtById = new Map(data.courts.map((court) => [court.id, court]));
  const caseById = new Map(data.cases.map((record) => [record.id, record]));

  const cases = data.cases.filter(
    (record) =>
      visibleCaseIds.has(record.id) &&
      matchesQuery(
        [
          record.caseId,
          record.caseReference ?? '',
          record.title,
          record.suitNumber ?? '',
          record.summary,
          record.reliefSought,
          record.presidingJudge ?? '',
          record.tags.join(' '),
          record.parties.map((party) => party.name).join(' '),
        ].join(' '),
        trimmed,
      ),
  );

  cases.slice(0, limitPerGroup).forEach((record) =>
    hits.push({
      group: 'Matters',
      id: record.id,
      title: `${record.caseId} — ${record.title}`,
      subtitle: `${record.status} · ${courtById.get(record.courtId)?.name ?? '—'}`,
      snippet: truncate(record.summary, 160),
      link: `/cases/${record.id}`,
    }),
  );

  data.documents
    .filter((document) => visibleCaseIds.has(document.caseId))
    .filter(
      (document) =>
        matchesQuery(`${document.name} ${document.description}`, trimmed) ||
        (document.ocrText ? matchesQuery(document.ocrText, trimmed) : false),
    )
    .slice(0, limitPerGroup)
    .forEach((document) => {
      const viaOcr =
        !matchesQuery(`${document.name} ${document.description}`, trimmed) && Boolean(document.ocrText);
      hits.push({
        group: 'Documents',
        id: document.id,
        title: document.name,
        subtitle: `${caseById.get(document.caseId)?.caseId ?? '—'} · v${document.currentVersion}${
          document.confidential ? ' · Confidential' : ''
        }`,
        snippet: truncate(viaOcr ? (document.ocrText ?? '') : document.description, 160),
        link: `/cases/${document.caseId}?tab=documents&doc=${document.id}`,
        viaOcr,
      });
    });

  data.courtDates
    .filter((sitting) => visibleCaseIds.has(sitting.caseId))
    .filter((sitting) =>
      matchesQuery(`${sitting.purpose} ${sitting.judge} ${sitting.courtRoom} ${sitting.notes}`, trimmed),
    )
    .slice(0, limitPerGroup)
    .forEach((sitting) =>
      hits.push({
        group: 'Court dates',
        id: sitting.id,
        title: `${sitting.purpose} — ${caseById.get(sitting.caseId)?.caseId ?? '—'}`,
        subtitle: `${sitting.judge} · ${sitting.courtRoom}`,
        snippet: truncate(sitting.notes || sitting.outcomeNotes, 160),
        link: `/cases/${sitting.caseId}?tab=court-dates`,
      }),
    );

  data.tasks
    .filter((task) =>
      task.caseId
        ? visibleCaseIds.has(task.caseId)
        : access.canSeeUnitTasks || task.ownerId === access.userId,
    )
    .filter((task) => matchesQuery(`${task.title} ${task.description}`, trimmed))
    .slice(0, limitPerGroup)
    .forEach((task) =>
      hits.push({
        group: 'Tasks',
        id: task.id,
        title: task.title,
        subtitle: `${task.status} · ${task.priority}`,
        snippet: truncate(task.description, 160),
        link: task.caseId ? `/cases/${task.caseId}?tab=tasks` : '/tasks',
      }),
    );

  data.notes
    .filter((note) => visibleCaseIds.has(note.caseId))
    .filter((note) => matchesQuery(note.body, trimmed))
    .slice(0, limitPerGroup)
    .forEach((note) =>
      hits.push({
        group: 'Notes',
        id: note.id,
        title: `Note on ${caseById.get(note.caseId)?.caseId ?? '—'}`,
        subtitle: note.internalOnly ? 'Internal only' : 'Visible to the matter team',
        snippet: truncate(note.body, 160),
        link: `/cases/${note.caseId}?tab=notes`,
      }),
    );

  (access.canSeePeople ? data.users : [])
    .filter((user) => matchesQuery(`${user.fullName} ${user.email} ${user.title} ${user.firm ?? ''}`, trimmed))
    .slice(0, limitPerGroup)
    .forEach((user) =>
      hits.push({
        group: 'People',
        id: user.id,
        title: user.fullName,
        subtitle: `${user.title}${user.firm ? ` · ${user.firm}` : ''}`,
        snippet: user.email,
        link: `/admin/users?user=${user.id}`,
      }),
    );

  return hits;
}
