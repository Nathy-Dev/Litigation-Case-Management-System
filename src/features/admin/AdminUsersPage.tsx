import { useMemo, useState } from 'react';
import {
  KeyRound,
  Lock,
  LockOpen,
  MoreHorizontal,
  Pencil,
  ShieldCheck,
  UserPlus,
  Users as UsersIcon,
  Upload,
} from 'lucide-react';
import type { Role, User } from '@/types';
import { ROLES } from '@/types';
import { ROLE_LABELS } from '@/lib/permissions';
import { formatDateTime, formatRelative } from '@/lib/format';
import { useDataStore } from '@/store/dataStore';
import { useCan, useCurrentUser } from '@/store/authStore';
import { notify } from '@/store/uiStore';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Dropdown, MenuItem, MenuSeparator } from '@/components/ui/Dropdown';
import { EmptyState } from '@/components/ui/EmptyState';
import { FilterMenu } from '@/components/ui/FilterMenu';
import { Input } from '@/components/ui/Input';
import { StatCard } from '@/components/ui/StatCard';
import { UserDialog } from './UserDialog';
import { BulkImportUsersDialog } from './BulkImportUsersDialog';

const STATUS_TONE: Record<User['status'], 'brand' | 'neutral' | 'danger' | 'gold'> = {
  active: 'brand',
  invited: 'gold',
  disabled: 'neutral',
  locked: 'danger',
};

/** Accounts, roles and invitations (TOR §27–28). */
export function AdminUsersPage() {
  const users = useDataStore((state) => state.users);
  const teams = useDataStore((state) => state.teams);
  const upsertUser = useDataStore((state) => state.upsertUser);
  const actor = useCurrentUser();
  const canManage = useCan('user.manage');

  const [query, setQuery] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [editing, setEditing] = useState<User | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const teamName = (id: string | null) => teams.find((team) => team.id === id)?.name ?? '—';

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users
      .filter((user) => (roles.length ? roles.includes(user.role) : true))
      .filter((user) => (statuses.length ? statuses.includes(user.status) : true))
      .filter((user) =>
        needle
          ? user.fullName.toLowerCase().includes(needle) ||
            user.email.toLowerCase().includes(needle) ||
            user.title.toLowerCase().includes(needle) ||
            (user.firm?.toLowerCase().includes(needle) ?? false)
          : true,
      )
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'en-NG'));
  }, [users, query, roles, statuses]);

  const counts = useMemo(
    () => ({
      total: users.length,
      active: users.filter((user) => user.status === 'active').length,
      locked: users.filter((user) => user.status === 'locked').length,
      noMfa: users.filter((user) => !user.mfaEnabled).length,
    }),
    [users],
  );

  const patch = (user: User, changes: Partial<User>, message: string) => {
    upsertUser({ ...user, ...changes }, actor?.id ?? 'system');
    notify({ variant: 'success', title: message, description: user.fullName });
  };

  const open = (user: User | null) => {
    setEditing(user);
    setDialogOpen(true);
  };

  const columns: Column<User>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (user) => (
        <div className="flex items-center gap-2.5">
          <Avatar user={user} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink-900">{user.fullName}</p>
            <p className="truncate text-[11px] text-ink-500">{user.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'title',
      header: 'Designation',
      hideOnMobile: true,
      cell: (user) => (
        <div className="min-w-0">
          <p className="truncate text-ink-800">{user.title}</p>
          <p className="truncate text-[11px] text-ink-500">{user.firm ?? user.department}</p>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      cell: (user) => (
        <Badge tone="neutral" size="sm">
          {ROLE_LABELS[user.role]}
        </Badge>
      ),
    },
    {
      key: 'team',
      header: 'Team',
      hideOnMobile: true,
      cell: (user) => <span className="text-ink-700">{teamName(user.teamId)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (user) => (
        <div className="flex items-center gap-1.5">
          <Badge tone={STATUS_TONE[user.status]} size="sm">
            {user.status.charAt(0).toUpperCase() + user.status.slice(1)}
          </Badge>
          {user.mfaEnabled && (
            <span title="Multi-factor authentication enabled">
              <ShieldCheck className="size-3.5 text-brand-600" aria-hidden />
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'lastLogin',
      header: 'Last sign-in',
      hideOnMobile: true,
      cell: (user) =>
        user.lastLoginAt ? (
          <span title={formatDateTime(user.lastLoginAt)} className="text-ink-700">
            {formatRelative(user.lastLoginAt)}
          </span>
        ) : (
          <span className="text-ink-400">Never</span>
        ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      width: '3rem',
      cell: (user) =>
        canManage ? (
          <Dropdown
            trigger={({ toggle }) => (
              <Button
                size="sm"
                variant="ghost"
                onClick={toggle}
                icon={<MoreHorizontal className="size-4" aria-hidden />}
                aria-label={`Actions for ${user.fullName}`}
              />
            )}
          >
            {(close) => (
              <>
                <MenuItem
                  icon={<Pencil className="size-4" aria-hidden />}
                  onClick={() => {
                    open(user);
                    close();
                  }}
                >
                  Amend details
                </MenuItem>
                <MenuItem
                  icon={<KeyRound className="size-4" aria-hidden />}
                  onClick={() => {
                    patch(user, { failedLoginAttempts: 0 }, 'Password reset link sent');
                    close();
                  }}
                >
                  Send password reset
                </MenuItem>
                <MenuItem
                  icon={<ShieldCheck className="size-4" aria-hidden />}
                  onClick={() => {
                    patch(
                      user,
                      { mfaEnabled: !user.mfaEnabled },
                      user.mfaEnabled ? 'MFA requirement removed' : 'MFA now required',
                    );
                    close();
                  }}
                >
                  {user.mfaEnabled ? 'Remove MFA requirement' : 'Require MFA'}
                </MenuItem>
                <MenuSeparator />
                {user.status === 'locked' ? (
                  <MenuItem
                    icon={<LockOpen className="size-4" aria-hidden />}
                    onClick={() => {
                      patch(user, { status: 'active', failedLoginAttempts: 0 }, 'Account unlocked');
                      close();
                    }}
                  >
                    Unlock account
                  </MenuItem>
                ) : (
                  <MenuItem
                    icon={<Lock className="size-4" aria-hidden />}
                    destructive
                    disabled={user.id === actor?.id}
                    hint={user.id === actor?.id ? 'You cannot disable yourself' : undefined}
                    onClick={() => {
                      patch(
                        user,
                        { status: user.status === 'disabled' ? 'active' : 'disabled' },
                        user.status === 'disabled' ? 'Account re-enabled' : 'Account disabled',
                      );
                      close();
                    }}
                  >
                    {user.status === 'disabled' ? 'Re-enable account' : 'Disable account'}
                  </MenuItem>
                )}
              </>
            )}
          </Dropdown>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Accounts" value={counts.total} icon={<UsersIcon className="size-4" aria-hidden />} />
        <StatCard label="Active" value={counts.active} tone="brand" hint="Able to sign in today" />
        <StatCard
          label="Locked out"
          value={counts.locked}
          tone={counts.locked > 0 ? 'danger' : 'default'}
          hint="After five failed attempts"
        />
        <StatCard
          label="Without MFA"
          value={counts.noMfa}
          tone={counts.noMfa > 0 ? 'gold' : 'default'}
          hint="Mandatory for administrators"
        />
      </div>

      <Card flush>
        <CardHeader
          title="Users & teams"
          description={`${filtered.length} of ${users.length} accounts shown.`}
          actions={
            canManage && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => setImportOpen(true)}
                  icon={<Upload className="size-4" aria-hidden />}
                >
                  Bulk import
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => open(null)}
                  icon={<UserPlus className="size-4" aria-hidden />}
                >
                  Add user
                </Button>
              </div>
            )
          }
        />
        <CardBody className="border-t border-ink-200">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-56 flex-1">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name, e-mail, designation or firm"
                sizing="sm"
                aria-label="Search accounts"
              />
            </div>
            <FilterMenu
              label="Role"
              selected={roles}
              onChange={setRoles}
              options={ROLES.map((role: Role) => ({
                value: role,
                label: ROLE_LABELS[role],
                count: users.filter((user) => user.role === role).length,
              }))}
            />
            <FilterMenu
              label="Status"
              selected={statuses}
              onChange={setStatuses}
              options={(['active', 'invited', 'disabled', 'locked'] as User['status'][]).map((status) => ({
                value: status,
                label: status.charAt(0).toUpperCase() + status.slice(1),
                count: users.filter((user) => user.status === status).length,
              }))}
            />
          </div>
        </CardBody>
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(user) => user.id}
          dense
          caption="User accounts"
          empty={
            <EmptyState
              icon={<UsersIcon className="size-5" aria-hidden />}
              title="No accounts match"
              description="Clear the search or filters to see the full directory."
              compact
            />
          }
        />
      </Card>

      <UserDialog open={dialogOpen} onClose={() => setDialogOpen(false)} user={editing} />
      <BulkImportUsersDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
