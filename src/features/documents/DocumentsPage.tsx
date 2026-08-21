import { useMemo, useState } from 'react';
import { FileText, FileWarning, HardDrive, Lock, ScanText, Search, Upload } from 'lucide-react';
import type { CaseDocument } from '@/types';
import { formatBytes, formatNumber, plural } from '@/lib/format';
import { useDataStore } from '@/store/dataStore';
import { useCan } from '@/store/authStore';
import { useVisibleCaseRows } from '@/hooks/useCaseData';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardBody } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FilterMenu } from '@/components/ui/FilterMenu';
import { InfoHint } from '@/components/ui/Tooltip';
import { DocumentList } from './DocumentList';
import { DocumentViewer } from './DocumentViewer';
import { PickMatterForUpload } from './PickMatterForUpload';

const FORMATS = ['pdf', 'docx', 'doc', 'xlsx', 'jpg', 'png', 'msg'];

function latestSize(doc: CaseDocument) {
  const current = doc.versions.find((version) => version.version === doc.currentVersion);
  return current?.sizeBytes ?? 0;
}

/** The document library (TOR §9–10) across every matter the viewer can see. */
export function DocumentsPage() {
  const documents = useDataStore((state) => state.documents);
  const documentTypes = useDataStore((state) => state.documentTypes);
  const settings = useDataStore((state) => state.settings);
  const rows = useVisibleCaseRows();
  const canUpload = useCan('document.upload');

  const [query, setQuery] = useState('');
  const [typeIds, setTypeIds] = useState<string[]>([]);
  const [formats, setFormats] = useState<string[]>([]);
  const [caseIds, setCaseIds] = useState<string[]>([]);
  const [flags, setFlags] = useState<string[]>([]);
  const [open, setOpen] = useState<CaseDocument | null>(null);
  const [uploading, setUploading] = useState(false);

  /** Only documents on matters the viewer can reach — the register is the gate. */
  const visible = useMemo(() => {
    const allowed = new Set(rows.map((row) => row.record.id));
    return documents.filter((doc) => allowed.has(doc.caseId));
  }, [documents, rows]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return visible
      .filter((doc) => {
        if (typeIds.length && !typeIds.includes(doc.documentTypeId)) return false;
        if (formats.length && !formats.includes(doc.format)) return false;
        if (caseIds.length && !caseIds.includes(doc.caseId)) return false;
        if (flags.includes('confidential') && !doc.confidential) return false;
        if (flags.includes('checked_out') && !doc.checkedOutById) return false;
        if (flags.includes('ocr_pending') && !['queued', 'processing', 'failed'].includes(doc.ocrStatus))
          return false;
        if (flags.includes('versioned') && doc.currentVersion < 2) return false;
        if (!needle) return true;
        // Full-text search reaches into extracted OCR text (TOR §10, §25).
        return (
          doc.name.toLowerCase().includes(needle) ||
          doc.description.toLowerCase().includes(needle) ||
          doc.tags.some((tag) => tag.toLowerCase().includes(needle)) ||
          (doc.ocrText?.toLowerCase().includes(needle) ?? false)
        );
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [visible, query, typeIds, formats, caseIds, flags]);

  const totalBytes = visible.reduce((sum, doc) => sum + latestSize(doc), 0);
  const awaitingOcr = visible.filter((doc) => ['queued', 'processing'].includes(doc.ocrStatus)).length;
  const checkedOut = visible.filter((doc) => doc.checkedOutById).length;
  const confidential = visible.filter((doc) => doc.confidential).length;
  const quotaUsed = settings.storageQuotaGb
    ? Math.round((settings.storageUsedGb / settings.storageQuotaGb) * 100)
    : 0;

  return (
    <div>
      <PageHeader
        title="Documents"
        hint="Every process, exhibit and letter filed on the matters you can see. Versions are kept in full."
        actions={
          canUpload && (
            <Button
              variant="primary"
              onClick={() => setUploading(true)}
              icon={<Upload className="size-4" aria-hidden />}
            >
              Upload a document
            </Button>
          )
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Documents held"
          value={formatNumber(visible.length)}
          hint={`${formatBytes(totalBytes)} across ${plural(rows.length, 'matter')}`}
          icon={<FileText className="size-4" aria-hidden />}
        />
        <StatCard
          label="Storage used"
          value={`${settings.storageUsedGb.toFixed(1)} GB`}
          hint={`${quotaUsed}% of the ${settings.storageQuotaGb} GB quota`}
          tone={quotaUsed > 85 ? 'danger' : 'default'}
          icon={<HardDrive className="size-4" aria-hidden />}
        />
        <StatCard
          label="Awaiting OCR"
          value={formatNumber(awaitingOcr)}
          hint="Scanned pages queued for text extraction"
          tone={awaitingOcr > 0 ? 'gold' : 'default'}
          icon={<ScanText className="size-4" aria-hidden />}
        />
        <StatCard
          label="Checked out"
          value={formatNumber(checkedOut)}
          hint="Locked for editing by a colleague"
          icon={<FileWarning className="size-4" aria-hidden />}
        />
      </div>

      <Card className="mt-4" flush>
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 p-3">
          <div className="min-w-56 flex-1">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search names, descriptions, tags and scanned text…"
              leading={<Search className="size-4" aria-hidden />}
              aria-label="Search documents"
            />
          </div>
          <FilterMenu
            label="Document type"
            searchable
            width="w-80"
            options={documentTypes.map((type) => ({
              value: type.id,
              label: type.name,
              count: visible.filter((doc) => doc.documentTypeId === type.id).length,
            }))}
            selected={typeIds}
            onChange={setTypeIds}
          />
          <FilterMenu
            label="Format"
            width="w-56"
            options={FORMATS.map((value) => ({
              value,
              label: value.toUpperCase(),
              count: visible.filter((doc) => doc.format === value).length,
            }))}
            selected={formats}
            onChange={setFormats}
          />
          <FilterMenu
            label="Matter"
            searchable
            width="w-96"
            options={rows.map((row) => ({
              value: row.record.id,
              label: `${row.record.caseId} — ${row.record.title}`,
              count: visible.filter((doc) => doc.caseId === row.record.id).length,
            }))}
            selected={caseIds}
            onChange={setCaseIds}
          />
          <FilterMenu
            label="Flags"
            width="w-64"
            options={[
              { value: 'confidential', label: 'Confidential', count: confidential },
              { value: 'checked_out', label: 'Checked out', count: checkedOut },
              { value: 'ocr_pending', label: 'OCR outstanding', count: awaitingOcr },
              {
                value: 'versioned',
                label: 'Has revisions',
                count: visible.filter((doc) => doc.currentVersion > 1).length,
              },
            ]}
            selected={flags}
            onChange={setFlags}
          />
        </div>

        <CardBody className="p-0">
          <div className="flex items-center justify-between px-3 py-2 text-[12px] text-ink-600">
            <span>
              Showing <span className="font-semibold text-ink-800">{filtered.length}</span> of{' '}
              {visible.length}
            </span>
            {confidential > 0 && (
              <span className="flex items-center gap-1.5">
                <Lock className="size-3.5 text-ink-400" aria-hidden />
                {plural(confidential, 'confidential file')}
                <InfoHint label="Downloading a confidential file stamps your name and the time onto every page, and writes the download to the audit trail." />
              </span>
            )}
          </div>
          <DocumentList
            documents={filtered}
            onOpen={setOpen}
            showCase
            emptyTitle="Nothing matches those filters"
            emptyDescription="Clear a filter or widen the search to see more of the library."
          />
        </CardBody>
      </Card>

      <DocumentViewer doc={open} onClose={() => setOpen(null)} />

      {uploading && <PickMatterForUpload rows={rows} onClose={() => setUploading(false)} />}
    </div>
  );
}
