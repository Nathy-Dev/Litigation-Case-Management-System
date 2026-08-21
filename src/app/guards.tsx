import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import type { Permission } from '@/types';
import { useAuthStore, usePermission } from '@/store/authStore';
import { EmptyState } from '@/components/ui/EmptyState';
import { ButtonLink } from '@/components/ui/Button';

/** Bounces unauthenticated visitors to the sign-in screen, keeping their target. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const step = useAuthStore((state) => state.step);
  const location = useLocation();

  if (step !== 'authenticated') {
    return <Navigate to="/sign-in" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

/**
 * Route-level permission gate. Any one of `anyOf` is enough — the register, for
 * example, opens for both `case.view.all` and `case.view.assigned`.
 */
export function RequirePermission({ anyOf, children }: { anyOf: Permission[]; children: ReactNode }) {
  const can = usePermission();
  if (anyOf.some((permission) => can(permission))) return <>{children}</>;

  return (
    <EmptyState
      as="h1"
      icon={<ShieldAlert className="size-6" aria-hidden />}
      title="You do not have access to this area"
      description="Your role does not include the permissions needed for this page. Ask a system administrator if you believe this is wrong."
      action={<ButtonLink to="/" variant="primary">Back to dashboard</ButtonLink>}
    />
  );
}
