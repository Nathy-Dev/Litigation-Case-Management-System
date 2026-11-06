/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as api_ from "../api.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as authEvents from "../authEvents.js";
import type * as backup from "../backup.js";
import type * as backupDb from "../backupDb.js";
import type * as bootstrap from "../bootstrap.js";
import type * as cases from "../cases.js";
import type * as courtDates from "../courtDates.js";
import type * as cronHandlers from "../cronHandlers.js";
import type * as cronQueries from "../cronQueries.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as documents from "../documents.js";
import type * as http from "../http.js";
import type * as integrations_email_index from "../integrations/email/index.js";
import type * as integrations_email_templates from "../integrations/email/templates.js";
import type * as integrations_sms_index from "../integrations/sms/index.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_accessOracle from "../lib/accessOracle.js";
import type * as lib_actor from "../lib/actor.js";
import type * as lib_caseStatus from "../lib/caseStatus.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_rollups from "../lib/rollups.js";
import type * as lib_rows from "../lib/rows.js";
import type * as notes from "../notes.js";
import type * as notifications from "../notifications.js";
import type * as ocr from "../ocr.js";
import type * as reference from "../reference.js";
import type * as reports from "../reports.js";
import type * as search from "../search.js";
import type * as seed_index from "../seed/index.js";
import type * as seed_reference from "../seed/reference.js";
import type * as shared_enums from "../shared/enums.js";
import type * as shared_password from "../shared/password.js";
import type * as shared_permissions from "../shared/permissions.js";
import type * as shared_pure from "../shared/pure.js";
import type * as shared_query from "../shared/query.js";
import type * as shared_reports from "../shared/reports.js";
import type * as shared_templates from "../shared/templates.js";
import type * as shared_timeline from "../shared/timeline.js";
import type * as tasks from "../tasks.js";
import type * as userAccounts from "../userAccounts.js";
import type * as users from "../users.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  api: typeof api_;
  audit: typeof audit;
  auth: typeof auth;
  authEvents: typeof authEvents;
  backup: typeof backup;
  backupDb: typeof backupDb;
  bootstrap: typeof bootstrap;
  cases: typeof cases;
  courtDates: typeof courtDates;
  cronHandlers: typeof cronHandlers;
  cronQueries: typeof cronQueries;
  crons: typeof crons;
  dashboard: typeof dashboard;
  documents: typeof documents;
  http: typeof http;
  "integrations/email/index": typeof integrations_email_index;
  "integrations/email/templates": typeof integrations_email_templates;
  "integrations/sms/index": typeof integrations_sms_index;
  "lib/access": typeof lib_access;
  "lib/accessOracle": typeof lib_accessOracle;
  "lib/actor": typeof lib_actor;
  "lib/caseStatus": typeof lib_caseStatus;
  "lib/functions": typeof lib_functions;
  "lib/rollups": typeof lib_rollups;
  "lib/rows": typeof lib_rows;
  notes: typeof notes;
  notifications: typeof notifications;
  ocr: typeof ocr;
  reference: typeof reference;
  reports: typeof reports;
  search: typeof search;
  "seed/index": typeof seed_index;
  "seed/reference": typeof seed_reference;
  "shared/enums": typeof shared_enums;
  "shared/password": typeof shared_password;
  "shared/permissions": typeof shared_permissions;
  "shared/pure": typeof shared_pure;
  "shared/query": typeof shared_query;
  "shared/reports": typeof shared_reports;
  "shared/templates": typeof shared_templates;
  "shared/timeline": typeof shared_timeline;
  tasks: typeof tasks;
  userAccounts: typeof userAccounts;
  users: typeof users;
  webhooks: typeof webhooks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
