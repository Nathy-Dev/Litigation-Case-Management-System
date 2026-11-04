'use node';

import { v } from 'convex/values';
import { internalAction } from '../../_generated/server';

/**
 * HYPREP LCMS - outbound transactional email.
 *
 * Every message this system sends is transactional and mostly time-critical: an
 * invitation, a password reset, a hearing reminder, the daily digest. Nothing here
 * is marketing, so there is no list management, no unsubscribe handling and no
 * template engine - a subject, a body, and an honest answer about whether it left.
 *
 * **Two providers, one seam.** `EMAIL_PROVIDER` selects between Resend (an HTTPS
 * call, nothing to install) and SMTP, which the TOR's on-premises option needs
 * because a government network may not permit outbound calls to a third-party
 * API. SMTP is why this file runs in the Node runtime: `nodemailer` speaks a
 * socket protocol that the default Convex runtime has no sockets for.
 *
 * **Sending never throws.** A caller is always either a scheduled action or a
 * Better Auth callback, and in both cases a provider outage must not turn into a
 * failed hearing reschedule or a password reset that reports an error while
 * having already invalidated the old token. Failures are returned, logged, and -
 * for anything a user is waiting on - visible in the audit trail through the
 * caller. The one thing that would be worse than an undelivered email is a lost
 * court date.
 */

const SEND_TIMEOUT_MS = 15_000;

export interface EmailResult {
  delivered: boolean;
  detail: string;
}

const emailResult = v.object({ delivered: v.boolean(), detail: v.string() });

/** Turns anything thrown into a message, since `catch` gives no guarantees. */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : JSON.stringify(error);
}

/**
 * The sender address, which is not optional in practice.
 *
 * Both providers reject a message with no from-address, and Resend additionally
 * requires the domain to be verified against the account. A missing value is
 * therefore a configuration error worth naming rather than a default worth
 * inventing.
 */
function senderAddress(): string | null {
  const from = process.env.EMAIL_FROM?.trim();
  return from ? from : null;
}

async function sendViaResend(
  from: string,
  to: string,
  subject: string,
  text: string,
  html: string | undefined,
): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    return { delivered: false, detail: 'RESEND_API_KEY is not set.' };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text, ...(html ? { html } : {}) }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });

  if (!response.ok) {
    // Resend puts the actionable part in the body - an unverified domain, a
    // malformed address - so the status alone would send the reader to the
    // dashboard to find out what a 422 meant.
    const body = await response.text().catch(() => '');
    return {
      delivered: false,
      detail: `Resend refused the message (${response.status}). ${body}`.trim(),
    };
  }

  const payload = (await response.json().catch(() => null)) as { id?: string } | null;
  return { delivered: true, detail: payload?.id ? `Resend id ${payload.id}` : 'Accepted by Resend.' };
}

async function sendViaSmtp(
  from: string,
  to: string,
  subject: string,
  text: string,
  html: string | undefined,
): Promise<EmailResult> {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return { delivered: false, detail: 'SMTP_HOST is not set.' };

  const port = Number(process.env.SMTP_PORT ?? '587');
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASSWORD;

  // Imported here rather than at module scope so a deployment using Resend never
  // pays to load a mail library it will not call.
  const { createTransport } = await import('nodemailer');

  const transport = createTransport({
    host,
    port,
    // 465 is implicit TLS; 587 negotiates STARTTLS after connecting, which is
    // what `secure: false` means here - not "unencrypted".
    secure: port === 465,
    ...(user ? { auth: { user, pass } } : {}),
    connectionTimeout: SEND_TIMEOUT_MS,
    greetingTimeout: SEND_TIMEOUT_MS,
  });

  const info = await transport.sendMail({ from, to, subject, text, ...(html ? { html } : {}) });
  return { delivered: true, detail: `Accepted by ${host} as ${info.messageId}` };
}

/**
 * Sends one message, by whichever provider this deployment is configured for.
 *
 * `EMAIL_PROVIDER` unset is a deployment with email switched off, not a broken
 * one: the register, the diary and the audit trail all work without it, and a
 * reviewer running the system locally should not have to hold a Resend account.
 * It is logged loudly at the point of the attempt, so the reason an invitation
 * never arrived is one function log away rather than a mystery.
 */
export const send = internalAction({
  args: {
    to: v.string(),
    subject: v.string(),
    text: v.string(),
    html: v.optional(v.string()),
  },
  returns: emailResult,
  handler: async (_ctx, { to, subject, text, html }): Promise<EmailResult> => {
    const provider = (process.env.EMAIL_PROVIDER ?? '').trim().toLowerCase();
    const from = senderAddress();

    if (provider === '' || provider === 'none') {
      const detail = 'EMAIL_PROVIDER is not set, so no email was sent.';
      console.warn(`[email] ${detail} Intended recipient ${to}, subject "${subject}".`);
      return { delivered: false, detail };
    }
    if (from === null) {
      const detail = 'EMAIL_FROM is not set, so no email was sent.';
      console.error(`[email] ${detail} Intended recipient ${to}.`);
      return { delivered: false, detail };
    }

    try {
      const result =
        provider === 'resend'
          ? await sendViaResend(from, to, subject, text, html)
          : provider === 'smtp'
            ? await sendViaSmtp(from, to, subject, text, html)
            : {
                delivered: false,
                detail: `EMAIL_PROVIDER is "${provider}"; expected "resend", "smtp" or "none".`,
              };

      if (!result.delivered) console.error(`[email] to ${to}: ${result.detail}`);
      return result;
    } catch (error) {
      // Reached for a network failure, a timeout, or an SMTP handshake that never
      // completes. See the note at the head of the file on why this is returned
      // rather than rethrown.
      const detail = describeError(error);
      console.error(`[email] to ${to} failed: ${detail}`);
      return { delivered: false, detail };
    }
  },
});
