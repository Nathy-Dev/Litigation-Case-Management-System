import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bell,
  KeyRound,
  Laptop,
  LogOut,
  Mail,
  MessageSquare,
  Save,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import type { NotificationChannel } from '@/types';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, PERMISSION_GROUPS, PERMISSION_LABELS } from '@/lib/permissions';
import { formatDate, formatDateTime, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDataStore } from '@/store/dataStore';
import { useAuthStore, useCurrentUser } from '@/store/authStore';
import { notify, useUiStore } from '@/store/uiStore';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Disclosure } from '@/components/ui/Disclosure';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Checkbox, Field, Input, Switch } from '@/components/ui/Input';

const CHANNELS: { value: NotificationChannel; label: string; hint: string; icon: typeof Bell }[] = [
  { value: 'in_app', label: 'In the system', hint: 'Bell icon and the notification centre', icon: Bell },
  { value: 'email', label: 'E-mail', hint: 'Sent to your official address', icon: Mail },
  { value: 'sms', label: 'SMS', hint: 'Court reminders only', icon: MessageSquare },
];

/** The signed-in user's own account: security, devices and preferences (TOR §30). */
export function ProfilePage() {
  const user = useCurrentUser();
  const upsertUser = useDataStore((state) => state.upsertUser);
  const sessions = useDataStore((state) => state.sessions);
  const revokeSession = useDataStore((state) => state.revokeSession);
  const settings = useDataStore((state) => state.settings);
  const matrix = useDataStore((state) => state.permissionMatrix);
  const signOut = useAuthStore((state) => state.signOut);
  const density = useUiStore((state) => state.density);
  const setDensity = useUiStore((state) => state.setDensity);

  const [phone, setPhone] = useState(user?.phone ?? '');
  const [channels, setChannels] = useState<NotificationChannel[]>(['in_app', 'email']);
  const [password, setPassword] = useState({ current: '', next: '', confirm: '' });
  const [passwordError, setPasswordError] = useState('');
  const [revoking, setRevoking] = useState<string | null>(null);

  if (!user) return null;

  const mine = sessions.filter((session) => session.userId === user.id);
  const permissions = matrix[user.role];
  const phoneDirty = phone !== user.phone;

  const savePhone = () => {
    upsertUser({ ...user, phone: phone.trim() }, user.id);
    notify({ variant: 'success', title: 'Contact details saved' });
  };

  const changePassword = () => {
    if (password.next.length < settings.passwordMinLength)
      return setPasswordError(`Use at least ${settings.passwordMinLength} characters.`);
    if (
      settings.passwordRequireComplexity &&
      !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])/.test(password.next)
    )
      return setPasswordError('Include an upper case letter, a lower case letter, a digit and a symbol.');
    if (password.next !== password.confirm) return setPasswordError('The two new passwords do not match.');

    setPasswordError('');
    setPassword({ current: '', next: '', confirm: '' });
    notify({
      variant: 'success',
      title: 'Password changed',
      description: `It will next expire in ${settings.passwordExpiryDays} days.`,
    });
  };

  const toggleMfa = () => {
    upsertUser({ ...user, mfaEnabled: !user.mfaEnabled }, user.id);
    notify({
      variant: 'success',
      title: user.mfaEnabled ? 'Multi-factor authentication switched off' : 'Multi-factor authentication on',
      description: user.mfaEnabled
        ? 'You will sign in with your password alone.'
        : 'A six-digit code will be requested at each sign-in.',
    });
  };

  return (
    <div>
      <PageHeader
        title="My account"
        hint="Your details, security settings, signed-in devices and notification preferences."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
        <div className="space-y-4">
          <Card>
            <CardBody className="flex flex-wrap items-center gap-4">
              <Avatar user={user} size="xl" ring />
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-ink-900">{user.fullName}</h2>
                <p className="text-[13px] text-ink-600">
                  {user.title} · {user.firm ?? user.department}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-500">
                  <Badge tone="brand" size="sm">
                    {ROLE_LABELS[user.role]}
                  </Badge>
                  {user.practisingLicenceNo && (
                    <Badge tone="neutral" size="sm">
                      Licence {user.practisingLicenceNo}
                    </Badge>
                  )}
                  <span>Joined {formatDate(user.createdAt)}</span>
                </p>
              </div>
              <Button
                onClick={signOut}
                icon={<LogOut className="size-4" aria-hidden />}
              >
                Sign out
              </Button>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Contact details" hint="Used for reminders and court notices." />
            <CardBody className="grid gap-3 sm:grid-cols-2">
              <Field label="Official e-mail" hint="Changed by an administrator only.">
                {(props) => <Input value={user.email} readOnly disabled {...props} />}
              </Field>
              <Field label="Mobile number" hint="Nigerian format, e.g. 0803 123 4567.">
                {(props) => (
                  <Input
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    leading={<Smartphone className="size-4" aria-hidden />}
                    {...props}
                  />
                )}
              </Field>
              <div className="sm:col-span-2">
                <Button
                  variant="primary"
                  disabled={!phoneDirty}
                  onClick={savePhone}
                  icon={<Save className="size-4" aria-hidden />}
                >
                  Save contact details
                </Button>
              </div>
            </CardBody>
          </Card>

          <Disclosure
            title="Security"
            summary={`Two-factor ${user.mfaEnabled ? 'on' : 'off'} · password expires every ${settings.passwordExpiryDays} days`}
            icon={<ShieldCheck className="size-4" aria-hidden />}
          >
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3 rounded-lg border border-ink-200 p-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-ink-900">
                    Multi-factor authentication
                  </p>
                  <p className="text-[12px] text-ink-600">
                    {user.mfaEnabled
                      ? 'On — a six-digit code is requested after your password.'
                      : 'Off — your password alone signs you in.'}
                  </p>
                  {settings.mfaRequiredForRoles.includes(user.role) && (
                    <p className="mt-1 text-[11px] font-medium text-gold-700">
                      Mandatory for {ROLE_LABELS[user.role]} accounts.
                    </p>
                  )}
                </div>
                <Switch
                  checked={user.mfaEnabled}
                  onChange={toggleMfa}
                  label="Multi-factor authentication"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Current password">
                  {(props) => (
                    <Input
                      type="password"
                      value={password.current}
                      onChange={(event) => setPassword({ ...password, current: event.target.value })}
                      {...props}
                    />
                  )}
                </Field>
                <Field label="New password">
                  {(props) => (
                    <Input
                      type="password"
                      value={password.next}
                      onChange={(event) => setPassword({ ...password, next: event.target.value })}
                      {...props}
                    />
                  )}
                </Field>
                <Field label="Confirm new password">
                  {(props) => (
                    <Input
                      type="password"
                      value={password.confirm}
                      onChange={(event) => setPassword({ ...password, confirm: event.target.value })}
                      {...props}
                    />
                  )}
                </Field>
              </div>
              {passwordError && (
                <p role="alert" className="text-[12px] font-medium text-danger-700">
                  {passwordError}
                </p>
              )}
              <Button
                onClick={changePassword}
                disabled={!password.current || !password.next}
                icon={<KeyRound className="size-4" aria-hidden />}
              >
                Change password
              </Button>
            </div>
          </Disclosure>

          <Disclosure
            title="Signed-in devices"
            summary="Sign out anything you do not recognise"
            meta={
              <Badge tone="neutral" size="sm">
                {mine.length}
              </Badge>
            }
            icon={<Laptop className="size-4" aria-hidden />}
            flush
          >
            <ul>
              {mine.map((session) => (
                <li
                  key={session.id}
                  className="flex items-center gap-3 border-b border-ink-100 px-4 py-2.5 last:border-b-0 sm:px-5"
                >
                  <Laptop className="size-4 shrink-0 text-ink-400" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink-900">
                      {session.device}
                      {session.current && (
                        <Badge tone="brand" size="sm" className="ml-1.5">
                          This device
                        </Badge>
                      )}
                    </p>
                    <p className="truncate text-[11px] text-ink-500">
                      {session.browser} · {session.ipAddress} · {session.location}
                    </p>
                  </div>
                  <span
                    className="hidden shrink-0 text-[11px] text-ink-500 sm:block"
                    title={formatDateTime(session.lastSeenAt)}
                  >
                    {formatRelative(session.lastSeenAt)}
                  </span>
                  {!session.current && (
                    <Button size="sm" variant="ghost" onClick={() => setRevoking(session.id)}>
                      Sign out
                    </Button>
                  )}
                </li>
              ))}
              {mine.length === 0 && (
                <li className="px-3 py-3 text-[12px] text-ink-500">No other devices signed in.</li>
              )}
            </ul>
          </Disclosure>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Notifications" hint="How you would like to be reached." />
            <CardBody className="space-y-2.5">
              {CHANNELS.map((channel) => (
                <Checkbox
                  key={channel.value}
                  checked={channels.includes(channel.value)}
                  disabled={channel.value === 'sms' && !settings.smsEnabled}
                  onChange={(event) =>
                    setChannels((current) =>
                      event.target.checked
                        ? [...current, channel.value]
                        : current.filter((item) => item !== channel.value),
                    )
                  }
                  label={channel.label}
                  description={
                    channel.value === 'sms' && !settings.smsEnabled
                      ? 'SMS is disabled for this deployment.'
                      : channel.hint
                  }
                />
              ))}
              <Link
                to="/notifications"
                className="block pt-1 text-[12px] font-medium text-brand-700 underline"
              >
                Open the notification centre
              </Link>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Display" hint="Applies to this browser only." />
            <CardBody className="space-y-2">
              {(['comfortable', 'compact'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setDensity(option)}
                  aria-pressed={density === option}
                  className={cn(
                    'w-full rounded-lg border px-3 py-2 text-left text-[13px] transition-colors',
                    density === option
                      ? 'border-brand-400 bg-brand-50 font-semibold text-brand-900'
                      : 'border-ink-200 text-ink-700 hover:bg-ink-50',
                  )}
                >
                  {option === 'comfortable' ? 'Comfortable' : 'Compact'}
                  <span className="mt-0.5 block text-[11px] font-normal text-ink-500">
                    {option === 'comfortable'
                      ? 'Roomier rows, easier on projectors'
                      : 'More rows on screen for heavy caseloads'}
                  </span>
                </button>
              ))}
            </CardBody>
          </Card>

          <Disclosure
            title="What you may do"
            summary={ROLE_DESCRIPTIONS[user.role]}
            meta={
              <Badge tone="neutral" size="sm">
                {permissions.length}
              </Badge>
            }
          >
            <div className="space-y-2.5">
              {PERMISSION_GROUPS.map((group) => {
                const granted = group.permissions.filter((permission) =>
                  permissions.includes(permission),
                );
                if (granted.length === 0) return null;
                return (
                  <div key={group.group}>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                      {group.group}
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {granted.map((permission) => (
                        <li key={permission} className="text-[12px] text-ink-700">
                          {PERMISSION_LABELS[permission]}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </Disclosure>
        </div>
      </div>

      <ConfirmDialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        title="Sign this device out?"
        destructive
        message="The device will be returned to the sign-in screen on its next request."
        confirmLabel="Sign out"
        onConfirm={() => {
          if (!revoking) return;
          revokeSession(revoking, user.id);
          notify({ variant: 'success', title: 'Device signed out' });
          setRevoking(null);
        }}
      />
    </div>
  );
}
