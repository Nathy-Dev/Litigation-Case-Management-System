import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface UiState {
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  commandPaletteOpen: boolean;
  density: 'comfortable' | 'compact';
  toasts: Toast[];
  toggleSidebar: () => void;
  setMobileNav: (open: boolean) => void;
  setCommandPalette: (open: boolean) => void;
  setDensity: (density: 'comfortable' | 'compact') => void;
  toast: (input: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
}

let toastSeq = 0;

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileNavOpen: false,
      commandPaletteOpen: false,
      density: 'comfortable',
      toasts: [],

      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setMobileNav: (open) => set({ mobileNavOpen: open }),
      setCommandPalette: (open) => set({ commandPaletteOpen: open }),
      setDensity: (density) => set({ density }),

      toast: (input) => {
        const id = `toast_${(toastSeq += 1)}`;
        set((state) => ({ toasts: [...state.toasts, { ...input, id }] }));
        window.setTimeout(() => {
          set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }));
        }, 4200);
      },

      dismissToast: (id) =>
        set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) })),
    }),
    {
      name: 'lcms.ui',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) =>
        ({ sidebarCollapsed: state.sidebarCollapsed, density: state.density }) as UiState,
    },
  ),
);

/** Imperative toast for use outside React components (store actions, handlers). */
export const notify = (input: Omit<Toast, 'id'>) => useUiStore.getState().toast(input);
