import { useState } from 'react';
import {
  Download,
  FileText,
  History,
  Lock,
  LockOpen,
  ScanText,
  Upload,
} from 'lucide-react';
import type { CaseDocument } from '@/types';
import { formatBytes, formatDateTime, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDataStore } from '@/store/dataStore';
import { useCurrentUser, useCan } from '@/store/authStore';
import { notify } from '@/store/uiStore';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge, ConfidentialBadge } from '@/components/ui/Badge';
import { Field, Textarea } from '@/components/ui/Input';

/**
 * Preview pane. There is no real file behind the record, so the viewer renders a
 * faithful page mock — including the diagonal watermark applied to confidential
 * downloads (TOR §10) so reviewers can see the control working.
 */
export function DocumentViewer({
  doc,
  onClose,
}: {
  doc: CaseDocument | null;
  onClose: () => void;
}) {
  const user = useCurrentUser();
  const users = useDataStore((state) => state.users);
  const documentTypes = useDataStore((state) => state.documentTypes);
  const cases = useDataStore((state) => state.cases);
  const addDocumentVersion = useDataStore((state) => state.addDocumentVersion);
  const toggleCheckOut = useDataStore((state) => state.toggleCheckOut);
  const recordAudit = useDataStore((state) => state.recordAudit);
  const canEdit = useCan('document.version.manage');
  const canDownload = useCan('document.download');

  const [versionNote, setVersionNote] = useState('');
  const [showVersionForm, setShowVersionForm] = useState(false);

  if (!doc) return null;

  const matter = cases.find((item) => item.id === doc.caseId);
  const type = documentTypes.find((item) => item.id === doc.documentTypeId);
  const author = users.find((item) => item.id === doc.authorId);
  const holder = doc.checkedOutById
    ? users.find((item) => item.id === doc.checkedOutById)
    : undefined;
  const lockedByMe = doc.checkedOutById === user?.id;

  const download = () => {
    recordAudit({
      actorId: user?.id ?? 'system',
      action: 'document.downloaded',
      entity: 'Document',
      entityId: doc.id,
      entityLabel: doc.name,
      metadata: { watermarked: doc.confidential },
    });
    notify({
      variant: doc.confidential ? 'warning' : 'success',
      title: doc.confidential ? 'Watermarked copy prepared' : 'Download started',
      description: doc.confidential
        ? `Stamped “${user?.fullName}” and logged to the audit trail.`
        : `${doc.name} · version ${doc.currentVersion}`,
    });
  };

  return (
    <Modal
      open={Boolean(doc)}
      onClose={onClose}
      size="xl"
      title={doc.name}
      description={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-[12px]">{matter?.caseId}</span>
          <span aria-hidden>·</span>
          <span>{type?.name}</span>
          <span aria-hidden>·</span>
          <span>Version {doc.currentVersion}</span>
          {doc.confidential && <ConfidentialBadge />}
        </span>
      }
      footer={
        <>
          {canEdit && (
            <Button
              variant={lockedByMe ? 'secondary' : 'ghost'}
              onClick={() => {
                toggleCheckOut(doc.id, user?.id ?? 'system');
                notify({
                  variant: 'info',
                  title: lockedByMe ? 'Checked in' : 'Checked out to you',
                  description: lockedByMe
                    ? 'Others can now edit this document.'
                    : 'Others are blocked from editing until you check it back in.',
                });
              }}
              disabled={Boolean(doc.checkedOutById) && !lockedByMe}
              icon={
                lockedByMe ? (
                  <LockOpen className="size-4" aria-hidden />
                ) : (
                  <Lock className="size-4" aria-hidden />
                )
              }
            >
              {lockedByMe ? 'Check in' : 'Check out'}
            </Button>
          )}
          {canEdit && (
            <Button
              variant="secondary"
              onClick={() => setShowVersionForm((value) => !value)}
              icon={<Upload className="size-4" aria-hidden />}
            >
              New version
            </Button>
          )}
          {canDownload && (
            <Button
              variant="primary"
              onClick={download}
              icon={<Download className="size-4" aria-hidden />}
            >
              Download
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
        {/* Page mock ---------------------------------------------------- */}
        <div className="relative min-h-[22rem] overflow-hidden rounded-xl bg-ink-100 p-4">
          <div className="relative mx-auto aspect-[1/1.414] w-full max-w-sm overflow-hidden rounded-lg bg-white shadow-card">
            <div className="space-y-2.5 p-6">
              <p className="text-center text-[10px] font-semibold tracking-wide text-ink-900 uppercase">
                In the {matter ? 'High Court' : 'Court'} of the Federal Republic of Nigeria
              </p>
              <p className="text-center font-mono text-[9px] text-ink-500">
                Suit No. {matter?.suitNumber ?? '—'}
              </p>
              <div className="h-px bg-ink-200" />
              <p className="text-[9px] leading-relaxed text-ink-600">
                {doc.description || doc.name}
              </p>
              {Array.from({ length: 12 }).map((_, index) => (
                <div
                  key={index}
                  className="h-1.5 rounded bg-ink-100"
                  style={{ width: `${72 + ((index * 13) % 26)}%` }}
                />
              ))}
            </div>

            {doc.confidential && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <p className="-rotate-45 text-center text-[13px] leading-tight font-bold tracking-wider text-danger-600/25 uppercase select-none">
                  Confidential
                  <br />
                  <span className="text-[9px]">{user?.fullName}</span>
                  <br />
                  <span className="text-[8px]">{formatDateTime(new Date().toISOString())}</span>
                </p>
              </div>
            )}
          </div>
          <p className="mt-3 text-center text-[11px] text-ink-500">
            Preview only — the production build renders the stored file.
          </p>
        </div>

        {/* Metadata + versions ------------------------------------------ */}
        <div className="space-y-4">
          {doc.checkedOutById && (
            <div
              className={cn(
                'rounded-lg px-3 py-2 text-[12px]',
                lockedByMe ? 'bg-brand-50 text-brand-800' : 'bg-gold-50 text-gold-800',
              )}
            >
              <p className="font-semibold">
                {lockedByMe ? 'Checked out to you' : `Checked out by ${holder?.fullName}`}
              </p>
              <p className="mt-0.5">{formatRelative(doc.checkedOutAt)}</p>
            </div>
          )}

          {showVersionForm && (
            <div className="rounded-lg bg-ink-50 p-3">
              <Field label="What changed?" required>
                {(props) => (
                  <Textarea
                    rows={2}
                    value={versionNote}
                    onChange={(event) => setVersionNote(event.target.value)}
                    placeholder="e.g. Incorporated counsel’s amendments to paragraph 14."
                    {...props}
                  />
                )}
              </Field>
              <div className="mt-2 flex justify-end gap-2">
                <Button size="sm" onClick={() => setShowVersionForm(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    if (!versionNote.trim()) return;
                    addDocumentVersion(doc.id, versionNote.trim(), user?.id ?? 'system');
                    setVersionNote('');
                    setShowVersionForm(false);
                    notify({ variant: 'success', title: 'Version saved' });
                  }}
                >
                  Save version
                </Button>
              </div>
            </div>
          )}

          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
              <History className="size-3.5" aria-hidden />
              Version history
            </p>
            <ol className="mt-2 space-y-2">
              {[...doc.versions].reverse().map((version) => (
                <li
                  key={version.version}
                  className={cn(
                    'rounded-lg px-2.5 py-2 text-[12px]',
                    version.version === doc.currentVersion
                      ? 'bg-brand-50 ring-1 ring-brand-100'
                      : 'bg-ink-50',
                  )}
                >
                  <p className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-ink-800">v{version.version}</span>
                    <span className="tnum text-[11px] text-ink-500">
                      {formatBytes(version.sizeBytes)}
                    </span>
                  </p>
                  <p className="mt-0.5 leading-snug text-ink-600">{version.changeNote}</p>
                  <p className="mt-0.5 text-[11px] text-ink-400">
                    {users.find((item) => item.id === version.uploadedById)?.fullName ?? 'System'} ·{' '}
                    {formatDateTime(version.uploadedAt)}
                  </p>
                </li>
              ))}
            </ol>
          </div>

          <div className="space-y-1.5 border-t border-ink-100 pt-3 text-[12px]">
            <p className="flex items-center gap-1.5 text-ink-600">
              <FileText className="size-3.5 text-ink-400" aria-hidden />
              {doc.format.toUpperCase()} · added by {author?.fullName ?? 'Unknown'}
            </p>
            <p className="flex items-center gap-1.5 text-ink-600">
              <ScanText className="size-3.5 text-ink-400" aria-hidden />
              OCR{' '}
              <Badge
                tone={
                  doc.ocrStatus === 'completed'
                    ? 'success'
                    : doc.ocrStatus === 'failed'
                      ? 'danger'
                      : 'neutral'
                }
                size="sm"
              >
                {doc.ocrStatus.replace('_', ' ')}
              </Badge>
            </p>
            {doc.ocrText && (
              <p className="mt-1 line-clamp-4 rounded bg-ink-50 p-2 text-[11px] leading-snug text-ink-500">
                “{doc.ocrText}”
              </p>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
