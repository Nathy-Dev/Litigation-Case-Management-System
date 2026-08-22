/**
 * Build-time switches.
 *
 * The prototype ships several affordances that exist only so a reviewer can
 * move around the system quickly — one-click persona sign-in, a role switcher
 * in the top bar, and hints stating that any password is accepted. Every one of
 * them is an authentication bypass once a real backend is attached, so they are
 * all gated on a single flag rather than scattered `if (import.meta.env.DEV)`
 * checks that are easy to miss.
 *
 * The flag is on unless explicitly switched off, so the review build behaves
 * the same whether it is served by `vite dev` or `vite preview`. Set
 * `VITE_DEMO_MODE=false` in the deployment environment (see `.env.example`) to
 * strip the scaffolding and leave an ordinary sign-in form.
 */
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE !== 'false';
