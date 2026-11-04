import { v, type Infer } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, internalQuery } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import { authedMutation, authedQuery } from './lib/functions';
import { canAccessCase, loadAccessibleCase, type AccessActor } from './lib/access';
import { nowIso, recomputeCaseRollups } from './lib/rollups';
import { documentFormatValidator, ocrStatusValidator } from './shared/enums';

/**
 * HYPREP LCMS - the document register and the file store.
 *
 * Uploads are three steps, so that the heavy payload never crosses a function
 * boundary twice:
 *
 *   1. `generateUploadUrl` returns a Convex storage URL for this session.
 *   2. The client POSTs the file directly to that URL (Convex storage).
 *   3. `finalizeUpload` records the `storageId` + metadata in a transaction,
 *      bumps the owning matter's `documentCount`, and schedules OCR.
 *
 * A mutation can schedule an action; that is the correct pattern for a file
 * whose text extraction should happen after the record exists, not before.
 *
 * The register is visibility-scoped the same way every other collection is:
 * no access to the matter, no access to its documents.
 */

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

const versionInput = v.object({
  version: v.number(),
  uploadedById: v.id('users'),
  uploadedAt: v.string(),
  sizeBytes: v.number(),
  changeNote: v.string(),
  storageId: v.union(v.id('_storage'), v.null()),
  storageKey: v.string(),
});

const documentInput = v.object({
  caseId: v.id('cases'),
  name: v.string(),
  documentTypeId: v.id('documentTypes'),
  format: documentFormatValidator,
  confidential: v.boolean(),
  tags: v.array(v.string()),
  description: v.string(),
  sizeBytes: v.number(),
  storageId: v.union(v.id('_storage'), v.null()),
  storageKey: v.string(),
});

const listArgs = v.object({
  caseId: v.optional(v.id('cases')),
  documentTypeId: v.optional(v.id('documentTypes')),
  includeConfidential: v.optional(v.boolean()),
});

// ---------------------------------------------------------------------------
// Row projection
// ---------------------------------------------------------------------------

export function toDocumentRow(document: Doc<'documents'>) {
  return {
    id: document._id,
    caseId: document.caseId,
    name: document.name,
    documentTypeId: document.documentTypeId,
    format: document.format,
    currentVersion: document.currentVersion,
    versions: document.versions.map((version) => ({
      version: version.version,
      uploadedById: version.uploadedById,
      uploadedAt: version.uploadedAt,
      sizeBytes: version.sizeBytes,
      changeNote: version.changeNote,
      storageId: version.storageId,
      storageKey: version.storageKey,
    })),
    authorId: document.authorId,
    confidential: document.confidential,
    tags: document.tags,
    description: document.description,
    ocrText: document.ocrText,
    ocrStatus: document.ocrStatus,
    ocrAttempts: document.ocrAttempts,
    checkedOutById: document.checkedOutById,
    checkedOutAt: document.checkedOutAt,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

const documentRow = v.object({
  id: v.id('documents'),
  caseId: v.id('cases'),
  name: v.string(),
  documentTypeId: v.id('documentTypes'),
  format: v.string(),
  currentVersion: v.number(),
  versions: v.array(versionInput),
  authorId: v.id('users'),
  confidential: v.boolean(),
  tags: v.array(v.string()),
  description: v.string(),
  ocrText: v.union(v.string(), v.null()),
  ocrStatus: v.string(),
  ocrAttempts: v.number(),
  checkedOutById: v.union(v.id('users'), v.null()),
  checkedOutAt: v.union(v.string(), v.null()),
  createdAt: v.string(),
  updatedAt: v.string(),
});

// ---------------------------------------------------------------------------
// Access helpers
// ---------------------------------------------------------------------------

async function visibleDocumentIds(
  ctx: QueryCtx,
  actor: AccessActor,
): Promise<Set<Id<'documents'>>> {
  const all = await ctx.db.query('documents').collect();
  const visible = new Set<Id<'documents'>>();

  const caseIds = new Set<Id<'cases'>>();
  const byCase = new Map<Id<'documents'>, Id<'cases'>>();
  for (const document of all) {
    byCase.set(document._id, document.caseId);
    caseIds.add(document.caseId);
  }

  const visibleCaseIds = new Set<Id<'cases'>>();
  if (actor.permissions.has('case.view.all')) {
    const cases = await ctx.db.query('cases').collect();
    for (const record of cases) {
      if (canAccessCase(record, actor)) visibleCaseIds.add(record._id);
    }
  } else {
    const ids = await ctx.db
      .query('caseMembers')
      .withIndex('by_user', (q) => q.eq('userId', actor.userId))
      .collect();
    for (const row of ids) visibleCaseIds.add(row.caseId);
    for (const id of [...visibleCaseIds]) {
      const record = await ctx.db.get(id);
      if (record === null || !canAccessCase(record, actor)) visibleCaseIds.delete(id);
    }
  }

  for (const document of all) {
    if (visibleCaseIds.has(document.caseId)) visible.add(document._id);
  }

  return visible;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** The document register, visibility applied in the query. */
export const list = authedQuery({
  permission: 'document.view',
  args: listArgs,
  returns: v.array(documentRow),
  handler: async (ctx, args) => {
    const visible = await visibleDocumentIds(ctx, ctx.actor.access);
    const all = await ctx.db.query('documents').collect();

    const rows: Infer<typeof documentRow>[] = [];
    for (const document of all) {
      if (!visible.has(document._id)) continue;
      if (args.caseId && document.caseId !== args.caseId) continue;
      if (args.documentTypeId && document.documentTypeId !== args.documentTypeId) continue;
      if (args.includeConfidential === false && document.confidential) continue;
      rows.push(toDocumentRow(document));
    }

    return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },
});

/** The OCR on/off switch, read fresh so a toggle takes effect immediately. */
export const getOcrEnabled = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const settings = await ctx.db.query('settings').first();
    return settings?.ocrEnabled ?? false;
  },
});

/** One document row. */
export const get = authedQuery({
  permission: 'document.view',
  args: { id: v.id('documents') },
  returns: v.union(documentRow, v.null()),
  handler: async (ctx, { id }) => {
    const document = await ctx.db.get(id);
    if (document === null) return null;
    const record = await loadAccessibleCase(ctx, document.caseId, ctx.actor.access);
    if (record === null) return null;
    return toDocumentRow(document);
  },
});

/** A signed, expiring URL for the latest version of a document. */
export const getSignedUrl = authedQuery({
  permission: 'document.view',
  args: { id: v.id('documents') },
  returns: v.object({ url: v.union(v.string(), v.null()) }),
  handler: async (ctx, { id }) => {
    const document = await ctx.db.get(id);
    if (document === null) return { url: null };
    const record = await loadAccessibleCase(ctx, document.caseId, ctx.actor.access);
    if (record === null) return { url: null };

    const latest = document.versions.at(-1);
    if (!latest || latest.storageId === null) return { url: null };
    const url = await ctx.storage.getUrl(latest.storageId);
    return { url };
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Issues a one-shot storage upload URL. The URL is a Convex storage endpoint
 * and is only valid for the calling session; the client PUTs the file body to
 * it directly.
 */
export const generateUploadUrl = authedMutation({
  permission: 'document.upload',
  audit: { skip: 'The document is audited when finalizeUpload records it.' },
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Completes an upload: records the document row, bumps the matter's
 * `documentCount`, and schedules OCR so the text becomes searchable.
 */
export const finalizeUpload = authedMutation({
  permission: 'document.upload',
  audit: { entity: 'Document', action: 'Filed document' },
  args: { input: documentInput },
  handler: async (ctx, { input }) => {
    const record = await loadAccessibleCase(ctx, input.caseId, ctx.actor.access);
    const at = nowIso();
    const firstVersion: Infer<typeof versionInput> = {
      version: 1,
      uploadedById: ctx.actor.user._id,
      uploadedAt: at,
      sizeBytes: input.sizeBytes,
      changeNote: 'Initial filing',
      storageId: input.storageId,
      storageKey: input.storageKey,
    };

    const id = await ctx.db.insert('documents', {
      caseId: input.caseId,
      name: input.name,
      documentTypeId: input.documentTypeId,
      format: input.format,
      currentVersion: 1,
      versions: [firstVersion],
      authorId: ctx.actor.user._id,
      confidential: input.confidential,
      tags: input.tags,
      description: input.description,
      ocrText: null,
      ocrStatus: 'queued',
      ocrAttempts: 0,
      checkedOutById: null,
      checkedOutAt: null,
      createdAt: at,
      updatedAt: at,
    });

    await recomputeCaseRollups(ctx, input.caseId);

    // OCR runs outside the transaction, against the provider. Schedule it here
    // (a mutation may schedule an action) so the file is queued the moment the
    // record exists.
    await ctx.scheduler.runAfter(0, internal.ocr.extract, { documentId: id });

    await ctx.audit({
      entityId: input.caseId,
      entityLabel: record.caseId,
      metadata: {
        documentId: id,
        name: input.name,
        storageId: input.storageId ? input.storageId : '',
      },
    });

    return { id, caseId: input.caseId };
  },
});

/** Adds a new version to an existing document (a revised filing). */
export const addDocumentVersion = authedMutation({
  permission: 'document.version.manage',
  audit: { entity: 'Document', action: 'Added document version' },
  args: {
    id: v.id('documents'),
    changeNote: v.string(),
    sizeBytes: v.number(),
    storageId: v.union(v.id('_storage'), v.null()),
    storageKey: v.string(),
  },
  handler: async (ctx, { id, changeNote, sizeBytes, storageId, storageKey }) => {
    const document = await ctx.db.get(id);
    if (document === null) throw new Error('Document not found');
    const record = await loadAccessibleCase(ctx, document.caseId, ctx.actor.access);
    const at = nowIso();

    const version: Infer<typeof versionInput> = {
      version: document.currentVersion + 1,
      uploadedById: ctx.actor.user._id,
      uploadedAt: at,
      sizeBytes,
      changeNote,
      storageId,
      storageKey,
    };

    await ctx.db.patch(id, {
      currentVersion: version.version,
      versions: [...document.versions, version],
      ocrStatus: 'queued',
      ocrAttempts: 0,
      updatedAt: at,
    });

    await recomputeCaseRollups(ctx, document.caseId);

    await ctx.scheduler.runAfter(0, internal.ocr.extract, { documentId: id });

    await ctx.audit({
      entityId: document.caseId,
      entityLabel: record.caseId,
      metadata: { documentId: id, version: version.version },
    });

    return { id, caseId: document.caseId, version: version.version };
  },
});

/** Locks or unlocks a document for collaborative editing. */
export const toggleCheckOut = authedMutation({
  permission: 'document.upload',
  audit: { entity: 'Document', action: 'Checked out document' },
  args: { id: v.id('documents') },
  handler: async (ctx, { id }) => {
    const document = await ctx.db.get(id);
    if (document === null) throw new Error('Document not found');
    const record = await loadAccessibleCase(ctx, document.caseId, ctx.actor.access);
    const at = nowIso();

    const checkedOutById = document.checkedOutById === ctx.actor.user._id ? null : ctx.actor.user._id;
    const checkedOutAt = checkedOutById === null ? null : at;

    await ctx.db.patch(id, { checkedOutById, checkedOutAt, updatedAt: at });

    await ctx.audit({
      entityId: document.caseId,
      entityLabel: record.caseId,
      metadata: { documentId: id, checkedOutById: checkedOutById ?? '' },
    });

    return { id, caseId: document.caseId, checkedOutById, checkedOutAt };
  },
});

/** Removes a document from the register. Does not delete the stored file. */
export const deleteDocument = authedMutation({
  permission: 'document.delete',
  audit: { entity: 'Document', action: 'Deleted document' },
  args: { id: v.id('documents') },
  handler: async (ctx, { id }) => {
    const document = await ctx.db.get(id);
    if (document === null) throw new Error('Document not found');
    const record = await loadAccessibleCase(ctx, document.caseId, ctx.actor.access);

    await ctx.db.delete(id);
    await recomputeCaseRollups(ctx, document.caseId);

    await ctx.audit({
      entityId: document.caseId,
      entityLabel: record.caseId,
      metadata: { documentId: id, name: document.name },
    });

    return { id, caseId: document.caseId };
  },
});

// ---------------------------------------------------------------------------
// Internal surface (OCR)
// ---------------------------------------------------------------------------

/**
 * Loads a document for the OCR worker. Runs as system (no actor), so it skips
 * the visibility checks a client call would hit and returns exactly the fields
 * the worker needs.
 */
export const internalGetDocumentForOcr = internalQuery({
  args: { id: v.id('documents') },
  returns: v.union(
    v.object({
      format: documentFormatValidator,
      ocrAttempts: v.number(),
      versions: v.array(
        v.object({
          storageId: v.union(v.id('_storage'), v.null()),
          version: v.number(),
        }),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx, { id }) => {
    const document = await ctx.db.get(id);
    if (document === null) return null;
    return {
      format: document.format,
      ocrAttempts: document.ocrAttempts,
      versions: document.versions.map((version) => ({
        storageId: version.storageId,
        version: version.version,
      })),
    };
  },
});

/** The queued/processing/failed documents, for the OCR requeue cron. */
export const internalPendingOcr = internalQuery({
  args: { statuses: v.array(ocrStatusValidator), limit: v.optional(v.number()) },
  returns: v.array(v.id('documents')),
  handler: async (ctx, { statuses, limit }) => {
    const all = await ctx.db.query('documents').collect();
    const pending = all
      .filter((document) => statuses.includes(document.ocrStatus) && document.ocrAttempts < 3)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((document) => document._id);
    return limit ? pending.slice(0, limit) : pending;
  },
});

/**
 * Marks a document's OCR state. Called by the OCR worker. `ocrStatus` flips to
 * `completed` with the extracted text, or `failed` after the attempt budget.
 */
export const internalSetOcrResult = internalMutation({
  args: {
    documentId: v.id('documents'),
    ocrStatus: ocrStatusValidator,
    ocrText: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { documentId, ocrStatus, ocrText }) => {
    const document = await ctx.db.get(documentId);
    if (document === null) return null;
    await ctx.db.patch(documentId, {
      ocrStatus,
      ocrText,
      ocrAttempts: document.ocrAttempts + 1,
      updatedAt: nowIso(),
    });
    return null;
  },
});
