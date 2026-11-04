# HYPREP LCMS — Convex Backend, Wired End to End

## Context

The LCMS is currently a complete, polished front end sitting on a mock: `src/store/dataStore.ts` builds the entire register in memory from `buildDataset(new Date())` on every page load, and nothing persists. Authentication is a demo (`src/store/authStore.ts` — any password except the literal `"wrong"` signs you in, MFA code `123456`, one-click persona switching). The prototype was built with the seam deliberately in place: every one of the 30 store mutations is shaped `(input, actorId) => { optimistic set; recordAudit; return record }`, which is exactly the shape of a server call.

This plan replaces the mock with a real **Convex** backend and database — overriding the TOR's stated PostgreSQL/REST/S3 stack — and wires the production integrations the TOR names: transactional email, SMS, OCR, a versioned REST API with webhooks, and SSO.

Decisions already taken:

| Area | Decision |
|---|---|
| Auth | **Better Auth** via `@convex-dev/better-auth` (0.12.5) + `better-auth` (1.7.1) — TOTP 2FA, password policy, lockout, session revocation, SSO/OIDC as first-class plugins, all inside your own deployment (no third-party identity vendor holds staff records) |
| Documents | **Convex built-in file storage** (`ctx.storage`) — retention enforced in app code |
| Integrations | **All four**: SMS gateway, OCR, REST API v1 + webhooks, SSO |
| Demo data | **Production only** — strip the persona picker, role switcher, `DEMO_MODE`, and the entire mock generator tree; empty DB with a one-time first-SUPER_ADMIN bootstrap |

**One judgment call flagged for you:** "strip the demo" removes the *fabricated records* (36 fake cases, 12 fake users, fake documents/tasks/audit). It does **not** remove `src/mocks/data/reference.ts` — that file holds the 20 real Nigerian courts, case types, document types, tags, workflow templates, report definitions and default settings. Those are production *configuration*, not fixtures, and the app cannot render a case form without them. They move to `convex/seed/reference.ts` and seed once, idempotently by slug; the existing Admin → Config UI already edits all of them. Say the word if you'd rather start with genuinely empty lookup tables.

### The outcome

Same UI, real backend: multi-user, persisted, reactive, access-controlled server-side, audited server-side, with hearing reminders that actually send.

---

## Architecture

### What survives untouched

`src/lib/selectors/*` (968 lines of joins, filters, reports, dashboard maths) and the ~47 components are **not rewritten**. The four hooks in `src/hooks/useCaseData.ts` are the seam: `useVisibleCaseRows()`, `useCaseRow(id)`, `useDashboardData()` keep their exported signatures and become `useQuery` wrappers. The selector logic is *relocated* into `convex/lib/` and called server-side, not reimplemented.

`src/store/authStore.ts` stays **at its path** and is gutted — `useCurrentUser`, `usePermission`, `useCan`, `useRole` keep identical signatures, backed by `useQuery(api.auth.me)`. That leaves all 41 `@/store/authStore` import statements untouched.

### Two schema decisions that carry the whole design

**1. `caseMembers` join table — the access index.**
Row-level visibility in `src/lib/selectors/cases.ts:126-140` is array membership (`assigneeIds.includes(user.id)`). **Convex cannot index an array for containment**, so a literal port means a full `cases` table scan on every read for every CASE_OFFICER, EXTERNAL_COUNSEL and READ_ONLY user. Project the four membership arrays into:

```
caseMembers: { caseId, userId, kind: 'owner'|'assignee'|'counsel'|'stakeholder'|'restricted' }
  by_user       → "which cases can I see"  (hot path)
  by_case       → rebuild on edit
  by_user_case  → single-case access check
```

The arrays stay denormalised on the case doc for display and form round-trip; the join table is the access index. Both written in one transaction. Every mutation touching `matterOwnerId`, `assigneeIds`, `externalCounselIds`, `stakeholderIds` or `restrictedToUserIds` must diff-and-rewrite member rows.

**2. Denormalised rollups on `cases`.**
`buildCaseRows` derives `nextHearing`, `lastHearing`, `openTasks`, `overdueTasks`, `documentCount` by scanning whole collections — and `sortCaseRows`/`filterCaseRows` sort and filter on them. **Derived values cannot be indexed**, so server-side sort/filter on them is impossible unless materialised. Add `nextHearingAt`, `lastHearingAt`, `openTaskCount`, `overdueTaskCount`, `documentCount` to the `cases` doc, maintained at write time by the court-date/task/document mutations, with a nightly reconcile cron (`overdueTaskCount` is time-dependent, so write-time alone is insufficient). `ageDays` stays client-derived from `filingDate` — pure and cheap.

### IDs and dates

Use `v.id("<table>")` for **every** foreign key; Convex `_id` is a branded string at runtime, so `record.matterOwnerId === user.id` and `.includes(user.id)` keep working verbatim and `src/types/index.ts` can keep declaring these as `string`. Queries map `_id → id` on the way out.

Keep as separate indexed string fields only identifiers with meaning outside the DB: `cases.caseId` (`HYP/LCMS/2026/0042`), `cases.suitNumber`, `users.email`/`authUserId`, and a `slug` on each reference table so the seed is idempotent and re-runnable.

Dates stay **ISO 8601 UTC strings** — they sort lexicographically = chronologically, so string indexes give working range queries, and every `date-fns` call and `localeCompare` sort in the client keeps working unchanged. `caseId` generation needs a `counters` table incremented in a mutation (Convex mutations are serialisable, so read-modify-write is safe).

### Read boundary: server-side, paginated, visibility applied *in the query*

`useDataset()` is the one hook with no 1:1 port and **must go** — porting it as `useQuery(api.data.everything)` would ship the whole database to every client and invalidate every subscription on every mutation, strictly worse than today. It splits into:

| Query | Returns |
|---|---|
| `api.reference.bundle` | courts, caseTypes, documentTypes, tags, teams, users-lite, settings, my permissions, report/workflow/case templates — small, stable, safe to ship whole |
| `api.cases.list(filters, sort, page)` | `Paginated<CaseRow>` (existing type); `filterCaseRows`/`sortCaseRows`/`paginate` move into the args |
| `api.cases.getDetail(id)` | case + hearings + tasks + docs + notes + statusChanges + timeline, access-checked via `by_user_case` |
| `api.dashboard.summary` | `DashboardMetrics` + my work — aggregates the whole visible register, precisely what can't be shipped clientside |
| `api.reports.run(id, options)` | `ReportResult`, backing both the on-screen table and the CSV export |
| `api.search.query(q)` | grouped results via `search_cases` + `search_documents` |

**Timeline returns structured data, formatted on the client.** `buildTimeline` (`src/mocks/generate/timeline.ts`, imported as a *runtime function* by `src/lib/selectors/search.ts:3`) currently composes strings via `src/lib/format.ts`, which uses `Intl.NumberFormat('en-NG')`. The Convex runtime has limited ICU locale data, so string composition moves into the components and `format.ts` never crosses to the server.

### Write boundary: one wrapper, `actorId` deleted

Build a single `customMutation` wrapper (`convex-helpers`) that every mutation goes through:

1. `ctx.auth.getUserIdentity()` → `users.by_authUserId` → actor doc; reject if absent or `status !== 'active'`
2. Check the mutation's declared `Permission` against the `permissionMatrix` table (runtime-editable, one doc per role)
3. Run the handler with `{ ...ctx, actor }` injected — **`actorId` disappears from all ~25 client call sites** (`(user|currentUser|actor)?.id ?? 'system'` becomes an impossible state)
4. Append the `auditLog` row

This is the RBAC enforcement point. Today permission checks are client-only — every button hides, but nothing stops a crafted call.

**Three constraints this hits, and the resolutions:**

- **`recordOutcome` calls `changeCaseStatus`** (`dataStore.ts:579`). A Convex mutation cannot call another mutation → extract the `followOn` status map and the status-change write into `convex/lib/caseStatus.ts` as a plain helper both call.
- **Failure-path audit rows are transactionally impossible.** A throw rolls back everything including the audit row and any scheduled follow-up. So `outcome: 'failure'` entries must be written from *non-transactional* contexts: auth failures via Better Auth hooks (this is where `authStore.ts:61-86`'s lockout logic ports to, unchanged in substance), API/webhook failures in `httpAction` handlers. **`httpAction` is also the only place `ipAddress`/`userAgent` are genuinely available** — `dataStore.ts:161-162` currently hardcodes `'105.112.44.18'` and reads `navigator.userAgent`.
- **Audit-on-read needs its own door.** 5 call sites in 4 files write read-event audits directly (`AdminAuditPage.tsx:114`, `DocumentViewer.tsx:58`, `ReportBuilderPage.tsx:83`, `ReportsPage.tsx:56,75`) — report viewed/exported, document viewed, audit exported. The mutation wrapper won't catch these. Add `api.audit.recordReadEvent` with a **constrained action enum**, or you've handed clients arbitrary audit forgery.

### Mutation classification

**Pure mutations (25):** createCase, updateCase, changeCaseStatus, archiveCase, deleteCase, addDocumentVersion, toggleCheckOut, deleteDocument, createCourtDate, updateCourtDate, recordOutcome, createTask, updateTask, toggleChecklistItem, addNote, markNotificationRead, markAllNotificationsRead, setRolePermissions, updateSettings, upsertCourt, upsertCaseType, upsertDocumentType, upsertTag, deleteTag, saveView, deleteSavedView.

**Actions / split:**

| Action | Shape |
|---|---|
| `uploadDocument` | 3 steps: `generateUploadUrl` (mutation) → client POSTs the file directly to Convex → `finalizeUpload` (mutation: storageId + metadata + `documentCount++`) which schedules `internal.ocr.extract`. A mutation *can* schedule an action — that's the correct pattern. |
| `rescheduleCourtDate` | Mutation writes the move + in-app notification transactionally, then schedules an email/SMS fan-out action and **re-arms reminders** (cancel stale scheduled jobs, queue new). |
| `upsertUser` | **Split**: profile fields (title, teamId, department, avatarColor, practisingLicenceNo) = mutation; account operations (create, change email, reset password, force MFA, lock/unlock) = action against Better Auth's admin API. |
| `importUsers` | Action — creates Better Auth accounts and sends invitations. CSV parsing stays client-side in `BulkImportUsersDialog.tsx`. |
| `revokeSession` | Action via Better Auth's API — it owns the session table, not a raw `db.delete`. |
| `runBackup` | Real export action: paginate every table → gzipped JSONL → Convex storage → `BackupRecord` with a **real** `sizeGb`. Today it fabricates `storageUsedGb * 0.42`. Convex's own platform snapshots remain the authoritative DR mechanism; this is the in-app auditable artefact the TOR asks for. |
| `resetDemoData` | **Deleted.** Replaced by `internal.seed.referenceData` (idempotent by slug) + `internal.bootstrap.firstSuperAdmin` (one-shot, guarded on an empty `users` table). |

### Two latent security gaps to close while we're here

Both verified in source, both pre-existing:

1. **`case.confidential` is declared as a permission (`case.confidential.view`) but never enforced.** `visibleToUser` checks `restrictedToUserIds` then membership; `record.confidential` is used only as a *filter* in `filterCaseRows`. The new `convex/lib/access.ts` must gate on it.
2. **The access rule has a second copy** in `visibleTasks` (`selectors/cases.ts:161-169`) for standalone tasks. Server-side, both paths call one helper.

---

## Auth cutover

**Wiring:** `convex/convex.config.ts` (`app.use(betterAuth)`, `app.use(rateLimiter)`) → `convex/auth.ts` (Better Auth instance with twoFactor/admin/SSO plugins) → `src/main.tsx` (construct `ConvexReactClient` from `VITE_CONVEX_URL`) → `src/App.tsx` (wrap `RouterProvider` in `ConvexBetterAuthProvider` — currently a 6-line file, the cleanest insertion point in the codebase).

**Two user tables.** Better Auth owns `user`/`session`/`account`/`twoFactor` in its own namespace; the domain `users` table owns `role`, `title`, `department`, `teamId`, `practisingLicenceNo`, `firm`, `status`, `failedLoginAttempts`. Link by `users.authUserId` (unique index). Rules: an auth account with no domain user is **denied, never auto-created** (sole exception: SSO JIT, which provisions `role: 'READ_ONLY'`, `status: 'invited'`, requiring explicit admin elevation — never JIT a privileged role). Disabling a user in Admin → Users **must** revoke Better Auth sessions, or they keep working until the token expires.

**The domain `users.role` is the sole authorization authority.** Better Auth's own `role` field is used only by its admin plugin. `api.auth.me` returns `{ user, permissions: Permission[], mustEnrolMfa, mustChangePassword }` with permissions resolved server-side from the `permissionMatrix` table — so `usePermission()` keeps its exact signature as `permissions.includes(p)`, and runtime editability *improves*: an admin edits the matrix, `me` invalidates, every connected client updates reactively.

**TOR `SystemSettings` → mechanism:**

| Setting | Mechanism |
|---|---|
| `passwordMinLength`, `passwordRequireComplexity` | `emailAndPassword.minPasswordLength` + validator hook |
| `maxFailedLoginAttempts` (5) | `before` sign-in hook incrementing `users.failedLoginAttempts`, `status: 'locked'` at threshold — a direct port of `authStore.ts:61-86` |
| `sessionTimeoutMinutes` (30) | **Idle** timeout: BA `session.expiresIn` + `updateAge` as the server gate, plus revival of the currently-dead `lastActivityAt`/`touch()` as a client idle timer. Server is the real gate; the timer is UX. |
| `passwordExpiryDays` (90) | `users.passwordChangedAt` + `mustChangePassword` on `me` → forced-change route |
| `mfaRequiredForRoles` (SUPER_ADMIN, ADMIN) | `mustEnrolMfa` on `me` → enrolment route, **and reject all other mutations server-side**. Client routing alone is not enforcement. |

⚠️ Better Auth reads much of its config at instance-construction time. Settings that must be dynamic (read live from the `settings` doc) have to be enforced in hooks instead. Audit which is which in P2 — this is the classic source of "the setting saves but does nothing".

**`src/app/guards.tsx`** grows from 2 guards to 4: `RequireAuth` (`step === 'authenticated'` → `<Authenticated>`/`<Unauthenticated>`/`<AuthLoading>`), `RequireSession` (holds render until `me` resolves), `RequireCompliance` (MFA enrolment / password change), `RequirePermission` (unchanged signature, now server-resolved).

`RequireSession` also fixes a cross-cutting problem: `useCurrentUser()` returns `User | null` synchronously today but will be `undefined` while loading. 33 files consume it and most use `?.id ?? 'system'`, which accidentally survives but makes "loading" indistinguishable from "signed out" — so components would flash empty states. Gating the authenticated tree once makes `useCurrentUser()` non-null by construction downstream.

---

## Integrations

| Integration | Home | Trigger |
|---|---|---|
| **Email** | `convex/integrations/email/` — Resend HTTP by default, `nodemailer` SMTP adapter in a `"use node"` action for on-prem; chosen by `EMAIL_PROVIDER` | Notification fan-out, reminders, digests, invitations |
| **SMS** | `convex/integrations/sms/{index,termii,africastalking,twilio}.ts`, adapter by `SMS_PROVIDER`, gated on `settings.smsEnabled` | Reminder cron + urgent notification fan-out |
| **OCR** | `convex/ocr.ts` — Google Cloud Vision REST, gated on `settings.ocrEnabled`. `images:annotate` for image formats; **`files:annotate` with inline base64 for PDFs, looping in batches of 5 pages** (the `pages` field caps at 5 per request; `asyncBatchAnnotate` needs GCS and is avoided). Writes `ocrText`/`ocrStatus` → populates `search_documents`. | Scheduled from `finalizeUpload`; `by_ocrStatus` index drives a requeue cron for stuck jobs |
| **REST API v1** | `convex/http.ts` via `httpRouter`: `/api/v1/{cases,cases/:id,documents,hearings,webhooks}` | Bearer `lcms_<keyId>_<secret>`; store only `sha256(secret)` in `apiKeys` with `scopes[]`, constant-time compare, `@convex-dev/rate-limiter` keyed by keyId |
| **Webhooks** | `webhookEndpoints` + `webhookDeliveries` | HMAC-SHA256 over `timestamp.body` in `X-LCMS-Signature`; dispatch action scheduled from the emitting mutation, retry cron over `by_status_nextAttemptAt` with exponential backoff |
| **SSO** | Better Auth SSO/OIDC plugin, button gated on `settings.ssoEnabled` | Document the IdP metadata handoff (entity ID, ACS/redirect URI, claim mapping → `users.email`/`fullName`) |
| **Storage** | `ctx.storage` | `src/components/ui/FileDropzone.tsx` is the wiring point (today it reads `File` name/size/type and hands them to the store); call site `UploadDocumentDialog.tsx:70` |

### Crons (`convex/crons.ts`)

| Cron | Cadence | Note |
|---|---|---|
| Hearing reminders | Hourly | `reminderOffsetsHours` `[168, 72, 24]`. **Must be idempotent** — `sentReminders` table keyed `courtDateId:offsetHours`, built in from day one. A non-idempotent retry double-texts every lawyer on the diary, at cost. |
| Daily/weekly digest | Daily | Honours `settings.digestFrequency`. **Convex crons run UTC; `settings.timeZone` is Africa/Lagos (UTC+1)** — make the offset arithmetic explicit or digests land at 1am. |
| Overdue-task rollup | Nightly | Recomputes `overdueTaskCount` + reconciles all rollups |
| Retention sweep | Daily | `settings.retentionArchiveAfterYears` (7) → sets `archivedAt` on concluded cases; `documentType.retentionYears` → produces a **disposal review list**. Archive and flag only — never auto-delete court documents. |
| Backup | Per `settings.backupSchedule` | Real export (above); prunes past `backupRetentionDays` |
| OCR requeue | 15 min | Drains stuck `processing`/`failed` |
| Webhook retry | 5 min | `by_status_nextAttemptAt` |
| Storage usage | Daily | Real `settings.storageUsedGb` = Σ version `sizeBytes`, replacing the fabricated `LEGACY_ARCHIVE_GB = 338.6` baseline (`mocks/generate/index.ts:106`) |

---

## Demo-strip sequence

The blocker: `src/mocks/generate/index.ts` exports the `Dataset` **type** used by 7 files, and `search.ts` imports a **runtime function** from `mocks/generate/timeline.ts`. So relocate before deleting.

1. **Move, don't delete** (pure refactor, app stays fully runnable): `src/mocks/data/reference.ts` → `convex/seed/reference.ts` (pure data, no browser deps — and note `mocks/generate/documents.ts:3` imports `DOCUMENT_TYPES` from it, so this must precede generator deletion). `src/mocks/generate/timeline.ts` → `convex/lib/timeline.ts`, returning structured events. **Split `src/lib/utils.ts`**: server-safe pure helpers (`matchesQuery`, `truncate`, `sortBy`, `groupBy`, `unique`, `clamp`, `initialsFrom`, `highlight`) apart from DOM helpers (`downloadBlob` uses `document.createElement`); `seededRandom`, `pick`, `delay` die with the generators.
2. **Detach the `Dataset` type** into `src/lib/selectors/types.ts` — 7 one-line import changes, zero behaviour change. This single edit makes the whole generator tree deletable.
3. **Demo UI affordances** (with the auth cutover, in one pass, so there's never a window with no working sign-in): delete `src/features/auth/DemoPersonaPicker.tsx` and `src/lib/env.ts`; edit `SignInPage.tsx` (lines 8-9, 152, 186, 208), `Topbar.tsx` (line 12, 133-165 `RoleSwitcher`, 255); gut the demo internals of `authStore.ts`; replace `VITE_DEMO_MODE` in `.env.example` with `VITE_CONVEX_URL`, `CONVEX_DEPLOYMENT`, `BETTER_AUTH_SECRET`, `SITE_URL` and the integration vars.
4. **Delete the generator tree LAST** (P7): `src/mocks/generate/*`, `src/mocks/data/{cases,users}.ts` (~2,100 lines of fake register), and `src/store/dataStore.ts` entirely.

---

## Phase order

Governing rule: **read and write for a given entity flip together.** Half-migrated (Convex reads, zustand writes) means writes vanish on refresh. Slice **vertically by entity**, never horizontally by layer.

| Phase | Content | End state |
|---|---|---|
| **P0** | Install `convex`, `@convex-dev/better-auth`, `better-auth`, `@convex-dev/rate-limiter`, `convex-helpers`. `npx convex dev`. Full `convex/schema.ts` — all tables, indexes, search indexes, `caseMembers`, rollups. Extract `convex/shared/enums.ts` (single source for ROLES/PERMISSIONS/statuses + `v.union` helpers) and add the `@shared` alias in `vite.config.ts` **and both tsconfigs**. Seed reference data. | Unchanged, still 100% mocks |
| **P1** | Pure refactors, no Convex reads yet: `Dataset` detachment, `reference.ts`/`timeline.ts` relocation, `utils.ts` split. Build + **oracle-test** `convex/lib/access.ts`. Build the mutation wrapper. | Unchanged, still mocks — this is what makes P3+ mechanical |
| **P2** | **Auth + users + reference.** Better Auth wired, `users` linked, `api.auth.me`, `authStore` gutted, `guards.tsx` rewritten, `RequireSession`, first-SUPER_ADMIN bootstrap, `api.reference.bundle`, all demo sign-in affordances deleted. | Degraded window — see below |
| **P3** | **Cases vertical slice.** `api.cases.list`/`getDetail` + all case mutations + `caseMembers` + rollups. `mocks/data/cases.ts` deleted. | Register fully correct |
| **P4** | Court dates + calendar (rollup maintenance, reschedule notifications, reminder arming) | Runnable |
| **P5** | Tasks + task board | Runnable |
| **P6** | Documents + Convex storage + `FileDropzone` wiring + OCR + `search_documents` | Runnable |
| **P7** | Notes, timeline, notifications, audit log, admin/config/settings. **Generator tree + `dataStore.ts` deleted here.** | Fully on Convex |
| **P8** | REST API v1 + webhooks + SSO + all crons (retention in report-only mode first) | Feature-complete |

**Plan for P2's degraded window.** Auth must land before any entity (every mutation stamps an actor, every read applies visibility), but the moment auth is real the signed-in user's id is a Convex `Id<"users">` while `mocks/data/cases.ts` still hardcodes `usr_okonkwo`-style owners — so membership matches nothing and owner columns render `—`. Bootstrap yourself as SUPER_ADMIN (`canViewAll === true` bypasses the membership test, so the register still renders) and land P3 immediately after in the same working session. Through P3–P6, `dataStore.ts` stays alive as a **read-only** mock source for not-yet-migrated collections; let its mutations be dead in that window rather than half-wired.

---

## Riskiest step, and the mitigation

**Rewriting `visibleToUser` into server-enforced access.** It's uniquely bad on four axes at once: it's the *security boundary* (a mistake silently over-exposes confidential and restricted matters, and no test today would catch it); it has a *performance cliff* (the honest 1:1 scan-and-filter port degrades from instant to timing out somewhere in the low thousands of cases — invisible in dev with 10 records); it depends on *derived state staying transactionally in sync* (a missed `caseMembers` diff silently locks a lawyer out of their own matter); and its *blast radius* is every other read — register, dashboard, calendar, reports, search, task board.

**Mitigation:** build `convex/lib/access.ts` first and in isolation (P1), with a property test asserting the `caseMembers`-index result equals the array-scan result across a generated corpus. Keep the array-scan version as the test oracle, then delete it.

Other risks worth naming: Better Auth ↔ domain `users` drift (R2 — unique `authUserId`, deny-on-missing, two-sided disable); failure-path audit rows (R4 — resolved via non-transactional hooks); reminder cron idempotency (R7 — `sentReminders` from day one); rollup drift (R9 — write-time + nightly reconcile + a `verifyRollups` internal query); construction-time-vs-dynamic Better Auth settings (R11).

---

## Verification

**Per phase, the app must run.** `npm run dev` with `npx convex dev` alongside; `npm run build` (`tsc -b && vite build`) must stay green at every phase boundary — the TS build is the primary regression net for a migration this shape. `npm run lint` (oxlint).

Type-check note: `npx` fails on this path — use the direct `node` form (`node ./node_modules/typescript/bin/tsc -b`).

**Access control (the one that matters).** Property test in P1 comparing `access.ts` against the array-scan oracle. Then, with real data in P3: create four users (SUPER_ADMIN, CASE_OFFICER, EXTERNAL_COUNSEL, READ_ONLY), create a confidential case restricted to one of them, and assert from each session that `api.cases.list` and `api.cases.getDetail` return exactly what they should — checking the **network payload**, not the rendered page, since the whole point is that non-visible rows never reach the client. Repeat for `visibleTasks`. Confirm `case.confidential.view` now actually gates.

**RBAC enforcement.** Call a privileged mutation (e.g. `setRolePermissions`) directly from a READ_ONLY session via the Convex dashboard function runner and confirm it throws. That's the check the client-only matrix never had.

**Auth.** Wrong password 5× → `status: 'locked'` + a `failure` audit row. MFA enrolment forced for SUPER_ADMIN/ADMIN, and other mutations rejected until enrolled. Idle 30 min → signed out. Set `passwordChangedAt` back 91 days → forced change. Disable a user in Admin → Users and confirm their open session dies immediately.

**Documents.** Upload a PDF via `FileDropzone` → real `storageId`, a working signed download URL, `documentCount` incremented, OCR fills `ocrText`, and the text is findable through `api.search.query`.

**Reminders + integrations.** Create a hearing 7 days out; assert `sentReminders` gets exactly one row per offset and that re-running the cron sends nothing further (the idempotency check). Verify Africa/Lagos offset by checking the digest's actual send hour. Point a webhook at a request-bin and verify the HMAC signature validates. Exercise `/api/v1/cases` with a valid key, a revoked key, and past the rate limit.

**Crons that destroy or spend money** — retention sweep and backup — run in report-only/dry-run mode for a full cycle before enabling.
