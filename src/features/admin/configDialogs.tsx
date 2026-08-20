import { useEffect, useState } from 'react';
import type { CaseType, Court, CourtTier, DocumentType, TagDefinition } from '@/types';
import { makeId } from '@/lib/utils';
import { useDataStore } from '@/store/dataStore';
import { useCurrentUser } from '@/store/authStore';
import { notify } from '@/store/uiStore';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Input';

const COURT_TIERS: CourtTier[] = [
  'Supreme Court',
  'Court of Appeal',
  'Federal High Court',
  'National Industrial Court',
  'State High Court',
  'Magistrate Court',
  'Customary Court',
  'Tribunal',
  'Arbitration Panel',
];

const CASE_CATEGORIES: CaseType['category'][] = [
  'Civil',
  'Criminal',
  'Regulatory',
  'Employment',
  'Land',
  'Contract',
  'Environmental',
];

const DOCUMENT_GROUPS: DocumentType['group'][] = [
  'Court Process',
  'Draft',
  'Evidence',
  'Correspondence',
  'Judgment',
  'Internal',
];

export const TAG_COLOURS = ['brand', 'gold', 'danger', 'info', 'ink'] as const;

/** Shared footer so every configuration dialog behaves identically. */
function Actions({ onCancel, onSave, editing }: { onCancel: () => void; onSave: () => void; editing: boolean }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <Button onClick={onCancel}>Cancel</Button>
      <Button variant="primary" onClick={onSave}>
        {editing ? 'Save changes' : 'Add'}
      </Button>
    </div>
  );
}

export function CourtDialog({
  open,
  onClose,
  court,
}: {
  open: boolean;
  onClose: () => void;
  court?: Court | null;
}) {
  const upsertCourt = useDataStore((state) => state.upsertCourt);
  const actor = useCurrentUser();
  const [name, setName] = useState('');
  const [tier, setTier] = useState<CourtTier>('Federal High Court');
  const [division, setDivision] = useState('');
  const [state, setState] = useState('');
  const [address, setAddress] = useState('');
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    setName(court?.name ?? '');
    setTier(court?.tier ?? 'Federal High Court');
    setDivision(court?.division ?? '');
    setState(court?.state ?? 'Rivers');
    setAddress(court?.address ?? '');
    setActive(court?.active ?? true);
  }, [open, court]);

  const save = () => {
    if (name.trim().length < 4) return;
    upsertCourt(
      {
        id: court?.id ?? makeId('crt'),
        name: name.trim(),
        tier,
        division: division.trim() || state.trim(),
        state: state.trim() || 'Rivers',
        address: address.trim(),
        active,
      },
      actor?.id ?? 'system',
    );
    notify({ variant: 'success', title: court ? 'Court updated' : 'Court added', description: name.trim() });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={court ? `Amend ${court.name}` : 'Add a court'}
      description="Courts appear in the matter form, the diary and every court-based report."
      footer={<Actions onCancel={onClose} onSave={save} editing={Boolean(court)} />}
    >
      <div className="space-y-4">
        <Field label="Court name" required>
          {(props) => (
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Federal High Court, Port Harcourt"
              {...props}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tier" required>
            {(props) => (
              <Select value={tier} onChange={(event) => setTier(event.target.value as CourtTier)} {...props}>
                {COURT_TIERS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Judicial division">
            {(props) => (
              <Input value={division} onChange={(event) => setDivision(event.target.value)} {...props} />
            )}
          </Field>
          <Field label="State" required>
            {(props) => <Input value={state} onChange={(event) => setState(event.target.value)} {...props} />}
          </Field>
        </div>
        <Field label="Registry address">
          {(props) => (
            <Textarea rows={2} value={address} onChange={(event) => setAddress(event.target.value)} {...props} />
          )}
        </Field>
        <Checkbox
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
          label="Available for selection"
          description="Inactive courts stay on historic matters but cannot be chosen on new ones."
        />
      </div>
    </Modal>
  );
}

export function CaseTypeDialog({
  open,
  onClose,
  caseType,
}: {
  open: boolean;
  onClose: () => void;
  caseType?: CaseType | null;
}) {
  const upsertCaseType = useDataStore((state) => state.upsertCaseType);
  const actor = useCurrentUser();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<CaseType['category']>('Civil');
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    setName(caseType?.name ?? '');
    setDescription(caseType?.description ?? '');
    setCategory(caseType?.category ?? 'Civil');
    setActive(caseType?.active ?? true);
  }, [open, caseType]);

  const save = () => {
    if (name.trim().length < 3) return;
    upsertCaseType(
      {
        id: caseType?.id ?? makeId('cty'),
        name: name.trim(),
        description: description.trim(),
        category,
        active,
      },
      actor?.id ?? 'system',
    );
    notify({
      variant: 'success',
      title: caseType ? 'Case type updated' : 'Case type added',
      description: name.trim(),
    });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={caseType ? `Amend ${caseType.name}` : 'Add a case type'}
      footer={<Actions onCancel={onClose} onSave={save} editing={Boolean(caseType)} />}
    >
      <div className="space-y-4">
        <Field label="Case type" required>
          {(props) => (
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Environmental Remediation Claim"
              {...props}
            />
          )}
        </Field>
        <Field label="Category" required>
          {(props) => (
            <Select
              value={category}
              onChange={(event) => setCategory(event.target.value as CaseType['category'])}
              {...props}
            >
              {CASE_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Description" hint="Shown as guidance when a matter is registered.">
          {(props) => (
            <Textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              {...props}
            />
          )}
        </Field>
        <Checkbox
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
          label="Available for selection"
        />
      </div>
    </Modal>
  );
}

export function DocumentTypeDialog({
  open,
  onClose,
  documentType,
}: {
  open: boolean;
  onClose: () => void;
  documentType?: DocumentType | null;
}) {
  const upsertDocumentType = useDataStore((state) => state.upsertDocumentType);
  const actor = useCurrentUser();
  const [name, setName] = useState('');
  const [group, setGroup] = useState<DocumentType['group']>('Court Process');
  const [retentionYears, setRetentionYears] = useState('10');
  const [requiresConfidentiality, setRequiresConfidentiality] = useState(false);
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    setName(documentType?.name ?? '');
    setGroup(documentType?.group ?? 'Court Process');
    setRetentionYears(String(documentType?.retentionYears ?? 10));
    setRequiresConfidentiality(documentType?.requiresConfidentiality ?? false);
    setActive(documentType?.active ?? true);
  }, [open, documentType]);

  const save = () => {
    if (name.trim().length < 3) return;
    upsertDocumentType(
      {
        id: documentType?.id ?? makeId('dty'),
        name: name.trim(),
        group,
        retentionYears: Math.max(1, Number(retentionYears) || 10),
        requiresConfidentiality,
        active,
      },
      actor?.id ?? 'system',
    );
    notify({
      variant: 'success',
      title: documentType ? 'Document type updated' : 'Document type added',
      description: name.trim(),
    });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={documentType ? `Amend ${documentType.name}` : 'Add a document type'}
      footer={<Actions onCancel={onClose} onSave={save} editing={Boolean(documentType)} />}
    >
      <div className="space-y-4">
        <Field label="Document type" required>
          {(props) => (
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Statement of Claim"
              {...props}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Group" required>
            {(props) => (
              <Select
                value={group}
                onChange={(event) => setGroup(event.target.value as DocumentType['group'])}
                {...props}
              >
                {DOCUMENT_GROUPS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Retention (years)" required hint="Drives the retention schedule.">
            {(props) => (
              <Input
                type="number"
                min={1}
                max={50}
                value={retentionYears}
                onChange={(event) => setRetentionYears(event.target.value)}
                {...props}
              />
            )}
          </Field>
        </div>
        <Checkbox
          checked={requiresConfidentiality}
          onChange={(event) => setRequiresConfidentiality(event.target.checked)}
          label="Always confidential"
          description="Downloads are watermarked and restricted to the matter team."
        />
        <Checkbox
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
          label="Available for selection"
        />
      </div>
    </Modal>
  );
}

export function TagDialog({
  open,
  onClose,
  tag,
}: {
  open: boolean;
  onClose: () => void;
  tag?: TagDefinition | null;
}) {
  const upsertTag = useDataStore((state) => state.upsertTag);
  const actor = useCurrentUser();
  const [label, setLabel] = useState('');
  const [color, setColor] = useState<string>('brand');

  useEffect(() => {
    if (!open) return;
    setLabel(tag?.label ?? '');
    setColor(tag?.color ?? 'brand');
  }, [open, tag]);

  const save = () => {
    if (label.trim().length < 2) return;
    upsertTag(
      {
        id: tag?.id ?? makeId('tag'),
        label: label.trim(),
        color,
        usageCount: tag?.usageCount ?? 0,
      },
      actor?.id ?? 'system',
    );
    notify({ variant: 'success', title: tag ? 'Tag updated' : 'Tag added', description: label.trim() });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tag ? `Amend ${tag.label}` : 'Add a tag'}
      description="Tags are free labels used for filtering the register and reports."
      size="sm"
      footer={<Actions onCancel={onClose} onSave={save} editing={Boolean(tag)} />}
    >
      <div className="space-y-4">
        <Field label="Label" required>
          {(props) => (
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Ogoni Cluster"
              {...props}
            />
          )}
        </Field>
        <Field label="Colour">
          {(props) => (
            <Select value={color} onChange={(event) => setColor(event.target.value)} {...props}>
              {TAG_COLOURS.map((value) => (
                <option key={value} value={value}>
                  {value.charAt(0).toUpperCase() + value.slice(1)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </Modal>
  );
}
