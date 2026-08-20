import { useMemo, useState } from 'react';
import { Check, RotateCcw, ShieldCheck } from 'lucide-react';
import type { Permission, Role } from '@/types';
import { ROLES } from '@/types';
import {
  DEFAULT_PERMISSION_MATRIX,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
} from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { useDataStore } from '@/store/dataStore';
import { useCan, useCurrentUser } from '@/store/authStore';
import { notify } from '@/store/uiStore';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Disclosure } from '@/components/ui/Disclosure';
import { InfoHint } from '@/components/ui/Tooltip';

/**
 * The permission matrix (TOR §29). Every checkbox writes straight to the store,
 * so navigation, routes and action buttons react on the next render — this is
 * how a reviewer can see role-based access control working live.
 */
export function AdminRolesPage() {
  const matrix = useDataStore((state) => state.permissionMatrix);
  const setRolePermissions = useDataStore((state) => state.setRolePermissions);
  const users = useDataStore((state) => state.users);
  const actor = useCurrentUser();
  const canManage = useCan('role.manage');

  const [resetting, setResetting] = useState<Role | null>(null);

  const headcount = useMemo(() => {
    const counts = {} as Record<Role, number>;
    ROLES.forEach((role) => {
      counts[role] = users.filter((user) => user.role === role).length;
    });
    return counts;
  }, [users]);

  const toggle = (role: Role, permission: Permission) => {
    const current = matrix[role];
    const next = current.includes(permission)
      ? current.filter((item) => item !== permission)
      : [...current, permission];
    setRolePermissions(role, next, actor?.id ?? 'system');
  };

  const setGroup = (role: Role, permissions: Permission[], grant: boolean) => {
    const current = new Set(matrix[role]);
    permissions.forEach((permission) => (grant ? current.add(permission) : current.delete(permission)));
    setRolePermissions(role, [...current], actor?.id ?? 'system');
  };

  const reset = (role: Role) => {
    setRolePermissions(role, DEFAULT_PERMISSION_MATRIX[role], actor?.id ?? 'system');
    notify({
      variant: 'success',
      title: 'Permissions restored',
      description: `${ROLE_LABELS[role]} is back to the delivered defaults.`,
    });
    setResetting(null);
  };

  const drifted = ROLES.filter(
    (role) =>
      matrix[role].length !== DEFAULT_PERMISSION_MATRIX[role].length ||
      matrix[role].some((permission) => !DEFAULT_PERMISSION_MATRIX[role].includes(permission)),
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Roles & permissions"
          hint="Changes apply immediately across navigation, routes and every action button."
          actions={
            <Badge tone={drifted.length ? 'gold' : 'brand'} size="sm">
              {drifted.length ? `${drifted.length} role(s) amended` : 'Matching delivered defaults'}
            </Badge>
          }
        />
        <CardBody className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {ROLES.map((role) => (
            <div key={role} className="rounded-lg border border-ink-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-900">
                    <ShieldCheck className="size-3.5 text-brand-600" aria-hidden />
                    <span className="truncate">{ROLE_LABELS[role]}</span>
                    <InfoHint label={ROLE_DESCRIPTIONS[role]} />
                  </p>
                </div>
                {canManage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setResetting(role)}
                    icon={<RotateCcw className="size-4" aria-hidden />}
                    aria-label={`Restore defaults for ${ROLE_LABELS[role]}`}
                  />
                )}
              </div>
              <p className="mt-2 text-[11px] text-ink-600">
                <span className="font-semibold text-ink-800">{matrix[role].length}</span> permissions ·{' '}
                <span className="font-semibold text-ink-800">{headcount[role]}</span> account
                {headcount[role] === 1 ? '' : 's'}
              </p>
            </div>
          ))}
        </CardBody>
      </Card>

      {PERMISSION_GROUPS.map((group, index) => {
        const covered = ROLES.filter((role) =>
          group.permissions.some((permission) => matrix[role].includes(permission)),
        ).length;

        return (
        <Disclosure
          key={group.group}
          title={group.group}
          summary={`${group.permissions.length} permissions · held by ${covered} of ${ROLES.length} roles`}
          meta={
            <Badge tone="neutral" size="sm">
              {group.permissions.length}
            </Badge>
          }
          defaultOpen={index === 0}
          flush
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">{group.group} permissions by role</caption>
              <thead>
                <tr className="border-b border-ink-200 bg-ink-50/60">
                  <th scope="col" className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                    Permission
                  </th>
                  {ROLES.map((role) => (
                    <th
                      key={role}
                      scope="col"
                      className="px-2 py-2 text-center text-[11px] font-semibold text-ink-600"
                    >
                      <span className="block">{ROLE_LABELS[role]}</span>
                      {canManage && (
                        <span className="mt-1 flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => setGroup(role, group.permissions, true)}
                            className="rounded px-1 text-[10px] font-medium text-brand-700 hover:bg-brand-50"
                          >
                            All
                          </button>
                          <span aria-hidden className="text-ink-300">
                            |
                          </span>
                          <button
                            type="button"
                            onClick={() => setGroup(role, group.permissions, false)}
                            className="rounded px-1 text-[10px] font-medium text-ink-500 hover:bg-ink-100"
                          >
                            None
                          </button>
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group.permissions.map((permission) => (
                  <tr key={permission} className="border-b border-ink-100 last:border-b-0">
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      <span className="block text-[13px] text-ink-900">
                        {PERMISSION_LABELS[permission]}
                      </span>
                      <code className="text-[10px] text-ink-400">{permission}</code>
                    </th>
                    {ROLES.map((role) => {
                      const granted = matrix[role].includes(permission);
                      const isDefault = DEFAULT_PERMISSION_MATRIX[role].includes(permission);
                      return (
                        <td key={role} className="px-2 py-2 text-center">
                          <button
                            type="button"
                            disabled={!canManage}
                            onClick={() => toggle(role, permission)}
                            aria-pressed={granted}
                            aria-label={`${PERMISSION_LABELS[permission]} for ${ROLE_LABELS[role]}`}
                            className={cn(
                              'inline-flex size-6 items-center justify-center rounded-md border transition-colors',
                              granted
                                ? 'border-brand-600 bg-brand-600 text-white'
                                : 'border-ink-300 bg-white text-transparent hover:border-brand-400',
                              !canManage && 'cursor-not-allowed opacity-60',
                              granted !== isDefault && 'ring-2 ring-gold-300',
                            )}
                            title={granted !== isDefault ? 'Amended from the delivered default' : undefined}
                          >
                            <Check className="size-3.5" aria-hidden />
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Disclosure>
        );
      })}

      <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-500">
        <span aria-hidden className="size-3.5 rounded border border-brand-600 bg-brand-600 ring-2 ring-gold-300" />
        Amended from the delivered default
        <InfoHint label="Every change is written to the audit trail with your name, the time and your IP address." />
      </p>

      <ConfirmDialog
        open={resetting !== null}
        onClose={() => setResetting(null)}
        title="Restore delivered defaults?"
        message={
          resetting
            ? `${ROLE_LABELS[resetting]} will return to the permissions shipped with the system. Anyone signed in with that role will see the change immediately.`
            : ''
        }
        confirmLabel="Restore defaults"
        onConfirm={() => resetting && reset(resetting)}
      />
    </div>
  );
}
