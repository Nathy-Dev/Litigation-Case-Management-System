'use node';

import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';

/**
 * HYPREP LCMS - optical character recognition (TOR §10).
 *
 * Wired to Google Cloud Vision REST. The `documents` rows carry `ocrStatus`
 * and the recovered `ocrText`; this module is the worker that fills them, and
 * the OCR text backs the `search_document_text` index so a document's
 * *contents* become searchable, not just its filename.
 *
 * **Gated.** `settings.ocrEnabled` must be true and `GOOGLE_CLOUD_VISION_KEY`
 * must be set, else the job is marked `not_applicable` and left for the human
 * who enabled the feature. A missing key is a configuration error, not a
 * failure to retry forever.
 *
 * **PDF batching.** Vision's `files:annotate` caps at 5 pages per request, so
 * a PDF is looped in batches of 5 pages with base64 inline — no GCS upload,
 * which is what `asyncBatchAnnotate` would demand.
 *
 * **Format coverage.** Vision reads `pdf`, `jpg` and `png` directly. Word and
 * spreadsheet formats (`docx`, `doc`, `xlsx`) and Outlook messages (`msg`)
 * are not vision inputs — those documents are marked `not_applicable` rather
 * than retried pointlessly.
 *
 * Sending never throws against the document: every failure path ends in a
 * state the requeue cron can see and stop retrying (`failed` at the attempt
 * budget).
 */

const PAGE_BATCH = 5;
const MAX_ATTEMPTS = 3;
const VISION_ENDPOINT = 'https://vision.googleapis.com/v1';

function visionKey(): string | null {
  const key = process.env.GOOGLE_CLOUD_VISION_KEY?.trim();
  return key ? key : null;
}

/** MIME types Vision reads directly, keyed by our format strings. */
const VISION_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  png: 'image/png',
};

/**
 * The worker. Reads the latest version's blob, OCRs it, and writes the result
 * back through `internalSetOcrResult` (an internal mutation, so the text lands
 * in the same store that powers search).
 */
export const extract = internalAction({
  args: { documentId: v.id('documents') },
  handler: async (ctx, { documentId }) => {
    const enabled = await ctx.runQuery(internal.documents.getOcrEnabled);
    if (!enabled) {
      await ctx.runMutation(internal.documents.internalSetOcrResult, {
        documentId,
        ocrStatus: 'not_applicable',
        ocrText: null,
      });
      return;
    }

    const key = visionKey();
    if (key === null) {
      await ctx.runMutation(internal.documents.internalSetOcrResult, {
        documentId,
        ocrStatus: 'not_applicable',
        ocrText: null,
      });
      return;
    }

    let document;
    try {
      document = await ctx.runQuery(internal.documents.internalGetDocumentForOcr, {
        id: documentId,
      });
    } catch {
      return;
    }
    if (document === null) return;

    const latest = document.versions.at(-1);
    if (!latest || latest.storageId === null) {
      await ctx.runMutation(internal.documents.internalSetOcrResult, {
        documentId,
        version: latest?.version,
        ocrStatus: 'not_applicable',
        ocrText: null,
      });
      return;
    }

    const mime = VISION_MIME[document.format];
    if (!mime) {
      await ctx.runMutation(internal.documents.internalSetOcrResult, {
        documentId,
        version: latest?.version,
        ocrStatus: 'not_applicable',
        ocrText: null,
      });
      return;
    }

    if (document.ocrAttempts >= MAX_ATTEMPTS) {
      await ctx.runMutation(internal.documents.internalSetOcrResult, {
        documentId,
        version: latest?.version,
        ocrStatus: 'failed',
        ocrText: null,
      });
      return;
    }

    let blob: ArrayBuffer;
    try {
      const stored = await ctx.storage.get(latest.storageId);
      if (stored === null) {
        await ctx.runMutation(internal.documents.internalSetOcrResult, {
          documentId,
          version: latest?.version,
          ocrStatus: 'failed',
          ocrText: null,
        });
        return;
      }
      blob = await stored.arrayBuffer();
    } catch {
      await ctx.runMutation(internal.documents.internalSetOcrResult, {
        documentId,
        version: latest?.version,
        ocrStatus: 'failed',
        ocrText: null,
      });
      return;
    }

    try {
      const text = document.format === 'pdf' ? await visionPdf(key, blob) : await visionImage(key, blob);

      await ctx.runMutation(internal.documents.internalSetOcrResult, {
        documentId,
        version: latest?.version,
        ocrStatus: 'completed',
        ocrText: text,
      });
    } catch {
      await ctx.runMutation(internal.documents.internalSetOcrResult, {
        documentId,
        version: latest?.version,
        ocrStatus: 'failed',
        ocrText: null,
      });
    }
  },
});

async function base64FromBuffer(buffer: ArrayBuffer): Promise<string> {
  // The Node runtime ships a Buffer; encode the blob once per request.
  return Buffer.from(buffer).toString('base64');
}

/** One `annotate` round trip; joins per-response text in request order. */
async function annotate(key: string, request: unknown): Promise<string> {
  const response = await fetch(`${VISION_ENDPOINT}/files:annotate?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [request] }),
  });
  if (!response.ok) {
    throw new Error(`Vision returned ${response.status}: ${await response.text()}`);
  }
  const json = (await response.json()) as {
    responses?: Array<{ fullTextAnnotation?: { text?: string } }>;
  };
  return (json.responses ?? []).map((item) => item.fullTextAnnotation?.text ?? '').join('\n');
}

async function visionImage(key: string, blob: ArrayBuffer): Promise<string> {
  const content = await base64FromBuffer(blob);
  return await annotate(key, {
    image: { content },
    features: [{ type: 'TEXT_DETECTION' }],
  });
}

/**
 * PDFs are split into page batches because `files:annotate` accepts at most 5
 * pages per request. Each batch returns its own `responses`; the pages are
 * concatenated in order.
 */
async function visionPdf(key: string, blob: ArrayBuffer): Promise<string> {
  const total = pageCount(blob);
  const batches = Math.ceil(total / PAGE_BATCH);
  const chunks: string[] = [];

  for (let batch = 0; batch < batches; batch += 1) {
    const start = batch * PAGE_BATCH + 1;
    const end = Math.min(start + PAGE_BATCH - 1, total);
    const content = await base64FromBuffer(blob);
    chunks.push(
      await annotate(key, {
        inputConfig: { content, mimeType: 'application/pdf' },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        pages: [start, end],
      }),
    );
  }

  return chunks.join('\n');
}

/** A light PDF page estimate for batching (integer from the file's trailer). */
function pageCount(buffer: ArrayBuffer): number {
  const bytes = new Uint8Array(buffer);
  const text = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 1_000_000)));
  const match = /\/Type\s*\/Page[^s]/.exec(text) || /\/Count\s+(\d+)/.exec(text);
  if (match && /^\/Count/.test(match[0])) {
    const count = match[1] ? parseInt(match[1], 10) : 1;
    return Number.isFinite(count) && count > 0 ? count : 1;
  }
  if (match) return 1;
  return 1;
}
