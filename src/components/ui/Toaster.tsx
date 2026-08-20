import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useUiStore, type ToastVariant } from '@/store/uiStore';
import { cn } from '@/lib/utils';

const ICONS: Record<ToastVariant, typeof Info> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const ACCENTS: Record<ToastVariant, string> = {
  success: 'text-brand-600',
  error: 'text-danger-600',
  warning: 'text-gold-600',
  info: 'text-info-600',
};

/** Live region so assistive technology announces confirmations. */
export function Toaster() {
  const toasts = useUiStore((state) => state.toasts);
  const dismiss = useUiStore((state) => state.dismissToast);

  return createPortal(
    <div
      aria-live="polite"
      aria-atomic="false"
      className="no-print pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end"
    >
      {toasts.map((toast) => {
        const Icon = ICONS[toast.variant];
        return (
          <div
            key={toast.id}
            className="animate-slide-up pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl bg-white p-3.5 ring-1 ring-ink-200 shadow-overlay"
          >
            <Icon className={cn('mt-0.5 size-4.5 shrink-0', ACCENTS[toast.variant])} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-ink-900">{toast.title}</p>
              {toast.description && (
                <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">{toast.description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
              className="rounded p-0.5 text-ink-400 transition-colors hover:text-ink-700"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
