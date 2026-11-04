import {
  customAction,
  customCtxAndArgs,
  customMutation,
  customQuery,
  type CustomCtx,
} from 'convex-helpers/server/customFunctions';
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { action, internalMutation, internalQuery, mutation, query } from '../_generated/server';
import {
  auditEntityValidator,
  auditMetadataValidator,
  auditOutcomeValidator,
  permissionValidator,
  roleValidator,
  type AuditEntity,
  type AuditOutcome,
  type Permission,
  type Role,
} from '../shared/enums';
import { requireActor, requireCompliance, requirePermission, type Actor } from './actor';

/**
 * HYPREP LCMS - the function wrappers.
 *
 * Every client-callable query and mutation is defined through one of these, and
 * that is the point: identity, RBAC, security compliance and the audit trail stop
 * being things a handler remembers to do and become things it cannot skip.
 *
 * In the prototype all four were client-side. Permission checks hid buttons but
 * did not stop a crafted call; the actor was a parameter the caller supplied,
 * defaulting to the string `'system'`; the audit row was written by whichever
 * store method happened to remember. This moves all of it behind the *definition*
 * of a mutation, so a new mutation is enforced and audited by default and any
 * exemption has to be written down.
 *
 * Built on `convex-helpers`' custom-function builders, which carry two features
 * this needs: per-definition configuration through `extra` - how `permission` and
 * `audit` reach the wrapper - and an `onSuccess` hook that runs after the handler
 * but still inside the transaction, which is what makes the audit requirement
 * enforceable rather than advisory.
 */

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/**
 * What a handler contributes to its audit row.
 *
 * The wrapper knows who acted, when, and whether the transaction committed. Only
 * the handler knows *what* it touched, so that half is supplied here. `entity`
 * and `action` default to the mutation's declaration and are overridable for the
 * mutations that legitimately touch two kinds of thing.
 */
export interface AuditDraft {
  entityId: string;
  entityLabel: string;
  action?: string;
  entity?: AuditEntity;
  outcome?: AuditOutcome;
  metadata?: Record<string, string | number | boolean>;
}

/**
 * How a mutation satisfies the audit requirement.
 *
 * `action` is prose, not a dotted code: Admin -> Audit Trail renders it verbatim
 * in the Action column and text-searches it, so `'Archived case'` is what the
 * requirement asks for and `'case.archived'` would be a leaked identifier. The
 * machine-readable counterpart already exists as the `TimelineEventType` enum.
 *
 * `skip` demands a reason in prose. Most exemptions are the same shape - a user
 * marking their own notifications read, whose audit value is nil and whose volume
 * would bury the entries that matter - and writing the reason at the definition
 * site turns "this mutation is not audited" from an omission nobody notices into a
 * decision somebody made.
 */
export type AuditSpec = { entity: AuditEntity; action: string } | { skip: string };

function isSkipped(spec: AuditSpec): spec is { skip: string } {
  return 'skip' in spec;
}

/** Per-definition configuration, supplied as extra fields on every function. */
interface FunctionConfig {
  /**
   * The permission this function requires, or `null` for one available to any
   * signed-in user - reading your own notifications, changing your own password.
   * `null` is a claim that the function is safe for a READ_ONLY stakeholder to
   * call, so it is stated explicitly rather than defaulted.
   */
  permission: Permission | null;
}

interface MutationConfig extends FunctionConfig {
  audit: AuditSpec;
  /**
   * Set for the mutations that exist to *resolve* a compliance obligation -
   * enrolling in MFA, changing an expired password. Everything else is refused
   * while an obligation is outstanding, and those two would otherwise be refused
   * along with it, leaving the user no way out.
   */
  allowNonCompliant?: boolean;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * A query that requires a signed-in caller, with `ctx.actor` resolved.
 *
 * No audit hook: queries cannot write. Read events that are genuinely auditable
 * (a confidential document opened, a report exported) go through
 * `api.audit.recordReadEvent`, which takes a closed action enum precisely so a
 * client cannot forge arbitrary history through it.
 */
export const authedQuery = customQuery(
  query,
  customCtxAndArgs({
    args: {},
    input: async (ctx, _args, config: FunctionConfig) => {
      const actor = await requireActor(ctx);
      if (config.permission !== null) requirePermission(actor, config.permission);
      return { ctx: { actor }, args: {} };
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * A mutation that requires a signed-in caller, enforces RBAC, and audits itself.
 *
 * The sequence is fixed: resolve identity, check the permission, check security
 * compliance, run the handler, then verify it audited.
 *
 *     export const archiveCase = authedMutation({
 *       permission: 'case.archive',
 *       audit: { entity: 'Case', action: 'Archived case' },
 *       args: { caseId: v.id('cases') },
 *       handler: async (ctx, { caseId }) => {
 *         const record = await loadAccessibleCase(ctx, caseId, ctx.actor.access);
 *         await ctx.db.patch(caseId, { archivedAt: new Date(Date.now()).toISOString() });
 *         await ctx.audit({ entityId: caseId, entityLabel: record.caseId });
 *       },
 *     });
 *
 * Note what is absent: no `actorId` argument. The client cannot say who it is, so
 * `(user|currentUser|actor)?.id ?? 'system'` - which appeared at ~25 call sites -
 * becomes an impossible state rather than a defended one.
 */
export const authedMutation = customMutation(
  mutation,
  customCtxAndArgs({
    args: {},
    input: async (ctx, _args, config: MutationConfig) => {
      const actor = await requireActor(ctx);
      if (config.permission !== null) requirePermission(actor, config.permission);

      if (config.allowNonCompliant !== true) await requireCompliance(ctx, actor.user);

      // Closed over by both `audit` and `onSuccess`, which is how the wrapper can
      // tell afterwards whether the handler recorded anything.
      let auditRows = 0;

      /**
       * One timestamp for every row this mutation writes.
       *
       * Stamped once here rather than per row. The Convex runtime does freeze
       * `Date.now()` for the duration of a transaction - verified against the
       * deployment, not assumed - so reading it per row would give the same
       * answer in production anyway. But `convex-test` does not emulate the
       * freeze, and more to the point the property wanted here is a statement
       * about the audit trail, not about the runtime: rows from one act describe
       * one act, and should carry one time. Making that true by construction
       * costs a line and removes a dependency on behaviour nothing documents.
       */
      const at = new Date(Date.now()).toISOString();

      /**
       * Records what this mutation did.
       *
       * Callable more than once - archiving a matter touches the case and its
       * documents, and both belong in the trail. Rows are written immediately and
       * therefore inside the transaction, so a handler that throws after auditing
       * leaves no row at all. That is correct: the audit log records what
       * happened, and a rolled-back mutation did not happen.
       *
       * The corollary is that **failure entries cannot be written from here.** A
       * `failure` outcome has to come from a non-transactional context - a Better
       * Auth hook for a rejected sign-in, an `httpAction` for a rejected API
       * call. Those are also the only places `ipAddress` and `userAgent` genuinely
       * exist, which is why they are `null` on rows written from a mutation rather
       * than being invented. The prototype hardcoded one fixed IP for every entry.
       */
      const audit = async (draft: AuditDraft) => {
        if (isSkipped(config.audit)) {
          throw new Error('This mutation declared `audit: { skip }` but recorded an audit row.');
        }
        auditRows += 1;
        await ctx.db.insert('auditLog', {
          at,
          actorId: actor.user._id,
          // Denormalised so the trail still reads correctly after the account is
          // renamed or removed. An audit log that resolves names by join stops
          // being evidence the moment the roster changes.
          actorLabel: actor.user.fullName,
          action: draft.action ?? config.audit.action,
          entity: draft.entity ?? config.audit.entity,
          entityId: draft.entityId,
          entityLabel: draft.entityLabel,
          ipAddress: null,
          userAgent: null,
          outcome: draft.outcome ?? 'success',
          metadata: draft.metadata ?? {},
        });
      };

      return {
        ctx: { actor, audit },
        args: {},
        /**
         * The audit requirement, enforced.
         *
         * Runtime rather than compile-time because the alternative - forcing every
         * handler to return its audit row alongside its result - would distort the
         * return type of all twenty-five mutations to police a mistake that shows
         * up on the very first invocation. And because `onSuccess` runs inside the
         * transaction, the throw rolls the write back: an unaudited mutation
         * cannot leave a change behind. The failure mode is a loud one in
         * development, not a silent gap in the trail during service.
         */
        onSuccess: async () => {
          if (!isSkipped(config.audit) && auditRows === 0) {
            throw new Error(
              `Mutation for ${config.audit.entity}/${config.audit.action} recorded no audit row. ` +
                'Call ctx.audit(...), or declare `audit: { skip: "<reason>" }`.',
            );
          }
        },
      };
    },
  }),
);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * The caller, as an action can hold them.
 *
 * An action has no `ctx.db`, so it cannot resolve the actor itself and cannot
 * carry the `Actor` the other two wrappers do - a document and a closure do not
 * survive the trip back from a query. What crosses is this: the identity, the
 * resolved permission set, and the session the request arrived on.
 *
 * The permission list is sent rather than recomputed because an action that ran
 * for thirty seconds must decide against the matrix as it was when the call was
 * authorised, not as it is now. A permission revoked mid-flight is the next
 * call's business.
 */
const actionActorShape = v.object({
  id: v.id('users'),
  label: v.string(),
  role: roleValidator,
  permissions: v.array(permissionValidator),
  authSessionId: v.union(v.string(), v.null()),
});

export interface ActionActor {
  id: Id<'users'>;
  label: string;
  role: Role;
  permissions: readonly Permission[];
  authSessionId: string | null;
  can: (permission: Permission) => boolean;
}

/**
 * The whole of `authedAction`'s access control, in a place that has a database.
 *
 * Internal, because it is a component of the wrapper rather than an endpoint: a
 * client calling it would learn its own permissions, which `api.auth.me` already
 * tells it, and could not use the answer for anything.
 *
 * It runs the identical sequence to `authedMutation` - identity, status, session
 * liveness, permission, compliance - by calling the identical functions. The two
 * wrappers share the enforcement rather than each implementing it, which is the
 * only way to be sure an action is not the softer door.
 */
export const actionGate = internalQuery({
  args: {
    permission: v.union(permissionValidator, v.null()),
    allowNonCompliant: v.boolean(),
  },
  returns: actionActorShape,
  handler: async (ctx, { permission, allowNonCompliant }) => {
    const actor = await requireActor(ctx);
    if (permission !== null) requirePermission(actor, permission);
    if (!allowNonCompliant) await requireCompliance(ctx, actor.user);

    return {
      id: actor.user._id,
      label: actor.user.fullName,
      role: actor.user.role,
      permissions: [...actor.permissions],
      authSessionId: actor.authSessionId,
    };
  },
});

/**
 * Writes one audit row on behalf of an action.
 *
 * `actorId` and `actorLabel` are arguments here, which is exactly the shape the
 * prototype was criticised for - and the difference is that this is an
 * `internalMutation`. It is unreachable from a client, and the only caller is the
 * wrapper below, which fills them from the gate's answer rather than from
 * anything the caller said about itself.
 */
export const writeActionAudit = internalMutation({
  args: {
    at: v.string(),
    actorId: v.id('users'),
    actorLabel: v.string(),
    action: v.string(),
    entity: auditEntityValidator,
    entityId: v.string(),
    entityLabel: v.string(),
    outcome: auditOutcomeValidator,
    metadata: auditMetadataValidator,
  },
  returns: v.null(),
  handler: async (ctx, row) => {
    await ctx.db.insert('auditLog', { ...row, ipAddress: null, userAgent: null });
    return null;
  },
});

/** The settings singleton, as an internal query - callable from actions/crons. */
export const internalLoadSettings = internalQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      backupSchedule: v.string(),
      backupRetentionDays: v.number(),
      digestFrequency: v.string(),
      reminderOffsetsHours: v.array(v.number()),
      sessionTimeoutMinutes: v.number(),
      retentionArchiveAfterYears: v.number(),
      retentionDeletionEnabled: v.boolean(),
      ocrEnabled: v.boolean(),
      smsEnabled: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const row = await ctx.db.query('settings').first();
    if (row === null) return null;
    return {
      backupSchedule: row.backupSchedule,
      backupRetentionDays: row.backupRetentionDays,
      digestFrequency: row.digestFrequency,
      reminderOffsetsHours: row.reminderOffsetsHours,
      sessionTimeoutMinutes: row.sessionTimeoutMinutes,
      retentionArchiveAfterYears: row.retentionArchiveAfterYears,
      retentionDeletionEnabled: row.retentionDeletionEnabled,
      ocrEnabled: row.ocrEnabled,
      smsEnabled: row.smsEnabled,
    };
  },
});

/**
 * An action that requires a signed-in caller, enforces RBAC, and audits itself.
 *
 * Actions exist in this backend for one reason: something has to happen that a
 * transaction cannot do - call Better Auth's adapter, reach a mail provider, read
 * a storage blob. `authedAction` is so that needing to leave the transaction does
 * not also mean leaving the access control behind.
 *
 * **Two differences from `authedMutation`, both consequences of not being a
 * transaction, and both worth knowing before writing one.**
 *
 * Audit rows commit as they are written, so a handler that fails halfway leaves
 * the rows it had already recorded. That is the right behaviour here and the
 * opposite of the mutation case: an action really may have completed half its
 * work - the account created, the invitation unsent - and a trail that erased the
 * half that happened would be worse than one that records both parts.
 *
 * And there is no rollback behind the "recorded no audit row" check. In a
 * mutation that throw undoes the write; here it can only fail the call after the
 * fact. It is still worth keeping as the same loud development-time signal, but an
 * action must be written so that its own steps are ordered and compensated - see
 * `bootstrap.ts` for the pattern.
 */
export const authedAction = customAction(
  action,
  customCtxAndArgs({
    args: {},
    input: async (ctx, _args, config: MutationConfig) => {
      const gated = await ctx.runQuery(internal.lib.functions.actionGate, {
        permission: config.permission,
        allowNonCompliant: config.allowNonCompliant ?? false,
      });

      const actor: ActionActor = {
        ...gated,
        // Rebuilt on this side rather than sent, because a function does not
        // serialise. Same answer, same source: the list the gate resolved.
        can: (permission) => gated.permissions.includes(permission),
      };

      let auditRows = 0;

      // Unlike a mutation, an action's clock runs: `Date.now()` advances across
      // every await. Stamping once here is what makes all the rows from one act
      // carry one time rather than the times of the steps that produced them.
      const at = new Date(Date.now()).toISOString();

      const audit = async (draft: AuditDraft) => {
        if (isSkipped(config.audit)) {
          throw new Error('This action declared `audit: { skip }` but recorded an audit row.');
        }
        auditRows += 1;
        await ctx.runMutation(internal.lib.functions.writeActionAudit, {
          at,
          actorId: actor.id,
          actorLabel: actor.label,
          action: draft.action ?? config.audit.action,
          entity: draft.entity ?? config.audit.entity,
          entityId: draft.entityId,
          entityLabel: draft.entityLabel,
          outcome: draft.outcome ?? 'success',
          metadata: draft.metadata ?? {},
        });
      };

      return {
        ctx: { actor, audit },
        args: {},
        onSuccess: async () => {
          if (!isSkipped(config.audit) && auditRows === 0) {
            throw new Error(
              `Action for ${config.audit.entity}/${config.audit.action} recorded no audit row. ` +
                'Call ctx.audit(...), or declare `audit: { skip: "<reason>" }`.',
            );
          }
        },
      };
    },
  }),
);

/** Handler context types, so helpers can accept a wrapped ctx by name. */
export type ActorQueryCtx = CustomCtx<typeof authedQuery>;
export type ActorMutationCtx = CustomCtx<typeof authedMutation>;
export type ActorActionCtx = CustomCtx<typeof authedAction>;

export type { Actor };
