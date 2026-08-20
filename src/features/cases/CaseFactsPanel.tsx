import { Link } from 'react-router-dom';
import { Building2, Scale, Tag, Users } from 'lucide-react';
import type { CaseRow } from '@/lib/selectors/cases';
import { formatDate, formatNaira, formatAge } from '@/lib/format';
import { useDataStore } from '@/store/dataStore';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge, PriorityBadge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2">
      <dt className="text-[11px] tracking-wide text-ink-500 uppercase">{label}</dt>
      <dd className="mt-0.5 text-[13px] leading-snug text-ink-900">{children}</dd>
    </div>
  );
}

/** Right-hand rail on the case detail page: the facts a lawyer needs at a glance. */
export function CaseFactsPanel({ row }: { row: CaseRow }) {
  const { record } = row;
  const users = useDataStore((state) => state.users);
  const teams = useDataStore((state) => state.teams);
  const team = teams.find((item) => item.id === record.teamId);

  const assignees = record.assigneeIds
    .map((id) => users.find((user) => user.id === id))
    .filter((user): user is NonNullable<typeof user> => Boolean(user));
  const counsel = record.externalCounselIds
    .map((id) => users.find((user) => user.id === id))
    .filter((user): user is NonNullable<typeof user> => Boolean(user));

  return (
    <div className="space-y-4">
      <Card flush>
        <CardHeader title="Case details" icon={<Scale className="size-4" aria-hidden />} divided />
        <dl className="divide-y divide-ink-100 px-4">
          <Fact label="Suit number">
            <span className="font-mono text-[12px]">{record.suitNumber ?? 'Not yet assigned'}</span>
          </Fact>
          <Fact label="Court">
            {row.courtName}
            {record.presidingJudge && (
              <span className="mt-0.5 block text-[12px] text-ink-500">
                Before {record.presidingJudge}
              </span>
            )}
          </Fact>
          <Fact label="Case type">{row.caseTypeName}</Fact>
          <Fact label="Filed">
            {record.filingDate ? (
              <>
                {formatDate(record.filingDate)}
                <span className="ml-1.5 text-[12px] text-ink-500">({formatAge(record.filingDate)})</span>
              </>
            ) : (
              'Not yet filed'
            )}
          </Fact>
          <Fact label="Priority">
            <PriorityBadge priority={record.priority} size="sm" />
          </Fact>
          {record.claimValue != null && (
            <Fact label="Sum claimed">
              <span className="tnum font-semibold">{formatNaira(record.claimValue)}</span>
            </Fact>
          )}
          <Fact label="Internal reference">{record.caseReference ?? '—'}</Fact>
        </dl>
      </Card>

      <Card flush>
        <CardHeader title="Parties" icon={<Users className="size-4" aria-hidden />} divided />
        <ul className="divide-y divide-ink-100">
          {record.parties.map((party) => (
            <li key={party.id} className="px-4 py-2.5">
              <p className="flex items-start justify-between gap-2">
                <span className="text-[13px] font-medium text-ink-900">{party.name}</span>
                <Badge tone="neutral" size="sm">
                  {party.role}
                </Badge>
              </p>
              <p className="mt-0.5 text-[11px] text-ink-500">
                {party.type}
                {party.representedBy ? ` · Represented by ${party.representedBy}` : ''}
              </p>
            </li>
          ))}
        </ul>
      </Card>

      <Card flush>
        <CardHeader title="Conduct of the matter" icon={<Building2 className="size-4" aria-hidden />} divided />
        <div className="space-y-3 px-4 py-3">
          <div>
            <p className="text-[11px] tracking-wide text-ink-500 uppercase">Matter owner</p>
            {row.owner ? (
              <div className="mt-1.5 flex items-center gap-2">
                <Avatar user={row.owner} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-ink-900">{row.owner.fullName}</p>
                  <p className="truncate text-[11px] text-ink-500">{row.owner.title}</p>
                </div>
              </div>
            ) : (
              <p className="mt-1 text-[13px] text-ink-400">Unassigned</p>
            )}
          </div>

          {assignees.length > 0 && (
            <div>
              <p className="text-[11px] tracking-wide text-ink-500 uppercase">Supporting staff</p>
              <ul className="mt-1.5 space-y-1.5">
                {assignees.map((user) => (
                  <li key={user.id} className="flex items-center gap-2">
                    <Avatar user={user} size="xs" />
                    <span className="truncate text-[12px] text-ink-700">{user.fullName}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {counsel.length > 0 && (
            <div>
              <p className="text-[11px] tracking-wide text-ink-500 uppercase">External counsel</p>
              <ul className="mt-1.5 space-y-1.5">
                {counsel.map((user) => (
                  <li key={user.id} className="flex items-center gap-2">
                    <Avatar user={user} size="xs" />
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] text-ink-700">{user.fullName}</span>
                      <span className="block truncate text-[11px] text-ink-400">{user.firm}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {team && (
            <div>
              <p className="text-[11px] tracking-wide text-ink-500 uppercase">Team</p>
              <p className="mt-0.5 text-[13px] text-ink-800">{team.name}</p>
            </div>
          )}
        </div>
      </Card>

      {record.tags.length > 0 && (
        <Card flush>
          <CardHeader title="Tags" icon={<Tag className="size-4" aria-hidden />} divided />
          <div className="flex flex-wrap gap-1.5 px-4 py-3">
            {record.tags.map((tag) => (
              <Link
                key={tag}
                to={`/cases?q=${encodeURIComponent(tag)}`}
                className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] text-ink-600 hover:bg-brand-50 hover:text-brand-700"
              >
                {tag}
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
