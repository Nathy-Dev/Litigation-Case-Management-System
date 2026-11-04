/**
 * HYPREP LCMS - report catalogue (TOR section 15).
 *
 * The definitions are shared: the server runs a report by id and shapes rows to
 * these columns, the client renders the same columns as a table and reuses them
 * as the CSV header. One declaration, so an exported file can never disagree
 * with the screen it was exported from.
 *
 * Code rather than a table, for the same reason as the templates: nothing in the
 * application edits a report definition, and the query that computes each report
 * has to be written to match its columns anyway.
 */
import type { ReportId } from './enums';

export interface ReportColumn {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
}

export interface ReportDefinition {
  id: ReportId;
  name: string;
  description: string;
  /** Which TOR requirement the report satisfies. */
  requirement: string;
  columns: ReportColumn[];
}

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  {
    id: 'caseload-by-status',
    name: 'Caseload by status',
    description: 'Distribution of the entire matter register across lifecycle statuses.',
    requirement: 'TOR §15 — Reports required',
    columns: [
      { key: 'status', label: 'Status' },
      { key: 'count', label: 'Matters', align: 'right' },
      { key: 'share', label: 'Share', align: 'right' },
      { key: 'exposure', label: 'Claim exposure', align: 'right' },
    ],
  },
  {
    id: 'upcoming-hearings',
    name: 'Upcoming hearings',
    description: 'Every diarised court date in the selected window, with purpose and attendees.',
    requirement: 'TOR §15 — Reports required',
    columns: [
      { key: 'date', label: 'Date' },
      { key: 'time', label: 'Time' },
      { key: 'caseId', label: 'Case ID' },
      { key: 'title', label: 'Matter' },
      { key: 'court', label: 'Court' },
      { key: 'purpose', label: 'Purpose' },
      { key: 'owner', label: 'Matter owner' },
    ],
  },
  {
    id: 'age-of-matters',
    name: 'Age of matters',
    description: 'How long open matters have been on the register, bucketed by age.',
    requirement: 'TOR §15 — Reports required',
    columns: [
      { key: 'caseId', label: 'Case ID' },
      { key: 'title', label: 'Matter' },
      { key: 'status', label: 'Status' },
      { key: 'filingDate', label: 'Filed' },
      { key: 'age', label: 'Age', align: 'right' },
      { key: 'bucket', label: 'Age band' },
    ],
  },
  {
    id: 'workload-by-lawyer',
    name: 'Workload by lawyer',
    description: 'Matters, hearings and open tasks carried by each member of the Legal Unit.',
    requirement: 'TOR §15 — Reports required',
    columns: [
      { key: 'lawyer', label: 'Lawyer' },
      { key: 'title', label: 'Title' },
      { key: 'openCases', label: 'Open matters', align: 'right' },
      { key: 'hearings30', label: 'Hearings (30d)', align: 'right' },
      { key: 'openTasks', label: 'Open tasks', align: 'right' },
      { key: 'overdueTasks', label: 'Overdue', align: 'right' },
      { key: 'exposure', label: 'Claim exposure', align: 'right' },
    ],
  },
  {
    id: 'concluded-matters',
    name: 'Concluded matters summary',
    description: 'Matters concluded, closed or archived, with outcome and duration.',
    requirement: 'TOR §15 — Reports required',
    columns: [
      { key: 'caseId', label: 'Case ID' },
      { key: 'title', label: 'Matter' },
      { key: 'court', label: 'Court' },
      { key: 'status', label: 'Status' },
      { key: 'outcome', label: 'Last outcome' },
      { key: 'duration', label: 'Duration', align: 'right' },
      { key: 'owner', label: 'Matter owner' },
    ],
  },
  {
    id: 'document-inventory',
    name: 'Document inventory',
    description: 'Every document in the repository with type, versions, size and confidentiality.',
    requirement: 'TOR §15 — Reports required',
    columns: [
      { key: 'name', label: 'Document' },
      { key: 'caseId', label: 'Case ID' },
      { key: 'type', label: 'Type' },
      { key: 'versions', label: 'Versions', align: 'right' },
      { key: 'size', label: 'Size', align: 'right' },
      { key: 'confidential', label: 'Confidential' },
      { key: 'uploaded', label: 'Last upload' },
    ],
  },
];
