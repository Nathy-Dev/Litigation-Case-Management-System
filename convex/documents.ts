import { v, type Infer } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, internalQuery } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import { api, internal } from './_generated/api';
import { authedAction, authedMutation, authedQuery } from './lib/functions';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { canAccessCase, loadAccessibleCase, type AccessActor } from './lib/access';
import { nowIso, recomputeCaseRollups } from './lib/rollups';
import { documentFormatValidator, ocrStatusValidator } from './shared/enums';
import { buildActor, requireCompliance, requirePermission, sessionVerdict } from './lib/actor';
import { permissionValidator } from './shared/enums';

export const createFileTicket = internalMutation({
  args: { storageId: v.id('_storage'), userId: v.id('users'), authSessionId: v.union(v.string(), v.null()), caseId: v.id('cases'), permission: permissionValidator, name: v.string(), token: v.string(), documentId: v.optional(v.id('documents')), inline: v.optional(v.boolean()), contentType: v.optional(v.string()), watermarked: v.optional(v.boolean()) },
  returns: v.string(),
  handler: async (ctx, args) => {
    const expiresAt = Date.now() + 10 * 60 * 1000;
    const id = await ctx.db.insert('fileTickets', { ...args, expiresAt });
    await ctx.scheduler.runAfter(10 * 60 * 1000, internal.documents.removeFileTicket, { id });
    return `${process.env.CONVEX_SITE_URL}/files/${args.token}`;
  },
});

export const removeFileTicket = internalMutation({
  args: { id: v.id('fileTickets') },
  returns: v.null(),
  handler: async (ctx, { id }) => { if (await ctx.db.get(id)) await ctx.db.delete(id); return null; },
});

export const readFileTicket = internalQuery({
  args: { token: v.string() },
  returns: v.union(v.null(), v.object({ storageId: v.id('_storage'), name: v.string(), inline: v.boolean(), contentType: v.string() })),
  handler: async (ctx, { token }) => {
    const ticket = await ctx.db.query('fileTickets').withIndex('by_token', (query) => query.eq('token', token)).unique();
    if (!ticket || ticket.expiresAt <= Date.now()) return null;
    const user = await ctx.db.get(ticket.userId);
    if (!user || user.status !== 'active' || !user.authUserId) return null;
    if (!ticket.authSessionId) return null;
    const session = await ctx.db.query('userSessions').withIndex('by_authSessionId', (query) => query.eq('authSessionId', ticket.authSessionId!)).unique();
    if (!session || session.userId !== user._id) return null;
    const verdict = await sessionVerdict(ctx, { user, authUserId: user.authUserId, authSessionId: ticket.authSessionId });
    if (!verdict.live) return null;
    const actor = await buildActor(ctx, user, ticket.authSessionId);
    try {
      requirePermission(actor, ticket.permission);
      await requireCompliance(ctx, user);
      await loadAccessibleCase(ctx, ticket.caseId, actor.access);
    } catch { return null; }
    if (ticket.documentId) {
      const document = await ctx.db.get(ticket.documentId);
      if (!document || document.caseId !== ticket.caseId || (ticket.inline && document.confidential)) return null;
      if (document.confidential && !ticket.watermarked) return null;
      if (ticket.inline && !document.versions.some((version) => version.storageId === ticket.storageId)) return null;
    }
    return { storageId: ticket.storageId, name: ticket.name, inline: ticket.inline === true, contentType: ticket.contentType ?? 'application/octet-stream' };
  },
});

export const sourceFile = internalQuery({
  args: { id: v.id('documents'), version: v.optional(v.number()) },
  returns: v.object({ storageId: v.union(v.id('_storage'), v.null()) }),
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.id);
    const version = args.version === undefined ? document?.versions.at(-1) : document?.versions.find((entry) => entry.version === args.version);
    return { storageId: version?.storageId ?? null };
  },
});

export const removeTemporaryFile = internalMutation({
  args: { storageId: v.id('_storage') },
  returns: v.null(),
  handler: async (ctx, { storageId }) => { await ctx.storage.delete(storageId); return null; },
});

export const downloadFile = authedAction({
  permission: 'document.download',
  audit: { entity: 'Document', action: 'Downloaded document' },
  args: { id: v.id('documents'), version: v.optional(v.number()) },
  returns: v.object({ url: v.string(), name: v.string() }),
  handler: async (ctx, args): Promise<{ url: string; name: string }> => {
    const document = await ctx.runQuery(api.documents.get, { id: args.id });
    if (!document) throw new Error('Document not found.');
    const source = await ctx.runQuery(internal.documents.sourceFile, args);
    if (!source.storageId) throw new Error('This record does not contain an uploaded file.');
    const makeTicket = (storageId: Id<'_storage'>, name: string) => ctx.runMutation(internal.documents.createFileTicket, { storageId, name, userId: ctx.actor.id, authSessionId: ctx.actor.authSessionId, caseId: document.caseId, documentId: document.id, watermarked: document.confidential, permission: 'document.download', token: crypto.randomUUID() });
    if (!document.confidential) {
      await ctx.audit({ entityId: args.id, entityLabel: document.name });
      return { url: await makeTicket(source.storageId, document.name), name: document.name };
    }
    const stored = await ctx.storage.get(source.storageId);
    if (!stored) throw new Error('Stored file is unavailable.');
    const bytes = await stored.arrayBuffer();
    let pdf: PDFDocument;
    if (document.format === 'pdf') pdf = await PDFDocument.load(bytes);
    else if (document.format === 'png' || document.format === 'jpg') {
      pdf = await PDFDocument.create();
      const image = document.format === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      const page = pdf.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    } else throw new Error('Upload an approved PDF copy of confidential Word, Excel or email files before downloading.');
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const stamp = `CONFIDENTIAL | ${ctx.actor.label} | ${new Date().toISOString()}`.replace(/[^ -~]/g, '?');
    for (const page of pdf.getPages()) page.drawText(stamp, { x: 25, y: page.getHeight() / 3, size: 11, font, color: rgb(0.65, 0.1, 0.1), opacity: 0.5, rotate: degrees(30) });
    const storageId = await ctx.storage.store(new Blob([new Uint8Array(await pdf.save())], { type: 'application/pdf' }));
    await ctx.scheduler.runAfter(15 * 60 * 1000, internal.documents.removeTemporaryFile, { storageId });
    const name = document.name.replace(/\.[^.]+$/, '') + '-confidential.pdf';
    const url = await makeTicket(storageId, name);
    await ctx.audit({ entityId: args.id, entityLabel: document.name, metadata: { watermarked: true } });
    return { url, name };
  },
});

export const exportDossier = authedAction({
  permission: 'document.download',
  audit: { entity: 'Case', action: 'Exported indexed case dossier' },
  args: { caseId: v.id('cases') },
  returns: v.object({ url: v.string(), name: v.string() }),
  handler: async (ctx, { caseId }): Promise<{ url: string; name: string }> => {
    const detail = await ctx.runQuery(api.cases.getDetail, { caseId });
    const documents = await ctx.runQuery(api.documents.list, { caseId });
    if (documents.length > 60 || documents.reduce((total, document) => total + (document.versions.at(-1)?.sizeBytes ?? 0), 0) > 15 * 1024 * 1024) throw new Error('Dossier is too large for a single export (60 files or 15 MB). Export smaller document groups.');
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const safe = (text: string) => text.replace(/[^ -~]/g, '?');
    const indexPages = Math.max(1, Math.ceil(documents.length / 30));
    const indexes = Array.from({ length: indexPages }, () => pdf.addPage());
    let bytesRead = 0;
    for (const [position, document] of documents.entries()) {
      const file = await ctx.runAction(api.documents.downloadFile, { id: document.id });
    const response = await fetch(file.url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Unable to retrieve ${document.name}. No incomplete dossier was exported.`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      bytesRead += bytes.byteLength;
      if (bytesRead > 20 * 1024 * 1024) throw new Error('Prepared dossier exceeds the 20 MB limit.');
      const startPage = pdf.getPageCount() + 1;
      if (document.format === 'pdf' || document.confidential) {
        const original = await PDFDocument.load(bytes);
        const copied = await pdf.copyPages(original, original.getPageIndices());
        copied.forEach((page) => pdf.addPage(page));
      } else if (document.format === 'png' || document.format === 'jpg') {
        const image = document.format === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
        const page = pdf.addPage();
        const dimensions = image.scaleToFit(page.getWidth() - 50, page.getHeight() - 50);
        page.drawImage(image, { x: 25, y: 25, ...dimensions });
      } else {
        await pdf.attach(bytes, document.name, { description: 'Original case document - open the PDF attachments panel.' });
      }
      const label = document.format === 'pdf' || document.confidential || ['png', 'jpg'].includes(document.format) ? `page ${startPage}` : 'embedded attachment';
      indexes[Math.floor(position / 30)]!.drawText(safe(`${position + 1}. ${document.name.slice(0, 65)} - v${document.currentVersion} - ${label}`), { x: 35, y: 710 - (position % 30) * 20, size: 9, font });
    }
    for (const [position, page] of indexes.entries()) {
      page.drawText(safe(`HYPREP CASE DOSSIER: ${detail.row.record.caseId}`), { x: 35, y: 785, size: 13, font });
      page.drawText(safe(`Index ${position + 1}/${indexPages} | ${ctx.actor.label} | ${new Date().toISOString()}`), { x: 35, y: 760, size: 9, font });
    }
    const storageId = await ctx.storage.store(new Blob([new Uint8Array(await pdf.save())], { type: 'application/pdf' }));
    await ctx.scheduler.runAfter(15 * 60 * 1000, internal.documents.removeTemporaryFile, { storageId });
    const name = detail.row.record.caseId.replace(/[/]/g, '-') + '-dossier.pdf';
    const url = await ctx.runMutation(internal.documents.createFileTicket, { storageId, name, userId: ctx.actor.id, authSessionId: ctx.actor.authSessionId, caseId, permission: 'document.download', token: crypto.randomUUID() });
    await ctx.audit({ entityId: caseId, entityLabel: detail.row.record.caseId, metadata: { documents: documents.length } });
    return { url, name };
  },
});

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
  args: { id: v.id('documents'), version: v.optional(v.number()) },
  returns: v.object({ url: v.union(v.string(), v.null()) }),
  handler: async (ctx, { id, version }) => {
    const document = await ctx.db.get(id);
    if (document === null) return { url: null };
    const record = await loadAccessibleCase(ctx, document.caseId, ctx.actor.access);
    if (record === null) return { url: null };
    if (document.confidential) return { url: null };

    const latest = version === undefined ? document.versions.at(-1) : document.versions.find((entry) => entry.version === version);
    if (!latest || latest.storageId === null) return { url: null };
    return { url: null };
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

export const getPreviewUrl = authedMutation({
  permission: 'document.view',
  audit: { entity: 'Document', action: 'Previewed document' },
  args: { id: v.id('documents'), version: v.optional(v.number()) },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, args): Promise<{ url: string }> => {
    const document = await ctx.db.get(args.id);
    if (!document) throw new Error('Document not found.');
    await loadAccessibleCase(ctx, document.caseId, ctx.actor.access);
    if (document.confidential) throw new Error('Confidential files must be downloaded as a watermarked PDF.');
    const contentType = ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg' } as Record<string, string>)[document.format];
    if (!contentType) throw new Error('Use Download to open this format in its desktop application.');
    const version = args.version === undefined ? document.versions.at(-1) : document.versions.find((entry) => entry.version === args.version);
    if (!version?.storageId) throw new Error('This version has no stored file.');
    if (!ctx.actor.authSessionId) throw new Error('Sign in again.');
    const url = await ctx.runMutation(internal.documents.createFileTicket, { storageId: version.storageId, name: document.name, userId: ctx.actor.user._id, authSessionId: ctx.actor.authSessionId, caseId: document.caseId, documentId: document._id, permission: 'document.view', inline: true, contentType, token: crypto.randomUUID() });
    await ctx.audit({ entityId: document._id, entityLabel: document.name });
    return { url };
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
    if (!input.storageId) throw new Error('Upload the actual file before filing it.');
    const stored = await ctx.db.system.get(input.storageId);
    if (!stored || stored.size !== input.sizeBytes || stored.size > 50 * 1024 * 1024 || stored.size < 1) throw new Error('Invalid file size or storage reference.');
    const type = await ctx.db.get(input.documentTypeId);
    if (!type) throw new Error('Document type not found.');
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
      confidential: input.confidential || type.requiresConfidentiality || record.confidential,
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
    if (document.checkedOutById && document.checkedOutById !== ctx.actor.user._id) throw new Error('This document is checked out by another user.');
    if (!storageId) throw new Error('Upload the actual replacement file.');
    const stored = await ctx.db.system.get(storageId);
    if (!stored || stored.size !== sizeBytes || stored.size > 50 * 1024 * 1024 || stored.size < 1) throw new Error('Invalid replacement file.');
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
      ocrText: null,
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
    if (document.checkedOutById && document.checkedOutById !== ctx.actor.user._id) throw new Error('This document is checked out by another user.');

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
    const cap = Math.min(Math.max(1, limit ?? 100), 200);
    const batches = await Promise.all([...new Set(statuses)].map((status) => ctx.db.query('documents').withIndex('by_ocrStatus', (query) => query.eq('ocrStatus', status)).take(cap)));
    const pending = batches.flat()
      .filter((document) => document.ocrAttempts < 3)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((document) => document._id);
    return pending.slice(0, cap);
  },
});

/**
 * Marks a document's OCR state. Called by the OCR worker. `ocrStatus` flips to
 * `completed` with the extracted text, or `failed` after the attempt budget.
 */
export const internalSetOcrResult = internalMutation({
  args: {
    documentId: v.id('documents'),
    version: v.optional(v.number()),
    ocrStatus: ocrStatusValidator,
    ocrText: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { documentId, version, ocrStatus, ocrText }) => {
    const document = await ctx.db.get(documentId);
    if (document === null) return null;
    if (version !== undefined && version !== document.currentVersion) return null;
    await ctx.db.patch(documentId, {
      ocrStatus,
      ocrText,
      ocrAttempts: document.ocrAttempts + 1,
      updatedAt: nowIso(),
    });
    return null;
  },
});
