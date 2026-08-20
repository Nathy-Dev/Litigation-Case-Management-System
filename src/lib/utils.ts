import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind-aware className composer. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Deterministic pseudo-random generator so mock data is stable across reloads. */
export function seededRandom(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

/** Prefixed, collision-resistant id for client-created records. */
export function makeId(prefix: string) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

export function initialsFrom(fullName: string) {
  const parts = fullName.replace(/\(.*?\)/g, '').trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]![0] : '';
  return (first + last).toUpperCase();
}

export function sortBy<T>(rows: T[], key: (row: T) => string | number | null, dir: 'asc' | 'desc') {
  return [...rows].sort((a, b) => {
    const av = key(a);
    const bv = key(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') {
      return dir === 'asc' ? av - bv : bv - av;
    }
    const cmp = String(av).localeCompare(String(bv), 'en-NG', { sensitivity: 'base' });
    return dir === 'asc' ? cmp : -cmp;
  });
}

export function groupBy<T, K extends string>(rows: T[], key: (row: T) => K): Record<K, T[]> {
  return rows.reduce(
    (acc, row) => {
      const k = key(row);
      (acc[k] ||= []).push(row);
      return acc;
    },
    {} as Record<K, T[]>,
  );
}

export function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

/** Simulated network latency so loading states are visible in the demo. */
export function delay(ms = 320) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function truncate(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Case-insensitive token match — every token in the query must appear somewhere
 * in the haystack. Approximates the backend's full-text search (TOR §15).
 */
export function matchesQuery(haystack: string, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = haystack.toLowerCase();
  return q.split(/\s+/).every((token) => hay.includes(token));
}

export function highlight(text: string, query: string): { text: string; hit: boolean }[] {
  const q = query.trim();
  if (!q) return [{ text, hit: false }];
  const tokens = q.split(/\s+/).filter(Boolean).map(escapeRegExp);
  const re = new RegExp(`(${tokens.join('|')})`, 'ig');
  return text
    .split(re)
    .filter((part) => part !== '')
    .map((part) => ({ text: part, hit: re.test(part) && new RegExp(`^(${tokens.join('|')})$`, 'i').test(part) }));
}

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function downloadBlob(filename: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Builds RFC-4180-ish CSV from a column spec and rows. */
export function toCsv<T extends Record<string, unknown>>(
  columns: { key: string; label: string }[],
  rows: T[],
) {
  const escapeCell = (value: unknown) => {
    const str = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const header = columns.map((c) => escapeCell(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => escapeCell(row[c.key])).join(',')).join('\n');
  return `${header}\n${body}`;
}
