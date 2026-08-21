import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Building2,
  FileType2,
  FolderTree,
  Pencil,
  Plus,
  Tags,
  Trash2,
  Workflow,
} from 'lucide-react';
import type { CaseType, Court, DocumentType, TagDefinition } from '@/types';
import { CASE_STATUSES } from '@/types';
import { formatNumber, plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDataStore } from '@/store/dataStore';
import { useCan, useCurrentUser } from '@/store/authStore';
import { notify } from '@/store/uiStore';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/Modal';
import { TabPanel, Tabs } from '@/components/ui/Tabs';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { CaseTypeDialog, CourtDialog, DocumentTypeDialog, TagDialog } from './configDialogs';

type Section = 'courts' | 'case-types' | 'document-types' | 'tags' | 'status-flow';

const TAG_TONE: Record<string, 'brand' | 'gold' | 'danger' | 'info' | 'neutral'> = {
  brand: 'brand',
  gold: 'gold',
  danger: 'danger',
  info: 'info',
  ink: 'neutral',
};

/** A single row in any of the configuration lists. */
function Row({
  title,
  subtitle,
  meta,
  active,
  onEdit,
  onDelete,
  canEdit,
}: {
  title: string;
  subtitle: string;
  meta?: React.ReactNode;
  active: boolean;
  onEdit: () => void;
  onDelete?: () => void;
  canEdit: boolean;
}) {
  return (
    <li className="flex items-center gap-3 border-b border-ink-100 px-4 py-2.5 last:border-b-0 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-[13px] font-semibold text-ink-900">
          {title}
          {!active && (
            <Badge tone="neutral" size="sm">
              Inactive
            </Badge>
          )}
        </p>
        <p className="truncate text-[11px] text-ink-500">{subtitle}</p>
      </div>
      {meta}
      {canEdit && (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={onEdit}
            icon={<Pencil className="size-4" aria-hidden />}
            aria-label={`Amend ${title}`}
          />
          {onDelete && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onDelete}
              icon={<Trash2 className="size-4 text-danger-600" aria-hidden />}
              aria-label={`Delete ${title}`}
            />
          )}
        </div>
      )}
    </li>
  );
}

/** Configurable reference data and the case status flow (TOR §31–33). */
export function AdminConfigPage() {
  const courts = useDataStore((state) => state.courts);
  const caseTypes = useDataStore((state) => state.caseTypes);
  const documentTypes = useDataStore((state) => state.documentTypes);
  const tags = useDataStore((state) => state.tags);
  const cases = useDataStore((state) => state.cases);
  const documents = useDataStore((state) => state.documents);
  const deleteTag = useDataStore((state) => state.deleteTag);
  const actor = useCurrentUser();
  const canManage = useCan('config.manage');

  const [section, setSection] = useState<Section>('courts');
  const [query, setQuery] = useState('');
  const [court, setCourt] = useState<Court | null>(null);
  const [courtOpen, setCourtOpen] = useState(false);
  const [caseType, setCaseType] = useState<CaseType | null>(null);
  const [caseTypeOpen, setCaseTypeOpen] = useState(false);
  const [documentType, setDocumentType] = useState<DocumentType | null>(null);
  const [documentTypeOpen, setDocumentTypeOpen] = useState(false);
  const [tag, setTag] = useState<TagDefinition | null>(null);
  const [tagOpen, setTagOpen] = useState(false);
  const [deleting, setDeleting] = useState<TagDefinition | null>(null);

  const needle = query.trim().toLowerCase();
  const match = (value: string) => (needle ? value.toLowerCase().includes(needle) : true);

  /** Tag usage is derived from the register, never stored. */
  const tagUsage = useMemo(() => {
    const counts = new Map<string, number>();
    cases.forEach((record) =>
      record.tags.forEach((label) => counts.set(label, (counts.get(label) ?? 0) + 1)),
    );
    documents.forEach((doc) =>
      doc.tags.forEach((label) => counts.set(label, (counts.get(label) ?? 0) + 1)),
    );
    return counts;
  }, [cases, documents]);

  const items = [
    { id: 'courts', label: 'Courts', count: courts.length, icon: <Building2 className="size-4" aria-hidden /> },
    { id: 'case-types', label: 'Case types', count: caseTypes.length, icon: <FolderTree className="size-4" aria-hidden /> },
    {
      id: 'document-types',
      label: 'Document types',
      count: documentTypes.length,
      icon: <FileType2 className="size-4" aria-hidden />,
    },
    { id: 'tags', label: 'Tags', count: tags.length, icon: <Tags className="size-4" aria-hidden /> },
    { id: 'status-flow', label: 'Status flow', icon: <Workflow className="size-4" aria-hidden /> },
  ];

  const addLabel: Record<Section, string> = {
    courts: 'Add court',
    'case-types': 'Add case type',
    'document-types': 'Add document type',
    tags: 'Add tag',
    'status-flow': '',
  };

  const add = () => {
    if (section === 'courts') {
      setCourt(null);
      setCourtOpen(true);
    } else if (section === 'case-types') {
      setCaseType(null);
      setCaseTypeOpen(true);
    } else if (section === 'document-types') {
      setDocumentType(null);
      setDocumentTypeOpen(true);
    } else if (section === 'tags') {
      setTag(null);
      setTagOpen(true);
    }
  };

  return (
    <div className="space-y-4">
      <Card flush>
        <CardHeader
          title="Configuration"
          hint="Reference data used across the register, the diary and the document library."
          actions={
            canManage &&
            section !== 'status-flow' && (
              <Button
                size="sm"
                variant="primary"
                onClick={add}
                icon={<Plus className="size-4" aria-hidden />}
              >
                {addLabel[section]}
              </Button>
            )
          }
        />
        <div className="border-t border-ink-200 px-3">
          <Tabs
            items={items}
            active={section}
            idBase="admin-config"
            onChange={(id) => setSection(id as Section)}
            label="Configuration sections"
          />
        </div>

        <TabPanel idBase="admin-config" tab={section}>
        {section !== 'status-flow' && (
          <CardBody className="border-b border-ink-200">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search this list"
              sizing="sm"
              aria-label="Search configuration"
            />
          </CardBody>
        )}

        {section === 'courts' && (
          <ul>
            {courts
              .filter((item) => match(item.name) || match(item.state) || match(item.tier))
              .map((item) => (
                <Row
                  key={item.id}
                  title={item.name}
                  subtitle={`${item.tier} · ${item.division} Division · ${item.state} State`}
                  active={item.active}
                  canEdit={canManage}
                  onEdit={() => {
                    setCourt(item);
                    setCourtOpen(true);
                  }}
                  meta={
                    <Badge tone="neutral" size="sm">
                      {plural(cases.filter((record) => record.courtId === item.id).length, 'matter')}
                    </Badge>
                  }
                />
              ))}
          </ul>
        )}

        {section === 'case-types' && (
          <ul>
            {caseTypes
              .filter((item) => match(item.name) || match(item.category))
              .map((item) => (
                <Row
                  key={item.id}
                  title={item.name}
                  subtitle={item.description || item.category}
                  active={item.active}
                  canEdit={canManage}
                  onEdit={() => {
                    setCaseType(item);
                    setCaseTypeOpen(true);
                  }}
                  meta={
                    <Badge tone="brand" size="sm">
                      {item.category}
                    </Badge>
                  }
                />
              ))}
          </ul>
        )}

        {section === 'document-types' && (
          <ul>
            {documentTypes
              .filter((item) => match(item.name) || match(item.group))
              .map((item) => (
                <Row
                  key={item.id}
                  title={item.name}
                  subtitle={`${item.group} · retained ${item.retentionYears} years`}
                  active={item.active}
                  canEdit={canManage}
                  onEdit={() => {
                    setDocumentType(item);
                    setDocumentTypeOpen(true);
                  }}
                  meta={
                    item.requiresConfidentiality ? (
                      <Badge tone="danger" size="sm">
                        Confidential
                      </Badge>
                    ) : undefined
                  }
                />
              ))}
          </ul>
        )}

        {section === 'tags' && (
          <ul>
            {tags
              .filter((item) => match(item.label))
              .map((item) => {
                const used = tagUsage.get(item.label) ?? 0;
                return (
                  <Row
                    key={item.id}
                    title={item.label}
                    subtitle={used ? `Applied to ${formatNumber(used)} record(s)` : 'Not yet applied'}
                    active
                    canEdit={canManage}
                    onEdit={() => {
                      setTag(item);
                      setTagOpen(true);
                    }}
                    onDelete={() => setDeleting(item)}
                    meta={
                      <Badge tone={TAG_TONE[item.color] ?? 'neutral'} size="sm">
                        {item.color}
                      </Badge>
                    }
                  />
                );
              })}
            {tags.length === 0 && (
              <EmptyState
                icon={<Tags className="size-5" aria-hidden />}
                title="No tags defined"
                description="Tags let the unit group matters outside the formal case type."
                compact
              />
            )}
          </ul>
        )}

        {section === 'status-flow' && (
          <CardBody className="space-y-3">
            <p className="text-[13px] text-ink-700">
              A matter moves left to right. Any status may also jump straight to{' '}
              <span className="font-semibold">Closed</span> where a matter is withdrawn or struck out.
            </p>
            <ol className="flex flex-wrap items-center gap-1.5">
              {CASE_STATUSES.map((status, index) => (
                <li key={status} className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold',
                      index === 0 && 'border-ink-300 bg-ink-50 text-ink-700',
                      index > 0 && index < CASE_STATUSES.length - 2 && 'border-brand-300 bg-brand-50 text-brand-900',
                      index >= CASE_STATUSES.length - 2 && 'border-ink-300 bg-white text-ink-600',
                    )}
                  >
                    {status}
                  </span>
                  {index < CASE_STATUSES.length - 1 && (
                    <ArrowRight className="size-3.5 text-ink-400" aria-hidden />
                  )}
                </li>
              ))}
            </ol>
            <div className="rounded-lg border border-ink-200 bg-ink-50/70 p-3 text-[12px] text-ink-700">
              <p className="font-semibold text-ink-900">Rules applied by the system</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li>A matter cannot leave <span className="font-semibold">Draft</span> without a court and a matter owner.</li>
                <li><span className="font-semibold">Adjourned</span> is set automatically when a sitting outcome is recorded as adjourned.</li>
                <li><span className="font-semibold">Concluded</span> requires a recorded judgment or terms of settlement on file.</li>
                <li><span className="font-semibold">Archived</span> is applied by the retention schedule, not by hand.</li>
              </ul>
            </div>
          </CardBody>
        )}
        </TabPanel>
      </Card>

      <CourtDialog open={courtOpen} onClose={() => setCourtOpen(false)} court={court} />
      <CaseTypeDialog open={caseTypeOpen} onClose={() => setCaseTypeOpen(false)} caseType={caseType} />
      <DocumentTypeDialog
        open={documentTypeOpen}
        onClose={() => setDocumentTypeOpen(false)}
        documentType={documentType}
      />
      <TagDialog open={tagOpen} onClose={() => setTagOpen(false)} tag={tag} />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete this tag?"
        destructive
        message={
          deleting
            ? `“${deleting.label}” will be removed from the tag list. Records already carrying it keep the label until it is edited off.`
            : ''
        }
        confirmLabel="Delete tag"
        onConfirm={() => {
          if (!deleting) return;
          deleteTag(deleting.id, actor?.id ?? 'system');
          notify({ variant: 'success', title: 'Tag deleted', description: deleting.label });
          setDeleting(null);
        }}
      />
    </div>
  );
}
