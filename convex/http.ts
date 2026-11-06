import { httpRouter } from 'convex/server';
import { httpAction, type ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import { authComponent, createAuth } from './auth';

/**
 * HYPREP LCMS - the HTTP surface.
 *
 * Everything in this deployment that is reached by something other than a
 * Convex client arrives here: Better Auth's own endpoints and the versioned
 * REST API (TOR section 33). Convex serves this router from the deployment's
 * *site* URL (`CONVEX_SITE_URL`), a different host from the one the client's
 * WebSocket connects to.
 *
 * The HTTP boundary matters for a second reason: it is the only context in this
 * backend that is not a transaction, which makes it the only place a *failed*
 * attempt can be recorded (a throw inside a mutation takes its own audit row
 * down with it).
 */

const http = httpRouter();

function fileResponse(request: Request, body: BodyInit | null, status: number, headers = new Headers()): Response {
  const allowed = [process.env.SITE_URL ?? 'http://localhost:5173', ...(process.env.FRONTEND_ORIGINS ?? '').split(',')]
    .map((value) => { try { return new URL(value.trim()).origin; } catch { return null; } });
  const origin = request.headers.get('origin');
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Vary', 'Origin');
  if (origin && allowed.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Expose-Headers', 'Content-Disposition');
  }
  return new Response(body, { status, headers });
}

http.route({ pathPrefix: '/exports/', method: 'GET', handler: httpAction(async (ctx, request) => {
  const token = new URL(request.url).pathname.slice('/exports/'.length);
  if (!/^[a-f0-9-]{36}$/.test(token)) return fileResponse(request, 'Not found', 404);
  const ticket = await ctx.runQuery(internal.backupDb.readArchiveTicket, { token });
  if (!ticket) return fileResponse(request, 'Link expired or access revoked', 403);
  const file = await ctx.storage.get(ticket.storageId);
  if (!file) return fileResponse(request, 'Archive unavailable', 404);
  const headers = new Headers({ 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(ticket.filename)}` });
  return fileResponse(request, file, 200, headers);
}) });

http.route({ pathPrefix: '/files/', method: 'GET', handler: httpAction(async (ctx, request) => {
  const token = new URL(request.url).pathname.slice('/files/'.length);
  if (!/^[a-f0-9-]{36}$/.test(token)) return fileResponse(request, 'Not found', 404);
  const ticket = await ctx.runQuery(internal.documents.readFileTicket, { token });
  if (!ticket) return fileResponse(request, 'Link expired or access revoked.', 403);
  const file = await ctx.storage.get(ticket.storageId);
  if (!file) return fileResponse(request, 'File unavailable', 404);
  const headers = new Headers({ 'Content-Type': ticket.inline ? ticket.contentType : file.type || 'application/octet-stream', 'Content-Disposition': `${ticket.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(ticket.name)}` });
  if (ticket.inline) headers.set('Content-Security-Policy', "sandbox; default-src 'none'");
  return fileResponse(request, file, 200, headers);
}) });

/** Better Auth's endpoints, mounted under `/api/auth`. */
authComponent.registerRoutes(http, createAuth, { cors: true });

// ---------------------------------------------------------------------------
// REST API v1
// ---------------------------------------------------------------------------

/** Parses `lcms_<keyId>_<secret>` from the Authorization header, or null. */
function parseBearer(authHeader: string | null): { keyId: string; secret: string } | null {
  if (!authHeader) return null;
  const match = /^Bearer\s+lcms_([A-Za-z0-9]+)_([A-Za-z0-9+/=]+)$/.exec(authHeader.trim());
  if (!match) return null;
  return { keyId: match[1]!, secret: match[2]! };
}

/** Constant-time equality, so a timing probe cannot learn the stored hash. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** SHA-256 hex of a secret, the only form stored in `apiKeys`. */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const API_ERRORS = {
  UNAUTHORIZED: () => json({ error: 'invalid or missing API key' }, 401),
  FORBIDDEN: () => json({ error: 'insufficient scope' }, 403),
  RATE_LIMITED: (retryAfterMs: number) =>
    json({ error: 'rate limit exceeded', retryAfterMs }, 429),
  NOT_FOUND: () => json({ error: 'not found' }, 404),
} as const;

/**
 * Authenticates the request, checks the scope, and consumes one rate-limit
 * token. Returns the authenticated key row on success, or a Response to return.
 */
async function authorize(
  ctx: ActionCtx,
  request: Request,
  scope: string,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const parsed = parseBearer(request.headers.get('authorization'));
  if (parsed === null) return { ok: false, response: API_ERRORS.UNAUTHORIZED() };

  const key = await ctx.runQuery(internal.api.keyByKeyId, { keyId: parsed.keyId });
  if (key === null) return { ok: false, response: API_ERRORS.UNAUTHORIZED() };
  if (key.revokedAt !== null) return { ok: false, response: API_ERRORS.UNAUTHORIZED() };
  if (key.expiresAt !== null && key.expiresAt < new Date().toISOString()) {
    return { ok: false, response: API_ERRORS.UNAUTHORIZED() };
  }
  if (!key.scopes.includes(scope)) return { ok: false, response: API_ERRORS.FORBIDDEN() };

  const computed = await sha256Hex(parsed.secret);
  if (!timingSafeEqual(computed, key.hashedSecret)) {
    return { ok: false, response: API_ERRORS.UNAUTHORIZED() };
  }

  // Consume a rate-limit token for this key.
  const limited = await ctx.runMutation(internal.api.consumeRateLimit, {
    keyId: parsed.keyId,
    at: new Date().toISOString(),
  });
  if (!limited.ok) return { ok: false, response: API_ERRORS.RATE_LIMITED(limited.retryAfterMs) };

  return { ok: true };
}

/** GET /api/v1/cases */
const getCases = httpAction(async (ctx, request) => {
  const auth = await authorize(ctx, request, 'cases:read');
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const page = Number(url.searchParams.get('page') ?? '1');
  const pageSize = Number(url.searchParams.get('pageSize') ?? '50');
  const result = await ctx.runQuery(internal.api.listCases, { page, pageSize });
  return json(result);
});

/** GET /api/v1/cases/:id */
const getCaseById = httpAction(async (ctx, request) => {
  const auth = await authorize(ctx, request, 'cases:read');
  if (!auth.ok) return auth.response;
  const id = request.url.split('/').at(-1) ?? '';
  const result = await ctx.runQuery(internal.api.getCase, { caseId: id as never });
  if (result === null) return API_ERRORS.NOT_FOUND();
  return json(result);
});

/** GET /api/v1/hearings */
const getHearings = httpAction(async (ctx, request) => {
  const auth = await authorize(ctx, request, 'hearings:read');
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const from = url.searchParams.get('from') ?? undefined;
  const to = url.searchParams.get('to') ?? undefined;
  const caseId = url.searchParams.get('caseId') ?? undefined;
  const result = await ctx.runQuery(internal.api.listHearings, {
    from,
    to,
    caseId: caseId as never,
  });
  return json(result);
});

/** GET /api/v1/documents */
const getDocuments = httpAction(async (ctx, request) => {
  const auth = await authorize(ctx, request, 'documents:read');
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const caseId = url.searchParams.get('caseId') ?? undefined;
  const result = await ctx.runQuery(internal.api.listDocuments, {
    caseId: caseId as never,
  });
  return json(result);
});

http.route({ path: '/api/v1/cases', method: 'GET', handler: getCases });
http.route({ pathPrefix: '/api/v1/cases/', method: 'GET', handler: getCaseById });
http.route({ path: '/api/v1/hearings', method: 'GET', handler: getHearings });
http.route({ path: '/api/v1/documents', method: 'GET', handler: getDocuments });

export default http;
