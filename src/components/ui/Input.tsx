import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const CONTROL =
  'w-full rounded-lg bg-white text-sm text-ink-900 ring-1 ring-ink-200 ring-inset transition placeholder:text-ink-400 focus:ring-2 focus:ring-brand-500 focus:outline-none disabled:bg-ink-50 disabled:text-ink-500 aria-[invalid=true]:ring-danger-400';

interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode;
  className?: string;
}

/**
 * Accessible field wrapper: binds the label, hint and error message to the
 * control via ids so screen readers announce them together (WCAG 2.1 AA).
 */
export function Field({ label, hint, error, required, children, className }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label htmlFor={id} className="block text-[13px] font-medium text-ink-700">
          {label}
          {required && (
            <span className="ml-0.5 text-danger-600" aria-hidden>
              *
            </span>
          )}
        </label>
      )}
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      {error ? (
        <p id={`${id}-error`} className="text-[12px] text-danger-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[12px] text-ink-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leading?: ReactNode;
  trailing?: ReactNode;
  sizing?: 'sm' | 'md';
}

export function Input({ className, leading, trailing, sizing = 'md', ...rest }: InputProps) {
  const height = sizing === 'sm' ? 'h-8 text-[13px]' : 'h-9.5';

  if (!leading && !trailing) {
    return <input className={cn(CONTROL, height, 'px-3', className)} {...rest} />;
  }

  return (
    <div className="relative">
      {leading && (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-400">
          {leading}
        </span>
      )}
      <input
        className={cn(CONTROL, height, leading ? 'pl-9' : 'pl-3', trailing ? 'pr-9' : 'pr-3', className)}
        {...rest}
      />
      {trailing && (
        <span className="absolute inset-y-0 right-2.5 flex items-center text-ink-400">{trailing}</span>
      )}
    </div>
  );
}

export function Textarea({
  className,
  rows = 4,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={rows} className={cn(CONTROL, 'px-3 py-2 leading-relaxed', className)} {...rest} />;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  sizing?: 'sm' | 'md';
}

export function Select({ className, children, sizing = 'md', ...rest }: SelectProps) {
  return (
    <div className="relative">
      <select
        className={cn(
          CONTROL,
          sizing === 'sm' ? 'h-8 text-[13px]' : 'h-9.5',
          'appearance-none pr-8 pl-3',
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-ink-400"
        aria-hidden
      />
    </div>
  );
}

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
  description?: ReactNode;
}

export function Checkbox({ label, description, className, ...rest }: CheckboxProps) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2.5', className)}>
      <input
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-ink-300 text-brand-600 accent-brand-600 focus:ring-brand-500"
        {...rest}
      />
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-[13px] text-ink-800">{label}</span>}
          {description && <span className="block text-[12px] text-ink-500">{description}</span>}
        </span>
      )}
    </label>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, description, disabled }: SwitchProps) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-[13px] font-medium text-ink-800">{label}</span>}
          {description && <span className="mt-0.5 block text-[12px] text-ink-500">{description}</span>}
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={typeof label === 'string' ? label : 'Toggle'}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-5.5 w-10 shrink-0 rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-brand-600' : 'bg-ink-300',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-4.5 rounded-full bg-white shadow-sm transition-all',
            checked ? 'left-5' : 'left-0.5',
          )}
        />
      </button>
    </label>
  );
}
