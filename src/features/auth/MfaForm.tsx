import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { authClient } from '@/authClient';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';

/**
 * The second-factor step. `CredentialsForm` hands off here once Better Auth
 * reports a two-factor challenge; the code is verified against the challenge
 * the server already holds, and `me` flips to `active` on success.
 */
export function MfaForm({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await authClient.twoFactor.verifyTotp({ code });
      if (response.error) {
        setError(response.error.message ?? 'That code was not accepted. Try again.');
        return;
      }
      onDone();
    } catch {
      setError('Could not verify that code right now. Try again shortly.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-5">
      <h3 className="font-serif text-[17px] font-semibold text-ink-900">Two-factor verification</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-500">
        Enter the six-digit code from your authenticator app.
      </p>

      <form onSubmit={submit} className="mt-4 space-y-4">
        {error && (
          <p role="alert" className="rounded-lg border border-danger-200 bg-danger-50/70 px-3 py-2 text-[13px] text-danger-700">
            {error}
          </p>
        )}

        <Field label="Verification code">
          {(props) => (
            <Input
              {...props}
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              leading={<KeyRound className="size-4" aria-hidden />}
              placeholder="000000"
              className="tnum tracking-[0.35em]"
              required
            />
          )}
        </Field>

        <Button type="submit" variant="primary" size="lg" fullWidth loading={busy}>
          Verify and continue
        </Button>
        <Button type="button" variant="ghost" fullWidth onClick={onBack}>
          Use a different account
        </Button>
      </form>
    </div>
  );
}