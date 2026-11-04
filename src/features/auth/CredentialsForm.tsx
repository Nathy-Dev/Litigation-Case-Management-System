import { useState } from 'react';
import { Lock, LogIn, Mail } from 'lucide-react';
import { authClient } from '@/authClient';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';

/**
 * The credentials step. Calls Better Auth's email/password endpoint; if the
 * account has two-factor switched on the server answers with a two-factor
 * challenge, and this form hands off to `MfaForm`.
 */
export function CredentialsForm({ onMfa }: { onMfa: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await authClient.signIn.email({ email: email.trim(), password });
      if (response.error) {
        setError(response.error.message ?? 'Sign-in failed. Check your details and try again.');
        return;
      }
      // The two-factor plugin flags a challenge on the sign-in response; read it
      // defensively because the plugin's type augmentation varies by version.
      const data = response.data as (typeof response.data) & { twoFactorRedirect?: boolean };
      if (data?.twoFactorRedirect) {
        onMfa();
        return;
      }
    } catch {
      setError('Could not reach the sign-in service. Try again shortly.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-5 space-y-4">
      {error && (
        <p role="alert" className="rounded-lg border border-danger-200 bg-danger-50/70 px-3 py-2 text-[13px] text-danger-700">
          {error}
        </p>
      )}

      <Field label="Work email">
        {(props) => (
          <Input
            {...props}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            leading={<Mail className="size-4" aria-hidden />}
            placeholder="name@hyprep.gov.ng"
            required
          />
        )}
      </Field>

      <Field label="Password">
        {(props) => (
          <Input
            {...props}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            leading={<Lock className="size-4" aria-hidden />}
            placeholder="••••••••"
            required
          />
        )}
      </Field>

      <Button type="submit" variant="primary" size="lg" fullWidth loading={busy} icon={<LogIn className="size-4" aria-hidden />}>
        Sign in
      </Button>
    </form>
  );
}