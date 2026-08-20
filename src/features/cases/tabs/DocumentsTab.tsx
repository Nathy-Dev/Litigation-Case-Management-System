import { useMemo, useState } from 'react';
import { FileText, Upload } from 'lucide-react';
import type { CaseDocument, CaseRecord } from '@/types';
import { formatBytes } from '@/lib/format';
import { useCan } from '@/store/authStore';
import { useDataStore } from '@/store/dataStore';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FilterMenu } from '@/components/ui/FilterMenu';
import { DocumentList } from '@/features/documents/DocumentList';
import { DocumentViewer } from '@/features/documents/DocumentViewer';
import { UploadDocumentDialog } from '@/features/documents/UploadDocumentDialog';

export function DocumentsTab({ caseRecord }: { caseRecord: CaseRecord }) {
  const documents = useDataStore((state) => state.documents);
  const documentTypes = useDataStore((state) => state.documentTypes);
  const canUpload = useCan('document.upload');

  const [uploadOpen, setUploadOpen] = useState(false);
  const [viewing, setViewing] = useState<CaseDocument | null>(null);
  const [typeIds, setTypeIds] = useState<string[]>([]);

  const mine = useMemo(
    () =>
      documents
        .filter((doc) => doc.caseId === caseRecord.id)
        .filter((doc) => typeIds.length === 0 || typeIds.includes(doc.documentTypeId))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [documents, caseRecord.id, typeIds],
  );

  const totalBytes = mine.reduce(
    (sum, doc) => sum + (doc.versions[doc.versions.length - 1]?.sizeBytes ?? 0),
    0,
  );

  // Only offer the types that actually appear on this matter.
  const usedTypes = documentTypes.filter((type) =>
    documents.some((doc) => doc.caseId === caseRecord.id && doc.documentTypeId === type.id),
  );

  return (
    <>
      <Card flush>
        <CardHeader
          title="Documents"
          description={`${mine.length} ${mine.length === 1 ? 'file' : 'files'} · ${formatBytes(totalBytes)} · versioned, with check-out control`}
          icon={<FileText className="size-4" aria-hidden />}
          actions={
            <div className="flex items-center gap-2">
              {usedTypes.length > 1 && (
                <FilterMenu
                  label="Type"
                  align="right"
                  width="w-64"
                  options={usedTypes.map((type) => ({ value: type.id, label: type.name }))}
                  selected={typeIds}
                  onChange={setTypeIds}
                />
              )}
              {canUpload && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setUploadOpen(true)}
                  icon={<Upload className="size-4" aria-hidden />}
                >
                  Upload
                </Button>
              )}
            </div>
          }
          divided
        />
        <DocumentList
          documents={mine}
          onOpen={setViewing}
          emptyDescription={
            canUpload
              ? 'Upload the originating process, pleadings and exhibits to build the case bundle.'
              : 'Nothing has been filed against this matter yet.'
          }
        />
      </Card>

      <UploadDocumentDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        caseRecord={caseRecord}
      />
      <DocumentViewer doc={viewing} onClose={() => setViewing(null)} />
    </>
  );
}
