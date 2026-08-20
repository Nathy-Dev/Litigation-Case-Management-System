import { useState } from 'react';
import type { CaseRecord, CaseStatus } from '@/types';
import { CASE_STATUSES } from '@/types';
import { useDataStore } from '@/store/dataStore';
import { useCurrentUser } from '@/store/authStore';
import { notify } from '@/store/uiStore';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Select, Textarea } from '@/components/ui/Input';
import { StatusBadge } from '@/components/ui/Badge';

/**
 * Status transitions are audited, so the reason is mandatory (TOR §7). The
 * configured flow is advisory here — the demo lets an admin move to any status
 * and records the jump, which mirrors how the Legal Unit actually works.
 */
export function StatusChangeDialog({
  open,
  onClose,
  record,
  allowedNext,
}: {
  open: boolean;
  onClose: () => void;
  record: CaseRecord;
  allowedNext?: CaseStatus[];
}) {
  const changeCaseStatus = useDataStore((state) => state.changeCaseStatus);
  const user = useCurrentUser();
  const options = (allowedNext?.length ? allowedNext : [...CASE_STATUSES]).filter(
    (status) => status !== record.status,
  );

  const [status, setStatus] = useState<CaseStatus>(options[0] ?? record.status);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();

  const submit = () => {
    if (reason.trim().length < 5) {
      setError('Give a short reason — it is written to the audit trail.');
      return;
    }
    changeCaseStatus(record.id, status, reason.trim(), user?.id ?? 'system');
    notify({
      variant: 'success',
      title: 'Status updated',
      description: `${record.caseId} moved to ${status}.`,
    });
    setReason('');
    setError(undefined);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change case status"
      description={
        <span className="inline-flex items-center gap-1.5">
          Currently <StatusBadge status={record.status} size="sm" /> · {record.caseId}
        </span>
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>
            Update status
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="New status" required>
          {(props) => (
            <Select
              value={status}
              onChange={(event) => setStatus(event.target.value as CaseStatus)}
              {...props}
            >
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Reason"
          required
          error={error}
          hint="Recorded against your name, with a timestamp and IP address."
        >
          {(props) => (
            <Textarea
              rows={3}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setError(undefined);
              }}
              placeholder="e.g. Matter adjourned to 14/09/2026 for adoption of written addresses."
              {...props}
            />
          )}
        </Field>
      </div>
    </Modal>
  );
}
