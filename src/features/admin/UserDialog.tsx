import { useEffect, useState } from 'react';
import type { Role, StaffTitle, User } from '@/types';
import { ROLES } from '@/types';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/permissions';
import { makeId } from '@/lib/utils';
import { useDataStore } from '@/store/dataStore';
import { useCurrentUser } from '@/store/authStore';
import { notify } from '@/store/uiStore';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Input, Select } from '@/components/ui/Input';

const STATUSES: User['status'][] = ['active', 'invited', 'disabled', 'locked'];

const TITLES: StaffTitle[] = [
  'Director of Legal Services',
  'Head, Legal Unit',
  'Senior Lawyer',
  'Lawyer',
  'Paralegal',
  'Case Officer',
  'Legal Clerk',
  'Principal Partner',
  'Associate Counsel',
  'System Administrator',
  'Stakeholder',
];

/** The designation a newly created account of each role should default to. */
const DEFAULT_TITLE: Record<Role, StaffTitle> = {
  SUPER_ADMIN: 'System Administrator',
  ADMIN: 'Head, Legal Unit',
  LEGAL_STAFF: 'Lawyer',
  CASE_OFFICER: 'Case Officer',
  EXTERNAL_COUNSEL: 'Associate Counsel',
  READ_ONLY: 'Stakeholder',
};

function initialsOf(fullName: string) {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** Create or amend an account (TOR §27–28). */
export function UserDialog({
  open,
  onClose,
  user: editing,
}: {
  open: boolean;
  onClose: () => void;
  user?: User | null;
}) {
  const teams = useDataStore((state) => state.teams);
  const upsertUser = useDataStore((state) => state.upsertUser);
  const actor = useCurrentUser();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('LEGAL_STAFF');
  const [status, setStatus] = useState<User['status']>('invited');
  const [title, setTitle] = useState<StaffTitle>('Lawyer');
  const [department, setDepartment] = useState('');
  const [teamId, setTeamId] = useState('');
  const [firm, setFirm] = useState('');
  const [licence, setLicence] = useState('');
  const [mfaEnabled, setMfaEnabled] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setFullName(editing?.fullName ?? '');
    setEmail(editing?.email ?? '');
    setRole(editing?.role ?? 'LEGAL_STAFF');
    setStatus(editing?.status ?? 'invited');
    setTitle(editing?.title ?? DEFAULT_TITLE[editing?.role ?? 'LEGAL_STAFF']);
    setDepartment(editing?.department ?? 'Legal Unit');
    setTeamId(editing?.teamId ?? '');
    setFirm(editing?.firm ?? '');
    setLicence(editing?.practisingLicenceNo ?? '');
    setMfaEnabled(editing?.mfaEnabled ?? true);
    setError('');
  }, [open, editing]);

  const submit = () => {
    if (fullName.trim().length < 3) return setError('Enter the person’s full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return setError('Enter a valid official e-mail address.');

    const record: User = {
      id: editing?.id ?? makeId('usr'),
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      initials: initialsOf(fullName),
      avatarColor: editing?.avatarColor ?? 'brand',
      role,
      status,
      title,
      department: department.trim() || 'Legal Unit',
      teamId: teamId || null,
      firm: firm.trim() || null,
      practisingLicenceNo: licence.trim() || null,
      mfaEnabled,
      phone: editing?.phone ?? '',
      lastLoginAt: editing?.lastLoginAt ?? null,
      failedLoginAttempts: editing?.failedLoginAttempts ?? 0,
      createdAt: editing?.createdAt ?? new Date().toISOString(),
    };

    upsertUser(record, actor?.id ?? 'system');
    notify({
      variant: 'success',
      title: editing ? 'Account updated' : 'Account created',
      description: editing
        ? `${record.fullName}’s details have been saved.`
        : `An invitation will be sent to ${record.email}.`,
    });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Amend ${editing.fullName}` : 'Add a user'}
      description={ROLE_DESCRIPTIONS[role]}
      size="lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>
            {editing ? 'Save changes' : 'Create account'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] font-medium text-danger-700">
            {error}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required>
            {(props) => (
              <Input
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Barr. Ifeoma Nwachukwu"
                {...props}
              />
            )}
          </Field>
          <Field label="Official e-mail" required>
            {(props) => (
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="i.nwachukwu@hyprep.gov.ng"
                {...props}
              />
            )}
          </Field>
          <Field label="Role" required hint="Drives every permission check.">
            {(props) => (
              <Select
                value={role}
                onChange={(event) => {
                  const next = event.target.value as Role;
                  setRole(next);
                  if (!editing) setTitle(DEFAULT_TITLE[next]);
                }}
                {...props}
              >
                {ROLES.map((value) => (
                  <option key={value} value={value}>
                    {ROLE_LABELS[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Account status" required>
            {(props) => (
              <Select
                value={status}
                onChange={(event) => setStatus(event.target.value as User['status'])}
                {...props}
              >
                {STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {value.charAt(0).toUpperCase() + value.slice(1)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Designation" required>
            {(props) => (
              <Select
                value={title}
                onChange={(event) => setTitle(event.target.value as StaffTitle)}
                {...props}
              >
                {TITLES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Department">
            {(props) => (
              <Input value={department} onChange={(event) => setDepartment(event.target.value)} {...props} />
            )}
          </Field>
          <Field label="Team">
            {(props) => (
              <Select value={teamId} onChange={(event) => setTeamId(event.target.value)} {...props}>
                <option value="">No team</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Practising licence no." hint="Required for counsel of record.">
            {(props) => (
              <Input value={licence} onChange={(event) => setLicence(event.target.value)} {...props} />
            )}
          </Field>
        </div>

        {role === 'EXTERNAL_COUNSEL' && (
          <Field label="Law firm" hint="External counsel see only the matters they are briefed on.">
            {(props) => (
              <Input
                value={firm}
                onChange={(event) => setFirm(event.target.value)}
                placeholder="Chidi & Associates"
                {...props}
              />
            )}
          </Field>
        )}

        <Checkbox
          checked={mfaEnabled}
          onChange={(event) => setMfaEnabled(event.target.checked)}
          label="Require multi-factor authentication"
          description="Mandatory for administrators under the security requirements (§30)."
        />
      </div>
    </Modal>
  );
}
