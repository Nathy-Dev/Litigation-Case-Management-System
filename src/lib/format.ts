import {
  differenceInCalendarDays,
  differenceInDays,
  format,
  formatDistanceToNowStrict,
  isPast,
  isToday,
  isTomorrow,
  parseISO,
} from 'date-fns';

/**
 * Localisation helpers (TOR §27) — Nigerian English formatting, dd/MM/yyyy
 * dates, West Africa Time, and Naira currency.
 */

export const DEFAULT_DATE_FORMAT = 'dd/MM/yyyy';

function toDate(value: string | Date): Date {
  return typeof value === 'string' ? parseISO(value) : value;
}

export function formatDate(value: string | Date | null | undefined, pattern = DEFAULT_DATE_FORMAT) {
  if (!value) return '—';
  try {
    return format(toDate(value), pattern);
  } catch {
    return '—';
  }
}

export function formatDateLong(value: string | Date | null | undefined) {
  return formatDate(value, 'EEEE, d MMMM yyyy');
}

export function formatDateMedium(value: string | Date | null | undefined) {
  return formatDate(value, 'd MMM yyyy');
}

export function formatTime(value: string | Date | null | undefined) {
  if (!value) return '—';
  return format(toDate(value), 'h:mm a');
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return '—';
  return `${formatDate(value)} · ${formatTime(value)}`;
}

/** Audit-log grade timestamp — unambiguous, second precision, with zone. */
export function formatTimestamp(value: string | Date | null | undefined) {
  if (!value) return '—';
  return format(toDate(value), "dd/MM/yyyy HH:mm:ss 'WAT'");
}

export function formatRelative(value: string | Date | null | undefined) {
  if (!value) return '—';
  const date = toDate(value);
  const suffix = isPast(date) ? 'ago' : 'from now';
  return `${formatDistanceToNowStrict(date)} ${suffix}`;
}

/** "Today", "Tomorrow", "in 4 days", "3 days overdue" — used on hearing cards. */
export function formatDueLabel(value: string | Date | null | undefined) {
  if (!value) return '—';
  const date = toDate(value);
  if (isToday(date)) return 'Today';
  if (isTomorrow(date)) return 'Tomorrow';
  const days = differenceInCalendarDays(date, new Date());
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`;
  if (days <= 14) return `in ${days} days`;
  return formatDateMedium(date);
}

export function daysUntil(value: string | Date) {
  return differenceInCalendarDays(toDate(value), new Date());
}

export function ageInDays(value: string | Date) {
  return Math.max(0, differenceInDays(new Date(), toDate(value)));
}

/** Age of matter expressed the way the Legal Unit reports it. */
export function formatAge(value: string | Date | null | undefined) {
  if (!value) return '—';
  const days = ageInDays(value);
  if (days < 31) return `${days}d`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months}mo`;
  const years = Math.floor(days / 365.25);
  const remMonths = Math.round((days - years * 365.25) / 30.44);
  return remMonths > 0 ? `${years}y ${remMonths}mo` : `${years}y`;
}

export function ageBucket(value: string | Date | null | undefined) {
  if (!value) return 'Unknown';
  const days = ageInDays(value);
  if (days <= 90) return '0–3 months';
  if (days <= 180) return '3–6 months';
  if (days <= 365) return '6–12 months';
  if (days <= 730) return '1–2 years';
  return 'Over 2 years';
}

export const AGE_BUCKETS = ['0–3 months', '3–6 months', '6–12 months', '1–2 years', 'Over 2 years'];

const nairaFormatter = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 0,
});

export function formatNaira(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return nairaFormatter.format(value);
}

/** Compact Naira for KPI tiles: ₦1.2bn, ₦850m, ₦4.5m. */
export function formatNairaCompact(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `₦${(value / 1_000_000_000).toFixed(abs >= 1e10 ? 0 : 1)}bn`;
  if (abs >= 1_000_000) return `₦${(value / 1_000_000).toFixed(abs >= 1e7 ? 0 : 1)}m`;
  if (abs >= 1_000) return `₦${(value / 1_000).toFixed(0)}k`;
  return `₦${value}`;
}

export function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-NG').format(value);
}

export function formatPercent(value: number, fractionDigits = 0) {
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

export function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i === 0 ? 0 : value >= 100 ? 0 : 1)} ${units[i]}`;
}

export function formatPhone(phone: string) {
  return phone.replace(/^(\+234)(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3 $4');
}

/** Nigerian legal shorthand for hearing slots: "Mon 14 Jul · 9:00 AM". */
/** "Tue 4 Mar · 9:00 am" — add the duration for "9:00 am – 11:00 am". */
export function formatHearingSlot(value: string, durationMinutes?: number) {
  const date = toDate(value);
  const start = `${format(date, 'EEE d MMM')} · ${format(date, 'h:mm a')}`;
  if (!durationMinutes) return start;
  const end = new Date(date.getTime() + durationMinutes * 60_000);
  return `${start} – ${format(end, 'h:mm a')}`;
}

/**
 * Nigerian court names are long ("Federal High Court, Port Harcourt Division").
 * Diary strips and dense tables need the recognised short form instead.
 */
const COURT_ABBREVIATIONS: Array<[RegExp, string]> = [
  [/^Supreme Court/i, 'Supreme Court'],
  [/^Court of Appeal/i, 'Court of Appeal'],
  [/^Federal High Court/i, 'FHC'],
  [/^National Industrial Court/i, 'NICN'],
  [/^Rivers State High Court/i, 'Rivers State HC'],
  [/^Chief Magistrate Court/i, 'Magistrate Court'],
  [/^Tax Appeal Tribunal/i, 'Tax Appeal Tribunal'],
  [/^Customary Court of Appeal/i, 'Customary CA'],
  [/^Lagos Court of Arbitration/i, 'Lagos Arbitration'],
];

export function shortCourtName(name: string | undefined | null) {
  if (!name || name === '—') return '—';
  const [head, ...rest] = name.split(',');
  const seat = rest
    .join(',')
    .replace(/\b(Judicial\s+)?Division\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const abbreviated = COURT_ABBREVIATIONS.find(([pattern]) => pattern.test(head.trim()))?.[1];
  const stem = abbreviated ?? head.trim();
  return seat ? `${stem}, ${seat}` : stem;
}

export function toDateInputValue(value: string | Date | null | undefined) {
  if (!value) return '';
  return format(toDate(value), 'yyyy-MM-dd');
}

export function toTimeInputValue(value: string | Date | null | undefined) {
  if (!value) return '';
  return format(toDate(value), 'HH:mm');
}
