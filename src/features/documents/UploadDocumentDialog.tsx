import { useState } from 'react';
import type { CaseRecord, DocumentFormat } from '@/types';
import { useDataStore } from '@/store/dataStore';
import { useCurrentUser } from '@/store/authStore';
import { notify } from '@/store/uiStore';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea, Checkbox } from '@/components/ui/Input';
import { FileDropzone } from '@/components/ui/FileDropzone';
import { useDocumentFiles } from '@/hooks/useDocumentFiles';
import type { Id } from '../../../convex/_generated/dataModel';

const FORMAT_BY_EXTENSION: Record<string, DocumentFormat> = {
  pdf: 'pdf',
  doc: 'doc',
  docx: 'docx',
  jpg: 'jpg',
  jpeg: 'jpg',
  png: 'png',
  xls: 'xlsx',
  xlsx: 'xlsx',
  msg: 'msg',
  eml: 'msg',
};

/** Upload dialog for one matter (TOR §9). Files are described, not transferred. */
export function UploadDocumentDialog({
  open,
  onClose,
  caseRecord,
}: {
  open: boolean;
  onClose: () => void;
  caseRecord: CaseRecord;
}) {
  const documentTypes = useDataStore((state) => state.documentTypes);
  const { upload } = useDocumentFiles();
  const settings = useDataStore((state) => state.settings);
  const user = useCurrentUser();
  const [busy, setBusy] = useState(false);

  const [files, setFiles] = useState<File[]>([]);
  const [typeId, setTypeId] = useState(documentTypes[0]?.id ?? '');
  const [description, setDescription] = useState('');
  const [confidential, setConfidential] = useState(caseRecord.confidential);
  const [error, setError] = useState<string | undefined>();

  const chosenType = documentTypes.find((type) => type.id === typeId);

  const reset = () => {
    setFiles([]);
    setDescription('');
    setError(undefined);
  };

  const submit = async () => {
    if (files.length === 0) {
      setError('Choose at least one file.');
      return;
    }
    setBusy(true);
    try {
      for (const file of files) {
        const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
        const format = FORMAT_BY_EXTENSION[extension];
        if (!format) throw new Error('This file type is not supported.');
        await upload(file,
          {
            caseId: caseRecord.id as Id<'cases'>,
            name: file.name,
            documentTypeId: typeId as Id<'documentTypes'>,
            format,
            confidential: confidential || Boolean(chosenType?.requiresConfidentiality),
            description,
            tags: [],
          },
        );
        setFiles((remaining) => remaining.filter((candidate) => candidate !== file));
      }
      notify({
        variant: 'success',
        title: files.length === 1 ? 'Document filed' : `${files.length} documents filed`,
        description: settings.ocrEnabled
          ? 'Queued for text extraction so the contents become searchable.'
          : `Filed against ${caseRecord.caseId}.`,
      });
      reset();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Upload failed. Completed files are preserved; retry the remaining files.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Upload documents"
      description={`Filed against ${caseRecord.caseId} — ${caseRecord.title}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy || !user}>
            Upload {files.length > 0 ? `${files.length} file${files.length === 1 ? '' : 's'}` : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FileDropzone
          files={files}
          onChange={(next) => {
            setFiles(next);
            setError(undefined);
          }}
          hint="PDF, Word, Excel, images or Outlook messages · up to 50 MB each"
        />
        {error && (
          <p role="alert" className="text-[12px] font-medium text-danger-600">
            {error}
          </p>
        )}

        <Field label="Document type" required>
          {(props) => (
            <Select value={typeId} onChange={(event) => setTypeId(event.target.value)} {...props}>
              {documentTypes
                .filter((type) => type.active)
                .map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.group} · {type.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>

        <Field label="Description" hint="Shown in the document library and in search results.">
          {(props) => (
            <Textarea
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="e.g. Certified true copy of the ruling delivered on 12/06/2026."
              {...props}
            />
          )}
        </Field>

        <Field label="Retention" hint="Set by the document type and applied automatically.">
          {(props) => (
            <Input
              readOnly
              value={
                chosenType
                  ? `${chosenType.retentionYears} years from filing · archive after ${settings.retentionArchiveAfterYears} years`
                  : '—'
              }
              {...props}
            />
          )}
        </Field>

        <Checkbox
          checked={confidential || Boolean(chosenType?.requiresConfidentiality)}
          disabled={Boolean(chosenType?.requiresConfidentiality)}
          onChange={(event) => setConfidential(event.target.checked)}
          label="Mark as confidential"
          description={
            chosenType?.requiresConfidentiality
              ? 'This document type is always confidential.'
              : 'Downloads are watermarked with the recipient’s name and every view is audited.'
          }
        />
      </div>
    </Modal>
  );
}
