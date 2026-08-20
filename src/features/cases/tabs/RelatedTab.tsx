import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, GitBranch, Link2, Sparkles } from 'lucide-react';
import type { CaseLinkType, CaseRecord } from '@/types';
import type { BadgeTone } from '@/components/ui/Badge';
import { formatDate, formatNairaCompact, shortCourtName } from '@/lib/format';
import { useDataStore } from '@/store/dataStore';
import { useVisibleCaseRows } from '@/hooks/useCaseData';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';

const LINK_TONE: Record<CaseLinkType, BadgeTone> = {
  Appeal: 'info',
  'Cross Appeal': 'info',
  Consolidated: 'brand',
  'Related Suit': 'neutral',
  Enforcement: 'gold',
};

/**
 * Declared links plus suggestions the system infers from shared parties and
 * tags — the register spots connections the unit may not have linked yet.
 */
export function RelatedTab({ caseRecord }: { caseRecord: CaseRecord }) {
  const cases = useDataStore((state) => state.cases);
  const rows = useVisibleCaseRows();

  const declared = useMemo(
    () =>
      caseRecord.relatedCases
        .map((link) => ({ link, row: rows.find((row) => row.record.id === link.caseId) }))
        .filter((entry): entry is { link: typeof entry.link; row: NonNullable<typeof entry.row> } =>
          Boolean(entry.row),
        ),
    [caseRecord.relatedCases, rows],
  );

  const suggestions = useMemo(() => {
    const declaredIds = new Set(caseRecord.relatedCases.map((link) => link.caseId));
    const partyNames = new Set(
      caseRecord.parties.map((party) => party.name.toLowerCase()),
    );
    const tags = new Set(caseRecord.tags);

    return rows
      .filter((row) => row.record.id !== caseRecord.id && !declaredIds.has(row.record.id))
      .map((row) => {
        const sharedParties = row.record.parties
          .filter((party) => partyNames.has(party.name.toLowerCase()))
          .map((party) => party.name);
        const sharedTags = row.record.tags.filter((tag) => tags.has(tag));
        const sameSuit =
          Boolean(caseRecord.suitNumber) && row.record.suitNumber === caseRecord.suitNumber;
        const score = sharedParties.length * 3 + sharedTags.length + (sameSuit ? 5 : 0);
        return { row, sharedParties, sharedTags, score };
      })
      .filter((entry) => entry.score >= 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }, [rows, caseRecord]);

  const missing = caseRecord.relatedCases.length - declared.length;

  return (
    <div className="space-y-4">
      <Card flush>
        <CardHeader
          title="Linked matters"
          description={
            declared.length === 0
              ? 'No matters have been linked to this file.'
              : `${declared.length} linked ${declared.length === 1 ? 'matter' : 'matters'}${missing > 0 ? ` · ${missing} outside your access` : ''}`
          }
          icon={<GitBranch className="size-4" aria-hidden />}
          divided
        />
        {declared.length === 0 ? (
          <EmptyState
            icon={<Link2 className="size-6" aria-hidden />}
            title="Nothing linked yet"
            description="Appeals, consolidated suits and enforcement proceedings can be linked so the whole picture travels with the file."
            compact
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {declared.map(({ link, row }) => (
              <li key={link.caseId}>
                <Link
                  to={`/cases/${row.record.id}`}
                  className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-ink-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[12px] text-brand-700">
                        {row.record.caseId}
                      </span>
                      <Badge tone={LINK_TONE[link.linkType]} size="sm">
                        {link.linkType}
                      </Badge>
                      <StatusBadge status={row.record.status} size="sm" />
                    </div>
                    <p className="mt-0.5 text-[13px] font-medium text-ink-900">{row.record.title}</p>
                    {link.note && (
                      <p className="mt-0.5 text-[12px] leading-snug text-ink-600">{link.note}</p>
                    )}
                    <p className="mt-1 flex flex-wrap items-center gap-x-2.5 text-[11px] text-ink-500">
                      <span>{shortCourtName(row.courtName)}</span>
                      <span aria-hidden>·</span>
                      <span>{row.record.suitNumber ?? 'No suit number'}</span>
                      <span aria-hidden>·</span>
                      <span>Filed {formatDate(row.record.filingDate)}</span>
                      {row.record.claimValue !== null && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="tnum">{formatNairaCompact(row.record.claimValue)}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <ArrowUpRight className="mt-1 size-4 shrink-0 text-ink-300" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card flush>
        <CardHeader
          title="Possible connections"
          hint="Detected from shared parties, suit numbers and tags across the register — not yet linked."
          icon={<Sparkles className="size-4" aria-hidden />}
          divided
        />
        {suggestions.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="size-6" aria-hidden />}
            title="No connections detected"
            description={`Nothing else in the register shares parties or tags with ${caseRecord.caseId}.`}
            compact
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {suggestions.map(({ row, sharedParties, sharedTags }) => (
              <li key={row.record.id}>
                <Link
                  to={`/cases/${row.record.id}`}
                  className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-ink-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[12px] text-brand-700">
                        {row.record.caseId}
                      </span>
                      <StatusBadge status={row.record.status} size="sm" />
                    </div>
                    <p className="mt-0.5 text-[13px] text-ink-800">{row.record.title}</p>
                    <p className="mt-1 text-[11px] text-ink-500">
                      {sharedParties.length > 0
                        ? `Shares ${sharedParties.length === 1 ? 'a party' : 'parties'}: ${sharedParties.join(', ')}`
                        : `Shares tags: ${sharedTags.join(', ')}`}
                    </p>
                  </div>
                  {cases.some((item) => item.id === row.record.id) && (
                    <ArrowUpRight className="mt-1 size-4 shrink-0 text-ink-300" aria-hidden />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
