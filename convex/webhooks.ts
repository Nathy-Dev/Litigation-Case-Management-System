import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';

/**
 * HYPREP LCMS - outbound webhooks (TOR section 33).
 *
 * When a domain event commits (a case created, a status changed, a hearing
 * rescheduled), the emitting mutation calls `internal.webhooks.dispatch` to
 * enqueue one delivery per matching endpoint. The actual HTTP send happens in
 * `deliver` (an action, because it must leave the transaction), signed with
 * HMAC-SHA256 over `timestamp.body` in the `X-LCMS-Signature` header. Failures
 * are retried by the webhook-retry cron with exponential backoff and abandoned
 * after the attempt budget.
 */

const MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 60_000;

/** Builds the HMAC-SHA256 signature a receiver can verify. */
async function sign(secret: string, body: string, timestamp: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  return Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Dispatch (called by emitting mutations, inside their transaction)
// ---------------------------------------------------------------------------

/**
 * Enqueues one delivery row per active endpoint subscribed to `event`.
 *
 * Runs as an internal mutation so a domain mutation can call it in the same
 * transaction; the HTTP send itself is deferred to `deliver` after commit.
 */
export const dispatch = internalMutation({
  args: {
    event: v.string(),
    payload: v.any(),
    at: v.string(),
  },
  handler: async (ctx, { event, payload, at }) => {
    const endpoints = await ctx.db.query('webhookEndpoints').collect();
    const targets = endpoints.filter((endpoint) => endpoint.active && endpoint.events.includes(event));
    let queued = 0;
    for (const endpoint of targets) {
      await ctx.db.insert('webhookDeliveries', {
        endpointId: endpoint._id,
        event,
        payload: JSON.stringify(payload),
        status: 'pending',
        attempts: 0,
        nextAttemptAt: at,
        lastError: null,
        responseStatus: null,
        createdAt: at,
        deliveredAt: null,
      });
      await ctx.db.patch(endpoint._id, { lastDeliveryAt: at, failureCount: endpoint.failureCount });
      queued += 1;
    }
    return { queued };
  },
});

// ---------------------------------------------------------------------------
// Delivery (an action - the only place that may POST)
// ---------------------------------------------------------------------------

/** Sends one delivery, signs it, and records the outcome for the retry cron. */
export const deliver = internalAction({
  args: { deliveryId: v.id('webhookDeliveries'), now: v.string() },
  returns: v.object({
    skipped: v.optional(v.boolean()),
    ok: v.optional(v.boolean()),
    status: v.optional(
      v.union(v.literal('pending'), v.literal('delivered'), v.literal('failed'), v.literal('abandoned')),
    ),
    attempts: v.optional(v.number()),
  }),
  handler: async (
    ctx,
    { deliveryId, now },
  ): Promise<{
    skipped?: boolean;
    ok?: boolean;
    status?: 'pending' | 'delivered' | 'failed' | 'abandoned';
    attempts?: number;
  }> => {
    const delivery = await ctx.runQuery(internal.webhooks.getDelivery, { deliveryId });
    if (delivery === null || delivery.status !== 'pending') return { skipped: true };

    const endpoint = delivery.endpoint;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await sign(endpoint.secret, delivery.payload, timestamp);
    const body = delivery.payload;

    let responseStatus: number | null = null;
    let ok = false;
    let error: string | null = null;
    try {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-lcms-signature': signature,
          'x-lcms-timestamp': timestamp,
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      responseStatus = response.status;
      ok = response.ok;
      if (!ok) error = `HTTP ${response.status}`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }

    const attempts = delivery.attempts + 1;
    const finalAttempt = attempts >= MAX_ATTEMPTS;
    const status = ok || finalAttempt ? (ok ? 'delivered' : 'failed') : 'pending';
    const nextAttemptAt = ok
      ? null
      : finalAttempt
        ? null
        : new Date(Date.now() + RETRY_BASE_MS * 2 ** (attempts - 1)).toISOString();

    await ctx.runMutation(internal.webhooks.recordDelivery, {
      deliveryId,
      status,
      attempts,
      nextAttemptAt,
      lastError: error,
      responseStatus,
      deliveredAt: ok ? now : null,
      endpointFailure: !ok,
    });

    return { ok, status, attempts };
  },
});

// ---------------------------------------------------------------------------
// Internal surface
// ---------------------------------------------------------------------------

/** One delivery joined with its endpoint, for the delivery worker. */
export const getDelivery = internalQuery({
  args: { deliveryId: v.id('webhookDeliveries') },
  handler: async (ctx, { deliveryId }) => {
    const delivery = await ctx.db.get(deliveryId);
    if (delivery === null) return null;
    const endpoint = await ctx.db.get(delivery.endpointId);
    if (endpoint === null) return null;
    return {
      id: delivery._id,
      status: delivery.status,
      attempts: delivery.attempts,
      payload: delivery.payload,
      endpoint: {
        url: endpoint.url,
        secret: endpoint.secret,
      },
    };
  },
});

/** The pending deliveries whose retry window has opened. */
export const dueDeliveries = internalQuery({
  args: { now: v.string() },
  handler: async (ctx, { now }) => {
    const rows = await ctx.db
      .query('webhookDeliveries')
      .withIndex('by_status_nextAttemptAt', (q) =>
        q.eq('status', 'pending').lte('nextAttemptAt', now),
      )
      .collect();
    return rows.map((row) => row._id);
  },
});

/** Records a delivery's outcome and updates the endpoint's failure count. */
export const recordDelivery = internalMutation({
  args: {
    deliveryId: v.id('webhookDeliveries'),
    status: v.union(v.literal('pending'), v.literal('delivered'), v.literal('failed'), v.literal('abandoned')),
    attempts: v.number(),
    nextAttemptAt: v.union(v.string(), v.null()),
    lastError: v.union(v.string(), v.null()),
    responseStatus: v.union(v.number(), v.null()),
    deliveredAt: v.union(v.string(), v.null()),
    endpointFailure: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.deliveryId, {
      status: args.status,
      attempts: args.attempts,
      nextAttemptAt: args.nextAttemptAt,
      lastError: args.lastError,
      responseStatus: args.responseStatus,
      deliveredAt: args.deliveredAt,
    });
    if (args.endpointFailure) {
      const delivery = await ctx.db.get(args.deliveryId);
      if (delivery !== null) {
        const endpoint = await ctx.db.get(delivery.endpointId);
        if (endpoint !== null) {
          await ctx.db.patch(endpoint._id, { failureCount: endpoint.failureCount + 1 });
        }
      }
    }
    return null;
  },
});
