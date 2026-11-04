# React + TypeScript + Vite

## Production deployment

The litigation frontend is hosted at `https://lcms-hyprep.vercel.app` and uses
the production Convex deployment `coordinated-grouse-202`.

The tracked `.env.production` contains only the public production backend URLs.
Vite loads it for production builds without changing `.env.local` or the
development deployment. Vercel environment variables override these defaults,
so any production overrides must point to the same production backend:

```dotenv
VITE_CONVEX_URL=https://coordinated-grouse-202.eu-west-1.convex.cloud
VITE_CONVEX_SITE_URL=https://coordinated-grouse-202.eu-west-1.convex.site
```

Use `npm run build` and the `dist` output directory in Vercel. A build refuses
missing backend URLs rather than publishing a blank page. Redeploy after
changing build environment variables; an existing JavaScript bundle does not
pick up those changes automatically.

Convex production must separately configure `SITE_URL` as
`https://lcms-hyprep.vercel.app` and a securely generated `BETTER_AUTH_SECRET`.
Keep that secret in Convex environment variables, never in frontend variables
or committed files. Super-admin accounts must enroll an authenticator at first
sign-in before accessing protected screens.

### Authentication and MFA upgrades

Keep the auth dependencies on the compatible pair in `package.json`:
`@convex-dev/better-auth` 0.13.x and `better-auth` 1.7.x. The component schema
must support MFA failure counters and lock expiry, and its adapter must support
atomic verification consumption and counter updates. An older component can
reject the MFA setup request even when password sign-in succeeds.

Deploy the Convex backend and redeploy the Vercel frontend together after an
auth dependency change. Keep `BETTER_AUTH_SECRET` unchanged during upgrades;
existing authenticator secrets and sessions depend on it. Do not disable MFA
to work around an enrollment failure.

Run `npm test -- convex/auth.test.ts` for enrollment, second-factor token gating,
lockout, challenge exhaustion, and logout regression coverage. These tests use
an in-memory database and never enroll an authenticator on a production account.
The account owner must scan the production QR code and verify a code themselves.

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
