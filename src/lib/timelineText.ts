import type { TimelineEvent } from '@shared/timeline';
import { formatDateMedium, formatHearingSlot } from './format';

/**
 * Renders a timeline event as the sentence a reader sees.
 *
 * The server returns timeline events as structured data - a type and the
 * operands of its sentence - and this is where they become prose. Keeping the
 * wording here rather than in the query means the register's stored history is
 * not committed to one locale's phrasing, and it puts every string a user reads
 * about case history in one file where it can be reviewed as a whole.
 *
 * The switch is exhaustive over the event union, so adding an event type to
 * `convex/shared/timeline.ts` without giving it wording is a compile error
 * rather than a blank line in the feed.
 */
export function describeEvent(event: TimelineEvent): { summary: string; detail: string } {
  switch (event.type) {
    case 'case.created': {
      const { caseNumber, caseReference, partyCount } = event.data;
      return {
        summary: `Matter opened on the register as ${caseNumber}`,
        detail: caseReference
          ? `Internal reference ${caseReference}. ${partyCount} parties recorded.`
          : `${partyCount} parties recorded.`,
      };
    }

    case 'counsel.assigned':
      return {
        summary: 'External counsel briefed on the matter',
        detail: 'Brief to counsel prepared and access granted to the matter file.',
      };

    case 'case.archived':
      return {
        summary: 'Matter archived under the retention policy',
        detail: 'Documents retained in cold storage; record remains searchable.',
      };

    case 'case.updated':
      return {
        summary: `Status set to ${event.data.to}`,
        detail: event.data.reason,
      };

    case 'case.status.changed':
      return {
        summary: `Status changed from ${event.data.from} to ${event.data.to}`,
        detail: event.data.reason,
      };

    case 'document.uploaded':
      return {
        summary: `Uploaded “${event.data.documentName}”`,
        detail: event.data.changeNote,
      };

    case 'document.version.added':
      return {
        summary: `Version ${event.data.version} of “${event.data.documentName}” added`,
        detail: event.data.changeNote,
      };

    case 'document.checked_out':
      return {
        summary: `Checked out “${event.data.documentName}” for editing`,
        detail: 'The document is locked to other editors until it is checked back in.',
      };

    case 'document.checked_in':
      return {
        summary: `Checked in “${event.data.documentName}”`,
        detail: `Version ${event.data.version} saved and the editing lock released.`,
      };

    case 'courtdate.created':
      return {
        summary: `Court date fixed for ${formatHearingSlot(event.data.startsAt)}`,
        detail: `${event.data.purpose} before ${event.data.judge} in ${event.data.courtRoom}.`,
      };

    case 'courtdate.updated':
      return {
        summary: `Court date moved to ${formatHearingSlot(event.data.startsAt)}`,
        detail: `${event.data.purpose} was previously listed for ${formatHearingSlot(
          event.data.previousStartsAt,
        )}.`,
      };

    case 'courtdate.outcome.recorded':
      return {
        summary: `Hearing outcome recorded: ${event.data.outcome}`,
        detail: event.data.adjourned
          ? `${event.data.outcomeNotes} Adjourned to a further date.`
          : event.data.outcomeNotes,
      };

    case 'task.created':
      return {
        summary: `Task assigned: ${event.data.title}`,
        detail: `Due ${formatDateMedium(event.data.dueDate)} · ${event.data.priority} priority.`,
      };

    case 'task.completed':
      return {
        summary: `Task completed: ${event.data.title}`,
        detail: 'Marked complete by the task owner.',
      };

    case 'note.added':
      return {
        summary: event.data.internalOnly
          ? 'Internal note added to the file'
          : 'Note added to the file',
        detail: event.data.body,
      };
  }
}
