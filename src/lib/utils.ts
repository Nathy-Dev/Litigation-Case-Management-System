import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * HYPREP LCMS - client helpers.
 *
 * This module is split in two along one line: whether a helper could run inside
 * a Convex function. The pure, environment-free half lives in
 * `convex/shared/pure.ts` so both runtimes share a single implementation, and is
 * re-exported below - every existing `@/lib/utils` import keeps working, and no
 * caller needs to know which side of the line a given helper sits on.
 *
 * What stays here is what genuinely cannot cross: Tailwind class merging, the
 * DOM download, and the seeded-random helpers the mock generators are built on.
 */

// Pure helpers, shared with the backend. Re-exported so component imports are
// unaffected by where the implementation actually lives.
export {
  clamp,
  groupBy,
  highlight,
  initialsFrom,
  matchesQuery,
  sortBy,
  toCsv,
  truncate,
  unique,
} from '@shared/pure';

/** Tailwind-aware className composer. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Prefixed, collision-resistant id for client-created records.
 *
 * Transitional. Convex assigns `_id` on insert, so once an entity's writes are
 * server-side its records no longer need this - the id arrives from the
 * mutation instead of being invented before the call.
 */
export function makeId(prefix: string) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

/**
 * Triggers a browser download for generated text (CSV exports, audit extracts).
 *
 * The one genuinely DOM-bound helper here: it builds an anchor and clicks it.
 * Server-side export paths produce bytes and a storage URL instead.
 */
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

// ---------------------------------------------------------------------------
// Mock generator support - removed with the generator tree
// ---------------------------------------------------------------------------

/**
 * Deterministic pseudo-random generator so mock data is stable across reloads.
 *
 * Used only by `src/mocks/**`, and deleted along with it. Nothing server-side
 * may depend on this: a Convex mutation that needs an unpredictable value has
 * `crypto.randomUUID()`, and one that needs a stable value should read it from
 * the database.
 */
export function seededRandom(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Picks one element using a `seededRandom` stream. Mock generators only. */
export function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}
