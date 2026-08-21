import { seededRandom } from '@/lib/utils';

/**
 * Shared helpers for the mock generators.
 *
 * Everything is derived from a single `now` plus a deterministic RNG, so the
 * demo dataset is stable within a session but always looks current.
 */

/** ISO timestamp at `daysFromNow` (negative = past) with an explicit clock time. */
export function at(now: Date, daysFromNow: number, hour = 9, minute = 0): string {
  const date = new Date(now);
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

/**
 * Subtracting whole hours or minutes from one clock reading leaves every
 * derived timestamp carrying that reading's seconds — a page of audit rows all
 * ending in the same `:51` reads as generated rather than recorded. The seconds
 * are spread from the offset itself, so the data stays reproducible.
 */
function spreadSeconds(date: Date, offset: number): string {
  date.setSeconds(Math.floor(Math.abs(offset) * 7919) % 60, 0);
  return date.toISOString();
}

/** ISO timestamp `hoursAgo` before `now` — for audit trails and activity feeds. */
export function hoursBefore(now: Date, hoursAgo: number): string {
  return spreadSeconds(new Date(now.getTime() - hoursAgo * 3_600_000), hoursAgo);
}

export function minutesBefore(now: Date, minutesAgo: number): string {
  return spreadSeconds(new Date(now.getTime() - minutesAgo * 60_000), minutesAgo);
}

export function daysBetween(from: string | Date, to: string | Date): number {
  const a = typeof from === 'string' ? new Date(from) : from;
  const b = typeof to === 'string' ? new Date(to) : to;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Adds days to an ISO string, preserving the clock time. */
export function addDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

/**
 * Moves a date onto the next sitting day. Nigerian courts do not sit at the
 * weekend, so any generated hearing that lands on a Saturday or Sunday is
 * pushed to the Monday — otherwise the diary shows sittings no registry would
 * ever list.
 */
export function onSittingDay(iso: string): string {
  const date = new Date(iso);
  const day = date.getDay();
  if (day === 6) date.setDate(date.getDate() + 2);
  else if (day === 0) date.setDate(date.getDate() + 1);
  return date.toISOString();
}

/** Sets the clock time on an ISO string. */
export function atTime(iso: string, hour: number, minute = 0): string {
  const date = new Date(iso);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

/** Per-entity RNG so adding one generator never reshuffles another's output. */
export function rngFor(namespace: string, index = 0): () => number {
  let hash = 2166136261;
  const key = `${namespace}#${index}`;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return seededRandom(Math.abs(hash) % 2147483000);
}

/** Integer in [min, max] inclusive. */
export function intBetween(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Picks `count` distinct members, preserving source order. */
export function sample<T>(rng: () => number, arr: readonly T[], count: number): T[] {
  if (count >= arr.length) return [...arr];
  const chosen = new Set<number>();
  while (chosen.size < count) chosen.add(Math.floor(rng() * arr.length));
  return [...chosen].sort((a, b) => a - b).map((i) => arr[i]!);
}

/** True with probability `p`. */
export function chance(rng: () => number, p: number): boolean {
  return rng() < p;
}

// ---------------------------------------------------------------------------
// Content pools — Nigerian legal-practice flavoured
// ---------------------------------------------------------------------------

/** Court sitting times actually used by the registries in the demo. */
export const SITTING_TIMES: [number, number][] = [
  [9, 0],
  [9, 0],
  [9, 30],
  [10, 0],
  [10, 0],
  [10, 30],
  [11, 0],
  [12, 0],
  [14, 0],
];

export const COURT_ROOMS = [
  'Court 1',
  'Court 2',
  'Court 3',
  'Court 4',
  'Court 5',
  'Court 7',
  'Court 9',
  'Chambers',
];

/** IP ranges of the Nigerian carriers used in the audit trail. */
export const IP_POOL = [
  '197.210.44.18',
  '197.210.52.240',
  '105.112.19.204',
  '105.112.83.11',
  '41.184.72.90',
  '41.203.148.6',
  '102.89.34.155',
  '102.89.77.9',
  '169.239.128.44',
  '154.113.9.62',
];

export const USER_AGENT_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/128.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Safari/17.5',
  'Mozilla/5.0 (X11; Linux x86_64) Firefox/129.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Infinix X6831) Chrome/127.0 Mobile Safari/537.36',
];

/** Ogoniland sites referenced across evidence, notes and tasks. */
export const SITE_NAMES = [
  'Bodo Creek',
  'K-Dere',
  'Barabeedom',
  'Bomu Manifold',
  'Ejama-Ebubu',
  'Ogale',
  'Nwiibari',
  'Kpean',
  'Yorla',
  'Alode',
];

export const REGISTRY_CLERKS = [
  'the Chief Registrar',
  'the Deputy Chief Registrar',
  'the Litigation Registry',
  'the Assistant Registrar (Civil)',
];
