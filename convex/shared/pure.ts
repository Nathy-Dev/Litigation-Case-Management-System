/**
 * HYPREP LCMS - environment-free helpers.
 *
 * Everything here is a pure function over its arguments: no DOM, no `window`,
 * no `import.meta.env`, no clock, no randomness. That is what makes the module
 * importable from both runtimes, which is the whole point of it existing.
 *
 * It is the home of the logic that has to agree across the wire. `matchesQuery`
 * is the clearest case: it decides what the search box matches, and until the
 * Convex search indexes take over it runs on both sides. One implementation
 * means the two cannot answer differently.
 *
 * The client keeps importing these from `@/lib/utils`, which re-exports the
 * module - so the 57 component imports were untouched by the split, and the
 * browser-only helpers stay where they were.
 *
 * The bar for adding something here: could it run inside a Convex mutation with
 * no shims? If not, it belongs in `src/lib/utils.ts`.
 */

/**
 * Initials for the avatar chip: first letter of the first and last name.
 *
 * Parenthesised qualifiers are dropped first - the register carries names like
 * "Chinedu Okonkwo (SAN)", and "CO" is wanted rather than "C(".
 *
 * Stored on the user document rather than derived at render, so it is written
 * server-side whenever an account is created or imported. That is why this is
 * shared rather than client-only.
 */
export function initialsFrom(fullName: string): string {
  const parts = fullName
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]![0] : '';
  return (first + last).toUpperCase();
}

/**
 * Case-insensitive AND-of-tokens match: every whitespace-separated token in the
 * query must appear somewhere in the haystack.
 *
 * Deliberately simple, and deliberately shared. A Convex search index tokenises
 * and ranks differently, so where both are in play the same text must at least
 * be *reachable* by both - hence one implementation, used by the client filter
 * and by any server-side fallback scan.
 */
export function matchesQuery(haystack: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = haystack.toLowerCase();
  return q.split(/\s+/).every((token) => hay.includes(token));
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Sorts by a derived key, nulls last in both directions.
 *
 * Strings compare with `localeCompare` under `en-NG` at base sensitivity, so
 * case and accents do not split otherwise-equal names. The Convex runtime ships
 * full ICU (verified against this deployment), so this behaves identically on
 * the server - which matters, because a server-paginated list and a client sort
 * of the same rows must not disagree about their order.
 */
export function sortBy<T>(
  rows: readonly T[],
  key: (row: T) => string | number | null,
  dir: 'asc' | 'desc',
): T[] {
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

export function groupBy<T, K extends string>(
  rows: readonly T[],
  key: (row: T) => K,
): Record<K, T[]> {
  return rows.reduce(
    (acc, row) => {
      const k = key(row);
      (acc[k] ||= []).push(row);
      return acc;
    },
    {} as Record<K, T[]>,
  );
}

export function unique<T>(arr: readonly T[]): T[] {
  return [...new Set(arr)];
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Splits text into runs, flagging the ones that matched the query, so a result
 * list can mark hits without the caller building regexes or risking injection
 * from a user-typed query.
 */
export function highlight(text: string, query: string): { text: string; hit: boolean }[] {
  const q = query.trim();
  if (!q) return [{ text, hit: false }];
  const tokens = q.split(/\s+/).filter(Boolean).map(escapeRegExp);
  const splitter = new RegExp(`(${tokens.join('|')})`, 'ig');
  // A fresh non-global regex for the test: `lastIndex` on a /g regex carries
  // between calls, so reusing the splitter here would skip alternate matches.
  const isToken = new RegExp(`^(${tokens.join('|')})$`, 'i');
  return text
    .split(splitter)
    .filter((part) => part !== '')
    .map((part) => ({ text: part, hit: isToken.test(part) }));
}

/**
 * Builds RFC-4180-ish CSV from a column spec and rows.
 *
 * Shared because exports are moving server-side: a report large enough to matter
 * should be rendered where the rows already are, rather than shipped to the
 * browser to be joined into a string.
 */
export function toCsv<T extends Record<string, unknown>>(
  columns: readonly { key: string; label: string }[],
  rows: readonly T[],
): string {
  const escapeCell = (value: unknown) => {
    const str = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const header = columns.map((c) => escapeCell(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => escapeCell(row[c.key])).join(',')).join('\n');
  return `${header}\n${body}`;
}
