import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import type { CasePriority, CaseStatus, HearingOutcome, TaskStatus } from '@/types';
import { cn } from '@/lib/utils';

export type BadgeTone =
  | 'neutral'
  | 'brand'
  | 'info'
  | 'warning'
  | 'danger'
  | 'success'
  | 'gold'
  | 'violet';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-ink-100 text-ink-700 ring-ink-200',
  brand: 'bg-brand-50 text-brand-800 ring-brand-200',
  info: 'bg-info-50 text-info-700 ring-info-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  danger: 'bg-danger-50 text-danger-700 ring-danger-200',
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  gold: 'bg-gold-50 text-gold-700 ring-gold-200',
  violet: 'bg-violet-50 text-violet-800 ring-violet-200',
};

interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  icon?: ReactNode;
  size?: 'sm' | 'md';
  className?: string;
  /** Adds a leading dot — useful when the tone alone carries the meaning. */
  dot?: boolean;
}

export function Badge({ tone = 'neutral', children, icon, size = 'md', className, dot }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium ring-1 ring-inset whitespace-nowrap',
        size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-0.5 text-xs',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden />}
      {icon}
      {children}
    </span>
  );
}

/** Status colours are fixed across the whole app so they read as a legend. */
export const STATUS_TONE: Record<CaseStatus, BadgeTone> = {
  Draft: 'neutral',
  Filed: 'info',
  Pending: 'brand',
  Adjourned: 'warning',
  Heard: 'violet',
  'Judgment Delivered': 'gold',
  Concluded: 'success',
  Closed: 'neutral',
  Archived: 'neutral',
};

export function StatusBadge({ status, size }: { status: CaseStatus; size?: 'sm' | 'md' }) {
  return (
    <Badge tone={STATUS_TONE[status]} size={size} dot>
      {status}
    </Badge>
  );
}

export const PRIORITY_TONE: Record<CasePriority, BadgeTone> = {
  Critical: 'danger',
  High: 'warning',
  Medium: 'info',
  Low: 'neutral',
};

export function PriorityBadge({ priority, size }: { priority: CasePriority; size?: 'sm' | 'md' }) {
  return (
    <Badge tone={PRIORITY_TONE[priority]} size={size}>
      {priority}
    </Badge>
  );
}

const TASK_TONE: Record<TaskStatus, BadgeTone> = {
  'Not Started': 'neutral',
  'In Progress': 'info',
  Blocked: 'danger',
  Completed: 'success',
  Cancelled: 'neutral',
};

export function TaskStatusBadge({ status, size }: { status: TaskStatus; size?: 'sm' | 'md' }) {
  return (
    <Badge tone={TASK_TONE[status]} size={size} dot>
      {status}
    </Badge>
  );
}

const OUTCOME_TONE: Record<HearingOutcome, BadgeTone> = {
  Adjourned: 'warning',
  Heard: 'violet',
  'Part-Heard': 'info',
  'Judgment Delivered': 'gold',
  'Judgment Reserved': 'gold',
  'Ruling Delivered': 'gold',
  'Struck Out': 'danger',
  Settled: 'success',
  'Not Sat': 'neutral',
};

export function OutcomeBadge({ outcome, size }: { outcome: HearingOutcome; size?: 'sm' | 'md' }) {
  return (
    <Badge tone={OUTCOME_TONE[outcome]} size={size}>
      {outcome}
    </Badge>
  );
}

/** Confidentiality marker — deliberately consistent everywhere it appears. */
export function ConfidentialBadge({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  return (
    <Badge tone="danger" size={size} icon={<Lock className="size-3" aria-hidden />}>
      Confidential
    </Badge>
  );
}
