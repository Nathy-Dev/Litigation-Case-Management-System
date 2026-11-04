import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { components } from './_generated/api';
import { RateLimiter } from '@convex-dev/rate-limiter';
import { loadCourt, loadCaseType, loadUser, toCourtDateSummary } from './lib/rows';
import { courtDateSummary } from './shared/query';

/**
 * HYPREP LCMS - the read surface for the public REST API.
 *
 * The REST layer (`http.ts`) cannot authenticate as a staff user, so it cannot
 * call the authed queries the SPA uses. Instead it authenticates an API key at
 * the HTTP boundary and then reads through these internal queries, which apply
 * no row-level visibility (an API key with `cases:read` is scoped to the whole
 * register by design - the key itself is the access control, provisioned by an
 * administrator).
 */

// ---------------------------------------------------------------------------
// API-key validation
// ---------------------------------------------------------------------------

/** Looks up an API key by its `keyId` half, for the constant-time compare. */
export const keyByKeyId = internalQuery({
  args: { keyId: v.string() },
  handler: async (ctx, { keyId }) => {
    const row = await ctx.db.query('apiKeys').withIndex('by_keyId', (q) => q.eq('keyId', keyId)).unique();
    if (row === null) return null;
    return {
      id: row._id,
      keyId: row.keyId,
      hashedSecret: row.hashedSecret,
      scopes: row.scopes,
      revokedAt: row.revokedAt,
      expiresAt: row.expiresAt,
      lastUsedAt: row.lastUsedAt,
    };
  },
});

/** Records an API key's last use. Called after a successful key check. */
export const touchKey = internalMutation({
  args: { keyId: v.id('apiKeys'), at: v.string() },
  handler: async (ctx, { keyId, at }) => {
    const row = await ctx.db.get(keyId);
    if (row === null) return null;
    await ctx.db.patch(keyId, { lastUsedAt: at });
    return null;
  },
});

/** The per-key request throttle: 120 requests per minute per key. */
const rateLimiter = new RateLimiter(components.rateLimiter, {
  apiKey: { kind: 'token bucket', rate: 120, period: 60_000, capacity: 120 },
});

/**
 * Consumes one token from a key's bucket. Called by the HTTP layer after the
 * key is validated, so a rejected key cannot spend the bucket.
 */
export const consumeRateLimit = internalMutation({
  args: { keyId: v.string(), at: v.string() },
  returns: v.object({ ok: v.boolean(), retryAfterMs: v.number() }),
  handler: async (ctx, { keyId }) => {
    const result = await rateLimiter.limit(ctx, 'apiKey', { key: keyId });
    return { ok: result.ok, retryAfterMs: result.retryAfter ?? 0 };
  },
});

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

const caseLite = v.object({
  id: v.id('cases'),
  caseId: v.string(),
  title: v.string(),
  suitNumber: v.union(v.string(), v.null()),
  status: v.string(),
  priority: v.string(),
  filingDate: v.union(v.string(), v.null()),
  claimValue: v.union(v.number(), v.null()),
  courtName: v.string(),
  caseTypeName: v.string(),
  ownerName: v.union(v.string(), v.null()),
  nextHearingAt: v.union(v.string(), v.null()),
  updatedAt: v.string(),
});

/** The register, as the API exposes it: paged, newest-updated first. */
export const listCases = internalQuery({
  args: { page: v.optional(v.number()), pageSize: v.optional(v.number()) },
  returns: v.object({
    rows: v.array(caseLite),
    total: v.number(),
    page: v.number(),
    pageSize: v.number(),
  }),
  handler: async (ctx, { page = 1, pageSize = 50 }) => {
    const size = Math.min(Math.max(pageSize, 1), 100);
    const offset = Math.max(page - 1, 0) * size;
    const all = await ctx.db.query('cases').order('desc').collect();
    const rows = all.slice(offset, offset + size);
    const out = [];
    for (const record of rows) {
      const court = await loadCourt(ctx, record.courtId);
      const type = await loadCaseType(ctx, record.caseTypeId);
      const owner = await loadUser(ctx, record.matterOwnerId);
      out.push({
        id: record._id,
        caseId: record.caseId,
        title: record.title,
        suitNumber: record.suitNumber,
        status: record.status,
        priority: record.priority,
        filingDate: record.filingDate,
        claimValue: record.claimValue,
        courtName: court?.name ?? '—',
        caseTypeName: type?.name ?? '—',
        ownerName: owner?.fullName ?? null,
        nextHearingAt: record.nextHearingAt,
        updatedAt: record.updatedAt,
      });
    }
    return { rows: out, total: all.length, page, pageSize: size };
  },
});

/** One case, full shape, plus its hearings and documents counts. */
export const getCase = internalQuery({
  args: { caseId: v.id('cases') },
  returns: v.union(
    v.object({
      id: v.id('cases'),
      caseId: v.string(),
      title: v.string(),
      suitNumber: v.union(v.string(), v.null()),
      status: v.string(),
      priority: v.string(),
      summary: v.string(),
      reliefSought: v.string(),
      filingDate: v.union(v.string(), v.null()),
      claimValue: v.union(v.number(), v.null()),
      presidingJudge: v.union(v.string(), v.null()),
      courtName: v.string(),
      caseTypeName: v.string(),
      ownerName: v.union(v.string(), v.null()),
      assigneeNames: v.array(v.string()),
      tags: v.array(v.string()),
      nextHearingAt: v.union(v.string(), v.null()),
      lastHearingAt: v.union(v.string(), v.null()),
      documentCount: v.number(),
      openTaskCount: v.number(),
      overdueTaskCount: v.number(),
      updatedAt: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, { caseId }) => {
    const record = await ctx.db.get(caseId);
    if (record === null) return null;
    const court = await loadCourt(ctx, record.courtId);
    const type = await loadCaseType(ctx, record.caseTypeId);
    const owner = await loadUser(ctx, record.matterOwnerId);
    const assignees = [];
    for (const id of record.assigneeIds) {
      const user = await loadUser(ctx, id);
      if (user) assignees.push(user.fullName);
    }
    return {
      id: record._id,
      caseId: record.caseId,
      title: record.title,
      suitNumber: record.suitNumber,
      status: record.status,
      priority: record.priority,
      summary: record.summary,
      reliefSought: record.reliefSought,
      filingDate: record.filingDate,
      claimValue: record.claimValue,
      presidingJudge: record.presidingJudge,
      courtName: court?.name ?? '—',
      caseTypeName: type?.name ?? '—',
      ownerName: owner?.fullName ?? null,
      assigneeNames: assignees,
      tags: record.tags,
      nextHearingAt: record.nextHearingAt,
      lastHearingAt: record.lastHearingAt,
      documentCount: record.documentCount,
      openTaskCount: record.openTaskCount,
      overdueTaskCount: record.overdueTaskCount,
      updatedAt: record.updatedAt,
    };
  },
});

// ---------------------------------------------------------------------------
// Hearings
// ---------------------------------------------------------------------------

/** The diary, as the API exposes it: range-filtered, upcoming first. */
export const listHearings = internalQuery({
  args: {
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    caseId: v.optional(v.id('cases')),
    limit: v.optional(v.number()),
  },
  returns: v.array(courtDateSummary),
  handler: async (ctx, { from, to, caseId, limit = 100 }) => {
    const base =
      from || to
        ? ctx.db.query('courtDates').withIndex('by_startsAt', (q) => {
            if (from && to) return q.gte('startsAt', from).lte('startsAt', to);
            if (from) return q.gte('startsAt', from);
            return q.lte('startsAt', to!);
          })
        : ctx.db.query('courtDates');
    const all = await base.collect();
    const filtered = all
      .filter((sitting) => (caseId ? sitting.caseId === caseId : true))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .slice(0, limit);
    return filtered.map(toCourtDateSummary);
  },
});

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

const documentLite = v.object({
  id: v.id('documents'),
  caseId: v.id('cases'),
  name: v.string(),
  format: v.string(),
  ocrStatus: v.string(),
  authorId: v.id('users'),
  createdAt: v.string(),
  versionCount: v.number(),
});

/** The document ledger, as the API exposes it: newest first. */
export const listDocuments = internalQuery({
  args: {
    caseId: v.optional(v.id('cases')),
    limit: v.optional(v.number()),
  },
  returns: v.array(documentLite),
  handler: async (ctx, { caseId, limit = 100 }) => {
    const all = caseId
      ? await ctx.db.query('documents').withIndex('by_case', (q) => q.eq('caseId', caseId)).collect()
      : await ctx.db.query('documents').collect();
    return all
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((doc) => ({
        id: doc._id,
        caseId: doc.caseId,
        name: doc.name,
        format: doc.format,
        ocrStatus: doc.ocrStatus,
        authorId: doc.authorId,
        createdAt: doc.createdAt,
        versionCount: doc.versions.length,
      }));
  },
});

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/** The active webhook endpoints, for the API management surface. */
export const listWebhookEndpoints = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      id: v.id('webhookEndpoints'),
      url: v.string(),
      description: v.string(),
      events: v.array(v.string()),
      active: v.boolean(),
      failureCount: v.number(),
      lastDeliveryAt: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db.query('webhookEndpoints').collect();
    return rows.map((row) => ({
      id: row._id,
      url: row.url,
      description: row.description,
      events: row.events,
      active: row.active,
      failureCount: row.failureCount,
      lastDeliveryAt: row.lastDeliveryAt,
    }));
  },
});
