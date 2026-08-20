import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarClock, Compass, Gavel, LayoutDashboard } from 'lucide-react';
import { CoatOfArms } from '@/components/brand/CoatOfArms';
import { Button } from '@/components/ui/Button';

const SUGGESTIONS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/cases', label: 'Case register', icon: Gavel },
  { to: '/calendar', label: 'Court diary', icon: CalendarClock },
];

/** Shown for any unknown address. */
export function NotFoundPage() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="mx-auto max-w-xl py-12 text-center">
      <CoatOfArms className="mx-auto size-16" />
      <p className="mt-6 text-[13px] font-semibold uppercase tracking-widest text-brand-700">
        Page not found
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-ink-900">
        We could not find that page
      </h1>
      <p className="mt-2 text-[13px] text-ink-600">
        <code className="rounded bg-ink-100 px-1.5 py-0.5 text-[12px]">{location.pathname}</code> does
        not exist, or the record it pointed to has been archived or is outside your access.
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Button onClick={() => navigate(-1)} icon={<ArrowLeft className="size-4" aria-hidden />}>
          Go back
        </Button>
        <Link to="/">
          <Button variant="primary" icon={<Compass className="size-4" aria-hidden />}>
            Return to the dashboard
          </Button>
        </Link>
      </div>

      <div className="mt-8 rounded-xl border border-ink-200 bg-white p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          Frequently used
        </p>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-3">
          {SUGGESTIONS.map((item) => (
            <li key={item.to}>
              <Link
                to={item.to}
                className="flex items-center justify-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-[13px] font-medium text-ink-700 transition-colors hover:bg-brand-50 hover:text-brand-900"
              >
                <item.icon className="size-4 text-brand-600" aria-hidden />
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
