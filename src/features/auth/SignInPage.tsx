import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, Info, ShieldCheck, KeyRound } from 'lucide-react';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { CoatOfArms } from '@/components/brand/CoatOfArms';
import { useAuthState } from '@/store/authStore';
import { CredentialsForm } from './CredentialsForm';
import { MfaForm } from './MfaForm';

/**
 * HYPREP LCMS - sign-in.
 *
 * Talks to Better Auth (running inside this Convex deployment) for real:
 * credentials first, then a six-digit authenticator code if the account has
 * two-factor switched on. Session state is owned by the server - `me` re-runs
 * as soon as sign-in completes and this screen redirects.
 */
export function SignInPage() {
  const { kind, email, reason } = useAuthState();
  const [step, setStep] = useState<'credentials' | 'mfa'>('credentials');

  // SSO is runtime-gated on `settings.ssoEnabled` (Admin -> System).
  //
  // Deliberately `api.reference.ssoGate`, not `api.reference.bundle`: `bundle`
  // is an authed query, and a visitor on this page is not signed in yet, so
  // asking for `bundle` makes the server throw "Not signed in." and crash the
  // screen. `ssoGate` is a plain query that exposes only this flag.
  const ssoEnabled = useQuery(api.reference.ssoGate) ?? false;

  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const ssoUrl = `${import.meta.env.VITE_CONVEX_SITE_URL ?? ''}/api/auth/sign-in/oidc`;

  if (kind === 'active') return <Navigate to={from} replace />;

  const status =
    kind === 'no-account'
      ? {
          icon: Info,
          title: 'No staff account',
          body: `${email ?? 'This address'} is not on the Legal Unit register. Ask an administrator to invite you.`,
        }
      : kind === 'blocked'
        ? {
            icon: AlertTriangle,
            title: 'Account unavailable',
            body: `This account is ${reason}. Contact an administrator if you believe this is wrong.`,
          }
        : kind === 'session-ended'
          ? { icon: Info, title: 'Session ended', body: reason ?? 'Your session is no longer active. Sign in again to continue.' }
          : null;

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-brand-800 p-10 text-white lg:flex">
        <div aria-hidden className="absolute -top-24 -right-24 size-96 rounded-full bg-brand-600/40 blur-3xl" />
        <div aria-hidden className="absolute -bottom-32 -left-20 size-96 rounded-full bg-brand-950/40 blur-3xl" />

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
        </div>
      </section>

      {/* Form panel */}
      <section className="grid place-items-center bg-white px-6 py-10">
        <div className="w-full max-w-sm">
          {status && (
            <div className="mb-6 flex gap-3 rounded-card border border-amber-200 bg-amber-50/70 p-4">
              <status.icon className="size-5 shrink-0 text-amber-700" aria-hidden />
              <div>
                <p className="text-[13px] font-semibold text-amber-900">{status.title}</p>
                <p className="mt-0.5 text-[12px] leading-snug text-amber-800/90">{status.body}</p>
              </div>
            </div>
          )}

          <span className="grid size-11 place-items-center rounded-full bg-brand-50 text-brand-700">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <h2 className="mt-4 font-serif text-[24px] font-semibold text-ink-900">Sign in</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-500">
            Use your Legal Unit account to access the case register.
          </p>

          {step === 'credentials' ? (
            <>
              {ssoEnabled && ssoUrl && (
                <>
                  <a
                    href={ssoUrl}
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded-card border border-ink-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-ink-800 shadow-xs transition-colors hover:border-brand-300 hover:text-brand-700"
                  >
                    <KeyRound className="size-4" aria-hidden />
                    Sign in with single sign-on
                  </a>
                  <div className="my-4 flex items-center gap-3 text-[11px] font-medium tracking-wide text-ink-400 uppercase">
                    <span className="h-px flex-1 bg-ink-100" aria-hidden />
                    or with a password
                    <span className="h-px flex-1 bg-ink-100" aria-hidden />
                  </div>
                </>
              )}
              <CredentialsForm onMfa={() => setStep('mfa')} />
            </>
          ) : (
            <MfaForm onBack={() => setStep('credentials')} onDone={() => navigate(from, { replace: true })} />
          )}
        </div>
      </section>
    </div>
  );
}