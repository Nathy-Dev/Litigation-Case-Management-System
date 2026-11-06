import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { CoatOfArms } from '@/components/brand/CoatOfArms';
import { reportError } from '@/lib/sentry';

/**
 * The branded recovery screen, shared by the top-level `ErrorBoundary` (render
 * errors) and the router's `errorElement` (route render / lazy-load / loader
 * errors, which React Router catches before they reach a parent boundary).
 */
export function ErrorFallback({ message }: { message: string }) {
  const summary = message.split('\n')[0] || 'Something went wrong while loading this screen.';

  return (
    <div className="grid min-h-dvh place-items-center bg-ink-50 px-6 py-10">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-xl bg-white p-1.5 shadow-xs ring-1 ring-ink-100">
          <CoatOfArms size={30} decorative />
        </span>

        <span className="mx-auto mt-5 grid size-11 place-items-center rounded-full bg-amber-50 text-amber-600">
          <AlertTriangle className="size-5" aria-hidden />
        </span>

        <h1 className="mt-4 font-serif text-[22px] font-semibold text-ink-900">
          This screen hit a snag
        </h1>

        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-ink-500">{summary}</p>

        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-9.5 items-center gap-2 rounded-lg bg-brand-600 px-3.5 text-sm font-medium text-white shadow-xs transition-colors hover:bg-brand-700 active:bg-brand-800"
          >
            <RotateCcw className="size-4" aria-hidden />
            Reload this screen
          </button>
        </div>

        <p className="mt-6 text-[11px] leading-relaxed text-ink-400">
          If this keeps happening, contact an administrator with the error message
          shown above — it matches an entry in the deployment log.
        </p>
      </div>
    </div>
  );
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * HYPREP LCMS - the last line of defence for render errors that escape the
 * router. (Route-level errors are caught by `errorElement` in `app/router.tsx`
 * first; this boundary exists for anything that reaches it anyway.)
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);
    reportError(error, { componentStack: info.componentStack ?? undefined });
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return <ErrorFallback message={error.message} />;
  }
}
