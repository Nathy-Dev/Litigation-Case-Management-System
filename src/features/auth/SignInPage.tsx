import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, KeyRound, Lock, LogIn, Mail, ShieldCheck } from 'lucide-react';
import { CoatOfArms } from '@/components/brand/CoatOfArms';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import { useAuthStore } from '@/store/authStore';
import { DemoPersonaPicker } from './DemoPersonaPicker';

export function SignInPage() {
  const step = useAuthStore((state) => state.step);
  const error = useAuthStore((state) => state.error);
  const signIn = useAuthStore((state) => state.signIn);
  const verifyMfa = useAuthStore((state) => state.verifyMfa);
  const clearError = useAuthStore((state) => state.clearError);

  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [email, setEmail] = useState('c.okonkwo@hyprep.gov.ng');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  if (step === 'authenticated') return <Navigate to={from} replace />;

  const onSubmitCredentials = (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const result = signIn(email, password);
    setBusy(false);
    if (result.ok && !result.mfaRequired) navigate(from, { replace: true });
  };

  const onSubmitMfa = (event: React.FormEvent) => {
    event.preventDefault();
    if (verifyMfa(code)) navigate(from, { replace: true });
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-brand-800 p-10 text-white lg:flex">
        <div
          aria-hidden
          className="absolute -top-24 -right-24 size-96 rounded-full bg-brand-600/40 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute -bottom-32 -left-20 size-96 rounded-full bg-brand-950/40 blur-3xl"
        />

        <div className="relative flex items-center gap-3">
          <span className="grid size-12 place-items-center overflow-hidden rounded-xl bg-white p-1 ring-1 ring-white/30">
            <CoatOfArms size={28} decorative />
          </span>
          <div>
            <p className="font-serif text-[17px] leading-tight font-semibold">
              Hydrocarbon Pollution Remediation Project
            </p>
            <p className="text-[12px] tracking-wide text-brand-100 uppercase">
              Federal Ministry of Environment · Legal Unit
            </p>
          </div>
        </div>

        <div className="relative max-w-lg">
          <h1 className="font-serif text-[34px] leading-[1.15] font-semibold">
            Litigation &amp; Case Management System
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-brand-100">
            One register for every matter the Legal Unit handles — pleadings, hearing diary,
            court outcomes and the audit trail behind them.
          </p>

          <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5">
            {[
              ['Matters tracked', 'Filing to judgment, with full status history'],
              ['Hearing diary', 'Reminders at one week, three days and 24 hours'],
              ['Document vault', 'Versioned, watermarked, searchable by OCR text'],
              ['Accountability', 'Every action stamped with user, time and IP'],
            ].map(([term, detail]) => (
              <div key={term}>
                <dt className="text-[13px] font-semibold text-white">{term}</dt>
                <dd className="mt-0.5 text-[12px] leading-snug text-brand-100/85">{detail}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="relative text-[11px] text-brand-100/70">
          Prototype build for stakeholder review · Version 1.0 · Data shown is fictitious
        </p>
      </section>

      {/* Form panel */}
      <section className="flex flex-col justify-center bg-white px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-7 flex items-center gap-3 lg:hidden">
            <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-white p-1 ring-1 ring-ink-200/70">
              <CoatOfArms size={26} decorative />
            </span>
            <div>
              <p className="font-serif text-[16px] leading-tight font-semibold text-ink-900">
                HYPREP Legal Unit
              </p>
              <p className="text-[11px] tracking-wide text-ink-500 uppercase">LCMS</p>
            </div>
          </div>

          {step === 'credentials' ? (
            <>
              <h2 className="font-serif text-[24px] font-semibold text-ink-900">Sign in</h2>
              <p className="mt-1 text-[13px] text-ink-500">
                Use your official HYPREP address. Access is logged.
              </p>

              {error && (
                <div
                  role="alert"
                  className="mt-5 flex items-start gap-2.5 rounded-lg bg-danger-50 p-3 ring-1 ring-danger-200"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger-600" aria-hidden />
                  <p className="text-[13px] leading-snug text-danger-800">{error}</p>
                </div>
              )}

              <form onSubmit={onSubmitCredentials} className="mt-5 space-y-4">
                <Field label="Email address">
                  {(props) => (
                    <Input
                      {...props}
                      type="email"
                      autoComplete="username"
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value);
                        clearError();
                      }}
                      leading={<Mail className="size-4" aria-hidden />}
                      placeholder="name@hyprep.gov.ng"
                      required
                    />
                  )}
                </Field>

                <Field
                  label="Password"
                  hint="Any password signs you in. Type “wrong” to see the lockout warning."
                >
                  {(props) => (
                    <Input
                      {...props}
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        clearError();
                      }}
                      leading={<Lock className="size-4" aria-hidden />}
                      placeholder="••••••••"
                      required
                    />
                  )}
                </Field>

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  fullWidth
                  loading={busy}
                  icon={<LogIn className="size-4" aria-hidden />}
                >
                  Sign in
                </Button>
              </form>

              <DemoPersonaPicker onPicked={() => navigate(from, { replace: true })} />
            </>
          ) : (
            <>
              <span className="grid size-11 place-items-center rounded-full bg-brand-50 text-brand-700">
                <ShieldCheck className="size-5" aria-hidden />
              </span>
              <h2 className="mt-4 font-serif text-[24px] font-semibold text-ink-900">
                Two-factor verification
              </h2>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-500">
                Enter the six-digit code from your authenticator app. This account has
                multi-factor authentication switched on.
              </p>

              {error && (
                <p role="alert" className="mt-4 text-[13px] text-danger-700">
                  {error}
                </p>
              )}

              <form onSubmit={onSubmitMfa} className="mt-5 space-y-4">
                <Field label="Verification code" hint="Demo code: 123456">
                  {(props) => (
                    <Input
                      {...props}
                      inputMode="numeric"
                      maxLength={6}
                      value={code}
                      onChange={(event) => {
                        setCode(event.target.value.replace(/\D/g, ''));
                        clearError();
                      }}
                      leading={<KeyRound className="size-4" aria-hidden />}
                      placeholder="000000"
                      className="tnum tracking-[0.35em]"
                      required
                    />
                  )}
                </Field>

                <Button type="submit" variant="primary" size="lg" fullWidth>
                  Verify and continue
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  fullWidth
                  onClick={() => useAuthStore.setState({ step: 'credentials', pendingUserId: null })}
                >
                  Use a different account
                </Button>
              </form>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
