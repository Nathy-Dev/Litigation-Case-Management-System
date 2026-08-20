import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Upload } from 'lucide-react';
import type { Role, StaffTitle, User } from '@/types';
import { ROLES } from '@/types';
import { ROLE_LABELS } from '@/lib/permissions';
import { makeId } from '@/lib/utils';
import { useDataStore } from '@/store/dataStore';
import { useCurrentUser } from '@/store/authStore';
import { notify } from '@/store/uiStore';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, Textarea } from '@/components/ui/Input';

const TEMPLATE = [
  'full_name,email,role,designation,department',
  'Barr. Amaka Obi,a.obi@hyprep.gov.ng,LEGAL_STAFF,Senior Lawyer,Legal Unit',
  'Tunde Bakare,t.bakare@hyprep.gov.ng,CASE_OFFICER,Case Officer,Legal Unit',
  'Chidi Eze,chidi@chidiassociates.ng,EXTERNAL_COUNSEL,Associate Counsel,External',
].join('\n');

const TITLES = new Set<string>([
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
]);

interface ParsedRow {
  line: number;
  raw: string;
  user: User | null;
  problem: string | null;
}

function initialsOf(fullName: string) {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Splits one CSV line, honouring double-quoted fields so a designation such as
 * "Head, Legal Unit" survives the comma.
 */
function splitLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseCsv(text: string, existing: User[]): ParsedRow[] {
  const seen = new Set(existing.map((user) => user.email.toLowerCase()));
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length && /full[_ ]?name/i.test(lines[0]!)) lines.shift();

  return lines.map((raw, index) => {
    const line = index + 1;
    const [fullName = '', email = '', role = '', designation = '', department = ''] = splitLine(raw);
    const reject = (problem: string): ParsedRow => ({ line, raw, user: null, problem });

    if (fullName.length < 3) return reject('Full name is missing or too short.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reject(`“${email}” is not a valid e-mail.`);
    if (seen.has(email.toLowerCase())) return reject(`${email} is already on the system.`);
    if (!ROLES.includes(role as Role)) return reject(`“${role}” is not a known role.`);
    if (designation && !TITLES.has(designation)) return reject(`“${designation}” is not a known designation.`);

    seen.add(email.toLowerCase());
    return {
      line,
      raw,
      problem: null,
      user: {
        id: makeId('usr'),
        fullName,
        email: email.toLowerCase(),
        phone: '',
        title: (designation || 'Lawyer') as StaffTitle,
        role: role as Role,
        department: department || 'Legal Unit',
        teamId: null,
        practisingLicenceNo: null,
        firm: null,
        avatarColor: 'brand',
        initials: initialsOf(fullName),
        status: 'invited',
        mfaEnabled: role === 'ADMIN' || role === 'SUPER_ADMIN',
        failedLoginAttempts: 0,
        lastLoginAt: null,
        createdAt: new Date().toISOString(),
      },
    };
  });
}

/** Bulk account creation from a CSV extract (TOR §28). */
export function BulkImportUsersDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const users = useDataStore((state) => state.users);
  const importUsers = useDataStore((state) => state.importUsers);
  const actor = useCurrentUser();

  const [text, setText] = useState('');
  const parsed = text.trim() ? parseCsv(text, users) : [];
  const accepted = parsed.filter((row) => row.user);
  const rejected = parsed.filter((row) => row.problem);

  const close = () => {
    setText('');
    onClose();
  };

  const submit = () => {
    importUsers(
      accepted.map((row) => row.user!),
      actor?.id ?? 'system',
    );
    notify({
      variant: 'success',
      title: `${accepted.length} account${accepted.length === 1 ? '' : 's'} created`,
      description: 'Invitations will be sent to each address on the next dispatch run.',
    });
    close();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Bulk import users"
      description="Paste a CSV extract or drop one in. Rows are validated before anything is created."
      size="xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] text-ink-600">
            {parsed.length === 0
              ? 'Nothing to import yet.'
              : `${accepted.length} ready · ${rejected.length} rejected`}
          </p>
          <div className="flex items-center gap-2">
            <Button onClick={close}>Cancel</Button>
            <Button
              variant="primary"
              disabled={accepted.length === 0}
              onClick={submit}
              icon={<Upload className="size-4" aria-hidden />}
            >
              Import {accepted.length || ''} account{accepted.length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-ink-200 bg-ink-50/70 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-semibold text-ink-800">
              Expected columns: full_name, email, role, designation, department
            </p>
            <Button
              size="sm"
              variant="ghost"
              icon={<Copy className="size-4" aria-hidden />}
              onClick={() => setText(TEMPLATE)}
            >
              Use template
            </Button>
          </div>
          <p className="mt-1 text-[11px] text-ink-600">
            Roles accepted: {ROLES.map((role) => ROLE_LABELS[role]).join(', ')}. Imported accounts
            are created as <span className="font-semibold">invited</span> and must set a password on
            first sign-in.
          </p>
        </div>

        <Field label="CSV rows" hint="One account per line.">
          {(props) => (
            <Textarea
              rows={8}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={TEMPLATE}
              className="font-mono text-[12px]"
              {...props}
            />
          )}
        </Field>

        {parsed.length > 0 && (
          <div className="max-h-64 overflow-y-auto rounded-lg border border-ink-200">
            <ul className="divide-y divide-ink-100">
              {parsed.map((row) => (
                <li key={row.line} className="flex items-start gap-2 px-3 py-2">
                  {row.user ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                  ) : (
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger-600" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink-900">
                      {row.user ? row.user.fullName : `Line ${row.line}`}
                      {row.user && (
                        <span className="ml-1.5 font-normal text-ink-600">{row.user.email}</span>
                      )}
                    </p>
                    <p className="truncate text-[11px] text-ink-500">{row.problem ?? row.raw}</p>
                  </div>
                  {row.user && (
                    <Badge tone="brand" size="sm">
                      {ROLE_LABELS[row.user.role]}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
