import type { ReportColumn } from '@/types';
import type { ReportRow } from './selectors/reports';

/** Excel opens UTF-8 CSV correctly only when a byte-order mark is present. */
const BOM = '﻿';

function escapeCell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(columns: ReportColumn[], rows: ReportRow[]) {
  const header = columns.map((column) => escapeCell(column.label)).join(',');
  const body = rows.map((row) => columns.map((column) => escapeCell(row[column.key])).join(','));
  return [header, ...body].join('\r\n');
}

/**
 * Hands a generated file to the browser. The real service will stream the file
 * from the API; the shape of the call stays the same.
 */
export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke on the next tick so Safari has time to start the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function downloadCsv(filename: string, columns: ReportColumn[], rows: ReportRow[]) {
  downloadFile(filename, BOM + toCsv(columns, rows), 'text/csv');
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * PDF export uses the browser's own print-to-PDF, which keeps the frontend
 * dependency-free and gives Nigerian-English headers and dd/MM/yyyy dates for
 * free. The backend will later render the same table server-side.
 */
export function printReport({
  title,
  caption,
  columns,
  rows,
  footer,
}: {
  title: string;
  caption: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  footer: string;
}) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.append(frame);

  const doc = frame.contentDocument;
  if (!doc) return;

  const escapeHtml = (value: unknown) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  doc.write(`<!doctype html><html lang="en-NG"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font: 11px/1.45 "Segoe UI", system-ui, sans-serif; color: #12211a; margin: 0; }
  header { border-bottom: 2px solid #008751; padding-bottom: 8px; margin-bottom: 12px; }
  .unit { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: #4b6155; }
  h1 { font-size: 16px; margin: 4px 0 2px; }
  .caption { color: #4b6155; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 5px 6px; border-bottom: 1px solid #dbe5df; text-align: left; vertical-align: top; }
  th { background: #eaf5ef; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #24463a; }
  td.right, th.right { text-align: right; font-variant-numeric: tabular-nums; }
  tr:nth-child(even) td { background: #f7faf8; }
  footer { margin-top: 12px; font-size: 9px; color: #6b7f74; border-top: 1px solid #dbe5df; padding-top: 6px; }
</style></head><body>
<header>
  <p class="unit">Hydrocarbon Pollution Remediation Project — Legal Unit</p>
  <h1>${escapeHtml(title)}</h1>
  <p class="caption">${escapeHtml(caption)}</p>
</header>
<table><thead><tr>${columns
    .map(
      (column) =>
        `<th class="${column.align === 'right' ? 'right' : ''}">${escapeHtml(column.label)}</th>`,
    )
    .join('')}</tr></thead><tbody>${rows
    .map(
      (row) =>
        `<tr>${columns
          .map(
            (column) =>
              `<td class="${column.align === 'right' ? 'right' : ''}">${escapeHtml(row[column.key])}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('')}</tbody></table>
<footer>${escapeHtml(footer)}</footer>
</body></html>`);
  doc.close();

  frame.contentWindow?.focus();
  frame.contentWindow?.print();
  window.setTimeout(() => frame.remove(), 2_000);
}
