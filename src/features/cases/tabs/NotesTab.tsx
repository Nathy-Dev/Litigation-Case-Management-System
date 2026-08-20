import { useMemo, useState } from 'react';
import { Lock, MessageSquare, Send } from 'lucide-react';
import type { CaseRecord } from '@/types';
import { formatDateTime, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDataStore } from '@/store/dataStore';
import { useCan, useCurrentUser, useRole } from '@/store/authStore';
import { notify } from '@/store/uiStore';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Avatar } from '@/components/ui/Avatar';
import { Field, Textarea, Checkbox } from '@/components/ui/Input';

/**
 * Case notes (TOR §37). Notes marked internal are withheld from external
 * counsel and read-only stakeholders — the same rule the API will enforce.
 */
export function NotesTab({ caseRecord }: { caseRecord: CaseRecord }) {
  const notes = useDataStore((state) => state.notes);
  const users = useDataStore((state) => state.users);
  const addNote = useDataStore((state) => state.addNote);
  const canWrite = useCan('note.create');
  const role = useRole();
  // Internal notes are for the unit only — the API will enforce the same rule.
  const canSeeInternal = role !== null && role !== 'EXTERNAL_COUNSEL' && role !== 'READ_ONLY';
  const user = useCurrentUser();

  const [body, setBody] = useState('');
  const [internalOnly, setInternalOnly] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const visible = useMemo(
    () =>
      notes
        .filter((note) => note.caseId === caseRecord.id)
        .filter((note) => canSeeInternal || !note.internalOnly)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [notes, caseRecord.id, canSeeInternal],
  );

  const hidden = notes.filter(
    (note) => note.caseId === caseRecord.id && note.internalOnly && !canSeeInternal,
  ).length;

  const submit = () => {
    if (body.trim().length < 3) {
      setError('Write the note before posting it.');
      return;
    }
    addNote(caseRecord.id, body.trim(), internalOnly, user?.id ?? 'system');
    setBody('');
    setInternalOnly(false);
    setError(undefined);
    notify({ variant: 'success', title: internalOnly ? 'Internal note added' : 'Note added' });
  };

  return (
    <div className="space-y-4">
      {canWrite && (
        <Card>
          <CardBody>
            <Field label="Add a note" error={error}>
              {(props) => (
                <Textarea
                  rows={3}
                  value={body}
                  onChange={(event) => {
                    setBody(event.target.value);
                    setError(undefined);
                  }}
                  placeholder="e.g. Spoke with the registrar — the file has been forwarded to the trial judge for a fresh date."
                  {...props}
                />
              )}
            </Field>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              {canSeeInternal ? (
                <Checkbox
                  checked={internalOnly}
                  onChange={(event) => setInternalOnly(event.target.checked)}
                  label="Internal only"
                  description="Hidden from external counsel and read-only stakeholders."
                />
              ) : (
                <span />
              )}
              <Button
                variant="primary"
                onClick={submit}
                icon={<Send className="size-4" aria-hidden />}
              >
                Post note
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      <Card flush>
        <CardHeader
          title="Notes"
          description={
            hidden > 0
              ? `${visible.length} visible · ${hidden} internal ${hidden === 1 ? 'note' : 'notes'} withheld from your role.`
              : `${visible.length} ${visible.length === 1 ? 'note' : 'notes'} on file.`
          }
          icon={<MessageSquare className="size-4" aria-hidden />}
          divided
        />
        {visible.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="size-6" aria-hidden />}
            title="No notes yet"
            description="Notes keep the running commentary on the matter in one place, attributed and timestamped."
            compact
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {visible.map((note) => {
              const author = users.find((item) => item.id === note.authorId);
              const mentioned = users.filter((item) => note.mentions.includes(item.id));

              return (
                <li key={note.id} className="flex items-start gap-3 px-4 py-3.5">
                  <Avatar user={author} size="sm" className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <p className="text-[13px] font-medium text-ink-900">
                        {author?.fullName ?? 'Unknown'}
                      </p>
                      <span className="text-[11px] text-ink-400" title={formatDateTime(note.createdAt)}>
                        {formatRelative(note.createdAt)}
                      </span>
                      {note.internalOnly && (
                        <Badge tone="gold" size="sm" icon={<Lock className="size-2.5" aria-hidden />}>
                          Internal
                        </Badge>
                      )}
                    </div>
                    <p
                      className={cn(
                        'mt-1 text-[13px] leading-relaxed whitespace-pre-line',
                        note.internalOnly ? 'text-ink-700' : 'text-ink-800',
                      )}
                    >
                      {note.body}
                    </p>
                    {mentioned.length > 0 && (
                      <p className="mt-1.5 text-[11px] text-ink-500">
                        Notified {mentioned.map((item) => item.fullName).join(', ')}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
