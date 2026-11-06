import { useEffect, useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { Download, History, Lock, LockOpen, Upload } from 'lucide-react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import type { CaseDocument } from '@/types';
import { formatBytes, formatDateTime } from '@/lib/format';
import { useCurrentUser, useCan } from '@/store/authStore';
import { useDocumentFiles } from '@/hooks/useDocumentFiles';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Textarea } from '@/components/ui/Input';

export function DocumentViewer({ doc, onClose }: { doc: CaseDocument | null; onClose: () => void }) {
  const user = useCurrentUser();
  const canEdit = useCan('document.version.manage');
  const canDownload = useCan('document.download');
  const [versionNote, setVersionNote] = useState('');
  const [replacement, setReplacement] = useState<File | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { replace } = useDocumentFiles();
  const downloadFile = useAction(api.documents.downloadFile);
  const toggleCheckOut = useMutation(api.documents.toggleCheckOut);
  const current = useQuery(api.documents.get, doc ? { id: doc.id as Id<'documents'> } : 'skip');
  const documentRecord = current === undefined ? doc : current;
  const previewId = documentRecord?.id;
  const previewConfidential = documentRecord?.confidential;
  const previewFormat = documentRecord?.format;
  const previewVersion = documentRecord?.currentVersion;
  const getPreview = useMutation(api.documents.getPreviewUrl);
  const [preview, setPreview] = useState<{ url: string } | null>(null);
  const [previewError, setPreviewError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setPreviewError('');
    if (previewId && !previewConfidential && previewFormat && ['pdf', 'png', 'jpg'].includes(previewFormat)) {
      void getPreview({ id: previewId as Id<'documents'>, version: selectedVersion }).then((file) => { if (!cancelled) setPreview(file); }).catch((failure) => { if (!cancelled) setPreviewError(failure instanceof Error ? failure.message : 'Preview unavailable.'); });
    }
    return () => { cancelled = true; };
  }, [previewId, previewConfidential, previewFormat, previewVersion, selectedVersion, getPreview]);
  if (!documentRecord) return null;
  const lockedByMe = documentRecord.checkedOutById === user?.id;
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try { await operation(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'The operation failed. Please retry.'); }
    finally { setBusy(false); }
  };
  const download = () => run(async () => {
    const file = await downloadFile({ id: documentRecord.id as Id<'documents'>, version: selectedVersion });
    const response = await fetch(file.url);
    if (!response.ok) throw new Error('Download failed.');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return (
    <Modal open onClose={onClose} size="xl" title={documentRecord.name} footer={
      <>
        {canEdit && <Button disabled={busy || Boolean(documentRecord.checkedOutById && !lockedByMe)} onClick={() => run(() => toggleCheckOut({ id: documentRecord.id as Id<'documents'> }))} icon={lockedByMe ? <LockOpen className="size-4" /> : <Lock className="size-4" />}>{lockedByMe ? 'Check in' : 'Check out'}</Button>}
        {canDownload && <Button variant="primary" disabled={busy} onClick={download} icon={<Download className="size-4" />}>Download selected version</Button>}
      </>
    }>
      {error && <p role="alert" className="mb-3 text-danger-600">{error}</p>}
      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <div>
          {documentRecord.confidential ? <p>Preview is restricted. Use Download for an approved, watermarked PDF copy.</p> : previewError ? <p role="alert">{previewError}</p> : preview ? documentRecord.format === 'pdf' ? <iframe title={documentRecord.name} src={preview.url} className="h-[32rem] w-full rounded border" sandbox="allow-same-origin" referrerPolicy="no-referrer" /> : <img src={preview.url} alt={documentRecord.name} className="max-h-[32rem] w-full object-contain" /> : ['pdf', 'png', 'jpg'].includes(documentRecord.format) ? <p>Loading file...</p> : <p>This format opens in its desktop application. Use Download selected version.</p>}
        </div>
        <div className="space-y-4">
          <p className="flex gap-2 font-semibold"><History className="size-4" />Version history</p>
          {[...documentRecord.versions].reverse().map((version) => <button key={version.version} className="block w-full rounded bg-ink-50 p-3 text-left text-sm" onClick={() => setSelectedVersion(version.version)} aria-pressed={(selectedVersion ?? documentRecord.currentVersion) === version.version}><strong>v{version.version}</strong> - {formatBytes(version.sizeBytes)}<p>{version.changeNote}</p><p>{formatDateTime(version.uploadedAt)}</p></button>)}
          {canEdit && <div className="space-y-3">
            <Field label="Replacement file">{(props) => <input type="file" accept=".pdf,.doc,.docx,.xlsx,.png,.jpg,.jpeg,.msg,.eml" onChange={(event) => setReplacement(event.target.files?.[0] ?? null)} {...props} />}</Field>
            <Field label="What changed?">{(props) => <Textarea value={versionNote} onChange={(event) => setVersionNote(event.target.value)} {...props} />}</Field>
            <Button variant="primary" disabled={busy || !replacement || !versionNote.trim()} icon={<Upload className="size-4" />} onClick={() => run(async () => {
              if (!replacement) return;
              await replace(documentRecord.id, replacement, versionNote.trim());
              setReplacement(null);
              setVersionNote('');
              setSelectedVersion(undefined);
            })}>Save replacement version</Button>
          </div>}
        </div>
      </div>
    </Modal>
  );
}
