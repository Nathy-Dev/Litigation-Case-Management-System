import { useState } from 'react';
import { KeyRound, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { CoatOfArms } from '@/components/brand/CoatOfArms';
import { authClient } from '@/authClient';
import { useAuthStore } from '@/store/authStore';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';

/**
 * HYPREP LCMS - the compliance gate.
 *
 * Rendered by `RequireCompliance` when the signed-in caller owes a security
 * obligation the server is refusing their mutations until they clear:
 * SUPER_ADMIN/ADMIN must enrol in two-factor authentication once, and any user
 * whose password has expired must change it. Both go straight to Better Auth,
 * and `me` re-runs as the account changes, so the gate lifts on its own.
 */
export function ComplianceGate({
  mustEnrolMfa,
  mustChangePassword,
}: {
  mustEnrolMfa: boolean;
  mustChangePassword: boolean;
}) {
  const signOut = useAuthStore((state) => state.signOut);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="grid min-h-dvh place-items-center bg-ink-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid size-11 place-items-center overflow-hidden rounded-xl bg-brand-800 p-1 text-white">
            <CoatOfArms size={26} decorative />
          </span>
          <div>
            <p className="font-serif text-[15px] leading-tight font-semibold text-ink-900">Security check-in</p>
            <p className="text-[12px] text-ink-500">
              Hydrocarbon Pollution Remediation Project · Legal Unit
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-card border border-ink-200 bg-white shadow-sm">
          {mustEnrolMfa && <MfaEnrolment onError={setError} />}
          {mustChangePassword && <PasswordChange onError={setError} />}

          <div className="border-t border-ink-100 px-5 py-3">
            {error && (
              <p role="alert" className="mb-3 text-[13px] font-medium text-danger-700">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={() => void signOut()}
              className="inline-flex items-center gap-1.5 rounded text-[12px] font-medium text-ink-500 transition-colors hover:text-ink-800"
            >
              <LogOut className="size-3.5" aria-hidden />
              Not you? Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MfaEnrolment({ onError }: { onError: (message: string | null) => void }) {
  const [password, setPassword] = useState('');
  const [provisioned, setProvisioned] = useState<{
    totpUri: string;
    secret: string;
    backupCodes: string[];
  } | null>(null);
  const [code, setCode] = useState('');
  const [verified, setVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [busy, setBusy] = useState(false);

  const begin = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    onError(null);
    try {
      const response = await authClient.twoFactor.enable({ password });
      if (response.error) {
        onError(response.error.message ?? 'Could not start two-factor enrolment.');
        return;
      }
      const data = (response.data ?? {}) as { totpURI?: string; totpSecret?: string; backupCodes?: string[] };
      setProvisioned({
        totpUri: data.totpURI ?? '',
        secret: data.totpSecret ?? '',
        backupCodes: data.backupCodes ?? [],
      });
    } catch {
      onError('Two-factor enrolment is unavailable right now. Try again shortly.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    setVerifying(true);
    onError(null);
    try {
      const response = await authClient.twoFactor.verifyTotp({ code });
      if (response.error) {
        onError(response.error.message ?? 'That code was not accepted. Try the current six-digit code.');
        return;
      }
      setVerified(true);
    } catch {
      onError('Could not verify the code right now. Try again shortly.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="px-5 py-6">
      <span className="grid size-11 place-items-center rounded-full bg-brand-50 text-brand-700">
        <ShieldCheck className="size-5" aria-hidden />
      </span>
      <h2 className="mt-3 font-serif text-[20px] font-semibold text-ink-900">
        Enable two-factor authentication
      </h2>

      {provisioned === null ? (
        <>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-500">
            Your role is required to use an authenticator app. Once enrolled, you will enter a
            six-digit code from the app each time you sign in.
          </p>
          <form onSubmit={begin} className="mt-4 space-y-4">
            <Field label="Your password" hint="Confirm it as proof that this is your account.">
              {(props) => (
                <Input
                  {...props}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  required
                />
              )}
            </Field>
            <Button type="submit" variant="primary" fullWidth loading={busy}>
              Continue
            </Button>
          </form>
        </>
      ) : (
        <>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-500">
            Open your authenticator app and scan the QR code below, or add the account with the
            setup key.
          </p>

          {provisioned.totpUri && (
            <div className="mt-4 flex justify-center rounded-lg border border-ink-200 bg-white p-4">
              <QRCodeSVG value={provisioned.totpUri} size={172} level="M" marginSize={2} />
            </div>
          )}

          <div className="mt-4 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2">
            <p className="text-[12px] font-semibold text-ink-700">Setup key</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-700">
                {provisioned.secret || provisioned.totpUri.split('secret=')[1]?.split('&')[0] || '—'}
              </code>
              <button
                type="button"
                className="shrink-0 text-[12px] font-medium text-brand-700 hover:text-brand-800"
                onClick={() => navigator.clipboard?.writeText(provisioned.secret)}
              >
                Copy
              </button>
            </div>
          </div>

          {provisioned.backupCodes.length > 0 && (
            <div className="mt-4">
              <p className="text-[12px] font-semibold text-ink-700">Recovery codes</p>
              <p className="text-[12px] text-ink-500">Save these somewhere safe — each is single-use.</p>
              <div className="mt-1 grid grid-cols-2 gap-1 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 font-mono text-[12px] text-ink-700">
                {provisioned.backupCodes.map((code) => (
                  <span key={code}>{code}</span>
                ))}
              </div>
            </div>
          )}

          {verified ? (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="text-[13px] font-semibold text-emerald-800">
                Two-factor authentication is now enabled.
              </p>
              <p className="mt-0.5 text-[12px] leading-snug text-emerald-700">
                You will be asked for a code from your authenticator app each time you sign in.
              </p>
            </div>
          ) : (
            <form onSubmit={verify} className="mt-4 space-y-4">
              <Field
                label="Verify with your authenticator"
                hint="Enter the current six-digit code from the app."
              >
                {(props) => (
                  <Input
                    {...props}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    required
                  />
                )}
              </Field>
              <Button type="submit" variant="primary" fullWidth loading={verifying}>
                Verify and enable
              </Button>
            </form>
          )}

          {!verified && (
            <Button
              type="button"
              variant="ghost"
              fullWidth
              className="mt-3"
              icon={<RefreshCw className="size-4" aria-hidden />}
              onClick={() => setProvisioned(null)}
            >
              Enrol with a different key
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function PasswordChange({ onError }: { onError: (message: string | null) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    onError(null);
    try {
      if (next !== confirm) {
        onError('The two new passwords do not match.');
        return;
      }
      const response = await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
      });
      if (response.error) {
        onError(response.error.message ?? 'Could not change your password.');
        return;
      }
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch {
      onError('Could not change your password right now. Try again shortly.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-5 py-6">
      <span className="grid size-11 place-items-center rounded-full bg-brand-50 text-brand-700">
        <KeyRound className="size-5" aria-hidden />
      </span>
      <h2 className="mt-3 font-serif text-[20px] font-semibold text-ink-900">Your password has expired</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-500">
        For security, you must set a new password before continuing.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <Field label="Current password">
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              required
            />
          )}
        </Field>
        <Field label="New password">
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              required
            />
          )}
        </Field>
        <Field label="Confirm new password">
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              required
            />
          )}
        </Field>
        <Button type="submit" variant="primary" fullWidth loading={busy}>
          Update password
        </Button>
      </form>
    </div>
  );
}