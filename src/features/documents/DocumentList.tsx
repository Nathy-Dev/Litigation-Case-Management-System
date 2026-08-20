import { Fragment } from 'react';
import { FileText, Image, Lock, Mail, ScanText, Sheet } from 'lucide-react';
import type { CaseDocument, DocumentFormat } from '@/types';
import { formatBytes, formatDateTime, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDataStore } from '@/store/dataStore';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Avatar } from '@/components/ui/Avatar';

const FORMAT_ICON: Record<DocumentFormat, typeof FileText> = {
  pdf: FileText,
  doc: FileText,
  docx: FileText,
  jpg: Image,
  png: Image,
  xlsx: Sheet,
  msg: Mail,
};

const FORMAT_TINT: Record<DocumentFormat, string> = {
  pdf: 'bg-danger-50 text-danger-600',
  doc: 'bg-info-50 text-info-600',
  docx: 'bg-info-50 text-info-600',
  jpg: 'bg-gold-50 text-gold-700',
  png: 'bg-gold-50 text-gold-700',
  xlsx: 'bg-brand-50 text-brand-700',
  msg: 'bg-ink-100 text-ink-600',
};

/** Shared document rows — used by the case Documents tab and the library. */
export function DocumentList({
  documents,
  onOpen,
  showCase = false,
  emptyTitle = 'No documents filed',
  emptyDescription = 'Uploaded court processes, evidence and correspondence will appear here.',
}: {
  documents: CaseDocument[];
  onOpen: (doc: CaseDocument) => void;
  showCase?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const users = useDataStore((state) => state.users);
  const documentTypes = useDataStore((state) => state.documentTypes);
  const cases = useDataStore((state) => state.cases);

  if (documents.length === 0) {
    return (
      <EmptyState
        icon={<FileText className="size-6" aria-hidden />}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  return (
    <ul className="divide-y divide-ink-100">
      {documents.map((doc) => {
        const Icon = FORMAT_ICON[doc.format] ?? FileText;
        const type = documentTypes.find((item) => item.id === doc.documentTypeId);
        const author = users.find((item) => item.id === doc.authorId);
        const holder = doc.checkedOutById
          ? users.find((item) => item.id === doc.checkedOutById)
          : undefined;
        const matter = showCase ? cases.find((item) => item.id === doc.caseId) : undefined;

        return (
          <li key={doc.id}>
            <button
              type="button"
              onClick={() => onOpen(doc)}
              className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-50"
            >
              <span
                className={cn(
                  'mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg',
                  FORMAT_TINT[doc.format] ?? 'bg-ink-100 text-ink-600',
                )}
              >
                <Icon className="size-4.5" aria-hidden />
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium text-ink-900">{doc.name}</span>
                  {doc.confidential && (
                    <Lock className="size-3 shrink-0 text-gold-600" aria-label="Confidential" />
                  )}
                  {doc.currentVersion > 1 && (
                    <Badge tone="neutral" size="sm">
                      v{doc.currentVersion}
                    </Badge>
                  )}
                  {doc.ocrStatus === 'completed' && (
                    <span
                      className="inline-flex items-center gap-0.5 text-[10px] text-brand-700"
                      title="Text extracted — searchable"
                    >
                      <ScanText className="size-3" aria-hidden />
                      OCR
                    </span>
                  )}
                </span>

                {doc.description && (
                  <span className="mt-0.5 block truncate text-[12px] text-ink-500">
                    {doc.description}
                  </span>
                )}

                <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-ink-500">
                  {matter && (
                    <Fragment>
                      <span className="font-mono text-brand-700">{matter.caseId}</span>
                      <span aria-hidden>·</span>
                    </Fragment>
                  )}
                  <span>{type?.name ?? 'Document'}</span>
                  <span aria-hidden>·</span>
                  <span className="tnum">
                    {formatBytes(doc.versions[doc.versions.length - 1]?.sizeBytes ?? 0)}
                  </span>
                  <span aria-hidden>·</span>
                  <span title={formatDateTime(doc.updatedAt)}>{formatRelative(doc.updatedAt)}</span>
                </span>

                {holder && (
                  <span className="mt-1 inline-flex items-center gap-1 rounded bg-gold-50 px-1.5 py-0.5 text-[10px] font-medium text-gold-800">
                    <Lock className="size-2.5" aria-hidden />
                    Checked out by {holder.fullName}
                  </span>
                )}
              </span>

              {author && <Avatar user={author} size="xs" className="mt-1 hidden sm:block" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
