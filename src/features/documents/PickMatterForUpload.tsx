import { useState } from 'react';
import { format } from 'date-fns';
import type { CaseRow } from '@/lib/selectors/cases';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Select } from '@/components/ui/Input';
import { UploadDocumentDialog } from './UploadDocumentDialog';

/**
 * Uploading from the library needs a matter first — a document only exists on
 * a file, so the matter-scoped upload dialog is reused unchanged.
 */
export function PickMatterForUpload({
  rows,
  onClose,
}: {
  rows: CaseRow[];
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const [chosenId, setChosenId] = useState<string | null>(null);
  const open = rows.filter((row) => !row.record.archivedAt);
  const chosen = open.find((row) => row.record.id === chosenId);

  if (chosen) {
    return <UploadDocumentDialog open onClose={onClose} caseRecord={chosen.record} />;
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Which matter is this document for?"
      description="Documents are filed against a matter so they appear on its file and in its audit trail."
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!value} onClick={() => setChosenId(value)}>
            Continue
          </Button>
        </div>
      }
    >
      <Field label="Matter" required>
        {(props) => (
          <Select value={value} onChange={(event) => setValue(event.target.value)} {...props}>
            <option value="">Select a matter…</option>
            {open.map((row) => (
              <option key={row.record.id} value={row.record.id}>
                {row.record.caseId} — {row.record.title}
                {row.nextHearing ? ` (next sitting ${format(new Date(row.nextHearing.startsAt), 'd MMM')})` : ''}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </Modal>
  );
}
