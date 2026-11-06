/**
 * HYPREP LCMS — Sentry initialisation.
 *
 * Call `initSentry()` once, as early as possible in `main.tsx`, before the
 * React tree is rendered. The DSN comes from the Vite-injected env variable
 * `VITE_SENTRY_DSN`. If the variable is absent (local dev without Sentry, or
 * a build that intentionally omits it) the call is a no-op — the SDK is never
 * loaded and no network requests are made.
 *
 * Usage in Convex actions / mutations: errors thrown inside Convex functions
 * are captured server-side by Convex's own logging. This file covers the
 * *frontend* surface only (React render errors, unhandled promise rejections,
 * and explicit `Sentry.captureException` calls from the ErrorBoundary).
 */

import * as Sentry from '@sentry/react';

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return; // graceful no-op when DSN is not configured

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE, // "production" | "development"
    // Release can be injected at build time via VITE_SENTRY_RELEASE; fall
    // back to the package version baked in by Vite's define plugin if set,
    // otherwise leave undefined and let Sentry infer from source-map uploads.
    release: (import.meta.env.VITE_SENTRY_RELEASE as string | undefined) ?? undefined,

    // Capture 100 % of transactions in production so the Legal Unit can see
    // real usage trends. Tune down if volume becomes a concern.
    tracesSampleRate: 1.0,

    // Don't send noise from localhost.
    beforeSend(event) {
      if (import.meta.env.DEV) return null;
      return event;
    },
  });
}

/**
 * Report an error to Sentry from an error boundary or a catch block.
 * Safe to call even when Sentry was not initialised (DSN absent).
 */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (context) {
    Sentry.withScope((scope) => {
      scope.setExtras(context);
      Sentry.captureException(error);
    });
  } else {
    Sentry.captureException(error);
  }
}

