import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/store/uiStore';
import { SidebarContent } from './Sidebar';
import { Topbar } from './Topbar';
import { CommandPalette } from './CommandPalette';
import { Toaster } from '@/components/ui/Toaster';
import { useSessionKeepAlive } from '@/hooks/useSessionKeepAlive';
import { DataProvider } from '@/store/dataStore';

/**
 * Application chrome: a fixed green rail, a sticky topbar, and the routed page.
 * The rail collapses to icons on desktop and becomes an off-canvas sheet below
 * the `lg` breakpoint.
 */
export function AppShell() {
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen);
  const setMobileNav = useUiStore((state) => state.setMobileNav);
  const density = useUiStore((state) => state.density);
  const location = useLocation();

  // Keep the server's idle clock honest while the app is open and in focus.
  useSessionKeepAlive();

  // Close the sheet and return to the top of the document on navigation.
  useEffect(() => {
    setMobileNav(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname, setMobileNav]);

  return (
    <div className="min-h-dvh bg-ink-50">
      {/* Feeds the Convex-backed register collections into the data store once,
          so the ~40 components that read `useDataStore` slices get live data. */}
      <DataProvider />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[80] focus:rounded-lg focus:bg-brand-700 focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to main content
      </a>

      {/* Desktop rail */}
      <aside
        className={cn(
          'no-print fixed inset-y-0 left-0 z-40 hidden transition-[width] duration-200 lg:block',
          collapsed ? 'w-[4.5rem]' : 'w-[15.5rem]',
        )}
      >
        <SidebarContent collapsed={collapsed} />
      </aside>

      {/* Mobile sheet */}
      {mobileNavOpen && (
        <div className="no-print fixed inset-0 z-50 lg:hidden">
          <div
            className="animate-fade-in absolute inset-0 bg-ink-950/50"
            role="presentation"
            onClick={() => setMobileNav(false)}
          />
          <div className="animate-slide-in-left relative h-full w-[16rem] max-w-[82vw]">
            <SidebarContent />
            <button
              type="button"
              onClick={() => setMobileNav(false)}
              aria-label="Close navigation"
              className="absolute top-3 -right-11 grid size-9 place-items-center rounded-lg bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
        </div>
      )}

      <div className={cn('transition-[padding] duration-200', collapsed ? 'lg:pl-[4.5rem]' : 'lg:pl-[15.5rem]')}>
        <Topbar />
        <main
          id="main-content"
          className={cn(
            'mx-auto w-full max-w-[100rem]',
            density === 'compact' ? 'px-3 py-4 sm:px-5' : 'px-4 py-6 sm:px-6 lg:px-8',
          )}
        >
          <Outlet />
        </main>
      </div>

      <CommandPalette />
      <Toaster />
    </div>
  );
}
