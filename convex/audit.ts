import { v } from 'convex/values';
import { authedMutation, authedQuery } from './lib/functions';
import {
  auditEntityValidator,
  auditMetadataValidator,
  auditOutcomeValidator,
  auditReadActionValidator,
} from './shared/enums';

/**
 * HYPREP LCMS - the audit trail (TOR section 17).
 *
 * The trail is append-only and admin-only: every read here is paginated and
 * indexed, and nothing in this module edits or deletes a row. Rows are written
 * by the mutation wrapper (`lib/functions.ts`) for write events and by Better
 * Auth hooks / HTTP handlers for failure events, which are the only places the
 * network context that makes a failure row meaningful actually exists.
 *
 * `recordReadEvent` is the deliberate exception to "queries cannot write":
 * viewing a confidential document or exporting a report is genuinely auditable
 * but happens in a read. It takes a *closed* action enum so a client can record
 * the events the product declares but cannot forge arbitrary history through it.
 */

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

const auditRow = v.object({
  id: v.id('auditLog'),
  at: v.string(),
  actorId: v.union(v.id('users'), v.null()),
  actorLabel: v.string(),
  action: v.string(),
  entity: auditEntityValidator,
  entityId: v.string(),
  entityLabel: v.string(),
  ipAddress: v.union(v.string(), v.null()),
  userAgent: v.union(v.string(), v.null()),
  outcome: auditOutcomeValidator,
  metadata: auditMetadataValidator,
});

const auditListResult = v.object({
  rows: v.array(auditRow),
  total: v.number(),
  page: v.number(),
  pageSize: v.number(),
  pageCount: v.number(),
});

const auditListArgs = v.object({
  page: v.optional(v.number()),
  pageSize: v.optional(v.number()),
  entity: v.optional(auditEntityValidator),
  actorId: v.optional(v.id('users')),
  outcome: v.optional(auditOutcomeValidator),
  actionContains: v.optional(v.string()),
  from: v.optional(v.string()),
  to: v.optional(v.string()),
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Paginated audit trail for Admin -> Audit. Gated on `audit.view`. */
export const list = authedQuery({
  permission: 'audit.view',
  args: auditListArgs,
  returns: auditListResult,
  handler: async (ctx, args) => {
    const page = Math.max(1, args.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, args.pageSize ?? 50));
    const from = args.from ?? '\u0000';
    const to = args.to ?? '\uffff';

    // The audit trail is append-only, so a full ordered scan is the cheapest
    // honest read for a paginated admin page; entity/actor/outcome narrowing
    // happens on the page-sized slice, and the page size is bounded at 200.
    let rows = await ctx.db.query('auditLog').collect();
    rows.sort((a, b) => b.at.localeCompare(a.at));

    rows = rows.filter((row) => {
      if (row.at < from || row.at > to) return false;
      if (args.entity !== undefined && row.entity !== args.entity) return false;
      if (args.actorId !== undefined && row.actorId !== args.actorId) return false;
      if (args.outcome !== undefined && row.outcome !== args.outcome) return false;
      if (
        args.actionContains !== undefined &&
        !row.action.toLowerCase().includes(args.actionContains.toLowerCase())
      )
        return false;
      return true;
    });

    const total = rows.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const slice = rows.slice((page - 1) * pageSize, page * pageSize);

    return {
      rows: slice.map((row) => ({
        id: row._id,
        at: row.at,
        actorId: row.actorId,
        actorLabel: row.actorLabel,
        action: row.action,
        entity: row.entity,
        entityId: row.entityId,
        entityLabel: row.entityLabel,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        outcome: row.outcome,
        metadata: row.metadata,
      })),
      total,
      page,
      pageSize,
      pageCount,
    };
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Records a read event (document viewed/downloaded, report viewed/exported,
 * audit exported). The action is constrained to the `AUDIT_READ_ACTIONS` enum,
 * so this is the one mutation whose audit row is written by the wrapper itself
 * about the event the handler describes - never a free-text channel.
 */
export const recordReadEvent = authedMutation({
  permission: null,
  audit: { entity: 'Document', action: 'Read event' },
  args: {
    action: auditReadActionValidator,
    entityId: v.string(),
    entityLabel: v.string(),
    entity: v.optional(auditEntityValidator),
  },
  handler: async (ctx, { action, entityId, entityLabel, entity }) => {
    await ctx.audit({
      entityId,
      entityLabel,
      entity: entity ?? 'Document',
      action,
      metadata: { readAction: action },
    });
    return { recorded: true };
  },
});
